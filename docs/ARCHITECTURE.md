# Architecture Overview

The "Infinite Void" is designed as a hybrid static-dynamic site. The heavy lifting of 3D data generation is done offline (Pre-processing), allowing the runtime (Browser) to load lightweight JSON data and render it performantly.

## System Diagram

```mermaid
graph TD
    A[Raw Images] -->|scripts/grinder.py| B(Stroke Data .json)
    subgraph Pareidolia Enhancement
        B -- reads --> P[scripts/pareidolia.py]
        A -- reads --> P
    end
    P -.-> B
    B -->|scripts/indexer.py| C(manifest.json)
    D[Markdown Metadata] -->|scripts/indexer.py| C

    C --> E[React App]
    B --> E

    subgraph Browser Runtime
    E --> F[Zustand Store]
    F --> G[Three.js Scene]
    G --> H[Custom Shaders]
    end

## Key Concepts

### 1. The "Stroke Cloud"
Instead of displaying a flat textured quad, every image is decomposed into thousands of individual "strokes".
- **Grinder**: Uses AI (MiDaS + Segment Anything) to analyze an image and break it into segments.
- **Data**: Each stroke has a Position (X,Y), Depth (Z), Color, Scale, and Entropy (Randomness).

### 2. Anamorphic Projection
The strokes are placed in 3D space.
- **Sweet Spot**: There is only ONE specific coordinate in the 3D world (Camera Z position) where the strokes align perfectly to form the original image.
- **Chaos**: As the camera moves away from this sweet spot, the strokes are displaced mathematically (in the Vertex Shader) to create an "exploding" or "drifting" effect.

### 3. The "Infinite" Scroll
The application does not use standard HTML scrolling.
- **Virtual Scroll**: User input is captured to drive a `uScroll` value in the store.
- **Camera Rig**: The camera moves along the Z-axis.
- **Procedural Loading**: Artworks are loaded/unloaded based on proximity to the camera.
