/**
 * GLOBAL STORE (Zustand)
 * ======================
 * Manages the application state, specifically the "Graph" of artworks
 * and the user's traversal through it.
 *
 * Think of this as the "Brain" of the application.
 */

import { create } from 'zustand';

/**
 * Helper: Calculate Euclidean distance between two color vectors.
 * Used to find the "Nearest Neighbor" in color space.
 *
 * @param {Object} nodeA - Source node { color: [r,g,b] }
 * @param {Object} nodeB - Target node { color: [r,g,b] }
 * @returns {number} Distance (lower = more similar)
 */
const getDist = (nodeA, nodeB) => {
  // Safety check to avoid crashes on bad data
  if (!nodeA || !nodeB) return Infinity;

  // Default to black if color is missing
  const c1 = nodeA.color || [0,0,0];
  const c2 = nodeB.color || [0,0,0];

  // Standard 3D distance formula: sqrt(dx^2 + dy^2 + dz^2)
  return Math.sqrt(
    Math.pow(c1[0]-c2[0], 2) + Math.pow(c1[1]-c2[1], 2) + Math.pow(c1[2]-c2[2], 2)
  );
};

// Create the Zustand store
// 'set' is used to update state.
// 'get' is used to read current state within actions.
const useStore = create((set, get) => ({
  // --- DATA ---
  manifest: [], // Array: List of all artwork nodes loaded from manifest.json
  graph: {},    // Object: Map { id: node } for O(1) instant access lookup
  
  // --- STATE ---
  activeId: null,      // String: The ID of the artwork currently in focus (Foreground)
  nextId: null,        // String: The ID of the artwork loading in the background (Forward path)
  history: [],         // Array: Stack of visited IDs (allows for Back button logic)
  transitionProgress: 0, // Float: 0.0 (At Active) -> 1.0 (At Next). Controlled by CameraRig.
  
  // --- FILTERS ---
  activeCategory: 'all', // Filter state: 'all', 'painting', 'photography' (Extensible)
  
  // --- UI STATE ---
  isHoveringSignature: false, // Boolean: Visual feedback for the logo
  showMenu: false,            // Boolean: Is the modal menu open?

  // --- ACTIONS ---

  /**
   * Initialize the store with data from manifest.json.
   * Called by App.jsx on mount.
   *
   * @param {Array} nodes - The list of artwork objects.
   */
  setManifest: (nodes) => {
    // Validate input
    if (!nodes || !Array.isArray(nodes)) return;

    // Build the lookup graph
    const graph = {};
    nodes.forEach(node => graph[node.id] = node);
    
    // Set initial state.
    // We default activeId to the first one, but App.jsx usually overrides this with a random pick.
    const startId = nodes[0]?.id;
    set({ manifest: nodes, graph, activeId: startId, history: [] });
    
    // Immediately calculate where to go next
    get().calcNextNode(); 
  },

  /**
   * Manually jump to a specific artwork.
   * Used for random initialization or menu navigation.
   *
   * @param {string} id - The target artwork ID.
   */
  setActiveId: (id) => {
      set({ activeId: id });
      // Whenever we change location, we must recalculate the path forward.
      get().calcNextNode();
  },

  /**
   * Filter the graph by category.
   * Immediately recalculates the path to "bridge" to the new category.
   *
   * @param {string} category - The new category filter.
   */
  setCategory: (category) => {
    const currentCat = get().activeCategory;
    if (currentCat === category) return; // No-op if unchanged

    set({ activeCategory: category });
    
    // Recalculate path immediately so the next scroll takes you to the new category.
    get().calcNextNode();
  },

  /**
   * THE PATHFINDER
   * Determines 'nextId' based on visual similarity and filters.
   * This is the core recommendation engine logic.
   */
  calcNextNode: () => {
    const { activeId, graph, manifest, activeCategory } = get();
    const current = graph[activeId];

    // Guard clause: if we don't know where we are, we can't decide where to go.
    if (!current) return;

    // 1. Get pre-calculated neighbors (from indexer.py)
    // These are the "Natural" visual matches.
    let candidates = current.neighbors || [];
    
    // 2. Apply Category Filter
    if (activeCategory !== 'all') {
      // Filter the natural neighbors
      const filtered = candidates.filter(id => graph[id]?.category === activeCategory);
      
      if (filtered.length > 0) {
        // If we found a neighbor that matches the category, use it.
        candidates = filtered;
      } else {
        // BRIDGE MECHANIC:
        // If none of our neighbors match the filter, we must "Teleport" or "Bridge"
        // to the closest node in the entire graph that DOES match.
        // Search entire manifest:
        const allInCategory = manifest.filter(n => n.category === activeCategory && n.id !== activeId);
        
        if (allInCategory.length > 0) {
            // Sort by color distance to find the smoothest transition
            allInCategory.sort((a, b) => getDist(current, a) - getDist(current, b));
            // Set the best bridge as the candidate
            candidates = [allInCategory[0].id];
        }
      }
    }

    // 3. Avoid Backtracking
    // We don't want to suggest the node we literally just came from,
    // unless it's the only option.
    const prevId = get().history[get().history.length - 1];
    
    // Find a candidate that isn't the previous one.
    let next = candidates.find(id => id !== prevId);

    // Fallback: If all candidates are "previous" (dead end), just take the first one.
    if (!next && candidates.length > 0) next = candidates[0];

    // 4. Update Next ID in state
    if (next) set({ nextId: next });
  },

  /**
   * Handles the "Page Turn" logic.
   * Called every frame by CameraRig, but usually only updates when progress changes significantly.
   *
   * @param {number} val - The current transition progress (0.0 to 1.0+)
   */
  setTransitionProgress: (val) => {
    let progress = val;
    const { activeId, nextId, history } = get();

    // --- CASE 1: MOVING FORWARD (Crossing the Finish Line) ---
    // The user has scrolled past the threshold (1.0).
    if (progress >= 1.0) {
      if (!nextId) {
        set({ transitionProgress: 1 }); // End of world (no next node)
        return;
      }

      // Commit current node to history stack
      const newHistory = [...history, activeId];
      
      // Step Forward:
      // - The "Next" becomes the "Active".
      // - We reset progress to 0 (Start of new section).
      set({ 
        activeId: nextId, 
        history: newHistory,
        transitionProgress: 0
      });
      
      // Calculate the new path from this new location
      get().calcNextNode();
      return;
    }

    // --- CASE 2: MOVING BACKWARD (Crossing the Start Line) ---
    // The user has scrolled back past 0.0.
    if (progress < 0) {
      if (history.length === 0) {
        set({ transitionProgress: 0 }); // Already at start of history
        return;
      }

      // Step Back:
      const newHistory = [...history];
      const prevId = newHistory.pop(); // Pop the last visited ID
      
      // - The "Previous" becomes the "Active".
      // - We set progress to 0.99 (End of previous section).
      set({ 
        activeId: prevId, 
        history: newHistory,
        transitionProgress: 0.99
      });
      
      // Restore the forward path.
      // The node we just left (current activeId) should become the "Next" again.
      set({ nextId: activeId });
      return;
    }

    // --- CASE 3: SCROLLING (In Between) ---
    // Just update the value for the renderer to use.
    set({ transitionProgress: progress });
  },

  // --- UI ACTIONS ---
  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
  setHoverSignature: (hover) => set({ isHoveringSignature: hover }),
}));

export default useStore;
