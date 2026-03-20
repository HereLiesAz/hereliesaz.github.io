# Shard Cloud Preprocessor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python preprocessing pipeline that ingests raw painting images and outputs deterministic per-painting `.baked.json` shard geometry files and a `graph.json` pareidolia similarity graph consumed by the viewer.

**Architecture:** A modular pipeline in `scripts/shard_prep/` with one file per concern (segmentation, depth, projection, graph). A single `scripts/prepare.py` entry point orchestrates the pipeline per image. All heavy ML models (MiDaS, DINOv2) are loaded once and reused across images. Output files land in `public/data/baked/` and `public/graph.json`.

**Tech Stack:** Python 3.10+, scikit-image (SLIC), OpenCV (LAB conversion, contours), torch + timm (MiDaS depth), transformers (DINOv2), numpy, pytest

---

## Reference

- Spec: `docs/superpowers/specs/2026-03-20-unified-shard-field-design.md` §2
- Existing scripts (reference only, do not extend): `scripts/grinder.py`, `scripts/curator.py`, `scripts/indexer.py`
- Output consumed by: `docs/superpowers/plans/2026-03-20-viewer.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/shard_prep/__init__.py` | Create | Package marker |
| `scripts/shard_prep/segmentation.py` | Create | SLIC + LAB merge → shard masks |
| `scripts/shard_prep/depth.py` | Create | MiDaS depth map + per-shard depth |
| `scripts/shard_prep/projection.py` | Create | Anamorphic math: forward + mirror shards |
| `scripts/shard_prep/graph_builder.py` | Create | DINOv2 embedding extraction + edge construction |
| `scripts/shard_prep/tests/__init__.py` | Create | Test package marker |
| `scripts/shard_prep/tests/test_projection.py` | Create | Unit tests for all projection math |
| `scripts/shard_prep/tests/test_segmentation.py` | Create | Unit tests for segmentation output format |
| `scripts/shard_prep/tests/test_graph.py` | Create | Unit tests for graph schema |
| `scripts/prepare.py` | Create | CLI entry point: orchestrates pipeline per image |
| `scripts/validate_output.py` | Create | Post-run validation: checks schema, counts, ranges |
| `scripts/requirements.txt` | Modify | Add new dependencies |

**Do not modify** any existing scripts. The new pipeline runs independently.

---

## Task 1: Dependencies and Package Structure

**Files:**
- Create: `scripts/shard_prep/__init__.py`
- Create: `scripts/shard_prep/tests/__init__.py`
- Modify: `scripts/requirements.txt`

- [ ] **Step 1: Add new dependencies to requirements.txt**

Open `scripts/requirements.txt`. Add these lines (keep existing lines):
```
scikit-image>=0.22.0
pytest>=8.0.0
```
MiDaS is loaded via `torch.hub`; DINOv2 via `transformers` — both should already be available from the existing requirements. Verify `torch`, `timm`, `transformers`, `opencv-python`, `numpy` are present. Add any missing ones.

- [ ] **Step 2: Install**
```bash
cd /home/az/StudioProjects/HereLiesAzdotCom
pip install -r scripts/requirements.txt
```
Expected: no errors.

- [ ] **Step 3: Create package files**

`scripts/shard_prep/__init__.py` — empty file:
```python
```

`scripts/shard_prep/tests/__init__.py` — empty file:
```python
```

- [ ] **Step 4: Verify pytest finds the test directory**
```bash
cd /home/az/StudioProjects/HereLiesAzdotCom
python -m pytest scripts/shard_prep/tests/ --collect-only
```
Expected: "no tests ran" (no test files yet — that's fine).

- [ ] **Step 5: Commit**
```bash
git add scripts/requirements.txt scripts/shard_prep/
git commit -m "chore: scaffold preprocessor package and add dependencies"
```

---

## Task 2: Projection Math (Core Unit-Testable Module)

Build the anamorphic projection and mirror math first — it's pure arithmetic, has no ML dependencies, and is the most critical correctness surface.

**Files:**
- Create: `scripts/shard_prep/projection.py`
- Create: `scripts/shard_prep/tests/test_projection.py`

**Spec reference:** `docs/superpowers/specs/2026-03-20-unified-shard-field-design.md` §2.3, §2.4

- [ ] **Step 1: Write the failing tests**

Create `scripts/shard_prep/tests/test_projection.py`:
```python
import numpy as np
import pytest
from shard_prep.projection import project_shard, mirror_shard, WORLD_HEIGHT, FOV_DEG

def test_centred_shard_at_focal_depth_has_zero_xy():
    """A shard centred in the image at focal depth should appear at world origin."""
    f_world = (WORLD_HEIGHT / 2.0) / np.tan(np.radians(FOV_DEG / 2.0))
    result = project_shard(u=0.5, v=0.5, z_world=f_world,
                           img_w=1000, img_h=1000,
                           shard_w_px=10, shard_h_px=10,
                           shard_x_min=495, shard_y_min=495)
    assert abs(result['world_x']) < 1e-5
    assert abs(result['world_y']) < 1e-5

def test_deeper_shard_is_further_from_origin():
    """A shard displaced to the right appears further right at greater depth."""
    r1 = project_shard(u=0.75, v=0.5, z_world=10.0, img_w=1000, img_h=1000,
                       shard_w_px=10, shard_h_px=10, shard_x_min=745, shard_y_min=495)
    r2 = project_shard(u=0.75, v=0.5, z_world=20.0, img_w=1000, img_h=1000,
                       shard_w_px=10, shard_h_px=10, shard_x_min=745, shard_y_min=495)
    assert r2['world_x'] > r1['world_x']

def test_deeper_shard_has_larger_scale():
    """Deeper shards must be scaled up to maintain the same apparent screen size."""
    r1 = project_shard(u=0.5, v=0.5, z_world=10.0, img_w=1000, img_h=1000,
                       shard_w_px=100, shard_h_px=100, shard_x_min=450, shard_y_min=450)
    r2 = project_shard(u=0.5, v=0.5, z_world=20.0, img_w=1000, img_h=1000,
                       shard_w_px=100, shard_h_px=100, shard_x_min=450, shard_y_min=450)
    assert r2['scale_x'] > r1['scale_x']
    assert r2['scale_y'] > r1['scale_y']

def test_shard_world_z_is_negative_of_z_world():
    """Forward shards are in front of sweet spot (negative Z in baked coords)."""
    result = project_shard(u=0.5, v=0.5, z_world=30.0, img_w=1000, img_h=1000,
                           shard_w_px=10, shard_h_px=10, shard_x_min=495, shard_y_min=495)
    assert result['world_z'] == pytest.approx(-30.0)

def test_mirror_is_symmetric_through_sweet_spot():
    """Mirror shard z is equal and opposite to forward shard z (sweet spot at 0)."""
    fwd = project_shard(u=0.5, v=0.5, z_world=40.0, img_w=1000, img_h=1000,
                        shard_w_px=10, shard_h_px=10, shard_x_min=495, shard_y_min=495)
    mir = mirror_shard(fwd)
    assert mir['world_z'] == pytest.approx(40.0)
    assert mir['world_x'] == pytest.approx(fwd['world_x'])
    assert mir['world_y'] == pytest.approx(fwd['world_y'])
    assert mir['scale_x'] == pytest.approx(fwd['scale_x'])
    assert mir['is_mirror'] == 1

def test_uv_offset_and_scale_normalised():
    """UV offset and scale must be in [0, 1] and sum to <= 1."""
    result = project_shard(u=0.3, v=0.7, z_world=20.0, img_w=800, img_h=600,
                           shard_w_px=80, shard_h_px=60, shard_x_min=200, shard_y_min=380)
    assert 0.0 <= result['uv_offset'][0] <= 1.0
    assert 0.0 <= result['uv_offset'][1] <= 1.0
    assert result['uv_offset'][0] + result['uv_scale'][0] <= 1.0 + 1e-6
    assert result['uv_offset'][1] + result['uv_scale'][1] <= 1.0 + 1e-6
```

- [ ] **Step 2: Run to confirm all tests fail**
```bash
cd /home/az/StudioProjects/HereLiesAzdotCom
python -m pytest scripts/shard_prep/tests/test_projection.py -v
```
Expected: ImportError — `shard_prep.projection` does not exist yet.

- [ ] **Step 3: Implement projection.py**

Create `scripts/shard_prep/projection.py`:
```python
import numpy as np

WORLD_HEIGHT = 10.0   # world units — must match viewer PerspectiveCamera
FOV_DEG      = 50.0   # degrees — must match viewer PerspectiveCamera


def _focal_world() -> float:
    """Focal length in world units, matching a PerspectiveCamera with WORLD_HEIGHT."""
    return (WORLD_HEIGHT / 2.0) / np.tan(np.radians(FOV_DEG / 2.0))


def project_shard(
    u: float, v: float, z_world: float,
    img_w: int, img_h: int,
    shard_w_px: float, shard_h_px: float,
    shard_x_min: float, shard_y_min: float,
) -> dict:
    """
    Compute the anamorphic world-space position and scale for one shard.

    All baked coordinates assume sweet spot at Z=0. The viewer adds the
    actual sweetSpotZ at load time.

    Args:
        u, v:           Normalised image centroid [0,1]
        z_world:        Depth from sweet spot in world units (positive = in front)
        img_w, img_h:   Source image dimensions in pixels
        shard_w_px, shard_h_px: Shard bounding box size in pixels
        shard_x_min, shard_y_min: Shard bounding box top-left in pixels

    Returns dict with keys:
        world_x, world_y, world_z,  scale_x, scale_y,
        uv_offset [2], uv_scale [2], is_mirror (0)
    """
    aspect  = img_w / img_h
    f_world = _focal_world(img_w, img_h)

    ratio = z_world / f_world

    world_x = (u - 0.5) * WORLD_HEIGHT * aspect * ratio
    world_y = (0.5 - v) * WORLD_HEIGHT           * ratio
    world_z = -z_world  # negative = in front of sweet spot

    scale_x = (shard_w_px / img_w) * WORLD_HEIGHT * aspect * ratio
    scale_y = (shard_h_px / img_h) * WORLD_HEIGHT           * ratio

    uv_offset = [shard_x_min / img_w, shard_y_min / img_h]
    uv_scale  = [shard_w_px  / img_w, shard_h_px  / img_h]

    return dict(
        world_x=world_x, world_y=world_y, world_z=world_z,
        scale_x=scale_x, scale_y=scale_y,
        uv_offset=uv_offset, uv_scale=uv_scale,
        is_mirror=0,
    )


def mirror_shard(fwd: dict) -> dict:
    """
    Create a mirror shard from a forward shard.
    The mirror is at +z_world (behind sweet spot), same XY and scale.
    """
    m = fwd.copy()
    m['world_z'] = -fwd['world_z']  # fwd is negative; mirror is positive
    m['is_mirror'] = 1
    return m
```

- [ ] **Step 4: Run tests**
```bash
python -m pytest scripts/shard_prep/tests/test_projection.py -v
```
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**
```bash
git add scripts/shard_prep/projection.py scripts/shard_prep/tests/test_projection.py
git commit -m "feat(prep): add anamorphic projection and mirror math with tests"
```

---

## Task 3: Segmentation Module

**Files:**
- Create: `scripts/shard_prep/segmentation.py`
- Create: `scripts/shard_prep/tests/test_segmentation.py`

**Spec reference:** §2.1

- [ ] **Step 1: Write failing tests**

Create `scripts/shard_prep/tests/test_segmentation.py`:
```python
import numpy as np
import pytest
from shard_prep.segmentation import segment_image

def make_test_image(h=100, w=100):
    """Solid blue image — should produce few large segments."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :] = [0, 0, 200]
    return img

def make_gradient_image(h=100, w=100):
    """Strong left-right gradient — should produce multiple segments."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    for x in range(w):
        img[:, x] = [int(x * 2.5), 0, 0]
    return img

def test_returns_list_of_masks():
    img = make_test_image()
    masks = segment_image(img)
    assert isinstance(masks, list)
    assert len(masks) > 0

def test_each_mask_is_bool_array_matching_image_shape():
    img = make_test_image()
    masks = segment_image(img)
    for mask in masks:
        assert mask.dtype == bool
        assert mask.shape == img.shape[:2]

def test_masks_cover_entire_image():
    """Every pixel must belong to exactly one mask."""
    img = make_gradient_image()
    masks = segment_image(img)
    coverage = np.zeros(img.shape[:2], dtype=int)
    for mask in masks:
        coverage += mask.astype(int)
    assert np.all(coverage == 1), "Some pixels are in 0 or 2+ masks"

def test_gradient_produces_multiple_segments():
    """A high-contrast image should produce more than one segment."""
    img = make_gradient_image()
    masks = segment_image(img)
    assert len(masks) > 1

def test_no_mask_larger_than_5_percent():
    """Post-processing must split regions larger than 5% of image area."""
    img = make_test_image(h=200, w=200)
    masks = segment_image(img)
    max_allowed = 0.05 * 200 * 200
    for mask in masks:
        assert mask.sum() <= max_allowed + 1, f"Mask too large: {mask.sum()} px"
```

- [ ] **Step 2: Run to confirm failure**
```bash
python -m pytest scripts/shard_prep/tests/test_segmentation.py -v
```
Expected: ImportError.

- [ ] **Step 3: Implement segmentation.py**

Create `scripts/shard_prep/segmentation.py`:
```python
import numpy as np
import cv2
from skimage.segmentation import slic
from skimage.color import rgb2lab
from skimage.measure import label, regionprops

# Merge adjacent superpixels whose LAB distance is below this threshold
_LAB_MERGE_THRESHOLD = 15.0
# Split any region larger than this fraction of the image
_MAX_REGION_FRACTION = 0.05


def segment_image(img_rgb: np.ndarray, n_segments: int = 800) -> list[np.ndarray]:
    """
    Segment a painting image into organic shards following color/lighting regions.

    Args:
        img_rgb:    HxWx3 uint8 RGB image
        n_segments: target superpixel count (actual count may differ)

    Returns:
        List of boolean HxW masks, one per shard. Every pixel belongs to
        exactly one mask.
    """
    h, w = img_rgb.shape[:2]
    max_area = int(_MAX_REGION_FRACTION * h * w)

    # Step 1: SLIC superpixels in LAB space
    lab = rgb2lab(img_rgb / 255.0)
    segments = slic(lab, n_segments=n_segments, compactness=0.1,
                    start_label=0, channel_axis=2)

    # Step 2: Compute mean LAB colour per superpixel
    n_sp = segments.max() + 1
    sp_colours = np.zeros((n_sp, 3), dtype=float)
    sp_counts  = np.zeros(n_sp, dtype=int)
    for sp_id in range(n_sp):
        mask = segments == sp_id
        sp_colours[sp_id] = lab[mask].mean(axis=0)
        sp_counts[sp_id]  = mask.sum()

    # Step 3: Merge adjacent superpixels with similar colour
    merged = _merge_similar(segments, sp_colours, lab, h, w)

    # Step 4: Collect masks; split oversized regions
    masks = []
    unique_ids = np.unique(merged)
    for uid in unique_ids:
        region_mask = merged == uid
        if region_mask.sum() > max_area:
            masks.extend(_split_region(region_mask, max_area))
        else:
            masks.append(region_mask)

    return masks


def _merge_similar(segments, sp_colours, lab, h, w):
    """Merge superpixels below the LAB distance threshold using union-find."""
    n_sp = sp_colours.shape[0]
    parent = list(range(n_sp))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        parent[find(a)] = find(b)

    # Find adjacencies via horizontal and vertical shifts
    for axis in [0, 1]:
        slices_a = [slice(None), slice(None)]
        slices_b = [slice(None), slice(None)]
        slices_a[axis] = slice(None, -1)
        slices_b[axis] = slice(1, None)
        ids_a = segments[tuple(slices_a)]
        ids_b = segments[tuple(slices_b)]
        adj = np.stack([ids_a.ravel(), ids_b.ravel()], axis=1)
        adj = adj[adj[:, 0] != adj[:, 1]]
        adj = np.unique(adj, axis=0)
        for a, b in adj:
            ra, rb = find(a), find(b)
            if ra != rb:
                dist = np.linalg.norm(sp_colours[a] - sp_colours[b])
                if dist < _LAB_MERGE_THRESHOLD:
                    union(a, b)

    merged = np.vectorize(find)(segments)
    return merged


def _split_region(mask: np.ndarray, max_area: int) -> list[np.ndarray]:
    """Split a large region into sub-regions using connected components."""
    # Label connected components (region may already be one component,
    # so we divide using a grid-based sub-label approach)
    labelled = label(mask)
    props = regionprops(labelled)
    result = []
    for prop in props:
        sub_mask = labelled == prop.label
        if sub_mask.sum() > max_area:
            # Grid-split: divide bounding box into quadrants
            rmin, cmin, rmax, cmax = prop.bbox
            rmid, cmid = (rmin + rmax) // 2, (cmin + cmax) // 2
            quadrants = [
                (rmin, cmin, rmid, cmid), (rmin, cmid, rmid, cmax),
                (rmid, cmin, rmax, cmid), (rmid, cmid, rmax, cmax),
            ]
            for r0, c0, r1, c1 in quadrants:
                q_mask = np.zeros_like(mask)
                q_mask[r0:r1, c0:c1] = sub_mask[r0:r1, c0:c1]
                if q_mask.sum() > 0:
                    result.append(q_mask)
        else:
            result.append(sub_mask)
    return result if result else [mask]
```

- [ ] **Step 4: Run tests**
```bash
python -m pytest scripts/shard_prep/tests/test_segmentation.py -v
```
Expected: all 5 tests PASS. If `test_no_mask_larger_than_5_percent` fails on a solid-colour image (one superpixel), confirm `_split_region` recursion is working.

- [ ] **Step 5: Commit**
```bash
git add scripts/shard_prep/segmentation.py scripts/shard_prep/tests/test_segmentation.py
git commit -m "feat(prep): add color/lighting segmentation with SLIC+LAB merge"
```

---

## Task 4: Depth Module

**Files:**
- Create: `scripts/shard_prep/depth.py`

No separate unit tests — MiDaS requires model download. Integration tested in Task 6.

**Spec reference:** §2.2

- [ ] **Step 1: Implement depth.py**

Create `scripts/shard_prep/depth.py`:
```python
import numpy as np
import torch
import cv2

_model = None
_transform = None


def _load_model():
    global _model, _transform
    if _model is None:
        _model = torch.hub.load('intel-isl/MiDaS', 'MiDaS_small')
        _model.eval()
        transforms = torch.hub.load('intel-isl/MiDaS', 'transforms')
        _transform = transforms.small_transform
        if torch.cuda.is_available():
            _model = _model.cuda()


def get_depth_map(img_rgb: np.ndarray) -> np.ndarray:
    """
    Run MiDaS on an RGB image. Returns a HxW float32 depth map,
    values normalised to [0.0, 1.0] (0 = near, 1 = far).
    """
    _load_model()
    device = next(_model.parameters()).device
    input_tensor = _transform(img_rgb).to(device)
    with torch.no_grad():
        prediction = _model(input_tensor)
        prediction = torch.nn.functional.interpolate(
            prediction.unsqueeze(1),
            size=img_rgb.shape[:2],
            mode='bicubic',
            align_corners=False,
        ).squeeze()
    depth = prediction.cpu().numpy().astype(np.float32)
    d_min, d_max = depth.min(), depth.max()
    if d_max > d_min:
        depth = (depth - d_min) / (d_max - d_min)
    else:
        depth[:] = 0.5
    return depth


def assign_shard_depths(
    masks: list[np.ndarray],
    depth_map: np.ndarray,
    img_rgb: np.ndarray,
    z_spread: float = 80.0,
    contrast_bonus: float = 0.2,
) -> list[float]:
    """
    Compute a z_world depth value for each shard mask.

    Args:
        masks:          List of boolean HxW masks from segmentation
        depth_map:      HxW float32 depth map in [0,1]
        img_rgb:        HxWx3 RGB image (used for contrast bonus)
        z_spread:       Maximum world-unit depth range
        contrast_bonus: Added to z_local for high-contrast edges

    Returns:
        List of float z_world values (world units, positive = in front of sweet spot)
    """
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY).astype(float) / 255.0
    edges = cv2.Laplacian(gray, cv2.CV_64F)
    edge_magnitude = np.abs(edges)
    # Normalise edge magnitude to [0,1]
    e_max = edge_magnitude.max()
    if e_max > 0:
        edge_magnitude /= e_max

    depths = []
    for mask in masks:
        z_local = float(depth_map[mask].mean())
        contrast = float(edge_magnitude[mask].mean())
        z_local = min(1.0, z_local + contrast * contrast_bonus)
        depths.append(z_local * z_spread)
    return depths
```

- [ ] **Step 2: Verify import**
```bash
python -c "from shard_prep.depth import get_depth_map, assign_shard_depths; print('OK')"
```
Expected: `OK` (model download happens on first run, may take a minute).

- [ ] **Step 3: Commit**
```bash
git add scripts/shard_prep/depth.py
git commit -m "feat(prep): add MiDaS depth estimation module"
```

---

## Task 5: DINOv2 Graph Builder

**Files:**
- Create: `scripts/shard_prep/graph_builder.py`
- Create: `scripts/shard_prep/tests/test_graph.py`

**Spec reference:** §2.5, §2.6 (`graph.json` schema)

- [ ] **Step 1: Write failing tests**

Create `scripts/shard_prep/tests/test_graph.py`:
```python
import json
import numpy as np
import pytest
from shard_prep.graph_builder import build_graph, GRAPH_SCHEMA_VERSION

def make_fake_nodes(n=3):
    return [
        {
            'id': f'painting_{i}',
            'image': f'painting_{i}.jpg',
            'title': f'Painting {i}',
            'totalCount': 100,
        }
        for i in range(n)
    ]

def make_fake_embeddings(n=3, n_patches=196, dim=1024):
    """Random unit-normalised patch embeddings."""
    emb = np.random.randn(n, n_patches, dim).astype(np.float32)
    norms = np.linalg.norm(emb, axis=2, keepdims=True)
    return emb / (norms + 1e-8)

def test_graph_has_nodes_and_edges_keys():
    nodes = make_fake_nodes(2)
    embeddings = {n['id']: emb for n, emb in zip(nodes, make_fake_embeddings(2))}
    graph = build_graph(nodes, embeddings)
    assert 'nodes' in graph
    assert 'edges' in graph

def test_all_nodes_preserved():
    nodes = make_fake_nodes(3)
    embeddings = {n['id']: emb for n, emb in zip(nodes, make_fake_embeddings(3))}
    graph = build_graph(nodes, embeddings)
    assert len(graph['nodes']) == 3

def test_edge_schema():
    nodes = make_fake_nodes(3)
    embeddings = {n['id']: emb for n, emb in zip(nodes, make_fake_embeddings(3))}
    graph = build_graph(nodes, embeddings)
    for edge in graph['edges']:
        assert 'source' in edge
        assert 'target' in edge
        assert 'weight' in edge
        assert 's_uv' in edge and len(edge['s_uv']) == 2
        assert 't_uv' in edge and len(edge['t_uv']) == 2
        assert 0.0 <= edge['weight'] <= 1.0
        assert edge['source'] != edge['target']

def test_edge_weight_range():
    nodes = make_fake_nodes(4)
    embeddings = {n['id']: emb for n, emb in zip(nodes, make_fake_embeddings(4))}
    graph = build_graph(nodes, embeddings)
    for edge in graph['edges']:
        assert 0.0 <= edge['weight'] <= 1.0

def test_identical_embeddings_produce_high_weight():
    """Two paintings with the same patches must have weight close to 1.0."""
    nodes = make_fake_nodes(2)
    emb = make_fake_embeddings(1)
    embeddings = {nodes[0]['id']: emb[0], nodes[1]['id']: emb[0]}
    graph = build_graph(nodes, embeddings)
    edge_weights = [e['weight'] for e in graph['edges']]
    assert any(w > 0.99 for w in edge_weights)

def test_graph_is_json_serialisable():
    nodes = make_fake_nodes(2)
    embeddings = {n['id']: emb for n, emb in zip(nodes, make_fake_embeddings(2))}
    graph = build_graph(nodes, embeddings)
    serialised = json.dumps(graph)
    parsed = json.loads(serialised)
    assert parsed['nodes'] == graph['nodes']
```

- [ ] **Step 2: Run to confirm failure**
```bash
python -m pytest scripts/shard_prep/tests/test_graph.py -v
```
Expected: ImportError.

- [ ] **Step 3: Implement graph_builder.py**

Create `scripts/shard_prep/graph_builder.py`:
```python
import numpy as np

GRAPH_SCHEMA_VERSION = 2   # marks incompatibility with old graph.json files
_SIMILARITY_THRESHOLD = 0.75
_FALLBACK_WEIGHT      = 0.5


def _patch_index_to_uv(patch_idx: int, n_patches_side: int) -> list[float]:
    """Convert a flat patch index to normalised UV coordinates."""
    row = patch_idx // n_patches_side
    col = patch_idx  % n_patches_side
    u = (col + 0.5) / n_patches_side
    v = (row + 0.5) / n_patches_side
    return [round(float(u), 4), round(float(v), 4)]


def extract_dino_embeddings(img_rgb: np.ndarray) -> np.ndarray:
    """
    Extract patch-level DINOv2 embeddings for one image.

    Returns: float32 array of shape [n_patches, 1024], L2-normalised.
    Requires: transformers library and internet access for first run.
    """
    from transformers import AutoImageProcessor, AutoModel
    import torch

    processor = AutoImageProcessor.from_pretrained('facebook/dinov2-large')
    model     = AutoModel.from_pretrained('facebook/dinov2-large')
    model.eval()

    from PIL import Image
    pil_img = Image.fromarray(img_rgb)
    inputs  = processor(images=pil_img, return_tensors='pt')

    with torch.no_grad():
        outputs = model(**inputs)

    # patch_embeddings shape: [1, n_patches, 1024] (exclude CLS token)
    patch_emb = outputs.last_hidden_state[0, 1:, :].numpy().astype(np.float32)

    # L2 normalise
    norms = np.linalg.norm(patch_emb, axis=1, keepdims=True)
    return patch_emb / (norms + 1e-8)


def build_graph(nodes: list[dict], embeddings: dict[str, np.ndarray]) -> dict:
    """
    Build the pareidolia similarity graph.

    Args:
        nodes:      List of node dicts (id, image, title, totalCount)
        embeddings: Dict mapping node id → [n_patches, dim] embedding array

    Returns:
        graph dict with 'nodes' and 'edges' lists matching the spec schema.
    """
    edges = []
    ids   = [n['id'] for n in nodes]
    n     = len(ids)

    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            emb_a = embeddings[ids[i]]  # [P, D]
            emb_b = embeddings[ids[j]]  # [P, D]

            # Cosine similarity matrix [P, P]
            sim_matrix = emb_a @ emb_b.T

            best_idx = int(np.argmax(sim_matrix))
            pa = best_idx // sim_matrix.shape[1]
            pb = best_idx  % sim_matrix.shape[1]
            best_sim = float(sim_matrix[pa, pb])

            n_patches_side = int(round(emb_a.shape[0] ** 0.5))

            if best_sim >= _SIMILARITY_THRESHOLD:
                weight  = round(best_sim, 4)
                s_uv    = _patch_index_to_uv(pa, n_patches_side)
                t_uv    = _patch_index_to_uv(pb, n_patches_side)
            else:
                weight  = _FALLBACK_WEIGHT
                s_uv    = [0.5, 0.5]
                t_uv    = [0.5, 0.5]

            edges.append({
                'source': ids[i],
                'target': ids[j],
                'weight': weight,
                's_uv':   s_uv,
                't_uv':   t_uv,
            })

    return {
        'schemaVersion': GRAPH_SCHEMA_VERSION,
        'nodes': nodes,
        'edges': edges,
    }
```

- [ ] **Step 4: Run tests**
```bash
python -m pytest scripts/shard_prep/tests/test_graph.py -v
```
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**
```bash
git add scripts/shard_prep/graph_builder.py scripts/shard_prep/tests/test_graph.py
git commit -m "feat(prep): add DINOv2 pareidolia graph builder with tests"
```

---

## Task 6: Main Orchestrator (`prepare.py`)

**Files:**
- Create: `scripts/prepare.py`

- [ ] **Step 1: Implement prepare.py**

Create `scripts/prepare.py`:
```python
#!/usr/bin/env python3
"""
prepare.py — Shard Cloud Preprocessor

Usage:
    python scripts/prepare.py --input assets/raw/ --output public/

Processes all images in --input, writes:
    public/data/baked/{id}.baked.json   per painting
    public/graph.json                    pareidolia graph

Existing baked files are skipped unless --force is passed.
"""
import argparse
import json
import os
import sys
import numpy as np
import cv2
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from shard_prep.segmentation import segment_image
from shard_prep.depth        import get_depth_map, assign_shard_depths
from shard_prep.projection   import project_shard, mirror_shard
from shard_prep.graph_builder import extract_dino_embeddings, build_graph


def process_image(img_path: Path, out_dir: Path, painting_id: str) -> dict:
    """
    Process one image → write {id}.baked.json.
    Returns the node dict for graph.json.
    """
    img_bgr = cv2.imread(str(img_path))
    if img_bgr is None:
        raise ValueError(f"Cannot read image: {img_path}")
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    h, w    = img_rgb.shape[:2]

    print(f"  [{painting_id}] Segmenting...")
    masks  = segment_image(img_rgb)

    print(f"  [{painting_id}] {len(masks)} segments. Computing depth...")
    depth_map = get_depth_map(img_rgb)
    z_worlds  = assign_shard_depths(masks, depth_map, img_rgb)

    print(f"  [{painting_id}] Projecting shards...")
    forward_shards = []
    for idx, (mask, z_world) in enumerate(zip(masks, z_worlds)):
        # Bounding box of mask
        ys, xs  = np.where(mask)
        if len(xs) == 0:
            continue
        x_min, x_max = int(xs.min()), int(xs.max())
        y_min, y_max = int(ys.min()), int(ys.max())
        shard_w = x_max - x_min + 1
        shard_h = y_max - y_min + 1
        u = (x_min + shard_w / 2.0) / w
        v = (y_min + shard_h / 2.0) / h

        # Mean colour of shard
        colour = img_rgb[mask].mean(axis=0) / 255.0

        shard = project_shard(
            u=u, v=v, z_world=max(z_world, 0.1),
            img_w=w, img_h=h,
            shard_w_px=shard_w, shard_h_px=shard_h,
            shard_x_min=x_min, shard_y_min=y_min,
        )
        shard['color'] = colour.tolist()
        shard['index'] = idx
        forward_shards.append(shard)

    mirrors = [mirror_shard(s) for s in forward_shards]
    all_shards = forward_shards + mirrors
    total_count = len(all_shards)

    # Flatten to typed arrays
    aOffset   = []
    aScale    = []
    aColor    = []
    aUvOffset = []
    aUvScale  = []
    isMirror  = []

    for i, s in enumerate(all_shards):
        aOffset  += [s['world_x'], s['world_y'], s['world_z']]
        aScale   += [s['scale_x'], s['scale_y']]
        aColor   += s['color']
        aUvOffset+= s['uv_offset']
        aUvScale += s['uv_scale']
        isMirror.append(s['is_mirror'])

    baked = {
        'id':         painting_id,
        'res':        [w, h],
        'totalCount': total_count,
        'aOffset':    aOffset,
        'aScale':     aScale,
        'aColor':     aColor,
        'aUvOffset':  aUvOffset,
        'aUvScale':   aUvScale,
        'isMirror':   isMirror,
    }

    out_path = out_dir / 'data' / 'baked' / f'{painting_id}.baked.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(baked, f, separators=(',', ':'))
    print(f"  [{painting_id}] Written: {out_path} ({total_count} shards)")

    return {
        'id':         painting_id,
        'image':      img_path.name,
        'title':      painting_id,
        'totalCount': total_count,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input',  required=True, help='Directory of raw images')
    parser.add_argument('--output', required=True, help='Public output directory')
    parser.add_argument('--force',  action='store_true', help='Reprocess existing')
    args = parser.parse_args()

    input_dir  = Path(args.input)
    output_dir = Path(args.output)
    extensions = {'.jpg', '.jpeg', '.png', '.webp'}

    img_paths = sorted([p for p in input_dir.iterdir()
                        if p.suffix.lower() in extensions])
    if not img_paths:
        print(f"No images found in {input_dir}")
        sys.exit(1)

    print(f"Found {len(img_paths)} images.")
    nodes      = []
    embeddings = {}

    for img_path in img_paths:
        painting_id = img_path.stem
        baked_path  = output_dir / 'data' / 'baked' / f'{painting_id}.baked.json'

        if baked_path.exists() and not args.force:
            print(f"  [{painting_id}] Already baked — skipping (use --force to reprocess)")
            with open(baked_path) as f:
                baked = json.load(f)
            nodes.append({
                'id':         painting_id,
                'image':      img_path.name,
                'title':      painting_id,
                'totalCount': baked.get('totalCount', 0),
            })
        else:
            node = process_image(img_path, output_dir, painting_id)
            nodes.append(node)

        # Extract DINOv2 embeddings for graph building
        print(f"  [{painting_id}] Extracting DINOv2 embeddings...")
        img_bgr = cv2.imread(str(img_path))
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        embeddings[painting_id] = extract_dino_embeddings(img_rgb)

    print("Building pareidolia graph...")
    graph = build_graph(nodes, embeddings)

    graph_path = output_dir / 'graph.json'
    with open(graph_path, 'w') as f:
        json.dump(graph, f, separators=(',', ':'), indent=2)
    print(f"Graph written: {graph_path}")
    print("Done.")


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Smoke test on one real image**

Pick any image from `assets/raw/` and run:
```bash
python scripts/prepare.py --input assets/raw/ --output public/ --force 2>&1 | head -30
```
Expected: see segmentation + depth + projection output without Python errors.

> **Note:** First run downloads MiDaS and DINOv2 weights (~1.5 GB). This is expected.

- [ ] **Step 3: Commit**
```bash
git add scripts/prepare.py
git commit -m "feat(prep): add main orchestrator script (prepare.py)"
```

---

## Task 7: Output Validation Script

**Files:**
- Create: `scripts/validate_output.py`

- [ ] **Step 1: Implement validate_output.py**

Create `scripts/validate_output.py`:
```python
#!/usr/bin/env python3
"""
validate_output.py — Verify baked JSON files match the spec schema.

Usage:
    python scripts/validate_output.py --output public/
"""
import argparse, json, sys
from pathlib import Path

REQUIRED_BAKED_KEYS = {'id', 'res', 'totalCount', 'aOffset', 'aScale',
                       'aColor', 'aUvOffset', 'aUvScale', 'isMirror'}
REQUIRED_GRAPH_KEYS = {'nodes', 'edges'}
REQUIRED_NODE_KEYS  = {'id', 'image', 'title', 'totalCount'}
REQUIRED_EDGE_KEYS  = {'source', 'target', 'weight', 's_uv', 't_uv'}

errors = []

def check(cond, msg):
    if not cond:
        errors.append(msg)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args   = parser.parse_args()
    out    = Path(args.output)

    # Check graph.json
    graph_path = out / 'graph.json'
    check(graph_path.exists(), f"MISSING: {graph_path}")
    if graph_path.exists():
        with open(graph_path) as f:
            graph = json.load(f)
        check(REQUIRED_GRAPH_KEYS <= set(graph), f"graph.json missing keys: {REQUIRED_GRAPH_KEYS - set(graph)}")
        for i, node in enumerate(graph.get('nodes', [])):
            check(REQUIRED_NODE_KEYS <= set(node), f"node[{i}] missing: {REQUIRED_NODE_KEYS - set(node)}")
        for i, edge in enumerate(graph.get('edges', [])):
            check(REQUIRED_EDGE_KEYS <= set(edge), f"edge[{i}] missing: {REQUIRED_EDGE_KEYS - set(edge)}")
            check(0.0 <= edge.get('weight', -1) <= 1.0, f"edge[{i}] weight out of range")
            check(edge.get('source') != edge.get('target'), f"edge[{i}] self-loop")

    # Check baked files
    baked_dir = out / 'data' / 'baked'
    baked_files = list(baked_dir.glob('*.baked.json')) if baked_dir.exists() else []
    check(len(baked_files) > 0, f"No .baked.json files found in {baked_dir}")

    for bf in baked_files:
        with open(bf) as f:
            baked = json.load(f)
        name = bf.name
        check(REQUIRED_BAKED_KEYS <= set(baked), f"{name} missing keys: {REQUIRED_BAKED_KEYS - set(baked)}")
        tc = baked.get('totalCount', 0)
        check(tc > 0, f"{name} totalCount is 0")
        check(tc % 2 == 0, f"{name} totalCount not even (mirrors must match forwards)")
        check(len(baked.get('aOffset', [])) == tc * 3, f"{name} aOffset length mismatch")
        check(len(baked.get('aScale', []))  == tc * 2, f"{name} aScale length mismatch")
        check(len(baked.get('aColor', []))  == tc * 3, f"{name} aColor length mismatch")
        check(len(baked.get('isMirror', [])) == tc,    f"{name} isMirror length mismatch")
        is_mirror = baked.get('isMirror', [])
        forward_count = tc // 2
        check(all(v == 0 for v in is_mirror[:forward_count]),    f"{name} first half should be forward shards")
        check(all(v == 1 for v in is_mirror[forward_count:]),    f"{name} second half should be mirror shards")

    if errors:
        print(f"\n❌ {len(errors)} validation error(s):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print(f"✅ All {len(baked_files)} baked files and graph.json are valid.")

if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Run validation after a full prepare run**
```bash
python scripts/validate_output.py --output public/
```
Expected: `✅ All N baked files and graph.json are valid.`

- [ ] **Step 3: Commit**
```bash
git add scripts/validate_output.py
git commit -m "feat(prep): add output validation script"
```

---

## Task 8: Run Full Pipeline

- [ ] **Step 1: Run on all images**
```bash
python scripts/prepare.py --input assets/raw/ --output public/
```
Expected: baked files for every image in `public/data/baked/`, updated `public/graph.json`.

- [ ] **Step 2: Validate**
```bash
python scripts/validate_output.py --output public/
```
Expected: `✅` with count matching number of images.

- [ ] **Step 3: Run all unit tests**
```bash
python -m pytest scripts/shard_prep/tests/ -v
```
Expected: all tests PASS.

- [ ] **Step 4: Commit**
```bash
git add public/graph.json public/data/baked/
git commit -m "chore: bake shard data for all paintings"
```

---

## Done

The preprocessor is complete when:
- `python -m pytest scripts/shard_prep/tests/ -v` → all PASS
- `python scripts/validate_output.py --output public/` → `✅`
- `public/graph.json` exists with `schemaVersion: 2`, nodes and edges
- `public/data/baked/{id}.baked.json` exists for every image in `assets/raw/`

Proceed to: `docs/superpowers/plans/2026-03-20-viewer.md`
