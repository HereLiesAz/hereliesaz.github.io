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

**Coordinate convention:** baked coordinates assume the sweet spot is at Z = 0. The viewer translates all shards to their actual world Z at load time (see Section 3.2).

**`aspect`** = `img_w / img_h` (source image pixel ratio, not viewport ratio).

For each shard with image-space centroid `(u, v)` (normalised 0–1) and depth `z_world`:

```
# Focal length in WORLD UNITS — must match the viewer's PerspectiveCamera FOV
FOV_rad = 50.0 * PI / 180.0
f_world = (WORLD_HEIGHT / 2.0) / tan(FOV_rad / 2.0)   # ≈ 10.72 for WORLD_HEIGHT=10

# Unproject to world position at depth z_world from the sweet spot
world_x = (u - 0.5) * WORLD_HEIGHT * aspect * (z_world / f_world)
world_y = (0.5 - v) * WORLD_HEIGHT             * (z_world / f_world)
world_z = -z_world   # negative = in front of sweet spot (camera looks in -Z direction)

# Scale compensation: shard must cover the same apparent screen area at any depth
scale_x = (shard_width_px  / img_w) * WORLD_HEIGHT * aspect * (z_world / f_world)
scale_y = (shard_height_px / img_h) * WORLD_HEIGHT           * (z_world / f_world)

uv_offset = [shard_x_min / img_w, shard_y_min / img_h]
uv_scale  = [shard_width_px / img_w, shard_height_px / img_h]
```

`WORLD_HEIGHT = 10.0` units. From a camera at `(0, 0, 0)` looking in the −Z direction, every shard appears exactly at its original pixel location. From any other position: chaos.

### 2.4 Mirror Shards

In baked coordinates (sweet spot at Z = 0), each forward shard is at `world_z = -z_world` (negative, in front). Its mirror is:

```
mirror_wz = +z_world   # same distance behind the sweet spot (positive Z)
```

`(wx, wy)` and scale are identical to the forward shard. From the sweet spot, mirrors are behind the camera and invisible. From the void between paintings, they fill the far side of the cloud. Together, forward and mirror shards make the field continuous through the sweet spot plane, eliminating dead zones.

**Back-face culling:** mirror shards must render with `side = THREE.DoubleSide` so they are visible when the camera is past the sweet spot looking back.

Both sets are included in the same baked file. Each shard carries an `isMirror` flag (0 or 1) for potential shader differentiation.

**`totalCount`** in the baked JSON = forward count + mirror count (always even; `forwardCount = totalCount / 2`). First `totalCount / 2` entries are forward shards; remaining are mirrors.

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
  "totalCount": 4800,
  "aOffset":   [...],   // flat Float32, stride 3 (x, y, z) — coords relative to sweet spot at Z=0
  "aScale":    [...],   // flat Float32, stride 2 (sx, sy)
  "aColor":    [...],   // flat Float32, stride 3 (r, g, b, range 0–1)
  "aUvOffset": [...],   // flat Float32, stride 2
  "aUvScale":  [...],   // flat Float32, stride 2
  "isMirror":  [...]    // flat Uint8,   stride 1 (0 = forward, 1 = mirror)
}
```
`totalCount` is always even. First `totalCount / 2` entries are forward shards; remaining are mirrors. Baked coordinates assume sweet spot at Z = 0; the viewer offsets to world space at load time.

**Schema note:** this schema is **incompatible** with the existing `graph.json` and `.baked.json` files on disk. All existing data files must be regenerated by the new preprocessor before the new viewer will function.

**`graph.json`:**
```json
{
  "nodes": [
    { "id": "...", "image": "painting.jpg", "title": "...", "totalCount": 4800 }
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

**One `InstancedBufferGeometry` always.** Pre-allocated at construction for `MAX_INSTANCES = 12000` total instances (`MAX_PER_SLOT = 6000` per painting — accommodates up to 3000 forward + 3000 mirror shards). The buffer is physically one contiguous allocation; Slot 0 occupies indices `[0, count_0)` and Slot 1 occupies indices `[count_0, count_0 + count_1)`. `geo.instanceCount` is set to `count_0 + count_1` so Three.js draws only the populated range; instances beyond that index are never drawn.

A CPU-side staging `Float32Array` holds the next-next painting's data while fetching. At segment completion, the rollover sequence is:
1. Copy current Slot 1 typed arrays into Slot 0 position (CPU-side `TypedArray.set`)
2. Write staging into Slot 1 position
3. Update `geo.instanceCount = new_count_0 + new_count_1`
4. Mark all buffer attributes `needsUpdate = true`
5. Begin fetching next-next into staging

No mesh swaps. No alpha crossfades. The buffer rolls; shards update in-place. The CPU copy at rollover is bounded: `MAX_PER_SLOT × (3+2+3+2+2+3+1) × 4 bytes ≈ 960 KB` — acceptable for a one-time-per-segment operation.

### 3.2 Per-Instance Attributes

Beyond the baked attributes, each instance receives runtime-assigned values when written into the buffer:

**`aSweetSpotZ` (float):** the world Z at which this shard's painting resolves. Computed at load time as `-(sessionIndex * SEGMENT_LENGTH)` where `sessionIndex` is the painting's position in the session history. All instances in the same slot receive the same value. After computing `aSweetSpotZ`, the viewer also adds it to each shard's `aOffset.z` to translate from baked local coordinates to world space: `worldOffsetZ = bakedOffsetZ + aSweetSpotZ`.

**`aRandom` (vec3):** deterministic per-shard entropy. Derived via a hash, not `Math.random()`, so the chaos pattern is reproducible:
```
# FNV-1a 32-bit hash of the string "paintingId_shardIndex"
seed_int = fnv1a_32(f"{paintingId}_{shardIndex}")
# Reduce to float [0,1) — same formula in JS and Python
seed = (seed_int & 0x7FFFFFFF) / 2147483647.0
aRandom[0] = fract(sin(seed * 127.1) * 43758.5453)
aRandom[1] = fract(sin(seed * 311.7) * 43758.5453)
aRandom[2] = fract(sin(seed * 74.3)  * 43758.5453)
```
FNV-1a 32-bit is trivial to implement identically in Python and JS. The `& 0x7FFFFFFF` mask and `/2147483647.0` normalisation must be applied in both environments to guarantee matching float output. The resulting values are in `[0, 1)` and are remapped to `[-1, 1]` in the vertex shader (see Section 3.3) before use as a rotation axis.

### 3.3 Anamorphic Vertex Shader

```glsl
attribute vec3  aOffset;      // world-space position (baked + sweetSpotZ offset applied by CPU)
attribute vec2  aScale;       // (sx, sy) in world units
attribute vec3  aColor;       // (r, g, b) 0–1
attribute vec3  aRandom;      // deterministic per-shard entropy
attribute float aSweetSpotZ;  // world Z of this shard's painting sweet spot
attribute vec2  aUvOffset;
attribute vec2  aUvScale;

uniform float uCameraZ;
uniform float uTime;
uniform float uFocusWindow;   // default: 60.0 — at midpoint (100 units), progress = 1.0 (fully chaotic, intentional)

varying vec2  vUv;
varying vec2  vLocalUv;       // unit quad UV [0,1]² — used by fragment for circular mask
varying vec3  vColor;
varying float vAlpha;

void main() {
    vUv      = aUvOffset + (uv * aUvScale);
    vLocalUv = uv;
    vColor   = aColor;

    float dist     = abs(uCameraZ - aSweetSpotZ);
    float progress = smoothstep(0.0, uFocusWindow, dist);  // 0 = aligned, 1 = chaotic

    // 1. Apply scale to unit quad — BEFORE rotation so aspect ratio is preserved
    vec3 pos = position;
    pos.xy *= aScale;

    // 2. Tumble: rotate the scaled shard when chaotic
    // Remap [0,1] → [-1,1] before normalizing so axis covers the full sphere
    vec3 axis   = normalize(aRandom * 2.0 - 1.0);
    float angle = uTime * aRandom.z + progress * 8.0;
    // Rodrigues rotation of the scaled position
    vec3 tumbled = mix(dot(axis, pos) * axis, pos, cos(angle))
                   + cross(axis, pos) * sin(angle);

    pos = mix(pos, tumbled, progress);

    // 3. Chaos drift: world-space displacement proportional to distance from sweet spot
    vec3 chaosOffset = vec3(
        sin(uTime * aRandom.z + aOffset.y) * 25.0,
        cos(uTime * aRandom.z + aOffset.x) * 25.0,
        sin(uTime * 0.3       + aRandom.x) * 60.0
    );
    // At midpoint between paintings (dist = 100, progress = 1.0), shards from both
    // paintings intermingle — this is the intended pareidolia zone.

    vec3 finalPos = aOffset + pos + (chaosOffset * progress);

    vAlpha = 1.0 - smoothstep(0.0, uFocusWindow * 0.3, dist) * 0.4;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
}
```

### 3.4 Fragment Shader

Texture sample at `vUv`, fall back to `vColor` if texture unavailable. Alpha mask: smooth circle on `vLocalUv` (unit quad UV — supplied by vertex shader as `vLocalUv = uv`):
```glsl
float dist = length(vLocalUv - 0.5) * 2.0;
float mask = smoothstep(1.0, 0.4, dist);
```
Final alpha = `mask × vAlpha`. Discard if alpha < 0.05.

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

**Stochastic walker** (frontier only — never applied when retracing history):
- Filter edges from current node
- Exclude the last 5 IDs in the history array (loop suppression, forward-only)
- Select probabilistically by `weight`

### 4.4 Pre-loading

At `t = 0.6` on the current segment (where `t = (sweetZ_current - cameraZ) / SEGMENT_LENGTH`, so `t` increases as the camera moves forward into negative Z):
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
