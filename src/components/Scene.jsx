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

  // Load the theater graph — nodes for everything baked, edges weighted
  // by pareidolia (shared-blotch) similarity. Falls back to legacy
  // /graph.json + manifest filtering if the theater graph is missing.
  useEffect(() => {
    fetch('/data/theater/graph.theater.json')
      .then(r => (r.ok ? r.json() : null))
      .then(graph => {
        if (graph && Array.isArray(graph.nodes) && graph.nodes.length > 0) {
          setGraph(graph);
          setStartNode(graph.nodes[0].id);
          return;
        }
        // Legacy fallback.
        return Promise.all([
          fetch('/graph.json').then(r => (r.ok ? r.json() : null)),
          fetch('/data/theater/_manifest.json').then(r => (r.ok ? r.json() : [])).catch(() => []),
        ]).then(([legacy, manifest]) => {
          if (!legacy) return;
          const allowed = new Set(Array.isArray(manifest) ? manifest : []);
          const filtered = allowed.size > 0
            ? {
                ...legacy,
                nodes: (legacy.nodes || []).filter(n => allowed.has(n.id)),
                edges: (legacy.edges || []).filter(e => allowed.has(e.source) && allowed.has(e.target)),
              }
            : legacy;
          setGraph(filtered);
          if (filtered.nodes && filtered.nodes.length > 0) {
            setStartNode(filtered.nodes[0].id);
          } else {
            console.warn("[Scene] No paintings available; bake some via scripts/theater_baker.py.");
          }
        });
      })
      .catch(err => console.error("Graph Load Error:", err));
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
