"""
The Grinder
===========

This is the core processing engine for the Infinite Void.
It takes a 2D image and "grinds" it into a 3D stroke cloud.

The process involves:
1.  **Depth Estimation (MiDaS)**: Determines how far away each pixel is.
2.  **Semantic Segmentation (SAM)**: Breaks the image into logical objects/strokes.
3.  **Data Serialization**: Exports the stroke data to JSON.

Dependencies:
    - PyTorch
    - OpenCV
    - Segment Anything (SAM)
    - MiDaS (via Torch Hub)

Usage:
    python scripts/grinder.py --input path/to/image.jpg
    python scripts/grinder.py --input path/to/folder --shard 0 --total 4
"""

import os
import argparse
import json
import cv2
import numpy as np
import torch
import warnings
import gc
from PIL import Image

# Suppress warnings from PyTorch/Libraries to keep output clean
warnings.filterwarnings("ignore")

# --- CONFIGURATION ---
# Minimum resolution (width or height) to accept an image.
# Smaller images look bad when exploded into strokes.
MIN_RESOLUTION = 1080 


class ArtGrinder:
    """
    The main processing class. Handles model loading and image processing.
    """

    def __init__(self):
        # Auto-detect hardware accelerator (CUDA for NVIDIA, CPU otherwise).
        # Note: MPS (Mac) support could be added here if needed.
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[*] Grinder initialized on: {self.device}")
        
        # --- 1. LOAD DEPTH MODEL (MiDaS) ---
        try:
            print("[*] Loading Depth Model (MiDaS)...")
            # We use MiDaS Small because it's fast and 'good enough' for artistic depth.
            self.depth_model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small").to(self.device)
            self.depth_model.eval()

            # Load the transform pipeline (resizing, normalization) required by MiDaS.
            midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
            self.depth_transform = midas_transforms.small_transform
            self.has_depth = True
        except Exception as e:
            print(f"[!] Failed to load Depth Model: {e}")
            self.has_depth = False

        # --- 2. LOAD SEGMENTATION MODEL (SAM) ---
        try:
            print("[*] Loading SAM (Segment Anything)...")
            from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
            
            # Check for model weights
            chk_path = "sam_vit_b_01ec64.pth"
            if not os.path.exists(chk_path):
                print("    -> Downloading SAM Checkpoint...")
                torch.hub.download_url_to_file("https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth", chk_path)

            # Initialize SAM (Vision Transformer Base - ViT-B)
            sam = sam_model_registry["vit_b"](checkpoint=chk_path)
            sam.to(device=self.device)

            # Configure the Mask Generator.
            # These parameters control the granularity of the "strokes".
            # - points_per_side=32: Higher = more, smaller strokes.
            # - pred_iou_thresh=0.86: Quality threshold.
            self.mask_generator = SamAutomaticMaskGenerator(
                model=sam,
                points_per_side=32,
                pred_iou_thresh=0.86,
                stability_score_thresh=0.92,
                crop_n_layers=0,
                crop_n_points_downscale_factor=1,
                min_mask_region_area=100, # Minimum stroke size in pixels
            )
            self.has_sam = True
        except Exception as e:
            print(f"[!] SAM load failed (using grid fallback): {e}")
            self.has_sam = False

    def estimate_depth(self, img_rgb):
        """
        Runs the MiDaS model to get a depth map.
        Returns a normalized 0.0-1.0 float map.
        """
        if not self.has_depth:
            # Fallback: Flat depth
            h, w, _ = img_rgb.shape
            return np.ones((h, w), dtype=np.float32) * 0.5

        try:
            # Preprocess
            input_batch = self.depth_transform(img_rgb).to(self.device)

            # Inference
            with torch.no_grad():
                prediction = self.depth_model(input_batch)

                # Resize prediction back to original image size
                prediction = torch.nn.functional.interpolate(
                    prediction.unsqueeze(1),
                    size=img_rgb.shape[:2],
                    mode="bicubic",
                    align_corners=False,
                ).squeeze()

            return prediction.cpu().numpy()
        except Exception as e:
            print(f"[!] Depth Error: {e}")
            h, w, _ = img_rgb.shape
            return np.ones((h, w), dtype=np.float32) * 0.5

    def get_segments(self, img_rgb):
        """
        Runs SAM to get segmentation masks.
        If SAM fails, falls back to a simple grid subdivision.
        """
        if self.has_sam:
            try:
                return self.mask_generator.generate(img_rgb)
            except Exception as e:
                print(f"    [!] SAM Error: {e}")
        
        # --- Fallback Strategy ---
        # Simply grid the image into 64x64 squares.
        h, w, _ = img_rgb.shape
        grid_size = 64
        masks = []
        for y in range(0, h, grid_size):
            for x in range(0, w, grid_size):
                bbox = [x, y, min(grid_size, w-x), min(grid_size, h-y)]
                # Mock SAM output structure
                masks.append({'bbox': bbox, 'area': bbox[2]*bbox[3], 'stability_score': 0.5})
        return masks

    def create_metadata_stub(self, file_id, filename):
        """
        Creates an empty Markdown file in assets/meta/ if one doesn't exist.
        This enables the editorial team to easily add descriptions later.
        """
        meta_dir = "assets/meta"
        os.makedirs(meta_dir, exist_ok=True)
        meta_path = os.path.join(meta_dir, f"{file_id}.md")
        
        if not os.path.exists(meta_path):
            print(f"    -> Creating Prose stub: {meta_path}")
            with open(meta_path, 'w') as f:
                f.write(f"---\n")
                f.write(f"title: {file_id}\n")
                f.write(f"year: \"\"\n")
                f.write(f"description: \"\"\n")
                f.write(f"---\n")

    def process_image(self, input_path):
        """
        The core logic pipeline for a single image.
        """
        filename = os.path.basename(input_path)
        name_no_ext = os.path.splitext(filename)[0]
        output_path = os.path.join("public/data", f"{name_no_ext}.json")

        # 1. ALWAYS ensure metadata stub exists (even if already ground)
        self.create_metadata_stub(name_no_ext, filename)

        # Check cache
        if os.path.exists(output_path):
            print(f"    -> Skipping Grinding (Already Done)")
            return

        # 2. READ IMAGE
        img_cv2 = cv2.imread(input_path)
        if img_cv2 is None:
            print(f"    [!] Skipped: Corrupt file.")
            return

        h, w = img_cv2.shape[:2]

        # 3. VALIDATION
        if w < MIN_RESOLUTION or h < MIN_RESOLUTION:
            print(f"    [X] REJECTED: Too small ({w}x{h}). Deleting.")
            try:
                os.remove(input_path)
            except OSError as e:
                print(f"    [!] Failed to delete small image {input_path}: {e}")
            return

        # 4. RESIZE (If too massive)
        # We cap at 1500px to keep processing time and JSON size reasonable.
        max_dim = 1500
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            img_cv2 = cv2.resize(img_cv2, (0,0), fx=scale, fy=scale)
            print(f"    -> Resized to {img_cv2.shape[1]}x{img_cv2.shape[0]}.")

        img_rgb = cv2.cvtColor(img_cv2, cv2.COLOR_BGR2RGB)

        # 5. GENERATE DEPTH MAP
        print("    -> Depth Map...")
        depth_map = self.estimate_depth(img_rgb)

        # Normalize depth to 0.0 - 1.0 range
        d_min, d_max = depth_map.min(), depth_map.max()
        if d_max - d_min > 0:
            depth_map = (depth_map - d_min) / (d_max - d_min)
        else:
            depth_map = np.zeros_like(depth_map)

        # 6. SEGMENT IMAGE
        print("    -> Segmenting...")
        masks = self.get_segments(img_rgb)
        
        # 7. EXTRACT STROKES
        strokes = []
        print(f"    -> Grinding {len(masks)} fragments...")
        
        for mask_data in masks:
            # SAM returns bbox as [x, y, w, h]
            x, y, mw, mh = map(int, mask_data['bbox'])
            if mw <= 0 or mh <= 0: continue
            
            # Extract the Region of Interest (ROI)
            roi = img_rgb[y:y+mh, x:x+mw]
            if roi.size == 0: continue
            
            # Calculate Average Color
            # (In a more advanced version, we might extract a texture patch here)
            avg_color = roi.mean(axis=(0,1)).astype(int).tolist()

            # Calculate Average Depth for this stroke
            roi_depth = depth_map[y:y+mh, x:x+mw]
            avg_z = float(roi_depth.mean()) if roi_depth.size > 0 else 0.5
            
            strokes.append({
                "color": avg_color,
                "bbox": [x, y, mw, mh], # Used for scale calculations
                "z": avg_z,             # 3D Depth
                "stability": float(mask_data.get('stability_score', 0.5)) # Used for "jitter" effects
            })

        # 8. EXPORT
        output_data = {
            "meta": {
                "file": filename,
                "original_file": filename, # Added for Pareidolia lookup
                "resolution": [w, h],
                "stroke_count": len(strokes)
            },
            "strokes": strokes
        }

        output_dir = "public/data"
        os.makedirs(output_dir, exist_ok=True)
        
        with open(output_path, 'w') as f:
            json.dump(output_data, f)

        # 9. CLEANUP (GPU Memory Management)
        del img_cv2, img_rgb, depth_map, masks, output_data
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

def main():
    # --- ARGUMENT PARSING ---
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to image OR folder')
    # Sharding allows multiple machines to process a large dataset in parallel.
    parser.add_argument('--shard', type=int, default=0, help='Machine Index')
    parser.add_argument('--total', type=int, default=1, help='Total Machines')
    args = parser.parse_args()

    grinder = ArtGrinder()

    if os.path.isdir(args.input):
        # BATCH MODE
        all_files = sorted([f for f in os.listdir(args.input) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))])

        # Calculate my shard
        my_files = [f for i, f in enumerate(all_files) if i % args.total == args.shard]
        total_count = len(my_files)
        
        print(f"[*] Batch Mode: Shard {args.shard + 1}/{args.total}")
        print(f"[*] Workload: {total_count} images.")
        
        for i, f in enumerate(my_files):
            print(f"\n[{i+1}/{total_count}] Processing: {f}")
            try:
                full_path = os.path.join(args.input, f)
                grinder.process_image(full_path)
            except Exception as e:
                print(f"[!] CRITICAL FAIL on {f}: {e}")
                continue
    else:
        # SINGLE FILE MODE
        grinder.process_image(args.input)

if __name__ == "__main__":
    main()
