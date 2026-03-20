import React from 'react';
import { useStore } from '../store/useStore';
import ShardCloud from './ShardCloud';

/**
 * VoidField - Manager for the continuous interleaved 3D void.
 * Renders multiple ShardClouds simultaneously to create the 
 * "part of each other" experience.
 */
export default function VoidField() {
  const history = useStore(s => s.history);
  const historyPosition = useStore(s => s.historyPosition);

  // We render a window of history around the current position
  // to ensure a continuous, interleaved cloud.
  // Painting at historyPosition, historyPosition + 1, and historyPosition + 2 (preloading)
  const activeEntries = history.slice(
    Math.max(0, historyPosition),
    historyPosition + 3
  );

  return (
    <group>
      {activeEntries.map((entry) => (
        <ShardCloud 
          key={entry.id + entry.sweetZ} 
          paintingId={entry.id} 
          sweetZ={entry.sweetZ} 
          active={entry.id === history[historyPosition]?.id}
        />
      ))}
    </group>
  );
}