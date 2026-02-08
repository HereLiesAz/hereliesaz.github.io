import React, { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { ScrollControls } from '@react-three/drei';
import { useStore } from '../store/useStore';
import AnamorphicCam from './AnamorphicCam';
import ShardCloud from './ShardCloud';

export default function Scene() {
  const activeId = useStore(state => state.currentNodeId);
  const nextId = useStore(state => state.nextNodeId);
  const setGraph = useStore(state => state.setGraph);
  const setStartNode = useStore(state => state.setStartNode);

  // Load Graph Data
  useEffect(() => {
    fetch('/graph.json')
      .then(res => res.json())
      .then(data => {
        setGraph(data);
        // Start somewhere
        if (data.nodes && data.nodes.length > 0) {
            setStartNode(data.nodes[0].id);
        }
      })
      .catch(err => console.error("Graph Load Error:", err));
  }, [setGraph, setStartNode]);

  return (
    <Canvas 
      camera={{ position: [0, 0, 10], fov: 75 }}
      gl={{ antialias: false, alpha: false }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#050505']} />
      
      <Suspense fallback={null}>
        <ScrollControls pages={2} damping={0.2}>
            
            {/* The Camera Logic */}
            <AnamorphicCam />
            
            {/* Current Artwork (Anchored at 0,0,0) */}
            {activeId && (
                <ShardCloud id={activeId} position={[0, 0, 0]} rotation={[0, 0, 0]} />
            )}
            
            {/* Next Artwork (Floating ahead at 0,0,-20) */}
            {nextId && (
                <ShardCloud id={nextId} position={[0, 0, -20]} rotation={[0, 0, 0]} />
            )}

            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} intensity={1} />
        
        </ScrollControls>
      </Suspense>
    </Canvas>
  );
}
