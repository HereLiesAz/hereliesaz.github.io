#!/usr/bin/env python3
"""
theater_baker.py — Paper-theater layer + color-blotch baker.

Decomposes each input image into N flat depth layers (the "paper theater"
metaphor) and color-matched blotches per layer, emitting one JSON per
painting in the schema declared by docs/AESTHETIC.md §8.4.

This is a *prototype*. It writes:

    {
      "id":      "<basename>",
      "src":     { "image": "<filename>", "width": W, "height": H },
      "layers":  [ { "z", "blotches": [...], "strokes": [] }, ... ],
      "accents": { "swatches": [...], "weights": [...] },
      "fulcrum": { "z": 0, "fov": 35 }
    }

Blotch shape ids all reference "blob_default" until a real library exists.
Stroke arrays are empty in v1.

Usage:
    python scripts/theater_baker.py \\
        --input  public/assets/ \\
        --output public/data/theater/ \\
        [--layers 5] [--max-side 1024] [--force]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np


# ---- tuning knobs -----------------------------------------------------------

DEFAULT_K_LAYERS       = 5       # paper-theater recommended 3–7 (AESTHETIC §8.1)
DEFAULT_MAX_SIDE       = 1024    # resize source for kmeans speed
MIN_AREA_FRAC          = 0.0008  # ignore connected components smaller than this
MAX_BLOTCHES_PER_LAYER = 64      # cap per layer
MORPH_KERNEL_PX        = 3
ACCENT_SAT_FLOOR       = 0.18    # below this, painting is treated as desaturated
ACCENT_COUNT           = 2

# Stroke extraction (AESTHETIC §3, §8.3). Strokes trace the contours of each
# layer's mask — white ink that draws light onto the black field.
MAX_STROKES_PER_LAYER  = 24
STROKE_MIN_LEN_FRAC    = 0.05    # contour perimeter ÷ image diagonal
STROKE_APPROX_FRAC     = 0.005   # douglas–peucker epsilon ÷ perimeter
STROKE_MIN_VERTS       = 4
STROKE_MAX_VERTS       = 32
STROKE_JITTER_FRAC     = 0.0035  # ÷ image diagonal, paper-feel wobble

# Library references (AESTHETIC §8.2, §8.3) — recurring shapes the renderer
# resolves against an asset bank instead of carrying inline geometry. Both
# libraries are *small* and *finite*; the spec wants the same shape to recur
# across paintings.
BLOTCH_SHAPE_COUNT     = 12      # blob_00 .. blob_11 (renderer maps id → SDF wobble)
STAMP_COUNT            = 12      # stamp_00 .. stamp_11 (see public/data/theater/stroke_library.json)
HATCH_BLOTCH_MIN_SCALE = 0.04    # blotches below this are too small to hatch
HATCH_PER_BLOTCH       = 2       # stamps stamped per qualifying blotch
HATCH_SCALE_FRAC       = 0.85    # stamp scale ÷ blotch scale

Z_FRONT                = 0.0
Z_BACK                 = -240.0  # darkest layer sits this far behind front
FULCRUM                = {"z": 0, "fov": 35}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


# ---- image i/o --------------------------------------------------------------

def load_image_rgb(path: Path, max_side: int) -> tuple[np.ndarray, int, int]:
    """Load BGR via OpenCV, convert to RGB, resize so max(w,h) <= max_side."""
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError(f"cv2 cannot read {path}")
    h0, w0 = bgr.shape[:2]
    scale = min(1.0, max_side / max(h0, w0))
    if scale < 1.0:
        bgr = cv2.resize(bgr, (int(round(w0 * scale)), int(round(h0 * scale))),
                         interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return rgb, w0, h0


# ---- color clustering -------------------------------------------------------

def kmeans_palette(rgb: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Return (labels HxW int32, centers Kx3 uint8) sorted darkest→lightest."""
    h, w = rgb.shape[:2]
    samples = rgb.reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _compactness, labels, centers = cv2.kmeans(
        samples, k, None, criteria, attempts=4, flags=cv2.KMEANS_PP_CENTERS,
    )
    labels  = labels.reshape(h, w).astype(np.int32)
    centers = np.clip(centers, 0, 255).astype(np.uint8)

    # Sort clusters darkest → lightest (BT.709 luminance).
    lum = (0.2126 * centers[:, 0] +
           0.7152 * centers[:, 1] +
           0.0722 * centers[:, 2])
    order = np.argsort(lum)
    remap = np.zeros(k, dtype=np.int32)
    remap[order] = np.arange(k)
    labels  = remap[labels]
    centers = centers[order]
    return labels, centers


# ---- blotch extraction ------------------------------------------------------

def find_blotches(mask: np.ndarray, min_area_px: int, max_count: int) -> list[dict]:
    """Connected components → normalized blotch placements on this layer."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                       (MORPH_KERNEL_PX, MORPH_KERNEL_PX))
    cleaned = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    n, _labels, stats, centroids = cv2.connectedComponentsWithStats(cleaned, 8)
    h, w = mask.shape
    diag = float(np.hypot(w, h))

    components = []
    for i in range(1, n):  # skip background label 0
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < min_area_px:
            continue
        cx, cy = centroids[i]
        # Map pixel coords → centered, y-up, [-1, 1] on the longer axis.
        nx = (2.0 * cx / w) - 1.0
        ny = 1.0 - (2.0 * cy / h)
        scale = float(np.sqrt(area) / diag)
        # Deterministic library shape id from position — keeps the same
        # blotch reading the same way across re-bakes, but spreads shapes
        # so a painting doesn't read as one repeated silhouette.
        shape_id = abs(hash(("blob", round(nx, 3), round(ny, 3), round(scale, 3))))
        shape_idx = shape_id % BLOTCH_SHAPE_COUNT
        components.append({
            "shape": f"blob_{shape_idx:02d}",
            "x":     round(nx,    4),
            "y":     round(ny,    4),
            "scale": round(scale, 4),
            "rot":   0.0,
            "_area": area,
        })

    components.sort(key=lambda c: -c["_area"])
    components = components[:max_count]
    for c in components:
        del c["_area"]
    return components


def hatch_blotches(blotches: list[dict], rng: np.random.Generator) -> list[dict]:
    """For each large enough blotch, stamp HATCH_PER_BLOTCH library strokes
    on top — short scribble marks the renderer expands from the stamp
    library at draw time. Spec §3 hatch + §8.3 recurring stamps."""
    out = []
    for b in blotches:
        if b["scale"] < HATCH_BLOTCH_MIN_SCALE:
            continue
        for k in range(HATCH_PER_BLOTCH):
            seed = abs(hash(("hatch", b["x"], b["y"], k)))
            stamp_idx = seed % STAMP_COUNT
            # Slight offset within the blotch so multiple stamps don't overlap.
            jitter_r = b["scale"] * 0.35
            theta    = float(rng.uniform(0, 2 * np.pi))
            out.append({
                "path":  f"stamp_{stamp_idx:02d}",
                "x":     round(b["x"] + jitter_r * float(np.cos(theta)), 4),
                "y":     round(b["y"] + jitter_r * float(np.sin(theta)), 4),
                "scale": round(b["scale"] * HATCH_SCALE_FRAC, 4),
                "rot":   round(float(rng.uniform(0, 2 * np.pi)), 4),
                "weight": 0.4,
            })
    return out


# ---- stroke extraction ------------------------------------------------------

def _densify_polyline(pts: np.ndarray, min_verts: int, max_verts: int) -> np.ndarray:
    """Resample a Nx2 polyline to a vertex count in [min_verts, max_verts]."""
    n = len(pts)
    if n >= min_verts and n <= max_verts:
        return pts
    # Cumulative arc length, sample uniformly.
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    if seg.sum() == 0:
        return pts
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    target = np.clip(n, min_verts, max_verts)
    s = np.linspace(0.0, arc[-1], target)
    x = np.interp(s, arc, pts[:, 0])
    y = np.interp(s, arc, pts[:, 1])
    return np.stack([x, y], axis=1)


def find_strokes(mask: np.ndarray, image_diag: float, rng: np.random.Generator) -> list[dict]:
    """Trace contours of the cleaned mask → jittered polylines (AESTHETIC §3)."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                       (MORPH_KERNEL_PX, MORPH_KERNEL_PX))
    cleaned = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    h, w = mask.shape
    min_len_px = STROKE_MIN_LEN_FRAC * image_diag

    candidates = []
    for c in contours:
        if len(c) < 3:
            continue
        perim = float(cv2.arcLength(c, closed=False))
        if perim < min_len_px:
            continue
        epsilon = max(1.0, STROKE_APPROX_FRAC * perim)
        approx = cv2.approxPolyDP(c, epsilon, closed=False)
        pts = approx[:, 0, :].astype(np.float32)
        pts = _densify_polyline(pts, STROKE_MIN_VERTS, STROKE_MAX_VERTS)
        if len(pts) < STROKE_MIN_VERTS:
            continue
        candidates.append((perim, pts))

    candidates.sort(key=lambda x: -x[0])
    candidates = candidates[:MAX_STROKES_PER_LAYER]

    jitter = STROKE_JITTER_FRAC * image_diag
    strokes = []
    for perim, pts in candidates:
        pts = pts + rng.normal(scale=jitter, size=pts.shape).astype(np.float32)
        # Map pixel → normalized centered y-up, like blotches.
        nx = (2.0 * pts[:, 0] / w) - 1.0
        ny = 1.0 - (2.0 * pts[:, 1] / h)
        norm = np.stack([nx, ny], axis=1)
        # Round to 4 decimals to keep JSON small.
        norm = np.round(norm, 4)
        strokes.append({
            "points": norm.tolist(),
            "weight": round(float(min(1.0, perim / image_diag)), 3),
        })
    return strokes


# ---- accents ----------------------------------------------------------------

def pick_accents(centers: np.ndarray, weights: np.ndarray) -> dict | None:
    """Return swatches + weights, or None for desaturated paintings."""
    hsv = cv2.cvtColor(centers.reshape(1, -1, 3), cv2.COLOR_RGB2HSV).reshape(-1, 3)
    sat = hsv[:, 1].astype(np.float32) / 255.0
    if float(sat.max()) < ACCENT_SAT_FLOOR:
        return None
    order = np.argsort(-sat)[:ACCENT_COUNT]
    return {
        "swatches": [_hex(centers[i]) for i in order],
        "weights":  [round(float(weights[i]), 4) for i in order],
    }


def _hex(rgb: np.ndarray) -> str:
    return "#{:02x}{:02x}{:02x}".format(int(rgb[0]), int(rgb[1]), int(rgb[2]))


# ---- per-image bake ---------------------------------------------------------

def bake_image(path: Path, k: int, max_side: int) -> dict:
    rgb, w_src, h_src = load_image_rgb(path, max_side)
    h, w = rgb.shape[:2]
    diag = float(np.hypot(w, h))

    labels, centers = kmeans_palette(rgb, k)

    total_px    = h * w
    min_area_px = max(8, int(MIN_AREA_FRAC * total_px))

    cluster_pix_count = np.bincount(labels.ravel(), minlength=k)
    cluster_weight    = cluster_pix_count.astype(np.float32) / total_px

    # Spread depth linearly: darkest (cluster 0) at back, lightest (k-1) at front.
    if k > 1:
        zs = np.linspace(Z_BACK, Z_FRONT, num=k)
    else:
        zs = np.array([Z_FRONT])

    # Deterministic jitter per painting so re-bakes don't churn the output.
    rng = np.random.default_rng(abs(hash(path.stem)) & 0xFFFFFFFF)

    layers = []
    for ci in range(k):
        mask = (labels == ci).astype(np.uint8) * 255
        blotches = find_blotches(mask, min_area_px, MAX_BLOTCHES_PER_LAYER)
        if not blotches:
            continue
        color_hex = _hex(centers[ci])
        for b in blotches:
            b["color"] = color_hex
        # Strokes for this layer are: contour traces (inline polylines) +
        # library hatch stamps stamped on top of large blotches. Renderer
        # handles both forms in the same array.
        strokes = find_strokes(mask, diag, rng) + hatch_blotches(blotches, rng)
        layers.append({
            "z":        round(float(zs[ci]), 2),
            "weight":   round(float(cluster_weight[ci]), 4),
            "blotches": blotches,
            "strokes":  strokes,
        })

    accents = pick_accents(centers, cluster_weight)

    out = {
        "id":      path.stem,
        "src":     {"image": path.name, "width": w_src, "height": h_src},
        "layers":  layers,
        "fulcrum": dict(FULCRUM),
    }
    if accents is not None:
        out["accents"] = accents
    return out


# ---- driver -----------------------------------------------------------------

def iter_images(root: Path):
    for p in sorted(root.iterdir()):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            yield p


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input",  type=Path, required=True, help="dir of source images")
    ap.add_argument("--output", type=Path, required=True, help="dir for baked json")
    ap.add_argument("--layers", type=int, default=DEFAULT_K_LAYERS,
                    help=f"depth layers per painting (default {DEFAULT_K_LAYERS}, AESTHETIC §8.1 says 3–7)")
    ap.add_argument("--max-side", type=int, default=DEFAULT_MAX_SIDE,
                    help="resize source so max(w,h) <= this before clustering")
    ap.add_argument("--force", action="store_true",
                    help="rebake images that already have output json")
    ap.add_argument("--limit", type=int, default=None,
                    help="bake at most this many images (debug)")
    args = ap.parse_args(argv)

    if not (3 <= args.layers <= 7):
        print(f"[!] --layers {args.layers} outside 3–7; AESTHETIC §8.1.", file=sys.stderr)

    args.input  = args.input.resolve()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)

    if not args.input.is_dir():
        print(f"[!] input dir not found: {args.input}", file=sys.stderr)
        return 2

    images = list(iter_images(args.input))
    if args.limit is not None:
        images = images[: args.limit]
    if not images:
        print(f"[!] no images in {args.input}", file=sys.stderr)
        return 1

    baked = skipped = failed = 0
    for path in images:
        out_path = args.output / f"{path.stem}.theater.json"
        if out_path.exists() and not args.force:
            skipped += 1
            continue
        try:
            data = bake_image(path, k=args.layers, max_side=args.max_side)
        except Exception as e:
            print(f"[x] {path.name}: {e}", file=sys.stderr)
            failed += 1
            continue
        out_path.write_text(json.dumps(data, separators=(",", ":")))
        baked += 1
        print(f"[+] {path.name} -> {out_path.name} "
              f"({len(data['layers'])} layers, "
              f"{sum(len(L['blotches']) for L in data['layers'])} blotches)")

    write_manifest(args.output)
    print(f"\nbaked={baked} skipped={skipped} failed={failed} total={len(images)}")
    return 0 if failed == 0 else 1


def write_manifest(out_dir: Path) -> None:
    """Emit _manifest.json listing every painting id with theater data on disk.

    Skips aggregate files that share the *.theater.json suffix
    (graph.theater.json from the pareidolia indexer) and underscore-prefixed
    siblings — only per-painting bakes belong in the manifest.
    """
    ids = []
    for p in sorted(out_dir.glob("*.theater.json")):
        if p.name == "graph.theater.json" or p.name.startswith("_"):
            continue
        ids.append(p.stem.removesuffix(".theater"))
    (out_dir / "_manifest.json").write_text(json.dumps(ids))
    print(f"[m] {len(ids)} ids -> {out_dir / '_manifest.json'}")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
