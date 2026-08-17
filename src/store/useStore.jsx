import { create } from 'zustand';
import * as THREE from 'three';
import { NULL_DISTANCE, PAINTING_HEIGHT, CAMERA_FOV_DEG } from '../sceneConstants';

// How far off the painting's normal the null viewpoint sits, as a
// fraction of NULL_DISTANCE. Nonzero so the flats NEVER fully close up:
// even at coalescence there's a whisper of parallax — the painting is
// never shown as the flat original.
// Off-axis fraction of the null viewpoint. This is what keeps the
// painting from EVER re-closing perfectly flat — but it also sets how
// far the depth bands slide apart at the null, so it must stay a
// whisper: enough that the flats never quite click shut, not so much
// that the flat background regions visibly separate into panels. The
// big shard explosion during a transition comes from the camera's full
// swing off the axis, not from this, so shrinking it doesn't cost drama.
const OFF_AXIS = 0.045;

// Reproduces TheaterPainting.jsx's fitScale useMemo EXACTLY (same
// NULL_DISTANCE, same FOV, same 0.85/0.90 fit margins, same
// Math.min(widthScale, heightScale)) for the standard (non-light-bg) case,
// so a painting's hinge patch lands in world space at the precise point
// the renderer will actually draw it — not an approximated constant. A
// mismatched scale here was why coalescence never quite aligned: the store
// previously assumed a flat FIT_SCALE=0.9 regardless of the painting's
// aspect ratio or the viewport's actual size, while the renderer computed
// its real fit per painting and per viewport — the two diverged by however
// far 0.9 was from the true value for that specific pairing.
//
// One known residual gap: light-background ("paper") pieces get an
// additional LIGHT_BG_OVERFILL factor in TheaterPainting.jsx, decided by
// an async runtime sample of the loaded texture (bgInfo.light) — a signal
// the store can't see this far ahead of mount. Those pieces will still
// drift slightly until that flag is baked into the graph data at bake time
// instead of detected at render time (a change already planned separately
// for the light/dark auto-detection's reliability in general).
function computeFitScale(aspect) {
  const paintingWidth  = PAINTING_HEIGHT * aspect;
  const paintingHeight = PAINTING_HEIGHT;
  const vFov = THREE.MathUtils.degToRad(CAMERA_FOV_DEG);
  const visibleHeight = 2.0 * NULL_DISTANCE * Math.tan(vFov / 2.0);
  const vw = (typeof window !== 'undefined' && window.innerWidth)  || 1;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 1;
  const visibleWidth = visibleHeight * (vw / vh);
  const widthScale  = (visibleWidth  * 0.85) / paintingWidth;
  const heightScale = (visibleHeight * 0.90) / paintingHeight;
  return Math.min(widthScale, heightScale);
}

// FNV-1a-ish hash — stable per-string. Used for the per-edge rotation
// angle around Y, so consecutive paintings differ visibly but the
// choice is stable across reloads.
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function rand01(hash, salt) {
  const x = Math.imul(hash ^ salt, 2654435761) >>> 0;
  return (x >>> 0) / 4294967296;
}

// Convert an edge's uv (u right, v down) to the painting's local xy at
// the nominal painting height * fitScale. Local z = 0 because the hinge
// sits on the origin-plane backdrop.
function uvToLocal(uv, aspect) {
  const s = computeFitScale(aspect);
  const w = PAINTING_HEIGHT * aspect * s;
  const h = PAINTING_HEIGHT * s;
  return new THREE.Vector3(
    (uv[0] - 0.5) * w,
    (0.5 - uv[1]) * h,
    0,
  );
}

// Small rolling-history length used to steer the walk away from short
// backtracking cycles (see pickEdge/pickPrevEdge below).
const HISTORY_LEN = 5;

// Pick the outgoing edge from `srcId` to some target, weighted by weight.
// Falls back to a uniform-random target when no edges exist. Always
// rejects self-loops (e.target === srcId) defensively, even though the
// current baked graph doesn't contain any — two simultaneously-mounted
// TheaterPainting instances must never be asked to share an id.
// `avoidIds` is a small rolling history of recently-visited node ids
// (see HISTORY_LEN) filtered out of the candidate set to discourage
// short revisit cycles; if that would leave zero candidates the filter
// is relaxed (self-loops stay rejected) so a pick is always produced
// when any non-self target exists. Returns {edge, tid} or null only
// when the graph truly has no other node to go to (<=1 node).
function pickEdge(edges, nodes, srcId, avoidIds) {
  const avoid = new Set(Array.isArray(avoidIds) ? avoidIds
    : (avoidIds != null ? [avoidIds] : []));
  const notSelf = e => e.source === srcId && e.target !== srcId;
  let candidates = edges.filter(e => notSelf(e) && !avoid.has(e.target));
  if (candidates.length === 0) candidates = edges.filter(notSelf);
  if (candidates.length > 0) {
    const totalW = candidates.reduce((s, e) => s + (e.weight || 1), 0);
    let r = Math.random() * totalW;
    for (const e of candidates) {
      r -= (e.weight || 1);
      if (r <= 0) return { edge: e, tid: e.target };
    }
    return { edge: candidates[candidates.length - 1],
             tid: candidates[candidates.length - 1].target };
  }
  let others = nodes.filter(n => n.id !== srcId && !avoid.has(n.id));
  if (others.length === 0) others = nodes.filter(n => n.id !== srcId);
  if (others.length === 0) return null;
  const target = others[Math.floor(Math.random() * others.length)].id;
  return { edge: { source: srcId, target, s_uv: [0.5, 0.5], t_uv: [0.5, 0.5] },
           tid: target };
}

// Pick a PREDECESSOR of `tgtId` — a painting that flows INTO it — for
// building the backward buffer (the paintings you can scroll up into
// from the start). Weighted by edge weight; uniform-random fallback.
// Same self-loop guard and rolling-history relaxation as pickEdge.
// Returns {sid} or null only when the graph has no other node.
function pickPrevEdge(edges, nodes, tgtId, avoidIds) {
  const avoid = new Set(Array.isArray(avoidIds) ? avoidIds
    : (avoidIds != null ? [avoidIds] : []));
  const notSelf = e => e.target === tgtId && e.source !== tgtId;
  let candidates = edges.filter(e => notSelf(e) && !avoid.has(e.source));
  if (candidates.length === 0) candidates = edges.filter(notSelf);
  if (candidates.length > 0) {
    const totalW = candidates.reduce((s, e) => s + (e.weight || 1), 0);
    let r = Math.random() * totalW;
    for (const e of candidates) {
      r -= (e.weight || 1);
      if (r <= 0) return { sid: e.source };
    }
    return { sid: candidates[candidates.length - 1].source };
  }
  let others = nodes.filter(n => n.id !== tgtId && !avoid.has(n.id));
  if (others.length === 0) others = nodes.filter(n => n.id !== tgtId);
  if (others.length === 0) return null;
  return { sid: others[Math.floor(Math.random() * others.length)].id };
}

// A stable per-edge rotation angle around world Y in [+MIN_A, +MAX_A]
// with a hash-derived sign. Consecutive paintings get a visible tilt
// but the choice is stable across reloads.
const MIN_A = Math.PI / 6;   // 30°
const MAX_A = Math.PI / 2;   // 90°
function edgeRotY(srcId, tid) {
  const h = hashStr(`${srcId}->${tid}`);
  const angle = MIN_A + rand01(h, 0x9e3779b9) * (MAX_A - MIN_A);
  const sign  = rand01(h, 0x85ebca6b) < 0.5 ? -1 : +1;
  return sign * angle;
}

// Convert a THREE.Quaternion to Euler XYZ degrees. Stored on the cluster
// because <TheaterPainting rotation={[x,y,z]}/> takes euler degrees.
function quatToEulerDeg(q) {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [
    THREE.MathUtils.radToDeg(e.x),
    THREE.MathUtils.radToDeg(e.y),
    THREE.MathUtils.radToDeg(e.z),
  ];
}

// Position painting so its hinge (given uv, aspect) lands at `world`
// after rotation. World hinge = rotation·hingeLocal + position, so
// position = world − rotation·hingeLocal. Returns
// {position:[x,y,z], rotation:[degx,degy,degz]}.
function placeAtHingeWorld(uv, aspect, quaternion, world) {
  const hingeLocal = uvToLocal(uv, aspect).applyQuaternion(quaternion);
  const position = world.clone().sub(hingeLocal);
  return {
    position: [position.x, position.y, position.z],
    rotation: quatToEulerDeg(quaternion),
  };
}

// World-space location of a painting's hinge patch, given the painting's
// world position, rotation, the patch uv, and aspect.
function hingeWorld(positionArr, quaternion, uv, aspect) {
  const p = new THREE.Vector3(
    positionArr[0] || 0, positionArr[1] || 0, positionArr[2] || 0);
  return p.add(uvToLocal(uv, aspect).applyQuaternion(quaternion));
}

// A stable per-painting lateral direction for the off-axis null offset,
// in the painting's local frame (unit xy vector, z=0). Hash-derived so
// the same painting always reads from the same slightly-skewed vantage,
// including when it is segment N's end and segment N+1's start.
function nullOffsetLocal(id) {
  const phi = rand01(hashStr(id), 0xc2b2ae35) * Math.PI * 2;
  // Damp the vertical component so the skew reads as a natural standing
  // viewpoint, not craning above / crouching below the painting.
  return new THREE.Vector3(Math.cos(phi), Math.sin(phi) * 0.4, 0)
    .normalize().multiplyScalar(NULL_DISTANCE * OFF_AXIS);
}

// Dolly path from A's null (`start`) to B's null (`end`), diving THROUGH
// the shared hinge patch at `hinge` on the way. NOT an orbit around a
// centre: the camera travels the straight null-to-null line but is
// pulled toward the hinge in the middle of the segment, so mid-transit
// it is deep inside the shard cloud right at the fulcrum — the zoom
// into-and-through-the-shards moment. Because consecutive paintings
// share that hinge point (and only that point) the camera passing
// through it reads as one continuous move, not a cut.
function divePath(start, end, hinge, samples = 11) {
  const path = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    // Straight null-to-null baseline.
    const base = start.clone().lerp(end, t);
    // Hump peaking at mid-segment pulls the path onto the hinge, so the
    // camera dives in and back out rather than sliding past.
    const hump = Math.sin(Math.PI * t);
    const pull = Math.pow(hump, 1.4);
    path.push(base.lerp(hinge, pull));
  }
  return path;
}

// Given the already-placed cluster A, a target id, and the edge connecting
// them, compute B's placement (position/rotation/quat) and the A->B camera
// segment (dive path/focus/look targets). Pulled out of buildNextSegment so
// recomputePlacements (below) can replay the exact same math against a
// fresh fitScale after a resize, without the two ever drifting apart from
// hand-duplicated copies of this logic.
function computeSegmentPlacement(current, tid, edge, nodes) {
  const nextNode = nodes.find(n => n.id === tid);
  const aAspect = getAspect(nodes, current.id);
  const bAspect = getAspect(nodes, tid);

  const qA = new THREE.Quaternion(...(current.quat || [0, 0, 0, 1]));
  const theta = edgeRotY(current.id, tid);
  const qEdge = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), theta);
  // Multiply then strip any accumulated X/Z tilt — paintings must be
  // upright at coalescence. Extract only the Y rotation.
  const qBraw = qA.clone().multiply(qEdge);
  const yAngle = new THREE.Euler().setFromQuaternion(qBraw, 'YXZ').y;
  const qB = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), yAngle);

  // The shared hinge for THIS segment is the world location of A's
  // OUTGOING patch (edge.s_uv) — wherever A already put it. Painting B is
  // placed so its INCOMING patch (edge.t_uv) lands on that same world
  // point, so A and B share exactly one point (the fulcrum) and diverge
  // in space everywhere else.
  const aSuv = edge.s_uv || [0.5, 0.5];
  const H = hingeWorld(current.position, qA, aSuv, aAspect);

  const { position: bPos, rotation: bRot } = placeAtHingeWorld(
    edge.t_uv || [0.5, 0.5], bAspect, qB, H);

  const nextCluster = {
    id: tid,
    position: bPos,
    rotation: bRot,
    quat: [qB.x, qB.y, qB.z, qB.w],
    image: nextNode?.image,
    hingeUvOut: null,
  };

  // Camera path. At r=0 the camera reads painting A from its null: on A's
  // normal, offset from A's plane centre by NULL_DISTANCE, then skewed
  // sideways by the painting's stable off-axis offset. At r=1 the same for
  // B. Between them the path dollies IN toward the shared hinge H and back
  // OUT, rather than orbiting.
  const aPosVec = new THREE.Vector3(
    current.position[0], current.position[1], current.position[2]);
  const aNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(qA);
  const startPoint = aPosVec.clone()
    .addScaledVector(aNormal, NULL_DISTANCE)
    .add(nullOffsetLocal(current.id).applyQuaternion(qA));

  const bPosVec = new THREE.Vector3(bPos[0], bPos[1], bPos[2]);
  const bNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(qB);
  const endPoint = bPosVec.clone()
    .addScaledVector(bNormal, NULL_DISTANCE)
    .add(nullOffsetLocal(tid).applyQuaternion(qB));

  const focus = H.clone();
  const avgNormal = aNormal.clone().add(bNormal).normalize();
  const diveTarget = H.clone().addScaledVector(avgNormal, 3.2);

  const startLook = aPosVec.clone();
  const endLook   = bPosVec.clone();

  const path = divePath(startPoint, endPoint, diveTarget, 11);

  const newSegment = {
    path,
    startId: current.id,
    endId: tid,
    focus,
    startLook,
    endLook,
    // Fulcrum patch uvs: the outgoing painting's matched patch (sUv) and
    // the incoming painting's matched patch (tUv).
    sUv: aSuv,
    tUv: edge.t_uv || [0.5, 0.5],
    // pareidolia_index.py bakes the matched patch's real edge length (as a
    // fraction of the painting's min dimension) per edge — pass it through
    // so the fulcrum-reveal circle's radius reflects the actual match size
    // instead of a fixed guess. Null for edges without one, so the
    // renderer can fall back to its own default.
    patchScale: typeof edge.scale === 'number' ? edge.scale : null,
  };

  return { nextCluster, newSegment };
}

const useStore = create((set, get) => ({
  // --- STATE ---
  nodes: [],
  edges: [],

  activeClusters: [],   // [{ id, position, rotation, quat, image }]
  segments: [],         // [{ path, startId, endId, focus, startLook, endLook }]
  history: [],

  currentNodeId: null,
  currentShardCount: 0,
  currentResolution: [1000, 1000],

  currentSegmentIndex: 0,
  // Which segment the viewer opens on. The backward buffer means the
  // start painting isn't segment 0 — there are paintings before it to
  // scroll up into — so the camera positions the initial scroll here.
  startSegmentIndex: 0,
  transitionProgress: 0,
  isTransitioning: false,

  showMenu: false,

  // Set by Scene when BOTH the theater manifest and the legacy graph.json
  // fallback fail to produce any nodes, so the UI has something to react
  // to instead of silently staying on a permanent black screen. Null
  // means no load error. See Overlay's loadError rendering.
  loadError: null,
  setLoadError: (msg) => set({ loadError: msg }),

  setGraph: (graphData) => {
    if (!graphData) return;
    set({
      nodes: Array.isArray(graphData.nodes) ? graphData.nodes : [],
      edges: Array.isArray(graphData.edges) ? graphData.edges : [],
    });
  },

  // Initial state: the first painting is placed so its outgoing hinge
  // (from the first edge we'd traverse) lands at world origin, with
  // rotation = identity. Camera starts at (0, 0, NULL_DISTANCE).
  //
  // Doing it this way means when buildNextSegment runs immediately, A is
  // already correctly placed for that segment — no snap.
  setStartNode: (id) => {
    console.log("[Store] Starting at:", id);
    const { nodes, edges } = get();

    // Build a BACKWARD BUFFER: a chain of paintings that flow INTO the
    // chosen start, so on open the viewer can scroll UP into them rather
    // than hitting a wall at the top. These are ordinary forward segments
    // — we just anchor the chain a few paintings earlier and begin
    // viewing partway in, so the fade/keys behave exactly as normal.
    const BACK = 4;
    const chain = [id];         // oldest → … → start
    let cursor = id;
    for (let k = 0; k < BACK; k++) {
      // Rolling history (most-recently-added first) instead of a single
      // one-hop avoid, so the backward buffer doesn't loop through a
      // short cycle on graphs where that's possible.
      const recentIds = chain.slice(0, HISTORY_LEN);
      const prev = pickPrevEdge(edges, nodes, cursor, recentIds);
      if (!prev) break;
      chain.unshift(prev.sid);
      cursor = prev.sid;
    }
    const rootId = chain[0];
    const rootNode = nodes.find(n => n.id === rootId);
    const rootAspect = (rootNode?.width && rootNode?.height)
      ? rootNode.width / rootNode.height : 1.0;
    const rootSuv = pickEdge(edges, nodes, rootId, null)?.edge?.s_uv || [0.5, 0.5];
    const identity = new THREE.Quaternion();

    // The chain's oldest painting anchors the world origin.
    const { position, rotation } = placeAtHingeWorld(
      rootSuv, rootAspect, identity, new THREE.Vector3(0, 0, 0));
    const firstCluster = {
      id: rootId,
      position,
      rotation,
      quat: [identity.x, identity.y, identity.z, identity.w],
      image: rootNode?.image,
      hingeUvOut: rootSuv,
    };
    set({
      activeClusters: [firstCluster],
      currentNodeId: rootId,
      segments: [],
      currentSegmentIndex: 0,
      startSegmentIndex: 0,
    });
    // March forward through the buffer chain to the chosen start painting.
    for (let k = 1; k < chain.length; k++) {
      get().buildNextSegment(chain[k]);
    }
    // The chosen start is now segment index chain.length-1. Begin there,
    // and build a couple ahead so forward scrolling has content.
    const startIdx = chain.length - 1;
    set({ currentNodeId: id, currentSegmentIndex: startIdx, startSegmentIndex: startIdx });
    // Build the full forward warm-window (TexturePreloader.AHEAD = 3) so the
    // preloader can warm textures three segments out from the very first frame,
    // not just one.
    for (let i = 0; i < 3; i++) {
      get().buildNextSegment();
    }
  },

  setCurrentResolution: (res) => set({ currentResolution: res }),
  setCurrentShardCount: (count) => set({ currentShardCount: count }),

  // Build the next segment. The shared hinge marches down the chain:
  // painting B is placed so its incoming patch (t_uv) lands on the world
  // location of A's outgoing patch (s_uv), wherever A already put it —
  // NOT the origin. So A and B touch at exactly one point and spread
  // apart everywhere else; the whole gallery unrolls through space
  // rather than piling up at one spot. Rotation R_B = the yaw of
  // R_A · RotY(θ_edge) — Y-only, so B is upright at coalescence.
  //
  // The camera dollies from A's null straight through the hinge to B's
  // null (see divePath). The shared patch is what the viewer is drawn
  // into; A dissolves around it on the way in, B coalesces around it
  // on the way out. The transition itself should be imperceptible.
  // `forcedTid` pins the next painting (used to pre-build the backward
  // buffer through a specific ancestor chain); otherwise the target is
  // picked from the hinge graph as usual.
  buildNextSegment: (forcedTid = null) => {
    const { nodes, edges, activeClusters, segments } = get();
    if (activeClusters.length === 0) return;

    const current = activeClusters[activeClusters.length - 1];
    // Rolling history of recently-visited node ids (most-recent last),
    // used to steer the walk away from short revisit cycles — widened
    // from a single one-hop avoid (see pickEdge).
    const recentIds = activeClusters.slice(-HISTORY_LEN).map(c => c.id);

    let edge, tid;
    if (forcedTid) {
      // Use the real edge current→forcedTid if the graph has one, else a
      // centred stand-in so placement still works.
      edge = edges.find(e => e.source === current.id && e.target === forcedTid)
          || { source: current.id, target: forcedTid, s_uv: [0.5, 0.5], t_uv: [0.5, 0.5] };
      tid = forcedTid;
    }
    // If setStartNode already picked an edge for A's outgoing hinge, use
    // the same edge if possible (so the placement is consistent).
    if (!edge && current.hingeUvOut && segments.length === 0) {
      const cand = edges.filter(e =>
        e.source === current.id &&
        e.target !== current.id &&
        e.s_uv?.[0] === current.hingeUvOut[0] &&
        e.s_uv?.[1] === current.hingeUvOut[1] &&
        !recentIds.includes(e.target));
      if (cand.length > 0) { edge = cand[0]; tid = edge.target; }
    }
    if (!edge) {
      const picked = pickEdge(edges, nodes, current.id, recentIds);
      if (picked) {
        edge = picked.edge;
        tid = picked.tid;
      } else {
        // Degenerate case: the graph has no other node to connect to
        // (<=1 node total). Build a self-referential segment that frames
        // the same painting at both ends rather than bailing out with
        // zero segments — that would leave the camera glued to Scene's
        // hardcoded world-origin placeholder for the whole session even
        // though a painting is on screen. Currently unreachable with the
        // real 40-node graph.
        edge = {
          source: current.id, target: current.id,
          s_uv: current.hingeUvOut || [0.5, 0.5],
          t_uv: current.hingeUvOut || [0.5, 0.5],
        };
        tid = current.id;
      }
    }

    const { nextCluster, newSegment } = computeSegmentPlacement(current, tid, edge, nodes);

    set({
      activeClusters: [...activeClusters, nextCluster],
      segments: [...segments, newSegment],
    });
  },

  // Bumped every time recomputePlacements (below) rewrites the world-space
  // chain, so consumers that cache anything derived from a segment's path
  // (AnamorphicCam's CatmullRomCurve3) know to rebuild it even when the
  // segment INDEX they're looking at hasn't changed.
  placementGeneration: 0,

  // computeFitScale (via uvToLocal) reads window.innerWidth/innerHeight at
  // the moment a segment is built, but TheaterPainting's own fitScale is a
  // live useMemo reacting to the real, current R3F canvas size. A window
  // resize between building a segment and the camera actually reaching it
  // — or even just a resize while a segment is currently on screen — means
  // the world coordinates baked into activeClusters/segments no longer
  // match where the renderer will actually draw that painting. Re-derives
  // the ENTIRE chain from the root using the CURRENT fitScale, replaying
  // the exact same sequence of painting ids and hinge edges already chosen
  // (from each segment's own stored sUv/tUv) — nothing about the walk
  // itself changes, only the scale-dependent world coordinates.
  recomputePlacements: () => {
    const { activeClusters, segments, nodes } = get();
    if (activeClusters.length === 0) return;

    const root = activeClusters[0];
    const rootAspect = getAspect(nodes, root.id);
    const identity = new THREE.Quaternion();
    const rootSuv = root.hingeUvOut || [0.5, 0.5];
    const { position: rootPos, rotation: rootRot } = placeAtHingeWorld(
      rootSuv, rootAspect, identity, new THREE.Vector3(0, 0, 0));

    const newClusters = [{
      ...root,
      position: rootPos,
      rotation: rootRot,
      quat: [identity.x, identity.y, identity.z, identity.w],
    }];
    const newSegments = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const current = newClusters[i];
      const tid = activeClusters[i + 1]?.id;
      if (!tid) break;
      const edge = { source: current.id, target: tid, s_uv: seg.sUv, t_uv: seg.tUv, scale: seg.patchScale };
      const { nextCluster, newSegment } = computeSegmentPlacement(current, tid, edge, nodes);
      newClusters.push(nextCluster);
      newSegments.push(newSegment);
    }

    set(state => ({
      activeClusters: newClusters,
      segments: newSegments,
      placementGeneration: state.placementGeneration + 1,
    }));
  },

  // Atomic per-frame update: AnamorphicCam calls this ONCE per frame with
  // both the eased transition progress and the segment index the scroll
  // currently resolves to. Combining them into a single `set()` (rather
  // than a setTransitionProgress() call followed by a conditional
  // backtrackTo() call) means any subscriber — in particular Overlay's
  // raw useStore.subscribe(), which fires synchronously on every
  // individual set() and isn't batched the way the React useStore(selector)
  // hook is — can never observe a fresh transitionProgress paired with a
  // stale currentSegmentIndex (or vice versa).
  updateFrame: (segmentIndex, r) => set({
    currentSegmentIndex: segmentIndex,
    transitionProgress: r,
    isTransitioning: r > 0.01 && r < 0.99,
  }),

  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
}));

function getAspect(nodes, id) {
  const n = nodes.find(x => x.id === id);
  return (n?.width && n?.height) ? n.width / n.height : 1.0;
}

export { useStore };
export default useStore;
