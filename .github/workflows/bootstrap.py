import os
import json
import torch
import cv2
import numpy as np
import warnings
from pathlib import Path
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

# --- CONFIGURATION ---
INPUT_DIR = Path("assets/raw")
OUTPUT_DIR = Path("public/data")
LIMIT = 5  # <--- The Magic Number

# Suppress warnings
warnings.filterwarnings("ignore")

def main():
    print(f"[*] Bootstrapping the Void with {LIMIT} artifacts...")

    # 1. Clean Output Directory
    if OUTPUT_DIR.exists():
        for f in OUTPUT_DIR.glob("*.json"):
            f.unlink()
    else:
        OUTPUT_DIR.mkdir(parents=True)

    # 2. Find Images
    valid_exts = {'.jpg', '.jpeg', '.png', '.webp'}
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
    except:
        print("[!] Depth load failed. Check internet.")
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
        print(f"[{idx+1}/{LIMIT}] Grinding {img_path.name}...")
        
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
            
            with open(out_path, 'w') as f:
                json.dump({
                    "meta": {"file": img_path.name, "resolution": [w, h]}, 
                    "strokes": strokes
                }, f)
            
            # Add to Index
            nodes.append({
                "id": img_path.stem,
                "file": out_name,
                "strokes": len(strokes),
                "res": [w, h]
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
    
    manifest = {
        "generated_at": "BOOTSTRAP_MODE",
        "total_nodes": total,
        "nodes": nodes
    }
    
    with open(OUTPUT_DIR.parent / "manifest.json", 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"[*] Done. Manifest created with {total} nodes.")
    print("[*] Restart your dev server and check the browser.")

if __name__ == "__main__":
    main()
