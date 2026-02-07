import os
import json
import argparse
from pathlib import Path
from datetime import datetime

def generate_manifest(data_dir):
    data_path = Path(data_dir)
    if not data_path.exists():
        print(f"[!] Error: {data_dir} does not exist.")
        return

    nodes = []
    print(f"[*] Scanning {data_dir}...")

    # 1. Load all JSONs
    files = sorted([f for f in data_path.glob("*.json")])
    
    for f_path in files:
        try:
            with open(f_path, 'r') as f:
                data = json.load(f)
            
            # --- ADAPTIVE PARSING ---
            # Handle both "strokes" (Legacy) and "s" (Compressed) keys
            strokes = data.get('strokes') or data.get('s')
            meta = data.get('meta', {})
            
            if not strokes:
                # If neither exists, it's not a valid art file
                print(f"[!] Skipping {f_path.name} (No strokes found)")
                continue

            # Calculate basic stats for the manifest
            stroke_count = len(strokes)
            
            # Extract resolution
            res = meta.get('resolution') or meta.get('res') or [1920, 1080]
            
            node = {
                "id": f_path.stem,      # Filename without .json
                "file": f_path.name,    # Filename with .json
                "strokes": stroke_count,
                "res": res,
                "z_depth": meta.get('z_depth', 1.0) # Default scale
            }
            nodes.append(node)

        except Exception as e:
            print(f"[!] Error reading {f_path.name}: {e}")

    # 2. Build the Graph (The "Infinite" Part)
    # We link nodes linearly for now, but this is where you'd add chaos logic
    total_nodes = len(nodes)
    if total_nodes == 0:
        print("[!] No valid nodes found. Manifest will be empty.")
    else:
        for i, node in enumerate(nodes):
            # Doubly linked list logic for the default "walk"
            prev_node = nodes[(i - 1) % total_nodes]
            next_node = nodes[(i + 1) % total_nodes]
            
            node["neighbors"] = [prev_node["id"], next_node["id"]]

    # 3. Write Manifest
    manifest = {
        "generated_at": datetime.now().isoformat(),
        "total_nodes": total_nodes,
        "nodes": nodes
    }

    manifest_path = data_path.parent / "manifest.json"
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"[*] Index complete. {total_nodes} nodes linked in {manifest_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default="public/data", help="Directory containing stroke clouds")
    args = parser.parse_args()
    
    generate_manifest(args.dir)
