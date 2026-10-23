#!/usr/bin/env python3
"""Regression tests for validate_output.py, the gate before art-data is published.

Run from the repo root:  python3 -m unittest scripts/test_validate_output.py
Needs only Pillow.
"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

import validate_output as vo  # noqa: E402


def write_painting(d: Path, pid: str, w=8, h=6, depth_mode="I;16"):
    Image.new("RGB", (w, h)).save(d / f"{pid}.painting.webp")
    Image.new(depth_mode, (w, h)).save(d / f"{pid}.depth.png")
    (d / f"{pid}.theater.json").write_text(json.dumps({
        "schema": 2,
        "src": {"width": w, "height": h},
        "depth": {"source": "depth-anything-v2",
                  "bands": {"count": 2, "centers": [0.25, 0.75], "edges": [0.0, 0.5, 1.0]}},
    }))


def edge(a, b, w=0.5):
    return {"source": a, "target": b, "weight": w, "s_uv": [0.5, 0.5], "t_uv": [0.5, 0.5], "scale": 0.3}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        vo.errors.clear()
        self.skip = Path(self.tmp.name) / "skip.flag"
        self._old_skip = vo.SKIP_FLAG
        vo.SKIP_FLAG = self.skip  # a nonexistent path unless a test creates it

    def tearDown(self):
        vo.SKIP_FLAG = self._old_skip
        self.tmp.cleanup()

    def corpus(self, ids, graph=None, **kw):
        for pid in ids:
            write_painting(self.dir, pid, **kw)
        (self.dir / "_manifest.json").write_text(json.dumps(ids))
        if graph is not None:
            (self.dir / "graph.theater.json").write_text(json.dumps(graph))

    def run_main(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            rc = vo.main(["--dir", str(self.dir)])
        return rc, out.getvalue()


def node(pid, w=8, h=6):
    return {"id": pid, "width": w, "height": h}


class Coverage(Base):
    def test_valid_corpus_passes(self):
        self.corpus(["a", "b"], {"schemaVersion": 5, "nodes": [node("a"), node("b")], "edges": [edge("a", "b")]})
        self.assertEqual(self.run_main()[0], 0)

    def test_missing_graph_fails_without_skip_flag(self):
        self.corpus(["a", "b"])
        rc, out = self.run_main()
        self.assertEqual(rc, 1)
        self.assertIn("graph.theater.json is missing", out)

    def test_missing_graph_is_reported_not_fatal_with_skip_flag(self):
        self.corpus(["a", "b"])
        self.skip.write_text("")
        self.assertEqual(self.run_main()[0], 0)

    def test_graph_trailing_manifest_fails_without_skip_flag(self):
        self.corpus(["a", "b", "c"], {"schemaVersion": 5, "nodes": [node("a"), node("b")], "edges": [edge("a", "b")]})
        rc, out = self.run_main()
        self.assertEqual(rc, 1)
        self.assertIn("missing 1 manifest", out)

    def test_graph_trailing_manifest_is_reported_with_skip_flag(self):
        self.corpus(["a", "b", "c"], {"schemaVersion": 5, "nodes": [node("a"), node("b")], "edges": [edge("a", "b")]})
        self.skip.write_text("")
        rc, out = self.run_main()
        self.assertEqual(rc, 0)
        self.assertIn("covers 2/3", out)

    def test_ghost_node_fails(self):
        self.corpus(["a", "b"], {"schemaVersion": 5, "nodes": [node("a"), node("b"), node("ghost")],
                                 "edges": [edge("a", "b")]})
        rc, out = self.run_main()
        self.assertEqual(rc, 1)
        self.assertIn("not in _manifest.json", out)

    def test_node_dimension_mismatch_fails(self):
        self.corpus(["a", "b"], {"schemaVersion": 5, "nodes": [node("a", 9, 6), node("b")], "edges": [edge("a", "b")]})
        rc, out = self.run_main()
        self.assertEqual(rc, 1)
        self.assertIn("says 8x6", out)

    def test_two_node_graph_with_both_directions_is_valid(self):
        self.corpus(["a", "b"], {"schemaVersion": 5, "nodes": [node("a"), node("b")],
                                 "edges": [edge("a", "b"), edge("b", "a")]})
        self.assertEqual(self.run_main()[0], 0)

    def test_complete_graph_still_fails_on_a_real_corpus(self):
        ids = [f"p{i}" for i in range(vo.COMPLETE_GRAPH_MIN_NODES)]
        edges = [edge(a, b) for a in ids for b in ids if a != b]
        self.corpus(ids, {"schemaVersion": 5, "nodes": [node(i) for i in ids], "edges": edges})
        rc, out = self.run_main()
        self.assertEqual(rc, 1)
        self.assertIn("COMPLETE", out)


class Depth(Base):
    def test_unreadable_depth_png_fails(self):
        self.corpus(["a"])
        (self.dir / "a.depth.png").write_bytes(b"")
        rc, out = self.run_main()
        self.assertEqual(rc, 1)
        self.assertIn("a.depth.png", out)

    def test_eight_bit_depth_png_fails(self):
        self.corpus(["a"], depth_mode="L")
        rc, out = self.run_main()
        self.assertEqual(rc, 1)
        self.assertIn("16-bit", out)

    def test_missing_companion_fails(self):
        self.corpus(["a"])
        (self.dir / "a.painting.webp").unlink()
        self.assertEqual(self.run_main()[0], 1)


if __name__ == "__main__":
    unittest.main()
