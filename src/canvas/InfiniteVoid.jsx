/**
 * INFINITE VOID SCENE
 * ===================
 * The main 3D scene container.
 * It sets up the R3F Canvas, the CameraRig, and renders the StrokeClouds.
 */

import React, { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { Preload } from '@react-three/drei';
import useStore from '../store/useStore';
import CameraRig from './CameraRig';
import StrokeCloud from './StrokeCloud';

/**
 * Procedural layout constant.
 * Distance between artworks on the Z-axis.
 */
const ARTWORK_SPACING = 200;

const InfiniteVoid = () => {
  // Access state from Zustand
  const manifest = useStore(state => state.manifest);
  const activeId = useStore(state => state.activeId);
  const history = useStore(state => state.history);

  // --- RENDER LOGIC ---
  // We don't want to render ALL artworks at once (performance).
  // We only render the "Active" one, and maybe the "Next" one (if we had lookahead logic implemented).
  // For now, let's render the Active one and the History trail to allow looking back.

  // Actually, to support the "Time Travel" mechanic, we should render everything
  // but rely on Frustum Culling (except StrokeCloud disables it, so we rely on React unmounting).

  // Simplified Logic: Render the Active ID and the History.
  const visibleIds = new Set([activeId, ...history]);

  return (
    <div className="canvas-container">
      <Canvas
        camera={{ position: [0, 0, 10], fov: 75, near: 0.1, far: 1000 }}
        gl={{ antialias: true, alpha: false }} // alpha: false for performance if background is solid
      >
        <color attach="background" args={['#050505']} />
        
        {/* The Camera Rig handles the movement and scroll input */}
        <CameraRig spacing={ARTWORK_SPACING} />

        <Suspense fallback={null}>
          {manifest.map((item, index) => {
            // Determine Z-position based on index (or graph depth).
            // This assumes a linear layout for now, but could be graph-based.
            // If the store manages "nextId", the positions are dynamic.

            // For this documentation demo, we assume a simple linear mapping
            // where the store determines *which* is active, but their positions
            // are calculated relative to the "timeline".

            // NOTE: A true graph layout is complex. Here we simplify:
            // The active item is always at Z = 0 (relative to camera focus).
            // Or, we fix them in space: Item 0 at Z=0, Item 1 at Z=200...

            const zPos = index * ARTWORK_SPACING;

            // Optimization: Only render if close to active?
            // For now, render all.
            return (
              <StrokeCloud
                key={item.id}
                dataUrl={`/data/${item.file}`}
                sweetSpotZ={zPos}
                textureUrl="/brush_stroke.png"
              />
            );
          })}
        </Suspense>

        <Preload all />
      </Canvas>
    </div>
  );
};

export default InfiniteVoid;
