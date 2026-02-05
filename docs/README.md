# Infinite Void Portfolio - Documentation

Welcome to the comprehensive documentation for the "Infinite Void" portfolio project. This project is a 3D immersive web application that transforms 2D artworks into explorable 3D point clouds (stroke clouds) using anamorphic projection.

## Documentation Index

1. [**Architecture Overview**](./ARCHITECTURE.md)
   - High-level system design, data flow, and tech stack.

2. [**Asset Pipeline**](./PIPELINE.md)
   - Detailed explanation of the Python scripts used to process images (`grinder.py`, `pareidolia.py`, `indexer.py`).

3. [**Frontend & 3D Engine**](./FRONTEND.md)
   - Overview of the React application, State Management (Zustand), and Three.js/R3F integration.

4. [**Shaders & Math**](./SHADERS.md)
   - Deep dive into the GLSL shaders that power the anamorphic effects and chaotic particle movement.

## Quick Start

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)
- CUDA-capable GPU (Recommended for asset processing)

### Installation

```bash
# 1. Install Frontend Dependencies
npm install

# 2. Install Python Dependencies
pip install -r scripts/requirements.txt
```

### Running the Dev Server
```bash
npm run dev
```

### Processing New Art
Place images in `assets/raw`, then run:
```bash
# Process images into stroke clouds
python scripts/grinder.py --input assets/raw

# (Optional) Scan for "faces" in the art
python scripts/pareidolia.py

# Generate the manifest.json
python scripts/indexer.py
```
