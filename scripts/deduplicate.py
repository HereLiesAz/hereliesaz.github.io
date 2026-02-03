import os
import imagehash
from PIL import Image
from pathlib import Path

# --- CONFIGURATION ---
INPUT_DIR = "assets/raw"
HASH_SIZE = 8 

def get_image_resolution(filepath):
    """Returns total pixels (width * height)"""
    try:
        with Image.open(filepath) as img:
            return img.width * img.height
    except Exception:
        return 0

def find_and_purge_duplicates():
    print("🧹 The Janitor is scanning for duplicates...")
    
    # --- SAFETY CHECK ---
    if not os.path.exists(INPUT_DIR):
        print(f"⚠️ Directory '{INPUT_DIR}' does not exist. Skipping cleanup.")
        return
    
    # Dictionary to store { hash: [list_of_files] }
    hashes = {}
    
    # 1. Scan and Hash
    files_found = 0
    for filename in os.listdir(INPUT_DIR):
        if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            filepath = Path(INPUT_DIR) / filename
            files_found += 1
            
            try:
                with Image.open(filepath) as img:
                    h = str(imagehash.phash(img, hash_size=HASH_SIZE))
                    
                    if h not in hashes:
                        hashes[h] = []
                    hashes[h].append(filepath)
            except Exception as e:
                print(f"⚠️ Could not process {filename}: {e}")

    if files_found == 0:
        print("zzZ No images found to clean.")
        return

    # 2. Analyze Collisions
    deleted_count = 0
    
    for h, file_list in hashes.items():
        if len(file_list) > 1:
            print(f"🔍 Found duplicate set for hash [{h}]:")
            
            # Sort by resolution (Descending), then by filesize (Descending)
            ranked_files = sorted(
                file_list, 
                key=lambda p: (get_image_resolution(p), p.stat().st_size), 
                reverse=True
            )
            
            winner = ranked_files[0]
            losers = ranked_files[1:]
            
            print(f"   👑 Keeping: {winner.name}")
            
            # 3. Purge Losers
            for loser in losers:
                print(f"   🗑️ Deleting: {loser.name}")
                os.remove(loser)
                deleted_count += 1
                
    if deleted_count == 0:
        print("✅ No duplicates found.")
    else:
        print(f"🧹 Janitor finished. Removed {deleted_count} inferior files.")

if __name__ == "__main__":
    find_and_purge_duplicates()
