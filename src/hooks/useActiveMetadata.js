/**
 * HOOK: Active Metadata
 * =====================
 * Determines which artwork is currently in focus based on scroll position.
 * Returns the metadata (Title, Year) and an opacity value for fading UI.
 */

import { useMemo } from 'react';
import useStore from '../store/useStore';

// Note: Direct import from public might require build tool config.
// Ideally this data should come from the Store which fetched it.
import manifest from '../../public/data/manifest.json';

const PAINTING_SPACING = 500;
const FOCUS_WINDOW = 50; // Range +/- where text is visible

export const useActiveMetadata = () => {
  // We track the raw scrollZ from the store (not transitionProgress)
  // Note: Ensure useStore actually exposes scrollZ if this hook is used.
  // The current useStore implementation uses 'transitionProgress'.
  // This hook might be legacy or need refactoring to use 'transitionProgress'.
  const scrollZ = useStore((state) => state.scrollZ || 0);

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
