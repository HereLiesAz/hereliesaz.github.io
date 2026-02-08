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
  
  // UI State
  showMenu: false,

  // --- ACTIONS ---
  
  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),

  // Initialize the graph from JSON
  setGraph: (graphData) => {
    console.log("[Store] Graph Loaded:", graphData.nodes?.length, "nodes,", graphData.edges?.length, "edges");
    set({ 
      nodes: graphData.nodes || [],
      edges: graphData.edges || []
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

    // 1. Get neighbors of current node
    // Edges are directed: source -> target
    const candidates = edges.filter(e => e.source === currentNodeId);

    if (candidates.length === 0) {
      console.warn("[Store] Dead end reached! Teleporting to random unvisited node.");
      // Fallback: Pick a random unvisited node
      const unvisited = nodes.filter(n => !visitedNodes.has(n.id));
      const target = unvisited.length > 0 
        ? unvisited[Math.floor(Math.random() * unvisited.length)]
        : nodes[Math.floor(Math.random() * nodes.length)]; // Reset if all visited
      set({ nextNodeId: target?.id || null });
      return;
    }

    // 2. Filter visited nodes (soft constraint)
    // We prefer unvisited nodes, but if all neighbors are visited, we revisit.
    const unvisitedCandidates = candidates.filter(e => !visitedNodes.has(e.target));
    const pool = unvisitedCandidates.length > 0 ? unvisitedCandidates : candidates;

    // 3. Pareidolia Bias (If user is hovering a specific shard that links to a specific image)
    // TODO: Implement shard-specific linkage in graph edges (e.g., edge.shardId)
    // For now, we stick to node-level transitions.

    // 4. Weighted Probability Selection
    // We use the edge weight (similarity) to bias the random selection.
    // Higher weight = Higher chance.
    
    let selectedEdge = null;
    
    // Simple Roulette Wheel Selection
    const totalWeight = pool.reduce((sum, e) => sum + (e.weight || 0.5), 0);
    let randomValue = Math.random() * totalWeight;
    
    for (const edge of pool) {
        randomValue -= (edge.weight || 0.5);
        if (randomValue <= 0) {
            selectedEdge = edge;
            break;
        }
    }
    
    // Fallback if rounding errors occurred
    if (!selectedEdge) selectedEdge = pool[pool.length - 1];

    console.log("[Store] Selected Next Node:", selectedEdge.target, "(Weight:", selectedEdge.weight, ")");
    set({ nextNodeId: selectedEdge.target });
  },

  // Update the scroll/flight progress
  setTransitionProgress: (val) => {
    set({ transitionProgress: val });
  },

  // Commit the transition: Next becomes Current, Next is recalculated
  completeTransition: () => {
    const { nextNodeId, visitedNodes } = get();
    if (!nextNodeId) return;

    console.log("[Store] Transition Complete. Arrived at:", nextNodeId);

    set((state) => {
        const newVisited = new Set(state.visitedNodes);
        newVisited.add(nextNodeId);
        return {
            currentNodeId: nextNodeId,
            visitedNodes: newVisited,
            transitionProgress: 0, // Reset progress for the new segment
            isTransitioning: false
        };
    });

    // Immediately plan the *next* step from the new current node
    get().calculateNextNode();
  },
  
  setHoveredShard: (shardId) => set({ hoveredShard: shardId }),

}));

export { useStore };
export default useStore;
