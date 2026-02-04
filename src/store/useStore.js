import { create } from 'zustand';

// Helper: Distance between two colors/vectors
const getDist = (nodeA, nodeB) => {
  if (!nodeA || !nodeB) return Infinity;
  const c1 = nodeA.color || [0,0,0];
  const c2 = nodeB.color || [0,0,0];
  return Math.sqrt(
    Math.pow(c1[0]-c2[0], 2) + Math.pow(c1[1]-c2[1], 2) + Math.pow(c1[2]-c2[2], 2)
  );
};

const useStore = create((set, get) => ({
  // Data
  manifest: [],
  graph: {},
  
  // State
  activeId: null,
  nextId: null,
  history: [], 
  transitionProgress: 0,
  
  // Filters
  activeCategory: 'all', // 'all', 'painting', 'photography', etc.
  
  // Interaction
  isHoveringSignature: false,
  showMenu: false,

  // --- ACTIONS ---

  setManifest: (nodes) => {
    if (!nodes || !Array.isArray(nodes)) return;
    const graph = {};
    nodes.forEach(node => graph[node.id] = node);
    
    // Initial Setup
    const startId = nodes[0]?.id;
    set({ manifest: nodes, graph, activeId: startId, history: [] });
    
    // Calculate initial next node
    get().calcNextNode(); 
  },

  setCategory: (category) => {
    const currentCat = get().activeCategory;
    if (currentCat === category) return;

    set({ activeCategory: category });
    
    // IMMEDIATELY recalculate the path.
    // This creates the "Bridge" from the old art to the new category.
    get().calcNextNode();
  },

  // The Pathfinder Logic
  calcNextNode: () => {
    const { activeId, graph, manifest, activeCategory } = get();
    const current = graph[activeId];
    if (!current) return;

    // 1. Get candidates (neighbors)
    let candidates = current.neighbors || [];
    
    // 2. Filter by Category (if not 'all')
    if (activeCategory !== 'all') {
      const filtered = candidates.filter(id => graph[id]?.category === activeCategory);
      
      // If neighbors match the category, great.
      if (filtered.length > 0) {
        candidates = filtered;
      } else {
        // HARD BRIDGE: If no neighbors match, we must search the WHOLE manifest
        // for the nearest node that IS in the category.
        const allInCategory = manifest.filter(n => n.category === activeCategory && n.id !== activeId);
        
        if (allInCategory.length > 0) {
            // Sort by visual similarity (color distance)
            allInCategory.sort((a, b) => getDist(current, a) - getDist(current, b));
            candidates = [allInCategory[0].id]; // Force link to closest match
        }
      }
    }

    // 3. Select one (Avoid backtracking if possible)
    // We try to pick one that isn't the IMMEDIATE previous history item
    const prevId = get().history[get().history.length - 1];
    
    let next = candidates.find(id => id !== prevId);
    if (!next && candidates.length > 0) next = candidates[0];

    // 4. Update
    if (next) set({ nextId: next });
  },

  setTransitionProgress: (val) => {
    let progress = val;
    const { activeId, nextId, history } = get();

    // --- MOVE FORWARD (1.0+) ---
    if (progress >= 1.0) {
      if (!nextId) {
        set({ transitionProgress: 1 });
        return; // End of line
      }

      const newHistory = [...history, activeId];
      
      // Move Forward
      set({ 
        activeId: nextId, 
        history: newHistory,
        transitionProgress: 0 
      });
      
      // Find path from this new location
      get().calcNextNode();
      return;
    }

    // --- MOVE BACKWARD (< 0.0) ---
    if (progress < 0) {
      if (history.length === 0) {
        set({ transitionProgress: 0 });
        return; // Start of line
      }

      const newHistory = [...history];
      const prevId = newHistory.pop(); 
      
      // Move Backward (Time Travel)
      set({ 
        activeId: prevId, 
        history: newHistory,
        transitionProgress: 0.99 
      });
      
      // When we go back, the "Next" becomes where we just came from
      // This preserves the timeline regardless of category changes
      set({ nextId: activeId });
      return;
    }

    // Normal movement
    set({ transitionProgress: progress });
  },

  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
  setHoverSignature: (hover) => set({ isHoveringSignature: hover }),
}));

export default useStore;
