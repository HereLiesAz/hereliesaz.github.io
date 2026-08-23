// Read-modify-write helpers for the two hand-authored JSON files
// (painting metadata, site content) plus the painting-removal flow.
// Kept separate from github.js so that file stays a pure, generic API
// client with no knowledge of this site's specific file layout.
import { deleteFile, dispatchWorkflow, getFile, listWorkflowRuns, putFile, textToBase64 } from './github.js';

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

// GitHub Actions' `cancel-in-progress: false` concurrency (see
// remove_painting.yml) only reserves ONE queued run behind whatever's
// currently running — a THIRD dispatch while one is running and one is
// already queued doesn't queue behind it, it CANCELS the previously-queued
// run outright, without ever running its steps. Removing several paintings
// back to back (clicking "remove" every ~15-20s — a completely normal
// pace, far faster than a run's actual ~30-90s) silently dropped most of
// those removals this way: main's source photo + metadata were already
// gone, but art-data's baked files/manifest/hinge graph never got cleaned
// up for that id. This queue makes the CLIENT the serializer instead of
// relying on GitHub's concurrency group to queue an unbounded number of
// runs (it doesn't) — never more than one remove_painting.yml run is ever
// in flight from this client, and whatever piles up while one is running
// gets batched into a single `ids` dispatch instead of firing one per id.
let pendingRemovalIds = [];
let removalFlush = null;

const REMOVAL_POLL_MS = 5000;
// Generous — the workflow's own `timeout-minutes: 30` is the real ceiling.
// This just stops the UI from hanging silently forever if something is
// stuck well past that.
const REMOVAL_POLL_MAX_MS = 20 * 60 * 1000;

async function waitForNoActiveRemovalRun() {
  const deadline = Date.now() + REMOVAL_POLL_MAX_MS;
  for (;;) {
    const runs = await listWorkflowRuns('remove_painting.yml', 5);
    if (!runs.some(r => r.status !== 'completed')) return;
    if (Date.now() > deadline) {
      throw new Error('A previous removal run has been in progress for over 20 minutes — check the "Remove Painting" runs in the Actions tab before trying again.');
    }
    await new Promise(resolve => setTimeout(resolve, REMOVAL_POLL_MS));
  }
}

function flushRemovalQueue() {
  if (!removalFlush) {
    removalFlush = (async () => {
      try {
        await waitForNoActiveRemovalRun();
        while (pendingRemovalIds.length > 0) {
          const batch = pendingRemovalIds;
          pendingRemovalIds = [];
          await dispatchWorkflow('remove_painting.yml', { ids: batch.join(',') });
          // Give GitHub a moment to actually register the new run as
          // queued/in_progress before re-checking — without this, the next
          // check could still see "nothing active" (the dispatch hasn't
          // shown up in the runs list yet) and let a second flush through
          // concurrently, recreating the exact race this exists to avoid.
          await new Promise(resolve => setTimeout(resolve, REMOVAL_POLL_MS));
          await waitForNoActiveRemovalRun();
        }
      } finally {
        removalFlush = null;
      }
    })();
  }
  return removalFlush;
}

/** Full removal: strip the two secondary things (source photo on main,
 * metadata entry) immediately and independently of each other — both are
 * idempotent, so retrying a partially-completed removal is always safe.
 * The actual remove_painting.yml dispatch (the part that makes the
 * painting disappear from the live site) is queued through
 * flushRemovalQueue() rather than fired directly, so a rapid string of
 * removals batches into as few workflow runs as GitHub's concurrency will
 * actually allow, instead of racing.
 *
 * getFile() already distinguishes "file doesn't exist" (returns null) from
 * a real error (throws) — do not wrap it in a blanket .catch(() => null)
 * here, or an expired token / rate limit / 5xx gets misread as "no source
 * photo to delete" and silently skipped. */
export async function removePainting(id) {
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

  pendingRemovalIds.push(id);
  let dispatched = false;
  try {
    await flushRemovalQueue();
    dispatched = true;
  } catch (e) {
    errors.push(`removal workflow dispatch: ${e.message}`);
  }

  if (errors.length) {
    const err = new Error(dispatched
      ? `Removal dispatched (the painting will still disappear from the site), but cleanup had errors — you may want to retry these by hand: ${errors.join('; ')}`
      : `Cleanup ran, but the removal workflow itself never dispatched — the painting is still fully live: ${errors.join('; ')}`);
    err.dispatched = dispatched;
    throw err;
  }
}

export { META_PATH, SITE_PATH };
