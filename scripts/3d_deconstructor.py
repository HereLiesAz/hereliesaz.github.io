import argparse
import os
import json
import torch
import cv2
import numpy as np
from pathlib import Path
from tqdm import tqdm
from PIL import Image, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True

# Attempt to load specialized models
try:
    from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
    SAM_AVAILABLE = True
except ImportError:
    SAM_AVAILABLE = False

class ThreeDDeconstructor:
    def __init__(self, device="cuda"):
        self.device = device if torch.cuda.is_available() else "cpu"
        print(f"[*] Initializing 3D Deconstructor on {self.device}...")
        
        # 1. Load Depth (MiDaS Small for speed/reliability)
        self.depth_model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small").to(self.device).eval()
        self.depth_transforms = torch.hub.load("intel-isl/MiDaS", "transforms").small_transform

        # 2. Load SAM (for Feature Extraction)
        if SAM_AVAILABLE:
            checkpoint = "sam_vit_b_01ec64.pth"
            if os.path.exists(checkpoint):
                sam = sam_model_registry["vit_b"](checkpoint=checkpoint)
                sam.to(device=self.device)
                self.mask_generator = SamAutomaticMaskGenerator(
                    model=sam,
                    points_per_side=32,
                    pred_iou_thresh=0.86,
                    stability_score_thresh=0.92,
                    min_mask_region_area=500,
                )
            else:
                print(f"[!] SAM checkpoint {checkpoint} not found. Skipping SAM features.")
                self.mask_generator = None
        else:
            self.mask_generator = None

    def get_depth_map(self, img_rgb):
        input_batch = self.depth_transforms(img_rgb).to(self.device)
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

    def deconstruct(self, image_path, out_dir):
        path = Path(image_path)
        img_pil = Image.open(image_path).convert("RGB")
        img_np = np.array(img_pil)
        h, w = img_np.shape[:2]

        print(f"[*] Deconstructing {path.name}...")
        depth_map = self.get_depth_map(img_np)

        # 1. Feature Extraction (SAM + Luminance)
        masks = []
        if self.mask_generator:
            masks = self.mask_generator.generate(img_np)
        
        # Add Luminance-based "Reason" (High contrast lighting)
        gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
        _, light_mask = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(light_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours:
            if cv2.contourArea(cnt) > 1000:
                m = np.zeros((h, w), dtype=np.uint8)
                cv2.drawContours(m, [cnt], -1, 255, -1)
                masks.append({'segmentation': m.astype(bool), 'bbox': cv2.boundingRect(cnt)})

        # 2. Extract Liquidy Slices (Semantic Layers)
        slices = []
        
        # Filter and sort masks by size to get major features
        valid_masks = [m for m in masks if np.sum(m['segmentation']) > (w * h * 0.005)] # At least 0.5% of image
        valid_masks.sort(key=lambda x: np.sum(x['segmentation']), reverse=True)
        
        # LIMIT to top 15 features to keep it "Liquidy" and not "Sharded"
        for i, m in enumerate(valid_masks[:15]):
            seg = m['segmentation']
            rx, ry, rw, rh = m['bbox']
            
            # Sample depth for this specific layer
            mask_depth = depth_map[seg]
            z_mean = float(np.mean(mask_depth))
            z_var = float(np.std(mask_depth))
            
            # 2. Interleaved Centered Distribution (Mirroring)
            # Instead of 0..-20, we use -22..+22 to overlap with BOTH neighbors
            # SEGMENT_LENGTH is 21.44, so 22.0 provides slight overlap
            z_spread = (z_mean - 0.5) * 44.0 
            
            # Random variance for variety
            r = [random.random() for _ in range(3)]
            
            slices.append({
                "b": [int(rx), int(ry), int(rw), int(rh)], # Bounding box for UV mapping
                "z": z_spread,      # Centered interleaved Z
                "zl": z_mean,       # Component mean depth (structural)
                "zv": z_var,        # Component depth variance
                "r": r              # Random factors for shader noise
            })

        # Save refined deconstruction
        out_file = out_dir / f"{path.stem}.baked.json"
        with open(out_file, 'w') as f:
            json.dump({
                "id": path.stem,
                "res": [w, h],
                "count": len(slices),
                "slices": slices
            }, f, separators=(',', ':'))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="assets/raw")
    parser.add_argument("--out", default="public/data/baked")
    args = parser.parse_args()

    in_dir = Path(args.input)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    deconstructor = ThreeDDeconstructor()
    images = sorted([f for f in in_dir.iterdir() if f.suffix.lower() in ['.jpg', '.jpeg', '.png', '.webp']])
    
    # LIMIT to first 5 for initial high-fidelity test
    process_list = images[:5]
    
    for img in tqdm(process_list):
        try:
            deconstructor.deconstruct(img, out_dir)
        except Exception as e:
            print(f"[!] Critical error on {img.name}: {e}")

if __name__ == "__main__":
    main()
