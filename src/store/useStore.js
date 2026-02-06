import { create } from 'zustand';

const useStore = create((set, get) => ({
  // State
  manifest: [],
  activeId: null,
  nextId: null,
  transitionProgress: 0.0, 
  direction: 1,

  // Actions
  setManifest: (nodes) => {
    set({ manifest: nodes });
    
    // Initialize if empty
    const { activeId } = get();
    if (!activeId && nodes.length > 0) {
      const randomStart = nodes[Math.floor(Math.random() * nodes.length)].id;
      console.log(`[Store] System Init. Starting at: ${randomStart}`);
      get().setActiveId(randomStart);
    }
  },

  setActiveId: (rawId) => {
    if (!rawId) {
        console.warn("[Store] Attempted to set null ID. Ignoring.");
        return;
    }

    const { manifest, findNextId } = get();
    
    // 1. Direct Match
    const exactMatch = manifest.find(n => n.id === rawId);
    
    if (exactMatch) {
      set({ activeId: rawId, nextId: findNextId(rawId) });
      return;
    }

    // 2. Fuzzy Recovery (Fixes "157" vs "15(7)")
    // Normalize string: remove parens, spaces, dashes for comparison
    const normalize = (str) => str.replace(/[^a-zA-Z0-9]/g, "");
    const cleanTarget = normalize(rawId);
    
    const fuzzyMatch = manifest.find(n => normalize(n.id) === cleanTarget);

    if (fuzzyMatch) {
      console.log(`[Store] ID Mismatch Recovery: '${rawId}' -> '${fuzzyMatch.id}'`);
      set({ activeId: fuzzyMatch.id, nextId: findNextId(fuzzyMatch.id) });
    } else {
      console.error(`[Store] FATAL: Artwork ID '${rawId}' not found in manifest.`);
      // Optional: Fallback to random to keep the show going
      // const random = manifest[0].id;
      // get().setActiveId(random);
    }
  },

  setTransitionProgress: (value) => {
    set({ transitionProgress: value });
    
    // Check for transition completion
    const { nextId, findNextId } = get();
    
    if (value >= 1.0 && nextId) {
      console.log(`[Store] Transition Complete. Swapping to ${nextId}`);
      set({
        activeId: nextId,
        nextId: findNextId(nextId),
        transitionProgress: 0.0
      });
    }
  },

  findNextId: (currentId) => {
    const { manifest } = get();
    if (!manifest || manifest.length === 0) return null;

    const node = manifest.find(n => n.id === currentId);
    
    // Prefer defined neighbors
    if (node && node.neighbors && node.neighbors.length > 0) {
      return node.neighbors[Math.floor(Math.random() * node.neighbors.length)];
    }
    
    // Fallback to random
    return manifest[Math.floor(Math.random() * manifest.length)].id;
  }
}));

export default useStore;
