// Read-modify-write helpers for the two hand-authored JSON files
// (painting metadata, site content) plus the painting-removal flow.
// Kept separate from github.js so that file stays a pure, generic API
// client with no knowledge of this site's specific file layout.
import { deleteFile, dispatchWorkflow, getFile, putFile, textToBase64 } from './github.js';

const META_PATH = 'public/assets/meta.json';
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

/** Full removal: delete the source photo from main (if we can find it —
 * a painting that failed to bake yet has no theater.json to read the
 * filename from, in which case this step is skipped rather than blocking
 * the rest of the cleanup), strip its metadata, then dispatch
 * remove_painting.yml to clean up the baked artifacts + hinge graph on
 * art-data. The workflow run is async — this only confirms dispatch, not
 * completion (see AdminApp's link to the Actions run). */
export async function removePainting(id) {
  const theaterMeta = await fetchTheaterMeta(id).catch(() => null);
  const srcImage = theaterMeta?.src?.image;
  if (srcImage) {
    const path = `public/assets/${srcImage}`;
    const file = await getFile(path).catch(() => null);
    if (file) await deleteFile(path, `admin: remove source photo for ${id}`, file.sha);
  }
  await saveMetaEntry(id, null);
  await dispatchWorkflow('remove_painting.yml', { id });
}

export { META_PATH, SITE_PATH };
