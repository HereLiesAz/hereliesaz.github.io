#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from integrate_painting_bakes import build  # noqa: E402


class PaintingBakeIntegrationTests(unittest.TestCase):
    def test_combines_native_representations_without_rewriting_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            public = Path(tmp) / "public"
            theater = public / "data" / "theater"
            baked = public / "data" / "baked"
            assets = public / "assets"
            theater.mkdir(parents=True)
            baked.mkdir(parents=True)
            assets.mkdir(parents=True)

            (theater / "_manifest.json").write_text('["a"]', encoding="utf-8")
            (theater / "a.theater.json").write_text(json.dumps({
                "schema": 2,
                "src": {"width": 100, "height": 50, "file": "a.jpg"},
                "depth": {
                    "source": "depth-anything-v2",
                    "bands": {"centers": [0.25, 0.75]},
                },
            }), encoding="utf-8")
            (theater / "a.painting.webp").write_bytes(b"")
            (theater / "a.depth.png").write_bytes(b"")
            (theater / "graph.theater.json").write_text(json.dumps({
                "schemaVersion": 5,
                "nodes": [{"id": "a"}, {"id": "b"}],
                "edges": [{
                    "source": "a",
                    "target": "b",
                    "weight": 0.8,
                    "s_uv": [0.2, 0.3],
                    "t_uv": [0.6, 0.7],
                    "scale": 0.3,
                }],
            }), encoding="utf-8")

            stroke_path = public / "data" / "a.jpg.json"
            stroke_payload = {
                "meta": {"f": "a.jpg"},
                "s": [{"c": [1, 2, 3], "b": [0, 0, 1, 1], "z": 0.5}],
                "pareidolia": [{"u": 0.5, "v": 0.5}],
            }
            stroke_path.write_text(json.dumps(stroke_payload), encoding="utf-8")

            shard_path = baked / "a.baked.json"
            shard_payload = {
                "id": "a",
                "res": [100, 50],
                "totalCount": 2,
                "aOffset": [0, 0, 1, 0, 0, -1],
                "aScale": [1, 1, 1, 1],
                "aColor": [1, 1, 1, 1, 1, 1],
                "aUvOffset": [0, 0, 0, 0],
                "aUvScale": [1, 1, 1, 1],
                "isMirror": [0, 1],
            }
            shard_path.write_text(json.dumps(shard_payload), encoding="utf-8")

            graph_path = public / "graph.json"
            graph_path.write_text(json.dumps({
                "schemaVersion": 2,
                "nodes": [
                    {"id": "a", "image": "a.jpg", "title": "A", "totalCount": 2},
                    {"id": "b", "image": "b.jpg", "title": "B"},
                ],
                "edges": [{
                    "source": "a",
                    "target": "b",
                    "weight": 0.9,
                    "s_uv": [0.5, 0.5],
                    "t_uv": [0.5, 0.5],
                }],
            }), encoding="utf-8")

            originals = {
                stroke_path: stroke_path.read_bytes(),
                shard_path: shard_path.read_bytes(),
                graph_path: graph_path.read_bytes(),
                theater / "a.theater.json": (theater / "a.theater.json").read_bytes(),
            }

            self.assertEqual(build(public), 0)

            record_a = json.loads((public / "data" / "integrated" / "a.painting-bake.json").read_text())
            self.assertEqual(
                set(record_a["representations"]),
                {"theater", "strokeCloud", "unifiedShardField", "flatImage"},
            )
            self.assertEqual(record_a["representations"]["strokeCloud"]["pareidoliaCount"], 1)
            self.assertEqual(record_a["transitions"]["theater"][0]["target"], "b")
            self.assertEqual(record_a["transitions"]["legacyOrUnified"][0]["target"], "b")

            record_b = json.loads((public / "data" / "integrated" / "b.painting-bake.json").read_text())
            self.assertEqual(record_b["representations"]["flatImage"]["image"], "/assets/b.jpg")

            manifest = json.loads((public / "data" / "integrated" / "_manifest.json").read_text())
            self.assertEqual(manifest["count"], 2)
            self.assertEqual([entry["id"] for entry in manifest["records"]], ["a", "b"])

            for path, before in originals.items():
                self.assertEqual(path.read_bytes(), before, f"integrator modified native artifact {path}")

    def test_recognizes_semantic_and_perspective_bakes(self):
        with tempfile.TemporaryDirectory() as tmp:
            public = Path(tmp) / "public"
            baked = public / "data" / "baked"
            baked.mkdir(parents=True)

            (baked / "semantic.baked.json").write_text(json.dumps({
                "id": "semantic",
                "res": [20, 10],
                "count": 1,
                "slices": [{"b": [0, 0, 5, 5], "z": 1.0}],
            }), encoding="utf-8")
            (baked / "perspective.baked.json").write_text(json.dumps({
                "id": "perspective",
                "count": 2,
                "aOffset": [0, 0, 1, 0, 0, -1],
                "aScale": [1, 1, 1, 1],
                "aColor": [1, 1, 1, 1, 1, 1],
                "aUvOffset": [0, 0, 0, 0],
                "aUvScale": [1, 1, 1, 1],
            }), encoding="utf-8")

            self.assertEqual(build(public), 0)
            semantic = json.loads((public / "data" / "integrated" / "semantic.painting-bake.json").read_text())
            perspective = json.loads((public / "data" / "integrated" / "perspective.painting-bake.json").read_text())
            self.assertIn("semanticLayers", semantic["representations"])
            self.assertIn("perspectiveShardBake", perspective["representations"])


if __name__ == "__main__":
    unittest.main()
