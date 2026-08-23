// Shared by TheaterPainting.jsx (applies overrides before rendering) and
// the admin band editor (builds the preview list every band, hidden or
// not, so a hidden one can be un-hidden). Kept dependency-free (no THREE,
// no store) so it's trivially unit-testable and importable from either.

/** Folds hidden band indices out of `centers`/`edges`, extending
 * whichever kept band is immediately BEFORE a hidden one (or, if the
 * hidden band is first, whichever kept band comes after it) to cover the
 * hidden range — so removing a band from the render never leaves a gap:
 * every pixel that band used to claim lands in a still-visible neighbor
 * instead. The global [0, 1] extent is always preserved regardless of
 * which bands are hidden.
 *
 * `edges` has length `centers.length + 1` (edges[i]/edges[i+1] bound
 * band i) — see theater_baker.py's depth_bands_kmeans(). Hiding every
 * band is refused (falls back to the original, unmodified bands) rather
 * than producing a painting that can never appear. */
export function applyHiddenBands(edges, centers, hiddenIndices) {
  if (!Array.isArray(edges) || !Array.isArray(centers) || !hiddenIndices?.length) {
    return { edges, centers };
  }
  const hidden = new Set(hiddenIndices);
  const keepIdx = centers.map((_, i) => i).filter(i => !hidden.has(i));
  if (keepIdx.length === 0) return { edges, centers };

  const newCenters = keepIdx.map(i => centers[i]);
  const newEdges = [edges[0]];
  for (let k = 0; k < keepIdx.length - 1; k++) {
    newEdges.push(edges[keepIdx[k + 1]]);
  }
  newEdges.push(edges[edges.length - 1]);
  return { edges: newEdges, centers: newCenters };
}
