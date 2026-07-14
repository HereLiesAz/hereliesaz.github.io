import React, { Suspense, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ScrollControls, PerspectiveCamera } from '@react-three/drei';
import { useStore } from '../store/useStore';
import AnamorphicCam from './AnamorphicCam';
import TheaterPainting, { bgSweepLevel } from './TheaterPainting';
import TexturePreloader from './TexturePreloader';

// Drives the whole-site background from black to white as a light-background
// (paper) piece coalesces, and back as it leaves. Rather than a uniform level,
// it's a SCREEN-SPACE wipe: white grows across the frame behind a torn moving
// boundary (uLevel), black ahead of it. The void itself lightens — no bounded
// plane, so no rectangle — and the moving edge is where the shards sweep past,
// so it reads as shard-revealed rather than a fade. Dark pieces report 0, so
// the frame stays fully black for them.
const bgWipeVS = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;
const bgWipeFS = `
precision highp float;
uniform float uLevel;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
void main(){
  // White where the wipe has passed (vUv.x < uLevel), black ahead; torn edge
  // so the boundary reads as ripped paper, not a razor line. uLevel 0 = all
  // black, 1 = all white.
  float torn = (noise(vUv * 7.0) - 0.5) * 0.05 + (noise(vUv * 23.0) - 0.5) * 0.02;
  float g = 1.0 - smoothstep(uLevel - 0.02, uLevel + 0.02, vUv.x + torn);
  gl_FragColor = vec4(vec3(g), 1.0);
}
`;
function BackgroundSweep() {
  const matRef = React.useRef();
  useFrame(() => {
    if (matRef.current) matRef.current.uniforms.uLevel.value = bgSweepLevel();
  });
  return (
    <mesh frustumCulled={false} renderOrder={-1000}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={bgWipeVS}
        fragmentShader={bgWipeFS}
        uniforms={{ uLevel: { value: 0 } }}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

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
      <BackgroundSweep />

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
