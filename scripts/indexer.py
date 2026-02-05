"""
The Indexer
===========

This script builds the `manifest.json`, which acts as the database for the frontend application.
It performs three key tasks:
1.  **Aggregates**: Scans all processed JSON files in `public/data`.
2.  **Enriches**: Merges technical data (stroke count, resolution) with editorial metadata (Title, Year, Description) found in Markdown files.
3.  **Connects**: Builds a Nearest Neighbor Graph based on color similarity to allow "infinite scrolling" between visually similar artworks.

Usage:
    python scripts/indexer.py
"""

import os
import json
import numpy as np
import math

# Directory containing processed artwork data.
DATA_DIR = "public/data"

# Directory containing editorial metadata (Markdown files).
META_DIR = "assets/meta"

# Output path for the manifest.
MANIFEST_PATH = "public/manifest.json"


def calculate_distance(c1, c2):
    """
    Calculates Euclidean distance between two color vectors.
    Args:
        c1 (list): [R, G, B]
        c2 (list): [R, G, B]
    Returns:
        float: Distance.
    """
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(c1, c2)))


def parse_frontmatter(file_path):
    """
    Rudimentary parser for Jekyll/Prose.io style YAML frontmatter.
    We implement this manually to avoid adding a PyYAML dependency for such a simple task.

    Expected Format:
    ---
    key: value
    another_key: value
    ---

    Args:
        file_path (str): Path to the markdown file.

    Returns:
        dict: A dictionary of metadata keys and values.
    """
    meta = {}
    try:
        with open(file_path, 'r') as f:
            content = f.read()
            # Split by the YAML separator '---'
            parts = content.split('---')

            # parts[0] is usually empty string (before first ---)
            # parts[1] is the YAML block
            if len(parts) >= 3:
                yaml_block = parts[1]
                for line in yaml_block.split('\n'):
                    if ':' in line:
                        key, val = line.split(':', 1)
                        # Clean up quotes and whitespace
                        meta[key.strip()] = val.strip().strip('"').strip("'")
    except Exception as e:
        print(f"[!] Parse error {file_path}: {e}")
    return meta


def main():
    print("[*] Indexing processed art data...")
    
    # List all .json files (excluding the manifest itself if it exists there).
    files = [f for f in os.listdir(DATA_DIR) if f.endswith('.json') and f != 'manifest.json']
    library = []

    # --- PHASE 1: LOAD AND MERGE ---
    for f in files:
        path = os.path.join(DATA_DIR, f)
        file_id = os.path.splitext(f)[0]
        
        try:
            with open(path, 'r') as json_file:
                data = json.load(json_file)
                
                # 'meta' comes from the Grinder (contains resolution, original filename, etc.)
                technical_meta = data.get('meta', {})
                strokes = data.get('strokes', [])
                
                # --- Dominant Color Calculation ---
                # If not already calculated, compute average color from the first 100 strokes.
                # This is a heuristic approximation of the "vibe" of the image.
                if 'dominant_color' not in technical_meta:
                    if len(strokes) > 0:
                        sample = strokes[:100]
                        avg_r = sum(s['color'][0] for s in sample) / len(sample)
                        avg_g = sum(s['color'][1] for s in sample) / len(sample)
                        avg_b = sum(s['color'][2] for s in sample) / len(sample)
                        technical_meta['dominant_color'] = [int(avg_r), int(avg_g), int(avg_b)]
                    else:
                        technical_meta['dominant_color'] = [0, 0, 0]

                # --- CMS / Metadata Merge ---
                # Look for a corresponding Markdown file in assets/meta/{id}.md
                cms_data = {}
                meta_path = os.path.join(META_DIR, f"{file_id}.md")
                if os.path.exists(meta_path):
                    cms_data = parse_frontmatter(meta_path)
                
                # Construct the Manifest Entry
                # This object is what the frontend receives.
                entry = {
                    "id": file_id,
                    "file": f,

                    # Editorial fields (from Markdown or defaults)
                    "title": cms_data.get("title", file_id),
                    "category": cms_data.get("category", "uncategorized").lower(),
                    "year": cms_data.get("year", ""),
                    "description": cms_data.get("description", ""),

                    # Technical fields (from Grinder)
                    "resolution": technical_meta.get('resolution', [1024, 1024]),
                    "color": technical_meta['dominant_color'],
                    "stroke_count": technical_meta.get('stroke_count', 0),

                    # 3D View Settings (Can be overridden per artwork if needed)
                    "view_origin": [0, 0, 5],
                    "view_target": [0, 0, 0]
                }
                library.append(entry)
                
        except Exception as e:
            print(f"[!] Error reading {f}: {e}")

    # --- PHASE 2: BUILD GRAPH ---
    # We create a navigation graph where every node connects to its 3 most visually similar neighbors.
    print(f"[*] Building graph for {len(library)} nodes...")

    for item in library:
        my_color = item['color']
        distances = []

        for potential_match in library:
            if item['id'] == potential_match['id']: continue

            # Calculate color distance
            dist = calculate_distance(my_color, potential_match['color'])
            distances.append({"id": potential_match['id'], "weight": dist})
        
        # Sort by similarity (lowest distance first)
        distances.sort(key=lambda x: x['weight'])

        # Keep top 3 neighbors
        item['neighbors'] = [d['id'] for d in distances[:3]]

    # --- PHASE 3: SAVE ---
    with open(MANIFEST_PATH, 'w') as f:
        json.dump({"nodes": library}, f, indent=2)
    
    print(f"[*] Manifest generated at {MANIFEST_PATH} with {len(library)} items.")

if __name__ == "__main__":
    main()
