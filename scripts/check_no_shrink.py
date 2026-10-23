#!/usr/bin/env python3
"""Refuse to publish a bake that would drop paintings from the published manifest.

A bake only ever adds or refreshes paintings; removals go through the Remove
Painting workflow. If the art-data seed failed to restore (or restored only
part of) the existing corpus, the baker rebuilds _manifest.json from whatever
is on disk and a plain publish would silently shrink the live site.

    python3 scripts/check_no_shrink.py --before _artdata/theater/_manifest.json \\
                                       --after  public/data/theater/_manifest.json

--before may be absent (first ever bake). Exits 1 and lists the ids that would
be lost; exits 0 otherwise.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def ids(path: Path) -> set[str]:
    value = json.loads(path.read_text())
    if not isinstance(value, list):
        raise ValueError(f"{path} is not a JSON array")
    return set(value)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--before", type=Path, required=True)
    ap.add_argument("--after", type=Path, required=True)
    args = ap.parse_args(argv)

    if not args.before.exists():
        print(f"[i] no previous manifest at {args.before}; nothing to compare")
        return 0
    try:
        before, after = ids(args.before), ids(args.after)
    except (OSError, ValueError) as exc:
        print(f"[!] cannot compare manifests: {exc}", file=sys.stderr)
        return 1
    lost = sorted(before - after)
    if lost:
        print(f"[!] this bake would remove {len(lost)} painting(s) from the manifest "
              f"({len(before)} -> {len(after)}): {lost[:10]}{' ...' if len(lost) > 10 else ''}\n"
              "    The art-data seed was probably incomplete. Refusing to publish.", file=sys.stderr)
        return 1
    print(f"[i] manifest {len(before)} -> {len(after)}; nothing lost")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
