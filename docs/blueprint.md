Project Architecture: Volumetric Anamorphosis Portfolio1. The Core PhilosophyThis is a Single Page Application (SPA) driven by a "View-Dependent Truth." The site is an infinite scroll along the Z-axis. Images are not stored as JPGs, but as procedural "stroke clouds". The user navigates a void; paintings only exist when the camera matrix perfectly aligns with the pre-calculated geometry of the strokes.2. File Structure InventoryPlaintext/
├── .github/workflows/
│   └── process_art.yml      # CI/CD: Watches /assets/raw, triggers Grinder
├── scripts/
│   ├── grinder.py           # The Math Kernel: Depth + Segmentation + Projection
│   └── requirements.txt     # Dependencies: torch, opencv-python, numpy, timm
├── src/
│   ├── canvas/
│   │   ├── InfiniteVoid.jsx # Main Scene: Managing the scroll lifecycle
│   │   ├── StrokeCloud.jsx  # The Geometry: InstancedMesh of 100k+ particles
│   │   └── CameraRig.jsx    # The Eyes: Scroll-jacked movement & parallax
│   ├── ui/
│   │   ├── Signature.jsx    # Persistent identity layer
│   │   └── GlassMenu.jsx    # Translucent navigation overlay
│   ├── shaders/
│   │   ├── anamorphic.vert  # Vertex Shader: Handles the chaos-to-order transition
│   │   └── anamorphic.frag  # Fragment Shader: Texture handling
│   └── store.js             # State: Current scroll depth, active painting index
└── public/
    └── data/                # Generated artifacts (JSON/Binaries)
3. Agent Directives (Copy/Paste for Construction)PHASE 1: THE GRINDER (Backend Processing)Objective: Create scripts/grinder.py. This is the factory floor.Logic:Ingest: Scan assets/raw for new images.Depth Extraction: Load ZoeDepth (Metric Depth Estimation) to generate a 16-bit depth map for the image.Atomization: Decompose the image into ~20,000 "strokes" using a grid-based jitter or contour segmentation approach (simulating PaintTransformer).Inverse Projection: For each stroke center $(u,v)$:Sample depth $z$ from the depth map.Apply Inverse Perspective Projection to find the 3D world coordinate $(x,y,z)$ that aligns with pixel $(u,v)$ when viewed from $(0,0,0)$.Apply Scale-Depth Compensation: Scale $= k \cdot z$ to ensure the stroke covers the correct screen area despite perspective foreshortening.Output: Serialize the data (Position, Rotation, Scale, UVs, Color) into a compressed binary or JSON format optimized for InstancedMesh.PHASE 2: THE VOID (Shader & Geometry)Objective: Create src/canvas/StrokeCloud.jsx and shaders.Logic:Geometry: Use THREE.InstancedMesh for maximum performance (1 draw call per painting).The Shader (anamorphic.vert):Uniforms: uScroll (Current Camera Z), uSweetSpot (Target Alignment Z).Algorithm:Calculate dist = abs(uScroll - uSweetSpot).If dist ~ 0: Render stroke at its calculated aOffset (The Painting).If dist > 0: Apply a pseudo-random noise function to aOffset based on aRandom attribute. The strokes should drift, rotate on local axes, and "explode" outward.Result: A smooth transition from "Abstract Noise" to "Masterpiece" triggered solely by user position.PHASE 3: THE NAVIGATOR (Interaction)Objective: Create src/canvas/CameraRig.jsx.Logic:Scroll-Jacking: Map the scrollbar to the Z-axis. $0px = 0z$, $10000px = -500z$.The Manifest: Read the JSON output from Phase 1. Place "Sweet Spots" at intervals (e.g., $z=-100, z=-200$).Gaze-Contingent Parallax: Bind mouse $X/Y$ to slight camera rotations. This creates immediate motion parallax, proving the volume exists.
