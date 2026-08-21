// Read-modify-write helpers for the two hand-authored JSON files
// (painting metadata, site content) plus the painting-removal flow.
// Kept separate from github.js so that file stays a pure, generic API
// client with no knowledge of this site's specific file layout.
import { deleteFile, dispatchWorkflow, getFile, putFile, textToBase64 } from './github.js';

// Deliberately NOT under public/assets/ — process_art.yml's legacy
// 56-shard grinder triggers on any push touching public/assets/**, and a
// metadata-only edit here has nothing to do with that pipeline.
const META_PATH = 'public/meta.json';
const SITE_PATH = 'public/site-content.json';

export async function loadMeta() {
  const file = await getFile(META_PATH);
  if (!file) return {};
  try { return JSON.parse(file.content); } catch { return {}; }
}

/** entry === null deletes that id's metadata entirely. Always re-reads
 * the file immediately before writing, so two edits in one session never
 * race on a stale sha. */
export async function saveMetaEntry(id, entry) {
  const file = await getFile(META_PATH);
  let meta = {};
  try { meta = file ? JSON.parse(file.content) : {}; } catch { meta = {}; }
  if (entry === null) delete meta[id];
  else meta[id] = entry;
  const body = JSON.stringify(meta, null, 2) + '\n';
  return putFile(META_PATH, textToBase64(body), `admin: update metadata for ${id}`, file?.sha);
}

export async function loadSiteContent() {
  const file = await getFile(SITE_PATH);
  if (!file) return null;
  try { return JSON.parse(file.content); } catch { return null; }
}

export async function saveSiteContent(content) {
  const file = await getFile(SITE_PATH);
  const body = JSON.stringify(content, null, 2) + '\n';
  return putFile(SITE_PATH, textToBase64(body), 'admin: update site content', file?.sha);
}

/** The public, unauthenticated view of what's baked — same files the
 * live site itself fetches, so this always matches reality with no
 * separate admin-only listing endpoint to keep in sync. */
export async function listBakedPaintings() {
  const res = await fetch('/data/theater/_manifest.json', { cache: 'no-store' });
  if (!res.ok) return [];
  const ids = await res.json();
  return Array.isArray(ids) ? ids : [];
}

export async function fetchTheaterMeta(id) {
  const res = await fetch(`/data/theater/${encodeURIComponent(id)}.theater.json`, { cache: 'no-store' });
  return res.ok ? res.json() : null;
}

/** Full removal: dispatch remove_painting.yml (cleans up the baked
 * artifacts + hinge graph on art-data — the part that actually makes the
 * painting disappear from the live site) FIRST, then attempt the two
 * secondary cleanup steps (delete the source photo from main, strip its
 * metadata entry) independently of each other. Ordering matters: if the
 * dispatch itself fails, nothing has changed yet, so the whole thing is
 * safely retryable. If a secondary step fails after a successful dispatch,
 * the real removal still proceeds — a stale source photo or metadata
 * entry is a nuisance, not a failed removal — and the failure is reported,
 * not swallowed, so it doesn't look like a clean success.
 *
 * getFile() already distinguishes "file doesn't exist" (returns null) from
 * a real error (throws) — do not wrap it in a blanket .catch(() => null)
 * here, or an expired token / rate limit / 5xx gets misread as "no source
 * photo to delete" and silently skipped. */
export async function removePainting(id) {
  await dispatchWorkflow('remove_painting.yml', { id });

  const errors = [];

  try {
    const theaterMeta = await fetchTheaterMeta(id).catch(() => null);
    const srcImage = theaterMeta?.src?.image;
    if (srcImage) {
      const path = `public/assets/${srcImage}`;
      const file = await getFile(path);
      // [skip-grind]: this is a real push to public/assets/**, which would
      // otherwise also kick off process_art.yml's 56-shard legacy grinder
      // for a file being deleted — see that workflow's job-level `if:`.
      if (file) await deleteFile(path, `admin: remove source photo for ${id} [skip-grind]`, file.sha);
    }
  } catch (e) {
    errors.push(`source photo: ${e.message}`);
  }

  try {
    await saveMetaEntry(id, null);
  } catch (e) {
    errors.push(`metadata: ${e.message}`);
  }

  if (errors.length) {
    const err = new Error(`Removal dispatched (the painting will still disappear from the site), but cleanup had errors — you may want to retry these by hand: ${errors.join('; ')}`);
    err.dispatched = true;
    throw err;
  }
}

export { META_PATH, SITE_PATH };
