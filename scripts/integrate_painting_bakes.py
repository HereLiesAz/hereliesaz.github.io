#!/usr/bin/env python3
"""Build additive canonical sidecars from every known art-processing pipeline.

Nothing here replaces a native artifact. The script discovers the representations
already present under public/, references them from one stable per-painting record,
and writes public/data/integrated/*.painting-bake.json plus _manifest.json.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1


def read_json(path: Path, warnings: list[str]) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        warnings.append(f"{path}: could not parse JSON ({type(exc).__name__}: {exc})")
        return None


def web_path(path: Path, public_root: Path) -> str:
    try:
        return "/" + path.resolve().relative_to(public_root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def normalise_id(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return Path(value.strip()).stem


def record(records: dict[str, dict[str, Any]], pid: str) -> dict[str, Any]:
    return records.setdefault(pid, {
        "schemaVersion": SCHEMA_VERSION,
        "id": pid,
        "source": {},
        "representations": {},
        "transitions": {},
        "provenance": [],
    })


def provenance(rec: dict[str, Any], pipeline: str, artifact: str, native_schema: Any = None) -> None:
    item: dict[str, Any] = {"pipeline": pipeline, "artifact": artifact}
    if native_schema is not None:
        item["nativeSchema"] = native_schema
    if item not in rec["provenance"]:
        rec["provenance"].append(item)


def add_representation(rec: dict[str, Any], key: str, rep: dict[str, Any]) -> None:
    """Preserve every native artifact even when several share one family."""
    current = rec["representations"].get(key)
    if current is None:
        rec["representations"][key] = rep
        return
    if isinstance(current, dict) and isinstance(current.get("variants"), list):
        if rep not in current["variants"]:
            current["variants"].append(rep)
        return
    if current != rep:
        rec["representations"][key] = {"variants": [current, rep]}


def add_theater(public_root: Path, records: dict[str, dict[str, Any]], warnings: list[str]) -> None:
    root = public_root / "data" / "theater"
    manifest_path = root / "_manifest.json"
    manifest = read_json(manifest_path, warnings) if manifest_path.exists() else []
    for pid in manifest if isinstance(manifest, list) else []:
        if not isinstance(pid, str) or not pid:
            warnings.append(f"{manifest_path}: ignoring invalid id {pid!r}")
            continue
        rec = record(records, pid)
        meta_path = root / f"{pid}.theater.json"
        meta = read_json(meta_path, warnings) if meta_path.exists() else None
        rep: dict[str, Any] = {
            "metadata": web_path(meta_path, public_root),
            "painting": web_path(root / f"{pid}.painting.webp", public_root),
            "depth": web_path(root / f"{pid}.depth.png", public_root),
        }
        masks_path = root / f"{pid}.masks.png"
        if masks_path.exists():
            rep["masks"] = web_path(masks_path, public_root)
        if isinstance(meta, dict):
            rep["nativeSchema"] = meta.get("schema")
            depth = meta.get("depth")
            if isinstance(depth, dict):
                rep["depthSource"] = depth.get("source")
                bands = depth.get("bands")
                if isinstance(bands, dict) and isinstance(bands.get("centers"), list):
                    rep["bandCount"] = len(bands["centers"])
            src = meta.get("src")
            if isinstance(src, dict):
                if isinstance(src.get("width"), (int, float)) and src["width"] > 0:
                    rec["source"]["width"] = src["width"]
                if isinstance(src.get("height"), (int, float)) and src["height"] > 0:
                    rec["source"]["height"] = src["height"]
                for field in ("file", "filename", "original_file", "originalFile"):
                    if isinstance(src.get(field), str) and src[field]:
                        rec["source"].setdefault("image", "/assets/" + src[field])
                        break
        add_representation(rec, "theater", rep)
        provenance(rec, "paper-theater", web_path(meta_path, public_root), rep.get("nativeSchema"))

    graph_path = root / "graph.theater.json"
    graph = read_json(graph_path, warnings) if graph_path.exists() else None
    if isinstance(graph, dict):
        for edge in graph.get("edges", []):
            if not isinstance(edge, dict) or not isinstance(edge.get("source"), str):
                continue
            rec = record(records, edge["source"])
            rec["transitions"].setdefault("theater", []).append({
                field: edge[field]
                for field in ("target", "weight", "s_uv", "t_uv", "scale")
                if field in edge
            })
            provenance(rec, "paper-theater-hinge-graph", web_path(graph_path, public_root), graph.get("schemaVersion"))


def stroke_id(path: Path, payload: dict[str, Any]) -> str:
    meta = payload.get("meta")
    if isinstance(meta, dict):
        for field in ("id", "file", "f", "original_file", "originalFile"):
            pid = normalise_id(meta.get(field))
            if pid:
                return pid
    return Path(path.stem).stem


def add_root_data(public_root: Path, records: dict[str, dict[str, Any]], warnings: list[str]) -> None:
    """Index root-level stroke-cloud, bootstrap, repair, and curator outputs."""
    root = public_root / "data"
    if not root.exists():
        return
    for path in sorted(root.glob("*.json")):
        if path.name in {"manifest.json", "bootstrap-manifest.json"} or path.name.startswith("graph"):
            continue
        payload = read_json(path, warnings)
        if not isinstance(payload, dict):
            continue

        # Grinder/bootstrap/repair family.
        field = "strokes" if isinstance(payload.get("strokes"), list) else "s"
        strokes = payload.get(field)
        if isinstance(strokes, list):
            rec = record(records, stroke_id(path, payload))
            rep: dict[str, Any] = {
                "data": web_path(path, public_root),
                "count": len(strokes),
                "nativeField": field,
            }
            if isinstance(payload.get("pareidolia"), list):
                rep["hasPareidoliaAnnotations"] = True
                rep["pareidoliaCount"] = len(payload["pareidolia"])
            add_representation(rec, "strokeCloud", rep)
            provenance(rec, "turbo-stroke-cloud", web_path(path, public_root), field)
            continue

        # Curator family: semantic SAM shards plus GPU-ready binary buffers.
        shards = payload.get("shards")
        if isinstance(shards, list):
            pid = normalise_id(payload.get("id")) or path.stem
            rec = record(records, pid)
            rep = {
                "data": web_path(path, public_root),
                "count": len(shards),
            }
            res = payload.get("res")
            if isinstance(res, list) and len(res) == 2:
                rep["resolution"] = res
                if all(isinstance(v, (int, float)) and v > 0 for v in res):
                    rec["source"].setdefault("width", res[0])
                    rec["source"].setdefault("height", res[1])
            buffers: dict[str, str] = {}
            for name, suffix in (("position", "_pos.bin"), ("uv", "_uv.bin"), ("scale", "_scale.bin")):
                buffer_path = root / f"{pid}{suffix}"
                if buffer_path.exists():
                    buffers[name] = web_path(buffer_path, public_root)
            if buffers:
                rep["buffers"] = buffers
            add_representation(rec, "semanticShardCloud", rep)
            provenance(rec, "curator-semantic-shard-cloud", web_path(path, public_root))


def baked_kind(payload: dict[str, Any]) -> str | None:
    if isinstance(payload.get("slices"), list):
        return "semanticLayers"
    if "totalCount" in payload and isinstance(payload.get("isMirror"), list):
        return "unifiedShardField"
    if isinstance(payload.get("aOffset"), list) and isinstance(payload.get("aScale"), list):
        return "perspectiveShardBake"
    return None


def add_baked(public_root: Path, records: dict[str, dict[str, Any]], warnings: list[str]) -> None:
    root = public_root / "data" / "baked"
    if not root.exists():
        return
    for path in sorted(root.glob("*.baked.json")):
        payload = read_json(path, warnings)
        if not isinstance(payload, dict):
            continue
        kind = baked_kind(payload)
        if kind is None:
            warnings.append(f"{path}: unrecognized baked representation; preserved but not integrated")
            continue
        pid = normalise_id(payload.get("id")) or Path(path.name[:-len(".baked.json")]).stem
        rec = record(records, pid)
        rep: dict[str, Any] = {"data": web_path(path, public_root)}
        if isinstance(payload.get("res"), list) and len(payload["res"]) == 2:
            rep["resolution"] = payload["res"]
            if all(isinstance(v, (int, float)) and v > 0 for v in payload["res"]):
                rec["source"].setdefault("width", payload["res"][0])
                rec["source"].setdefault("height", payload["res"][1])
        if kind == "unifiedShardField":
            total = payload.get("totalCount")
            if isinstance(total, int):
                rep.update(count=total, forwardCount=total // 2, mirrorCount=total - total // 2)
            rep["attributes"] = [
                field for field in ("aOffset", "aScale", "aColor", "aUvOffset", "aUvScale", "isMirror")
                if field in payload
            ]
            pipeline = "unified-shard-field"
        elif kind == "perspectiveShardBake":
            if isinstance(payload.get("count"), int):
                rep["count"] = payload["count"]
            rep["attributes"] = [
                field for field in ("aOffset", "aScale", "aColor", "aUvOffset", "aUvScale")
                if field in payload
            ]
            pipeline = "perspective-shard-bake"
        else:
            rep["count"] = len(payload["slices"])
            pipeline = "semantic-layer-deconstructor"
        add_representation(rec, kind, rep)
        provenance(rec, pipeline, web_path(path, public_root))


def add_graph(public_root: Path, records: dict[str, dict[str, Any]], warnings: list[str]) -> None:
    path = public_root / "graph.json"
    graph = read_json(path, warnings) if path.exists() else None
    if not isinstance(graph, dict):
        return
    for node in graph.get("nodes", []):
        if not isinstance(node, dict):
            continue
        pid = normalise_id(node.get("id"))
        if not pid:
            continue
        rec = record(records, pid)
        image = node.get("image")
        if isinstance(image, str) and image:
            image_path = "/assets/" + image
            rec["source"].setdefault("image", image_path)
            add_representation(rec, "flatImage", {"image": image_path})
        else:
            add_representation(rec, "flatImage", {"graphNodeOnly": True})
        for field in ("title", "totalCount"):
            if field in node:
                rec["source"].setdefault(field, node[field])
        provenance(rec, "legacy-or-unified-graph", web_path(path, public_root), graph.get("schemaVersion"))
    for edge in graph.get("edges", []):
        if not isinstance(edge, dict):
            continue
        pid = normalise_id(edge.get("source"))
        if not pid:
            continue
        rec = record(records, pid)
        rec["transitions"].setdefault("legacyOrUnified", []).append({
            field: edge[field]
            for field in ("target", "weight", "s_uv", "t_uv", "source_shard", "target_shard",
                          "s_nx", "s_ny", "s_depth", "t_nx", "t_ny", "t_depth")
            if field in edge
        })


def validate(rec: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if rec.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("schemaVersion mismatch")
    if not isinstance(rec.get("id"), str) or not rec["id"]:
        errors.append("missing/invalid id")
    if not isinstance(rec.get("source"), dict):
        errors.append("source must be an object")
    if not isinstance(rec.get("representations"), dict) or not rec["representations"]:
        errors.append("representations must be a non-empty object")
    if not isinstance(rec.get("transitions"), dict):
        errors.append("transitions must be an object")
    if not isinstance(rec.get("provenance"), list) or not rec["provenance"]:
        errors.append("provenance must be a non-empty array")
    return errors


def build(public_root: Path, strict: bool = False) -> int:
    warnings: list[str] = []
    records: dict[str, dict[str, Any]] = {}
    add_theater(public_root, records, warnings)
    add_root_data(public_root, records, warnings)
    add_baked(public_root, records, warnings)
    add_graph(public_root, records, warnings)

    out = public_root / "data" / "integrated"
    out.mkdir(parents=True, exist_ok=True)
    entries: list[dict[str, Any]] = []
    errors: list[str] = []
    for pid in sorted(records):
        rec = records[pid]
        rec["provenance"].sort(key=lambda item: (item.get("pipeline", ""), item.get("artifact", "")))
        for edges in rec["transitions"].values():
            if isinstance(edges, list):
                edges.sort(key=lambda edge: (str(edge.get("target", "")), -float(edge.get("weight", 0) or 0)))
        for rep in rec["representations"].values():
            if isinstance(rep, dict) and isinstance(rep.get("variants"), list):
                rep["variants"].sort(key=lambda variant: str(variant.get("data", variant.get("image", ""))))
        rec_errors = validate(rec)
        if rec_errors:
            errors.extend(f"{pid}: {msg}" for msg in rec_errors)
            continue
        path = out / f"{pid}.painting-bake.json"
        path.write_text(json.dumps(rec, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        entries.append({
            "id": pid,
            "record": web_path(path, public_root),
            "representations": sorted(rec["representations"]),
            "transitionGraphs": sorted(rec["transitions"]),
        })

    (out / "_manifest.json").write_text(json.dumps({
        "schemaVersion": SCHEMA_VERSION,
        "count": len(entries),
        "records": entries,
    }, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    for msg in warnings:
        print(f"[integration warning] {msg}", file=sys.stderr)
    for msg in errors:
        print(f"[integration error] {msg}", file=sys.stderr)
    print(
        f"Integrated {len(entries)} painting record(s) from "
        f"{sum(len(rec['representations']) for rec in records.values())} representation family slot(s); "
        f"{len(warnings)} warning(s), {len(errors)} error(s)."
    )
    return 1 if errors or (strict and warnings) else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-root", type=Path, default=Path("public"))
    parser.add_argument("--strict", action="store_true", help="also fail on malformed/unrecognized native artifacts")
    args = parser.parse_args(argv)
    if not args.public_root.is_dir():
        print(f"[integration error] not a directory: {args.public_root}", file=sys.stderr)
        return 2
    return build(args.public_root, strict=args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
