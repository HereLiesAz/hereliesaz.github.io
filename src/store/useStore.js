import { create } from 'zustand';

const useStore = create((set, get) => ({
  manifest: [],
  activeId: null,
  nextId: null,
  transitionProgress: 0.0, 
  direction: 1,

  setManifest: (nodes) => {
    set({ manifest: nodes });
    if (!get().activeId && nodes.length > 0) {
      // Pick random start
      const randomStart = nodes[Math.floor(Math.random() * nodes.length)].id;
      console.log(`System Initialized. Random Start: ${randomStart}`);
      get().setActiveId(randomStart);
    }
  },

  setActiveId: (rawId) => {
    const { manifest, findNextId } = get();
    
    // 1. Validate: Does this ID actually exist in the manifest?
    const exactMatch = manifest.find(n => n.id === rawId);
    
    if (exactMatch) {
      // It's valid. Go there.
      set({ activeId: rawId, nextId: findNextId(rawId) });
    } else {
      // 2. Corruption Recovery
      // If we got '2023-10-157', look for '2023-10-15(7)'
      console.warn(`[Store] ID Mismatch: '${rawId}' not found. Attempting recovery...`);
      
      // Fuzzy match: ignore parens and spaces during comparison
      const cleanRaw = rawId.replace(/[^a-zA-Z0-9]/g, "");
      const fuzzyMatch = manifest.find(n => n.id.replace(/[^a-zA-Z0-9]/g, "") === cleanRaw);
      
      if (fuzzyMatch) {
        console.log(`[Store] Recovered ID: Redirecting from '${rawId}' to '${fuzzyMatch.id}'`);
        set({ activeId: fuzzyMatch.id, nextId: findNextId(fuzzyMatch.id) });
      } else {
        console.error(`[Store] Fatal: Could not find artwork for '${rawId}'.`);
      }
    }
  },

  setTransitionProgress: (value) => {
    set({ transitionProgress: value });
    const { activeId, nextId, findNextId } = get();
    
    if (value >= 1.0 && nextId) {
      console.log(`[Navigation] Arrived at ${nextId}`);
      // Swap buffers
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

    const currentNode = manifest.find(n => n.id === currentId);
    
    // Smart Neighbor Selection
    if (currentNode && currentNode.neighbors && currentNode.neighbors.length > 0) {
      return currentNode.neighbors[Math.floor(Math.random() * currentNode.neighbors.length)];
    }
    
    // Fallback: Random
    return manifest[Math.floor(Math.random() * manifest.length)].id;
  }
}));

export default useStore;
