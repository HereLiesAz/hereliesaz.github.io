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
      console.log(`[System] Initializing. Start: ${randomStart}`);
      get().setActiveId(randomStart);
    }
  },

  setActiveId: (rawId) => {
    // 1. TRUST THE ID. Do not regex it.
    const { manifest, findNextId } = get();
    
    // 2. Validate existence
    const exactMatch = manifest.find(n => n.id === rawId);
    
    if (exactMatch) {
      set({ activeId: rawId, nextId: findNextId(rawId) });
    } else {
      // 3. Fallback for "157" vs "15(7)" error
      console.warn(`[Nav] ID mismatch: ${rawId}. Hunting for match...`);
      const cleanTarget = rawId.replace(/[^a-zA-Z0-9]/g, "");
      const match = manifest.find(n => n.id.replace(/[^a-zA-Z0-9]/g, "") === cleanTarget);
      
      if (match) {
        console.log(`[Nav] Recovered: ${match.id}`);
        set({ activeId: match.id, nextId: findNextId(match.id) });
      }
    }
  },

  setTransitionProgress: (value) => {
    set({ transitionProgress: value });
    const { activeId, nextId, findNextId } = get();
    
    if (value >= 1.0 && nextId) {
      // Swap
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
    
    if (node && node.neighbors && node.neighbors.length > 0) {
      return node.neighbors[Math.floor(Math.random() * node.neighbors.length)];
    }
    return manifest[Math.floor(Math.random() * manifest.length)].id;
  }
}));

export default useStore;
