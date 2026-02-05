"""
Pareidolia Scanner
==================

"Pareidolia" is the psychological phenomenon of seeing faces in random stimuli (like clouds or toast).
This script deliberately exploits this phenomenon to detect "ghosts" in the abstract artworks.

It uses an outdated Haar Cascade Classifier (OpenCV) instead of a modern Deep Neural Network.
Why? Because modern DNNs are too good—they only find real human faces.
The old Haar cascades are prone to false positives when tuned aggressively, which creates
the perfect artistic effect of finding "watchers" in the chaotic stroke clouds.

Usage:
    python scripts/pareidolia.py
"""

import cv2
import os
import json
import numpy as np

# Directory containing the processed JSON data (outputs from Grinder).
DATA_DIR = "public/data"

# Directory containing the original source images.
IMG_DIR = "assets/raw"

# --- HAAR CASCADE CONFIGURATION ---
# We use the legacy Haar cascade because it hallucinates faces in noise 
# much better than modern DNNs, which is exactly what we want for artistic pareidolia.
HAAR_URL = "https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_alt2.xml"
HAAR_PATH = "weights/haarcascade_frontalface_alt2.xml"


def download_weights():
    """
    Checks if the Haar Cascade XML file exists locally.
    If not, it creates the directory and downloads it from the OpenCV repository.
    """
    if not os.path.exists("weights"):
        os.makedirs("weights")

    if not os.path.exists(HAAR_PATH):
        import urllib.request
        print(f"[*] Downloading Haar Cascade from {HAAR_URL}...")
        try:
            urllib.request.urlretrieve(HAAR_URL, HAAR_PATH)
            print("[*] Download complete.")
        except Exception as e:
            print(f"[!] Failed to download weights: {e}")


def scan_for_ghosts():
    """
    Main loop. Scans all processed artworks and injects 'ghost' data.
    """
    # 1. Ensure we have the model.
    download_weights()

    # 2. Load the Classifier.
    face_cascade = cv2.CascadeClassifier(HAAR_PATH)
    if face_cascade.empty():
        print("[!] Error: Failed to load Haar Cascade XML.")
        return
    
    # 3. Find target files.
    # We iterate over the JSON files in public/data because those are the artworks
    # that have already been processed by the Grinder.
    json_files = [f for f in os.listdir(DATA_DIR) if f.endswith('.json') and f != 'manifest.json']
    
    print(f"[*] Scanning {len(json_files)} artifacts for pareidolia...")

    for jf in json_files:
        data_path = os.path.join(DATA_DIR, jf)
        
        # Load the existing JSON data.
        with open(data_path, 'r') as f:
            data = json.load(f)
        
        # Identify the source image from metadata.
        img_name = data['meta']['original_file']
        img_path = os.path.join(IMG_DIR, img_name)
        
        # Verify source image exists.
        if not os.path.exists(img_path):
            print(f"[!] Warning: Source image {img_name} not found. Skipping pareidolia scan.")
            continue
            
        print(f"[*] Scanning {img_name} for ghosts...")

        # Read image and convert to Grayscale (Haar cascades work on intensity).
        img = cv2.imread(img_path)
        if img is None:
            print(f"[!] Error: Could not read image {img_path}")
            continue

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # --- DETECTION MAGIC ---
        # scaleFactor=1.05: Scans image at scales increasing by 5%. Small steps = more detections.
        # minNeighbors=3: Lower threshold increases false positives (Hallucinations).
        # minSize=(30, 30): Ignores tiny noise.
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.05, 
            minNeighbors=3,   # Low threshold = high pareidolia
            minSize=(30, 30)
        )
        
        ghosts = []
        height, width = img.shape[:2]
        
        # Process detected regions
        for (x, y, w, h) in faces:
            # Normalize coordinates to 0.0 - 1.0 UV space.
            # This makes them resolution-independent for the frontend.
            center_x = (x + w/2) / width

            # Note: WebGL/Three.js texture coordinates usually have (0,0) at bottom-left.
            # OpenCV has (0,0) at top-left. So we flip Y: 1.0 - y.
            center_y = 1.0 - ((y + h/2) / height)
            
            ghosts.append({
                "x": float(center_x),
                "y": float(center_y),
                "w": float(w / width),
                "h": float(h / height),
                "confidence": 0.8 # Arbitrary "fake" confidence for the lore.
            })
            
        if len(ghosts) > 0:
            print(f"    -> Found {len(ghosts)} apparitions.")
        else:
            print("    -> No ghosts found.")
        
        # --- INJECTION ---
        # We modify the JSON file in place, adding the 'pareidolia' key.
        data['pareidolia'] = ghosts
        
        with open(data_path, 'w') as f:
            json.dump(data, f)

if __name__ == "__main__":
    scan_for_ghosts()
