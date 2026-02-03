import os
import json
import cv2
import torch
import numpy as np
import math
from pathlib import Path

# --- CONFIGURATION ---
INPUT_DIR = "assets/raw"
OUTPUT_DIR = "public/data"
MANIFEST_FILE = "public/data/manifest.json"
STROKE_COUNT = 15000  
FOV = 75.0            
DEPTH_SCALE = 10.0    
MIN_DEPTH = 5.0       
MAX_DEPTH = 50.0      

# --- MATH KERNEL ---

def get_inverse_projection_matrix(width, height, fov):
    aspect = width / height
    near = 0.1
    top = near * math.tan(math.radians(fov) / 2)
    height_at_depth_1 = 2 * top
    width_at_depth_1 = height_at_depth_1 * aspect
    return width_at_depth_1, height_at_depth_1

def load_depth_model():
    print("Loading Depth Model...")
    model_type = "MiDaS_small" 
    midas = torch.hub.load("intel-isl/MiDaS", model_type)
    device = torch.device("cpu") # Force CPU for GitHub Actions
    midas.to(device)
    midas.eval()
    
    transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
    transform = transforms.small_transform if model_type == "MiDaS_small" else transforms.dpt_transform
    return midas, transform, device

def generate_strokes(image_path, stroke_count):
    img = cv2.imread(str(image_path))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w, _ = img.shape
    
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 100, 200)
    importance = cv2.GaussianBlur(edges, (21, 21), 0) + 50 
    importance = importance / importance.sum()
    
    flat_indices = np.random.choice(w*h, stroke_count, p=importance.flatten())
    y_coords, x_coords = np.unravel_index(flat_indices, (h, w))
    
    strokes = []
    base_size = math.sqrt((w * h) / stroke_count) * 2.0
    
    for x, y in zip(x_coords, y_coords):
        color = img[y, x]
        strokes.append({
            "u": int(x),
            "v": int(y),
            "r": int(color[0]),
            "g": int(color[1]),
            "b": int(color[2]),
            "size": base_size
        })
        
    return strokes, img

def process_image(image_file, depth_model_pack):
    midas, transform, device = depth_model_pack
    
    print(f"Processing {image_file.name}...")
    
    img_cv = cv2.imread(str(image_file))
    img_rgb = cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB)
    input_batch = transform(img_rgb).to(device)
    
    with torch.no_grad():
        prediction = midas(input_batch)
        prediction = torch.nn.functional.interpolate(
            prediction.unsqueeze(1),
            size=img_rgb.shape[:2],
            mode="bicubic",
            align_corners=False,
        ).squeeze()
    
    depth_map = prediction.cpu().numpy()
    d_min, d_max = depth_map.min(), depth_map.max()
    depth_map = (depth_map - d_min) / (d_max - d_min) 
    depth_map = depth_map * (MAX_DEPTH - MIN_DEPTH) + MIN_DEPTH 
    
    strokes_raw, original_img = generate_strokes(image_file, STROKE_COUNT)
    h, w, _ = original_img.shape
    
    w_at_1, h_at_1 = get_inverse_projection_matrix(w, h, FOV)
    
    processed_strokes = []
    
    for s in strokes_raw:
        u, v = s['u'], s['v']
        z_world = depth_map[v, u] * -1.0 
        u_norm = (u / w) - 0.5
        v_norm = (v / h) - 0.5
        v_norm = -v_norm 
        
        world_x = u_norm * w_at_1 * abs(z_world)
        world_y = v_norm * h_at_1 * abs(z_world)
        scale_factor = (s['size'] / h) * h_at_1 * abs(z_world)
        rotation = np.random.rand() * 3.14159
        
        processed_strokes.append(
            [
                round(float(world_x), 4),
                round(float(world_y), 4),
                round(float(z_world), 4),
                round(float(scale_factor), 4),
                round(float(rotation), 4),
                s['r'], s['g'], s['b']
            ]
        )
        
    return processed_strokes

def main():
    # 1. ALWAYS create the output directory first
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
    
    # 2. Check Input
    if not os.path.exists(INPUT_DIR):
        print(f"⚠️ Directory '{INPUT_DIR}' does not exist.")
        # Create empty manifest so the build doesn't fail
        with open(MANIFEST_FILE, 'w') as f:
            json.dump([], f)
        return

    valid_extensions = ('.png', '.jpg', '.jpeg')
    images = [f for f in os.listdir(INPUT_DIR) if f.lower().endswith(valid_extensions)]
    
    if not images:
        print("zzZ No images found in assets/raw.")
        with open(MANIFEST_FILE, 'w') as f:
            json.dump([], f)
        return

    # 3. Process if images exist
    depth_pack = load_depth_model()
    manifest = []
    
    for filename in images:
        file_path = Path(INPUT_DIR) / filename
        try:
            strokes_data = process_image(file_path, depth_pack)
            output_filename = f"{file_path.stem}.json"
            output_path = Path(OUTPUT_DIR) / output_filename
            
            with open(output_path, 'w') as f:
                json.dump(strokes_data, f)
                
            manifest.append({
                "id": file_path.stem,
                "src": f"data/{output_filename}",
                "title": file_path.stem.replace("_", " ").title(),
                "year": "2026" 
            })
        except Exception as e:
            print(f"❌ Failed to process {filename}: {e}")
            
    # 4. Save Final Manifest
    with open(MANIFEST_FILE, 'w') as f:
        json.dump(manifest, f, indent=2)
        
    print("Grinding Complete. The Void is populated.")

if __name__ == "__main__":
    main()
