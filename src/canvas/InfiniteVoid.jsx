import React, { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { ScrollControls } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

// Components
import StrokeCloud from './StrokeCloud';
import CameraRig from './CameraRig';

// Constants
const PAINTING_SPACING = 500; // Distance between paintings

const SceneContent = () => {
  // 1. Load the Manifest
  const { data: manifest } = useLoader(THREE.FileLoader, '/data/manifest.json', (loader) => {
    loader.setResponseType('json');
  });

  // 2. Calculate Total Depth
  const totalDepth = useMemo(() => {
    return (manifest.length + 1) * PAINTING_SPACING;
  }, [manifest]);

  return (
    <ScrollControls pages={manifest.length} damping={0.2}>
      {/* The Navigator */}
      <CameraRig totalDepth={totalDepth} />

      {/* The Gallery */}
      {manifest.map((art, index) => {
        // Calculate the "Sweet Spot" Z
        // We start at -500 so the first one isn't in your face
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
        gl={{ antialias: false, alpha: false }} // Optimization
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
