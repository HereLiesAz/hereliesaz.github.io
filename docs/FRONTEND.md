# Frontend Architecture

The frontend is built with **React**, **Vite**, and **React Three Fiber (R3F)**.

## Core Technology
- **React 18**: UI Library.
- **Zustand**: State Management.
- **Three.js**: 3D Rendering Engine.
- **@react-three/fiber**: React renderer for Three.js.
- **@react-three/drei**: Helpers for R3F.

## Key Components

### `src/canvas/InfiniteVoid.jsx`
The main scene container. It sets up the R3F Canvas, lights, and post-processing (if any). It renders the `CameraRig` and the active `StrokeCloud` instances.

### `src/canvas/StrokeCloud.jsx`
The heart of the visualization.
- **InstancedMesh**: Uses `THREE.InstancedMesh` to render thousands of particles (strokes) with a single draw call.
- **Attributes**: Converts the JSON data from the pipeline into GLSL attributes (`aOffset`, `aScale`, `aColor`, `aRandom`).
- **Uniforms**: Feeds dynamic data like `uTime` and `uScroll` to the shaders.

### `src/store/useStore.js`
Handles the application logic and traversal graph.
- **Manifest**: Loads the `manifest.json`.
- **Navigation**: Calculates the `nextId` (next artwork) based on the current artwork's neighbors and the active category filter.
- **Time Travel**: Manages a history stack to allow users to navigate back.

### `src/ui/Interface.jsx`
The 2D HTML overlay.
- Renders the title, description, and navigation controls.
- Communicates with the 3D scene via the Zustand store.
