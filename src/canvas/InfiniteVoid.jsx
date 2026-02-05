/**
 * INFINITE VOID (Alternative Entry Point)
 * =======================================
 * This component represents an alternative architecture where all artworks are loaded
 * simultaneously into a single linear scroll experience, rather than the dynamic
 * graph-traversal of the main App.
 *
 * It is kept for historical reference or alternative exhibition modes.
 */

import React, { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { ScrollControls } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

// Components
import StrokeCloud from './StrokeCloud';
import CameraRig from './CameraRig';

// Constants
const PAINTING_SPACING = 500; // Distance units between paintings on the Z-axis

const SceneContent = () => {
  // 1. Load the Manifest
  // We load the entire registry of art to place them in the world.
  const { data: manifest } = useLoader(THREE.FileLoader, '/data/manifest.json', (loader) => {
    loader.setResponseType('json');
  });

  // 2. Calculate Total Depth
  // Determine how long the scroll container needs to be.
  const totalDepth = useMemo(() => {
    return (manifest.length + 1) * PAINTING_SPACING;
  }, [manifest]);

  return (
    // ScrollControls handles the HTML scrollbar <-> 3D sync
    <ScrollControls pages={manifest.length} damping={0.2}>
      {/* The Navigator: Moves the camera based on scroll */}
      <CameraRig totalDepth={totalDepth} />

      {/* The Gallery: Render all clouds */}
      {manifest.map((art, index) => {
        // Calculate the "Sweet Spot" Z coordinate for this painting.
        // We start at -500 so the first one isn't immediately clipping the camera.
        const zPos = -((index + 1) * PAINTING_SPACING);

        return (
          <StrokeCloud
            key={art.id}
            dataUrl={art.src}
            textureUrl="/assets/brush_stroke.png"
            sweetSpotZ={zPos}
          />
        );
      })}
    </ScrollControls>
  );
};

const InfiniteVoid = () => {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#050505' }}>
      <Canvas
        camera={{ position: [0, 0, 10], fov: 75 }}
        gl={{ antialias: false, alpha: false }} // Optimization: No AA for particles
        dpr={[1, 1.5]} // Cap pixel ratio for performance
      >
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
    </div>
  );
};

export default InfiniteVoid;
