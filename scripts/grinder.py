"""
The Grinder
===========

This is the core processing engine for the Infinite Void.
It takes a 2D image and "grinds" it into a 3D stroke cloud.

The process involves:
1.  **Depth Estimation (MiDaS)**: Determines how far away each pixel is.
2.  **Semantic Segmentation (SAM)**: Breaks the image into logical objects/strokes.
3.  **Data Serialization**: Exports the stroke data to JSON.

Dependencies:
    - PyTorch: Neural network framework.
    - OpenCV: Image processing.
    - Segment Anything (SAM): Meta's segmentation model.
    - MiDaS: Intel's monocular depth estimation model (via Torch Hub).

Usage:
    python scripts/grinder.py --input path/to/image.jpg
    python scripts/grinder.py --input path/to/folder --shard 0 --total 4
"""

# Standard Library Imports
import os  # Filesystem operations
import argparse  # Command line argument parsing
import json  # JSON serialization
import warnings  # Warning control
import gc  # Garbage collection for memory management

# Third-Party Imports
import cv2  # OpenCV for image manipulation
import numpy as np  # Numerical operations
import torch  # PyTorch deep learning framework
from PIL import Image  # Python Imaging Library

# Suppress warnings from PyTorch/Libraries to keep output clean.
# Many of these models produce deprecation warnings that are irrelevant to our usage.
warnings.filterwarnings("ignore")

# --- CONFIGURATION ---
# Minimum resolution (width or height) to accept an image.
# Smaller images look bad when exploded into strokes because there isn't enough data.
MIN_RESOLUTION = 1080 


class ArtGrinder:
    """
    The main processing class. Handles model loading, resource management, and image processing logic.
    """

    def __init__(self):
        """
        Initialize the Grinder.
        Attempts to load the necessary AI models (MiDaS and SAM) onto the best available hardware.
        """
        # Auto-detect hardware accelerator.
        # Check if NVIDIA GPU (CUDA) is available.
        # If not, fall back to CPU.
        # Note: MPS (Mac Metal Performance Shaders) support could be added here if needed (torch.backends.mps.is_available()).
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[*] Grinder initialized on: {self.device}")
        
        # --- 1. LOAD DEPTH MODEL (MiDaS) ---
        try:
            print("[*] Loading Depth Model (MiDaS)...")
            # We use MiDaS Small because it's fast and 'good enough' for artistic depth.
            # Large models provide better accuracy but are significantly slower and heavier on VRAM.
            self.depth_model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small").to(self.device)

            # Set model to evaluation mode (disable training layers like dropout).
            self.depth_model.eval()

            # Load the transform pipeline (resizing, normalization) required by MiDaS.
            # This ensures input images match what the model expects.
            midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
            self.depth_transform = midas_transforms.small_transform

            # Flag to indicate depth is available.
            self.has_depth = True
        except Exception as e:
            # If download fails or dependencies are missing, we log it and will fallback later.
            print(f"[!] Failed to load Depth Model: {e}")
            self.has_depth = False

        # --- 2. LOAD SEGMENTATION MODEL (SAM) ---
        try:
            print("[*] Loading SAM (Segment Anything)...")
            # Import SAM specific classes.
            # These are usually installed via `pip install git+https://github.com/facebookresearch/segment-anything.git`
            from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
            
            # Define path for the model weights checkpoint.
            chk_path = "sam_vit_b_01ec64.pth"

            # Check if we have the weights locally. If not, download them.
            if not os.path.exists(chk_path):
                print("    -> Downloading SAM Checkpoint...")
                # Download the "ViT-B" (Vision Transformer Base) weights. It's the balanced option.
                torch.hub.download_url_to_file("https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth", chk_path)

            # Initialize SAM model using the registry.
            # "vit_b" matches the checkpoint we downloaded.
            sam = sam_model_registry["vit_b"](checkpoint=chk_path)

            # Move model to GPU (or CPU).
            sam.to(device=self.device)

            # Configure the Mask Generator.
            # These parameters act as the "brush settings" for our grinder.
            # They control how fine or coarse the strokes are.
            self.mask_generator = SamAutomaticMaskGenerator(
                model=sam,
                # points_per_side: How many points to sample along one side of the image.
                # 32 means a 32x32 grid of prompts. Higher = more detailed, smaller strokes.
                points_per_side=32,

                # pred_iou_thresh: Prediction Intersection-over-Union threshold.
                # 0.86 filters out low-quality masks that don't match the object well.
                pred_iou_thresh=0.86,

                # stability_score_thresh: Filters out masks that vary wildly with threshold changes.
                stability_score_thresh=0.92,

                # crop_n_layers: Zero means we don't do multi-scale cropping (faster).
                crop_n_layers=0,

                # crop_n_points_downscale_factor: Scaling for point sampling.
                crop_n_points_downscale_factor=1,

                # min_mask_region_area: Ignores tiny specks smaller than 100 pixels.
                min_mask_region_area=100,
            )
            self.has_sam = True
        except Exception as e:
            # If SAM fails to load, we will fall back to a grid-based approach.
            print(f"[!] SAM load failed (using grid fallback): {e}")
            self.has_sam = False

    def estimate_depth(self, img_rgb):
        """
        Runs the MiDaS model to get a depth map for the image.

        Args:
            img_rgb (numpy array): Input image in RGB format.

        Returns:
            numpy array: A single-channel float32 array where values are relative depth.
                         (Interpretation depends on model, usually higher = closer).
        """
        if not self.has_depth:
            # Fallback: Return a completely flat depth map (all 0.5) if model is missing.
            h, w, _ = img_rgb.shape
            return np.ones((h, w), dtype=np.float32) * 0.5

        try:
            # Preprocess the image (Resize, Normalize) and move to device.
            input_batch = self.depth_transform(img_rgb).to(self.device)

            # Perform Inference.
            # 'no_grad' disables gradient calculation, saving memory and computation since we aren't training.
            with torch.no_grad():
                prediction = self.depth_model(input_batch)

                # The output of MiDaS is usually a smaller resolution.
                # We interpret it up to the original image size using bicubic interpolation.
                prediction = torch.nn.functional.interpolate(
                    prediction.unsqueeze(1), # Add channel dimension for interpolate
                    size=img_rgb.shape[:2],  # Target size (Height, Width)
                    mode="bicubic",
                    align_corners=False,
                ).squeeze() # Remove the channel dimension

            # Move result back to CPU and convert to numpy.
            return prediction.cpu().numpy()
        except Exception as e:
            print(f"[!] Depth Error: {e}")
            # Fallback on error
            h, w, _ = img_rgb.shape
            return np.ones((h, w), dtype=np.float32) * 0.5

    def get_segments(self, img_rgb):
        """
        Runs SAM to get segmentation masks.

        Args:
            img_rgb (numpy array): Input image.

        Returns:
            list: A list of dictionaries, where each dict describes a mask (bbox, area, etc.).
        """
        if self.has_sam:
            try:
                # The generator does all the heavy lifting here.
                return self.mask_generator.generate(img_rgb)
            except Exception as e:
                print(f"    [!] SAM Error: {e}")
        
        # --- Fallback Strategy ---
        # If SAM is broken or missing, we simply chop the image into a grid.
        # This allows the pipeline to function (creating a mosaic effect) rather than crashing.
        h, w, _ = img_rgb.shape
        grid_size = 64
        masks = []
        for y in range(0, h, grid_size):
            for x in range(0, w, grid_size):
                # Define a square bounding box.
                bbox = [x, y, min(grid_size, w-x), min(grid_size, h-y)]
                # Mock the SAM output structure so the rest of the code doesn't care.
                masks.append({
                    'bbox': bbox,
                    'area': bbox[2]*bbox[3],
                    'stability_score': 0.5
                })
        return masks

    def create_metadata_stub(self, file_id, filename):
        """
        Creates an empty Markdown file in assets/meta/ if one doesn't exist.
        This enables the editorial team to easily add descriptions later without guessing filenames.

        Args:
            file_id (str): The identifier (filename without extension).
            filename (str): The full filename.
        """
        meta_dir = "assets/meta"
        # Ensure directory exists.
        os.makedirs(meta_dir, exist_ok=True)

        meta_path = os.path.join(meta_dir, f"{file_id}.md")
        
        # Only create if it doesn't exist to prevent overwriting manual edits.
        if not os.path.exists(meta_path):
            print(f"    -> Creating Prose stub: {meta_path}")
            with open(meta_path, 'w') as f:
                # Write standard Frontmatter block.
                f.write(f"---\n")
                f.write(f"title: {file_id}\n")
                f.write(f"year: \"\"\n")
                f.write(f"description: \"\"\n")
                f.write(f"---\n")

    def process_image(self, input_path):
        """
        The core logic pipeline for a single image.

        Args:
            input_path (str): Filepath to the image.
        """
        # Extract filename info.
        filename = os.path.basename(input_path)
        name_no_ext = os.path.splitext(filename)[0]

        # Define output path.
        output_path = os.path.join("public/data", f"{name_no_ext}.json")

        # 1. ALWAYS ensure metadata stub exists (even if already ground).
        # This is a convenience for workflow.
        self.create_metadata_stub(name_no_ext, filename)

        # Check cache. If JSON exists, we assume it's done.
        # To re-process, the user must manually delete the JSON.
        if os.path.exists(output_path):
            print(f"    -> Skipping Grinding (Already Done)")
            return

        # 2. READ IMAGE using OpenCV.
        img_cv2 = cv2.imread(input_path)
        if img_cv2 is None:
            print(f"    [!] Skipped: Corrupt file.")
            return

        h, w = img_cv2.shape[:2]

        # 3. VALIDATION
        # Reject small images.
        if w < MIN_RESOLUTION or h < MIN_RESOLUTION:
            print(f"    [X] REJECTED: Too small ({w}x{h}). Deleting.")
            try:
                # Auto-delete bad assets to keep folder clean.
                os.remove(input_path)
            except OSError as e:
                print(f"    [!] Failed to delete small image {input_path}: {e}")
            return

        # 4. RESIZE (If too massive)
        # We cap at 1500px to keep processing time and JSON size reasonable.
        # This is for the *analysis* resolution. The frontend rendering is resolution independent.
        max_dim = 1500
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            # Use OpenCV to resize.
            img_cv2 = cv2.resize(img_cv2, (0,0), fx=scale, fy=scale)
            print(f"    -> Resized to {img_cv2.shape[1]}x{img_cv2.shape[0]}.")

        # Convert BGR (OpenCV default) to RGB (Standard).
        img_rgb = cv2.cvtColor(img_cv2, cv2.COLOR_BGR2RGB)

        # 5. GENERATE DEPTH MAP
        print("    -> Depth Map...")
        depth_map = self.estimate_depth(img_rgb)

        # Normalize depth to 0.0 - 1.0 range.
        # This ensures consistent 3D volume regardless of the scene's absolute depth.
        d_min, d_max = depth_map.min(), depth_map.max()
        if d_max - d_min > 0:
            depth_map = (depth_map - d_min) / (d_max - d_min)
        else:
            # Handle perfectly flat images (e.g., solid color).
            depth_map = np.zeros_like(depth_map)

        # 6. SEGMENT IMAGE
        print("    -> Segmenting...")
        masks = self.get_segments(img_rgb)
        
        # 7. EXTRACT STROKES
        strokes = []
        print(f"    -> Grinding {len(masks)} fragments...")
        
        for mask_data in masks:
            # SAM returns bbox as [x, y, w, h] (pixels).
            x, y, mw, mh = map(int, mask_data['bbox'])

            # Validation: Ignore zero-width/height segments.
            if mw <= 0 or mh <= 0: continue
            
            # Extract the Region of Interest (ROI) from the RGB image.
            roi = img_rgb[y:y+mh, x:x+mw]
            if roi.size == 0: continue
            
            # Calculate Average Color of the segment.
            # We take the mean across width and height axes.
            avg_color = roi.mean(axis=(0,1)).astype(int).tolist()

            # Calculate Average Depth for this stroke from the depth map.
            roi_depth = depth_map[y:y+mh, x:x+mw]
            avg_z = float(roi_depth.mean()) if roi_depth.size > 0 else 0.5
            
            # Append to our list of strokes.
            strokes.append({
                "color": avg_color,      # RGB [r, g, b]
                "bbox": [x, y, mw, mh],  # Position and Scale
                "z": avg_z,              # 3D Depth
                "stability": float(mask_data.get('stability_score', 0.5)) # Used for "jitter" effects in shader
            })

        # 8. EXPORT
        # Construct the final data object.
        output_data = {
            "meta": {
                "file": filename,
                "original_file": filename, # Added for Pareidolia lookup
                "resolution": [w, h],      # Original resolution (or resized resolution)
                "stroke_count": len(strokes)
            },
            "strokes": strokes
        }

        # Ensure output directory exists.
        output_dir = "public/data"
        os.makedirs(output_dir, exist_ok=True)
        
        # Write JSON to disk.
        with open(output_path, 'w') as f:
            json.dump(output_data, f)

        # 9. CLEANUP (GPU Memory Management)
        # Python's GC doesn't always clear GPU memory immediately.
        # We explicitly delete large objects and empty the CUDA cache.
        del img_cv2, img_rgb, depth_map, masks, output_data
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

def main():
    """
    Entry point. handles argument parsing and job distribution.
    """
    # --- ARGUMENT PARSING ---
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to image OR folder')

    # Sharding allows multiple machines to process a large dataset in parallel.
    # --total 4 --shard 0 means "I am machine 1 of 4, I'll take the first 25% of files".
    parser.add_argument('--shard', type=int, default=0, help='Machine Index')
    parser.add_argument('--total', type=int, default=1, help='Total Machines')
    args = parser.parse_args()

    # Initialize the engine.
    grinder = ArtGrinder()

    if os.path.isdir(args.input):
        # BATCH MODE
        # Get all image files in the directory.
        all_files = sorted([f for f in os.listdir(args.input) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))])

        # Calculate my shard using modulo arithmetic.
        # Simple round-robin distribution.
        my_files = [f for i, f in enumerate(all_files) if i % args.total == args.shard]
        total_count = len(my_files)
        
        print(f"[*] Batch Mode: Shard {args.shard + 1}/{args.total}")
        print(f"[*] Workload: {total_count} images.")
        
        # Iterate and process.
        for i, f in enumerate(my_files):
            print(f"\n[{i+1}/{total_count}] Processing: {f}")
            try:
                full_path = os.path.join(args.input, f)
                grinder.process_image(full_path)
            except Exception as e:
                # Catch-all to prevent one bad file from stopping the whole batch.
                print(f"[!] CRITICAL FAIL on {f}: {e}")
                continue
    else:
        # SINGLE FILE MODE
        grinder.process_image(args.input)

if __name__ == "__main__":
    main()
