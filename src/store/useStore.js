import { create } from 'zustand';
import { MathUtils } from 'three';

const useStore = create((set, get) => ({
  // --- Data & Graph ---
  manifest: [], // The full graph of artworks
  
  // --- Navigation State ---
  activeId: null, // The artwork we are currently "inside"
  nextId: null,   // The artwork we are moving towards
  
  // --- Animation State ---
  // 0.0 = fully at activeId
  // 1.0 = fully at nextId
  transitionProgress: 0.0, 
  direction: 1, // 1 for forward, -1 for backward

  // --- Actions ---

  setManifest: (nodes) => {
    set({ manifest: nodes });
    // If no active ID is set, pick a random one to start
    if (!get().activeId && nodes.length > 0) {
      const randomStart = nodes[Math.floor(Math.random() * nodes.length)].id;
      console.log(`System Initialized. Random Start: ${randomStart}`);
      set({ activeId: randomStart, nextId: get().findNextId(randomStart) });
    }
  },

  setActiveId: (id) => {
    // CRITICAL FIX: Do NOT sanitize or strip characters here. 
    // The ID must match the filename exactly, including parentheses.
    console.log(`Navigation: Setting Active ID to ${id}`);
    
    // Find the node to ensure it exists
    const node = get().manifest.find(n => n.id === id);
    
    if (node) {
      set({ activeId: id });
      // Pre-calculate the next destination
      set({ nextId: get().findNextId(id) });
    } else {
      console.warn(`Attempted to navigate to unknown ID: ${id}`);
    }
  },

  setTransitionProgress: (value) => {
    set({ transitionProgress: value });
    
    // Auto-switch when we pass the threshold
    const { activeId, nextId, findNextId } = get();
    
    if (value >= 1.0 && nextId) {
      console.log("Transition Complete. Swapping buffers.");
      set({
        activeId: nextId,
        nextId: findNextId(nextId), // Find a new target
        transitionProgress: 0.0 // Reset scroll
      });
    }
  },

  // --- Graph Logic ---
  findNextId: (currentId) => {
    const { manifest } = get();
    if (!manifest || manifest.length === 0) return null;

    const currentNode = manifest.find(n => n.id === currentId);
    if (!currentNode || !currentNode.neighbors || currentNode.neighbors.length === 0) {
        // Fallback: Pick random if no neighbors defined
        return manifest[Math.floor(Math.random() * manifest.length)].id;
    }

    // Pick a random neighbor from the pre-calculated list
    // This allows for "curated randomness" based on color similarity
    const neighbors = currentNode.neighbors;
    const next = neighbors[Math.floor(Math.random() * neighbors.length)];
    return next;
  }
}));

export default useStore;
