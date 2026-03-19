import React, { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { ScrollControls, PerspectiveCamera } from '@react-three/drei';
import { useStore } from '../store/useStore';
import AnamorphicCam from './AnamorphicCam';
import ShardCloud from './ShardCloud';

export default function Scene() {
  const activeClusters = useStore(state => state.activeClusters);
  const setGraph = useStore(state => state.setGraph);
  const setStartNode = useStore(state => state.setStartNode);

  // Load Graph Data
  useEffect(() => {
    fetch('/graph.json')
      .then(res => res.json())
      .then(data => {
        setGraph(data);
        if (data.nodes && data.nodes.length > 0) {
            setStartNode(data.nodes[0].id);
        }
      })
      .catch(err => console.error("Graph Load Error:", err));
  }, [setGraph, setStartNode]);

  return (
    <Canvas 
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#050505']} />
      
      <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={50} />
      
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />

      <ScrollControls pages={6} damping={0.2}>
        <AnamorphicCam />
        <Suspense fallback={null}>
            <group>
                {activeClusters.map((cluster, index) => (
                    <ShardCloud 
                        key={`${cluster.id}-${index}`}
                        id={cluster.id} 
                        position={cluster.worldPos} 
                        isCurrent={index === 0} 
                    />
                ))}
            </group>
        </Suspense>
      </ScrollControls>
    </Canvas>
  );
}
