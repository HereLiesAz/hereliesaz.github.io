"""
Deduplication Script
===================

This script acts as a "Janitor" for the raw asset directory. It scans for image files
that are visually identical (even if the filenames are different) and removes duplicates,
keeping only the highest-quality version.

Algorithm:
    1. Scan `assets/raw` for image files.
    2. Compute a Perceptual Hash (pHash) for each image.
       - pHash survives minor edits (resizing, format changes) but detects visual similarity.
    3. Group files by their Hash.
    4. For each collision group:
       - Sort candidates by Resolution (Width * Height) DESC.
       - Secondary sort by File Size DESC.
       - Keep the top candidate ("Winner").
       - Delete the rest ("Losers").

Usage:
    python scripts/deduplicate.py
"""

import os
import imagehash
from PIL import Image
from pathlib import Path

# --- CONFIGURATION ---

# The directory containing the source images to process.
INPUT_DIR = "assets/raw"

# The sensitivity of the perceptual hash.
# A size of 8 produces a 64-bit hash.
# Smaller = More aggressive (matches looser similarities).
# Larger = stricter.
HASH_SIZE = 8 


def get_image_resolution(filepath):
    """
    Helper function to get the total pixel count of an image.

    Args:
        filepath (Path): Path to the image file.

    Returns:
        int: Total number of pixels (Width * Height). Returns 0 on error.
    """
    try:
        # We use a context manager to ensure the file handle is closed immediately.
        with Image.open(filepath) as img:
            return img.width * img.height
    except Exception:
        # If the file is corrupt or not an image, treat it as zero quality.
        return 0


def find_and_purge_duplicates():
    """
    Main execution function.
    Scans, hashes, ranks, and deletes duplicate images.
    """
    print("🧹 The Janitor is scanning for duplicates...")
    
    # --- SAFETY CHECK ---
    # Ensure the target directory actually exists before trying to list it.
    if not os.path.exists(INPUT_DIR):
        print(f"⚠️ Directory '{INPUT_DIR}' does not exist. Skipping cleanup.")
        return
    
    # Dictionary to store { hash_string: [list_of_filepaths] }
    # This acts as our collision map.
    hashes = {}
    
    # --- STEP 1: SCAN AND HASH ---
    files_found = 0

    # Iterate through every file in the input directory.
    for filename in os.listdir(INPUT_DIR):
        # We only care about common image formats.
        if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            filepath = Path(INPUT_DIR) / filename
            files_found += 1
            
            try:
                # Open the image to compute its fingerprint.
                with Image.open(filepath) as img:
                    # Compute Perceptual Hash.
                    # str() converts the binary hash object to a hex string for easy dictionary usage.
                    h = str(imagehash.phash(img, hash_size=HASH_SIZE))
                    
                    # Initialize the list for this hash if it's the first time seeing it.
                    if h not in hashes:
                        hashes[h] = []

                    # Register this file under its hash.
                    hashes[h].append(filepath)
            except Exception as e:
                # Log errors but don't crash the script if a single file is bad.
                print(f"⚠️ Could not process {filename}: {e}")

    # If directory is empty, exit early.
    if files_found == 0:
        print("zzZ No images found to clean.")
        return

    # --- STEP 2: ANALYZE COLLISIONS ---
    deleted_count = 0
    
    # Iterate through our hash map.
    for h, file_list in hashes.items():
        # A list length > 1 means multiple files share the same visual content.
        if len(file_list) > 1:
            print(f"🔍 Found duplicate set for hash [{h}]:")
            
            # --- STEP 3: RANK CANDIDATES ---
            # We want to keep the "Best" version.
            # Criteria 1: Resolution (Higher is better).
            # Criteria 2: Disk Size (Higher usually means less compression artifacts).
            ranked_files = sorted(
                file_list, 
                key=lambda p: (get_image_resolution(p), p.stat().st_size), 
                reverse=True # Descending order
            )
            
            winner = ranked_files[0]   # The best file.
            losers = ranked_files[1:]  # All other copies.
            
            print(f"   👑 Keeping: {winner.name}")
            
            # --- STEP 4: PURGE LOSERS ---
            for loser in losers:
                print(f"   🗑️ Deleting: {loser.name}")
                try:
                    os.remove(loser)
                    deleted_count += 1
                except OSError as e:
                    print(f"   ❌ Failed to delete {loser.name}: {e}")
                
    # --- FINAL REPORT ---
    if deleted_count == 0:
        print("✅ No duplicates found.")
    else:
        print(f"🧹 Janitor finished. Removed {deleted_count} inferior files.")

if __name__ == "__main__":
    find_and_purge_duplicates()
