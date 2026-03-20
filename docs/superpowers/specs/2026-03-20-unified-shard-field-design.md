# Shard Cloud: Unified Field Design Spec
**Date:** 2026-03-20
**Status:** Approved

---

## 0. Vision

A web portfolio where paintings are not displayed — they are discovered. The viewer navigates an infinite 3D void by scrolling. At specific camera positions, thousands of drifting abstract shards snap into coherent paintings via forced perspective. Between paintings, those shards fill the space alongside the shards of the next painting, already present but unresolved. The transition is not announced. You don't know it's happening. The unnerving moment is realising the next painting was sitting there in front of you the whole time.

Everything is open to redesign. The vision is fixed.

---

## 1. System Architecture

Two fully separated systems with a static file boundary between them.

### 1.1 The Preprocessor (offline Python)
Runs once per painting. Produces deterministic baked output. Never executes at runtime. Input: raw painting image. Output: `{id}.baked.json` + updated `graph.json`.

### 1.2 The Viewer (browser, WebGL via React Three Fiber)
Loads baked data. Maintains a single unified instanced geometry. Moves the camera. Does no computer vision. Paintings emerge purely as a consequence of camera position.

### 1.3 File Contract

```
public/
  graph.json              # Node/edge graph with pareidolia anchor data
  data/
    baked/
      {id}.baked.json     # Per-painting shard geometry (forward + mirror)
  assets/
    {id}.jpg              # Source images for texture sampling
```

### 1.4 What Changes vs. Current Codebase

**Rebuilt:**
- Python preprocessor (color/lighting segmentation, mirror baking, DINOv2 graph)
- Renderer (`ShardMaterial.js` → unified anamorphic field shader)
- Store/navigation (no discrete cluster management; continuous camera Z)

**Removed (dead code):**
- `InfiniteVoid.jsx`, `StrokeCloud.jsx`, `CameraRig.jsx` (legacy pipeline)
- `InfiniteCanvas.jsx` (orphaned, references non-existent store fields)
- `anamorphic.vert`, `anamorphic.frag` (replaced by unified shader in ShardMaterial)
- `AnamorphicShader.js` (unused)
- `src/components/AnamorphicCam.jsx` (replaced by new camera controller)

**Kept:**
- Vite + React + React Three Fiber stack
- `package.json` dependencies (no framework change)
- `src/App.jsx` structure (Scene + Overlay)

---

## 2. The Preprocessor

### 2.1 Segmentation — Color/Lighting Based

**Not** SAM object segmentation. Instead:

1. Convert image to LAB color space (perceptually uniform — matches how the eye perceives difference)
2. Run SLIC superpixel segmentation (target: 500–2000 superpixels depending on image size)
3. Merge adjacent superpixels whose LAB color distance falls below threshold `τ = 15.0`
4. Post-process: split any merged region larger than 5% of image area to prevent giant blobs
5. Result: irregular, organic shards that follow the painting's brushwork, light gradients, and color regions — not object outlines

Each shard is defined by its pixel mask.

### 2.2 Depth Assignment

1. Run MiDaS on the painting to get a relative depth map (0.0–1.0)
2. Per shard: compute mean depth over its mask pixels → `z_local` (normalized, 0.0–1.0)
3. Supplement with contrast bonus: shards at high-contrast edges get `z_local += contrast_weight * 0.2`
4. Remap `z_local` to world units: `z_world = z_local * Z_SPREAD` where `Z_SPREAD = 80.0` units

This gives the shard cloud visual depth and interest without requiring real geometry.

### 2.3 Anamorphic Projection (Forward Shards)

For each shard with image-space centroid `(u, v)` and depth `z_world`:

```
focal_length f = (image_height / 2) / tan(FOV / 2)   # FOV = 50°

world_x = (u - 0.5) * WORLD_HEIGHT * aspect * (z_world / f)
world_y = (0.5 - v) * WORLD_HEIGHT * (z_world / f)
world_z = sweet_spot_Z - z_world                        # in front of sweet spot

scale_x = shard_width_px  * (z_world / f)
scale_y = shard_height_px * (z_world / f)

uv_offset = [shard_x_min / img_w, shard_y_min / img_h]
uv_scale  = [shard_width / img_w, shard_height / img_h]
```

`WORLD_HEIGHT = 10.0` units. From camera position `(0, 0, sweet_spot_Z)`, every shard appears exactly at its original pixel location. From any other position: chaos.

### 2.4 Mirror Shards

For each forward shard at world position `(wx, wy, wz)`:

```
mirror_wz = sweet_spot_Z + (sweet_spot_Z - wz)   # reflected through sweet spot plane
```

`(wx, wy)` and scale are identical. The mirror shard is invisible from the sweet spot (it's behind the painting plane) but fills the void on the far side. Together, forward and mirror shards make the cloud continuous from in front of the painting to behind it, eliminating dead zones between paintings.

Both sets are included in the same baked file. Each shard carries an `isMirror` flag (0 or 1) for potential shader differentiation.

### 2.5 DINOv2 Pareidolia Graph

**Feature extraction:**
- Run DINOv2 (ViT-L/14) on each painting
- Extract patch-level embeddings (14×14 patches for a standard 224×224 input, interpolated for larger images)
- Store per-patch embedding: `[n_patches, 1024]` per painting

**Edge construction:**
- For each pair of paintings (A, B), compute pairwise cosine similarity between all patch embeddings
- Find the maximum-similarity patch pair `(p_a, p_b)` with similarity `> 0.75`
- If found: create a directed edge A→B and B→A with:
  - `weight`: cosine similarity score
  - `s_uv`: centre UV of patch `p_a` on painting A
  - `t_uv`: centre UV of patch `p_b` on painting B

**Fallback:** if no patch pair exceeds the threshold, fall back to dominant-color distance and create an edge with weight 0.5 and anchor UVs at both image centres `[0.5, 0.5]`.

### 2.6 Output Format

**`{id}.baked.json`:**
```json
{
  "id": "painting_id",
  "res": [1920, 1080],
  "count": 2400,
  "aOffset":   [...],   // flat Float32Array, stride 3 (x, y, z)
  "aScale":    [...],   // flat Float32Array, stride 2 (sx, sy)
  "aColor":    [...],   // flat Float32Array, stride 3 (r, g, b, 0–1)
  "aUvOffset": [...],   // flat Float32Array, stride 2
  "aUvScale":  [...],   // flat Float32Array, stride 2
  "isMirror":  [...]    // flat Uint8Array,   stride 1 (0 or 1)
}
```
First `count/2` entries are forward shards; remaining are mirrors. Total instance count = forward + mirror.

**`graph.json`:**
```json
{
  "nodes": [
    { "id": "...", "image": "painting.jpg", "title": "...", "shardCount": 2400 }
  ],
  "edges": [
    {
      "source": "painting_a",
      "target": "painting_b",
      "weight": 0.87,
      "s_uv": [0.42, 0.31],
      "t_uv": [0.58, 0.67]
    }
  ]
}
```

---

## 3. The Renderer

### 3.1 Unified Instanced Field

**One `InstancedBufferGeometry` always.** It is partitioned into two slots:
- Slot 0: current painting's shards (forward + mirror)
- Slot 1: next painting's shards (forward + mirror)

A staging buffer holds the next-next painting's data while it loads. At segment completion:
- Slot 0 ← Slot 1 data
- Slot 1 ← staging buffer data
- Begin fetching next-next

No mesh swaps. No alpha crossfades. The buffer rolls; shards update in-place.

### 3.2 Per-Instance Attributes

Beyond the standard baked attributes, each instance receives two runtime-assigned values when written into the buffer:

- `aSweetSpotZ` (float): the world Z at which this shard's painting resolves
- `aRandom` (vec3): deterministic random values derived from shard index + painting ID hash (not `Math.random()` — must be reproducible)

### 3.3 Anamorphic Vertex Shader

```glsl
attribute vec3  aOffset;
attribute vec2  aScale;
attribute vec3  aColor;
attribute vec3  aRandom;
attribute float aSweetSpotZ;
attribute vec2  aUvOffset;
attribute vec2  aUvScale;

uniform float uCameraZ;
uniform float uTime;
uniform float uFocusWindow;   // default: 60.0

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;

void main() {
    vUv   = aUvOffset + (uv * aUvScale);
    vColor = aColor;

    float dist     = abs(uCameraZ - aSweetSpotZ);
    float progress = smoothstep(0.0, uFocusWindow, dist);  // 0 = aligned, 1 = chaotic

    // Chaos: drift and tumble proportional to distance from sweet spot
    vec3 chaosOffset = vec3(
        sin(uTime * aRandom.z + aOffset.y) * 25.0,
        cos(uTime * aRandom.z + aOffset.x) * 25.0,
        sin(uTime * 0.3 + aRandom.x)       * 60.0
    );

    vec3 axis   = normalize(aRandom);
    float angle = uTime * aRandom.z + progress * 8.0;
    // Rodrigues rotation
    vec3 tumbled = mix(dot(axis, position.xyz) * axis, position.xyz, cos(angle))
                   + cross(axis, position.xyz) * sin(angle);

    vec3 pos = mix(position.xyz, tumbled, progress);
    pos.xy *= aScale;

    vec3 finalPos = aOffset + pos + (chaosOffset * progress);

    vAlpha = 1.0 - smoothstep(0.0, uFocusWindow * 0.3, dist) * 0.4; // subtle near-fade

    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
}
```

### 3.4 Fragment Shader

Texture sample at `vUv`, fall back to `vColor` if texture unavailable. Alpha mask using smooth circle on `vLocalUv`. Final alpha = mask × `vAlpha` (from vertex). Discard if alpha < 0.05.

### 3.5 ShardMaterial Registration

Replaces current `ShardMaterial.js`. Registered via `shaderMaterial` + `extend` from `@react-three/drei`/`@react-three/fiber`. Uniforms: `uCameraZ`, `uTime`, `uFocusWindow`, `uTexture`, `uHasTexture`.

---

## 4. Navigation

### 4.1 Camera Controller

No `ScrollControls`. Raw `wheel` event listener on `document` (+ touch delta for mobile). Accumulates into a global `scrollAccumulator` with velocity and damping:

```
velocity  += delta * SCROLL_SENSITIVITY
velocity  *= DAMPING   // e.g. 0.88 per frame
cameraZ   += velocity
```

`cameraZ` is passed to the store and written to `uCameraZ` each frame.

### 4.2 Spline Path

Each segment: a `CatmullRomCurve3` with three control points:
- Start: current painting's sweet spot `(cx, cy, sweetZ_current)`
- Mid: world position of the pareidolia anchor (average of `s_uv` and `t_uv` projected to world space, midway between the two sweet spots in Z)
- End: next painting's sweet spot `(nx, ny, sweetZ_next)`

Sweet spot spacing: `SEGMENT_LENGTH = 200.0` units. Each painting placed at `Z = -(index * SEGMENT_LENGTH)`.

The camera's `(x, y)` position follows the spline; `z` is driven directly by `cameraZ`. This means the lateral drift through the anchor region happens naturally as the user scrolls.

### 4.3 Session History

```
history: [{ id, sweetSpotZ, splinePoints }, ...]
position: 0   // index into history of current painting
```

**Going forward** (scroll decreases Z toward next sweet spot):
- If `position < history.length - 1`: advance `position`, follow stored spline (deterministic)
- If `position === history.length - 1` (frontier): stochastic walker picks next node, appends to history, advances `position`

**Going backward** (scroll increases Z back toward previous sweet spot):
- Decrement `position`, follow stored spline in reverse

**Stochastic walker** (frontier only):
- Filter edges from current node
- Exclude last 5 visited IDs
- Select probabilistically by `weight`

### 4.4 Pre-loading

At `t = 0.6` on the current segment (where `t = (cameraZ - sweetZ_current) / SEGMENT_LENGTH`):
- Walker picks next-next node (or reads from history if not at frontier)
- Fetch `{id}.baked.json` into staging buffer

At `t = 1.0`: roll buffers, write staging into Slot 1.

### 4.5 Memory

- Slot 0 + Slot 1: always in GPU buffer
- Staging: CPU-side, transferred at rollover
- History entries beyond current `position + 2` or before `position - 1`: baked data evicted from CPU; spline points and IDs retained in history array for re-fetch on backward navigation

---

## 5. Dead Code to Remove

| File | Reason |
|---|---|
| `src/canvas/InfiniteVoid.jsx` | Legacy entry point, never mounted |
| `src/canvas/StrokeCloud.jsx` | Legacy renderer, unused |
| `src/canvas/CameraRig.jsx` | Legacy camera, unused |
| `src/canvas/InfiniteCanvas.jsx` | Orphaned — references `state.activeId` and `state.manifest` which don't exist in current store |
| `src/shaders/anamorphic.vert` | Replaced by unified shader in ShardMaterial |
| `src/shaders/anamorphic.frag` | Replaced by unified shader in ShardMaterial |
| `src/shaders/AnamorphicShader.js` | Unused |
| `src/components/AnamorphicCam.jsx` | Replaced by new wheel-based camera controller |

---

## 6. Bugs Fixed by This Design

| Bug | Fix |
|---|---|
| `goBackward()` references non-existent `state.currentPath` | Entire backward nav model replaced |
| `completeTransition()` desyncs from scroll on fast scroll | Replaced by continuous `cameraZ` — no segment index tracking |
| `PAGES_PER_SEGMENT = 4` hardcoded in 3 files | Eliminated — no page model |
| `aRandom` regenerated randomly on every mount | Derived deterministically from shard index + painting ID hash |
| `InfiniteCanvas.jsx` no-op ternary `stroke.z !== undefined ? stroke.z : stroke.z` | File removed |
| `uHasTexture` not in ShardMaterial uniform defaults | Uniform added explicitly |
| `useLoader` with null URL causing suspend thrash | Texture loaded after baked data confirms URL |
| Active shader has no anamorphic chaos function | Shader rebuilt from scratch with full chaos/coalesce logic |

---

## 7. Out of Scope

- UI overlay (`Overlay.jsx`, `GlassMenu.jsx`, `Signature.jsx`) — visual changes only if needed for aesthetics
- PWA/service worker configuration
- Painting metadata (titles, descriptions) — `graph.json` nodes include `title` field but no UI spec defined here
- Mobile scroll performance tuning (addressed in implementation, not spec)
