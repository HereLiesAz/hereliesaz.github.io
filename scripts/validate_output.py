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
        print(f"
❌ {len(errors)} validation error(s):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print(f"✅ All {len(baked_files)} baked files and graph.json are valid.")

if __name__ == '__main__':
    main()