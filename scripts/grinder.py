import argparse
import os
import json
import torch
import cv2
import numpy as np
import warnings
from pathlib import Path
from PIL import Image
from tqdm import tqdm
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

# Suppress the noise. We want art, not warnings.
warnings.filterwarnings("ignore")

class ArtGrinder:
    def __init__(self, device='cuda' if torch.cuda.is_available() else 'cpu'):
        self.device = device
        print(f"[*] Initializing ArtGrinder on {self.device}...")
        
        # --- 1. Load Depth Estimator (The Z-Axis) ---
        self.depth_model = self._load_depth_model()
        self.depth_transform = self._load_depth_transform()

        # --- 2. Load Segment Anything (The Atomizer) ---
        print("[*] Loading SAM (Segment Anything)...")
        # specific checkpoint fallback
        checkpoint = "sam_vit_b_01ec64.pth" 
        if not os.path.exists(checkpoint):
            print(f"[!] Checkpoint {checkpoint} not found. Downloading...")
            torch.hub.download_url_to_file(
                "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
                checkpoint
            )
            
        sam = sam_model_registry["vit_b"](checkpoint=checkpoint)
        sam.to(device=self.device)
        self.mask_generator = SamAutomaticMaskGenerator(
            model=sam,
            points_per_side=32,
            pred_iou_thresh=0.86,
            stability_score_thresh=0.92,
            crop_n_layers=1,
            crop_n_points_downscale_factor=2,
            min_mask_region_area=100,
        )

    def _load_depth_model(self):
        """Attempts to load ZoeDepth, falls back to MiDaS."""
        print("[*] Loading Depth Estimator...")
        try:
            # Try ZoeDepth first (Better metric depth)
            model = torch.hub.load("isl-org/ZoeDepth", "ZoeD_N", pretrained=True)
        except Exception as e:
            print(f"[!] ZoeDepth failed ({str(e)[:50]}...). Fallback to MiDaS.")
            # Fallback to DPT (Dense Prediction Transformer)
            model = torch.hub.load("intel-isl/MiDaS", "DPT_Large")
        
        model.to(self.device)
        model.eval()
        return model

    def _load_depth_transform(self):
        # MiDaS transforms are standardized
        midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
        if self.device == 'cuda':
            return midas_transforms.dpt_transform
        return midas_transforms.small_transform

    def get_depth_map(self, img_rgb):
        """Extracts a normalized depth map (0.0 to 1.0)."""
        input_batch = self.depth_transform(img_rgb).to(self.device)
        
        with torch.no_grad():
            prediction = self.depth_model(input_batch)
            
            # Interpolate to original size
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1),
                size=img_rgb.shape[:2],
                mode="bicubic",
                align_corners=False,
            ).squeeze()

        depth = prediction.cpu().numpy()
        
        # Normalize (Near=1.0, Far=0.0)
        depth_min = depth.min()
        depth_max = depth.max()
        if depth_max - depth_min > 1e-8:
            depth = (depth - depth_min) / (depth_max - depth_min)
        else:
            depth = np.zeros_like(depth)
            
        return depth

    def grind(self, image_path, output_dir):
        """The meat grinder. Turns an image into a stroke cloud."""
        path = Path(image_path)
        output_file = Path(output_dir) / f"{path.name}.json"
        
        if output_file.exists():
            print(f"[->] Skipping {path.name} (Already ground).")
            return

        print(f"[*] Grinding {path.name}...")
        
        # 1. Read Image
        img_cv2 = cv2.imread(str(path))
        if img_cv2 is None:
            print(f"[!] Failed to read {path}")
            return
        img_rgb = cv2.cvtColor(img_cv2, cv2.COLOR_BGR2RGB)
        
        # 2. Get Depth
        depth_map = self.get_depth_map(img_rgb)
        
        # 3. Get Segments
        masks = self.mask_generator.generate(img_rgb)
        
        # 4. Serialize Strokes
        strokes = []
        
        for mask_data in masks:
            # mask_data keys: 'segmentation', 'bbox', 'predicted_iou', 'stability_score'
            mask = mask_data['segmentation']
            bbox = mask_data['bbox'] # [x, y, w, h]
            
            # Extract color (average of masked area)
            # This is faster than masking the whole array
            y_indices, x_indices = np.where(mask)
            if len(y_indices) == 0: continue
            
            colors = img_rgb[y_indices, x_indices]
            avg_color = colors.mean(axis=0).astype(int).tolist()
            
            # Extract depth (average z of masked area)
            z_val = depth_map[y_indices, x_indices].mean()
            
            strokes.append({
                "color": avg_color,
                "bbox": [int(b) for b in bbox],
                "z": float(z_val),
                "stability": float(mask_data['stability_score'])
            })

        # 5. Save Payload
        payload = {
            "meta": {
                "file": path.name,
                "resolution": [img_rgb.shape[1], img_rgb.shape[0]],
                "stroke_count": len(strokes)
            },
            "strokes": strokes
        }
        
        os.makedirs(output_dir, exist_ok=True)
        with open(output_file, 'w') as f:
            json.dump(payload, f) # Minify to save space? No, let's keep it readable for now.
            
        print(f"[+] Saved {len(strokes)} strokes to {output_file}")

def main():
    parser = argparse.ArgumentParser(description="The Grinder: Deconstructs reality into JSON.")
    parser.add_argument("--input", required=True, help="Path to image OR directory of images")
    parser.add_argument("--out", default="public/data", help="Where to spit out the data")
    args = parser.parse_args()

    input_path = Path(args.input)
    
    if not input_path.exists():
        print(f"[!] Error: {input_path} does not exist.")
        return

    # Initialize the machine
    grinder = ArtGrinder()

    # Determine diet (Single File vs Buffet)
    files_to_process = []
    if input_path.is_dir():
        # Eat everything that looks like an image
        valid_exts = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'}
        files_to_process = [p for p in input_path.iterdir() if p.suffix.lower() in valid_exts]
        print(f"[*] Found {len(files_to_process)} images in directory.")
    else:
        files_to_process = [input_path]

    # Process
    if not files_to_process:
        print("[!] No images found to process.")
        return

    for img_file in tqdm(files_to_process, desc="Grinding Assets"):
        try:
            grinder.grind(img_file, args.out)
        except Exception as e:
            print(f"[!] Failed to grind {img_file.name}: {e}")
            # Keep going, don't crash the whole batch
            continue

    print("[*] Grinding complete. Run 'python scripts/indexer.py' next.")

if __name__ == "__main__":
    main()
