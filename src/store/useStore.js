import { create } from 'zustand';

const useStore = create((set, get) => ({
  // --- Data & Graph ---
  manifest: [], 
  
  // --- Navigation State ---
  activeId: null, 
  nextId: null,   
  
  transitionProgress: 0.0, 
  direction: 1, 

  // --- Actions ---

  setManifest: (nodes) => {
    set({ manifest: nodes });
    
    // If we are stuck on a bad ID (or no ID), reset.
    const current = get().activeId;
    const isValid = current && nodes.find(n => n.id === current);
    
    if (!isValid && nodes.length > 0) {
      const randomStart = nodes[Math.floor(Math.random() * nodes.length)].id;
      console.log(`[System] Initializing. Start: ${randomStart}`);
      get().setActiveId(randomStart);
    }
  },

  setActiveId: (rawId) => {
    // CRITICAL: Do NOT sanitize here. Trust the filename.
    const { manifest, findNextId } = get();
    
    // 1. Exact Match Check
    const exactMatch = manifest.find(n => n.id === rawId);
    
    if (exactMatch) {
      console.log(`[Nav] Jumping to: ${rawId}`);
      set({ activeId: rawId, nextId: findNextId(rawId) });
      return;
    }

    // 2. Recovery Mode (Fixing the "157" vs "15(7)" bug)
    console.warn(`[Nav] ID '${rawId}' not found. Attempting fuzzy recovery...`);
    
    // Remove all non-alphanumeric chars for comparison
    const cleanTarget = rawId.replace(/[^a-zA-Z0-9]/g, "");
    
    const bestMatch = manifest.find(n => 
      n.id.replace(/[^a-zA-Z0-9]/g, "") === cleanTarget
    );

    if (bestMatch) {
      console.log(`[Nav] Recovered: ${rawId} -> ${bestMatch.id}`);
      set({ activeId: bestMatch.id, nextId: findNextId(bestMatch.id) });
    } else {
      console.error(`[Nav] FATAL: Could not find artwork for '${rawId}'.`);
    }
  },

  setTransitionProgress: (value) => {
    set({ transitionProgress: value });
    const { nextId, findNextId } = get();
    
    if (value >= 1.0 && nextId) {
      console.log(`[Nav] Arrived at ${nextId}`);
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
    
    // Prefer neighbors, fallback to random
    if (node && node.neighbors && node.neighbors.length > 0) {
      return node.neighbors[Math.floor(Math.random() * node.neighbors.length)];
    }
    return manifest[Math.floor(Math.random() * manifest.length)].id;
  }
}));

export default useStore;
