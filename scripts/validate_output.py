#!/usr/bin/env python3
"""
validate_output.py — Verify the REAL shipped theater-bake artifacts match
their actual schema, before they get published to the art-data branch.

This replaces a previous version of this file that validated a
"preprocessor" schema (baked.json / graph.json with aOffset/aScale/aColor
shard arrays) from an abandoned plan doc — nothing ever produced that
schema, and nothing ever called this script. The real shipped artifacts,
produced by scripts/theater_baker.py and scripts/pareidolia_index.py, are:

  {id}.theater.json     schema 2 — per-painting metadata (src, crop, depth
                         bands + provenance, color clusters, accents)
  {id}.painting.webp    baked painting image
  {id}.depth.png        baked 16-bit depth map
  _manifest.json        list of ids that have all three of the above
  graph.theater.json    schemaVersion 5 — the pareidolia hinge graph
                         (nodes: {id,width,height}; edges: {source,target,
                         weight,s_uv,t_uv,scale})

CLI CONTRACT (do not change without updating theater_bake.yml, which is
owned by a different agent and wired to this exact contract):

    python scripts/validate_output.py --dir <path>

  --dir defaults to public/data/theater. Exits 0 with a short "N files
  validated OK" message on success. Exits NON-ZERO with a readable list of
  every violation found on any failure — this is meant to be a hard CI
  gate, not a warning.

Checks performed, against everything in --dir:

  1. Every *.theater.json (excluding graph.theater.json and
     _manifest.json): required top-level keys (schema, src.width/height,
     depth.bands, depth.source) are present; depth.bands.centers is
     non-empty; and depth.source is NOT "synthetic" — a synthetic depth
     map is theater_baker.py's documented emergency-only stand-in (its
     own docstring: "re-bake with network access") and must never reach
     art-data undetected. See theater_baker.py's synth_depth().
  2. Every id listed in _manifest.json has its three companion files
     (.painting.webp, .depth.png, .theater.json) actually present on disk
     — catches a manifest that lists files a torn/partial write never
     finished producing.
  3. graph.theater.json: correct schemaVersion, every edge's source/target
     is a real node id, every edge's weight is a finite float in a sane
     range, and the graph is NOT complete — asserts
     len(edges) < len(nodes) * (len(nodes) - 1) as a sanity check that
     pareidolia_index.py's best_hinge() acceptance bar is actually
     rejecting weak/spurious matches rather than accepting everything
     (see that script's MIN_SIM / scale-bias-correction comments).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

errors: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        errors.append(msg)


def validate_theater_json(path: Path) -> None:
    name = path.name
    try:
        data = json.loads(path.read_text())
    except Exception as e:
        check(False, f"{name}: could not parse JSON ({type(e).__name__}: {e})")
        return

    if not isinstance(data, dict):
        check(False, f"{name}: top level is not an object")
        return

    check("schema" in data, f"{name}: missing 'schema'")

    src = data.get("src")
    check(isinstance(src, dict), f"{name}: missing/invalid 'src'")
    if isinstance(src, dict):
        check("width" in src and "height" in src,
              f"{name}: src missing width/height")
        check(isinstance(src.get("width"), (int, float)) and src.get("width", 0) > 0,
              f"{name}: src.width is not a positive number")
        check(isinstance(src.get("height"), (int, float)) and src.get("height", 0) > 0,
              f"{name}: src.height is not a positive number")

    depth = data.get("depth")
    check(isinstance(depth, dict), f"{name}: missing/invalid 'depth'")
    if isinstance(depth, dict):
        check("source" in depth, f"{name}: depth missing 'source'")
        bands = depth.get("bands")
        check(isinstance(bands, dict), f"{name}: depth missing/invalid 'bands'")
        if isinstance(bands, dict):
            centers = bands.get("centers")
            check(isinstance(centers, list) and len(centers) > 0,
                  f"{name}: depth.bands.centers is empty or missing")
        # The hard gate: a synthetic (flat-gradient emergency stand-in)
        # depth map must never ship. theater_baker.py's own docstring
        # calls this "emergency only ... re-bake with network access".
        check(depth.get("source") != "synthetic",
              f"{name}: depth.source is 'synthetic' — emergency fallback "
              f"depth shipped undetected; re-bake with network access")


def validate_manifest(dir_: Path) -> None:
    manifest_path = dir_ / "_manifest.json"
    if not manifest_path.exists():
        check(False, f"_manifest.json missing from {dir_}")
        return
    try:
        ids = json.loads(manifest_path.read_text())
    except Exception as e:
        check(False, f"_manifest.json: could not parse JSON ({type(e).__name__}: {e})")
        return
    check(isinstance(ids, list), "_manifest.json: not a JSON array")
    if not isinstance(ids, list):
        return
    for pid in ids:
        for suffix in (".painting.webp", ".depth.png", ".theater.json"):
            fp = dir_ / f"{pid}{suffix}"
            check(fp.exists(), f"_manifest.json lists '{pid}' but {fp.name} is missing "
                                f"(torn write?)")


def validate_graph(dir_: Path) -> None:
    graph_path = dir_ / "graph.theater.json"
    if not graph_path.exists():
        # Not every --dir necessarily has a hinge graph (e.g. a directory
        # with < 2 baked paintings never gets one, by pareidolia_index.py's
        # own design) — that's not itself a validation failure.
        return
    try:
        graph = json.loads(graph_path.read_text())
    except Exception as e:
        check(False, f"graph.theater.json: could not parse JSON ({type(e).__name__}: {e})")
        return

    check(graph.get("schemaVersion") == 5,
          f"graph.theater.json: schemaVersion is {graph.get('schemaVersion')!r}, expected 5")

    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    check(isinstance(nodes, list), "graph.theater.json: 'nodes' is not a list")
    check(isinstance(edges, list), "graph.theater.json: 'edges' is not a list")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return

    node_ids = set()
    for i, node in enumerate(nodes):
        if not isinstance(node, dict) or "id" not in node:
            check(False, f"graph.theater.json: nodes[{i}] missing 'id'")
            continue
        node_ids.add(node["id"])

    for i, edge in enumerate(edges):
        if not isinstance(edge, dict):
            check(False, f"graph.theater.json: edges[{i}] is not an object")
            continue
        src, tgt = edge.get("source"), edge.get("target")
        check(src in node_ids, f"graph.theater.json: edges[{i}].source {src!r} is not a real node id")
        check(tgt in node_ids, f"graph.theater.json: edges[{i}].target {tgt!r} is not a real node id")
        w = edge.get("weight")
        check(isinstance(w, (int, float)) and w == w and abs(w) != float("inf") and -1.0 <= w <= 1.0,
              f"graph.theater.json: edges[{i}].weight {w!r} is not a sane float in [-1, 1]")

    # Sanity check that pareidolia_index.py's acceptance bar (MIN_SIM /
    # scale-bias correction) is actually rejecting weak matches, not
    # producing a complete graph like the pre-fix version did (CONFIRMED
    # live: 1560 edges = 40*39 on the shipped 40-node graph before the fix).
    n = len(nodes)
    if n >= 2:
        check(len(edges) < n * (n - 1),
              f"graph.theater.json: graph is COMPLETE ({len(edges)} edges == "
              f"{n}*{n-1} possible) — best_hinge()'s acceptance bar is not "
              f"rejecting anything; see pareidolia_index.py's MIN_SIM")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", type=Path, default=Path("public/data/theater"),
                    help="directory of baked theater output to validate "
                         "(default: public/data/theater)")
    args = ap.parse_args(argv)

    dir_ = args.dir
    if not dir_.is_dir():
        print(f"[!] not a directory: {dir_}", file=sys.stderr)
        return 2

    theater_jsons = [
        p for p in sorted(dir_.glob("*.theater.json"))
        if p.name != "graph.theater.json"
    ]
    check(len(theater_jsons) > 0, f"no *.theater.json files found in {dir_}")
    for p in theater_jsons:
        validate_theater_json(p)

    validate_manifest(dir_)
    validate_graph(dir_)

    if errors:
        print(f"\n❌ {len(errors)} validation error(s):")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"✅ {len(theater_jsons)} files validated OK in {dir_}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
