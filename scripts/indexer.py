import os
import json
import re
import math
from datetime import datetime

DATA_DIR = "public/data"
MANIFEST_DIR = "public"
CHUNK_SIZE = 50  # Items per page

def normalize_date(filename, metadata):
    """
    Standardizes time. Truth is relative, but time should be ISO 8601.
    Tries to extract date from filename patterns or fallback to file creation time.
    """
    # Pattern 1: YYYY-MM-DD
    match = re.search(r"(\d{4}-\d{2}-\d{2})", filename)
    if match:
        return match.group(1)
    
    # Pattern 2: YYYYMMDD (PXL/IMG prefixes)
    match = re.search(r"(\d{4})(\d{2})(\d{2})", filename)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    
    # Pattern 3: Unix Timestamp (Digits > 9 chars)
    match = re.search(r"(\d{10,})", filename)
    if match:
        try:
            ts = int(match.group(1)) / 1000 if len(match.group(1)) > 10 else int(match.group(1))
            return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
        except:
            pass

    # Fallback: Git blame or File Stat (Local only)
    return "1970-01-01"

def build_index():
    print("The Librarian is organizing the chaos...")
    
    nodes = []
    
    # Scan JSON files
    for f in os.listdir(DATA_DIR):
        if not f.endswith(".json"): continue
        
        path = os.path.join(DATA_DIR, f)
        
        try:
            with open(path, 'r', encoding='utf-8') as json_file:
                data = json.load(json_file)
                
                # Check minimum viability
                if "stroke_count" not in data: continue

                node = {
                    "id": f.replace(".json", ""),
                    "file": f,
                    "date": normalize_date(f, data),
                    "stroke_count": data.get("stroke_count", 0),
                    "color": data.get("color", [128, 128, 128]),
                    "resolution": data.get("resolution", [1024, 1024]),
                    "neighbors": data.get("neighbors", [])
                }
                
                # Metadata override if exists (stub for markdown parsing)
                # ... (Logic to read assets/meta would go here)
                
                nodes.append(node)
        except Exception as e:
            print(f"Failed to index {f}: {e}")

    # Sort by Date (Descending)
    nodes.sort(key=lambda x: x['date'], reverse=True)

    # Pagination
    total_pages = math.ceil(len(nodes) / CHUNK_SIZE)
    
    # Master Manifest (Lightweight)
    master = {
        "total_nodes": len(nodes),
        "total_pages": total_pages,
        "generated_at": datetime.now().isoformat(),
        "pages": [f"manifest_{i}.json" for i in range(total_pages)]
    }
    
    with open(os.path.join(MANIFEST_DIR, "manifest.json"), 'w') as f:
        json.dump(master, f)
        
    # Chunked Pages
    for i in range(total_pages):
        chunk = nodes[i*CHUNK_SIZE : (i+1)*CHUNK_SIZE]
        page_data = {"page": i, "nodes": chunk}
        
        with open(os.path.join(MANIFEST_DIR, f"manifest_{i}.json"), 'w') as f:
            json.dump(page_data, f)
            
    print(f"Index complete. {len(nodes)} nodes across {total_pages} pages.")

if __name__ == "__main__":
    build_index()
