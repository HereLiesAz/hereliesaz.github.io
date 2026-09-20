#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except Exception:
    pass

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif"}
COPY_WORDS = re.compile(r"(?:[-_ ](?:copy|compressed|small|smaller|medium|large|thumb|thumbnail|edited|edit|export|resized|scaled)|\s*\(\d+\))+$", re.I)
TOKEN_RE = re.compile(r"[a-z0-9]+")


@dataclass
class ImageInfo:
    id: str
    filename: str
    source_is_symlink: bool
    bytes: int
    sha256: str
    width: int | None
    height: int | None
    dhash: int | None
    ahash: int | None
    gray: bytes | None
    avg_rgb: tuple[float, float, float] | None
    meta_tokens: frozenset[str]
    normalized_name: str
    error: str | None = None

    @property
    def pixels(self) -> int:
        if self.width is None or self.height is None:
            return 0
        return self.width * self.height

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "filename": self.filename,
            "sourceIsSymlink": self.source_is_symlink,
            "bytes": self.bytes,
            "width": self.width,
            "height": self.height,
        }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--assets", default="public/assets")
    p.add_argument("--meta", default="public/meta.json")
    p.add_argument("--output", default="dedup-report.json")
    p.add_argument("--max-similar", type=int, default=600)
    p.add_argument("--similar-threshold", type=float, default=0.74)
    return p.parse_args()


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def normalized_name(filename: str) -> str:
    stem = Path(filename).stem.lower()
    stem = COPY_WORDS.sub("", stem)
    stem = re.sub(r"[^a-z0-9]+", " ", stem).strip()
    return " ".join(stem.split())


def tokens(value: Any) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, list):
        value = " ".join(str(v) for v in value)
    elif isinstance(value, dict):
        value = " ".join(str(v) for v in value.values())
    return set(TOKEN_RE.findall(str(value).lower()))


def meta_tokens_for(meta: dict[str, Any], image_id: str) -> frozenset[str]:
    item = meta.get(image_id) or {}
    out: set[str] = set()
    for key in ("title", "description", "tags"):
        out.update(tokens(item.get(key)))
    return frozenset(out)


def dhash(img: Image.Image) -> int:
    g = img.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    px = list(g.getdata())
    value = 0
    bit = 0
    for y in range(8):
        row = y * 9
        for x in range(8):
            if px[row + x] > px[row + x + 1]:
                value |= 1 << bit
            bit += 1
    return value


def ahash(img: Image.Image) -> int:
    g = img.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
    px = list(g.getdata())
    avg = sum(px) / len(px)
    value = 0
    for i, p in enumerate(px):
        if p >= avg:
            value |= 1 << i
    return value


def gray_thumb(img: Image.Image) -> bytes:
    return bytes(img.convert("L").resize((32, 32), Image.Resampling.LANCZOS).getdata())


def avg_rgb(img: Image.Image) -> tuple[float, float, float]:
    px = list(img.convert("RGB").resize((8, 8), Image.Resampling.LANCZOS).getdata())
    n = len(px)
    return (
        sum(p[0] for p in px) / n,
        sum(p[1] for p in px) / n,
        sum(p[2] for p in px) / n,
    )


def inspect(path: Path, meta: dict[str, Any]) -> ImageInfo:
    filename = path.name
    image_id = path.stem
    size = path.stat().st_size
    digest = file_sha256(path)
    base = dict(
        id=image_id,
        filename=filename,
        source_is_symlink=path.is_symlink(),
        bytes=size,
        sha256=digest,
        meta_tokens=meta_tokens_for(meta, image_id),
        normalized_name=normalized_name(filename),
    )
    try:
        with Image.open(path) as raw:
            image = ImageOps.exif_transpose(raw)
            width, height = image.size
            return ImageInfo(
                **base,
                width=width,
                height=height,
                dhash=dhash(image),
                ahash=ahash(image),
                gray=gray_thumb(image),
                avg_rgb=avg_rgb(image),
            )
    except Exception as exc:
        return ImageInfo(
            **base,
            width=None,
            height=None,
            dhash=None,
            ahash=None,
            gray=None,
            avg_rgb=None,
            error=f"{type(exc).__name__}: {exc}",
        )


def hamming(a: int | None, b: int | None) -> int:
    if a is None or b is None:
        return 64
    return (a ^ b).bit_count()


def aspect_similarity(a: ImageInfo, b: ImageInfo) -> float:
    if not a.width or not a.height or not b.width or not b.height:
        return 0.0
    ra = a.width / a.height
    rb = b.width / b.height
    return max(0.0, 1.0 - abs(ra - rb) / max(ra, rb))


def pixel_similarity(a: ImageInfo, b: ImageInfo) -> float:
    if a.gray is None or b.gray is None:
        return 0.0
    mean_abs = sum(abs(x - y) for x, y in zip(a.gray, b.gray)) / len(a.gray)
    return max(0.0, 1.0 - mean_abs / 255.0)


def color_similarity(a: ImageInfo, b: ImageInfo) -> float:
    if a.avg_rgb is None or b.avg_rgb is None:
        return 0.0
    distance = math.sqrt(sum((x - y) ** 2 for x, y in zip(a.avg_rgb, b.avg_rgb)))
    max_distance = math.sqrt(3 * 255 * 255)
    return max(0.0, 1.0 - distance / max_distance)


def token_similarity(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def name_similarity(a: ImageInfo, b: ImageInfo) -> float:
    if not a.normalized_name or not b.normalized_name:
        return 0.0
    if a.normalized_name == b.normalized_name:
        return 1.0
    ta = set(a.normalized_name.split())
    tb = set(b.normalized_name.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def quality_key(image: ImageInfo) -> tuple[int, int, int, int, str]:
    return (
        image.pixels,
        image.bytes,
        len(image.meta_tokens),
        -len(image.filename),
        image.filename.lower(),
    )


def keep_remove(a: ImageInfo, b: ImageInfo) -> tuple[ImageInfo, ImageInfo]:
    return (a, b) if quality_key(a) >= quality_key(b) else (b, a)


def pair_payload(
    a: ImageInfo,
    b: ImageInfo,
    kind: str,
    certainty: float,
    reasons: list[str],
    suggested: tuple[ImageInfo, ImageInfo] | None,
) -> dict[str, Any]:
    payload = {
        "kind": kind,
        "certainty": round(max(0.0, min(100.0, certainty)), 1),
        "left": a.public(),
        "right": b.public(),
        "reasons": reasons,
    }
    if suggested:
        keep, remove = suggested
        payload["suggestedKeepId"] = keep.id
        payload["suggestedRemoveId"] = remove.id
    return payload


def exact_pairs(images: list[ImageInfo]) -> tuple[list[dict[str, Any]], set[tuple[str, str]]]:
    groups: dict[str, list[ImageInfo]] = defaultdict(list)
    for image in images:
        groups[image.sha256].append(image)

    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for members in groups.values():
        if len(members) < 2:
            continue
        members = sorted(members, key=quality_key, reverse=True)
        keep = members[0]
        for other in members[1:]:
            key = tuple(sorted((keep.id, other.id)))
            seen.add(key)
            out.append(
                pair_payload(
                    keep,
                    other,
                    "exact",
                    100.0,
                    ["identical file content"],
                    (keep, other),
                )
            )
    return out, seen


def analyze_pair(a: ImageInfo, b: ImageInfo):
    if a.dhash is None or b.dhash is None:
        return None

    dh = hamming(a.dhash, b.dhash)
    ah = hamming(a.ahash, b.ahash)
    dh_sim = 1.0 - dh / 64.0
    ah_sim = 1.0 - ah / 64.0
    asp = aspect_similarity(a, b)
    col = color_similarity(a, b)
    name = name_similarity(a, b)
    meta = token_similarity(a.meta_tokens, b.meta_tokens)

    if dh > 20 and ah > 20 and col < 0.82 and name < 0.8 and meta < 0.8:
        return None

    pix = pixel_similarity(a, b)
    perceptual = (
        0.40 * pix
        + 0.22 * dh_sim
        + 0.14 * ah_sim
        + 0.10 * col
        + 0.08 * asp
        + 0.03 * name
        + 0.03 * meta
    )

    reasons: list[str] = []
    if name >= 0.99:
        reasons.append("matching filename")
    elif name >= 0.7:
        reasons.append("similar filename")
    if meta >= 0.8:
        reasons.append("matching artwork metadata")
    if a.width == b.width and a.height == b.height and a.width is not None:
        reasons.append("same dimensions")
    elif asp >= 0.99:
        reasons.append("same aspect ratio")
    if pix >= 0.95:
        reasons.append("near-identical pixels")
    elif pix >= 0.85:
        reasons.append("strong visual match")

    compressed_like = (
        asp >= 0.99
        and pix >= 0.92
        and dh <= 7
        and ah <= 10
        and (a.bytes != b.bytes or a.width != b.width or a.height != b.height)
    )

    if compressed_like:
        keep, remove = keep_remove(a, b)
        certainty = (
            0.48 * pix
            + 0.20 * dh_sim
            + 0.12 * ah_sim
            + 0.08 * col
            + 0.08 * asp
            + 0.02 * name
            + 0.02 * meta
        ) * 100.0
        certainty = max(95.0, certainty)
        reasons.append("larger original preferred")
        return "compressed", certainty, reasons, (keep, remove)

    if perceptual < 0.74:
        return None

    return "similar", perceptual * 100.0, reasons or ["visual similarity"], None


def scan(images: list[ImageInfo], max_similar: int, similar_threshold: float) -> list[dict[str, Any]]:
    exact, exact_keys = exact_pairs(images)
    duplicates: list[dict[str, Any]] = []
    similar: list[dict[str, Any]] = []

    n = len(images)
    for i in range(n):
        a = images[i]
        for j in range(i + 1, n):
            b = images[j]
            key = tuple(sorted((a.id, b.id)))
            if key in exact_keys:
                continue
            result = analyze_pair(a, b)
            if result is None:
                continue
            kind, certainty, reasons, suggested = result
            if kind == "similar" and certainty < similar_threshold * 100.0:
                continue
            payload = pair_payload(a, b, kind, certainty, reasons, suggested)
            if kind == "compressed":
                duplicates.append(payload)
            else:
                similar.append(payload)

    similar.sort(key=lambda x: x["certainty"], reverse=True)
    chosen_similar: list[dict[str, Any]] = []
    per_image: dict[str, int] = defaultdict(int)
    for pair in similar:
        left = pair["left"]["id"]
        right = pair["right"]["id"]
        if per_image[left] >= 3 or per_image[right] >= 3:
            continue
        chosen_similar.append(pair)
        per_image[left] += 1
        per_image[right] += 1
        if len(chosen_similar) >= max_similar:
            break

    all_pairs = exact + duplicates + chosen_similar
    order = {"exact": 0, "compressed": 1, "similar": 2}
    all_pairs.sort(key=lambda x: (order[x["kind"]], -x["certainty"]))
    return all_pairs


def main() -> None:
    args = parse_args()
    assets = Path(args.assets)
    meta_path = Path(args.meta)
    meta = {}
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}

    paths = sorted(
        (
            p for p in assets.iterdir()
            if p.suffix.lower() in IMAGE_EXTS and (p.is_file() or p.is_symlink())
        ),
        key=lambda p: p.name.lower(),
    )

    images = [inspect(path, meta) for path in paths]
    pairs = scan(images, args.max_similar, args.similar_threshold)
    errors = [
        {"id": image.id, "filename": image.filename, "error": image.error}
        for image in images
        if image.error
    ]

    report = {
        "version": 1,
        "imageCount": len(images),
        "pairCount": len(pairs),
        "exactCount": sum(1 for p in pairs if p["kind"] == "exact"),
        "compressedCount": sum(1 for p in pairs if p["kind"] == "compressed"),
        "similarCount": sum(1 for p in pairs if p["kind"] == "similar"),
        "pairs": pairs,
        "scanErrors": errors,
    }
    Path(args.output).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
