import cv2
import os
import json
import numpy as np

DATA_DIR = "public/data"
IMG_DIR = "assets/raw"

# We use the legacy Haar cascade because it hallucinates faces in noise 
# much better than modern DNNs, which is exactly what we want for artistic pareidolia.
HAAR_URL = "https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_alt2.xml"
HAAR_PATH = "weights/haarcascade_frontalface_alt2.xml"

def download_weights():
    if not os.path.exists("weights"):
        os.makedirs("weights")
    if not os.path.exists(HAAR_PATH):
        import urllib.request
        print(f"[*] Downloading Haar Cascade from {HAAR_URL}...")
        urllib.request.urlretrieve(HAAR_URL, HAAR_PATH)

def scan_for_ghosts():
    download_weights()
    face_cascade = cv2.CascadeClassifier(HAAR_PATH)
    
    # Iterate over processed JSONs to find their source images
    json_files = [f for f in os.listdir(DATA_DIR) if f.endswith('.json') and f != 'manifest.json']
    
    for jf in json_files:
        data_path = os.path.join(DATA_DIR, jf)
        
        with open(data_path, 'r') as f:
            data = json.load(f)
        
        # Load original image
        img_name = data['meta']['original_file']
        img_path = os.path.join(IMG_DIR, img_name)
        
        if not os.path.exists(img_path):
            print(f"[!] Warning: Source image {img_name} not found. Skipping pareidolia scan.")
            continue
            
        print(f"[*] Scanning {img_name} for ghosts...")
        img = cv2.imread(img_path)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Lower scaleFactor and minNeighbors increases false positives (Hallucinations)
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.05, 
            minNeighbors=3,   # Low threshold = high pareidolia
            minSize=(30, 30)
        )
        
        ghosts = []
        height, width = img.shape[:2]
        
        for (x, y, w, h) in faces:
            # Normalize to 0-1 UV space
            center_x = (x + w/2) / width
            center_y = 1.0 - ((y + h/2) / height) # Flip Y
            
            ghosts.append({
                "x": float(center_x),
                "y": float(center_y),
                "w": float(w / width),
                "h": float(h / height),
                "confidence": 0.8 # Fake confidence for the nervous system
            })
            
        print(f"    -> Found {len(ghosts)} apparitions.")
        
        # Inject into JSON data
        data['pareidolia'] = ghosts
        
        with open(data_path, 'w') as f:
            json.dump(data, f)

if __name__ == "__main__":
    scan_for_ghosts()
