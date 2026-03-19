import { create } from 'zustand';

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

    // 2. Position the next cluster
    const Z_STEP = 35.0; // Slightly larger for more void
    const currentZ = current.worldPos[2];
    const nextZ = currentZ - Z_STEP;
    
    // More organic "liquid" positioning
    const nextPos = [
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 8,
        nextZ
    ];

    const nextCluster = { id: nextId, worldPos: nextPos };
    
    // 3. Pareidolia "Swerve"
    // If we have a source_shard anchor, we swerve the camera towards it mid-way
    let midPoint = new THREE.Vector3(
        (current.worldPos[0] + nextPos[0]) * 0.5,
        (current.worldPos[1] + nextPos[1]) * 0.5,
        currentZ - Z_STEP * 0.5
    );

    if (edge.source_shard !== undefined) {
        // Subtle bias towards the "Discovery" side
        midPoint.x += (Math.random() - 0.5) * 4;
        midPoint.y += (Math.random() - 0.5) * 4;
    }

    set({ 
        activeClusters: [...activeClusters, nextCluster],
        currentPath: [
            new THREE.Vector3(current.worldPos[0], current.worldPos[1], currentZ),
            midPoint,
            new THREE.Vector3(nextPos[0], nextPos[1], nextZ)
        ]
    });
    
    console.log(`[Store] Path Generated: ${current.id} -> ${nextId} via Pareidolia Swerve`);
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
