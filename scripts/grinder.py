import os
import sys
import argparse
import json
import torch
import cv2
import numpy as np
import hashlib
from PIL import Image
from pillow_heif import register_heif_opener
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

# Register HEIC opener for Pillow
register_heif_opener()

# --- CONFIGURATION ---
ZOE_MODEL_TYPE = "ZoeD_N"
SAM_CHECKPOINT_URL = "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
SAM_CHECKPOINT_PATH = "weights/sam_vit_b_01ec64.pth"
SAM_MODEL_TYPE = "vit_b"
OUTPUT_DIR = "public/data"

class ArtGrinder:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[*] Initializing ArtGrinder on {self.device}...")
        self._ensure_weights()
        self.depth_model = self._load_depth_model()
        self.mask_generator = self._load_sam()

    def _ensure_weights(self):
        if not os.path.exists("weights"):
            os.makedirs("weights")
        if not os.path.exists(SAM_CHECKPOINT_PATH):
            print(f"[*] Downloading SAM weights...")
            torch.hub.download_url_to_file(SAM_CHECKPOINT_URL, SAM_CHECKPOINT_PATH)

    def _load_depth_model(self):
        print("[*] Loading ZoeDepth...")
        try:
            model = torch.hub.load("isl-org/ZoeDepth", ZOE_MODEL_TYPE, pretrained=True, trust_repo=True)
        except Exception as e:
            print(f"[!] ZoeDepth failed ({e}). Fallback to MiDaS.")
            model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small", trust_repo=True)
        model.to(self.device).eval()
        return model

    def _load_sam(self):
        print("[*] Loading SAM...")
        sam = sam_model_registry[SAM_MODEL_TYPE](checkpoint=SAM_CHECKPOINT_PATH)
        sam.to(self.device)
        return SamAutomaticMaskGenerator(
            model=sam,
            points_per_side=32,
            pred_iou_thresh=0.86,
            stability_score_thresh=0.92,
            crop_n_layers=1,
            crop_n_points_downscale_factor=2,
            min_mask_region_area=100,
        )

    def _heal_canvas(self, img, mask):
        # Dilate mask slightly to ensure clean edges
        kernel = np.ones((3,3), np.uint8)
        dilated_mask = cv2.dilate(mask.astype(np.uint8), kernel, iterations=2)
        # Inpaint (Radius 3, Navier-Stokes)
        return cv2.inpaint(img, dilated_mask, 3, cv2.INPAINT_NS)

    def should_process(self, filename, shard_index, total_shards):
        if total_shards <= 1:
            return True
        # Deterministic hash of the filename
        hash_val = int(hashlib.md5(filename.encode('utf-8')).hexdigest(), 16)
        # Check if this file belongs to this shard
        return (hash_val % total_shards) == shard_index

    def process_image(self, image_path, shard_index=0, total_shards=1):
        filename = os.path.basename(image_path)
        
        # --- SHARD CHECK ---
        if not self.should_process(filename, shard_index, total_shards):
            print(f"[-] Skipping {filename} (Belongs to another runner)")
            return

        print(f"[*] Processing {filename} [Shard {shard_index}/{total_shards}]...")
        
        # 1. Load Image (Pillow handles HEIC via pillow-heif)
        try:
            pil_img = Image.open(image_path)
            pil_img = pil_img.convert('RGB') # Ensure 3 channels
            img_rgb = np.array(pil_img)
        except Exception as e:
            print(f"[!] Could not read {image_path}: {e}")
            return
        
        # 2. Estimate Depth (Zoe)
        print("    -> Estimating Depth...")
        with torch.no_grad():
            if hasattr(self.depth_model, 'infer_pil'):
                depth_map = self.depth_model.infer_pil(pil_img)
            else:
                # Fallback logic simplified for brevity
                pass 

        # Normalize Depth (0=Close, 1=Far)
        d_min, d_max = depth_map.min(), depth_map.max()
        depth_normalized = (depth_map - d_min) / (d_max - d_min)

        # 3. Segment (SAM)
        print("    -> Segmenting...")
        masks = self.mask_generator.generate(img_rgb)
        
        # 4. SORT MASKS BY DEPTH (Closest First)
        for m in masks:
            m['avg_z'] = np.mean(depth_normalized[m['segmentation']])
        masks.sort(key=lambda x: x['avg_z'])

        print(f"    -> Found {len(masks)} layers. Beginning surgery...")

        # 5. Extract & Heal
        strokes_data = []
        working_canvas = img_rgb.copy() 

        for i, mask_data in enumerate(masks):
            mask = mask_data['segmentation']
            bbox = mask_data['bbox'] # [x, y, w, h]
            
            masked_pixels = working_canvas[mask]
            if masked_pixels.size == 0: continue
            
            avg_color = np.mean(masked_pixels, axis=0)

            stroke = {
                "id": i,
                "bbox": [int(v) for v in bbox],
                "z": float(mask_data['avg_z']),
                "area": int(mask_data['area']),
                "color": [int(c) for c in avg_color],
                "stability": float(mask_data['stability_score'])
            }
            strokes_data.append(stroke)
            
            # Heal the canvas 
            working_canvas = self._heal_canvas(working_canvas, mask)

        # 6. Save Output
        if not os.path.exists(OUTPUT_DIR): os.makedirs(OUTPUT_DIR)
        out_path = os.path.join(OUTPUT_DIR, os.path.splitext(filename)[0] + ".json")
        
        payload = {
            "meta": {
                "original_file": filename,
                "resolution": img_rgb.shape[:2],
                "stroke_count": len(strokes_data)
            },
            "strokes": strokes_data
        }
        
        with open(out_path, 'w') as f:
            json.dump(payload, f)
        print(f"[*] Saved volumetric analysis to {out_path}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=str, required=True)
    parser.add_argument("--shard_index", type=int, default=0, help="Index of this runner")
    parser.add_argument("--total_shards", type=int, default=1, help="Total number of runners")
    args = parser.parse_args()
    
    ArtGrinder().process_image(args.input, args.shard_index, args.total_shards)

if __name__ == "__main__":
    main()
