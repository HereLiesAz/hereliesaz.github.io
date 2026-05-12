import React, { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { ScrollControls, PerspectiveCamera } from '@react-three/drei';
import { useStore } from '../store/useStore';
import AnamorphicCam from './AnamorphicCam';
import TheaterPainting from './TheaterPainting';

export default function Scene() {
  const activeClusters = useStore(state => state.activeClusters);
  const setGraph = useStore(state => state.setGraph);
  const setStartNode = useStore(state => state.setStartNode);

  // The walker reads /data/theater/_manifest.json for the list of baked
  // paintings and synthesizes a minimal graph (nodes only, no edges) — the
  // store's stochastic next-node picker falls back to random-other-node
  // when an id has no outgoing edges, which is exactly what we want until
  // a pareidolia indexer for the new layered schema lands.
  useEffect(() => {
    fetch('/data/theater/_manifest.json')
      .then(r => (r.ok ? r.json() : []))
      .then(manifest => {
        if (!Array.isArray(manifest) || manifest.length === 0) {
          console.warn("[Scene] _manifest.json is empty; bake some paintings via scripts/theater_baker.py.");
          return;
        }
        const nodes = manifest.map(id => ({ id, image: `${id}.painting.webp`, title: id }));
        setGraph({ schemaVersion: 4, nodes, edges: [] });
        setStartNode(nodes[0].id);
      })
      .catch(err => console.error("Manifest Load Error:", err));
  }, [setGraph, setStartNode]);

  const currentSegmentIndex = useStore(state => state.currentSegmentIndex);

  return (
    <Canvas 
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#000000']} />
      
      <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={50} near={0.01} />
      
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      
      {/* 100 pages = 25 artworks at 4 pages/each */}
      <ScrollControls pages={100} damping={0.2}>
        <AnamorphicCam />
        <Suspense fallback={null}>
            <group>
                {activeClusters
                    .map((cluster, index) => ({ ...cluster, index }))
                    .filter(c => c.index >= currentSegmentIndex - 1 && c.index <= currentSegmentIndex + 2)
                    .map((cluster) => (
                        <TheaterPainting
                            key={`${cluster.id}-${cluster.index}`}
                            id={cluster.id}
                            position={cluster.worldPos}
                            rotation={cluster.rotSway}
                            mySegmentIndex={cluster.index}
                        />
                    ))
                }
            </group>
        </Suspense>
      </ScrollControls>
    </Canvas>
  );
}
