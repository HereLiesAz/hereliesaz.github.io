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

        # 2. Haphazard Slicing (Turn features into strips)
        slices = []
        for m in masks:
            mask = m['segmentation']
            bbox = [int(v) for v in m['bbox']]
            x, y, sw, sh = bbox
            
            # Split features into 1-4 haphazard strips
            num_strips = np.random.randint(2, 5)
            for _ in range(num_strips):
                # Random "strip" within the feature
                # We use a noisy rect within the mask
                rx = x + np.random.randint(0, sw // 2)
                ry = y + np.random.randint(0, sh // 2)
                rw = np.random.randint(sw // 2, sw + 1)
                rh = np.random.randint(sh // 2, sh + 1)
                
                # Clip to image
                rx, ry = max(0, rx), max(0, ry)
                rw = min(w - rx, rw)
                rh = min(h - ry, rh)

                # Each strip gets a random Z-offset in a deep field
                # Spanned across adjacent painting spaces (-50 to +50 units)
                z_offset = (np.random.random() - 0.5) * 100.0
                
                # Calculate mean depth in this strip
                z_local = float(np.mean(depth_map[ry:ry+rh, rx:rx+rw]))

                slices.append({
                    "b": [rx, ry, rw, rh],
                    "z": z_offset,
                    "zl": z_local, # internal displacement scale
                    "r": [np.random.random() for _ in range(3)] # entropy
                })

        # Minify output
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
    images = sorted([f for f in in_dir.iterdir() if f.suffix.lower() in ['.jpg', '.png', '.webp']])
    
    # LIMIT to first 40 for initial high-fidelity test
    process_list = images[:40]
    
    for img in tqdm(process_list):
        try:
            deconstructor.deconstruct(img, out_dir)
        except Exception as e:
            print(f"[!] Critical error on {img.name}: {e}")

if __name__ == "__main__":
    main()
