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
    f_world = _focal_world()

    ratio = z_world / f_world

    world_x = (u - 0.5) * WORLD_HEIGHT * aspect * ratio
    world_y = (0.5 - v) * WORLD_HEIGHT           * ratio
    world_z = -z_world  # negative = in front of sweet spot

    # 'Liquid Shard' aspect ratio variation [1.0, 3.5]
    # We use u, v, z_world to seed a deterministic random value
    seed = int((u + v + abs(z_world)) * 10000) % 1000
    elongation = 1.0 + (seed / 1000.0) * 2.5 
    
    scale_x = (shard_w_px / img_w) * WORLD_HEIGHT * aspect * ratio * elongation
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