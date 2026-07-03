#!/usr/bin/env python3
"""
pareidolia_index.py — transition-fulcrum matcher over painting + depth.

"Pareidolia" here is shorthand, not face detection: a hinge is a patch
that can read as part of BOTH the previous and the next painting's
subject at the same time. During a transition the camera dives into
painting A's hinge patch and pulls out to find the same region already
serving as part of painting B — the viewer never sees a cut.

For each ordered pair of baked paintings the matcher searches for the
best shared patch:

  1. Both paintings are downscaled and converted to LAB; their depth
     maps ride along as a second matching channel.
  2. Square patches are sampled from A on a grid at several scales.
     Flat, featureless patches are skipped (they'd match anything and
     hinge on nothing).
  3. Each candidate is template-matched against B (normalised
     cross-correlation) in LAB and in depth; the combined score is
     0.7 * colour + 0.3 * depth.
  4. The best (patch, location) pair per (A, B) becomes an edge.

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
PATCH_SCALES   = (0.22, 0.32, 0.45)   # patch edge / min(painting dims)
GRID_STEPS     = 7                    # candidate grid per axis
MIN_STD_LAB    = 6.0                  # skip featureless patches (LAB std floor)
COLOR_WEIGHT   = 0.7
DEPTH_WEIGHT   = 0.3


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
    mn, mx = float(depth_s.min()), float(depth_s.max())
    depth_s = (depth_s - mn) / (mx - mn) if mx - mn > 1e-6 else np.zeros_like(depth_s)
    lab = cv2.cvtColor(rgb_s, cv2.COLOR_RGB2LAB).astype(np.float32)
    return {"id": pid, "w": w, "h": h, "lab": lab,
            "depth": (depth_s * 255.0).astype(np.float32)}


def best_hinge(a: dict, b: dict) -> dict | None:
    """Best shared patch from painting a into painting b."""
    ah, aw = a["lab"].shape[:2]
    bh, bw = b["lab"].shape[:2]
    best = None

    for frac in PATCH_SCALES:
        ps = int(round(frac * min(ah, aw)))
        if ps < 12 or ps >= bh or ps >= bw:
            continue
        xs = np.linspace(0, aw - ps, GRID_STEPS).astype(int)
        ys = np.linspace(0, ah - ps, GRID_STEPS).astype(int)
        for y in ys:
            for x in xs:
                patch_lab = a["lab"][y:y + ps, x:x + ps]
                if float(patch_lab.std()) < MIN_STD_LAB:
                    continue
                patch_d = a["depth"][y:y + ps, x:x + ps]

                res_c = cv2.matchTemplate(b["lab"], patch_lab, cv2.TM_CCOEFF_NORMED)
                res_d = cv2.matchTemplate(b["depth"], patch_d, cv2.TM_CCOEFF_NORMED)
                res = COLOR_WEIGHT * res_c + DEPTH_WEIGHT * res_d
                _, score, _, loc = cv2.minMaxLoc(res)
                if best is None or score > best["weight"]:
                    best = {
                        "weight": round(float(score), 4),
                        "s_uv": [round((x + ps / 2) / aw, 4),
                                 round((y + ps / 2) / ah, 4)],
                        "t_uv": [round((loc[0] + ps / 2) / bw, 4),
                                 round((loc[1] + ps / 2) / bh, 4)],
                        "scale": round(frac, 4),
                    }
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
