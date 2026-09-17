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