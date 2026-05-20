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

  // Primary path: the walker reads /data/theater/_manifest.json for the list
  // of baked paintings and synthesizes a minimal graph (nodes only, no edges).
  // Fallback: if the theater bake hasn't run yet (manifest missing or empty),
  // load /graph.json — the legacy pareidolia graph — so the gallery degrades
  // to flat textured planes instead of going pitch-black. TheaterPainting
  // renders a single plane from /assets/{image} when no theater.json is
  // present for a node.
  useEffect(() => {
    let cancelled = false;
    const loadFromTheater = fetch('/data/theater/_manifest.json')
      .then(r => (r.ok ? r.json() : []))
      .then(manifest => {
        if (!Array.isArray(manifest) || manifest.length === 0) return null;
        return manifest.map(id => ({ id, image: `${id}.painting.webp`, title: id, theater: true }));
      })
      .catch(() => null);

    const loadFromGraph = () => fetch('/graph.json')
      .then(r => (r.ok ? r.json() : null))
      .then(g => {
        if (!g || !Array.isArray(g.nodes) || g.nodes.length === 0) return null;
        const nodes = g.nodes.map(n => ({ ...n, theater: false }));
        return { nodes, edges: Array.isArray(g.edges) ? g.edges : [] };
      })
      .catch(() => null);

    loadFromTheater
      .then(nodes => {
        if (cancelled) return;
        if (nodes && nodes.length > 0) {
          setGraph({ schemaVersion: 4, nodes, edges: [] });
          setStartNode(nodes[0].id);
          return;
        }
        console.warn("[Scene] theater manifest missing/empty; falling back to graph.json.");
        return loadFromGraph().then(g => {
          if (cancelled) return;
          if (!g) {
            console.error("[Scene] No theater bake and no graph.json — gallery cannot render.");
            return;
          }
          setGraph({ schemaVersion: 2, nodes: g.nodes, edges: g.edges });
          setStartNode(g.nodes[0].id);
        });
      });

    return () => { cancelled = true; };
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
                            image={cluster.image}
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
