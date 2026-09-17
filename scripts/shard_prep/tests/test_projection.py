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