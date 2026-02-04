import React, { useEffect, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Loader } from '@react-three/drei';
import useStore from './store/useStore';
import CameraRig from './canvas/CameraRig';
import InfiniteCanvas from './canvas/InfiniteCanvas';
import Overlay from './components/Overlay';

const App = () => {
  const setManifest = useStore(state => state.setManifest);
  const setActiveId = useStore(state => state.setActiveId);
  const activeId = useStore(state => state.activeId);
  const nextId = useStore(state => state.nextId);
  const transitionProgress = useStore(state => state.transitionProgress);

  // 1. Fetch Manifest on Mount & Randomize Start
  useEffect(() => {
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

        setManifest(data.nodes);

        // Chaos selection: Pick a random starting point
        const keys = Object.keys(data.nodes);
        const randomId = keys[Math.floor(Math.random() * keys.length)];
        
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
    <div style={{ width: '100vw', height: '100vh', background: '#050505' }}>
      <Canvas 
        camera={{ position: [0, 0, 5], fov: 75 }}
        gl={{ antialias: false, alpha: false }}
        dpr={[1, 2]} 
      >
        <color attach="background" args={['#050505']} />
        
        <Suspense fallback={null}>
          <CameraRig />
          
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
              <InfiniteCanvas 
                activePaintingId={nextId} 
                transitionProgress={0} 
              />
            </group>
          )}
          
          <ambientLight intensity={0.2} />
          <spotLight position={[10, 10, 10]} intensity={1} angle={0.5} penumbra={1} />
          
        </Suspense>
      </Canvas>
      
      <Loader />
      <Overlay />
    </div>
  );
};

export default App;
