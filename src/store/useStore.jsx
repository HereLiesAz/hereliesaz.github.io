import { create } from 'zustand';
import * as THREE from 'three';

// Camera radius that reads a painting head-on. Matches TheaterPainting.jsx
// NULL_DISTANCE — both must agree so the null-sphere sits on the shell.
const NULL_DISTANCE = 11.0;

// The camera never gets closer to origin than this during the dive
// through the shared centre.
const DIVE_RADIUS   = 2.5;

// Nominal painting height in world units — matches TheaterPainting.jsx
// PAINTING_HEIGHT. Used to convert a hinge uv into a hinge world offset.
const PAINTING_HEIGHT = 10.0;

// Painting height * fitScale ≈ what the renderer actually draws. fitScale
// depends on FoV and viewport but is ~0.9 for the current setup. Undoing
// this in the store is imperfect but the hinge placement tolerates the
// few-percent error (the camera arc's dive hides the rest).
const FIT_SCALE = 0.9;

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
  const w = PAINTING_HEIGHT * aspect * FIT_SCALE;
  const h = PAINTING_HEIGHT * FIT_SCALE;
  return new THREE.Vector3(
    (uv[0] - 0.5) * w,
    (0.5 - uv[1]) * h,
    0,
  );
}

// Pick the outgoing edge from `srcId` to some target, weighted by weight.
// Falls back to a uniform-random target when no edges exist. Returns
// {edge, tid} or null if the graph has no other node.
function pickEdge(edges, nodes, srcId, avoidId) {
  const candidates = edges.filter(e =>
    e.source === srcId && e.target !== avoidId);
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
  const others = nodes.filter(n => n.id !== srcId && n.id !== avoidId);
  if (others.length === 0) return null;
  const target = others[Math.floor(Math.random() * others.length)].id;
  return { edge: { source: srcId, target, s_uv: [0.5, 0.5], t_uv: [0.5, 0.5] },
           tid: target };
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

// Position painting so its hinge (given uv, aspect) lands at world (0,0,0)
// after rotation. Returns {position:[x,y,z], rotation:[degx,degy,degz]}.
function placeAtHinge(uv, aspect, quaternion) {
  const hingeLocal = uvToLocal(uv, aspect);
  // World hinge = rotation * hingeLocal + position. Force to 0.
  const worldHinge = hingeLocal.clone().applyQuaternion(quaternion);
  const position = worldHinge.clone().negate();
  return {
    position: [position.x, position.y, position.z],
    rotation: quatToEulerDeg(quaternion),
  };
}

// Sample points along an arc that:
//  - starts at start, ends at end
//  - dips toward origin (radius shrinks to DIVE_RADIUS at t=0.5)
//  - rotates through space so it doesn't cut straight through origin
function orbitPath(start, end, samples = 5) {
  const dir0 = start.clone().normalize();
  const dir1 = end.clone().normalize();
  const R0 = start.length();
  const R1 = end.length();

  const path = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const dir = dir0.clone().lerp(dir1, t).normalize();
    const rOut = t < 0.5
      ? THREE.MathUtils.lerp(R0, DIVE_RADIUS,
          THREE.MathUtils.smoothstep(t, 0, 0.5))
      : THREE.MathUtils.lerp(DIVE_RADIUS, R1,
          THREE.MathUtils.smoothstep(t, 0.5, 1));
    path.push(dir.multiplyScalar(rOut));
  }
  return path;
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
  transitionProgress: 0,
  isTransitioning: false,

  showMenu: false,

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
    const node = nodes.find(n => n.id === id);
    const aspect = (node?.width && node?.height)
      ? node.width / node.height : 1.0;

    const picked = pickEdge(edges, nodes, id, null);
    const s_uv = picked?.edge?.s_uv || [0.5, 0.5];
    const identity = new THREE.Quaternion();

    const { position, rotation } = placeAtHinge(s_uv, aspect, identity);
    const firstCluster = {
      id,
      position,
      rotation,
      quat: [identity.x, identity.y, identity.z, identity.w],
      image: node?.image,
      hingeUvOut: s_uv,
    };
    set({
      activeClusters: [firstCluster],
      currentNodeId: id,
      segments: [],
      currentSegmentIndex: 0,
    });
    get().buildNextSegment();
  },

  setCurrentResolution: (res) => set({ currentResolution: res }),
  setCurrentShardCount: (count) => set({ currentShardCount: count }),

  // Build the next segment. Painting B is placed so its incoming hinge
  // patch (t_uv on the chosen edge) lands at world origin — the same
  // spot A's outgoing s_uv already occupies. Rotation R_B = R_A · RotY(θ_edge).
  //
  // The camera arcs on the sphere of radius NULL_DISTANCE around origin,
  // from A's viewing null (R_A · (0,0,NULL_DISTANCE)) to B's viewing null.
  // Look target: world origin throughout. Result: the shared patch
  // sits fixed at screen centre for the whole segment; A dissolves and
  // B emerges around it.
  buildNextSegment: () => {
    const { nodes, edges, activeClusters, segments } = get();
    if (activeClusters.length === 0) return;

    const current = activeClusters[activeClusters.length - 1];
    const avoidId = segments.length > 0
      ? segments[segments.length - 1].startId : null;

    // If setStartNode already picked an edge for A's outgoing hinge, use
    // the same edge if possible (so the placement is consistent).
    let edge, tid;
    if (current.hingeUvOut && segments.length === 0) {
      const cand = edges.filter(e =>
        e.source === current.id &&
        e.s_uv?.[0] === current.hingeUvOut[0] &&
        e.s_uv?.[1] === current.hingeUvOut[1] &&
        e.target !== avoidId);
      if (cand.length > 0) { edge = cand[0]; tid = edge.target; }
    }
    if (!edge) {
      const picked = pickEdge(edges, nodes, current.id, avoidId);
      if (!picked) return;
      edge = picked.edge;
      tid = picked.tid;
    }

    const nextNode = nodes.find(n => n.id === tid);
    const aAspect = getAspect(nodes, current.id);
    const bAspect = getAspect(nodes, tid);

    const qA = new THREE.Quaternion(...(current.quat || [0, 0, 0, 1]));
    const theta = edgeRotY(current.id, tid);
    const qEdge = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), theta);
    const qB = qA.clone().multiply(qEdge);

    // Painting A stays where it is (placed by the previous segment's
    // target step, or by setStartNode). Painting B: place at hinge.
    const { position: bPos, rotation: bRot } = placeAtHinge(
      edge.t_uv || [0.5, 0.5], bAspect, qB);

    const nextCluster = {
      id: tid,
      position: bPos,
      rotation: bRot,
      quat: [qB.x, qB.y, qB.z, qB.w],
      image: nextNode?.image,
      hingeUvOut: null,
    };

    // Camera path: sphere of radius NULL_DISTANCE around origin. Start
    // at A's viewing null, end at B's viewing null. Both viewing nulls
    // are the "front" of each painting projected out along its local +Z.
    const startPoint = new THREE.Vector3(0, 0, NULL_DISTANCE)
      .applyQuaternion(qA);
    const endPoint   = new THREE.Vector3(0, 0, NULL_DISTANCE)
      .applyQuaternion(qB);
    const focus      = new THREE.Vector3(0, 0, 0);

    const path = orbitPath(startPoint, endPoint, 5);

    const newSegment = {
      path,
      startId: current.id,
      endId: tid,
      focus,
      startLook: focus.clone(),
      endLook: focus.clone(),
    };

    set({
      activeClusters: [...activeClusters, nextCluster],
      segments: [...segments, newSegment],
    });

    console.log(`[Store] Segment ${segments.length} Appended: ${current.id} -> ${tid} (θ=${(theta*180/Math.PI).toFixed(1)}°)`);
  },

  completeTransition: () => {
    const { segments, currentSegmentIndex } = get();
    if (currentSegmentIndex < segments.length - 1) {
      set({ currentSegmentIndex: currentSegmentIndex + 1 });
    }
    if (segments.length < currentSegmentIndex + 3) {
      get().buildNextSegment();
    }
  },

  backtrackTo: (segmentIndex) => {
    if (segmentIndex < 0) return;
    const { segments } = get();
    if (segmentIndex >= segments.length) return;
    set({ currentSegmentIndex: segmentIndex });
  },

  goBackward: () => false,

  setTransitionProgress: (val) => set({
    transitionProgress: val,
    isTransitioning: val > 0.01 && val < 0.99,
  }),
  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
}));

function getAspect(nodes, id) {
  const n = nodes.find(x => x.id === id);
  return (n?.width && n?.height) ? n.width / n.height : 1.0;
}

export { useStore };
export default useStore;
