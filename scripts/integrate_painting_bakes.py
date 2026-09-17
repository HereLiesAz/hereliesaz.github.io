#!/usr/bin/env python3
"""Build canonical per-painting integration records from every known art pipeline.

This script is deliberately additive: it does not rewrite, delete, or rename any
native pipeline artifact. It discovers the representations that already exist and
writes a stable sidecar contract under public/data/integrated/.

Supported native inputs:
  * Paper Theater: public/data/theater/{id}.theater.json + textures + graph
  * Turbo Stroke Cloud: public/data/*.json with `s` or `strokes`
  * Unified Shard Field: public/data/baked/{id}.baked.json with totalCount/isMirror
  * Perspective shard bakes: public/data/baked/{id}.baked.json with aOffset/aScale
  * Semantic layer bakes: public/data/baked/{id}.baked.json with `slices`
  * Legacy/unified graph: public/graph.json

Output:
  public/data/integrated/{id}.painting-bake.json
  public/data/integrated/_manifest.json

The sidecars are indexes/references, not replacements for the heavy native data.
Consumers can choose the representation(s) they need without each pipeline having
to know about every other pipeline.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1


def _read_json(path: Path, warnings: list[str]) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        warnings.append(f"{path}: could not parse JSON ({type(exc).__name__}: {exc})")
        return None


def _rel(path: Path, public_root: Path) -> str:
    try:
        rel = path.resolve().relative_to(public_root.resolve())
    except ValueError:
        return path.as_posix()
    return "/" + rel.as_posix()


def _normalise_id(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value:
        return None
    return Path(value).stem


def _record(records: dict[str, dict[str, Any]], pid: str) -> dict[str, Any]:
    if pid not in records:
        records[pid] = {
            "schemaVersion": SCHEMA_VERSION,
            "id": pid,
            "source": {},
            "representations": {},
            "transitions": {},
            "provenance": [],
        }
    return records[pid]


def _add_provenance(rec: dict[str, Any], pipeline: str, artifact: str, **extra: Any) -> None:
    entry: dict[str, Any] = {"pipeline": pipeline, "artifact": artifact}
    entry.update({k: v for k, v in extra.items() if v is not None})
    if entry not in rec["provenance"]:
        rec["provenance"].append(entry)


def _extract_theater(public_root: Path, records: dict[str, dict[str, Any]], warnings: list[str]) -> None:
    theater_dir = public_root / "data" / "theater"
    manifest_path = theater_dir / "_manifest.json"
    manifest = _read_json(manifest_path, warnings) if manifest_path.exists() else []
    ids = manifest if isinstance(manifest, list) else []

    for raw_id in ids:
        if not isinstance(raw_id, str) or not raw_id:
            warnings.append(f"{manifest_path}: ignoring non-string/empty id {raw_id!r}")
            continue
        pid = raw_id
        meta_path = theater_dir / f"{pid}.theater.json"
        painting_path = theater_dir / f"{pid}.painting.webp"
        depth_path = theater_dir / f"{pid}.depth.png"
        meta = _read_json(meta_path, warnings) if meta_path.exists() else None
        rec = _record(records, pid)

        rep: dict[str, Any] = {
            "metadata": _rel(meta_path, public_root),
            "painting": _rel(painting_path, public_root),
            "depth": _rel(depth_path, public_root),
        }
        if isinstance(meta, dict):
            rep["nativeSchema"] = meta.get("schema")
            depth = meta.get("depth")
            if isinstance(depth, dict):
                rep["depthSource"] = depth.get("source")
                bands = depth.get("bands")
                if isinstance(bands, dict):
                    centers = bands.get("centers")
                    if isinstance(centers, list):
                        rep["bandCount"] = len(centers)
            src = meta.get("src")
            if isinstance(src, dict):
                width, height = src.get("width"), src.get("height")
                if isinstance(width, (int, float)) and width > 0:
                    rec["source"]["width"] = width
                if isinstance(height, (int, float)) and height > 0:
                    rec["source"]["height"] = height
                for key in ("file", "filename", "original_file", "originalFile"):
                    candidate = src.get(key)
                    if isinstance(candidate, str) and candidate:
                        rec["source"].setdefault("image", "/assets/" + candidate)
                        break

        rec["representations"]["theater"] = rep
        _add_provenance(rec, "paper-theater", _rel(meta_path, public_root), nativeSchema=rep.get("nativeSchema"))

    graph_path = theater_dir / "graph.theater.json"
    graph = _read_json(graph_path, warnings) if graph_path.exists() else None
    if isinstance(graph, dict):
        for edge in graph.get("edges", []):
            if not isinstance(edge, dict):
                continue
            source = edge.get("source")
            if not isinstance(source, str):
                continue
            rec = _record(records, source)
            rec["transitions"].setdefault("theater", []).append({
                k: edge[k]
                for k in ("target", "weight", "s_uv", "t_uv", "scale")
                if k in edge
            })
            _add_provenance(rec, "paper-theater-hinge-graph", _rel(graph_path, public_root), nativeSchema=graph.get("schemaVersion"))


def _stroke_id(path: Path, payload: dict[str, Any]) -> str:
    meta = payload.get("meta")
    if isinstance(meta, dict):
        for key in ("id", "file", "f", "original_file", "originalFile"):
            pid = _normalise_id(meta.get(key))
            if pid:
                return pid
    stem = path.stem
    return Path(stem).stem


def _extract_strokes(public_root: Path, records: dict[str, dict[str, Any]], warnings: list[str]) -> None:
    data_dir = public_root / "data"
    if not data_dir.exists():
        return
    skip_names = {"manifest.json", "bootstrap-manifest.json"}
    for path in sorted(data_dir.glob("*.json")):
        if path.name in skip_names or path.name.startswith("graph"):
            continue
        payload = _read_json(path, warnings)
        if not isinstance(payload, dict):
            continue
        strokes = payload.get("strokes")
        format_name = "strokes"
        if not isinstance(strokes, list):
            strokes = payload.get("s")
            format_name = "s"
        if not isinstance(strokes, list):
            continue

        pid = _stroke_id(path, payload)
        rec = _record(records, pid)
        rep: dict[str, Any] = {
            "data": _rel(path, public_root),
            "count": len(strokes),
            "nativeField": format_name,
        }
        ghosts = payload.get("pareidolia")
        if isinstance(ghosts, list):
            rep["pareidoliaCount"] = len(ghosts)
            rep["hasPareidoliaAnnotations"] = True
        rec["representations"]["strokeCloud"] = rep
        _add_provenance(rec, "turbo-stroke-cloud", _rel(path, public_root), nativeSchema=format_name)


def _classify_baked(payload: dict[str, Any]) -> str | None:
    if isinstance(payload.get("slices"), list):
        return "semanticLayers"
    if "totalCount" in payload and isinstance(payload.get("isMirror"), list):
        return "unifiedShardField"
    if isinstance(payload.get("aOffset"), list) and isinstance(payload.get("aScale"), list):
        return "perspectiveShardBake"
    return None


def _extract_baked(public_root: Path, records: dict[str, dict[str, Any]], warnings: list[str]) -> None:
    baked_dir = public_root / "data" / "baked"
    if not baked_dir.exists():
        return
    for path in sorted(baked_dir.glob("*.baked.json")):
        payload = _read_json(path, warnings)
        if not isinstance(payload, dict):
            continue
        kind = _classify_baked(payload)
        if kind is None:
            warnings.append(f"{path}: unrecognized baked representation; preserved but not integrated")
            continue
        pid = _normalise_id(payload.get("id")) or path.name[:-len(".baked.json")]
        rec = _record(records, pid)
        rep: dict[str, Any] = {"data": _rel(path, public_root)}
        res = payload.get("res")
        if isinstance(res, list) and len(res) == 2:
            rep["resolution"] = res
            if all(isinstance(v, (int, float)) and v > 0 for v in res):
                rec["source"].setdefault("width", res[0])
                rec["source"].setdefault("height", res[1])

        if kind == "unifiedShardField":
            total = payload.get("totalCount")
            if isinstance(total, int):
                rep["count"] = total
                rep["forwardCount"] = total // 2
                rep["mirrorCount"] = total - (total // 2)
            rep["attributes"] = [
                k for k in ("aOffset", "aScale", "aColor", "aUvOffset", "aUvScale", "isMirror")
                if k in payload
            ]
            pipeline = "unified-shard-field"
        elif kind == "perspectiveShardBake":
            count = payload.get("count")
            if isinstance(count, int):
                rep["count"] = count
            rep["attributes"] = [
                k for k in ("aOffset", "aScale", "aColor", "aUvOffset", "aUvScale")
                if k in payload
            ]
            pipeline = "perspective-shard-bake"
        else:
            slices = payload.get("slices", [])
            rep["count"] = len(slices) if isinstance(slices, list) else payload.get("count")
            pipeline = "semantic-layer-deconstructor"

        rec["representations"][kind] = rep
        _add_provenance(rec, pipeline, _rel(path, public_root))


def _extract_legacy_graph(public_root: Path, records: dict[str, dict[str, Any]], warnings: list[str]) -> None:
    graph_path = public_root / "graph.json"
    graph = _read_json(graph_path, warnings) if graph_path.exists() else None
    if not isinstance(graph, dict):
        return

    nodes = graph.get("nodes")
    if isinstance(nodes, list):
        for node in nodes:
            if not isinstance(node, dict):
                continue
            pid = _normalise_id(node.get("id"))
            if not pid:
                continue
            rec = _record(records, pid)
            image = node.get("image")
            if isinstance(image, str) and image:
                rec["source"].setdefault("image", "/assets/" + image)
            for key in ("title", "totalCount"):
                if key in node:
                    rec["source"].setdefault(key, node[key])
            _add_provenance(rec, "legacy-or-unified-graph", _rel(graph_path, public_root), nativeSchema=graph.get("schemaVersion"))

    edges = graph.get("edges")
    if isinstance(edges, list):
        for edge in edges:
            if not isinstance(edge, dict):
                continue
            source = _normalise_id(edge.get("source"))
            if not source:
                continue
            rec = _record(records, source)
            item = {
                k: edge[k]
                for k in ("target", "weight", "s_uv", "t_uv", "source_shard", "target_shard")
                if k in edge
            }
            rec["transitions"].setdefault("legacyOrUnified", []).append(item)


def _validate_record(rec: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if rec.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("schemaVersion mismatch")
    if not isinstance(rec.get("id"), str) or not rec["id"]:
        errors.append("missing/invalid id")
    if not isinstance(rec.get("source"), dict):
        errors.append("source must be an object")
    reps = rec.get("representations")
    if not isinstance(reps, dict) or not reps:
        errors.append("representations must be a non-empty object")
    if not isinstance(rec.get("transitions"), dict):
        errors.append("transitions must be an object")
    if not isinstance(rec.get("provenance"), list) or not rec["provenance"]:
        errors.append("provenance must be a non-empty array")
    return errors


def build(public_root: Path, strict: bool = False) -> int:
    warnings: list[str] = []
    records: dict[str, dict[str, Any]] = {}

    _extract_theater(public_root, records, warnings)
    _extract_strokes(public_root, records, warnings)
    _extract_baked(public_root, records, warnings)
    _extract_legacy_graph(public_root, records, warnings)

    out_dir = public_root / "data" / "integrated"
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest_records: list[dict[str, Any]] = []
    errors: list[str] = []
    for pid in sorted(records):
        rec = records[pid]
        rec["provenance"].sort(key=lambda p: (p.get("pipeline", ""), p.get("artifact", "")))
        for transition_list in rec["transitions"].values():
            if isinstance(transition_list, list):
                transition_list.sort(key=lambda e: (str(e.get("target", "")), -float(e.get("weight", 0) or 0)))

        rec_errors = _validate_record(rec)
        if rec_errors:
            errors.extend(f"{pid}: {msg}" for msg in rec_errors)
            continue

        out_path = out_dir / f"{pid}.painting-bake.json"
        out_path.write_text(json.dumps(rec, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        manifest_records.append({
            "id": pid,
            "record": _rel(out_path, public_root),
            "representations": sorted(rec["representations"].keys()),
            "transitionGraphs": sorted(rec["transitions"].keys()),
        })

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "count": len(manifest_records),
        "records": manifest_records,
    }
    (out_dir / "_manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    for warning in warnings:
        print(f"[integration warning] {warning}", file=sys.stderr)
    for error in errors:
        print(f"[integration error] {error}", file=sys.stderr)

    print(
        f"Integrated {len(manifest_records)} painting record(s) from "
        f"{sum(len(r['representations']) for r in records.values())} representation(s); "
        f"{len(warnings)} warning(s), {len(errors)} error(s)."
    )
    if errors or (strict and warnings):
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--public-root",
        type=Path,
        default=Path("public"),
        help="site public directory (default: public)",
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        help="also fail on malformed/unrecognized native artifacts",
    )
    args = ap.parse_args(argv)
    if not args.public_root.is_dir():
        print(f"[integration error] not a directory: {args.public_root}", file=sys.stderr)
        return 2
    return build(args.public_root, strict=args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
