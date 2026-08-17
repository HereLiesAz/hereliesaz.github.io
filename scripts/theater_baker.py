#!/usr/bin/env python3
"""
theater_baker.py — painting + depth-map baker (schema 2).

CI note: .github/workflows/process_art.yml invokes this with an explicit
--ids allowlist; widening that list is a cost decision, not a code change.

The paper-theater data model is exactly two textures per painting plus a
small metadata file. The renderer builds the diorama at runtime from the
depth texture alone: a dense stack of cutout flats (no separate backdrop
plane — see TheaterPainting.jsx), each showing only the pixels inside its
depth band.

Per input image the bake runs four cacheable stages — each stage is
skipped when its output already exists (use --force to redo), so the
expensive off-device calls run once and iteration on slicing/rendering
is fully offline:

  A. crop      Crop to the painted region and resize to the working
               long-edge.                     -> {id}.painting.webp
  B. photo     Convert the painting into a photorealistic rendering of
               the same scene (img2img, composition preserved). Depth
               models are photo-trained and flatten stylised paintings;
               depth estimated from the photo is far better than depth
               estimated from the painting.   -> {id}.photo.png
  C. depth     Monocular depth (Depth-Anything-V2) on the PHOTO, applied
               back to the original painting (the photo shares the
               painting's composition, so the map aligns 1:1).
                                              -> {id}.depth.png (16-bit)
  D. meta      k-means the depth histogram into N_BANDS bands (see the
               constant below), merged down where too thin/sparse, whose
               edges snap to objects rather than quantiles.
                                              -> {id}.theater.json

Depth provenance is recorded in theater.json as depth.source:
  "photo+depth-anything-v2"  the full chain (the intended result)
  "depth-anything-v2"        depth run on the painting directly
  "synthetic"                gradient+saturation stand-in (emergency
                             only — re-bake with network access)

Plus once per run:
  _manifest.json     list of ids with painting + depth + json present

Env:
  HF_TOKEN  - Hugging Face access token; loaded from .env.local at the
              project root if present. Needed for stage B (img2img) and
              recommended for stage C (depth Space quota).

Usage:
  python3 scripts/theater_baker.py \\
      --input  public/assets/ \\
      --output public/data/theater/ \\
      [--ids id1,id2,...] [--force] [--max-side 768] [--limit N]
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFile, ImageOps

# Some of the source photos are slightly truncated; opening them tolerantly
# avoids derailing a bake over one bad byte.
ImageFile.LOAD_TRUNCATED_IMAGES = True

# Register the HEIF/HEIC opener so PIL can read iPhone .HEIC source photos.
# Without this, Image.open() throws UnidentifiedImageError on .HEIC and the
# painting is silently skipped (it never reaches the bake).
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception as _heif_exc:  # pragma: no cover - environment dependent
    print(f"[~] pillow_heif unavailable ({_heif_exc!r}); .HEIC sources will be skipped",
          file=sys.stderr)


# Hand-authored per-image crop boxes that isolate the artwork from its
# wall / floor / room. Keyed by image id; each value is a normalized
# [x0, y0, x1, y1] box, or null to keep the whole image. Ids with no entry
# fall back to the crop_to_art heuristic. Lives beside this script so the CI
# bake reads it straight from the checkout.
_CROPS_PATH = Path(__file__).resolve().parent / "crops.json"
try:
    MANUAL_CROPS = json.loads(_CROPS_PATH.read_text()) if _CROPS_PATH.exists() else {}
except Exception as _crop_exc:  # pragma: no cover - environment dependent
    print(f"[~] could not read {_CROPS_PATH.name} ({_crop_exc!r}); heuristic crop only",
          file=sys.stderr)
    MANUAL_CROPS = {}


def crop_directive(pid: str):
    """The crop directive for `pid`: a normalized box list, None (keep the
    whole image), or the string 'heuristic' when there is no hand entry."""
    return MANUAL_CROPS[pid] if pid in MANUAL_CROPS else "heuristic"


def apply_crop(rgb: np.ndarray, pid: str) -> tuple[np.ndarray, bool]:
    """Crop `rgb` to just the artwork: the hand-authored box when present,
    else the saturation/structure heuristic; None means keep the whole.

    Returns (result, box_applied). box_applied is False only in the one
    case where a hand-authored box from crops.json rounds to an empty
    region at this image's actual pixel dimensions — the caller must NOT
    then record that box in metadata as if it had been applied, since the
    pixels returned are the untouched full frame."""
    box = crop_directive(pid)
    if box == "heuristic":
        return crop_to_art(rgb), True
    if box is None:
        return rgb, True
    h, w = rgb.shape[:2]
    x0, y0, x1, y1 = box
    x0i, x1i = max(0, min(int(round(x0 * w)), w - 1)), max(1, min(int(round(x1 * w)), w))
    y0i, y1i = max(0, min(int(round(y0 * h)), h - 1)), max(1, min(int(round(y1 * h)), h))
    if x1i <= x0i or y1i <= y0i:
        print(f"[!] {pid}: crop box {box} from crops.json degenerated to an "
              f"empty region after rounding at {w}x{h}; keeping the full "
              f"frame instead of silently applying a box that isn't there",
              file=sys.stderr)
        return rgb, False
    return rgb[y0i:y1i, x0i:x1i], True


# ---- tuning knobs -----------------------------------------------------------

DEFAULT_MAX_SIDE = 768                     # depth Space caps at ~768 long edge
N_BANDS          = 18                      # depth resolution — dense layer stack
MIN_BAND_COVER   = 0.008                   # merge bands under 0.8% of pixels
MIN_BAND_SEP     = 0.025                   # merge bands closer than this in depth
N_COLOR_BANDS    = 8                       # color-cluster layers (dark→light)
ACCENT_SAT_FLOOR = 0.18                    # painting reads as desaturated below this
ACCENT_COUNT     = 2
N_ACCENT_CLUSTERS = 10

# cv2.kmeans() draws its initial centers (even under KMEANS_PP_CENTERS,
# which is still probabilistic) from OpenCV's process-global RNG
# (cv::theRNG()), which is never reseeded between calls. That means the
# depth-band / color-cluster output for a given image's pixels — which
# never change — depends on how many OTHER cv2.kmeans() calls happened
# earlier in the SAME PROCESS, i.e. on batch order/position. Confirmed
# live: with identical input, band-edge output differed measurably
# between "first kmeans call in the process" and "call #8, after 7 prior
# kmeans calls on unrelated images" — see docs/WORKFLOW.md history / PR
# notes for the repro. Since theater_bake.yml always passes --ids, the
# schema-2 skip guard never fires in CI, so every id in a batch re-enters
# this code every run: batch order alone could silently change how many
# depth cutouts a painting renders, even though its pixels never changed.
# Fix: reseed cv2's global RNG to this FIXED constant immediately before
# EVERY cv2.kmeans() call (see KMEANS_SEED usages below), so the result
# depends only on the input pixels, never on prior calls in the process.
KMEANS_SEED = 20260214

DEPTH_SPACE_ID   = "depth-anything/Depth-Anything-V2"
DEPTH_API_NAME   = "/on_submit"

PHOTOREAL_MODEL  = "black-forest-labs/FLUX.1-Kontext-dev"
PHOTOREAL_SPACE  = "mcp-tools/FLUX.1-Kontext-Dev"
PHOTOREAL_API    = "/infer"
PHOTOREAL_PROMPT = (
    "Convert this painting into a realistic photograph of the exact same "
    "scene. Keep the composition, framing, and placement of every element "
    "identical; only make surfaces, lighting, and materials photorealistic."
)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"}


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


# ---- stage B: photorealize ----------------------------------------------------

def align_to(photo: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    """Register `photo` onto `rgb` (the painting). img2img keeps the scene
    but often reframes by a few percent; a Euclidean/affine ECC pass snaps
    the photo back so its depth map applies to the painting pixel-for-pixel.
    Falls back to a plain resize when ECC cannot converge (drastic
    restyle) — the composition is still broadly shared."""
    h, w = rgb.shape[:2]
    photo = cv2.resize(photo, (w, h), interpolation=cv2.INTER_AREA)
    g1 = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    g2 = cv2.cvtColor(photo, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        cv2.findTransformECC(
            g1, g2, warp, cv2.MOTION_AFFINE,
            (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_COUNT, 200, 1e-6),
            None, 5,
        )
        photo = cv2.warpAffine(
            photo, warp, (w, h),
            flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
            borderMode=cv2.BORDER_REPLICATE,
        )
    except cv2.error:
        print("[~] ECC alignment did not converge; using resized photo as-is",
              file=sys.stderr)
    return photo


def photorealize(rgb: np.ndarray, cache_path: Path, force: bool = False) -> np.ndarray | None:
    """Return a photorealistic rendering of the painting, registered to it.

    Cached at cache_path; the network is only touched on a cache miss (or
    when force=True). Tries the HF Inference API when HF_TOKEN is set, then
    the public FLUX.1-Kontext Space anonymously. Returns None when both
    fail — the caller then falls back to estimating depth on the painting
    itself.

    force must be set by the caller whenever `rgb` may no longer match what
    produced the cached file — a crop-box change, or a hand-authored
    --force — since this cache check has no way to know that on its own.
    Without it, a crop edit would silently keep serving photo content
    registered to the OLD crop (merely resized to fit the new one, not
    re-registered), and estimate_depth_local()/estimate_depth() downstream
    would then derive depth from a composition that doesn't match the
    painting.png actually being shipped.
    """
    if cache_path.exists() and not force:
        photo = np.array(ImageOps.exif_transpose(Image.open(cache_path)).convert("RGB"))
        if photo.shape[:2] != rgb.shape[:2]:
            photo = cv2.resize(photo, (rgb.shape[1], rgb.shape[0]),
                               interpolation=cv2.INTER_AREA)
        return photo

    photo = None
    token = os.environ.get("HF_TOKEN")
    if token:
        try:
            from huggingface_hub import InferenceClient
            client = InferenceClient(token=token)
            buf = io.BytesIO()
            Image.fromarray(rgb).save(buf, "PNG")
            out = client.image_to_image(
                buf.getvalue(), prompt=PHOTOREAL_PROMPT, model=PHOTOREAL_MODEL,
            )
            photo = np.array(out.convert("RGB"))
        except Exception as e:
            print(f"[~] photorealize via Inference API failed "
                  f"({type(e).__name__}: {e}); trying the public Space", file=sys.stderr)

    if photo is None:
        try:
            from gradio_client import Client, handle_file
            tmp = Path("/tmp/_theater_photo_in.png")
            Image.fromarray(rgb).save(tmp, "PNG")
            client = Client(PHOTOREAL_SPACE, token=token or None, verbose=False)
            result = client.predict(
                input_image=handle_file(str(tmp)),
                prompt=PHOTOREAL_PROMPT,
                api_name=PHOTOREAL_API,
            )
            out_path = result[0] if isinstance(result, (list, tuple)) else result
            photo = np.array(Image.open(out_path).convert("RGB"))
        except Exception as e:
            print(f"[~] photorealize failed ({type(e).__name__}: {e}); "
                  "estimating depth on the painting directly", file=sys.stderr)
            return None

    photo = align_to(photo, rgb)
    Image.fromarray(photo).save(cache_path, "PNG", optimize=True)
    return photo


# ---- stage C: depth -----------------------------------------------------------

_depth_client = None

def get_depth_client():
    global _depth_client
    if _depth_client is not None:
        return _depth_client
    from gradio_client import Client
    token = os.environ.get("HF_TOKEN") or None
    _depth_client = Client(DEPTH_SPACE_ID, token=token, verbose=False)
    return _depth_client


def synth_depth(rgb: np.ndarray) -> np.ndarray:
    """Cheap stand-in for the monocular depth model: combine a vertical
    gradient (top → far, bottom → near, the wallpaper-of-Western-painting
    convention) with local saturation (saturated patches read as foreground
    against an underpainting). Emergency fallback only — the delivered bake
    must use a real depth map."""
    h, w = rgb.shape[:2]
    grad = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    sat = hsv[:, :, 1].astype(np.float32) / 255.0
    depth = 0.55 * grad + 0.45 * sat
    mn, mx = float(depth.min()), float(depth.max())
    if mx - mn < 1e-6:
        return np.zeros_like(depth)
    return (depth - mn) / (mx - mn)


_depth_pipe = None
_depth_local_disabled = False

def estimate_depth_local(rgb: np.ndarray) -> np.ndarray | None:
    """Depth-Anything-V2 run LOCALLY on CPU via transformers/torch. This
    is the primary depth path: unlike the hosted Space it has no rate
    limit and no shared-quota kill switch, so a batch of paintings all get
    real depth instead of the first few succeeding and the rest silently
    degrading. Returns HxW float32 in [0,1] (higher = closer), or None if
    torch/transformers/the model can't be loaded (then callers fall back
    to the Space, then to synthetic)."""
    global _depth_pipe, _depth_local_disabled
    if _depth_local_disabled:
        return None
    try:
        if _depth_pipe is None:
            from transformers import pipeline
            _depth_pipe = pipeline(
                "depth-estimation",
                model="depth-anything/Depth-Anything-V2-Small-hf",
                device=-1)
        out = _depth_pipe(Image.fromarray(rgb))
        # Depth-Anything predicts disparity (higher = closer), which is
        # exactly our convention. The "depth" PIL is that map, normalised.
        d = np.array(out["depth"]).astype(np.float32)
        if d.ndim == 3:
            d = d[..., 0]
        if d.shape[:2] != rgb.shape[:2]:
            d = cv2.resize(d, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
        mn, mx = float(d.min()), float(d.max())
        if mx - mn < 1e-6:
            return np.zeros_like(d)
        return (d - mn) / (mx - mn)
    except Exception as e:
        print(f"[~] local depth model unavailable "
              f"({type(e).__name__}: {e}); falling back to Space", file=sys.stderr)
        _depth_local_disabled = True
        return None


_depth_disabled = False

def estimate_depth(rgb: np.ndarray) -> np.ndarray | None:
    """Run the off-device depth model on `rgb` (HxWx3 uint8). Returns an
    HxW float32 depth map normalised to [0, 1] (higher = closer), or None
    if the Space is unreachable / out of quota. Once the Space has failed
    once we stop retrying for the rest of the run (quota exhaustion doesn't
    repair itself within a few seconds)."""
    global _depth_disabled
    if _depth_disabled:
        return None

    from gradio_client import handle_file
    # The Space expects a file path; round-trip via /tmp.
    pil = Image.fromarray(rgb)
    tmp = Path("/tmp/_theater_depth_in.jpg")
    pil.save(tmp, "JPEG", quality=88)

    try:
        client = get_depth_client()
    except Exception as e:
        print(f"[~] depth Space init failed ({e!r})", file=sys.stderr)
        _depth_disabled = True
        return None

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
        print(f"[~] depth Space failed ({last_exc!r})", file=sys.stderr)
        _depth_disabled = True
        return None

    # Result is (slider_pair_list, 8bit_depth_png_path, 16bit_depth_png_path).
    depth_16_path = result[2]
    depth_im = ImageOps.exif_transpose(Image.open(depth_16_path))
    arr = np.array(depth_im).astype(np.float32)
    # Resize to match input.
    if arr.shape[:2] != rgb.shape[:2]:
        arr = cv2.resize(arr, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
    mn, mx = float(arr.min()), float(arr.max())
    if mx - mn < 1e-6:
        return np.zeros_like(arr)
    return (arr - mn) / (mx - mn)


def load_depth_png(path: Path, shape: tuple[int, int]) -> np.ndarray:
    """Read a cached {id}.depth.png (8- or 16-bit grayscale) back to a
    float32 [0,1] map aligned to `shape` (h, w)."""
    arr = np.array(ImageOps.exif_transpose(Image.open(path))).astype(np.float32)
    if arr.ndim == 3:
        arr = arr[..., 0]
    if arr.shape != shape:
        arr = cv2.resize(arr, (shape[1], shape[0]), interpolation=cv2.INTER_LINEAR)
    mn, mx = float(arr.min()), float(arr.max())
    if mx - mn < 1e-6:
        return np.zeros_like(arr)
    return (arr - mn) / (mx - mn)


def save_depth_png(depth: np.ndarray, path: Path) -> None:
    d16 = np.clip(depth * 65535.0 + 0.5, 0, 65535).astype(np.uint16)
    Image.fromarray(d16).save(path, "PNG", optimize=True)


# ---- stage D: depth bands -----------------------------------------------------

def depth_bands_kmeans(depth: np.ndarray, k: int = N_BANDS,
                       min_cover: float = MIN_BAND_COVER) -> tuple[list[float], list[float]]:
    """Cluster the depth histogram into up to `k` bands whose boundaries
    snap to plateaus (objects) instead of equal-population quantiles.
    Returns (edges, centers): edges has len(centers)+1 with 0.0 / 1.0 at
    the ends; bands covering under `min_cover` of pixels are merged into
    their nearest neighbour."""
    flat = depth.reshape(-1, 1).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-4)
    cv2.setRNGSeed(KMEANS_SEED)  # see KMEANS_SEED comment: determinism, not batch order
    _, labels, centers = cv2.kmeans(
        flat, k, None, criteria, attempts=4, flags=cv2.KMEANS_PP_CENTERS,
    )
    centers = centers.ravel().astype(np.float64)
    order = np.argsort(centers)
    centers = centers[order]
    counts = np.bincount(labels.ravel(), minlength=k).astype(np.float64)[order]
    cover = counts / max(1.0, counts.sum())

    # Merge (a) undersized bands into whichever neighbour is closer in
    # depth, and (b) neighbouring bands whose centers are so close that
    # k-means merely split one plateau in two. Coverage pools on merge so
    # a chain of slivers can accrete into a real band.
    cs = [float(c) for c in centers]
    cv_ = [float(c) for c in cover]

    def merge(i: int, j: int) -> None:
        wsum = cv_[i] + cv_[j]
        cs[j] = (cs[i] * cv_[i] + cs[j] * cv_[j]) / max(wsum, 1e-9)
        cv_[j] = wsum
        del cs[i], cv_[i]

    changed = True
    while changed and len(cs) > 1:
        changed = False
        gaps = [b - a for a, b in zip(cs, cs[1:])]
        i = int(np.argmin(gaps))
        if gaps[i] < MIN_BAND_SEP:
            merge(i, i + 1)
            changed = True
            continue
        i = int(np.argmin(cv_))
        if cv_[i] < min_cover:
            if i == 0:
                j = 1
            elif i == len(cs) - 1:
                j = i - 1
            else:
                j = i - 1 if (cs[i] - cs[i - 1]) <= (cs[i + 1] - cs[i]) else i + 1
            merge(i, j)
            changed = True

    edges = [0.0]
    for a, b in zip(cs, cs[1:]):
        edges.append(round((a + b) / 2.0, 6))
    edges.append(1.0)
    return edges, [round(c, 6) for c in cs]


# ---- accents ------------------------------------------------------------------

def color_clusters(rgb: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """k-means clustering on RGB. Returns (labels HxW uint8, centers Kx3 uint8)
    sorted darkest→lightest (BT.709 luminance)."""
    h, w = rgb.shape[:2]
    samples = rgb.reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    cv2.setRNGSeed(KMEANS_SEED)  # see KMEANS_SEED comment: determinism, not batch order
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


# ---- per-image bake -----------------------------------------------------------

def bake_image(path: Path, out_dir: Path, max_side: int, force: bool = False) -> dict:
    pid = path.stem
    out_painting = out_dir / f"{pid}.painting.webp"
    out_photo    = out_dir / f"{pid}.photo.png"
    out_depth    = out_dir / f"{pid}.depth.png"
    out_json     = out_dir / f"{pid}.theater.json"

    # -- stage A: crop / resize -------------------------------------------------
    # A hand-authored crop box (crops.json) isolates the artwork from its
    # wall/floor/room. The applied directive is recorded in the theater.json,
    # so a re-bake re-crops (and re-derives the now-misaligned depth) ONLY for
    # ids whose box changed — no blanket --force when a few crops move.
    directive = crop_directive(pid)
    prev_directive = "MISSING"
    crop_note = None  # carried over from a cached bake unless recomputed below
    if out_json.exists():
        try:
            prev_meta = json.loads(out_json.read_text())
            prev_directive = prev_meta.get("crop", "MISSING")
            crop_note = prev_meta.get("crop_note")
        except Exception:
            pass
    crop_changed = prev_directive != directive

    if out_painting.exists() and not force and not crop_changed:
        rgb = np.array(ImageOps.exif_transpose(Image.open(out_painting)).convert("RGB"))
    else:
        # The raw source photo — the one place in the pipeline where a
        # camera-authored EXIF Orientation tag can actually be present.
        # Without correcting it here, a sideways phone photo bakes into a
        # sideways painting, sideways depth map, and (via
        # pareidolia_index.py, which only ever reads OUR baked outputs)
        # garbage hinge patches. exif_transpose() is a no-op when there is
        # no orientation tag, so this is safe for every source.
        rgb = np.array(ImageOps.exif_transpose(Image.open(path)).convert("RGB"))
        rgb, crop_applied = apply_crop(rgb, pid)
        # meta["crop"] below always records the hand-authored DIRECTIVE
        # (needed for the change-detection compare above); crop_note is
        # the separate, honest record of whether that directive actually
        # produced a crop on this image's real pixels, so metadata never
        # implies a crop happened when apply_crop silently fell back to
        # the full frame.
        crop_note = None if crop_applied else (
            f"crop box {directive} degenerated to an empty region after "
            "rounding to pixels; full frame was kept, not this box")
        h, w = rgb.shape[:2]
        scale = min(1.0, max_side / max(h, w))
        if scale < 1.0:
            rgb = cv2.resize(rgb, (int(round(w * scale)), int(round(h * scale))),
                             interpolation=cv2.INTER_AREA)
        Image.fromarray(rgb).save(out_painting, "WEBP", quality=88, method=6)
    h, w = rgb.shape[:2]

    # -- stages B+C: photorealize, then depth ------------------------------------
    # Reuse a cached map only if it was a REAL one. A cached "synthetic"
    # map is the flat emergency stand-in from a failed run; trusting it
    # would permanently freeze a painting as flat, so we redo it now that
    # a reliable local depth model is the primary path.
    depth = None
    source = None
    if out_depth.exists() and not force and not crop_changed:
        # Default to UNTRUSTED ("synthetic") rather than "assume real". A
        # cache hit is only a fast-path when we can actually confirm the
        # cached depth.png came from a real model; any failure to read
        # that confirmation (corrupt/partial JSON, missing keys, or no
        # out_json at all) must fall through to re-deriving depth below,
        # not silently reuse a possibly-synthetic map. Reading the same
        # exception-swallowing "assume real" default that used to live
        # here would defeat the whole point of the cache-staleness check.
        cached_source = "synthetic"
        if out_json.exists():
            try:
                cached_source = json.loads(out_json.read_text())["depth"]["source"]
            except Exception:
                cached_source = "synthetic"
        if cached_source != "synthetic":
            depth = load_depth_png(out_depth, (h, w))
            source = cached_source

    if depth is None:
        # force here covers BOTH a hand-authored --force AND a detected
        # crop change: crop_changed already invalidated the out_painting/
        # out_depth caches above, so `rgb` may be a different composition
        # than whatever produced a stale out_photo — photorealize's own
        # cache check must be told that explicitly (see its docstring).
        photo = photorealize(rgb, out_photo, force=force or crop_changed)
        src_img = photo if photo is not None else rgb
        # Local Depth-Anything first (reliable), Space second, synth last.
        depth = estimate_depth_local(src_img)
        if depth is None:
            depth = estimate_depth(src_img)
        if depth is not None:
            source = "photo+depth-anything-v2" if photo is not None else "depth-anything-v2"
        else:
            depth = synth_depth(rgb)
            source = "synthetic"
        save_depth_png(depth, out_depth)

    # -- stage D: bands + metadata ------------------------------------------------
    edges, centers = depth_bands_kmeans(depth)

    _, color_centers = color_clusters(rgb, N_COLOR_BANDS)
    color_centers_norm = [
        [round(float(c[0]) / 255.0, 4),
         round(float(c[1]) / 255.0, 4),
         round(float(c[2]) / 255.0, 4)]
        for c in color_centers
    ]

    # Accents (for the overlay's per-painting palette flash) still want a
    # richer color set, so re-run k-means at the accent count.
    _, accent_centers = color_clusters(rgb, N_ACCENT_CLUSTERS)
    accents = pick_accents(accent_centers)

    meta = {
        "schema": 2,
        "id":     pid,
        "src":    {"image": path.name, "width": w, "height": h},
        # The crop directive applied in stage A (normalized box, null for
        # keep-whole, or "heuristic"). Recorded so a re-bake can detect when a
        # box changed and re-crop + re-derive depth for just that id.
        "crop":   directive,
        "depth":  {
            "source": source,
            "file":   out_depth.name,
            "bands":  {"count": len(centers), "edges": edges, "centers": centers},
        },
        # Color-cluster centers, dark→light, in normalized [0,1] RGB. The
        # renderer feeds these into the shader as `uColorCenters` and
        # assigns each pixel to its nearest cluster on the fly.
        "color":  {
            "count":   N_COLOR_BANDS,
            "centers": color_centers_norm,
        },
    }
    if accents is not None:
        meta["accents"] = accents
    if crop_note is not None:
        # Present ONLY when the hand-authored crop directive above did NOT
        # actually get applied to this image's pixels (degenerate box after
        # rounding) — see apply_crop(). Its presence is the honest signal
        # that "crop" is a request, not a guarantee of what pixels were kept.
        meta["crop_note"] = crop_note
    out_json.write_text(json.dumps(meta, separators=(",", ":")))
    return meta


# ---- driver -----------------------------------------------------------------

def iter_images(root: Path):
    for p in sorted(root.iterdir()):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            yield p


def write_manifest(out_dir: Path) -> None:
    """An id is bakeable only if all three companion files are present —
    painting webp, depth png, and schema-2 theater json. This keeps the
    manifest from listing half-baked or legacy (schema-1) entries."""
    ids = []
    for p in sorted(out_dir.glob("*.theater.json")):
        if p.name.startswith("_") or p.name == "graph.theater.json":
            continue
        pid = p.stem.removesuffix(".theater")
        try:
            schema = json.loads(p.read_text()).get("schema")
        except Exception:
            continue
        if schema != 2:
            continue
        if (out_dir / f"{pid}.painting.webp").exists() and (out_dir / f"{pid}.depth.png").exists():
            ids.append(pid)
    (out_dir / "_manifest.json").write_text(json.dumps(ids))
    print(f"[m] {len(ids)} ids -> {out_dir / '_manifest.json'}")


def main(argv: list[str]) -> int:
    load_dotenv(Path(".env.local"))
    if not os.environ.get("HF_TOKEN"):
        print("[!] HF_TOKEN not set (looked at .env.local). Photorealize needs "
              "it; the depth Space is public so depth may still work.",
              file=sys.stderr)

    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input",  type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--max-side", type=int, default=DEFAULT_MAX_SIDE)
    ap.add_argument("--limit",  type=int, default=None)
    ap.add_argument("--ids",    type=str, default=None,
                    help="comma-separated image stems to bake (others skipped); "
                         "stale outputs for these ids are refreshed")
    ap.add_argument("--force",  action="store_true",
                    help="regenerate every stage, including cached photo/depth")
    args = ap.parse_args(argv)

    args.input  = args.input.resolve()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)

    if not args.input.is_dir():
        print(f"[!] input dir not found: {args.input}", file=sys.stderr)
        return 2

    images = list(iter_images(args.input))
    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",") if s.strip()}
        images = [p for p in images if p.stem in wanted]
        missing = wanted - {p.stem for p in images}
        if missing:
            print(f"[!] ids not found in {args.input}: {sorted(missing)}", file=sys.stderr)
    if args.limit is not None:
        images = images[: args.limit]
    if not images:
        print(f"[!] no images to bake in {args.input}", file=sys.stderr)
        return 1

    baked = skipped = failed = 0
    for path in images:
        out_json = args.output / f"{path.stem}.theater.json"
        is_v2 = False
        if out_json.exists():
            try:
                is_v2 = json.loads(out_json.read_text()).get("schema") == 2
            except Exception:
                is_v2 = False
        if is_v2 and not args.force and args.ids is None:
            skipped += 1
            continue
        try:
            data = bake_image(path, args.output, args.max_side, force=args.force)
        except Exception as e:
            print(f"[x] {path.name}: {type(e).__name__}: {e}", file=sys.stderr)
            failed += 1
            continue
        baked += 1
        bands = data["depth"]["bands"]["count"]
        print(f"[+] {path.name} -> {data['id']} ({bands} bands, depth={data['depth']['source']})")

    write_manifest(args.output)
    print(f"\nbaked={baked} skipped={skipped} failed={failed} total={len(images)}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
