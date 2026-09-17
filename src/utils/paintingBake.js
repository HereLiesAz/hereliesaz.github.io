const MANIFEST_URL = '/data/integrated/_manifest.json';

let manifestPromise = null;
const recordPromises = new Map();

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function loadPaintingBakeManifest() {
  if (!manifestPromise) {
    manifestPromise = fetchJson(MANIFEST_URL).catch((error) => {
      manifestPromise = null;
      throw error;
    });
  }
  return manifestPromise;
}

export async function loadPaintingBake(id) {
  if (!id) return null;
  const manifest = await loadPaintingBakeManifest();
  const entry = manifest.records?.find((item) => item.id === id);
  if (!entry?.record) return null;
  if (!recordPromises.has(id)) {
    recordPromises.set(
      id,
      fetchJson(entry.record).catch((error) => {
        recordPromises.delete(id);
        throw error;
      }),
    );
  }
  return recordPromises.get(id);
}

export function representationVariants(record, key) {
  const value = record?.representations?.[key];
  if (!value) return [];
  if (Array.isArray(value.variants)) return value.variants;
  return [value];
}

export function hasRepresentation(record, key) {
  return representationVariants(record, key).length > 0;
}

export function availableRepresentations(record) {
  return Object.keys(record?.representations || {}).filter((key) => key !== 'flatImage');
}

export function transitionEdges(record, graphKey) {
  const edges = record?.transitions?.[graphKey];
  return Array.isArray(edges) ? edges : [];
}

export function preferredRepresentation(record, preference = [
  'theater',
  'unifiedShardField',
  'perspectiveShardBake',
  'semanticShardCloud',
  'semanticLayers',
  'strokeCloud',
]) {
  for (const key of preference) {
    const variants = representationVariants(record, key);
    if (variants.length) return { key, value: variants[0], variants };
  }
  return null;
}

export function clearPaintingBakeCache() {
  manifestPromise = null;
  recordPromises.clear();
}
