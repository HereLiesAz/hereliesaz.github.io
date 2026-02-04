import os
import json
import numpy as np
import math

DATA_DIR = "public/data"
MANIFEST_PATH = "public/manifest.json"

def calculate_distance(c1, c2):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(c1, c2)))

def main():
    print("[*] Indexing processed art data...")
    
    files = [f for f in os.listdir(DATA_DIR) if f.endswith('.json') and f != 'manifest.json']
    library = []

    # 1. Load all metadata
    for f in files:
        path = os.path.join(DATA_DIR, f)
        try:
            with open(path, 'r') as json_file:
                data = json.load(json_file)
                
                meta = data.get('meta', {})
                strokes = data.get('strokes', [])
                ghosts = data.get('pareidolia', [])
                
                # Determine "Sweet Spot" (Target View)
                # If we found a ghost, look at the first one. Otherwise center.
                if len(ghosts) > 0:
                    target = [ghosts[0]['x'] - 0.5, ghosts[0]['y'] - 0.5, 0] # Offset to center
                else:
                    target = [0, 0, 0]

                if 'dominant_color' not in meta:
                    if len(strokes) > 0:
                        sample = strokes[:100]
                        avg_r = sum(s['color'][0] for s in sample) / len(sample)
                        avg_g = sum(s['color'][1] for s in sample) / len(sample)
                        avg_b = sum(s['color'][2] for s in sample) / len(sample)
                        meta['dominant_color'] = [int(avg_r), int(avg_g), int(avg_b)]
                    else:
                        meta['dominant_color'] = [0, 0, 0]

                entry = {
                    "id": os.path.splitext(f)[0],
                    "file": f,
                    "resolution": meta.get('resolution', [1024, 1024]),
                    "color": meta['dominant_color'],
                    "stroke_count": meta.get('stroke_count', 0),
                    "view_origin": [0, 0, 5], 
                    "view_target": target, # Now dynamic based on pareidolia
                    "ghost_count": len(ghosts)
                }
                library.append(entry)
                
        except Exception as e:
            print(f"[!] Error reading {f}: {e}")

    # 2. Build the Graph
    print(f"[*] Building graph for {len(library)} nodes...")
    
    for item in library:
        my_color = item['color']
        distances = []
        
        for potential_match in library:
            if item['id'] == potential_match['id']:
                continue
            
            dist = calculate_distance(my_color, potential_match['color'])
            distances.append({
                "id": potential_match['id'],
                "weight": dist
            })
        
        distances.sort(key=lambda x: x['weight'])
        item['neighbors'] = [d['id'] for d in distances[:3]]

    # 3. Save Manifest
    with open(MANIFEST_PATH, 'w') as f:
        json.dump({"nodes": library}, f, indent=2)
    
    print(f"[*] Manifest generated at {MANIFEST_PATH} with {len(library)} items.")

if __name__ == "__main__":
    main()
