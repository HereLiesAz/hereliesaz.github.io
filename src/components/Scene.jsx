import React, { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { ScrollControls, PerspectiveCamera } from '@react-three/drei';
import { useStore } from '../store/useStore';
import AnamorphicCam, { PAGES_PER_SEGMENT } from './AnamorphicCam';
import TheaterPainting, { bgSweepLevel } from './TheaterPainting';
import TexturePreloader from './TexturePreloader';
import { CAMERA_FOV_DEG } from '../sceneConstants';

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
  // Built imperatively (not via JSX <shaderMaterial uniforms={...}>) for the
  // same reason TheaterPainting's flat materials are: a plain uniforms object
  // literal in JSX has no .set()/.copy(), so react-three-fiber's applyProps
  // falls through to `currentInstance.uniforms = value` on every re-render —
  // wholesale REPLACING the uniforms object, including whatever this
  // component's own useFrame just wrote into it. Scene re-renders on every
  // updateFrame() (i.e. continuously during scroll), which was silently
  // stomping uLevel back to its initial 0 almost every frame — the sweep
  // was computing correctly and never reaching the screen. A stable,
  // useMemo'd material sidesteps prop-diffing entirely: the mutation below
  // is the only thing that ever touches uLevel.
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: bgWipeVS,
    fragmentShader: bgWipeFS,
    uniforms: { uLevel: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => { material.uniforms.uLevel.value = bgSweepLevel(); });
  return (
    <mesh frustumCulled={false} renderOrder={-1000} material={material}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

export default function Scene() {
  const activeClusters = useStore(state => state.activeClusters);
  const setGraph = useStore(state => state.setGraph);
  const setStartNode = useStore(state => state.setStartNode);
  const setLoadError = useStore(state => state.setLoadError);
  const setMeta = useStore(state => state.setMeta);
  const nodeCount = useStore(state => state.nodes.length);

  // Hand-authored title/description/tags/price, edited via /admin. Best
  // effort: a missing or malformed file just leaves every painting on its
  // raw-id fallback (see Overlay.jsx), same as before this existed.
  useEffect(() => {
    let cancelled = false;
    fetch('/assets/meta.json')
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then(meta => { if (!cancelled) setMeta(meta); });
    return () => { cancelled = true; };
  }, [setMeta]);

  // A window resize changes computeFitScale's result (see useStore.jsx),
  // which the already-built activeClusters/segments chain baked in at
  // build time — so without this, a resize (or device rotation) leaves
  // the camera's dive path and the paintings' world positions pointing at
  // where they USED to belong instead of where TheaterPainting's own live
  // fitScale actually draws them. Debounced since 'resize' fires
  // continuously during a drag-resize and recomputing the whole chain on
  // every single event would be wasted work.
  useEffect(() => {
    let t = null;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => useStore.getState().recomputePlacements(), 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(t);
    };
  }, []);

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
            // Total data loss: neither source produced any nodes. Record
            // it in the store so the UI (Overlay) can show something
            // instead of a silent, permanently black screen — nodes/edges
            // stay at their empty defaults forever otherwise.
            console.error("[Scene] No theater bake and no graph.json — gallery cannot render.");
            setLoadError("Unable to load gallery — please refresh.");
            return;
          }
          setGraph({ schemaVersion: 2, nodes: g.nodes, edges: g.edges });
          setStartNode(pickStart(g.nodes));
        });
      });

    return () => { cancelled = true; };
  }, [setGraph, setStartNode, setLoadError]);

  const currentSegmentIndex = useStore(state => state.currentSegmentIndex);

  // <ScrollControls pages> sets the hard ceiling on how much of the
  // gallery a single full scroll can ever reach (see AnamorphicCam's
  // totalProgress = scroll.offset * pages / PAGES_PER_SEGMENT, clamped
  // at segments.length). It must scale with the actual corpus size, not
  // sit at a fixed constant — a fixed 250 pages / 10 pages-per-segment
  // caps a full scroll at exactly 25 segments no matter how large the
  // baked graph is, leaving anything beyond that permanently
  // unreachable. Three full "coverage passes" worth of segments gives
  // the random walk very good odds of visiting close to the full corpus
  // in one scroll. Falls back to the old constant until nodeCount is
  // known (0 before the graph loads); once it is, drei's ScrollControls
  // is remounted (via `key`) so it picks up the new `pages` prop.
  const pages = nodeCount > 0
    ? Math.max(250, nodeCount * PAGES_PER_SEGMENT * 3)
    : 250;

  return (
   <>
    <TexturePreloader />
    <Canvas
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#000000']} />
      <BackgroundSweep />

      <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={CAMERA_FOV_DEG} near={0.01} />
      
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      
      {/* pages scales with the corpus (see `pages` above) so a full
          scroll can reach close to the whole graph, at PAGES_PER_SEGMENT
          pages per segment (see AnamorphicCam). Long per-segment scroll:
          deliberate scrub + load head-room. Keyed on `pages` so drei's
          ScrollControls remounts and picks up the real value once the
          graph has loaded, instead of staying pinned to the initial
          fallback. */}
      <ScrollControls key={pages} pages={pages} damping={0.12}>
        <AnamorphicCam />
        <Suspense fallback={null}>
            <group>
                {/* Only three paintings are ever mounted: the one we're
                    on (currentSegmentIndex), the one we're headed
                    toward (+1), and the one we just left (−1). The −1
                    slot is fully invisible for the whole time it's
                    mounted during the active segment (fade=0,
                    wipeReveal=0) — it's not there to save draw calls,
                    it's backward-scroll insurance: keeping it mounted
                    (and its texture warm) means scrolling back up
                    re-reveals it instantly instead of popping in from a
                    cold mount. Neighbours just outside this window are
                    warmed by <TexturePreloader/> so the handoff hits
                    cache, not a cold fetch. */}
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
