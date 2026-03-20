export const SEGMENT_LENGTH = 200.0;
export const WORLD_HEIGHT   = 10.0;
export const FOV_DEG        = 50.0;
export const MAX_PER_SLOT   = 6000;
export const MAX_INSTANCES  = 12000;
export const FOCUS_WINDOW   = 60.0;
export const PRELOAD_T      = 0.6;
export const RECENT_EXCLUDE = 5;

/**
 * t ∈ [0, 1] measures progress from sweetZ toward the next sweet spot.
 * Increases as camera moves into negative Z.
 */
export function computeT({ sweetZ, cameraZ, segmentLength = SEGMENT_LENGTH }) {
  return (sweetZ - cameraZ) / segmentLength;
}

/**
 * Pick the next node id from the graph, weighted by edge similarity.
 * Excludes recently visited nodes; falls back to any reachable node.
 */
export function pickNextNode(currentId, edges, recentIds) {
  const candidates = edges.filter(
    e => e.source === currentId && !recentIds.includes(e.target)
  );

  if (candidates.length === 0) {
    // Fallback: use any outgoing edge ignoring exclusion
    const fallback = edges.filter(e => e.source === currentId);
    if (fallback.length === 0) throw new Error(`No edges from node: ${currentId}`);
    return fallback[Math.floor(Math.random() * fallback.length)].target;
  }

  // Weighted random selection by edge weight
  const totalWeight = candidates.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * totalWeight;
  for (const edge of candidates) {
    r -= edge.weight;
    if (r <= 0) return edge.target;
  }
  return candidates[candidates.length - 1].target;
}

/**
 * Compute the spline mid-point from pareidolia anchor UVs.
 * The mid-point is placed in the world at the spatial overlap zone.
 */
export function computeAnchorMidpoint(edge, nodeA, nodeB, segmentLength) {
  const wh = WORLD_HEIGHT;
  const aspectA = (nodeA.res?.[0] || 1000) / (nodeA.res?.[1] || 1000);
  const aspectB = (nodeB.res?.[0] || 1000) / (nodeB.res?.[1] || 1000);

  const sweetZA = nodeA.sweetZ;
  const sweetZB = nodeB.sweetZ;
  const midZ    = (sweetZA + sweetZB) / 2.0;

  const [su, sv] = edge.s_uv;
  const [tu, tv] = edge.t_uv;
  const midX = ((su - 0.5) * wh * aspectA + (tu - 0.5) * wh * aspectB) / 2.0;
  const midY = ((0.5 - sv) * wh + (0.5 - tv) * wh) / 2.0;

  return [midX, midY, midZ];
}

export function buildHistoryEntry({ id, sweetZ, splineStart, splineMid, splineEnd }) {
  return { id, sweetZ, splinePoints: [splineStart, splineMid, splineEnd] };
}