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

  // Load graph + theater manifest in parallel; only walk paintings that
  // actually have baked theater data, so the renderer never 404s.
  useEffect(() => {
    Promise.all([
      fetch('/graph.json').then(r => (r.ok ? r.json() : null)),
      fetch('/data/theater/_manifest.json').then(r => (r.ok ? r.json() : [])).catch(() => []),
    ])
      .then(([graph, manifest]) => {
        if (!graph) return;
        const allowed = new Set(Array.isArray(manifest) ? manifest : []);
        const filtered = allowed.size > 0
          ? {
              ...graph,
              nodes: (graph.nodes || []).filter(n => allowed.has(n.id)),
              edges: (graph.edges || []).filter(e => allowed.has(e.source) && allowed.has(e.target)),
            }
          : graph;
        setGraph(filtered);
        if (filtered.nodes && filtered.nodes.length > 0) {
          setStartNode(filtered.nodes[0].id);
        } else {
          console.warn("[Scene] No nodes available after manifest filter; check public/data/theater/_manifest.json.");
        }
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
