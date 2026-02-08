import os
import json
import torch
import cv2
import numpy as np
import warnings
import random
from pathlib import Path
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

# --- CONFIGURATION ---
INPUT_DIR = Path("assets/raw")
OUTPUT_DIR = Path("public/data")
MANIFEST_PATH = Path("public/manifest.json") 
LIMIT = 5

warnings.filterwarnings("ignore")

def main():
    print(f"[*] Bootstrapping the Void (Random {LIMIT} images)...")

    if not OUTPUT_DIR.exists():
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    valid_exts = {'.jpg', '.jpeg', '.png', '.webp'}
    if not INPUT_DIR.exists():
        print(f"[!] Error: {INPUT_DIR} missing.")
        return

    all_files = sorted([p for p in INPUT_DIR.iterdir() if p.suffix.lower() in valid_exts])
    
    if not all_files:
        print("[!] No images found.")
        return

    # --- RANDOM SELECTION ---
    if len(all_files) > LIMIT:
        selected_files = random.sample(all_files, LIMIT)
    else:
        selected_files = all_files

    print(f"[*] Selected: {[f.name for f in selected_files]}")

    # --- AI SETUP ---
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"[*] AI Device: {device}")

    try:
        depth_model = torch.hub.load("intel-isl/MiDaS", "DPT_Large").to(device).eval()
        depth_transform = torch.hub.load("intel-isl/MiDaS", "transforms").dpt_transform
    except:
        print("[!] Depth model failed. Check internet.")
        return

    checkpoint = "sam_vit_b_01ec64.pth"
    if not os.path.exists(checkpoint):
        torch.hub.download_url_to_file("https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth", checkpoint)

    sam = sam_model_registry["vit_b"](checkpoint=checkpoint)
    sam.to(device=device)
    mask_generator = SamAutomaticMaskGenerator(sam, points_per_side=16)

    # --- PROCESSING ---
    nodes = []

    for idx, img_path in enumerate(selected_files):
        print(f"[{idx+1}/{len(selected_files)}] Processing {img_path.name}...")
        
        try:
            img_cv2 = cv2.imread(str(img_path))
            if img_cv2 is None: continue
            img_rgb = cv2.cvtColor(img_cv2, cv2.COLOR_BGR2RGB)

            # Resize to 512px max
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

            # Masks
            masks = mask_generator.generate(img_rgb)
            strokes = []
            for m in masks:
                mask = m['segmentation']
                y, x = np.where(mask)
                if len(y) == 0: continue
                
                strokes.append({
                    "color": img_rgb[y, x].mean(axis=0).astype(int).tolist(),
                    "bbox": [int(v) for v in m['bbox']],
                    "z": float(depth_map[y, x].mean()),
                    "stability": float(m['stability_score'])
                })

            out_name = f"{img_path.name}.json"
            with open(OUTPUT_DIR / out_name, 'w') as f:
                json.dump({
                    "meta": {"file": img_path.name, "res": [img_rgb.shape[1], img_rgb.shape[0]]}, 
                    "strokes": strokes
                }, f)

            # Append to list
            nodes.append({
                "id": img_path.stem,
                "file": out_name,
                "strokes": len(strokes),
                "res": [img_rgb.shape[1], img_rgb.shape[0]],
                "neighbors": [] 
            })

        except Exception as e:
            print(f"[!] Failed {img_path.name}: {e}")

    # --- LINKING & SAVING ---
    total = len(nodes)
    for i, node in enumerate(nodes):
        node["neighbors"] = [
            nodes[(i - 1) % total]["id"], 
            nodes[(i + 1) % total]["id"]
        ]

    # Dump as ARRAY
    with open(MANIFEST_PATH, 'w') as f:
        json.dump(nodes, f, indent=2)

    print(f"[*] SUCCESS. Manifest (Array format) saved to {MANIFEST_PATH}")

if __name__ == "__main__":
    main()
