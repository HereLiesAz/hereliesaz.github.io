import { create } from 'zustand';

const useStore = create((set, get) => ({
  // Data
  manifest: [],
  graph: {},
  
  // State
  activeId: null,
  nextId: null,
  history: [], 
  transitionProgress: 0, 
  
  // Interaction
  isHoveringSignature: false,
  showMenu: false,
  
  setActiveId: (id) => set({ activeId: id }),

  setManifest: (nodes) => {
    // FIX: Guard against null/undefined
    if (!nodes || !Array.isArray(nodes)) {
        console.error("Store received invalid manifest:", nodes);
        return;
    }

    const graph = {};
    nodes.forEach(node => graph[node.id] = node);
    
    // We do NOT set activeId here anymore; App.jsx does it randomly
    set({ manifest: nodes, graph });
  },

  setTransitionProgress: (val) => {
    let progress = val;
    const { activeId, nextId, history, graph } = get();

    if (progress >= 1.0) {
      if (!nextId) {
        set({ transitionProgress: 1 });
        return;
      }
      const newHistory = [...history, activeId];
      const newActiveId = nextId;
      const newActiveNode = graph[newActiveId];
      
      let newNextId = null;
      if (newActiveNode && newActiveNode.neighbors) {
         newNextId = newActiveNode.neighbors.find(id => id !== activeId) || newActiveNode.neighbors[0];
      }
      
      set({ activeId: newActiveId, nextId: newNextId, history: newHistory, transitionProgress: 0 });
      return;
    }

    if (progress < 0) {
      if (history.length === 0) {
        set({ transitionProgress: 0 });
        return;
      }
      const newHistory = [...history];
      const prevId = newHistory.pop(); 
      set({ activeId: prevId, nextId: activeId, history: newHistory, transitionProgress: 0.99 });
      return;
    }

    set({ transitionProgress: progress });
  },

  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
  setHoverSignature: (hover) => set({ isHoveringSignature: hover }),
}));

export default useStore;
