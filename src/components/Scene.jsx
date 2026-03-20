import React, { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { useStore } from '../store/useStore';
import CameraController from './CameraController';
import VoidField from './VoidField';

export default function Scene() {
  const setGraph    = useStore(s => s.setGraph);
  const initSession = useStore(s => s.initSession);
  const nodes       = useStore(s => s.nodes);

  // Load graph
  useEffect(() => {
    fetch('/graph.json')
      .then(r => r.json())
      .then(data => {
        setGraph(data);
      })
      .catch(err => console.error('Graph load error:', err));
  }, [setGraph]);

  // Init session once nodes are loaded
  useEffect(() => {
    if (nodes.length > 0) initSession();
  }, [nodes.length]);

  return (
    <Canvas gl={{ antialias: true }} dpr={[1, 2]}>
      <color attach="background" args={['#050505']} />
      <PerspectiveCamera makeDefault position={[0, 0, 10]} fov={50} near={0.01} far={2000} />
      <CameraController />
      <Suspense fallback={null}>
        <VoidField />
      </Suspense>
    </Canvas>
  );
}