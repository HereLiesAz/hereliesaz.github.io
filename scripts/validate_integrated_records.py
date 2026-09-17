#!/usr/bin/env python3
"""Validate generated painting-bake sidecars against the checked-in schema."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from jsonschema import Draft202012Validator


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-root', type=Path, default=Path('public'))
    parser.add_argument('--schema', type=Path, default=Path('schemas/painting-bake.schema.json'))
    args = parser.parse_args()

    schema = json.loads(args.schema.read_text(encoding='utf-8'))
    validator = Draft202012Validator(schema)
    integrated = args.public_root / 'data' / 'integrated'
    manifest_path = integrated / '_manifest.json'
    if not manifest_path.is_file():
        raise SystemExit(f'missing integrated manifest: {manifest_path}')

    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    records = manifest.get('records')
    if not isinstance(records, list):
        raise SystemExit(f'{manifest_path}: records must be a list')

    failures = 0
    seen: set[str] = set()
    for entry in records:
        if not isinstance(entry, dict) or not isinstance(entry.get('id'), str):
            print(f'ERROR: invalid manifest entry: {entry!r}')
            failures += 1
            continue
        painting_id = entry['id']
        if painting_id in seen:
            print(f'ERROR: duplicate painting id in manifest: {painting_id}')
            failures += 1
            continue
        seen.add(painting_id)

        record_path = integrated / f'{painting_id}.painting-bake.json'
        if not record_path.is_file():
            print(f'ERROR: missing record for {painting_id}: {record_path}')
            failures += 1
            continue

        try:
            record = json.loads(record_path.read_text(encoding='utf-8'))
        except Exception as exc:
            print(f'ERROR: {record_path}: invalid JSON: {exc}')
            failures += 1
            continue

        errors = sorted(validator.iter_errors(record), key=lambda error: list(error.absolute_path))
        for error in errors:
            location = '.'.join(str(part) for part in error.absolute_path) or '<root>'
            print(f'ERROR: {record_path}:{location}: {error.message}')
        failures += len(errors)

    sidecars = {
        path.name.removesuffix('.painting-bake.json')
        for path in integrated.glob('*.painting-bake.json')
    }
    stale = sorted(sidecars - seen)
    for painting_id in stale:
        print(f'ERROR: stale integrated sidecar not listed in manifest: {painting_id}.painting-bake.json')
        failures += 1

    if failures:
        print(f'Integrated record validation failed with {failures} error(s).')
        return 1

    print(f'Validated {len(seen)} integrated painting record(s) against {args.schema}.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
