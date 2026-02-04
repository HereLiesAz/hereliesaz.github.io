import React, { useEffect, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Loader } from '@react-three/drei';
import useStore from './store/useStore';
import CameraRig from './canvas/CameraRig';
import InfiniteCanvas from './canvas/InfiniteCanvas';
import Overlay from './components/Overlay';

const App = () => {
  const setManifest = useStore(state => state.setManifest);
  const activeId = useStore(state => state.activeId);
  const nextId = useStore(state => state.nextId);
  const transitionProgress = useStore(state => state.transitionProgress);

  // 1. Fetch Manifest on Mount
  useEffect(() => {
    fetch('/manifest.json')
      .then(res => res.json())
      .then(data => {
        setManifest(data.nodes);
      })
      .catch(err => console.error("Manifest Load Failed:", err));
  }, [setManifest]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#050505' }}>
      <Canvas 
        camera={{ position: [0, 0, 5], fov: 75 }}
        gl={{ antialias: false, alpha: false }} // Optimization
        dpr={[1, 2]} // Handle retina screens
      >
        <color attach="background" args={['#050505']} />
        
        <Suspense fallback={null}>
          <CameraRig />
          
          {/* RENDER STRATEGY: 
            We render the "Active" painting and the "Next" painting simultaneously.
            The Shader and CameraRig create the illusion of flying from one to the other.
          */}
          
          {activeId && (
            <group position={[0, 0, 0]}>
              <InfiniteCanvas 
                activePaintingId={activeId} 
                transitionProgress={transitionProgress}
              />
            </group>
          )}

          {nextId && (
            <group position={[0, 0, -20]}> 
              {/* The 'Next' painting sits deeper in Z space.
                Note: In a true infinite system, we would dynamically calculate 
                this position based on the graph, but for this specific effect,
                we place it 'behind' the current one.
              */}
              <InfiniteCanvas 
                activePaintingId={nextId} 
                transitionProgress={0} // It is static until it becomes active
              />
            </group>
          )}
          
          {/* Cinematic Lighting */}
          <ambientLight intensity={0.2} />
          <spotLight position={[10, 10, 10]} intensity={1} angle={0.5} penumbra={1} />
          
        </Suspense>
      </Canvas>
      
      <Loader /> {/* Standard Drei loader for suspense */}
      <Overlay />
    </div>
  );
};

export default App;
