#!/usr/bin/env python3
"""Run from the repo root:  python3 -m unittest scripts/test_check_no_shrink.py  (stdlib only)"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_no_shrink as cns  # noqa: E402


class NoShrink(unittest.TestCase):
    def run_cmp(self, before, after):
        with tempfile.TemporaryDirectory() as d:
            b, a = Path(d, "b.json"), Path(d, "a.json")
            if before is not None:
                b.write_text(before if isinstance(before, str) else json.dumps(before))
            a.write_text(after if isinstance(after, str) else json.dumps(after))
            return cns.main(["--before", str(b), "--after", str(a)])

    def test_growth_and_equal_pass(self):
        self.assertEqual(self.run_cmp(["a", "b"], ["a", "b", "c"]), 0)
        self.assertEqual(self.run_cmp(["a", "b"], ["b", "a"]), 0)

    def test_first_bake_has_nothing_to_compare(self):
        self.assertEqual(self.run_cmp(None, ["a"]), 0)

    def test_losing_a_painting_fails(self):
        self.assertEqual(self.run_cmp(["a", "b", "c"], ["a", "b"]), 1)
        self.assertEqual(self.run_cmp(["a", "b"], []), 1)

    def test_unreadable_manifests_fail_closed(self):
        self.assertEqual(self.run_cmp(["a"], "not json"), 1)
        self.assertEqual(self.run_cmp("not json", ["a"]), 1)
        self.assertEqual(self.run_cmp({"a": 1}, ["a"]), 1)


if __name__ == "__main__":
    unittest.main()
