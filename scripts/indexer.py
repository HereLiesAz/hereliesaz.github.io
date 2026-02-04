import os
import json
import numpy as np
import math

DATA_DIR = "public/data"
MANIFEST_PATH = "public/manifest.json"

def calculate_distance(c1, c2):
    # Euclidean distance between two RGB colors
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
                
                # Extract summary data for the manifest
                # We don't want the full stroke list in the manifest (too heavy)
                meta = data.get('meta', {})
                strokes = data.get('strokes', [])
                
                # Calculate dominant color of the whole piece if not present
                if 'dominant_color' not in meta:
                    # Quick average of the first 100 strokes
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
                    # Placeholder for the sophisticated "Sweet Spot" coordinates
                    # Default to center looking forward
                    "view_origin": [0, 0, 5], 
                    "view_target": [0, 0, 0]
                }
                library.append(entry)
                
        except Exception as e:
            print(f"[!] Error reading {f}: {e}")

    # 2. Build the Graph (The "Next" Pointers)
    # For now, we link every painting to the 2 most similar paintings based on color.
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
        
        # Sort by similarity (lowest distance)
        distances.sort(key=lambda x: x['weight'])
        
        # Link to top 3 matches
        item['neighbors'] = [d['id'] for d in distances[:3]]

    # 3. Save Manifest
    with open(MANIFEST_PATH, 'w') as f:
        json.dump({"nodes": library}, f, indent=2)
    
    print(f"[*] Manifest generated at {MANIFEST_PATH} with {len(library)} items.")

if __name__ == "__main__":
    main()
