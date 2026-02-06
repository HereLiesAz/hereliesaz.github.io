import { create } from 'zustand'
import { MathUtils } from 'three'

const useStore = create((set, get) => ({
  // --- State ---
  nodes: [],           // The flat list of all artwork nodes
  graph: {},           // O(1) Lookup by ID
  totalNodes: 0,       // Expected total count (from master manifest)
  isHydrated: false,   // True once the first page is loaded
  isLoading: false,    // True during initial fetch
  
  activeId: null,      // The artwork currently in focus
  nextId: null,        // The artwork waiting in the wings
  transitionProgress: 0, // 0.0 to 1.0 (Scroll depth)
  showMenu: false,      // UI Toggle for the glass menu

  // --- Actions ---

  /**
   * The Initializer. 
   * Fetches the master manifest, loads the first page, 
   * and triggers background loading for the rest.
   */
  init: async () => {
    set({ isLoading: true });

    try {
      // 1. Fetch the Master Manifest
      const response = await fetch('/data/manifest.json');
      const master = await response.json();

      // Handle the new paginated format
      if (master.pages && Array.isArray(master.pages)) {
        set({ totalNodes: master.total_nodes });

        // 2. Load the first page immediately (Critical Path)
        await get().loadPage(master.pages[0]);
        
        set({ isHydrated: true, isLoading: false });

        // 3. Assimilate the rest in the background (The Void grows silently)
        // We use a small delay to let the main thread breathe for rendering
        setTimeout(() => {
          master.pages.slice(1).forEach(pageUrl => {
            get().loadPage(pageUrl);
          });
        }, 1000);

      } else {
        // Fallback for legacy/dev environments (if you revert to flat file)
        console.warn("Legacy manifest detected.");
        get().processChunk(master.nodes || master);
      }

    } catch (error) {
      console.error("The Librarian failed to fetch the index:", error);
      set({ isLoading: false });
    }
  },

  /**
   * Loads a specific page chunk and merges it into the state.
   */
  loadPage: async (pageUrl) => {
    try {
      const res = await fetch(`/data/${pageUrl}`);
      const data = await res.json();
      get().processChunk(data.nodes);
    } catch (e) {
      console.warn(`Failed to load shard ${pageUrl}:`, e);
    }
  },

  /**
   * Merges new nodes into the collective.
   * Handles deduplication and updates the lookup map.
   */
  processChunk: (newNodes) => {
    set((state) => {
      const updatedNodes = [...state.nodes];
      const updatedMap = { ...state.graph };
      let isFirstLoad = state.nodes.length === 0;

      newNodes.forEach(node => {
        if (!updatedMap[node.id]) {
          updatedNodes.push(node);
          updatedMap[node.id] = node;
        }
      });

      // If this is the very first load, set the entry point
      let changes = { nodes: updatedNodes, graph: updatedMap };
      if (isFirstLoad && updatedNodes.length > 0) {
        changes.activeId = updatedNodes[0].id;
        // Pre-calculate next ID immediately
        changes.nextId = updatedNodes[0].neighbors?.[0] || null;
      }

      return changes;
    });
  },

  /**
   * Navigation Logic
   */
  setTransitionProgress: (progress) => {
    set({ transitionProgress: progress });
    
    // Check for transition threshold
    if (progress >= 1.0) {
      get().commitTransition();
    }
  },

  toggleMenu: () => set((state) => ({ showMenu: !state.showMenu })),

  setManifest: (nodes) => get().processChunk(nodes),

  setActiveId: (id) => {
    const { graph } = get();
    const node = graph[id];
    if (!node) return;
    set({
      activeId: id,
      nextId: node.neighbors?.[0] || null,
      transitionProgress: 0
    });
  },

  commitTransition: () => {
    const { nextId, graph } = get();
    if (!nextId || !graph[nextId]) return;

    // Move forward
    const nextNode = graph[nextId];
    const newNextId = nextNode.neighbors?.[0] || null; // Simplified traversal

    set({
      activeId: nextId,
      nextId: newNextId,
      transitionProgress: 0 // Reset physics
    });
  },
  
  // Helpers
  getNode: (id) => get().graph[id]
}));

export default useStore;
