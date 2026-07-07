import { create } from 'zustand';
import * as THREE from 'three';

// Camera radius that reads a painting head-on. Matches TheaterPainting.jsx
// NULL_DISTANCE — both must agree so the null-sphere sits on the shell.
const NULL_DISTANCE = 11.0;

// The camera never gets closer to origin than this during the dive
// through the shared centre. Small enough that the camera is INSIDE the
// shard cloud (flats span ±5 around each painting plane) at the moment
// the path bends — the turn happens while immersed in abstract chaos,
// so the viewer can't perceive that the axis changed.
const DIVE_RADIUS   = 1.4;

// How far off the painting's normal the null viewpoint sits, as a
// fraction of NULL_DISTANCE. Nonzero so the flats NEVER fully close up:
// even at coalescence there's a whisper of parallax — the painting is
// never shown as the flat original.
const OFF_AXIS = 0.12;

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

// Dolly path: zoom IN along the incoming axis, through the shard cloud,
// and back OUT along the outgoing axis. NOT an orbit — the direction
// change is concentrated in t∈[0.35, 0.65], while the camera is at
// DIVE_RADIUS inside the cloud, where there is no legible geometry to
// betray that the axis is turning. Outside that band the camera moves
// on a straight radial line: a push into painting A's hinge patch, then
// a pull back that reveals painting B already coalescing.
function divePath(start, end, samples = 9) {
  const dir0 = start.clone().normalize();
  const dir1 = end.clone().normalize();
  const R0 = start.length();
  const R1 = end.length();

  const path = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const turn = THREE.MathUtils.smoothstep(t, 0.35, 0.65);
    const dir = dir0.clone().lerp(dir1, turn).normalize();
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
  // spot A's outgoing s_uv already occupies. Rotation R_B = the yaw of
  // R_A · RotY(θ_edge) — Y-only, so B is upright at coalescence.
  //
  // The camera dollies from A's null straight in toward the hinge,
  // bends while immersed at DIVE_RADIUS, and pulls back out to B's
  // null (see divePath). The shared patch is what the viewer is drawn
  // into; A dissolves around it on the way in, B coalesces around it
  // on the way out. The transition itself should be imperceptible.
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
    // Multiply then strip any accumulated X/Z tilt — paintings must be
    // upright at coalescence. Extract only the Y rotation.
    const qBraw = qA.clone().multiply(qEdge);
    const yAngle = new THREE.Euler().setFromQuaternion(qBraw, 'YXZ').y;
    const qB = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), yAngle);

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

    // Camera path.
    //
    // At r=0 the camera reads painting A from its null: on A's normal,
    // offset from A's plane centre by NULL_DISTANCE, then skewed
    // sideways by the painting's stable off-axis offset so the flats
    // never fully close up — the painting coalesces but is never shown
    // as the flat original. A's plane centre in world = current.position
    // (the group offset). A's normal in world = qA · (0,0,1).
    //
    // At r=1 the camera reads painting B the same way.
    //
    // Between them the path is a dolly, not an orbit: push IN toward
    // world origin (the hinge — a detail of A the viewer is drawn into),
    // bend while immersed in the shard cloud, pull back OUT along B's
    // axis. B has already been fading up through the chaos; backing out
    // simply lets it coalesce.
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

    // The hinge focus — where both paintings' shared patches actually
    // sit in world space, always the origin under this placement.
    const focus = new THREE.Vector3(0, 0, 0);

    // A's plane centre in world (used as look target at r=0). B's plane
    // centre (used at r=1). These are the painting positions — the group
    // offset was chosen so each painting's HINGE lands at origin, so the
    // painting's PLANE CENTRE is at −hingeLocal rotated into world, i.e.
    // cluster.position.
    const startLook = aPosVec.clone();
    const endLook   = bPosVec.clone();

    const path = divePath(startPoint, endPoint, 9);

    const newSegment = {
      path,
      startId: current.id,
      endId: tid,
      focus,
      startLook,
      endLook,
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
