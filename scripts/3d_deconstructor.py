#!/usr/bin/env python3
"""Build a compact semantic/depth-layer representation for paintings."""
from __future__ import annotations

import argparse
import json
import os
import random
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageFile
from tqdm import tqdm

ImageFile.LOAD_TRUNCATED_IMAGES = True

try:
    from segment_anything import SamAutomaticMaskGenerator, sam_model_registry
    SAM_AVAILABLE = True
except ImportError:
    SAM_AVAILABLE = False


class ThreeDDeconstructor:
    def __init__(self, device: str = "cuda"):
        self.device = device if device == "cpu" or torch.cuda.is_available() else "cpu"
        print(f"[*] Initializing 3D Deconstructor on {self.device}...")

        self.depth_model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small").to(self.device).eval()
        self.depth_transform = torch.hub.load("intel-isl/MiDaS", "transforms").small_transform

        self.mask_generator = None
        if SAM_AVAILABLE:
            checkpoint = Path("sam_vit_b_01ec64.pth")
            if checkpoint.exists():
                sam = sam_model_registry["vit_b"](checkpoint=str(checkpoint))
                sam.to(device=self.device)
                self.mask_generator = SamAutomaticMaskGenerator(
                    model=sam,
                    points_per_side=32,
                    pred_iou_thresh=0.86,
                    stability_score_thresh=0.92,
                    min_mask_region_area=500,
                )
            else:
                print(f"[!] SAM checkpoint {checkpoint} not found. Continuing with luminance features only.")

    def get_depth_map(self, img_rgb: np.ndarray) -> np.ndarray:
        input_batch = self.depth_transform(img_rgb).to(self.device)
        with torch.no_grad():
            prediction = self.depth_model(input_batch)
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1),
                size=img_rgb.shape[:2],
                mode="bicubic",
                align_corners=False,
            ).squeeze()
        depth = prediction.cpu().numpy()
        d_min, d_max = depth.min(), depth.max()
        if (d_max - d_min) > 1e-8:
            return (depth - d_min) / (d_max - d_min)
        return np.zeros_like(depth)

    def deconstruct(self, image_path: Path, out_dir: Path) -> Path:
        img_pil = Image.open(image_path).convert("RGB")
        img_np = np.array(img_pil)
        h, w = img_np.shape[:2]

        print(f"[*] Deconstructing {image_path.name}...")
        depth_map = self.get_depth_map(img_np)

        masks = self.mask_generator.generate(img_np) if self.mask_generator else []

        gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
        _, light_mask = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(light_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if cv2.contourArea(contour) <= 1000:
                continue
            mask = np.zeros((h, w), dtype=np.uint8)
            cv2.drawContours(mask, [contour], -1, 255, -1)
            masks.append({
                "segmentation": mask.astype(bool),
                "bbox": cv2.boundingRect(contour),
            })

        valid_masks = [
            item for item in masks
            if np.sum(item["segmentation"]) > (w * h * 0.005)
        ]
        valid_masks.sort(key=lambda item: np.sum(item["segmentation"]), reverse=True)

        slices = []
        for item in valid_masks[:15]:
            seg = item["segmentation"]
            rx, ry, rw, rh = item["bbox"]
            mask_depth = depth_map[seg]
            z_mean = float(np.mean(mask_depth))
            z_var = float(np.std(mask_depth))
            z_spread = (z_mean - 0.5) * 44.0
            slices.append({
                "b": [int(rx), int(ry), int(rw), int(rh)],
                "z": z_spread,
                "zl": z_mean,
                "zv": z_var,
                "r": [random.random() for _ in range(3)],
            })

        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"{image_path.stem}.baked.json"
        out_file.write_text(json.dumps({
            "id": image_path.stem,
            "res": [w, h],
            "count": len(slices),
            "slices": slices,
        }, separators=(",", ":")), encoding="utf-8")
        return out_file


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("public/assets"))
    parser.add_argument("--out", type=Path, default=Path("public/data/baked"))
    parser.add_argument("--limit", type=int, default=5, help="maximum paintings to process; 0 means all")
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    args = parser.parse_args(argv)

    if not args.input.is_dir():
        print(f"[!] Input directory does not exist: {args.input}")
        return 2
    if args.limit < 0:
        parser.error("--limit must be >= 0")

    images = sorted(
        p for p in args.input.iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )
    if not images:
        print(f"[!] No supported images found in {args.input}")
        return 2

    process_list = images if args.limit == 0 else images[:args.limit]
    deconstructor = ThreeDDeconstructor(device=args.device)

    failures = 0
    for image in tqdm(process_list, desc="Semantic deconstruction"):
        try:
            deconstructor.deconstruct(image, args.out)
        except Exception as exc:
            failures += 1
            print(f"[!] Critical error on {image.name}: {exc}")

    if failures:
        print(f"[!] Completed with {failures} failure(s) out of {len(process_list)} image(s).")
        return 1
    print(f"[+] Wrote {len(process_list)} semantic bake(s) to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
