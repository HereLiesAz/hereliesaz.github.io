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
            (theater / "a.masks.png").write_bytes(b"")
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

            compact_stroke_path = public / "data" / "a.jpg.json"
            compact_stroke_payload = {
                "meta": {"f": "a.jpg"},
                "s": [{"c": [1, 2, 3], "b": [0, 0, 1, 1], "z": 0.5}],
                "pareidolia": [{"u": 0.5, "v": 0.5}],
            }
            compact_stroke_path.write_text(json.dumps(compact_stroke_payload), encoding="utf-8")

            legacy_stroke_path = public / "data" / "a.json"
            legacy_stroke_payload = {
                "meta": {"original_file": "a.json", "resolution": [100, 50]},
                "strokes": [[0, 0, -1, 1, 0, 255, 255, 255]],
            }
            legacy_stroke_path.write_text(json.dumps(legacy_stroke_payload), encoding="utf-8")

            unified_path = baked / "a.baked.json"
            unified_payload = {
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
            unified_path.write_text(json.dumps(unified_payload), encoding="utf-8")

            perspective_path = baked / "a.jpg.baked.json"
            perspective_path.write_text(json.dumps({
                "id": "a.jpg",
                "count": 2,
                "aOffset": [0, 0, 1, 0, 0, -1],
                "aScale": [1, 1, 1, 1],
                "aColor": [1, 1, 1, 1, 1, 1],
                "aUvOffset": [0, 0, 0, 0],
                "aUvScale": [1, 1, 1, 1],
            }), encoding="utf-8")

            curator_path = public / "data" / "a.curator.json"
            curator_path.write_text(json.dumps({
                "id": "a",
                "res": [100, 50],
                "shards": [{"id": 0, "bbox": [0, 0, 20, 10], "depth": 0.5, "area": 200}],
            }), encoding="utf-8")
            for suffix in ("_pos.bin", "_uv.bin", "_scale.bin"):
                (public / "data" / f"a{suffix}").write_bytes(b"\0\0\0\0")

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
                    "source_shard": 1,
                    "target_shard": 2,
                    "s_depth": 0.4,
                    "t_depth": 0.6,
                }],
            }), encoding="utf-8")

            originals = {
                compact_stroke_path: compact_stroke_path.read_bytes(),
                legacy_stroke_path: legacy_stroke_path.read_bytes(),
                unified_path: unified_path.read_bytes(),
                perspective_path: perspective_path.read_bytes(),
                curator_path: curator_path.read_bytes(),
                graph_path: graph_path.read_bytes(),
                theater / "a.theater.json": (theater / "a.theater.json").read_bytes(),
            }

            self.assertEqual(build(public), 0)

            record_a = json.loads((public / "data" / "integrated" / "a.painting-bake.json").read_text())
            self.assertEqual(
                set(record_a["representations"]),
                {
                    "theater",
                    "strokeCloud",
                    "unifiedShardField",
                    "perspectiveShardBake",
                    "semanticShardCloud",
                    "flatImage",
                },
            )
            self.assertEqual(len(record_a["representations"]["strokeCloud"]["variants"]), 2)
            compact_variant = next(
                variant for variant in record_a["representations"]["strokeCloud"]["variants"]
                if variant["nativeField"] == "s"
            )
            self.assertEqual(compact_variant["pareidoliaCount"], 1)
            self.assertEqual(record_a["representations"]["theater"]["masks"], "/data/theater/a.masks.png")
            self.assertEqual(
                set(record_a["representations"]["semanticShardCloud"]["buffers"]),
                {"position", "uv", "scale"},
            )
            self.assertEqual(record_a["transitions"]["theater"][0]["target"], "b")
            self.assertEqual(record_a["transitions"]["legacyOrUnified"][0]["s_depth"], 0.4)

            record_b = json.loads((public / "data" / "integrated" / "b.painting-bake.json").read_text())
            self.assertEqual(record_b["representations"]["flatImage"]["image"], "/assets/b.jpg")

            manifest = json.loads((public / "data" / "integrated" / "_manifest.json").read_text())
            self.assertEqual(manifest["count"], 2)
            self.assertEqual([entry["id"] for entry in manifest["records"]], ["a", "b"])

            for path, before in originals.items():
                self.assertEqual(path.read_bytes(), before, f"integrator modified native artifact {path}")

    def test_recognizes_semantic_layer_bakes(self):
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

            self.assertEqual(build(public), 0)
            semantic = json.loads((public / "data" / "integrated" / "semantic.painting-bake.json").read_text())
            self.assertIn("semanticLayers", semantic["representations"])


if __name__ == "__main__":
    unittest.main()
