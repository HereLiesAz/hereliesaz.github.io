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
        components.append({
            "shape": "blob_default",
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

    layers = []
    for ci in range(k):
        mask = (labels == ci).astype(np.uint8) * 255
        blotches = find_blotches(mask, min_area_px, MAX_BLOTCHES_PER_LAYER)
        if not blotches:
            continue
        color_hex = _hex(centers[ci])
        for b in blotches:
            b["color"] = color_hex
        layers.append({
            "z":        round(float(zs[ci]), 2),
            "weight":   round(float(cluster_weight[ci]), 4),
            "blotches": blotches,
            "strokes":  [],
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
    """Emit _manifest.json listing every painting id with theater data on disk."""
    ids = sorted(p.stem.removesuffix(".theater") for p in out_dir.glob("*.theater.json"))
    (out_dir / "_manifest.json").write_text(json.dumps(ids))
    print(f"[m] {len(ids)} ids -> {out_dir / '_manifest.json'}")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
