import { create } from 'zustand';
import * as THREE from 'three';

// Mirror of TheaterPainting.jsx's shell geometry (see comments there).
// The hinge focus sits on the shell, so the walk generator needs these.
const SHELL_FRONT = 11.0;
const SHELL_DEPTH = 6.0;
const PAINTING_HEIGHT = 10.0;

// Convert a normalized painting uv (u right, v down) to the painting's
// local xy. Nominal painting height is used (the renderer's viewport
// fitScale, typically ~0.9, is not known here — hinge placement tolerates
// the few-percent error; the camera dive hides the rest).
function uvToLocal(uv, aspect) {
  return {
    x: (uv[0] - 0.5) * PAINTING_HEIGHT * aspect,
    y: (0.5 - uv[1]) * PAINTING_HEIGHT,
  };
}

const useStore = create((set, get) => ({
  // --- STATE ---
  nodes: [],           
  edges: [],           
  
  activeClusters: [],  // [{ id, worldPos, anchorId, rotSway }]
  segments: [],        // [{ path, startId, endId }]
  history: [],         // Not strictly needed for forward scroll, but kept for logic
  
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
      edges: Array.isArray(graphData.edges) ? graphData.edges : []
    });
  },

  setStartNode: (id) => {
    console.log("[Store] Starting at:", id);
    const { nodes } = get();
    const node = nodes.find(n => n.id === id);
    const firstCluster = { id, worldPos: [0, 0, 0], image: node?.image };
    set({
        activeClusters: [firstCluster],
        currentNodeId: id,
        segments: [],
        currentSegmentIndex: 0
    });
    get().buildNextSegment();
  },

  setCurrentResolution: (res) => set({ currentResolution: res }),
  setCurrentShardCount: (count) => set({ currentShardCount: count }),

  // Build the next step in the infinite void (Append mode)
  buildNextSegment: () => {
    const { nodes, edges, activeClusters, segments } = get();
    if (activeClusters.length === 0) return;

    // The segment originates from the LAST cluster in the list
    const current = activeClusters[activeClusters.length - 1];
    // Distance between consecutive paintings' nulls. The painting shell
    // is ~15 units deep at its viewing distance, so SEGMENT_LENGTH must
    // be quite a bit larger than that for the camera to have real
    // empty-space transit time between paintings instead of plunging
    // straight from one near-face into the next.
    const SEGMENT_LENGTH = 36.0;

    const currentZ = current.worldPos[2];

    // 1. Pick next node — weighted by pareidolia edge strength so paintings
    //    that share more marks with the current one are preferred. Fall back
    //    to a uniform random other-node if there are no edges.
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
        const randomTarget = others[Math.floor(Math.random() * others.length)].id;
        edge = { target: randomTarget };
    }

    const nextId = edge.target;
    const currentNode = nodes.find(n => n.id === current.id);
    const nextNode = nodes.find(n => n.id === nextId);

    // 2. The pareidolia hinge. The chosen edge carries the shared patch:
    //    s_uv in painting A, t_uv in painting B — a region that reads as
    //    part of BOTH paintings' subjects at the same time. Painting B is
    //    placed so its t_uv point sits at the same world xy as A's s_uv
    //    point; the camera then orbits that point (below) while A's flats
    //    give way to B's — the viewer never sees a cut.
    const aAspect = (currentNode?.width && currentNode?.height)
        ? currentNode.width / currentNode.height : 1.0;
    const bAspect = (nextNode?.width && nextNode?.height)
        ? nextNode.width / nextNode.height : 1.0;

    let hingeLocal = null;   // hinge in A's local xy
    let nextPos;
    if (Array.isArray(edge.s_uv) && Array.isArray(edge.t_uv)) {
        const sL = uvToLocal(edge.s_uv, aAspect);
        const tL = uvToLocal(edge.t_uv, bAspect);
        hingeLocal = sL;
        nextPos = [
            current.worldPos[0] + sL.x - tL.x,
            current.worldPos[1] + sL.y - tL.y,
            currentZ - SEGMENT_LENGTH,
        ];
    } else {
        nextPos = [
            current.worldPos[0],
            current.worldPos[1],
            currentZ - SEGMENT_LENGTH,
        ];
    }

    // Paintings stay axis-aligned; all parallax and the fulcrum effect
    // come from the camera's own movement (AESTHETIC §5 invariant).
    const rotSway = [0, 0, 0];

    const nextCluster = {
        id: nextId,
        worldPos: nextPos,
        anchorId: undefined,
        rotSway,
        image: nextNode?.image,
    };

    // 3. Camera path — the bubbles. The reference video's camera always
    //    points at one central point while it moves, as if traveling the
    //    surfaces of nested spheres that share a core. Here the core is
    //    the hinge (or, hinge-less, the next painting's shell center):
    //    the camera leaves A's null on a wide sphere, dives to a tight
    //    one — swinging AROUND the focus at close radius, through A's
    //    parted flats — then climbs back out to B's null. Look direction
    //    is handled in AnamorphicCam: locked on `focus`, handed off to
    //    the next core late in the segment.
    const startPoint = new THREE.Vector3(current.worldPos[0], current.worldPos[1], currentZ);
    const endPoint = new THREE.Vector3(nextPos[0], nextPos[1], nextPos[2]);

    const focus = hingeLocal
        ? new THREE.Vector3(
            current.worldPos[0] + hingeLocal.x,
            current.worldPos[1] + hingeLocal.y,
            currentZ - SHELL_FRONT - SHELL_DEPTH * 0.5)
        : new THREE.Vector3(
            nextPos[0], nextPos[1],
            nextPos[2] - SHELL_FRONT - SHELL_DEPTH * 0.5);

    // Where the gaze rests at each end of the segment — the CURRENT
    // painting's shell front (dead ahead from A's null) and the NEXT
    // painting's shell front (dead ahead from B's null). Head-on
    // reassembly at both nulls; only the middle of the transit routes
    // through the off-center hinge patch.
    const startLook = new THREE.Vector3(current.worldPos[0], current.worldPos[1], currentZ - SHELL_FRONT);
    const endLook = new THREE.Vector3(nextPos[0], nextPos[1], nextPos[2] - SHELL_FRONT);

    const dir0 = startPoint.clone().sub(focus).normalize();
    const dir1 = endPoint.clone().sub(focus).normalize();
    const R0 = startPoint.distanceTo(focus);
    const R1 = endPoint.distanceTo(focus);
    // The tight inner bubble: close enough that A's flats part around the
    // camera, far enough that the hinge patch still fills the frame.
    const Rmin = THREE.MathUtils.clamp(Math.min(R0, R1) * 0.35, 4.0, 8.0);

    // Lateral sweep direction (horizontal-biased — stage flats read
    // sideways), breaking the front-to-back degeneracy of dir0 → dir1.
    const sweepAngle = Math.random() * Math.PI * 2;
    const sweep = new THREE.Vector3(
        Math.cos(sweepAngle), Math.sin(sweepAngle) * 0.4, 0).normalize();

    const orbitPoint = (t) => {
        const dir = dir0.clone().lerp(dir1, t)
            .addScaledVector(sweep, Math.sin(Math.PI * t) * 0.9)
            .normalize();
        const rOut = t < 0.5
            ? THREE.MathUtils.lerp(R0, Rmin, THREE.MathUtils.smoothstep(t, 0, 0.5))
            : THREE.MathUtils.lerp(Rmin, R1, THREE.MathUtils.smoothstep(t, 0.5, 1));
        return focus.clone().addScaledVector(dir, rOut);
    };

    const newSegment = {
        path: [startPoint, orbitPoint(0.3), orbitPoint(0.5), orbitPoint(0.7), endPoint],
        startId: current.id,
        endId: nextId,
        focus,
        startLook,
        endLook,
        bank: (Math.random() * 2 - 1) * 0.12,
    };

    set({ 
        activeClusters: [...activeClusters, nextCluster],
        segments: [...segments, newSegment]
    });
    
    console.log(`[Store] Segment ${segments.length} Appended: ${current.id} -> ${nextId}`);
  },

  completeTransition: () => {
    // This now just cleans up far-away segments or prepares for the next
    const { segments, currentSegmentIndex } = get();
    if (currentSegmentIndex < segments.length - 1) {
        set({ currentSegmentIndex: currentSegmentIndex + 1 });
    }
    // We can verify if we need to build more
    if (segments.length < currentSegmentIndex + 3) {
        get().buildNextSegment();
    }
  },

  goBackward: () => {
    const { history } = get();
    if (history.length === 0) return false;

    // Pop the last state from history
    const lastState = history[history.length - 1];
    const remainingHistory = history.slice(0, -1);

    set({
        activeClusters: lastState.activeClusters,
        currentPath: lastState.currentPath,
        history: remainingHistory,
        currentNodeId: lastState.activeClusters[lastState.activeClusters.length - 1].id,
        transitionProgress: 1.0, // Start at the end of the previous segment
        isTransitioning: false
    });
    
    console.log("[Store] Navigating Backward. History depth:", remainingHistory.length);
    return true;
  },

  setTransitionProgress: (val) => set({ transitionProgress: val, isTransitioning: val > 0.01 && val < 0.99 }),
  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
}));

export { useStore };
export default useStore;
