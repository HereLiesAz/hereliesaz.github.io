#!/usr/bin/env python3
"""Incremental graph == full graph: the edge for (A, B) depends only on A and B.

Stubs the expensive matcher so this runs in milliseconds; needs only that
pareidolia_index imports (cv2, numpy, Pillow).
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pareidolia_index as pi

SIZE = {"a": (10, 10), "b": (10, 12), "c": (8, 8), "d": (9, 9)}
calls: list[tuple[str, str]] = []


def fake_load(_dir, pid):
    w, h = SIZE[pid]
    return {"id": pid, "w": w, "h": h}


def fake_hinge(a, b):
    calls.append((a["id"], b["id"]))
    # deterministic, with some pairs rejected like the real matcher does
    if (ord(a["id"]) + ord(b["id"])) % 3 == 0:
        return None
    w = round((ord(a["id"]) * 7 + ord(b["id"])) % 10 / 10, 4)
    return {"weight": w, "s_uv": [0.5, 0.5], "t_uv": [0.5, 0.5], "scale": 0.3}


pi.load_painting, pi.best_hinge = fake_load, fake_hinge


def run(data: Path, ids: list[str], *extra: str) -> dict:
    (data / "_manifest.json").write_text(json.dumps(ids))
    calls.clear()
    assert pi.main(["--data", str(data), *extra]) == 0
    return json.loads((data / "graph.theater.json").read_text())


def edge_set(g: dict) -> set:
    return {(e["source"], e["target"], e["weight"]) for e in g["edges"]}


with tempfile.TemporaryDirectory() as tmp:
    inc, full = Path(tmp, "inc"), Path(tmp, "full")
    inc.mkdir(), full.mkdir()

    run(inc, ["a", "b"])
    g2 = run(inc, ["a", "b", "c", "d"])            # group 2 arrives
    assert all("c" in p or "d" in p for p in calls), calls   # old x old reused
    g_full = run(full, ["a", "b", "c", "d"])
    assert edge_set(g2) == edge_set(g_full)

    run(inc, ["a", "b", "c", "d"], "--full")       # --full recomputes everything
    assert len(calls) == 12, calls

    SIZE["a"] = (11, 11)                           # a re-baked at new dimensions
    run(inc, ["a", "b", "c", "d"])
    assert all("a" in p for p in calls), calls     # only pairs touching a rerun

print("incremental hinge graph matches full graph")
