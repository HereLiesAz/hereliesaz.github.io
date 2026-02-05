import os
import json
import glob
from datetime import datetime

DATA_DIR = "public/data"
MANIFEST_PATH = os.path.join(DATA_DIR, "manifest.json")

def repair_legacy_data(filepath):
    """
    The 'Repair' logic:
    Checks if a JSON file is a raw list (legacy format).
    If so, wraps it in the new { meta, strokes } object structure.
    """
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)

        # If it's a list, it's a corpse from the old world. Resurrect it.
        if isinstance(data, list):
            print(f"Repairing legacy format: {filepath}")
            filename = os.path.basename(filepath)
            # Attempt to parse title/year from filename (e.g., "PXL_2023_Title.json")
            # Fallback to defaults if parsing fails
            parts = filename.replace("PXL_", "").replace(".json", "").split("_")
            year = parts[0] if len(parts) > 0 and parts[0].isdigit() else "2024"
            title = " ".join(parts[1:]) if len(parts) > 1 else filename
            
            new_structure = {
                "meta": {
                    "id": filename.replace(".json", ""),
                    "title": title,
                    "artist": "Azrienoch",
                    "year": year,
                    "dimensions": "Variable",
                    "medium": "Volumetric Data"
                },
                "strokes": data
            }
            
            with open(filepath, 'w') as f:
                json.dump(new_structure, f, indent=2)
            return True
        return False
    except Exception as e:
        print(f"Failed to process {filepath}: {e}")
        return False

def generate_manifest():
    """
    The 'Indexer' logic:
    Scans valid JSONs and builds the Table of Contents for the frontend.
    """
    manifest = []
    files = glob.glob(os.path.join(DATA_DIR, "*.json"))
    
    # Sort by modification time (newest first)
    files.sort(key=os.path.getmtime, reverse=True)

    for filepath in files:
        if filepath.endswith("manifest.json"):
            continue
            
        # First, ensure it's not broken
        repair_legacy_data(filepath)
        
        try:
            with open(filepath, 'r') as f:
                content = json.load(f)
                
            # If it has the meta tag, add it to the manifest
            if isinstance(content, dict) and "meta" in content:
                # Add the relative path for the frontend
                entry = content["meta"]
                entry["src"] = f"/data/{os.path.basename(filepath)}"
                manifest.append(entry)
            else:
                print(f"Skipping {filepath}: Missing metadata.")
                
        except Exception as e:
            print(f"Error reading {filepath}: {e}")

    # Write the manifest
    with open(MANIFEST_PATH, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"Manifest generated with {len(manifest)} entries.")

if __name__ == "__main__":
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
    generate_manifest()
