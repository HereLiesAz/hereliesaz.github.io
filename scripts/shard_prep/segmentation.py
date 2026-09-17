import numpy as np
import cv2
from skimage.segmentation import slic
from skimage.color import rgb2lab
from skimage.measure import label, regionprops

# Merge adjacent superpixels whose LAB distance is below this threshold
_LAB_MERGE_THRESHOLD = 5.0
# Split any region larger than this fraction of the image
_MAX_REGION_FRACTION = 0.01


def segment_image(img_rgb: np.ndarray, n_segments: int = 3000) -> list[np.ndarray]:
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
    labelled = label(mask)
    props = regionprops(labelled)
    result = []
    for prop in props:
        sub_mask = labelled == prop.label
        if sub_mask.sum() > max_area:
            rmin, cmin, rmax, cmax = prop.bbox
            rmid, cmid = (rmin + rmax) // 2, (cmin + cmax) // 2
            quadrants = [
                (rmin, cmin, rmid, cmid), (rmin, cmid, rmid, cmax),
                (rmid, cmin, rmax, cmid), (rmid, cmid, rmax, cmax),
            ]
            for r0, c0, r1, c1 in quadrants:
                q_mask = np.zeros_like(mask)
                q_mask[r0:r1, c0:c1] = sub_mask[r0:r1, c0:c1]
                if q_mask.sum() > max_area:
                    result.extend(_split_region(q_mask, max_area))
                elif q_mask.sum() > 0:
                    result.append(q_mask)
        else:
            result.append(sub_mask)
    return result if result else [mask]