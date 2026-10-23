// Run: node --test scripts/test-ship-filter.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pruneShippedData } from './ship-filter.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ship-filter-'));
  const put = (rel, body = 'x') => {
    const path = join(dir, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
  };
  put('theater/_manifest.json', JSON.stringify(['a', 'b c(1)']));
  put('theater/graph.theater.json', '{}');
  for (const id of ['a', 'b c(1)']) {
    put(`theater/${id}.theater.json`);
    put(`theater/${id}.painting.webp`);
    put(`theater/${id}.depth.png`);
    put(`theater/${id}.masks.png`);        // intermediate: not fetched
  }
  put('theater/orphan.theater.json');       // not in the manifest
  put('theater/orphan.painting.webp');
  put('theater/a.photo.png');               // intermediate
  put('integrated/a.json');
  put('data/x.json');                       // legacy stroke clouds
  put('baked/x.baked.json');
  put('stray.json');
  put('loose.jpg');
  return dir;
}

const names = dir => readdirSync(dir).sort();

test('keeps exactly the manifest-listed runtime files, the shared files, and integrated/', () => {
  const dir = fixture();
  try {
    pruneShippedData(dir);
    assert.deepEqual(names(dir), ['integrated', 'theater']);
    assert.deepEqual(names(join(dir, 'theater')), [
      '_manifest.json', 'a.depth.png', 'a.painting.webp', 'a.theater.json',
      'b c(1).depth.png', 'b c(1).painting.webp', 'b c(1).theater.json',
      'graph.theater.json',
    ]);
    assert.deepEqual(names(join(dir, 'integrated')), ['a.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports what it removed and is idempotent', () => {
  const dir = fixture();
  try {
    const first = pruneShippedData(dir);
    assert.deepEqual(first, { removed: 9, bytes: 9 });
    assert.deepEqual(pruneShippedData(dir), { removed: 0, bytes: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing data dir is fine, and an unusable manifest leaves theater/ untouched', () => {
  assert.deepEqual(pruneShippedData(join(tmpdir(), 'no-such-data-dir-xyz')), { removed: 0, bytes: 0 });
  const dir = fixture();
  try {
    writeFileSync(join(dir, 'theater', '_manifest.json'), 'not json');
    pruneShippedData(dir);
    assert.ok(existsSync(join(dir, 'theater', 'orphan.theater.json')));
    assert.ok(!existsSync(join(dir, 'stray.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
