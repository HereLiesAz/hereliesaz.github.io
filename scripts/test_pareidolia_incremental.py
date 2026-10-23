#!/usr/bin/env python3
"""pareidolia_index: incremental, sharded and parallel runs equal a full run.

The expensive matcher is stubbed, but the stub's output depends on both
paintings' ids AND content hashes, so a stale carried-over edge always differs
from a freshly computed one. Run from the repo root:

    python3 -m unittest scripts/test_pareidolia_incremental.py

Needs what pareidolia_index imports (cv2, numpy, Pillow).
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pareidolia_index as pi  # noqa: E402

SIZE: dict[str, tuple[int, int]] = {}
HASH: dict[str, str] = {}
CALLS: list[tuple[str, str]] = []


def fake_load(_dir, pid):
    w, h = SIZE[pid]
    return {"id": pid, "w": w, "h": h, "hash": HASH[pid]}


def fake_hinge(a, b):
    CALLS.append((a["id"], b["id"]))
    seed = sum(ord(c) for c in a["id"] + a["hash"] + b["id"] + b["hash"])
    if seed % 5 == 0:                      # some pairs rejected, like the real bar
        return None
    return {"weight": round(seed % 97 / 100, 4), "s_uv": [0.5, 0.5], "t_uv": [0.4, 0.6], "scale": 0.3}


def edge_set(graph):
    return {(e["source"], e["target"], e["weight"]) for e in graph["edges"]}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        SIZE.clear(), HASH.clear(), CALLS.clear()
        SIZE.update({"a": (10, 10), "b": (10, 12), "c": (8, 8), "d": (9, 9)})
        HASH.update({pid: f"h-{pid}-1" for pid in SIZE})
        self._saved = (pi.load_painting, pi.best_hinge, pi.SKIP_FLAG)
        pi.load_painting, pi.best_hinge = fake_load, fake_hinge
        pi.SKIP_FLAG = self.data / "no-such-flag"   # the repo's real flag must not leak in

    def tearDown(self):
        pi.load_painting, pi.best_hinge, pi.SKIP_FLAG = self._saved
        self.tmp.cleanup()

    def run_pi(self, ids, *extra, expect=0):
        (self.data / "_manifest.json").write_text(json.dumps(ids))
        CALLS.clear()
        self.assertEqual(pi.main(["--data", str(self.data), *extra]), expect)
        out = self.data / "graph.theater.json"
        return json.loads(out.read_text()) if out.exists() else None

    def full_graph(self, ids):
        other = Path(self.tmp.name, "full")
        other.mkdir(exist_ok=True)
        (other / "_manifest.json").write_text(json.dumps(ids))
        self.assertEqual(pi.main(["--data", str(other), "--full"]), 0)
        return json.loads((other / "graph.theater.json").read_text())


class Incremental(Base):
    def test_group_bakes_equal_one_full_run_edge_for_edge(self):
        self.run_pi(["a", "b"])
        g = self.run_pi(["a", "b", "c", "d"])
        self.assertTrue(all("c" in pair or "d" in pair for pair in CALLS), CALLS)
        self.assertTrue(g["edges"], "the stub must produce carried edges for this test to mean anything")
        self.assertTrue(any(e["source"] in "ab" and e["target"] in "ab" for e in g["edges"]))
        full = self.full_graph(["a", "b", "c", "d"])
        self.assertEqual(g["edges"], full["edges"])        # same edges, same order

    def test_full_recomputes_every_pair(self):
        self.run_pi(["a", "b", "c", "d"])
        self.run_pi(["a", "b", "c", "d"], "--full")
        self.assertEqual(len(CALLS), 12)

    def test_rebake_at_same_dimensions_is_detected_by_content_hash(self):
        self.run_pi(["a", "b", "c", "d"])
        HASH["a"] = "h-a-2"                                # new pixels, same width and height
        g = self.run_pi(["a", "b", "c", "d"])
        self.assertTrue(CALLS and all("a" in pair for pair in CALLS), CALLS)
        self.assertEqual(g["edges"], self.full_graph(["a", "b", "c", "d"])["edges"])

    def test_rebake_at_new_dimensions_reruns_only_its_pairs(self):
        self.run_pi(["a", "b", "c", "d"])
        SIZE["a"] = (11, 11)
        g = self.run_pi(["a", "b", "c", "d"])
        self.assertTrue(all("a" in pair for pair in CALLS), CALLS)
        self.assertEqual(g["edges"], self.full_graph(["a", "b", "c", "d"])["edges"])

    def test_removed_painting_drops_its_edges(self):
        self.run_pi(["a", "b", "c", "d"])
        g = self.run_pi(["a", "b", "c"])
        self.assertEqual(CALLS, [])
        self.assertTrue(all(e["source"] != "d" and e["target"] != "d" for e in g["edges"]))
        self.assertEqual({n["id"] for n in g["nodes"]}, {"a", "b", "c"})

    def test_legacy_nodes_without_hash_are_trusted_at_equal_dimensions(self):
        self.run_pi(["a", "b"])
        path = self.data / "graph.theater.json"
        legacy = json.loads(path.read_text())
        for n in legacy["nodes"]:
            n.pop("hash")
        legacy.pop("matcherVersion")
        path.write_text(json.dumps(legacy))
        self.run_pi(["a", "b", "c"])
        self.assertTrue(all("c" in pair for pair in CALLS), CALLS)

    def test_malformed_prior_graph_falls_back_to_a_full_run(self):
        self.run_pi(["a", "b"])
        path = self.data / "graph.theater.json"
        for broken in (
            {"schemaVersion": 5, "nodes": [{"id": "a"}], "edges": []},                  # node without dims
            {"schemaVersion": 5, "nodes": [], "edges": [{"target": "b"}]},              # edge without source
            {"schemaVersion": 5, "nodes": "nope", "edges": []},
            [],
        ):
            path.write_text(json.dumps(broken))
            g = self.run_pi(["a", "b"])
            self.assertEqual(len(CALLS), 2, broken)
            self.assertEqual(g["edges"], self.full_graph(["a", "b"])["edges"])

    def test_other_matcher_version_is_never_carried_over(self):
        self.run_pi(["a", "b"])
        path = self.data / "graph.theater.json"
        old = json.loads(path.read_text())
        old["matcherVersion"] = pi.MATCHER_VERSION + 1
        path.write_text(json.dumps(old))
        self.run_pi(["a", "b"])
        self.assertEqual(len(CALLS), 2)


class Parallel(Base):
    def test_jobs_gives_the_same_graph(self):
        ids = ["a", "b", "c", "d"]
        serial = self.run_pi(ids, "--full")
        parallel = self.run_pi(ids, "--full", "--jobs", "2")
        self.assertEqual(serial["edges"], parallel["edges"])


class Shards(Base):
    IDS = ["a", "b", "c", "d"]

    def test_shards_merge_into_the_full_graph_and_are_removed(self):
        for k in range(3):
            self.run_pi(self.IDS, "--shard", f"{k}/3")
            self.assertTrue((self.data / f"graph.theater.shard-{k}-of-3.json").exists())
        self.assertFalse((self.data / "graph.theater.json").exists())
        g = self.run_pi(self.IDS, "--merge")
        self.assertEqual(g["edges"], self.full_graph(self.IDS)["edges"])
        self.assertEqual(list(self.data.glob("graph.theater.shard-*")), [])

    def test_shard_resumes_after_an_interruption(self):
        real = pi.best_hinge
        state = {"n": 0}

        def flaky(a, b):
            state["n"] += 1
            if state["n"] == 5:                              # dies mid-way through the second painting
                raise KeyboardInterrupt
            return real(a, b)

        pi.best_hinge = flaky
        with self.assertRaises(KeyboardInterrupt):
            self.run_pi(self.IDS, "--shard", "0/2")
        pi.best_hinge = real
        saved = json.loads((self.data / "graph.theater.shard-0-of-2.json").read_text())
        self.assertEqual(len(saved["done"]), 1)               # first painting survived the crash
        CALLS.clear()
        self.run_pi(self.IDS, "--shard", "0/2")
        self.assertFalse(any(sid in saved["done"] for sid, _ in CALLS), CALLS)
        self.run_pi(self.IDS, "--shard", "1/2")
        g = self.run_pi(self.IDS, "--merge")
        self.assertEqual(g["edges"], self.full_graph(self.IDS)["edges"])

    def test_merge_refuses_missing_incomplete_or_foreign_shards(self):
        self.run_pi(self.IDS, "--shard", "0/2")
        self.run_pi(self.IDS, "--merge", expect=1)            # shard 1 missing
        self.run_pi(self.IDS, "--shard", "1/2")
        path = self.data / "graph.theater.shard-1-of-2.json"
        shard = json.loads(path.read_text())
        shard["done"] = shard["done"][:-1]
        path.write_text(json.dumps(shard))
        self.run_pi(self.IDS, "--merge", expect=1)            # incomplete
        shard["done"] = sorted(set(shard["done"]) | {"a", "b", "c", "d"})
        shard["plan"] = "someone-elses-plan"
        path.write_text(json.dumps(shard))
        self.run_pi(self.IDS, "--merge", expect=1)            # foreign plan
        self.assertFalse((self.data / "graph.theater.json").exists())

    def test_shard_and_merge_together_are_rejected(self):
        with self.assertRaises(SystemExit):
            pi.main(["--data", str(self.data), "--shard", "0/2", "--merge"])


class SkipFlag(Base):
    def test_flag_makes_a_plain_run_a_no_op_but_not_the_combining_modes(self):
        flag = self.data / "hinge_graph.skip"
        flag.write_text("skip")
        pi.SKIP_FLAG = flag
        self.assertIsNone(self.run_pi(["a", "b"]))
        self.assertEqual(CALLS, [])
        self.assertIsNotNone(self.run_pi(["a", "b"], "--full"))
        (self.data / "graph.theater.json").unlink()
        self.run_pi(["a", "b"], "--shard", "0/1")
        self.assertIsNotNone(self.run_pi(["a", "b"], "--merge"))
        flag.unlink()
        (self.data / "graph.theater.json").unlink()
        self.assertIsNotNone(self.run_pi(["a", "b"]))          # no flag => runs


if __name__ == "__main__":
    unittest.main()
