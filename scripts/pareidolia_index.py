#!/usr/bin/env python3
"""
pareidolia_index.py — Build the pareidolia graph from theater bakes.

For each ordered pair of paintings (A, B) processed by theater_baker.py,
look for blotches in A that have a "twin" in B at a comparable
(layer, x, y, scale). Each twin is a candidate pareidolia hinge — the
mark that holds in place while the camera moves between the two
paintings' nulls (AESTHETIC §5).

Inputs:   public/data/theater/<id>.theater.json
          public/data/theater/_manifest.json
Outputs:  public/data/theater/graph.theater.json
            { schemaVersion: 3,
              nodes: [{id, image, title, totalCount, aspect}],
              edges: [{source, target, weight, shared: [{a, b, layer, x, y, scale}]}]
            }

The renderer / store consume this graph instead of the legacy graph.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np


# Tuning knobs --------------------------------------------------------------

# Maximum allowable distance between two blotches in feature space
# (layer-weighted). 0 = perfect twin; values above MATCH_RADIUS are not a
# match. The features are: layer index, x, y, scale.
MATCH_RADIUS    = 0.16
LAYER_PENALTY   = 0.5     # cost added per layer-index difference (paper-theater plane mismatch)
SCALE_WEIGHT    = 0.7     # how much scale difference contributes vs. xy
MIN_SHARED      = 3       # discard edges with fewer matched twins than this
TOP_K_OUT_EDGES = 6       # cap outgoing edges per source so the walker has options

# Path defaults -------------------------------------------------------------

DEFAULT_INPUT  = Path("public/data/theater")
DEFAULT_OUTPUT = Path("public/data/theater/graph.theater.json")


# --------------------------------------------------------------------------

def load_painting(path: Path) -> dict:
    return json.loads(path.read_text())


def blotch_features(painting: dict) -> np.ndarray:
    """
    Pack blotches into an Nx5 feature array:
      [layer_idx, x, y, scale, original_index]
    where original_index is the painting-local linearised blotch id.
    """
    rows = []
    counter = 0
    for li, layer in enumerate(painting.get("layers", [])):
        for b in layer.get("blotches", []):
            rows.append((li, b.get("x", 0.0), b.get("y", 0.0), b.get("scale", 0.0), counter))
            counter += 1
    if not rows:
        return np.zeros((0, 5), dtype=np.float32)
    return np.asarray(rows, dtype=np.float32)


def pair_distances(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """
    Pairwise feature distance — A-rows × B-rows. Higher means more dissimilar.
    cost = LAYER_PENALTY * |layer_a - layer_b|
         + sqrt((x_a - x_b)^2 + (y_a - y_b)^2)
         + SCALE_WEIGHT * |scale_a - scale_b|
    """
    if len(a) == 0 or len(b) == 0:
        return np.empty((len(a), len(b)), dtype=np.float32)
    layer_d = np.abs(a[:, 0:1] - b[:, 0:1].T) * LAYER_PENALTY
    xy_d = np.hypot(a[:, 1:2] - b[:, 1:2].T, a[:, 2:3] - b[:, 2:3].T)
    scale_d = np.abs(a[:, 3:4] - b[:, 3:4].T) * SCALE_WEIGHT
    return layer_d + xy_d + scale_d


def find_twins(a: np.ndarray, b: np.ndarray) -> list[tuple[int, int, float]]:
    """
    Greedy mutual-best matching. For each row in A, take its closest match
    in B that hasn't already been claimed and is within MATCH_RADIUS.
    Returns list of (a_index_local, b_index_local, distance).
    """
    if len(a) == 0 or len(b) == 0:
        return []
    cost = pair_distances(a, b)
    # Iterate A rows in order of increasing best-cost so the strongest
    # twins are claimed first.
    a_order = np.argsort(cost.min(axis=1))
    used_b = set()
    twins = []
    for ai in a_order:
        candidates = np.argsort(cost[ai])
        for bi in candidates:
            if bi in used_b:
                continue
            c = float(cost[ai, bi])
            if c > MATCH_RADIUS:
                break
            used_b.add(int(bi))
            twins.append((int(ai), int(bi), c))
            break
    return twins


def edge_for_pair(a_id: str, a_feat: np.ndarray, b_id: str, b_feat: np.ndarray) -> dict | None:
    twins = find_twins(a_feat, b_feat)
    if len(twins) < MIN_SHARED:
        return None
    # Edge weight rewards both quantity and quality of matches.
    weight = 0.0
    shared = []
    for ai_local, bi_local, c in twins:
        a_row = a_feat[ai_local]
        weight += max(0.0, 1.0 - c / MATCH_RADIUS)
        shared.append({
            "a":     int(a_row[4]),     # painting-local blotch index in A
            "b":     int(b_feat[bi_local, 4]),
            "layer": int(a_row[0]),
            "x":     round(float(a_row[1]), 4),
            "y":     round(float(a_row[2]), 4),
            "scale": round(float(a_row[3]), 4),
        })
    shared.sort(key=lambda s: -s["scale"])
    return {
        "source": a_id,
        "target": b_id,
        "weight": round(weight, 3),
        "shared": shared,
    }


def build_graph(theater_dir: Path) -> dict:
    manifest_path = theater_dir / "_manifest.json"
    if not manifest_path.exists():
        print(f"[!] no manifest at {manifest_path}", file=sys.stderr)
        sys.exit(2)
    ids = json.loads(manifest_path.read_text())

    nodes = []
    feats = {}
    paintings = {}
    for pid in ids:
        path = theater_dir / f"{pid}.theater.json"
        if not path.exists():
            print(f"[!] missing theater file: {path}", file=sys.stderr)
            continue
        p = load_painting(path)
        paintings[pid] = p
        feats[pid] = blotch_features(p)
        src = p.get("src", {}) or {}
        w = src.get("width", 1) or 1
        h = src.get("height", 1) or 1
        nodes.append({
            "id":         pid,
            "image":      src.get("image", f"{pid}.jpg"),
            "title":      pid,
            "blotches":   sum(len(L.get("blotches", [])) for L in p.get("layers", [])),
            "strokes":    sum(len(L.get("strokes",  [])) for L in p.get("layers", [])),
            "aspect":     round(float(w) / float(h), 4),
        })

    print(f"[*] {len(nodes)} paintings; computing edges...")

    # All ordered pairs. With a small library this is cheap; for larger
    # corpora a kd-tree would be the next step.
    edges_by_source: dict[str, list[dict]] = {pid: [] for pid in ids}
    for i, a_id in enumerate(ids):
        for j, b_id in enumerate(ids):
            if a_id == b_id:
                continue
            edge = edge_for_pair(a_id, feats[a_id], b_id, feats[b_id])
            if edge is None:
                continue
            edges_by_source[a_id].append(edge)
        # Cap to top-K outgoing per source.
        edges_by_source[a_id].sort(key=lambda e: -e["weight"])
        edges_by_source[a_id] = edges_by_source[a_id][:TOP_K_OUT_EDGES]

    edges = [e for lst in edges_by_source.values() for e in lst]
    print(f"[*] {len(edges)} edges (avg {len(edges)/max(1,len(nodes)):.1f} per painting)")

    return {
        "schemaVersion": 3,
        "nodes": nodes,
        "edges": edges,
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input",  type=Path, default=DEFAULT_INPUT,
                    help=f"theater data dir (default {DEFAULT_INPUT})")
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                    help=f"output graph path (default {DEFAULT_OUTPUT})")
    args = ap.parse_args(argv)

    if not args.input.is_dir():
        print(f"[!] no theater dir at {args.input}", file=sys.stderr)
        return 2

    graph = build_graph(args.input.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(graph, separators=(",", ":")))
    print(f"[+] wrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
