import React, { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { ScrollControls, PerspectiveCamera } from '@react-three/drei';
import { useStore } from '../store/useStore';
import AnamorphicCam from './AnamorphicCam';
import TheaterPainting from './TheaterPainting';
import TexturePreloader from './TexturePreloader';

export default function Scene() {
  const activeClusters = useStore(state => state.activeClusters);
  const setGraph = useStore(state => state.setGraph);
  const setStartNode = useStore(state => state.setStartNode);

  // Primary path: the walker reads /data/theater/_manifest.json for the list
  // of baked paintings, plus /data/theater/graph.theater.json — the
  // pareidolia hinge graph (schemaVersion 5) whose edges carry the shared
  // patch (s_uv/t_uv) each transition pivots on and whose nodes carry the
  // painting dimensions the walker needs to align those patches in world
  // space. Missing graph → nodes only, no edges (random walk, centered
  // approach). Fallback: if the theater bake hasn't run at all, load
  // /graph.json — the legacy graph — so the gallery degrades to flat
  // textured planes instead of going pitch-black.
  useEffect(() => {
    let cancelled = false;
    const loadFromTheater = Promise.all([
      fetch('/data/theater/_manifest.json')
        .then(r => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch('/data/theater/graph.theater.json')
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([manifest, hingeGraph]) => {
        if (!Array.isArray(manifest) || manifest.length === 0) return null;
        const dims = new Map(
          (hingeGraph?.nodes || []).map(n => [n.id, n]));
        const nodes = manifest.map(id => ({
          id,
          image: "/data/theater/" + encodeURIComponent(id) + ".painting.webp",
          title: id,
          theater: true,
          width: dims.get(id)?.width,
          height: dims.get(id)?.height,
        }));
        const ids = new Set(manifest);
        const edges = (hingeGraph?.edges || []).filter(
          e => ids.has(e.source) && ids.has(e.target));
        return { nodes, edges };
      })
      .catch(() => null);

    const loadFromGraph = () => fetch('/graph.json')
      .then(r => (r.ok ? r.json() : null))
      .then(g => {
        if (!g || !Array.isArray(g.nodes) || g.nodes.length === 0) return null;
        const nodes = g.nodes.map(n => ({ ...n, image: "/assets/" + encodeURIComponent(n.image), theater: false }));
        return { nodes, edges: Array.isArray(g.edges) ? g.edges : [] };
      })
      .catch(() => null);

    // Pick a random starting painting so every visit begins somewhere
    // different — the corpus is small enough that a deterministic
    // nodes[0] made repeat visits feel like a fixed lobby.
    const pickStart = (nodes) => nodes[Math.floor(Math.random() * nodes.length)].id;

    loadFromTheater
      .then(theater => {
        if (cancelled) return;
        if (theater && theater.nodes.length > 0) {
          setGraph({ schemaVersion: 5, nodes: theater.nodes, edges: theater.edges });
          setStartNode(pickStart(theater.nodes));
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
          setStartNode(pickStart(g.nodes));
        });
      });

    return () => { cancelled = true; };
  }, [setGraph, setStartNode]);

  const currentSegmentIndex = useStore(state => state.currentSegmentIndex);

  return (
   <>
    <TexturePreloader />
    <Canvas
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#000000']} />
      
      <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={50} near={0.01} />
      
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      
      {/* 250 pages = 25 segments at 10 pages/each (see PAGES_PER_SEGMENT
          in AnamorphicCam). Long per-segment scroll: deliberate scrub +
          load head-room. */}
      <ScrollControls pages={250} damping={0.12}>
        <AnamorphicCam />
        <Suspense fallback={null}>
            <group>
                {/* Only three paintings are ever mounted: the one we're
                    on (currentSegmentIndex), the one we just left
                    (−1), and the one we're headed toward (+1). The
                    scheduled cross-fade already drops a painting to zero
                    once it's a full segment away, so mounting anything
                    wider only spends draw calls and texture uploads on
                    things that are invisible. Neighbours just outside
                    this window are warmed by <TexturePreloader/> so the
                    handoff hits cache, not a cold fetch. */}
                {activeClusters
                    .map((cluster, index) => ({ ...cluster, index }))
                    .filter(c => c.index >= currentSegmentIndex - 1 && c.index <= currentSegmentIndex + 1)
                    .map((cluster) => (
                        <TheaterPainting
                            key={`${cluster.id}-${cluster.index}`}
                            id={cluster.id}
                            image={cluster.image}
                            position={cluster.position || cluster.worldPos || [0, 0, 0]}
                            rotation={cluster.rotation || cluster.rotSway || [0, 0, 0]}
                            mySegmentIndex={cluster.index}
                        />
                    ))
                }
            </group>
        </Suspense>
      </ScrollControls>
    </Canvas>
   </>
  );
}
