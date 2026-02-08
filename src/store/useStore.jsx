import { create } from 'zustand';

export const useStore = create((set, get) => ({
  // STATE
  manifest: [],
  activeId: null,
  hoverId: null,
  
  // ACTIONS
  setManifest: (nodes) => {
    console.log("[Store] Setting manifest:", nodes.length, "nodes");
    set({ manifest: nodes });
  },

  setActiveId: (id) => {
    console.log("[Store] Active ID:", id);
    set({ activeId: id });
  },

  setHoverId: (id) => set({ hoverId: id }),

  // HELPERS
  getNode: (id) => get().manifest.find(n => n.id === id),
  
  getNextId: () => {
    const { manifest, activeId } = get();
    if (!activeId || manifest.length === 0) return null;
    const idx = manifest.findIndex(n => n.id === activeId);
    const nextIdx = (idx + 1) % manifest.length;
    return manifest[nextIdx].id;
  },

  getPrevId: () => {
    const { manifest, activeId } = get();
    if (!activeId || manifest.length === 0) return null;
    const idx = manifest.findIndex(n => n.id === activeId);
    const prevIdx = (idx - 1 + manifest.length) % manifest.length;
    return manifest[prevIdx].id;
  }
}));
