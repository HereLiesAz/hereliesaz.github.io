#!/usr/bin/env python3
"""
theater_baker.py — three-axis multilayer baker.

For each input image:

  1. Crop to the painted region (saturation-based contour for mural photos,
     pass-through for studio scans).
  2. Resize to a working long-edge.
  3. Call the Depth-Anything-V2 HF Space for a depth map (off-device).
  4. Slice into THREE sets of 10 layers each, dynamic per painting:
       - depth bands     (quantiles of the depth map)
       - color clusters  (k-means K=10 in RGB)
       - luminance bands (quantiles of BT.709 luminance)
  5. Pack the layer assignments into a single RGB mask image (R=depth idx,
     G=colour idx, B=luminance idx, all 0..9 stored ×25 for legibility).

Output per painting under {output}/:
  {id}.painting.webp   - the cropped painting RGB the renderer textures with
  {id}.masks.png       - 3-channel layer-id encoding (R, G, B each 0..225)
  {id}.theater.json    - palette swatches, depth/luminance band edges, accents

Plus once per run:
  _manifest.json       - list of painted ids ready for the renderer

Env:
  HF_TOKEN  - Hugging Face access token; loaded from .env.local at the
              project root if present.

Usage:
  /tmp/pw-venv/bin/python scripts/theater_baker.py \\
      --input  public/assets/ \\
      --output public/data/theater/ \\
      [--limit N] [--force] [--max-side 768]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFile

# Some of the source photos are slightly truncated; opening them tolerantly
# avoids derailing a corpus bake over one bad byte.
ImageFile.LOAD_TRUNCATED_IMAGES = True


# ---- tuning knobs -----------------------------------------------------------

DEFAULT_MAX_SIDE = 768                     # depth Space caps at ~768 long edge
N_DEPTH          = 10
N_COLOR          = 10
N_LUM            = 10
ACCENT_SAT_FLOOR = 0.18                    # painting reads as desaturated below this
ACCENT_COUNT     = 2

DEPTH_SPACE_ID   = "depth-anything/Depth-Anything-V2"
DEPTH_API_NAME   = "/on_submit"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


# ---- env --------------------------------------------------------------------

def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


# ---- crop --------------------------------------------------------------------

def crop_to_art(rgb: np.ndarray) -> np.ndarray:
    """Heuristic mural-vs-studio-scan crop.

    If the image's outer 10 % border is dramatically less saturated than its
    centre, treat the border as wall / floor / sidewalk and crop to the
    saturated rectangle that contains the painting. Otherwise return the
    image unchanged (studio scans of paintings on neutral backgrounds also
    fall through this).
    """
    h, w = rgb.shape[:2]
    if min(h, w) < 50:
        return rgb

    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    sat = hsv[:, :, 1].astype(np.float32) / 255.0

    border_pct = 0.08
    bh = max(1, int(h * border_pct))
    bw = max(1, int(w * border_pct))
    border_sat = np.concatenate([
        sat[:bh, :].ravel(),
        sat[-bh:, :].ravel(),
        sat[:, :bw].ravel(),
        sat[:, -bw:].ravel(),
    ])
    centre_sat = sat[bh:-bh, bw:-bw]
    if centre_sat.size == 0:
        return rgb

    if (centre_sat.mean() - border_sat.mean()) < 0.06:
        # No clear painting / surround contrast — let it pass.
        return rgb

    # Threshold against the border mean + a margin; pick the largest
    # rectangular bbox of high-saturation pixels.
    thresh = max(border_sat.mean() + 0.05, 0.12)
    mask = (sat > thresh).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return rgb
    best = max(contours, key=cv2.contourArea)
    if cv2.contourArea(best) < 0.25 * h * w:
        return rgb
    x, y, ww, hh = cv2.boundingRect(best)
    # Pad slightly so the crop doesn't shave the painting's edge.
    pad = max(int(min(ww, hh) * 0.02), 4)
    x = max(0, x - pad); y = max(0, y - pad)
    ww = min(w - x, ww + 2 * pad); hh = min(h - y, hh + 2 * pad)
    return rgb[y:y + hh, x:x + ww]


# ---- depth ------------------------------------------------------------------

_depth_client = None

def get_depth_client():
    global _depth_client
    if _depth_client is not None:
        return _depth_client
    from gradio_client import Client
    token = os.environ.get("HF_TOKEN") or None
    _depth_client = Client(DEPTH_SPACE_ID, token=token, verbose=False)
    return _depth_client


def estimate_depth(rgb: np.ndarray) -> np.ndarray:
    """Run the off-device depth model on `rgb` (HxWx3 uint8). Returns an
    HxW float32 depth map normalised to [0, 1] (higher = closer)."""
    from gradio_client import handle_file
    # The Space expects a file path; round-trip via /tmp.
    pil = Image.fromarray(rgb)
    tmp = Path("/tmp/_theater_depth_in.jpg")
    pil.save(tmp, "JPEG", quality=88)

    client = get_depth_client()
    # Retry once on transient HF/Space errors (queue, cold-start).
    last_exc = None
    for attempt in range(2):
        try:
            result = client.predict(image=handle_file(str(tmp)), api_name=DEPTH_API_NAME)
            break
        except Exception as e:
            last_exc = e
            time.sleep(2.0)
    else:
        raise RuntimeError(f"depth Space failed twice: {last_exc!r}")

    # Result is (slider_pair_list, 8bit_depth_png_path, 16bit_depth_png_path).
    depth_16_path = result[2]
    depth_im = Image.open(depth_16_path)
    arr = np.array(depth_im).astype(np.float32)
    # Resize to match input.
    if arr.shape[:2] != rgb.shape[:2]:
        arr = cv2.resize(arr, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
    mn, mx = float(arr.min()), float(arr.max())
    if mx - mn < 1e-6:
        return np.zeros_like(arr)
    return (arr - mn) / (mx - mn)


# ---- layer extraction -------------------------------------------------------

def quantile_bands(values: np.ndarray, n: int) -> tuple[np.ndarray, list[float]]:
    """Assign each pixel of `values` (any shape) to one of `n` bands by
    quantile, returning (band_index HxW uint8, band-edge list of len n+1)."""
    flat = values.ravel()
    edges = np.quantile(flat, np.linspace(0, 1, n + 1))
    # Make edges strictly increasing for digitize.
    for i in range(1, len(edges)):
        if edges[i] <= edges[i - 1]:
            edges[i] = edges[i - 1] + 1e-6
    idx = np.digitize(values, edges[1:-1], right=False).astype(np.uint8)
    return idx, [round(float(e), 6) for e in edges]


def color_clusters(rgb: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """k-means clustering on RGB. Returns (labels HxW uint8, centers Kx3 uint8)
    sorted darkest→lightest (BT.709 luminance)."""
    h, w = rgb.shape[:2]
    samples = rgb.reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(
        samples, k, None, criteria, attempts=4, flags=cv2.KMEANS_PP_CENTERS,
    )
    labels = labels.reshape(h, w).astype(np.int32)
    centers = np.clip(centers, 0, 255).astype(np.uint8)
    lum = 0.2126 * centers[:, 0] + 0.7152 * centers[:, 1] + 0.0722 * centers[:, 2]
    order = np.argsort(lum)
    remap = np.zeros(k, dtype=np.int32)
    remap[order] = np.arange(k)
    return remap[labels].astype(np.uint8), centers[order]


def luminance(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def pick_accents(centers: np.ndarray) -> dict | None:
    hsv = cv2.cvtColor(centers.reshape(1, -1, 3), cv2.COLOR_RGB2HSV).reshape(-1, 3)
    sat = hsv[:, 1].astype(np.float32) / 255.0
    if float(sat.max()) < ACCENT_SAT_FLOOR:
        return None
    order = np.argsort(-sat)[:ACCENT_COUNT]
    return {
        "swatches": [_hex(centers[i]) for i in order],
    }


def _hex(rgb: np.ndarray) -> str:
    return "#{:02x}{:02x}{:02x}".format(int(rgb[0]), int(rgb[1]), int(rgb[2]))


# ---- per-image bake ---------------------------------------------------------

def bake_image(path: Path, out_dir: Path, max_side: int) -> dict:
    pil = Image.open(path).convert("RGB")
    rgb = np.array(pil)
    rgb = crop_to_art(rgb)

    h, w = rgb.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        rgb = cv2.resize(rgb, (int(round(w * scale)), int(round(h * scale))),
                         interpolation=cv2.INTER_AREA)
        h, w = rgb.shape[:2]

    depth = estimate_depth(rgb)                           # 0..1, higher = closer
    depth_idx, depth_edges = quantile_bands(depth, N_DEPTH)
    lum_idx, lum_edges     = quantile_bands(luminance(rgb), N_LUM)
    color_idx, color_centers = color_clusters(rgb, N_COLOR)

    # Pack the three index channels into one RGB mask image. Stored ×25 so
    # the bands stay visible if anyone opens the PNG to debug; the renderer
    # divides by 25 to recover the raw 0..9 index.
    masks = np.stack([depth_idx, color_idx, lum_idx], axis=-1) * 25
    masks_img = Image.fromarray(masks.astype(np.uint8), mode="RGB")

    pid = path.stem
    out_painting = out_dir / f"{pid}.painting.webp"
    out_masks    = out_dir / f"{pid}.masks.png"
    out_json     = out_dir / f"{pid}.theater.json"

    Image.fromarray(rgb).save(out_painting, "WEBP", quality=88, method=6)
    masks_img.save(out_masks, "PNG", optimize=True)

    accents = pick_accents(color_centers)
    meta = {
        "id":     pid,
        "src":    {"image": path.name, "width": w, "height": h},
        "layers": {
            "depth":     {"count": N_DEPTH, "edges": depth_edges},
            "color":     {"count": N_COLOR, "swatches": [_hex(c) for c in color_centers]},
            "luminance": {"count": N_LUM, "edges": lum_edges},
        },
    }
    if accents is not None:
        meta["accents"] = accents
    out_json.write_text(json.dumps(meta, separators=(",", ":")))
    return meta


# ---- driver -----------------------------------------------------------------

def iter_images(root: Path):
    for p in sorted(root.iterdir()):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            yield p


def write_manifest(out_dir: Path) -> None:
    """An id is bakeable only if all three companion files are present —
    painting webp, masks png, and theater json. This keeps the manifest
    from listing half-baked or legacy entries."""
    ids = []
    for p in sorted(out_dir.glob("*.theater.json")):
        if p.name.startswith("_") or p.name == "graph.theater.json":
            continue
        pid = p.stem.removesuffix(".theater")
        if (out_dir / f"{pid}.painting.webp").exists() and (out_dir / f"{pid}.masks.png").exists():
            ids.append(pid)
    (out_dir / "_manifest.json").write_text(json.dumps(ids))
    print(f"[m] {len(ids)} ids -> {out_dir / '_manifest.json'}")


def main(argv: list[str]) -> int:
    load_dotenv(Path(".env.local"))
    if not os.environ.get("HF_TOKEN"):
        print("[!] HF_TOKEN not set (looked at .env.local). The depth Space is "
              "public so it'll still work, but auth is recommended.",
              file=sys.stderr)

    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input",  type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--max-side", type=int, default=DEFAULT_MAX_SIDE)
    ap.add_argument("--limit",  type=int, default=None)
    ap.add_argument("--force",  action="store_true",
                    help="rebake images that already have output json")
    args = ap.parse_args(argv)

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
        out_json = args.output / f"{path.stem}.theater.json"
        if out_json.exists() and not args.force:
            skipped += 1
            continue
        try:
            data = bake_image(path, args.output, args.max_side)
        except Exception as e:
            print(f"[x] {path.name}: {type(e).__name__}: {e}", file=sys.stderr)
            failed += 1
            continue
        baked += 1
        print(f"[+] {path.name} -> {data['id']} ({N_DEPTH}+{N_COLOR}+{N_LUM} layers)")

    write_manifest(args.output)
    print(f"\nbaked={baked} skipped={skipped} failed={failed} total={len(images)}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
