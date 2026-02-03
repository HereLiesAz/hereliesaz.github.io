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
STROKE_COUNT = 15000  # Number of strokes per painting
FOV = 75.0            # Camera Field of View (degrees)
DEPTH_SCALE = 10.0    # World units multiplier for depth map
MIN_DEPTH = 5.0       # Closest stroke distance
MAX_DEPTH = 50.0      # Furthest stroke distance

# --- MATH KERNEL ---

def get_inverse_projection_matrix(width, height, fov):
    """
    Simulates the inverse of a standard WebGL perspective projection matrix.
    We use this to "unproject" 2D pixels back into 3D world space.
    """
    aspect = width / height
    near = 0.1
    far = 1000.0
    top = near * math.tan(math.radians(fov) / 2)
    height_at_depth_1 = 2 * top
    width_at_depth_1 = height_at_depth_1 * aspect
    return width_at_depth_1, height_at_depth_1

def load_depth_model():
    """
    Loads MiDaS or ZoeDepth for monocular depth estimation.
    Using MiDaS small here for portability, but ZoeDepth is preferred for metric accuracy.
    """
    print("Loading Depth Model...")
    model_type = "MiDaS_small" 
    midas = torch.hub.load("intel-isl/MiDaS", model_type)
    device = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")
    midas.to(device)
    midas.eval()
    
    transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
    transform = transforms.small_transform if model_type == "MiDaS_small" else transforms.dpt_transform
    return midas, transform, device

def generate_strokes(image_path, stroke_count):
    """
    Decomposes an image into a list of "strokes".
    Uses a probabalistic sampling method based on edge density (strokes cluster near details).
    """
    img = cv2.imread(str(image_path))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w, _ = img.shape
    
    # Generate importance map (edges get more strokes)
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 100, 200)
    # Blur to spread importance
    importance = cv2.GaussianBlur(edges, (21, 21), 0) + 50 # Add base probability
    importance = importance / importance.sum()
    
    # Flatten and sample indices based on importance
    flat_indices = np.random.choice(w*h, stroke_count, p=importance.flatten())
    y_coords, x_coords = np.unravel_index(flat_indices, (h, w))
    
    strokes = []
    
    # Calculate base size relative to image area
    base_size = math.sqrt((w * h) / stroke_count) * 2.0
    
    for x, y in zip(x_coords, y_coords):
        color = img[y, x]
        # Basic stroke orientation based on local gradient could be added here
        # For now, we store just the center and color
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
    
    # 1. Generate Depth Map
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
    
    # Normalize depth to desired world range (Metric Depth approximation)
    d_min, d_max = depth_map.min(), depth_map.max()
    depth_map = (depth_map - d_min) / (d_max - d_min) # 0 to 1
    depth_map = depth_map * (MAX_DEPTH - MIN_DEPTH) + MIN_DEPTH # Map to World Z
    
    # 2. Generate Strokes
    strokes_raw, original_img = generate_strokes(image_file, STROKE_COUNT)
    h, w, _ = original_img.shape
    
    # 3. Inverse Projection & Scale Compensation
    # Viewport dimensions at Z=1 for FOV 75
    w_at_1, h_at_1 = get_inverse_projection_matrix(w, h, FOV)
    
    processed_strokes = []
    
    for s in strokes_raw:
        u, v = s['u'], s['v']
        
        # Sample Depth at stroke center
        z_world = depth_map[v, u] * -1.0 # OpenGL Z is negative into screen
        
        # Normalize 2D coordinates (-0.5 to 0.5)
        # We assume image center is (0,0)
        u_norm = (u / w) - 0.5
        v_norm = (v / h) - 0.5
        v_norm = -v_norm # Flip Y for WebGL
        
        # Unproject to World X, Y
        # Formula: x = u_norm * width_at_depth_1 * abs(z)
        world_x = u_norm * w_at_1 * abs(z_world)
        world_y = v_norm * h_at_1 * abs(z_world)
        
        # Scale Compensation
        # A stroke of 'size' pixels needs to be scaled up as it gets further away
        # to maintain its apparent 2D size.
        # Scale factor is linear with depth.
        scale_factor = (s['size'] / h) * h_at_1 * abs(z_world)
        
        # Random Rotation (Entropy for the "exploded" feel)
        rotation = np.random.rand() * 3.14159
        
        processed_strokes.append(
            # Compact list for JSON: x, y, z, scale, rotation, r, g, b
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
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
    depth_pack = load_depth_model()
    
    manifest = []
    
    # Scan Input Directory
    for filename in os.listdir(INPUT_DIR):
        if filename.lower().endswith(('.png', '.jpg', '.jpeg')):
            file_path = Path(INPUT_DIR) / filename
            
            # Process
            strokes_data = process_image(file_path, depth_pack)
            
            # Save Stroke Data
            output_filename = f"{file_path.stem}.json"
            output_path = Path(OUTPUT_DIR) / output_filename
            
            with open(output_path, 'w') as f:
                json.dump(strokes_data, f)
                
            # Add to Manifest
            manifest.append({
                "id": file_path.stem,
                "src": f"data/{output_filename}",
                "title": file_path.stem.replace("_", " ").title(),
                "year": "2026" # Placeholder, could parse from filename
            })
            
    # Save Manifest
    with open(MANIFEST_FILE, 'w') as f:
        json.dump(manifest, f, indent=2)
        
    print("Grinding Complete. The Void is populated.")

if __name__ == "__main__":
    main()
