import os
import json
import cv2
import numpy as np
import urllib.request
from pathlib import Path

# --- Configuration ---
DATA_DIR = "public/data"
RAW_DIR = "assets/raw"  # <--- Explicitly tell it where the images are
CASCADE_URL = "https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_alt2.xml"
CASCADE_FILE = "haarcascade_frontalface_alt2.xml"

def download_cascade():
    if not os.path.exists(CASCADE_FILE):
        print(f"[*] Downloading Haar Cascade from {CASCADE_URL}...")
        try:
            urllib.request.urlretrieve(CASCADE_URL, CASCADE_FILE)
            print("[*] Download complete.")
        except Exception as e:
            print(f"[!] Failed to download cascade: {e}")
            exit(1)

def load_image(img_path):
    """
    Loads an image, handling JPG, PNG, and HEIC.
    """
    path_obj = Path(img_path)
    
    if not path_obj.exists():
        return None

    # Handle HEIC if pillow_heif is installed (it should be via requirements.txt)
    if path_obj.suffix.lower() in ['.heic', '.heif']:
        try:
            from pillow_heif import register_heif_opener
            from PIL import Image
            register_heif_opener()
            img = Image.open(img_path)
            # Convert to OpenCV format (BGR)
            return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        except ImportError:
            print("[!] HEIC found but pillow_heif not installed. Skipping.")
            return None
        except Exception as e:
            print(f"[!] Error reading HEIC {img_path}: {e}")
            return None

    # Standard Image
    return cv2.imread(img_path)

def scan_for_ghosts():
    download_cascade()
    face_cascade = cv2.CascadeClassifier(CASCADE_FILE)
    
    # Get all processed JSONs
    json_files = list(Path(DATA_DIR).glob("*.json"))
    print(f"[*] Scanning {len(json_files)} artifacts for pareidolia...")

    processed_count = 0
    ghost_count = 0

    for json_file in json_files:
        try:
            # 1. Read the Stroke Data
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # Skip if already haunted (optional, but good for speed)
            if "pareidolia" in data and len(data["pareidolia"]) > 0:
                continue

            # 2. Identify Source Image
            # The Fix: Handle missing keys gracefully
            meta = data.get('meta', {})
            img_filename = meta.get('file') or meta.get('original_file')
            
            if not img_filename:
                print(f"[!] Warning: No filename in metadata for {json_file.name}")
                continue

            # Construct full path to source image
            img_path = os.path.join(RAW_DIR, img_filename)
            
            # 3. Load Image
            img = load_image(img_path)
            if img is None:
                print(f"[!] Warning: Source image {img_filename} not found in {RAW_DIR}. Skipping.")
                continue

            # 4. Detect Faces (The Ghost Hunt)
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            # Use loose parameters to encourage pareidolia (seeing faces in noise)
            faces = face_cascade.detectMultiScale(
                gray, 
                scaleFactor=1.05, 
                minNeighbors=3, 
                minSize=(30, 30)
            )

            # 5. Inject Ghosts into Data
            ghosts = []
            h, w, _ = img.shape
            
            for (x, y, fw, fh) in faces:
                # Normalize coordinates (0.0 to 1.0)
                ghost = {
                    "u": x / w,
                    "v": y / h,
                    "width": fw / w,
                    "height": fh / h,
                    "confidence": 0.8 # Synthetic confidence
                }
                ghosts.append(ghost)

            if ghosts:
                data['pareidolia'] = ghosts
                ghost_count += len(ghosts)
                
                # Write back to file
                with open(json_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, separators=(',', ':')) # Minify
                
                print(f"  [+] Found {len(ghosts)} ghosts in {img_filename}")
                processed_count += 1

        except Exception as e:
            print(f"[!] Failed to process {json_file.name}: {e}")

    print(f"[*] Scan complete. Injected {ghost_count} watchers into {processed_count} artifacts.")

if __name__ == "__main__":
    scan_for_ghosts()
