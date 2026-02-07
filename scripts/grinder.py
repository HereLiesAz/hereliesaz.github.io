import argparse
import os
import json
import torch
import cv2
import numpy as np
import warnings
import sys
from pathlib import Path
from tqdm import tqdm
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

warnings.filterwarnings("ignore")

class ArtGrinder:
    def __init__(self, device_override=None, fast_mode=False):
        self.device = device_override if device_override else ('cuda' if torch.cuda.is_available() else 'cpu')
        self.fast_mode = fast_mode
        print(f"[*] Initializing ArtGrinder on {self.device} (Fast Mode: {self.fast_mode})...")
        
        # --- Load Depth (ZoeDepth -> MiDaS Fallback) ---
        self.depth_model = self._load_depth_model()
        self.depth_transform = self._load_depth_transform()

        # --- Load SAM ---
        print("[*] Loading SAM...")
        checkpoint = "sam_vit_b_01ec64.pth" 
        if not os.path.exists(checkpoint):
            print(f"[!] Downloading {checkpoint}...")
            torch.hub.download_url_to_file(
                "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
                checkpoint
            )
            
        sam = sam_model_registry["vit_b"](checkpoint=checkpoint)
        sam.to(device=self.device)
        
        # OPTIMIZATION: Reduce grid density for speed
        points = 16 if self.fast_mode else 32
        
        self.mask_generator = SamAutomaticMaskGenerator(
            model=sam,
            points_per_side=points, # <--- THE TURBO BUTTON
            pred_iou_thresh=0.86,
            stability_score_thresh=0.92,
            crop_n_layers=1,
            crop_n_points_downscale_factor=2,
            min_mask_region_area=100,
        )

    def _load_depth_model(self):
        try:
            return torch.hub.load("isl-org/ZoeDepth", "ZoeD_N", pretrained=True).to(self.device).eval()
        except Exception:
            return torch.hub.load("intel-isl/MiDaS", "DPT_Large").to(self.device).eval()

    def _load_depth_transform(self):
        transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
        return transforms.dpt_transform if self.device == 'cuda' else transforms.small_transform

    def get_depth_map(self, img_rgb):
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
        return (depth - d_min) / (d_max - d_min) if (d_max - d_min) > 1e-8 else np.zeros_like(depth)

    def grind(self, image_path, output_dir):
        path = Path(image_path)
        output_file = Path(output_dir) / f"{path.name}.json"
        
        if output_file.exists(): return

        try:
            img_cv2 = cv2.imread(str(path))
            if img_cv2 is None: return
            img_rgb = cv2.cvtColor(img_cv2, cv2.COLOR_BGR2RGB)
            
            # OPTIMIZATION: Aggressive Downscaling
            h, w = img_rgb.shape[:2]
            max_dim = 512 if self.fast_mode else 1024  # <--- THE TURBO BUTTON
            
            if max(h, w) > max_dim:
                scale = max_dim / max(h, w)
                img_rgb = cv2.resize(img_rgb, (int(w * scale), int(h * scale)))
            
            depth_map = self.get_depth_map(img_rgb)
            masks = self.mask_generator.generate(img_rgb)
            
            strokes = []
            for m in masks:
                mask = m['segmentation']
                y_idx, x_idx = np.where(mask)
                if len(y_idx) == 0: continue
                
                avg_color = img_rgb[y_idx, x_idx].mean(axis=0).astype(int).tolist()
                z_val = depth_map[y_idx, x_idx].mean()
                
                # Use compressed keys ("c", "b", "z", "s")
                strokes.append({
                    "c": avg_color,
                    "b": [int(x) for x in m['bbox']], 
                    "z": float(z_val),
                    "s": float(m['stability_score'])
                })

            with open(output_file, 'w') as f:
                json.dump({"meta": {"f": path.name}, "s": strokes}, f)
                
            print(f"[+] Processed {path.name} ({len(strokes)} strokes)")
            
        except Exception as e:
            print(f"[!] Failed {path.name}: {e}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", default="public/data")
    parser.add_argument("--shard_index", type=int, default=0)
    parser.add_argument("--total_shards", type=int, default=1)
    parser.add_argument("--fast", action="store_true", help="Enable Turbo Mode") # <--- THIS LINE IS MISSING ON YOUR SERVER
    args = parser.parse_args()

    input_path = Path(args.input)
    
    if input_path.is_dir():
        valid_exts = {'.jpg', '.jpeg', '.png', '.webp'}
        all_files = sorted([p for p in input_path.iterdir() if p.suffix.lower() in valid_exts])
    else:
        all_files = [input_path]

    my_files = all_files[args.shard_index::args.total_shards]
    
    print(f"[*] Worker {args.shard_index}/{args.total_shards} processing {len(my_files)} files.")

    os.makedirs(args.out, exist_ok=True)
    grinder = ArtGrinder(fast_mode=args.fast)
    
    for img_file in tqdm(my_files, desc=f"Shard {args.shard_index}"):
        grinder.grind(img_file, args.out)

if __name__ == "__main__":
    main()
