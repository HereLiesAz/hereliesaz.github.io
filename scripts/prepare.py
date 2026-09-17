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