// What of the art-data checkout (public/data) is allowed into the deployed site.
//
// The art-data branch carries more than the site serves: ~1.9 GB of legacy
// stroke-cloud JSON (data/, baked/, loose *.json at the root), theater bakes for
// paintings that have since left the manifest, and per-painting masks/photo
// intermediates. Only data/theater/ (manifest-listed paintings) is fetched at
// runtime. GitHub Pages rejects sites over 1 GB, so everything else is dropped
// from the BUILD OUTPUT here. Nothing is deleted from public/ or the branch.
//
// data/integrated/ (canonical records, built in CI) is kept. A few of its
// records link to files this filter removes (legacy `data`, `baked`, `masks`);
// no page or app follows those links, they exist for provenance.
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SHIPPED_DATA_DIRS = new Set(['theater', 'integrated']);
const THEATER_SHARED_FILES = new Set(['_manifest.json', 'graph.theater.json']);
const THEATER_RUNTIME_SUFFIXES = ['.theater.json', '.painting.webp', '.depth.png'];

function sizeOf(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

function remove(path, tally) {
  tally.bytes += sizeOf(path);
  tally.removed += 1;
  rmSync(path, { recursive: true, force: true });
}

/** The ids listed by data/theater/_manifest.json, or null if unusable. */
function manifestIds(theaterDir) {
  try {
    const ids = JSON.parse(readFileSync(join(theaterDir, '_manifest.json'), 'utf8'));
    return Array.isArray(ids) ? new Set(ids) : null;
  } catch {
    return null;
  }
}

/**
 * Remove everything under `dataDir` that the runtime never fetches.
 * Returns { removed, bytes }: entries deleted and their size.
 */
export function pruneShippedData(dataDir) {
  const tally = { removed: 0, bytes: 0 };
  if (!existsSync(dataDir)) return tally;

  for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
    if (entry.isDirectory() && SHIPPED_DATA_DIRS.has(entry.name)) continue;
    remove(join(dataDir, entry.name), tally);
  }

  const theaterDir = join(dataDir, 'theater');
  if (!existsSync(theaterDir)) return tally;
  const ids = manifestIds(theaterDir);
  if (ids === null) {
    // Without a manifest the site cannot render anything anyway (the deploy
    // workflow refuses to run in that state); don't guess which files matter.
    return tally;
  }
  for (const name of readdirSync(theaterDir)) {
    if (THEATER_SHARED_FILES.has(name)) continue;
    const suffix = THEATER_RUNTIME_SUFFIXES.find(s => name.endsWith(s));
    if (suffix && ids.has(name.slice(0, -suffix.length))) continue;
    remove(join(theaterDir, name), tally);
  }
  return tally;
}
