import os
import json
import numpy as np
import math

DATA_DIR = "public/data"
META_DIR = "assets/meta"
MANIFEST_PATH = "public/manifest.json"

def calculate_distance(c1, c2):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(c1, c2)))

def parse_frontmatter(file_path):
    """
    Rudimentary parser for Jekyll-style YAML frontmatter.
    We don't need PyYAML dependency if we just hack the string.
    """
    meta = {}
    try:
        with open(file_path, 'r') as f:
            content = f.read()
            parts = content.split('---')
            if len(parts) >= 3:
                yaml_block = parts[1]
                for line in yaml_block.split('\n'):
                    if ':' in line:
                        key, val = line.split(':', 1)
                        meta[key.strip()] = val.strip().strip('"').strip("'")
    except Exception as e:
        print(f"[!] Parse error {file_path}: {e}")
    return meta

def main():
    print("[*] Indexing processed art data...")
    
    files = [f for f in os.listdir(DATA_DIR) if f.endswith('.json') and f != 'manifest.json']
    library = []

    for f in files:
        path = os.path.join(DATA_DIR, f)
        file_id = os.path.splitext(f)[0]
        
        try:
            with open(path, 'r') as json_file:
                data = json.load(json_file)
                
                meta = data.get('meta', {})
                strokes = data.get('strokes', [])
                
                # Dominant Color
                if 'dominant_color' not in meta:
                    if len(strokes) > 0:
                        sample = strokes[:100]
                        avg_r = sum(s['color'][0] for s in sample) / len(sample)
                        avg_g = sum(s['color'][1] for s in sample) / len(sample)
                        avg_b = sum(s['color'][2] for s in sample) / len(sample)
                        meta['dominant_color'] = [int(avg_r), int(avg_g), int(avg_b)]
                    else:
                        meta['dominant_color'] = [0, 0, 0]

                # PROSE.IO MERGE
                # Look for assets/meta/{id}.md
               # ... inside main() ...

                # PROSE.IO MERGE
                cms_data = {}
                meta_path = os.path.join(META_DIR, f"{file_id}.md")
                if os.path.exists(meta_path):
                    cms_data, _ = parse_frontmatter(meta_path)
                
                entry = {
                    "id": file_id,
                    "file": f,
                    "title": cms_data.get("title", file_id),
                    "category": cms_data.get("category", "uncategorized").lower(), # <--- NEW
                    "year": cms_data.get("year", ""),
                    # ... rest of the fields
                }
# ...
                    "description": cms_data.get("description", ""),
                    "resolution": meta.get('resolution', [1024, 1024]),
                    "color": meta['dominant_color'],
                    "stroke_count": meta.get('stroke_count', 0),
                    "view_origin": [0, 0, 5],
                    "view_target": [0, 0, 0]
                }
                library.append(entry)
                
        except Exception as e:
            print(f"[!] Error reading {f}: {e}")

    # Build Graph
    print(f"[*] Building graph for {len(library)} nodes...")
    for item in library:
        my_color = item['color']
        distances = []
        for potential_match in library:
            if item['id'] == potential_match['id']: continue
            dist = calculate_distance(my_color, potential_match['color'])
            distances.append({"id": potential_match['id'], "weight": dist})
        
        distances.sort(key=lambda x: x['weight'])
        item['neighbors'] = [d['id'] for d in distances[:3]]

    # Save
    with open(MANIFEST_PATH, 'w') as f:
        json.dump({"nodes": library}, f, indent=2)
    
    print(f"[*] Manifest generated at {MANIFEST_PATH} with {len(library)} items.")

if __name__ == "__main__":
    main()
