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