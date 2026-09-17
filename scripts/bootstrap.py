#!/usr/bin/env python3
"""Bootstrap a small stroke-cloud sample from the real painting corpus.

The default input is public/assets so the existing Bootstrap Art workflow works
against this repository as checked out. --input remains configurable for staging
or experiments.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import warnings
from pathlib import Path

import cv2
import numpy as np
import torch
from segment_anything import SamAutomaticMaskGenerator, sam_model_registry

warnings.filterwarnings("ignore")

PROJECT_ROOT = Path.cwd()
DEFAULT_INPUT = PROJECT_ROOT / "public" / "assets"
DEFAULT_OUTPUT = PROJECT_ROOT / "public" / "data"
DEFAULT_LIMIT = 5


def bootstrap(input_dir: Path, output_dir: Path, limit: int) -> int:
    print("[*] Bootstrapping the Void")
    print(f"[*] Root: {PROJECT_ROOT}")
    print(f"[*] Input: {input_dir}")
    print(f"[*] Output: {output_dir}")

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "bootstrap-manifest.json"

    valid_exts = {".jpg", ".jpeg", ".png", ".webp"}
    if not input_dir.is_dir():
        print(f"[!] Error: {input_dir} missing.")
        return 2

    all_files = sorted(p for p in input_dir.iterdir() if p.suffix.lower() in valid_exts)
    if not all_files:
        print(f"[!] No supported images found in {input_dir}.")
        return 2

    selected_files = random.sample(all_files, min(limit, len(all_files)))
    print(f"[*] Selected {len(selected_files)} image(s).")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[*] AI Device: {device}")

    try:
        depth_model = torch.hub.load("intel-isl/MiDaS", "DPT_Large").to(device).eval()
        transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
        depth_transform = transforms.dpt_transform
    except Exception as exc:
        print(f"[!] Depth model failed: {exc}")
        return 1

    checkpoint = Path("sam_vit_b_01ec64.pth")
    if not checkpoint.exists():
        torch.hub.download_url_to_file(
            "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
            str(checkpoint),
        )

    sam = sam_model_registry["vit_b"](checkpoint=str(checkpoint))
    sam.to(device=device)
    mask_generator = SamAutomaticMaskGenerator(sam, points_per_side=16)

    nodes: list[dict] = []
    for index, img_path in enumerate(selected_files, start=1):
        print(f"[{index}/{len(selected_files)}] Processing {img_path.name}...")
        try:
            img_cv2 = cv2.imread(str(img_path))
            if img_cv2 is None:
                raise ValueError("OpenCV could not decode image")
            img_rgb = cv2.cvtColor(img_cv2, cv2.COLOR_BGR2RGB)

            h, w = img_rgb.shape[:2]
            max_dim = 512
            if max(h, w) > max_dim:
                scale = max_dim / max(h, w)
                img_rgb = cv2.resize(img_rgb, (int(w * scale), int(h * scale)))

            input_batch = depth_transform(img_rgb).to(device)
            with torch.no_grad():
                prediction = depth_model(input_batch)
                prediction = torch.nn.functional.interpolate(
                    prediction.unsqueeze(1),
                    size=img_rgb.shape[:2],
                    mode="bicubic",
                    align_corners=False,
                ).squeeze()
            depth_raw = prediction.cpu().numpy()
            d_min, d_max = depth_raw.min(), depth_raw.max()
            depth_map = (
                (depth_raw - d_min) / (d_max - d_min)
                if (d_max - d_min) > 0
                else np.zeros_like(depth_raw)
            )

            strokes = []
            for mask_data in mask_generator.generate(img_rgb):
                mask = mask_data["segmentation"]
                y, x = np.where(mask)
                if len(y) == 0:
                    continue
                strokes.append({
                    "color": img_rgb[y, x].mean(axis=0).astype(int).tolist(),
                    "bbox": [int(v) for v in mask_data["bbox"]],
                    "z": float(depth_map[y, x].mean()),
                    "stability": float(mask_data["stability_score"]),
                })

            out_name = f"{img_path.name}.json"
            (output_dir / out_name).write_text(json.dumps({
                "meta": {
                    "file": img_path.name,
                    "res": [img_rgb.shape[1], img_rgb.shape[0]],
                },
                "strokes": strokes,
            }), encoding="utf-8")

            nodes.append({
                "id": img_path.stem,
                "file": out_name,
                "strokes": len(strokes),
                "res": [img_rgb.shape[1], img_rgb.shape[0]],
                "neighbors": [],
            })
        except Exception as exc:
            print(f"[!] Failed {img_path.name}: {exc}")

    if not nodes:
        print("[!] No paintings were successfully bootstrapped.")
        return 1

    total = len(nodes)
    for i, node in enumerate(nodes):
        if total == 1:
            node["neighbors"] = [node["id"]]
        else:
            node["neighbors"] = [
                nodes[(i - 1) % total]["id"],
                nodes[(i + 1) % total]["id"],
            ]

    manifest_data = {"generated_at": "BOOTSTRAP_MODE", "nodes": nodes}
    manifest_path.write_text(json.dumps(manifest_data, indent=2) + "\n", encoding="utf-8")

    print(f"[*] Verifying {manifest_path}...")
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[!] JSON CORRUPTED: {exc}")
        return 1
    if not isinstance(data.get("nodes"), list):
        print(f"[!] INVALID STRUCTURE. Got keys: {list(data)}")
        return 1

    print(f"[*] VALID. Found {len(data['nodes'])} nodes.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    args = parser.parse_args(argv)
    if args.limit < 1:
        parser.error("--limit must be at least 1")
    return bootstrap(args.input, args.output, args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
