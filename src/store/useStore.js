import { create } from 'zustand';

const useStore = create((set, get) => ({
  // Data
  manifest: [],
  graph: {}, // Adjacency list for O(1) lookups
  
  // State
  activeId: null,      // The painting we are currently "in"
  nextId: null,        // The painting we are approaching
  transitionProgress: 0, // 0.0 (Active) -> 1.0 (Next becomes Active)
  
  // Interaction
  isHoveringSignature: false,
  showMenu: false,
  
  // Actions
  setManifest: (nodes) => {
    // Build a quick lookup graph
    const graph = {};
    nodes.forEach(node => {
      graph[node.id] = node;
    });
    
    // Pick a random start if none selected
    const startId = nodes[0]?.id;
    const firstNode = graph[startId];
    // Default next is the first neighbor, or random if none
    const nextId = firstNode.neighbors?.[0] || nodes[1]?.id;

    set({ manifest: nodes, graph, activeId: startId, nextId });
  },

  setTransitionProgress: (val) => {
    // Clamp 0-1
    const progress = Math.max(0, Math.min(1, val));
    set({ transitionProgress: progress });
    
    // If we complete the transition (reach 1.0)
    if (progress >= 0.99) {
      const { activeId, nextId, graph } = get();
      
      // The "Next" becomes the "Active"
      const newActiveId = nextId;
      const newActiveNode = graph[newActiveId];
      
      // Find a NEW "Next" (avoiding the one we just came from if possible)
      // Simple logic: pick the first neighbor that isn't the old activeId
      let newNextId = newActiveNode.neighbors.find(id => id !== activeId) || newActiveNode.neighbors[0];
      
      set({ 
        activeId: newActiveId, 
        nextId: newNextId, 
        transitionProgress: 0 // Reset for the new loop
      });
    }
  },

  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
  setHoverSignature: (hover) => set({ isHoveringSignature: hover }),
}));

export default useStore;
