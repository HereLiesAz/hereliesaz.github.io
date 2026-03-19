import { create } from 'zustand';
import * as THREE from 'three';

const useStore = create((set, get) => ({
  // --- STATE ---
  nodes: [],           
  edges: [],           
  
  activeClusters: [],  // [{ id, worldPos, type: 'current' | 'next' | 'prev' }]
  currentPath: null,   // THREE.Curve for camera
  
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
    set({ activeClusters: [firstCluster] });
    get().buildNextSegment();
  },

  // Build the next step in the infinite void
  buildNextSegment: () => {
    const { nodes, edges, activeClusters } = get();
    if (activeClusters.length === 0) return;

    const current = activeClusters[activeClusters.length - 1];
    const currentZ = current.worldPos[2];
    
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

    let nextPos = [0, 0, currentZ - 35.0]; 

    if (edge.s_nx !== undefined && edge.t_nx !== undefined) {
        const z_a = - (edge.s_depth * 50.0 + 5.0);
        const factor_a = z_a / FULCRUM_Z;
        const anchorWorldPos = new THREE.Vector3(
            current.worldPos[0] + edge.s_nx * worldWidth * factor_a,
            current.worldPos[1] + edge.s_ny * worldHeight * factor_a,
            current.worldPos[2] + z_a
        );

        const z_next_local = - (edge.t_depth * 50.0 + 5.0);
        const factor_next = z_next_local / FULCRUM_Z;
        
        nextPos = [
            anchorWorldPos.x - (edge.t_nx * worldWidth * factor_next),
            anchorWorldPos.y - (edge.t_ny * worldHeight * factor_next),
            anchorWorldPos.z - z_next_local
        ];

        // Mark the current cluster's exit anchor
        current.anchorId = edge.source_shard;
    } else {
        nextPos[0] += (Math.random() - 0.5) * 10;
        nextPos[1] += (Math.random() - 0.5) * 10;
    }

    const nextCluster = { 
        id: nextId, 
        worldPos: nextPos, 
        anchorId: edge.target_shard 
    };
    
    // 3. Camera Spline through Anchor
    const startPoint = new THREE.Vector3(current.worldPos[0], current.worldPos[1], currentZ);
    const endPoint = new THREE.Vector3(nextPos[0], nextPos[1], nextPos[2]);
    const midPoint = new THREE.Vector3(
        (startPoint.x + endPoint.x) * 0.5,
        (startPoint.y + endPoint.y) * 0.5,
        (startPoint.z + endPoint.z) * 0.5
    );

    set({ 
        activeClusters: [...activeClusters, nextCluster],
        currentPath: [startPoint, midPoint, endPoint]
    });
    
    console.log(`[Store] Pareidolic Bridge Formed: ${current.id} -> ${nextId}`);
  },

  completeTransition: () => {
    const { activeClusters } = get();
    if (activeClusters.length < 2) return;

    // Prune old clusters to keep scene light
    // Keep last 2-3 to ensure overlap remains visible in perimeter
    const newActive = activeClusters.slice(-2); 
    
    set({ 
        activeClusters: newActive,
        transitionProgress: 0,
        isTransitioning: false
    });

    // Prepare the next jump
    get().buildNextSegment();
  },

  setTransitionProgress: (val) => set({ transitionProgress: val, isTransitioning: val > 0.01 && val < 0.99 }),
  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
}));

export { useStore };
export default useStore;
