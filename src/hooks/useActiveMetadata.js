import { useMemo } from 'react';
import { useStore } from '../store';
import manifest from '../../public/data/manifest.json'; // Direct import or fetch

const PAINTING_SPACING = 500;
const FOCUS_WINDOW = 50; // Range +/- where text is visible

export const useActiveMetadata = () => {
  const scrollZ = useStore((state) => state.scrollZ);

  return useMemo(() => {
    // Iterate through manifest to find if we are near a sweet spot
    for (let i = 0; i < manifest.length; i++) {
      const sweetSpotZ = -((i + 1) * PAINTING_SPACING);
      const distance = Math.abs(scrollZ - sweetSpotZ);

      if (distance < FOCUS_WINDOW) {
        // Calculate opacity based on distance (1.0 at center, 0.0 at edge)
        const opacity = 1.0 - (distance / FOCUS_WINDOW);
        return { 
          visible: true, 
          opacity, 
          data: manifest[i] 
        };
      }
    }
    return { visible: false, opacity: 0, data: null };
  }, [scrollZ]);
};
