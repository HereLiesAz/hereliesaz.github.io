/**
 * APP ROOT
 * ========
 * The main entry point of the React application.
 *
 * Responsibilities:
 * 1. Bootstrapping: Fetching the 'manifest.json' and initializing the Store.
 * 2. Layout: Setting up the full-screen container and R3F Canvas.
 * 3. Composition: Rendering the CameraRig, Overlay, and the InfiniteCanvas instances.
 */

import React, { useEffect, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Loader } from '@react-three/drei';
import useStore from './store/useStore';
import CameraRig from './canvas/CameraRig';
import InfiniteCanvas from './canvas/InfiniteCanvas';
import Overlay from './components/Overlay';

const App = () => {
  // Access Store Actions & State
  const setManifest = useStore(state => state.setManifest);
  const setActiveId = useStore(state => state.setActiveId);
  const activeId = useStore(state => state.activeId);
  const nextId = useStore(state => state.nextId);
  const transitionProgress = useStore(state => state.transitionProgress);

  // --- 1. INITIALIZATION ---
  useEffect(() => {
    // Fetch the artwork graph
    fetch('/manifest.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (!data.nodes || Object.keys(data.nodes).length === 0) {
          console.error("Manifest is empty or invalid.");
          return;
        }

        // Hydrate Store
        setManifest(data.nodes);

        // CHAOS SELECTION:
        // Pick a random artwork to start with, rather than a fixed homepage.
        // This ensures every visit is unique.
        const keys = Object.keys(data.nodes);
        const randomId = keys[Math.floor(Math.random() * keys.length)];

        // Robustness: Handle if setActiveId is action or state setter
        if (setActiveId) {
            setActiveId(randomId);
        } else {
            useStore.setState({ activeId: randomId });
        }
        
        console.log("System Initialized. Random Start:", randomId);
      })
      .catch(err => console.error("Manifest Load Failed:", err));
  }, [setManifest, setActiveId]);

  return (
    // FULLSCREEN CONTAINER
    // Essential for the Canvas to take up the whole window.
    <div style={{ width: '100vw', height: '100vh', background: '#050505' }}>

      {/* 3D SCENE */}
      <Canvas
        camera={{ position: [0, 0, 5], fov: 75 }}
        gl={{ antialias: false, alpha: false }} // Optimizations for high particle count
        dpr={[1, 2]} // Cap pixel ratio for performance on high-DPI screens
      >
        <color attach="background" args={['#050505']} />

        <Suspense fallback={null}>
          {/* Controls Camera Movement */}
          <CameraRig />

          {/* ACTIVE ARTWORK (Foreground) */}
          {activeId && (
            <group position={[0, 0, 0]}>
              <InfiniteCanvas
                activePaintingId={activeId}
                transitionProgress={transitionProgress}
              />
            </group>
          )}

          {/* NEXT ARTWORK (Background / Lookahead) */}
          {nextId && (
            <group position={[0, 0, -20]}>
              <InfiniteCanvas
                activePaintingId={nextId}
                transitionProgress={0}
              />
            </group>
          )}

          {/* LIGHTING (Subtle) */}
          <ambientLight intensity={0.2} />
          <spotLight position={[10, 10, 10]} intensity={1} angle={0.5} penumbra={1} />

        </Suspense>
      </Canvas>
      
      {/* LOADING INDICATOR */}
      <Loader />

      {/* 2D HUD */}
      <Overlay />
    </div>
  );
};

export default App;
