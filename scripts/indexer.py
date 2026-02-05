import os
import json
import math

DATA_DIR = "public/data"
MANIFEST_PATH = "public/manifest.json"

def calculate_distance(c1, c2):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(c1, c2)))

def main():
    print("[*] Indexing processed art data...")

    if not os.path.exists(DATA_DIR):
        with open(MANIFEST_PATH, 'w') as f:
            json.dump({"nodes": []}, f)
        return

    files = [f for f in os.listdir(DATA_DIR) if f.endswith('.json') and f != 'manifest.json']
    library = []

    for f in files:
        try:
            with open(os.path.join(DATA_DIR, f), 'r') as jf:
                data = json.load(jf)
                
                # --- SCAVENGER LOGIC ---
                # Recover files that are raw lists (legacy/broken format)
                if isinstance(data, list):
                    # Assume the list is the strokes data
                    strokes = data
                    # Create fake metadata since we can't read it
                    meta = {
                        "resolution": [1024, 1024], # Default assumption
                        "stroke_count": len(strokes),
                        "dominant_color": [100, 100, 100] # Default grey
                    }
                    ghosts = []
                else:
                    # Standard Format
                    meta = data.get('meta', {})
                    strokes = data.get('strokes', [])
                    ghosts = data.get('pareidolia', [])
                # -----------------------

                # Determine View Target
                if len(ghosts) > 0:
                    target = [ghosts[0]['x'] - 0.5, ghosts[0]['y'] - 0.5, 0] 
                else:
                    target = [0, 0, 0]

                # Ensure Color Exists
                if 'dominant_color' not in meta:
                    # Calculate from strokes if missing
                    if len(strokes) > 0:
                        try:
                            # Handle case where stroke is not a dict (legacy)
                            sample = strokes[:50]
                            # Check if stroke is dict or list/other
                            if isinstance(sample[0], dict) and 'color' in sample[0]:
                                avg_r = sum(s['color'][0] for s in sample) / len(sample)
                                avg_g = sum(s['color'][1] for s in sample) / len(sample)
                                avg_b = sum(s['color'][2] for s in sample) / len(sample)
                                meta['dominant_color'] = [int(avg_r), int(avg_g), int(avg_b)]
                            else:
                                meta['dominant_color'] = [128, 128, 128]
                        except:
                            meta['dominant_color'] = [128, 128, 128]
                    else:
                        meta['dominant_color'] = [0, 0, 0]

                library.append({
                    "id": os.path.splitext(f)[0],
                    "file": f,
                    "resolution": meta.get('resolution', [1024, 1024]),
                    "color": meta['dominant_color'],
                    "stroke_count": meta.get('stroke_count', len(strokes)),
                    "view_origin": [0, 0, 5], 
                    "view_target": target,
                    "ghost_count": len(ghosts)
                })
        except Exception as e:
            # Only print error if it's truly unreadable
            # print(f"[!] Skipped {f}: {e}")
            pass

    # Build Graph
    print(f"[*] Building graph for {len(library)} nodes...")
    for item in library:
        my_color = item['color']
        dists = sorted(library, key=lambda x: calculate_distance(my_color, x['color']))
        item['neighbors'] = [x['id'] for x in dists if x['id'] != item['id']][:3]

    with open(MANIFEST_PATH, 'w') as f:
        json.dump({"nodes": library}, f, indent=2)
    
    print(f"[*] RECOVERED Manifest with {len(library)} items.")

if __name__ == "__main__":
    main()
