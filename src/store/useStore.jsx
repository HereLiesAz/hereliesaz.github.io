import { create } from 'zustand';
import * as THREE from 'three';

// Camera radius that reads a painting head-on. Matches TheaterPainting.jsx
// NULL_DISTANCE — both must agree so the null-sphere sits on the shell.
const NULL_DISTANCE = 11.0;

// The camera never gets closer to origin than this during the dive
// through the shared centre — deep enough to be "inside all the paintings
// at once", far enough not to end up beyond every flat.
const DIVE_RADIUS   = 2.5;

// FNV-1a-ish deterministic hash of a string — used to give each painting
// a stable per-id rotation + viewing direction across reloads.
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// Deterministic pseudorandom in [0, 1) seeded by a hash + salt.
function rand01(hash, salt) {
  const x = Math.imul(hash ^ salt, 2654435761) >>> 0;
  return (x >>> 0) / 4294967296;
}

// Distribute painting viewing directions on a sphere: for each painting
// id, pick a stable point on S^2 (Fibonacci-style via the golden angle
// applied to a per-id azimuth, plus a per-id polar). Guarantees adjacent
// paintings on the walker aren't accidentally colinear.
function viewDirForId(id) {
  const h = hashStr(id || 'anon');
  const phi = rand01(h, 0x9e3779b9) * Math.PI * 2;
  // Bias polar angle away from the poles so all paintings sit near the
  // equator — camera can then move sideways without ever pointing at the
  // sky. Range roughly [40°, 140°] from +Y.
  const cosTheta = (rand01(h, 0x85ebca6b) - 0.5) * 1.4;    // ~[-0.7, +0.7]
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  return new THREE.Vector3(
    sinTheta * Math.cos(phi),
    cosTheta,
    sinTheta * Math.sin(phi),
  );
}

// Given a viewing direction, build the euler rotation (deg) that makes
// a painting sitting at origin face that direction — i.e. its local +Z
// axis points TOWARD viewDir (so a camera sitting at viewDir·NULL sees
// the painting head-on). Roll is fixed to 0 (the painting's local +Y
// stays "as up as possible") plus a tiny per-id twist so consecutive
// paintings don't feel co-rotated.
function rotationForViewDir(viewDir, id) {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1), viewDir.clone().normalize());
  const roll = (rand01(hashStr(id || 'anon'), 0xdeadbeef) - 0.5) * 0.6;
  q.multiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), roll));
  const e = new THREE.Euler().setFromQuaternion(q);
  return [
    THREE.MathUtils.radToDeg(e.x),
    THREE.MathUtils.radToDeg(e.y),
    THREE.MathUtils.radToDeg(e.z),
  ];
}

const useStore = create((set, get) => ({
  // --- STATE ---
  nodes: [],
  edges: [],

  activeClusters: [],  // [{ id, worldPos, rotSway, viewDir, image }]
  segments: [],        // [{ path, startId, endId, focus, startLook, endLook, bank }]
  history: [],

  currentNodeId: null,
  currentShardCount: 0,
  currentResolution: [1000, 1000],

  currentSegmentIndex: 0,
  transitionProgress: 0,
  isTransitioning: false,

  // UI State
  showMenu: false,

  // --- ACTIONS ---
  setGraph: (graphData) => {
    if (!graphData) return;
    set({
      nodes: Array.isArray(graphData.nodes) ? graphData.nodes : [],
      edges: Array.isArray(graphData.edges) ? graphData.edges : [],
    });
  },

  setStartNode: (id) => {
    console.log("[Store] Starting at:", id);
    const { nodes } = get();
    const node = nodes.find(n => n.id === id);
    const viewDir = viewDirForId(id);
    const firstCluster = {
      id,
      worldPos: [0, 0, 0],                    // all paintings share origin
      rotSway: rotationForViewDir(viewDir, id),
      viewDir,
      image: node?.image,
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

  // Build the next step of the walk. All paintings sit at world origin
  // (rotated differently), so a segment is a camera path on the sphere
  // of radius NULL_DISTANCE that leaves painting A's ideal viewing point,
  // dives through the shared centre, and arrives at painting B's ideal
  // viewing point.
  buildNextSegment: () => {
    const { nodes, edges, activeClusters, segments } = get();
    if (activeClusters.length === 0) return;

    const current = activeClusters[activeClusters.length - 1];

    // 1. Pick next node — weighted by pareidolia edge strength if
    //    available; otherwise a uniform random non-self.
    const candidates = edges.filter(e => e.source === current.id);
    let edge;
    if (candidates.length > 0) {
      const totalW = candidates.reduce((s, e) => s + (e.weight || 1), 0);
      let r = Math.random() * totalW;
      edge = candidates[candidates.length - 1];
      for (const e of candidates) {
        r -= (e.weight || 1);
        if (r <= 0) { edge = e; break; }
      }
    } else {
      const others = nodes.filter(n => n.id !== current.id);
      if (others.length === 0) return;
      const randomTarget = others[Math.floor(Math.random() * others.length)].id;
      edge = { target: randomTarget };
    }

    const nextId = edge.target;
    const nextNode = nodes.find(n => n.id === nextId);
    const nextViewDir = viewDirForId(nextId);

    const nextCluster = {
      id: nextId,
      worldPos: [0, 0, 0],
      rotSway: rotationForViewDir(nextViewDir, nextId),
      viewDir: nextViewDir,
      image: nextNode?.image,
    };

    // 2. Camera path.
    //    Start on A's null-sphere point (viewDir_A × NULL_DISTANCE),
    //    dive inward past origin (an anti-podal excursion), then
    //    climb out to B's null-sphere point. The focus is the shared
    //    origin — same "bubbles" choreography as before, only the
    //    focus is now a single fixed point rather than a per-segment
    //    hinge.
    const startPoint = current.viewDir.clone().multiplyScalar(NULL_DISTANCE);
    const endPoint   = nextViewDir.clone().multiplyScalar(NULL_DISTANCE);
    const focus      = new THREE.Vector3(0, 0, 0);

    // Where the gaze rests at each end — dead ahead of each painting.
    // For paintings at origin facing viewDir, "dead ahead of the null"
    // simply means the origin itself; but to keep the reassembly
    // symmetric with the previous choreography we look at origin.
    const startLook = focus.clone();
    const endLook   = focus.clone();

    const dir0 = startPoint.clone().normalize();
    const dir1 = endPoint.clone().normalize();

    // Break the front-to-back degeneracy of dir0 → dir1 with a lateral
    // sweep vector (perpendicular to the average of the two).
    const midDir = dir0.clone().add(dir1).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const sweepBase = new THREE.Vector3().crossVectors(midDir, worldUp);
    if (sweepBase.lengthSq() < 1e-4) sweepBase.set(1, 0, 0);
    sweepBase.normalize();
    const sweepSign = Math.random() < 0.5 ? -1 : 1;
    const sweep = sweepBase.multiplyScalar(sweepSign);

    const orbitPoint = (t) => {
      // Slerp-ish blend of dir0 → dir1 with a sideways bulge.
      const dir = dir0.clone().lerp(dir1, t)
        .addScaledVector(sweep, Math.sin(Math.PI * t) * 0.9)
        .normalize();
      // Radius shrinks past NULL toward DIVE at t=0.5, then back out.
      const rOut = t < 0.5
        ? THREE.MathUtils.lerp(NULL_DISTANCE, DIVE_RADIUS,
            THREE.MathUtils.smoothstep(t, 0, 0.5))
        : THREE.MathUtils.lerp(DIVE_RADIUS, NULL_DISTANCE,
            THREE.MathUtils.smoothstep(t, 0.5, 1));
      return dir.multiplyScalar(rOut);
    };

    const newSegment = {
      path: [startPoint, orbitPoint(0.3), orbitPoint(0.5),
             orbitPoint(0.7), endPoint],
      startId: current.id,
      endId: nextId,
      focus,
      startLook,
      endLook,
      bank: (Math.random() * 2 - 1) * 0.12,
    };

    set({
      activeClusters: [...activeClusters, nextCluster],
      segments: [...segments, newSegment],
    });

    console.log(`[Store] Segment ${segments.length} Appended: ${current.id} -> ${nextId}`);
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

  // Scrolling BACKWARD past a segment boundary is a legitimate operation
  // now — the user can revisit prior segments by scrolling up. The
  // scroll offset is the source of truth for segmentIndex, so we just
  // let AnamorphicCam re-index; there's no state to unwind here beyond
  // updating currentSegmentIndex.
  backtrackTo: (segmentIndex) => {
    if (segmentIndex < 0) return;
    const { segments } = get();
    if (segmentIndex >= segments.length) return;
    set({ currentSegmentIndex: segmentIndex });
  },

  // Legacy — kept as a no-op so any external caller doesn't crash.
  goBackward: () => false,

  setTransitionProgress: (val) => set({
    transitionProgress: val,
    isTransitioning: val > 0.01 && val < 0.99,
  }),
  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
}));

export { useStore };
export default useStore;
