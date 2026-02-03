import { create } from 'zustand';

export const useStore = create((set) => ({
  // The raw Z-position of the camera
  scrollZ: 0,
  
  // The index of the painting currently in the "Focus Window"
  activePaintingIndex: null,
  
  // Actions
  setScrollZ: (z) => set({ scrollZ: z }),
  setActivePainting: (index) => set({ activePaintingIndex: index }),
}));
