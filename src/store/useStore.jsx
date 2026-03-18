import { create } from 'zustand';

const useStore = create((set, get) => ({
  // --- STATE ---
  nodes: [],           // List of all artworks (metadata)
  edges: [],           // Adjacency list (transitions)
  
  currentNodeId: null, // The artwork currently being viewed (The "Anchor")
  nextNodeId: null,    // The artwork we are transitioning TO (The "Target")
  
  visitedNodes: new Set(), // History to avoid loops (unless necessary)
  
  hoveredShard: null,  // Interactive pareidolia trigger (from raycast)
  
  transitionProgress: 0, // 0.0 (at Current) -> 1.0 (at Next)
  isTransitioning: false,
  
  currentShardCount: 0,
  
  // UI State
  showMenu: false,

  // --- ACTIONS ---
  
  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),

  setGraph: (graphData) => {
    if (!graphData || typeof graphData !== 'object') {
        console.error("[Store] Invalid Graph Data received");
        return;
    }
    console.log("[Store] Graph Loaded:", graphData.nodes?.length, "nodes,", graphData.edges?.length, "edges");
    set({ 
      nodes: Array.isArray(graphData.nodes) ? graphData.nodes : [],
      edges: Array.isArray(graphData.edges) ? graphData.edges : []
    });
  },

  // Set the starting point (e.g., random or specific ID)
  setStartNode: (id) => {
    console.log("[Store] Starting at:", id);
    set((state) => {
        const newVisited = new Set(state.visitedNodes);
        newVisited.add(id);
        return { 
            currentNodeId: id, 
            visitedNodes: newVisited 
        };
    });
    // Immediately calculate a next node so we have a target
    get().calculateNextNode();
  },

  // Calculate the next destination based on the "Stochastic Walker" logic
  calculateNextNode: () => {
    const { nodes, edges, currentNodeId, visitedNodes, hoveredShard } = get();
    
    if (!currentNodeId || nodes.length === 0) return;

    // 1. Get neighbors
    let candidates = Array.isArray(edges) ? edges.filter(e => e.source === currentNodeId) : [];

    // 2. Stochastic Fallback if no explicit edges
    if (candidates.length === 0) {
      // Pick 3 random nodes as candidates to simulate "drifting"
      const otherNodes = nodes.filter(n => n.id !== currentNodeId);
      
      if (otherNodes.length > 0) {
        const randomNodes = [...otherNodes]
            .sort(() => Math.random() - 0.5)
            .slice(0, 3);
        
        candidates = randomNodes.map(n => ({
            target: n.id,
            weight: 0.1 
        }));
      } else {
        // Only one node exists in the system
        set({ nextNodeId: null });
        return;
      }
    }

    // 3. Pareidolia Bias (High Priority)
    if (hoveredShard !== null) {
        const pareidoliaEdge = edges.find(e => e.source === currentNodeId && e.source_shard === hoveredShard);
        if (pareidoliaEdge) {
            console.log("[Store] Pareidolia Triggered! Shard:", hoveredShard);
            set({ nextNodeId: pareidoliaEdge.target });
            return;
        }
    }

    // 4. Filter Visited (Soft)
    const unvisited = candidates.filter(e => !visitedNodes.has(e.target));
    const pool = unvisited.length > 0 ? unvisited : candidates;

    // 5. Weighted Selection
    if (pool.length === 0) {
        set({ nextNodeId: null });
        return;
    }

    const totalWeight = pool.reduce((sum, e) => sum + (e?.weight || 0.5), 0);
    if (totalWeight === 0) {
        set({ nextNodeId: null });
        return;
    }

    let r = Math.random() * totalWeight;
    let selectedId = pool[0]?.target || null;

    for (const edge of pool) {
        if (!edge) continue;
        const w = edge.weight || 0.5;
        r -= w;
        if (r <= 0) {
            selectedId = edge.target;
            break;
        }
    }

    if (!selectedId) {
        console.warn("[Store] Failed to select next node from pool");
        return;
    }

    console.log("[Store] Next Target:", selectedId);
    set({ nextNodeId: selectedId });
  },

  setCurrentShardCount: (count) => set({ currentShardCount: count }),

  setTransitionProgress: (val) => {
    // We only update if significant change to save on R3F overhead
    if (Math.abs(get().transitionProgress - val) > 0.001) {
        set({ transitionProgress: val, isTransitioning: val > 0.05 && val < 0.95 });
    }
  },

  completeTransition: () => {
    const { nextNodeId } = get();
    if (!nextNodeId) return;

    set((state) => {
        const newVisited = new Set(state.visitedNodes);
        newVisited.add(nextNodeId);
        // If history gets too large, clear it to allow revisits
        if (newVisited.size > 20) newVisited.clear(); 

        return {
            currentNodeId: nextNodeId,
            nextNodeId: null, // Clear next until calculated
            visitedNodes: newVisited,
            transitionProgress: 0,
            isTransitioning: false
        };
    });

    // Recalculate
    get().calculateNextNode();
  },
  
  setHoveredShard: (shardId) => set({ hoveredShard: shardId }),

}));

export { useStore };
export default useStore;
