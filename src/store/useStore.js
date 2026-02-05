/**
 * GLOBAL STORE (Zustand)
 * ======================
 * Manages the application state, specifically the "Graph" of artworks
 * and the user's traversal through it.
 */

import { create } from 'zustand';

/**
 * Helper: Calculate Euclidean distance between two color vectors.
 * Used to find the "Nearest Neighbor" in color space.
 * @param {Object} nodeA - Source node { color: [r,g,b] }
 * @param {Object} nodeB - Target node { color: [r,g,b] }
 * @returns {number} Distance
 */
const getDist = (nodeA, nodeB) => {
  if (!nodeA || !nodeB) return Infinity;
  const c1 = nodeA.color || [0,0,0];
  const c2 = nodeB.color || [0,0,0];
  return Math.sqrt(
    Math.pow(c1[0]-c2[0], 2) + Math.pow(c1[1]-c2[1], 2) + Math.pow(c1[2]-c2[2], 2)
  );
};

const useStore = create((set, get) => ({
  // --- DATA ---
  manifest: [], // List of all nodes
  graph: {},    // Map { id: node } for O(1) access
  
  // --- STATE ---
  activeId: null,      // The artwork currently in focus
  nextId: null,        // The artwork loading in the background (forward path)
  history: [],         // Stack of visited IDs (for back button logic)
  transitionProgress: 0, // 0.0 (At Active) -> 1.0 (At Next)
  
  // --- FILTERS ---
  activeCategory: 'all', // Filter: 'all', 'painting', 'photography'
  
  // --- UI ---
  isHoveringSignature: false,
  showMenu: false,

  // --- ACTIONS ---

  /**
   * Initialize the store with data from manifest.json
   */
  setManifest: (nodes) => {
    if (!nodes || !Array.isArray(nodes)) return;
    const graph = {};
    nodes.forEach(node => graph[node.id] = node);
    
    // Set initial state
    const startId = nodes[0]?.id;
    set({ manifest: nodes, graph, activeId: startId, history: [] });
    
    // Determine the first path
    get().calcNextNode(); 
  },

  setActiveId: (id) => {
      set({ activeId: id });
      get().calcNextNode();
  },

  /**
   * Filter the graph by category.
   * Immediately recalculates the path to "bridge" to the new category.
   */
  setCategory: (category) => {
    const currentCat = get().activeCategory;
    if (currentCat === category) return;

    set({ activeCategory: category });
    
    // Recalculate path immediately
    get().calcNextNode();
  },

  /**
   * THE PATHFINDER
   * Determines 'nextId' based on visual similarity and filters.
   */
  calcNextNode: () => {
    const { activeId, graph, manifest, activeCategory } = get();
    const current = graph[activeId];
    if (!current) return;

    // 1. Get pre-calculated neighbors (from indexer.py)
    let candidates = current.neighbors || [];
    
    // 2. Apply Category Filter
    if (activeCategory !== 'all') {
      const filtered = candidates.filter(id => graph[id]?.category === activeCategory);
      
      if (filtered.length > 0) {
        candidates = filtered;
      } else {
        // BRIDGE: Search entire manifest if local neighbors fail
        const allInCategory = manifest.filter(n => n.category === activeCategory && n.id !== activeId);
        
        if (allInCategory.length > 0) {
            // Sort by color distance
            allInCategory.sort((a, b) => getDist(current, a) - getDist(current, b));
            candidates = [allInCategory[0].id];
        }
      }
    }

    // 3. Avoid Backtracking (don't suggest where we just came from)
    const prevId = get().history[get().history.length - 1];
    
    let next = candidates.find(id => id !== prevId);
    if (!next && candidates.length > 0) next = candidates[0];

    // 4. Update Next ID
    if (next) set({ nextId: next });
  },

  /**
   * Handles the "Page Turn" when transition crosses 0 or 1.
   * Driven by CameraRig.
   */
  setTransitionProgress: (val) => {
    let progress = val;
    const { activeId, nextId, history } = get();

    // --- CASE 1: MOVING FORWARD (Finish Line) ---
    if (progress >= 1.0) {
      if (!nextId) {
        set({ transitionProgress: 1 }); // End of world
        return;
      }

      // Commit to history
      const newHistory = [...history, activeId];
      
      // Step Forward
      set({ 
        activeId: nextId, 
        history: newHistory,
        transitionProgress: 0 // Reset to start of new section
      });
      
      // Calculate new path
      get().calcNextNode();
      return;
    }

    // --- CASE 2: MOVING BACKWARD (Start Line) ---
    if (progress < 0) {
      if (history.length === 0) {
        set({ transitionProgress: 0 }); // Already at start
        return;
      }

      // Step Back
      const newHistory = [...history];
      const prevId = newHistory.pop(); 
      
      set({ 
        activeId: prevId, 
        history: newHistory,
        transitionProgress: 0.99 // Set to end of previous section
      });
      
      // Restore the forward path (Next = what used to be Active)
      set({ nextId: activeId });
      return;
    }

    // --- CASE 3: SCROLLING ---
    set({ transitionProgress: progress });
  },

  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
  setHoverSignature: (hover) => set({ isHoveringSignature: hover }),
}));

export default useStore;
