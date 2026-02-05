# HereLiesAz: The Infinite Void Portfolio

> "The canvas is infinite. The paint is data. We are merely pattern matching in the void."

A procedurally generated, 3D pointillist art portfolio. It deconstructs 2D images into 3D "stroke clouds" and arranges them in an infinite, navigable graph based on color similarity.

## 📚 Documentation

-   **[Setup Guide](docs/SETUP.md)**: How to install dependencies (Python & Node.js).
-   **[Workflow](docs/WORKFLOW.md)**: How to add new art and run the processing pipeline.
-   **[Architecture](docs/ARCHITECTURE.md)**: Deep dive into the system design, from the AI grinder to the WebGL shaders.
-   **[Pipeline Details](docs/PIPELINE.md)**: Specifics on the Python scripts (Grinder, Pareidolia, Indexer).

## 🚀 Quick Start

### 1. Backend (Data Processing)
*Requires Python 3.8+*

```bash
# Install dependencies
pip install -r requirements.txt

# Process an image (generates 3D data)
python scripts/grinder.py --input assets/raw/my_image.jpg

# Update the index
python scripts/indexer.py
```

### 2. Frontend (Viewer)
*Requires Node.js 18+*

```bash
# Install dependencies
npm install

# Start local server
npm run dev
```

Visit `http://localhost:5173` to enter the void.

## 🏗️ Project Structure

-   `assets/raw`: Original source images.
-   `assets/meta`: Markdown files containing title/year/description.
-   `public/data`: Generated JSON files (Strokes & Manifest).
-   `scripts/`: Python ETL pipeline (Extract, Transform, Load).
-   `src/`: React + Three.js source code.
    -   `canvas/`: 3D components.
    -   `shaders/`: GLSL shader code.
    -   `store/`: State management logic.

## 📜 License

Private. All rights reserved.
