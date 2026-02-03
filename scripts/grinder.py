import os
import sys
import argparse
import json
import torch
import cv2
import numpy as np
from PIL import Image
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
from huggingface_hub import hf_hub_download

# --- CONFIGURATION ---
ZOE_REPO = "isl-org/ZoeDepth"
ZOE_MODEL_TYPE = "ZoeD_N"  # Metric depth
SAM_CHECKPOINT_URL = "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
SAM_CHECKPOINT_PATH = "weights/sam_vit_b_01ec64.pth"
SAM_MODEL_TYPE = "vit_b" # 'vit_b' is the middle ground. 'vit_h' will kill the runner.
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
            print(f"[*] Downloading SAM weights to {SAM_CHECKPOINT_PATH}...")
            torch.hub.download_url_to_file(SAM_CHECKPOINT_URL, SAM_CHECKPOINT_PATH)

    def _load_depth_model(self):
        print("[*] Loading ZoeDepth...")
        # We load via torch hub to avoid complex local submodule management for now
        # ZoeDepth requires 'timm' installed.
        repo = "isl-org/ZoeDepth"
        try:
            model = torch.hub.load(repo, ZOE_MODEL_TYPE, pretrained=True, trust_repo=True)
        except Exception as e:
            print(f"[!] Failed to load ZoeDepth from Hub. Fallback to MiDaS? Error: {e}")
            # Fallback to standard MiDaS if Zoe fails on CPU runner quirks
            model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small", trust_repo=True)
        
        model.to(self.device).eval()
        return model

    def _load_sam(self):
        print("[*] Loading Segment Anything (SAM)...")
        sam = sam_model_registry[SAM_MODEL_TYPE](checkpoint=SAM_CHECKPOINT_PATH)
        sam.to(self.device)
        # Tuned for "Paintings" - we want strokes, not just objects
        return SamAutomaticMaskGenerator(
            model=sam,
            points_per_side=32,
            pred_iou_thresh=0.86,
            stability_score_thresh=0.92,
            crop_n_layers=1,
            crop_n_points_downscale_factor=2,
            min_mask_region_area=100,  # Ignore pixel dust
        )

    def process_image(self, image_path):
        filename = os.path.basename(image_path)
        print(f"[*] Processing {filename}...")
        
        # 1. Load Image
        img_cv2 = cv2.imread(image_path)
        if img_cv2 is None:
            print(f"[!] Could not read {image_path}")
            return
        
        img_rgb = cv2.cvtColor(img_cv2, cv2.COLOR_BGR2RGB)
        
        # 2. Estimate Metric Depth (Zoe)
        print("    -> Estimating Depth...")
        # Resize for model if necessary, but Zoe handles arbitrary sizes well
        pil_img = Image.fromarray(img_rgb)
        
        with torch.no_grad():
            if hasattr(self.depth_model, 'infer_pil'):
                depth_map = self.depth_model.infer_pil(pil_img) # Zoe API
            else:
                # MiDaS Fallback API
                transforms = torch.hub.load("intel-isl/MiDaS", "transforms").small_transform
                input_batch = transforms(img_cv2).to(self.device)
                prediction = self.depth_model(input_batch)
                prediction = torch.nn.functional.interpolate(
                    prediction.unsqueeze(1),
                    size=img_cv2.shape[:2],
                    mode="bicubic",
                    align_corners=False,
                ).squeeze()
                depth_map = prediction.cpu().numpy()

        # Normalize depth map to 0-1 for web usage, but keep relative scale internally?
        # For the web, we want 0 = close, 1 = far (or vice versa).
        depth_min = depth_map.min()
        depth_max = depth_map.max()
        depth_normalized = (depth_map - depth_min) / (depth_max - depth_min)

        # 3. Segment (SAM)
        print("    -> Segmenting strokes...")
        masks = self.mask_generator.generate(img_rgb)
        print(f"    -> Found {len(masks)} segments.")

        # 4. Construct 3D Data
        # We don't save the full masks (too big). We save "Strokes" (Quads).
        strokes_data = []
        
        for i, mask_data in enumerate(masks):
            mask = mask_data['segmentation']
            bbox = mask_data['bbox'] # [x, y, w, h]
            
            # Extract the texture for this stroke
            x, y, w, h = [int(v) for v in bbox]
            
            # Calculate average depth of this segment
            # We use the mask to mask the depth map
            segment_depths = depth_normalized[mask]
            if segment_depths.size == 0:
                continue
            avg_z = np.mean(segment_depths)
            
            # Get dominant color
            # (In a real version, we might extract a texture patch, but for now, color + noise)
            masked_pixels = img_rgb[mask]
            avg_color = np.mean(masked_pixels, axis=0) # RGB
            
            # Inpainting / Background check
            # If we were to remove this piece, what is behind it?
            # We use OpenCV Navier-Stokes inpainting to guess the "void" color
            # Create a small mask for inpainting logic (simplified for metadata)
            
            stroke = {
                "id": i,
                "bbox": [x, y, w, h],
                "z": float(avg_z),
                "area": int(mask_data['area']),
                "color": [int(c) for c in avg_color],
                "stability": float(mask_data['stability_score'])
            }
            strokes_data.append(stroke)

        # 5. Save Output
        if not os.path.exists(OUTPUT_DIR):
            os.makedirs(OUTPUT_DIR)
            
        out_name = os.path.splitext(filename)[0] + ".json"
        out_path = os.path.join(OUTPUT_DIR, out_name)
        
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
        print(f"[*] Saved analysis to {out_path}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=str, required=True, help="Path to input image")
    args = parser.parse_args()
    
    grinder = ArtGrinder()
    grinder.process_image(args.input)

if __name__ == "__main__":
    main()
