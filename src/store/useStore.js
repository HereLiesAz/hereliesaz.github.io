import { create } from 'zustand';

const useStore = create((set, get) => ({
  // Data
  manifest: [],
  graph: {},
  
  // State
  activeId: null,
  nextId: null,
  history: [], // The trail of breadcrumbs (Stack)
  transitionProgress: 0, 
  
  // Interaction
  isHoveringSignature: false,
  showMenu: false,
  
  setManifest: (nodes) => {
    const graph = {};
    nodes.forEach(node => graph[node.id] = node);
    
    const startId = nodes[0]?.id;
    const firstNode = graph[startId];
    // Determine the next node immediately
    const nextId = firstNode.neighbors?.[0] || nodes[1]?.id;

    set({ manifest: nodes, graph, activeId: startId, nextId, history: [] });
  },

  setTransitionProgress: (val) => {
    let progress = val;
    const { activeId, nextId, history, graph } = get();

    // --- MOVE FORWARD (1.0+) ---
    if (progress >= 1.0) {
      if (!nextId) {
        // End of the line, clamp to 1
        set({ transitionProgress: 1 });
        return;
      }

      // 1. Push current Active to History
      const newHistory = [...history, activeId];
      
      // 2. Next becomes Active
      const newActiveId = nextId;
      const newActiveNode = graph[newActiveId];
      
      // 3. Find NEW Next (Avoid backtracking immediately)
      // We look for a neighbor that isn't the one we just came from
      let newNextId = newActiveNode.neighbors.find(id => id !== activeId) || newActiveNode.neighbors[0];
      
      set({ 
        activeId: newActiveId, 
        nextId: newNextId, 
        history: newHistory,
        transitionProgress: 0 // Reset to start of new segment
      });
      return;
    }

    // --- MOVE BACKWARD (< 0.0) ---
    if (progress < 0) {
      if (history.length === 0) {
        // Start of the line, clamp to 0
        set({ transitionProgress: 0 });
        return;
      }

      // 1. Pop from History
      const newHistory = [...history];
      const prevId = newHistory.pop(); // This becomes our Active
      
      // 2. Current Active becomes Next (because we are backing away from it)
      const newNextId = activeId;
      
      set({ 
        activeId: prevId, 
        nextId: newNextId, 
        history: newHistory,
        transitionProgress: 0.99 // Place us at the END of the previous segment
      });
      return;
    }

    // Normal movement
    set({ transitionProgress: progress });
  },

  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
  setHoverSignature: (hover) => set({ isHoveringSignature: hover }),
}));

export default useStore;
