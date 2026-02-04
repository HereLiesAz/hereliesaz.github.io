import os
import argparse
import json
import cv2
import numpy as np
import torch
import warnings
from PIL import Image

# Suppress the noise
warnings.filterwarnings("ignore")

class ArtGrinder:
    def __init__(self):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[*] Grinder initialized on: {self.device}")
        
        # 1. Load Depth Model (MiDaS Small for efficiency)
        try:
            print("[*] Loading Depth Model (MiDaS)...")
            self.depth_model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small").to(self.device)
            self.depth_model.eval()
            
            # MiDaS transforms
            midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
            self.depth_transform = midas_transforms.small_transform
            self.has_depth = True
        except Exception as e:
            print(f"[!] Failed to load Depth Model: {e}")
            self.has_depth = False

        # 2. Load SAM (Segment Anything)
        try:
            print("[*] Loading SAM (Segment Anything)...")
            from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
            
            # Use 'vit_b' (base) or 'vit_l' depending on what you downloaded. 
            # For GitHub Actions CPU, we might need to rely on a smaller checkpoint or fallback.
            # Assuming the workflow installs the default, we'll try to load 'vit_b'.
            # If no checkpoint file is present, we might need to download it or fallback.
            
            # NOTE: In a CI env without a checkpoint file, SAM will fail. 
            # We will implement a fallback segmenter (Grid/Contours) just in case.
            
            # Check for checkpoint, otherwise fallback immediately to save time
            chk_path = "sam_vit_b_01ec64.pth"
            if not os.path.exists(chk_path):
                # Auto-download if missing (optional, but good for CI)
                print("    -> Downloading SAM Checkpoint...")
                torch.hub.download_url_to_file("https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth", chk_path)

            sam = sam_model_registry["vit_b"](checkpoint=chk_path)
            sam.to(device=self.device)
            self.mask_generator = SamAutomaticMaskGenerator(sam)
            self.has_sam = True
        except Exception as e:
            print(f"[!] SAM load failed (running in fallback mode): {e}")
            self.has_sam = False

    def estimate_depth(self, img_rgb):
        if not self.has_depth:
            h, w, _ = img_rgb.shape
            return np.ones((h, w), dtype=np.float32) * 0.5

        try:
            input_batch = self.depth_transform(img_rgb).to(self.device)
            with torch.no_grad():
                prediction = self.depth_model(input_batch)
                prediction = torch.nn.functional.interpolate(
                    prediction.unsqueeze(1),
                    size=img_rgb.shape[:2],
                    mode="bicubic",
                    align_corners=False,
                ).squeeze()
            return prediction.cpu().numpy()
        except Exception as e:
            print(f"    [!] Depth inference error: {e}")
            h, w, _ = img_rgb.shape
            return np.ones((h, w), dtype=np.float32) * 0.5

    def get_segments(self, img_rgb):
        """
        Returns a list of masks (binary arrays) or bounding boxes.
        """
        if self.has_sam:
            try:
                masks = self.mask_generator.generate(img_rgb)
                return masks # SAM returns list of dicts with 'segmentation', 'bbox', etc.
            except Exception as e:
                print(f"    [!] SAM inference error: {e}")
        
        # FALLBACK: Grid Segmentation (Deconstructivism via Brutalism)
        print("    -> Using Fallback Grid Segmentation")
        h, w, _ = img_rgb.shape
        grid_size = 32
        masks = []
        for y in range(0, h, grid_size):
            for x in range(0, w, grid_size):
                # Create a fake SAM-like object
                bbox = [x, y, min(grid_size, w-x), min(grid_size, h-y)]
                masks.append({
                    'bbox': bbox,
                    'area': bbox[2] * bbox[3],
                    'predicted_iou': 1.0,
                    'stability_score': 1.0,
                    # We don't need the full boolean mask for the simple grinder, just bbox
                    # but if we needed it:
                    # 'segmentation': ...
                })
        return masks

    def process_image(self, input_path):
        filename = os.path.basename(input_path)
        print(f"[*] Processing {filename}...")

        # 1. Read Image
        img_cv2 = cv2.imread(input_path)
        if img_cv2 is None:
            print(f"[!] Could not read file: {input_path}")
            return

        img_rgb = cv2.cvtColor(img_cv2, cv2.COLOR_BGR2RGB)
        h, w, _ = img_rgb.shape

        # 2. Depth
        print("    -> Estimating Depth...")
        depth_map = self.estimate_depth(img_rgb) # Guaranteed to return something now

        # Normalize Depth (0 to 1)
        d_min, d_max = depth_map.min(), depth_map.max()
        if d_max - d_min > 0:
            depth_map = (depth_map - d_min) / (d_max - d_min)
        else:
            depth_map = np.zeros_like(depth_map)

        # 3. Segmentation
        print("    -> Segmenting...")
        masks = self.get_segments(img_rgb)
        
        strokes = []
        
        # 4. Grind Data
        print(f"    -> Grinding {len(masks)} fragments...")
        for mask_data in masks:
            # Extract Bounding Box
            x, y, mw, mh = map(int, mask_data['bbox'])
            
            # Safety Check
            if mw <= 0 or mh <= 0: continue
            
            # Extract Average Color
            # We treat the bbox as the "stroke" area
            roi = img_rgb[y:y+mh, x:x+mw]
            avg_color = roi.mean(axis=(0,1)).astype(int).tolist()
            
            # Extract Average Depth in this region
            roi_depth = depth_map[y:y+mh, x:x+mw]
            avg_z = float(roi_depth.mean())
            
            # Stability (Entropy)
            stability = float(mask_data.get('stability_score', 0.5))

            strokes.append({
                "color": avg_color,
                "bbox": [x, y, mw, mh],
                "z": avg_z,
                "stability": stability
            })

        # 5. Output JSON
        output_data = {
            "meta": {
                "file": filename,
                "resolution": [w, h],
                "stroke_count": len(strokes)
            },
            "strokes": strokes
        }

        output_dir = "public/data"
        os.makedirs(output_dir, exist_ok=True)
        
        name_no_ext = os.path.splitext(filename)[0]
        output_path = os.path.join(output_dir, f"{name_no_ext}.json")
        
        with open(output_path, 'w') as f:
            json.dump(output_data, f)
            
        print(f"[*] Saved artifact: {output_path}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to input image')
    args = parser.parse_args()

    grinder = ArtGrinder()
    grinder.process_image(args.input)

if __name__ == "__main__":
    main()
