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
    const firstCluster = { id, worldPos: [0, 0, 0] };
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
    const FOV = 50.0;
    const WORLD_HEIGHT = 10.0;
    const D = (WORLD_HEIGHT / 2) / Math.tan(((FOV / 2) * Math.PI) / 180);
    const SEGMENT_LENGTH = D * 2.0;

    const currentZ = current.worldPos[2];
    const nextZ = currentZ - SEGMENT_LENGTH; 
    
    // 1. Pick next node (Stochastic)
    const candidates = edges.filter(e => e.source === current.id);
    let edge;
    if (candidates.length > 0) {
        edge = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
        const others = nodes.filter(n => n.id !== current.id);
        const randomTarget = others[Math.floor(Math.random() * others.length)].id;
        edge = { target: randomTarget };
    }

    const nextId = edge.target;
    const nextNode = nodes.find(n => n.id === nextId);
    
    // --- PRECISE ANCHOR ALIGNMENT ---
    const worldHeight = 10;
    const imgAspect = (nextNode?.res?.[0] || 1000) / (nextNode?.res?.[1] || 1000);
    const worldWidth = worldHeight * imgAspect;
    const FULCRUM_Z = -10.0;

    let nextPos = [0, 0, currentZ - 100.0]; 
    let anchorWorldPos = null;

    if (edge.s_nx !== undefined && edge.t_nx !== undefined) {
        const z_a = edge.s_depth;
        const factor_a = Math.abs(z_a) / Math.abs(FULCRUM_Z);
        anchorWorldPos = new THREE.Vector3(
            current.worldPos[0] + edge.s_nx * worldWidth * factor_a,
            current.worldPos[1] + edge.s_ny * worldHeight * factor_a,
            current.worldPos[2] + z_a
        );

        const z_next_local = edge.t_depth;
        const factor_next = Math.abs(z_next_local) / Math.abs(FULCRUM_Z);
        
        nextPos = [
            anchorWorldPos.x - (edge.t_nx * worldWidth * factor_next),
            anchorWorldPos.y - (edge.t_ny * worldHeight * factor_next),
            anchorWorldPos.z - z_next_local
        ];

        // Update the current cluster's exit anchor
        set(state => ({
            activeClusters: state.activeClusters.map(c => 
                c.id === current.id ? { ...c, anchorId: edge.source_shard } : c
            )
        }));
    } else {
        nextPos[0] += (Math.random() - 0.5) * 10;
        nextPos[1] += (Math.random() - 0.5) * 10;
    }

    // --- CINEMATIC TRANSFORMATION BUDGET (35°) ---
    const TOTAL_BUDGET = 35.0; 
    const randomWeights = [Math.random(), Math.random(), Math.random(), Math.random()];
    const W_SUM = randomWeights.reduce((a, b) => a + b, 0);
    const budget = randomWeights.map(w => (w / W_SUM) * TOTAL_BUDGET);
    const rotSway = budget.slice(0, 3);
    const swerveDist = budget[3] * 0.5; 

    const nextCluster = { 
        id: nextId, 
        worldPos: nextPos, 
        anchorId: edge.target_shard,
        rotSway: rotSway
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
