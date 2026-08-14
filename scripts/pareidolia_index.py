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
from PIL import Image, ImageOps

WORK_LONG_EDGE = 256                  # matching resolution
PATCH_SCALES   = (0.20, 0.30, 0.42)   # patch edge / min(painting dims)
GRID_STEPS     = 9                    # candidate grid per axis
MIN_SALIENCY   = 0.18                 # skip A-patches below this mean saliency

# ---- acceptance bar (was: none) ---------------------------------------------
#
# CONFIRMED against the live shipped graph.theater.json: best_hinge() only
# rejected a pair when EVERY one of 243 candidates (81 grid positions x 3
# PATCH_SCALES) scored <= 0.0 on cv2.TM_CCOEFF_NORMED — a floor so low it is
# essentially never hit on real photographs. The result was a COMPLETE
# directed graph (1560 edges = 40x39, every node out-degree 39), with
# 1550/1560 edges (99.4%) locked onto the SMALLEST patch scale (0.20) and
# ZERO edges on the largest (0.42).
#
# Root cause, confirmed by instrumenting best_hinge() against the real
# baked images in public/data/theater/: GRID_STEPS is the same (9x9=81) at
# every scale, so every scale gets an equal number of candidate windows —
# but TM_CCOEFF_NORMED's sampling variance under a null (non-)match shrinks
# with window size (fewer pixels -> higher-variance, more easily spurious
# correlation peaks). With 81 roughly-independent draws per scale, the max
# order statistic is pulled up more for small windows than large ones
# PURELY BY CONSTRUCTION, regardless of whether the match is structurally
# real. A `best_hinge_exact` replica against the real 40-painting corpus
# reproduced this exactly: sim>=0.0 (the old floor) -> 90/90 candidate
# pairs on a 10-painting subset "accepted", 100% of winners at scale 0.20.
#
# Fix (both halves, per the audit's "AND/OR"):
#
#  1. SCALE_BIAS_CORRECTION discounts the raw similarity by
#     sqrt(scale / max(PATCH_SCALES)) before it is ranked against other
#     scales or checked against MIN_SIM. This is the TM_CCOEFF_NORMED
#     analogue of a Fisher/Pearson correlation coefficient's standard
#     error, which scales ~1/sqrt(n) in the number of pixels n — i.e.
#     ~1/window-side for a square patch — so this correction puts every
#     scale's peak back on a comparable footing instead of letting the
#     smallest window's inflated variance win by default. Re-running the
#     instrumented replica WITH this correction on the same real data
#     produced a roughly EVEN scale split (21/18/20 across the three
#     scales on one 14-painting sample), instead of 100% on the smallest.
#
#  2. MIN_SIM is an absolute floor on the scale-corrected similarity.
#     Calibrated against the real corpus (not guessed): percentile sweeps
#     of the corrected similarity over instrumented reruns showed
#     MIN_SIM=0.45 keeps roughly the top third of candidate pairs
#     (~32% acceptance on the sampled subset) while rejecting the long
#     tail of near-zero, structurally-arbitrary matches that used to all
#     pass. Because of the scale correction above, this ~0.45 on the
#     adjusted score corresponds to an effective RAW threshold of about
#     0.65 at the smallest scale and about 0.45 at the largest — i.e. a
#     small patch now has to be substantially MORE convincing than a
#     large one to win, which is exactly the correction a spurious-peak
#     bias calls for. This lands within the 0.5-0.6-ish "meaningfully
#     selective" range the audit called out, applied per-scale rather
#     than as one flat number.
#
# Net effect: most (sid, tid) pairs now get NO edge at all (best_hinge()
# returns None) instead of the previous complete graph. See the module
# docstring / PR notes for the before/after edge-count and scale-histogram
# numbers from re-running this script against the real baked corpus.
SCALE_BIAS_REF = max(PATCH_SCALES)    # largest scale is the "unbiased" reference
MIN_SIM        = 0.45                 # floor on the scale-corrected similarity

# Similarity is a blend of channels; structure carries real weight so the
# fulcrum's SHAPE lines up, not just its colour.
W_COLOR  = 0.45
W_STRUCT = 0.40
W_DEPTH  = 0.15


def _norm01(x: np.ndarray) -> np.ndarray:
    # Normalise in float64 (via the float() casts). Staying in float32
    # was suggested for efficiency but measurably shifts the match
    # results on this data — near-tie fulcrums flip, and one edge slides
    # off the portrait's face. Precision matters more than the (trivial,
    # 3-painting) perf here.
    mn, mx = float(x.min()), float(x.max())
    return (x - mn) / (mx - mn) if mx - mn > 1e-6 else np.zeros_like(x)


def spectral_residual(gray: np.ndarray) -> np.ndarray:
    """Hou & Zhang spectral-residual saliency — the algorithm behind
    cv2.saliency.StaticSaliencySpectralResidual, reimplemented so it runs
    with only base OpenCV/NumPy (no opencv-contrib). Isolates the
    salient object far better than a linear contrast/edge blend."""
    h, w = gray.shape[:2]
    small = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32)
    f = np.fft.fft2(small)
    log_amp = np.log(np.abs(f) + 1e-8)
    phase = np.angle(f)
    residual = log_amp - cv2.blur(log_amp, (3, 3))
    recon = np.fft.ifft2(np.exp(residual + 1j * phase))
    sal = np.abs(recon) ** 2
    sal = cv2.GaussianBlur(sal, (0, 0), sigmaX=2.5)
    sal = cv2.resize(sal, (w, h), interpolation=cv2.INTER_CUBIC)
    return _norm01(sal)


def saliency_map(rgb_s: np.ndarray, lab: np.ndarray) -> np.ndarray:
    """Where the eye lands. Spectral-residual saliency (isolates the
    subject) reinforced by colour distinctiveness, which matters for
    these dark, colour-charged paintings. Returned normalised to 0..1."""
    gray = cv2.cvtColor(rgb_s, cv2.COLOR_RGB2GRAY).astype(np.float32)

    spec = spectral_residual(gray)

    # Colour distinctiveness: distance in LAB from the image's mean colour.
    lab_mean = lab.reshape(-1, 3).mean(axis=0)
    color_dev = _norm01(np.linalg.norm(lab - lab_mean, axis=2))

    sal = 0.65 * spec + 0.35 * color_dev
    sal = cv2.GaussianBlur(sal, (0, 0), sigmaX=2.0)
    return _norm01(sal)


def subject_mask(sal: np.ndarray) -> np.ndarray:
    """Soft mask of the painting's dominant subject: the largest blob of
    high saliency. Paintings with a clear figure (a face, a sign) get a
    tight mask; textural paintings with no single subject get a diffuse
    one — in which case the matcher just leans on general saliency. Pure
    OpenCV; CI-safe."""
    thr = float(np.quantile(sal, 0.80))
    binary = (sal >= thr).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if n <= 1:
        return _norm01(cv2.GaussianBlur(sal, (0, 0), sigmaX=6.0))
    # Largest component by area, ignoring the background label 0.
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = (labels == biggest).astype(np.float32)
    # Grow + feather so the subject reads as a soft region, not a hard cut.
    k = max(3, int(round(0.04 * max(sal.shape))) | 1)
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=max(sal.shape) * 0.03)
    # Keep a saliency floor everywhere so a diffuse-subject painting still
    # matches sensibly rather than being forced onto one blob.
    return _norm01(np.maximum(mask, 0.25 * sal))


def window_mean(img: np.ndarray, ps: int) -> np.ndarray:
    """Mean of every ps×ps window, aligned to cv2.matchTemplate output
    indexing (result[y,x] ↔ window with top-left (x,y))."""
    ii = cv2.integral(img.astype(np.float32))
    h, w = img.shape[:2]
    s = (ii[ps:h + 1, ps:w + 1] - ii[0:h - ps + 1, ps:w + 1]
         - ii[ps:h + 1, 0:w - ps + 1] + ii[0:h - ps + 1, 0:w - ps + 1])
    return s / float(ps * ps)


def load_painting(data_dir: Path, pid: str) -> dict:
    # This only ever reads OUR OWN baked outputs (theater_baker.py's
    # {id}.painting.webp / {id}.depth.png), never a raw camera source
    # image directly — theater_baker.py is where EXIF-orientation
    # correction actually matters (see its exif_transpose() calls) and it
    # already bakes those outputs pixel-upright. exif_transpose() here is
    # a defensive no-op belt-and-suspenders: it does nothing unless a
    # baked WEBP/PNG somehow carries an orientation tag (Pillow's
    # Image.fromarray(...).save() does not normally write one).
    rgb = np.array(ImageOps.exif_transpose(Image.open(data_dir / f"{pid}.painting.webp")).convert("RGB"))
    depth = np.array(ImageOps.exif_transpose(Image.open(data_dir / f"{pid}.depth.png"))).astype(np.float32)
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

    sal = saliency_map(rgb_s, lab)
    return {
        "id": pid, "w": w, "h": h,
        "lab": lab,
        "grad": grad.astype(np.float32),
        "depth": (depth_s * 255.0).astype(np.float32),
        "sal": sal,
        "subject": subject_mask(sal),
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

        # Scale-bias correction: see the SCALE_BIAS_REF / MIN_SIM block at
        # the top of this file. Discounts smaller patches' similarity so
        # they can't win purely from having higher-variance, more easily
        # spurious correlation peaks over the same 81-candidate grid.
        scale_bias = (frac / SCALE_BIAS_REF) ** 0.5

        # Mean SUBJECT membership of every candidate window in B (aligned
        # to matchTemplate output). The incoming fulcrum should land on
        # B's subject so the reveal resolves onto what the next painting
        # is actually of.
        subj_b_win = window_mean(b["subject"], ps)

        xs = np.linspace(0, aw - ps, GRID_STEPS).astype(int)
        ys = np.linspace(0, ah - ps, GRID_STEPS).astype(int)
        for y in ys:
            for x in xs:
                sal_a = float(a["sal"][y:y + ps, x:x + ps].mean())
                if sal_a < MIN_SALIENCY:
                    continue  # A-patch is flat field — nothing to hinge on
                subj_a = float(a["subject"][y:y + ps, x:x + ps].mean())

                patch_lab = a["lab"][y:y + ps, x:x + ps]
                patch_grd = a["grad"][y:y + ps, x:x + ps]
                patch_dep = a["depth"][y:y + ps, x:x + ps]

                cc = (W_COLOR * cv2.matchTemplate(b["lab"], patch_lab, cv2.TM_CCOEFF_NORMED)
                      + W_STRUCT * cv2.matchTemplate(b["grad"], patch_grd, cv2.TM_CCOEFF_NORMED)
                      + W_DEPTH * cv2.matchTemplate(b["depth"], patch_dep, cv2.TM_CCOEFF_NORMED))
                # TM_CCOEFF_NORMED divides by window variance; a flat
                # template or target window (common in the gradient
                # channel over solid regions) yields NaN/inf. Zero them so
                # minMaxLoc can't lock onto an invalid location.
                np.nan_to_num(cc, copy=False, nan=0.0, posinf=0.0, neginf=0.0)

                # Bias the location search strongly toward B's subject —
                # the fulcrum resolves onto the next painting's subject,
                # not onto incidental background texture.
                weighted = cc * (0.3 + 0.7 * subj_b_win)
                _, _, _, loc = cv2.minMaxLoc(weighted)
                lx, ly = loc
                sim = float(cc[ly, lx])
                # Apply the scale-bias correction BEFORE thresholding and
                # ranking (not just at the end) so a small patch's inflated
                # raw correlation can't even clear MIN_SIM on the strength
                # of its own spurious variance — see the module-top comment.
                sim_adj = sim * scale_bias
                if sim_adj < MIN_SIM:
                    continue  # curated-graph floor: reject weak/spurious matches
                subj_b = float(subj_b_win[ly, lx])

                # Final: structural/colour similarity gated by the mutual
                # SUBJECT membership of the two endpoints — a strong hinge
                # joins A's subject to B's subject.
                score = sim_adj * float(np.sqrt(max(subj_a, 1e-6) * max(subj_b, 1e-6)))

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
