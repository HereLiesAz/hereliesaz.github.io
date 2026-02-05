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

# Standard Library Imports
import os  # Used for filesystem operations (listdir, remove)
from pathlib import Path  # Object-oriented filesystem paths

# Third-Party Imports
import imagehash  # Library for calculating perceptual image hashes
from PIL import Image  # Python Imaging Library (Pillow) for opening images

# --- CONFIGURATION ---

# The directory containing the source images to process.
# This should match the location where you dump raw files.
INPUT_DIR = "assets/raw"

# The sensitivity of the perceptual hash.
# A size of 8 produces a 64-bit hash (8x8 grid).
# - Smaller values (e.g., 4) make the hash less specific (more aggressive matching).
# - Larger values (e.g., 16) make the hash more specific (stricter matching).
# 8 is generally the sweet spot for finding duplicates that are just resized.
HASH_SIZE = 8 


def get_image_resolution(filepath):
    """
    Helper function to get the total pixel count of an image.
    This is used as a heuristic for "Quality". More pixels = Better.

    Args:
        filepath (Path): Path to the image file.

    Returns:
        int: Total number of pixels (Width * Height). Returns 0 on error.
    """
    try:
        # We use a context manager ('with') to ensure the file handle is closed immediately.
        # This prevents "Too many open files" errors on large batches.
        with Image.open(filepath) as img:
            # Calculate total pixels.
            return img.width * img.height
    except Exception:
        # If the file is corrupt or not an image, treat it as zero quality.
        # This effectively marks it for deletion if a valid version exists.
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
    # This acts as our collision map. Keys are unique hashes, values are lists of files that match that hash.
    hashes = {}
    
    # --- STEP 1: SCAN AND HASH ---
    # Counter for user feedback
    files_found = 0

    # Iterate through every file in the input directory.
    for filename in os.listdir(INPUT_DIR):
        # We only care about common image formats.
        # .lower() ensures case-insensitivity (e.g., handles .JPG and .jpg).
        if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            # Construct the full file path.
            filepath = Path(INPUT_DIR) / filename
            files_found += 1
            
            try:
                # Open the image to compute its fingerprint.
                with Image.open(filepath) as img:
                    # Compute Perceptual Hash.
                    # 'phash' compares the structure of the image, not the raw bytes.
                    # It survives resizing and JPEG compression artifacts.
                    # str() converts the binary hash object to a hex string for easy dictionary usage.
                    h = str(imagehash.phash(img, hash_size=HASH_SIZE))
                    
                    # Initialize the list for this hash if it's the first time seeing it.
                    if h not in hashes:
                        hashes[h] = []

                    # Register this file under its hash.
                    hashes[h].append(filepath)
            except Exception as e:
                # Log errors but don't crash the script if a single file is bad.
                # Common causes: Corrupt headers, zero-byte files.
                print(f"⚠️ Could not process {filename}: {e}")

    # If directory is empty, exit early.
    if files_found == 0:
        print("zzZ No images found to clean.")
        return

    # --- STEP 2: ANALYZE COLLISIONS ---
    deleted_count = 0
    
    # Iterate through our hash map.
    # We unpack the dictionary into hash strings (h) and lists of files (file_list).
    for h, file_list in hashes.items():
        # A list length > 1 means multiple files share the same visual content.
        # This indicates a duplicate set.
        if len(file_list) > 1:
            print(f"🔍 Found duplicate set for hash [{h}]:")
            
            # --- STEP 3: RANK CANDIDATES ---
            # We want to keep the "Best" version.
            # We sort the list of files based on two criteria:
            # 1. Resolution (Primary): We prefer higher resolution images.
            # 2. File Size (Secondary): If resolutions match, we prefer the larger file (likely less compression).
            # reverse=True puts the largest values at the start of the list.
            ranked_files = sorted(
                file_list, 
                key=lambda p: (get_image_resolution(p), p.stat().st_size), 
                reverse=True # Descending order
            )
            
            winner = ranked_files[0]   # The best file (index 0).
            losers = ranked_files[1:]  # All other copies (indices 1 to End).
            
            print(f"   👑 Keeping: {winner.name}")
            
            # --- STEP 4: PURGE LOSERS ---
            # Loop through the files deemed inferior and delete them.
            for loser in losers:
                print(f"   🗑️ Deleting: {loser.name}")
                try:
                    # Perform the actual deletion.
                    os.remove(loser)
                    deleted_count += 1
                except OSError as e:
                    # Handle permission errors or file-lock issues.
                    print(f"   ❌ Failed to delete {loser.name}: {e}")
                
    # --- FINAL REPORT ---
    if deleted_count == 0:
        print("✅ No duplicates found.")
    else:
        print(f"🧹 Janitor finished. Removed {deleted_count} inferior files.")

# Standard boilerplate to run the function if script is executed directly.
if __name__ == "__main__":
    find_and_purge_duplicates()
