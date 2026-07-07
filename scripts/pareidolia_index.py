#!/usr/bin/env python3
"""
pareidolia_index.py — transition-fulcrum matcher over painting + depth.

"Pareidolia" here is shorthand, NOT face detection: a hinge is a patch
that reads as part of BOTH the previous and the next painting at the
same time — a spot the eye rests on in each composition, structurally
alike enough that one form becomes the other without a visible cut.
During a transition the camera dives into painting A's hinge patch and
pulls out to find that same region already serving as part of painting
B; the viewer never registers the swap. The subject can be anything (a
face, a shape, a mass of colour) — some paintings have no figure at all.

For each ordered pair (A, B) the matcher searches for the patch that is
simultaneously:

  1. SALIENT in A — a feature the eye actually lands on, not flat field.
     Saliency = local contrast + edge energy + colour distinctiveness.
  2. SIMILAR to some region of B — matched on colour (LAB) AND on
     gradient structure (so shapes align, not just palettes), with depth
     as a light third channel.
  3. SALIENT in B at the matched spot — the fulcrum has to be a feature
     in BOTH paintings, or the reveal lands on empty background.

The final score multiplies structural similarity by the mutual saliency
of the two endpoints, so a hinge is only strong when it is a resonant
feature on each side. The best (patch, location) per (A, B) is one edge.

Inputs:   public/data/theater/{id}.painting.webp
          public/data/theater/{id}.depth.png
          public/data/theater/_manifest.json
Output:   public/data/theater/graph.theater.json
  { "schemaVersion": 5,
    "nodes": [{"id", "width", "height"}...],
    "edges": [{"source", "target", "weight",
               "s_uv": [u, v], "t_uv": [u, v], "scale": f}...] }

`s_uv`/`t_uv` are the patch centres in normalised image coordinates
(u right, v down, 0..1); `scale` is the patch edge as a fraction of the
painting's min dimension. The frontend places painting B so its t_uv
point coincides in world space with A's s_uv point, and routes the
camera through it.

Usage:
  python3 scripts/pareidolia_index.py --data public/data/theater/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

WORK_LONG_EDGE = 256                  # matching resolution
PATCH_SCALES   = (0.20, 0.30, 0.42)   # patch edge / min(painting dims)
GRID_STEPS     = 9                    # candidate grid per axis
MIN_SALIENCY   = 0.18                 # skip A-patches below this mean saliency

# Similarity is a blend of channels; structure carries real weight so the
# fulcrum's SHAPE lines up, not just its colour.
W_COLOR  = 0.45
W_STRUCT = 0.40
W_DEPTH  = 0.15


def _norm01(x: np.ndarray) -> np.ndarray:
    mn, mx = float(x.min()), float(x.max())
    return (x - mn) / (mx - mn) if mx - mn > 1e-6 else np.zeros_like(x)


def saliency_map(rgb_s: np.ndarray, lab: np.ndarray) -> np.ndarray:
    """Where the eye lands: local contrast + edge energy + colour
    distinctiveness. Returned normalised to 0..1."""
    gray = cv2.cvtColor(rgb_s, cv2.COLOR_RGB2GRAY).astype(np.float32)

    # Edge energy.
    edge = np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3))

    # Local contrast (std over a small window).
    k = max(3, int(round(0.06 * max(gray.shape))) | 1)
    mean = cv2.boxFilter(gray, cv2.CV_32F, (k, k))
    sqmean = cv2.boxFilter(gray * gray, cv2.CV_32F, (k, k))
    local_std = np.sqrt(np.maximum(sqmean - mean * mean, 0.0))

    # Colour distinctiveness: distance in LAB from the image's mean colour.
    lab_mean = lab.reshape(-1, 3).mean(axis=0)
    color_dev = np.linalg.norm(lab - lab_mean, axis=2)

    sal = 0.40 * _norm01(edge) + 0.30 * _norm01(local_std) + 0.30 * _norm01(color_dev)
    sal = cv2.GaussianBlur(sal, (0, 0), sigmaX=2.0)
    return _norm01(sal)


def window_mean(img: np.ndarray, ps: int) -> np.ndarray:
    """Mean of every ps×ps window, aligned to cv2.matchTemplate output
    indexing (result[y,x] ↔ window with top-left (x,y))."""
    ii = cv2.integral(img.astype(np.float32))
    h, w = img.shape[:2]
    s = (ii[ps:h + 1, ps:w + 1] - ii[0:h - ps + 1, ps:w + 1]
         - ii[ps:h + 1, 0:w - ps + 1] + ii[0:h - ps + 1, 0:w - ps + 1])
    return s / float(ps * ps)


def load_painting(data_dir: Path, pid: str) -> dict:
    rgb = np.array(Image.open(data_dir / f"{pid}.painting.webp").convert("RGB"))
    depth = np.array(Image.open(data_dir / f"{pid}.depth.png")).astype(np.float32)
    if depth.ndim == 3:
        depth = depth[..., 0]
    h, w = rgb.shape[:2]
    scale = WORK_LONG_EDGE / max(h, w)
    size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    rgb_s = cv2.resize(rgb, size, interpolation=cv2.INTER_AREA)
    depth_s = cv2.resize(depth, size, interpolation=cv2.INTER_AREA)
    depth_s = _norm01(depth_s)
    lab = cv2.cvtColor(rgb_s, cv2.COLOR_RGB2LAB).astype(np.float32)

    # Gradient-magnitude channel for structural matching.
    gray = cv2.cvtColor(rgb_s, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = _norm01(np.sqrt(gx * gx + gy * gy)) * 255.0

    return {
        "id": pid, "w": w, "h": h,
        "lab": lab,
        "grad": grad.astype(np.float32),
        "depth": (depth_s * 255.0).astype(np.float32),
        "sal": saliency_map(rgb_s, lab),
    }


def best_hinge(a: dict, b: dict) -> dict | None:
    """Best shared patch from painting a into painting b: salient in both
    and structurally similar."""
    ah, aw = a["lab"].shape[:2]
    bh, bw = b["lab"].shape[:2]
    best = None

    for frac in PATCH_SCALES:
        ps = int(round(frac * min(ah, aw)))
        if ps < 12 or ps >= bh or ps >= bw:
            continue

        # Mean saliency of every candidate window in B (aligned to
        # matchTemplate output), used to bias the match toward B features.
        sal_b_win = window_mean(b["sal"], ps)

        xs = np.linspace(0, aw - ps, GRID_STEPS).astype(int)
        ys = np.linspace(0, ah - ps, GRID_STEPS).astype(int)
        for y in ys:
            for x in xs:
                sal_a = float(a["sal"][y:y + ps, x:x + ps].mean())
                if sal_a < MIN_SALIENCY:
                    continue  # A-patch is flat field — nothing to hinge on

                patch_lab = a["lab"][y:y + ps, x:x + ps]
                patch_grd = a["grad"][y:y + ps, x:x + ps]
                patch_dep = a["depth"][y:y + ps, x:x + ps]

                cc = (W_COLOR * cv2.matchTemplate(b["lab"], patch_lab, cv2.TM_CCOEFF_NORMED)
                      + W_STRUCT * cv2.matchTemplate(b["grad"], patch_grd, cv2.TM_CCOEFF_NORMED)
                      + W_DEPTH * cv2.matchTemplate(b["depth"], patch_dep, cv2.TM_CCOEFF_NORMED))

                # Bias the location search toward B regions that are
                # themselves salient — the fulcrum must be a feature on
                # both sides, not a match onto flat background.
                weighted = cc * (0.5 + 0.5 * sal_b_win)
                _, _, _, loc = cv2.minMaxLoc(weighted)
                lx, ly = loc
                sim = float(cc[ly, lx])
                sal_b = float(sal_b_win[ly, lx])

                # Final: structural/colour similarity gated by the mutual
                # saliency of the two endpoints.
                score = max(0.0, sim) * float(np.sqrt(max(sal_a, 1e-6) * max(sal_b, 1e-6)))

                if best is None or score > best["_score"]:
                    best = {
                        "_score": score,
                        "weight": round(score, 4),
                        "s_uv": [round(float(x + ps / 2) / aw, 4),
                                 round(float(y + ps / 2) / ah, 4)],
                        "t_uv": [round(float(lx + ps / 2) / bw, 4),
                                 round(float(ly + ps / 2) / bh, 4)],
                        "scale": round(frac, 4),
                    }
    if best is not None:
        best.pop("_score", None)
    return best


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=Path("public/data/theater"))
    args = ap.parse_args(argv)

    manifest_path = args.data / "_manifest.json"
    if not manifest_path.exists():
        print(f"[!] no manifest at {manifest_path}", file=sys.stderr)
        return 2
    ids = json.loads(manifest_path.read_text())
    if len(ids) < 2:
        print("[!] need at least 2 baked paintings to build hinges", file=sys.stderr)
        return 1

    paintings = {pid: load_painting(args.data, pid) for pid in ids}

    nodes = [{"id": p["id"], "width": p["w"], "height": p["h"]}
             for p in paintings.values()]
    edges = []
    for sid in ids:
        for tid in ids:
            if sid == tid:
                continue
            hinge = best_hinge(paintings[sid], paintings[tid])
            if hinge is None:
                continue
            edges.append({"source": sid, "target": tid, **hinge})
            print(f"[+] {sid[:24]} -> {tid[:24]}  w={hinge['weight']:.3f} "
                  f"s={hinge['s_uv']} t={hinge['t_uv']} scale={hinge['scale']}")

    out = args.data / "graph.theater.json"
    out.write_text(json.dumps(
        {"schemaVersion": 5, "nodes": nodes, "edges": edges},
        separators=(",", ":")))
    print(f"[m] {len(edges)} edges -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
