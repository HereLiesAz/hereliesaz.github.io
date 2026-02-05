# Developer Workflow

This document outlines the lifecycle of an artwork in the "Infinite Void", from a raw image file to a rendered 3D nebula.

## The Pipeline Overview

1.  **Ingest**: Place raw image in `assets/raw/`.
2.  **Clean**: Run `deduplicate.py` to remove redundant copies.
3.  **Grind**: Run `grinder.py` to generate 3D stroke data (`.json`).
4.  **Ghost**: Run `pareidolia.py` to inject "watcher" data.
5.  **Index**: Run `indexer.py` to update the `manifest.json`.
6.  **Run**: View the result in the web app.

---

## Step-by-Step Guide

### 1. Adding New Art

Drop your high-resolution images (JPG, PNG, WEBP) into:
`assets/raw/`

*Tip: Filenames should be descriptive (e.g., `the_starry_night.jpg`) as they become the ID of the artwork.*

### 2. The Janitor (Optional but Recommended)

If you dumped a large folder of unsorted images, run the deduplicator to ensure you don't process the same image twice.

```bash
python scripts/deduplicate.py
```

### 3. The Grinder (Heavy Lifting)

This is the most time-consuming step. It uses AI to analyze depth and segmentation.

**Single File:**
```bash
python scripts/grinder.py --input assets/raw/my_new_art.jpg
```

**Batch Mode (All images in folder):**
```bash
python scripts/grinder.py --input assets/raw
```

*Output*: This generates JSON files in `public/data/`.

### 4. Pareidolia (The Ghosts)

After grinding, run the face detector. It scans the *processed* JSON files and the original images to find hidden faces.

```bash
python scripts/pareidolia.py
```

*Output*: Modifies the JSON files in `public/data/` in-place.

### 5. The Librarian (Indexing)

Finally, rebuild the graph so the frontend knows about the new files.

```bash
python scripts/indexer.py
```

*Output*: Updates `public/manifest.json`.

---

## Metadata (Editorial)

When `grinder.py` runs, it automatically creates a "Stub" markdown file for each image in `assets/meta/`.

Example `assets/meta/the_starry_night.md`:
```yaml
---
title: the_starry_night
year: ""
description: ""
---
```

You can edit these files to add real titles, years, and descriptions. Rerun `indexer.py` after editing metadata to propagate changes to the manifest.

---

## Frontend Development

### Start Local Server
```bash
npm run dev
```

### Building for Production
```bash
npm run build
```
This generates the static site in `dist/`. Since all data is pre-processed into JSON, the `dist` folder is completely standalone and can be hosted on any static host (Netlify, Vercel, S3).
