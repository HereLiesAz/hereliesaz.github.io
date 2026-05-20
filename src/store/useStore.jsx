import { create } from 'zustand';
import * as THREE from 'three';

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

    // 2. Place the next painting one segment-length further down the
    //    Z-axis at the SAME xy as the current painting. With both
    //    paintings on the same xy axis, any shared blotch (the pareidolia
    //    hinge from §5) sits at exactly the same world point in both —
    //    so during the transit the shared mark holds while non-shared
    //    blotches resolve to whichever painting's null the camera is
    //    closest to.
    const nextPos = [
        current.worldPos[0],
        current.worldPos[1],
        currentZ - SEGMENT_LENGTH,
    ];
    const anchorWorldPos = null;

    // Paintings stay axis-aligned so a shared blotch at the same
    // normalized (x, y) lands at the same world point in both A and B —
    // the pareidolia hinge from AESTHETIC §5 only works under that
    // invariant. Camera parallax comes from the mid-segment xy swerve
    // (below) — the camera arcs around / past the painting between
    // nulls, the painting itself does not rotate.
    const rotSway = [0, 0, 0];
    // Enough mid-segment xy offset to read as a real arc rather than a
    // straight line, but small enough that the destination painting
    // (10 units tall, FoV 50°) stays in frame as the camera passes the
    // midpoint. At ~21 units between nulls, 1–2.5 puts the midpoint
    // 5–12 % off-axis — visible parallax without losing the painting.
    const swerveDist = 1.0 + Math.random() * 1.5;

    const nextNode = nodes.find(n => n.id === nextId);
    const nextCluster = {
        id: nextId,
        worldPos: nextPos,
        anchorId: undefined,
        rotSway,
        image: nextNode?.image,
    };
    
    // 3. Camera Spline
    const startPoint = new THREE.Vector3(current.worldPos[0], current.worldPos[1], currentZ);
    const endPoint = new THREE.Vector3(nextPos[0], nextPos[1], nextPos[2]);
    const midPoint = (anchorWorldPos || new THREE.Vector3(
        (startPoint.x + endPoint.x) * 0.5,
        (startPoint.y + endPoint.y) * 0.5,
        (startPoint.z + endPoint.z) * 0.5
    )).clone();

    const swerveAngle = Math.random() * Math.PI * 2;
    midPoint.x += Math.cos(swerveAngle) * swerveDist;
    midPoint.y += Math.sin(swerveAngle) * swerveDist;

    const newSegment = {
        path: [startPoint, midPoint, endPoint],
        startId: current.id,
        endId: nextId
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
