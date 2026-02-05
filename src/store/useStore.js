/**
 * GLOBAL STATE STORE (Zustand)
 * ============================
 * This is the "Brain" of the application. It handles:
 * 1. Data Management: Storing the artwork manifest and graph.
 * 2. Navigation Logic: Deciding which artwork comes next based on visual similarity.
 * 3. Camera State: Tracking scroll progress and transition history.
 * 4. UI State: Managing overlays and menus.
 */

import { create } from 'zustand';

/**
 * Calculates the Euclidean distance between the colors of two nodes.
 * Used for finding the "nearest neighbor" in color space.
 *
 * @param {Object} nodeA - Source node { color: [r,g,b] }
 * @param {Object} nodeB - Target node { color: [r,g,b] }
 * @returns {number} Distance value.
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
  manifest: [], // Array of all artwork nodes
  graph: {},    // Map of { id: node } for O(1) lookup

  // --- NAVIGATION STATE ---
  activeId: null, // The ID of the artwork currently in focus (Sweet Spot)
  nextId: null,   // The ID of the upcoming artwork (where the path leads)
  history: [],    // Stack of previously visited IDs (for back navigation)
  
  // 0.0 = At activeId
  // 1.0 = At nextId
  transitionProgress: 0,
  
  // --- FILTERS ---
  activeCategory: 'all', // Filter: 'all', 'painting', 'photography', etc.
  
  // --- UI STATE ---
  isHoveringSignature: false, // For easter eggs
  showMenu: false,            // Toggle the glass menu

  // --- ACTIONS ---

  /**
   * Initializes the store with the loaded manifest.
   * Called by App.jsx after fetch.
   * @param {Array} nodes - The list of artworks from manifest.json
   */
  setManifest: (nodes) => {
    if (!nodes || !Array.isArray(nodes)) return;

    // Build the lookup graph
    const graph = {};
    nodes.forEach(node => graph[node.id] = node);
    
    // Set initial state
    const startId = nodes[0]?.id;
    set({ manifest: nodes, graph, activeId: startId, history: [] });
    
    // Immediately calculate the first path
    get().calcNextNode(); 
  },

  /**
   * Changes the active category filter and recalculates the path.
   * This allows the "Infinite Scroll" to dynamically adapt.
   * e.g. If you switch to "Blue", the next node will be the nearest blue artwork.
   */
  setCategory: (category) => {
    const currentCat = get().activeCategory;
    if (currentCat === category) return;

    set({ activeCategory: category });
    
    // Recalculate path immediately to create a "Bridge"
    get().calcNextNode();
  },

  /**
   * THE PATHFINDER
   * Determines the 'nextId' based on the current node's neighbors
   * and the active category filter.
   */
  calcNextNode: () => {
    const { activeId, graph, manifest, activeCategory } = get();
    const current = graph[activeId];
    if (!current) return;

    // 1. Start with pre-calculated neighbors (from indexer.py)
    let candidates = current.neighbors || [];
    
    // 2. Apply Category Filter
    if (activeCategory !== 'all') {
      const filtered = candidates.filter(id => graph[id]?.category === activeCategory);
      
      if (filtered.length > 0) {
        // Ideally, one of the neighbors is in the category.
        candidates = filtered;
      } else {
        // HARD BRIDGE:
        // If no direct neighbors match the category, we must search the ENTIRE manifest.
        // We find the node in the target category that is closest in color to the current node.
        const allInCategory = manifest.filter(n => n.category === activeCategory && n.id !== activeId);
        
        if (allInCategory.length > 0) {
            // Sort by visual similarity (color distance)
            allInCategory.sort((a, b) => getDist(current, a) - getDist(current, b));
            candidates = [allInCategory[0].id]; // Force jump to best match
        }
      }
    }

    // 3. Avoid Backtracking
    // Try not to suggest the node we literally just came from.
    const prevId = get().history[get().history.length - 1];
    
    let next = candidates.find(id => id !== prevId);

    // Fallback: If all candidates are the previous node (dead end), just go back.
    if (!next && candidates.length > 0) next = candidates[0];

    // 4. Update State
    if (next) set({ nextId: next });
  },

  /**
   * Updates the scroll progress and handles "Page Turns".
   * This is called every frame by the CameraRig.
   * @param {number} val - New progress value.
   */
  setTransitionProgress: (val) => {
    let progress = val;
    const { activeId, nextId, history } = get();

    // --- CASE 1: MOVING FORWARD (Passes 100%) ---
    if (progress >= 1.0) {
      if (!nextId) {
        set({ transitionProgress: 1 }); // End of the line
        return;
      }

      // Commit current node to history
      const newHistory = [...history, activeId];
      
      // The Next node becomes the Active node
      set({ 
        activeId: nextId, 
        history: newHistory,
        transitionProgress: 0 // Reset scroll for the new section
      });
      
      // Find the path from this new location
      get().calcNextNode();
      return;
    }

    // --- CASE 2: MOVING BACKWARD (Below 0%) ---
    if (progress < 0) {
      if (history.length === 0) {
        set({ transitionProgress: 0 }); // Already at start
        return;
      }

      // Pop the last node from history
      const newHistory = [...history];
      const prevId = newHistory.pop(); 
      
      // The Previous node becomes the Active node
      set({ 
        activeId: prevId, 
        history: newHistory,
        transitionProgress: 0.99 // Set scroll to end of that section
      });
      
      // Crucial: When going back, the "Next" must be where we just came from.
      // This preserves the timeline continuity.
      set({ nextId: activeId });
      return;
    }

    // --- CASE 3: NORMAL SCROLLING ---
    set({ transitionProgress: progress });
  },

  // --- UI ACTIONS ---
  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
  setHoverSignature: (hover) => set({ isHoveringSignature: hover }),
}));

export default useStore;
