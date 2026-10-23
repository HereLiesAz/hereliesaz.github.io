#!/usr/bin/env python3
"""Regression tests for the baker's cost and namespace guards.

Run from the repo root:  python3 -m unittest scripts/test_theater_baker_guards.py
Needs the baker's own dependencies (numpy, opencv, Pillow); see scripts/requirements.txt.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import theater_baker as tb  # noqa: E402


class IdProblem(unittest.TestCase):
    def test_reserved_and_unsafe_ids_are_refused(self):
        self.assertIsNotNone(tb.id_problem("graph"))
        self.assertIsNotNone(tb.id_problem("_manifest"))
        for ch in "#%?&+/\\":
            self.assertIsNotNone(tb.id_problem(f"a{ch}b"), ch)

    def test_real_world_ids_are_accepted(self):
        for stem in ("PXL_20230107_104032885-01(1)", "2014-11-09 19.16.33",
                     "20231129_043102~2", "IMG_0025", "a.b"):
            self.assertIsNone(tb.id_problem(stem), stem)


class IterImages(unittest.TestCase):
    def test_duplicates_and_reserved_stems_are_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for name in ("a.jpg", "a.png", "graph.jpg", "_x.jpg", "ok.jpg", "notes.txt"):
                (root / name).write_bytes(b"x")
            self.assertEqual([p.name for p in tb.iter_images(root)], ["a.jpg", "ok.jpg"])


class MainGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "in").mkdir()
        (self.root / "in" / "a.jpg").write_bytes(b"x")
        self.argv = ["--input", str(self.root / "in"), "--output", str(self.root / "out")]

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_ids_without_all_refuses(self):
        self.assertEqual(tb.main(self.argv), 2)

    def test_too_many_ids_refuses(self):
        ids = ",".join(f"id{i}" for i in range(tb.MAX_IDS + 1))
        self.assertEqual(tb.main(self.argv + ["--ids", ids]), 2)

    def test_max_ids_is_adjustable(self):
        self.assertEqual(tb.main(self.argv + ["--ids", "a,b", "--max-ids", "1"]), 2)


class Pending(unittest.TestCase):
    """--pending N bakes only unbaked images or ones whose crop entry changed."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.inp, self.out = root / "in", root / "out"
        self.inp.mkdir(), self.out.mkdir()
        for stem in ("done", "unbaked", "recrop", "partial", "z-extra"):
            (self.inp / f"{stem}.jpg").write_bytes(b"x")
        for stem, crop in (("done", "heuristic"), ("recrop", [0, 0, 1, 1]), ("partial", "heuristic")):
            (self.out / f"{stem}.theater.json").write_text(json.dumps({"schema": 2, "crop": crop}))
            (self.out / f"{stem}.painting.webp").write_bytes(b"x")
            (self.out / f"{stem}.depth.png").write_bytes(b"x")
        (self.out / "partial.depth.png").unlink()           # torn bake
        self._crops = dict(tb.MANUAL_CROPS)
        tb.MANUAL_CROPS.clear()
        tb.MANUAL_CROPS["recrop"] = [0.1, 0.1, 0.9, 0.9]     # moved since it was baked
        self.baked = []
        self._bake = tb.bake_image

        def fake(path, out, max_side, force=False):
            self.baked.append(path.stem)
            return {"id": path.stem, "depth": {"source": "stub", "bands": {"count": 1}}}

        tb.bake_image = fake

    def tearDown(self):
        tb.bake_image = self._bake
        tb.MANUAL_CROPS.clear()
        tb.MANUAL_CROPS.update(self._crops)
        self.tmp.cleanup()

    def run_main(self, *extra):
        return tb.main(["--input", str(self.inp), "--output", str(self.out), *extra])

    def test_selects_unbaked_torn_and_recropped_only(self):
        self.run_main("--pending")
        self.assertEqual(sorted(self.baked), ["partial", "recrop", "unbaked", "z-extra"])

    def test_pending_is_capped(self):
        self.run_main("--pending", "2")
        self.assertEqual(len(self.baked), 2)

    def test_pending_cannot_be_combined_with_ids_or_all(self):
        self.assertEqual(self.run_main("--pending", "--ids", "done"), 2)
        self.assertEqual(self.run_main("--pending", "--all"), 2)
        self.assertEqual(self.baked, [])


class LocalDepth(unittest.TestCase):
    def test_one_bad_image_does_not_disable_local_depth(self):
        import numpy as np

        calls = []

        def pipe(_img):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("oom on this image")
            return {"depth": tb.Image.fromarray(np.arange(16, dtype=np.uint8).reshape(4, 4))}

        old = (tb._depth_pipe, tb._depth_local_disabled)
        tb._depth_pipe, tb._depth_local_disabled = pipe, False
        try:
            rgb = np.zeros((4, 4, 3), np.uint8)
            self.assertIsNone(tb.estimate_depth_local(rgb))
            self.assertFalse(tb._depth_local_disabled)
            self.assertIsNotNone(tb.estimate_depth_local(rgb))
        finally:
            tb._depth_pipe, tb._depth_local_disabled = old


if __name__ == "__main__":
    unittest.main()
