import os
import json
import torch
import cv2
import numpy as np
import warnings
import argparse
from pathlib import Path
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

# --- CONFIGURATION ---
INPUT_DIR = Path("assets/raw")
OUTPUT_DIR = Path("public/data")
LIMIT = 5  # Limits processing to 5 images for testing

# Suppress warnings
warnings.filterwarnings("ignore")

def main():
    print(f"[*] Bootstrapping the Void with max {LIMIT} artifacts...")

    # 1. Clean/Create Output Directory
    if not OUTPUT_DIR.exists():
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 2. Find Images
    valid_exts = {'.jpg', '.jpeg', '.png', '.webp'}
    if not INPUT_DIR.exists():
        print(f"[!] Error: Input directory {INPUT_DIR} does not exist.")
        return

    all_files = sorted([p for p in INPUT_DIR.iterdir() if p.suffix.lower() in valid_exts])
    
    if not all_files:
        print("[!] No images found in assets/raw!")
        return

    selected_files = all_files[:LIMIT]
    print(f"[*] Selected: {[f.name for f in selected_files]}")

    # 3. Initialize AI (The Brains)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"[*] Loading AI on {device}...")
    
    # Load Depth (MiDaS simple fallback)
    try:
        depth_model = torch.hub.load("intel-isl/MiDaS", "DPT_Large").to(device).eval()
        depth_transform = torch.hub.load("intel-isl/MiDaS", "transforms").dpt_transform
    except Exception as e:
        print(f"[!] Depth load failed: {e}")
        return

    # Load SAM
    checkpoint = "sam_vit_b_01ec64.pth" 
    if not os.path.exists(checkpoint):
        print("[!] Downloading SAM weights...")
        torch.hub.download_url_to_file(
            "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
            checkpoint
        )
    
    sam = sam_model_registry["vit_b"](checkpoint=checkpoint)
    sam.to(device=device)
    # Low density for speed
    mask_generator = SamAutomaticMaskGenerator(sam, points_per_side=16) 

    nodes = []

    # 4. The Loop
    for idx, img_path in enumerate(selected_files):
        print(f"[{idx+1}/{len(selected_files)}] Grinding {img_path.name}...")
        
        try:
            # Read
            img_cv2 = cv2.imread(str(img_path))
            if img_cv2 is None: continue
            img_rgb = cv2.cvtColor(img_cv2, cv2.COLOR_BGR2RGB)
            
            # Resize (Max 512px)
            h, w = img_rgb.shape[:2]
            max_dim = 512
            if max(h, w) > max_dim:
                scale = max_dim / max(h, w)
                img_rgb = cv2.resize(img_rgb, (int(w * scale), int(h * scale)))

            # Depth
            input_batch = depth_transform(img_rgb).to(device)
            with torch.no_grad():
                prediction = depth_model(input_batch)
                prediction = torch.nn.functional.interpolate(
                    prediction.unsqueeze(1), size=img_rgb.shape[:2], mode="bicubic", align_corners=False
                ).squeeze()
            depth_raw = prediction.cpu().numpy()
            d_min, d_max = depth_raw.min(), depth_raw.max()
            depth_map = (depth_raw - d_min) / (d_max - d_min) if (d_max - d_min) > 0 else np.zeros_like(depth_raw)

            # Segmentation
            masks = mask_generator.generate(img_rgb)
            
            strokes = []
            for m in masks:
                mask = m['segmentation']
                y, x = np.where(mask)
                if len(y) == 0: continue
                
                # VERBOSE KEYS (Safety First)
                strokes.append({
                    "color": img_rgb[y, x].mean(axis=0).astype(int).tolist(),
                    "bbox": [int(v) for v in m['bbox']],
                    "z": float(depth_map[y, x].mean()),
                    "stability": float(m['stability_score'])
                })

            # Save JSON
            out_name = f"{img_path.name}.json"
            out_path = OUTPUT_DIR / out_name
            
            # Write stroke file
            with open(out_path, 'w') as f:
                json.dump({
                    "meta": {"file": img_path.name, "resolution": [img_rgb.shape[1], img_rgb.shape[0]]}, 
                    "strokes": strokes
                }, f)
            
            # Add to Index
            nodes.append({
                "id": img_path.stem,
                "file": out_name,
                "strokes": len(strokes),
                "res": [img_rgb.shape[1], img_rgb.shape[0]]
            })
            
        except Exception as e:
            print(f"[!] Failed {img_path.name}: {e}")

    # 5. Write Manifest
    # Link them in a circle
    total = len(nodes)
    if total > 0:
        for i, node in enumerate(nodes):
            node["neighbors"] = [
                nodes[(i - 1) % total]["id"], 
                nodes[(i + 1) % total]["id"]
            ]
    
    # Save Manifest to public/ (parent of public/data)
    manifest_path = OUTPUT_DIR.parent / "manifest.json"
    manifest = {
        "generated_at": "BOOTSTRAP_MODE",
        "total_nodes": total,
        "nodes": nodes
    }
    
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"[*] Done. Manifest created with {total} nodes at {manifest_path}")

if __name__ == "__main__":
    main()
