import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Route, Switch } from 'wouter';
import Scene from './components/Scene';
import Overlay from './components/Overlay';
import { Loader } from '@react-three/drei';
import { useStore } from './store/useStore';

// Lazy: a normal gallery visitor never pulls either of these bundles in.
// /admin is intentionally not linked anywhere in the gallery UI — reached
// only by navigating to it directly (see docs/FRONTEND.md).
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));
const ProjectsPage = lazy(() => import('./projects/ProjectsPage.jsx'));

const RouteFallback = () => (
  <div style={{
    position: 'fixed', inset: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#000', color: '#f4f0e6',
    fontFamily: 'monospace', letterSpacing: '2px', fontSize: '0.8rem',
    textTransform: 'uppercase',
  }}>
    loading…
  </div>
);

// How long to keep the boot indicator mounted after the store reports
// itself ready, so the opacity transition below actually gets to play
// out instead of the element vanishing mid-fade.
const BOOT_FADE_MS = 500;
// Absolute safety net: never let the boot indicator hang forever even if
// the "ready" signal never arrives (e.g. both the theater manifest fetch
// and the graph.json fallback fail). At that point Scene.jsx has already
// logged an error to the console; the indicator just gets out of the way.
const BOOT_MAX_MS = 20000;

// The gallery experience, unchanged from before routing was added — this
// is still what mounts at "/".
const Gallery = () => {
  const sceneContainerRef = useRef(null);
  const [contextLost, setContextLost] = useState(false);

  // finding 1: no signal exists between "the page loaded" and "the first
  // painting texture resolved" — the manifest + hinge-graph fetches in
  // Scene.jsx aren't routed through THREE.DefaultLoadingManager, so
  // drei's <Loader/> below stays invisible through that whole window.
  // useStore is owned by another agent, but it's readable here without
  // touching it: `nodes` flips non-empty once the graph fetch resolves,
  // `activeClusters` flips non-empty once setStartNode has placed the
  // first painting cluster. Both together are a reasonable "the scene
  // has real data and is about to paint" signal.
  const nodes = useStore((state) => state.nodes);
  const activeClusters = useStore((state) => state.activeClusters);
  const ready = nodes.length > 0 && activeClusters.length > 0;
  // On total data loss, Scene.jsx sets this within roughly one fetch
  // round-trip — far sooner than BOOT_MAX_MS below. Without reacting to it
  // here too, the opaque boot screen (z-index 8000) sat in front of
  // Overlay's already-rendered error message for the full 20s, showing a
  // false "still loading" signal over an error that was ready almost
  // instantly.
  const loadError = useStore((state) => state.loadError);

  const [bootVisible, setBootVisible] = useState(true);
  const [bootFading, setBootFading] = useState(false);

  useEffect(() => {
    if (!ready && !loadError) return undefined;
    setBootFading(true);
    const hideTimer = setTimeout(() => setBootVisible(false), BOOT_FADE_MS);
    return () => clearTimeout(hideTimer);
  }, [ready, loadError]);

  useEffect(() => {
    const maxTimer = setTimeout(() => {
      setBootFading(true);
      setTimeout(() => setBootVisible(false), BOOT_FADE_MS);
    }, BOOT_MAX_MS);
    return () => clearTimeout(maxTimer);
  }, []);

  // finding 2: no webglcontextlost/webglcontextrestored handling exists
  // anywhere, so a GPU driver reset or mobile tab backgrounding silently
  // freezes the canvas with zero indication. Scene.jsx (not owned here)
  // renders the <Canvas/>, so instead of wiring R3F's onCreated callback
  // we poll briefly for the <canvas> DOM node inside our container ref
  // and attach the listeners directly once it exists.
  useEffect(() => {
    let canvasEl = null;

    const onContextLost = (event) => {
      // Per spec: preventDefault() so the browser attempts to restore
      // the context instead of abandoning it permanently.
      event.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => setContextLost(false);

    let attempts = 0;
    const pollInterval = setInterval(() => {
      attempts += 1;
      const el = sceneContainerRef.current?.querySelector('canvas');
      if (el) {
        canvasEl = el;
        canvasEl.addEventListener('webglcontextlost', onContextLost, false);
        canvasEl.addEventListener('webglcontextrestored', onContextRestored, false);
        clearInterval(pollInterval);
      } else if (attempts > 200) {
        // ~20s safety cutoff — give up polling if no canvas ever appears.
        clearInterval(pollInterval);
      }
    }, 100);

    return () => {
      clearInterval(pollInterval);
      if (canvasEl) {
        canvasEl.removeEventListener('webglcontextlost', onContextLost);
        canvasEl.removeEventListener('webglcontextrestored', onContextRestored);
      }
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', background: '#000' }}>
      <style>{`
        @keyframes jules-boot-pulse {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 1; }
        }
        .jules-boot-dot {
          animation: jules-boot-pulse 1.1s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .jules-boot-dot { animation: none; opacity: 0.8; }
        }
      `}</style>

      {/* 3D Scene */}
      <div ref={sceneContainerRef} style={{ width: '100%', height: '100%' }}>
        <Scene />
      </div>

      {/* Loading Screen: drei's texture-load progress bar, restyled from
          its default full-screen opaque block into a small, non-blocking
          corner readout. THREE.DefaultLoadingManager-tracked loads fire for
          every painting's texture fetch, not just the first — the default
          styling would otherwise blank the entire scene (camera dive,
          overlay, everything) for as long as ANY subsequent painting's
          texture takes over ~300ms to arrive, which is a normal occurrence
          mid-scroll, not just at boot. */}
      <Loader
        containerStyles={{
          position: 'fixed',
          top: 'auto',
          left: 'auto',
          bottom: '1.6rem',
          right: '1.8rem',
          width: 'auto',
          height: 'auto',
          background: 'transparent',
          pointerEvents: 'none',
          zIndex: 6000,
        }}
        innerStyles={{
          width: 80,
          height: 2,
          background: 'rgba(244, 240, 230, 0.15)',
        }}
        barStyles={{
          background: '#f4f0e6',
        }}
        dataStyles={{
          color: '#f4f0e6',
          fontSize: '0.6rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginTop: '0.5rem',
          fontFamily: 'monospace',
        }}
      />

      {/* Boot indicator: covers the black window between first paint and
          the scene reporting real data, which the Loader above can't see. */}
      {bootVisible && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            background: '#000',
            color: '#f4f0e6',
            fontFamily: 'monospace',
            letterSpacing: '2px',
            fontSize: '0.8rem',
            textTransform: 'uppercase',
            zIndex: 8000,
            pointerEvents: 'none',
            opacity: bootFading ? 0 : 1,
            transition: `opacity ${BOOT_FADE_MS}ms ease`,
          }}
        >
          <span className="jules-boot-dot">●</span>
          <span>loading the gallery…</span>
        </div>
      )}

      {/* WebGL context-loss notice */}
      {contextLost && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.85)',
            color: '#f4f0e6',
            fontFamily: 'monospace',
            letterSpacing: '1px',
            fontSize: '0.9rem',
            textTransform: 'uppercase',
            zIndex: 8500,
          }}
        >
          reconnecting…
        </div>
      )}

      {/* UI Overlay */}
      <Overlay />
    </div>
  );
};

const App = () => (
  <Switch>
    <Route path="/projects">
      <Suspense fallback={<RouteFallback />}><ProjectsPage /></Suspense>
    </Route>
    <Route path="/admin">
      <Suspense fallback={<RouteFallback />}><AdminApp /></Suspense>
    </Route>
    <Route path="/admin/:rest*">
      <Suspense fallback={<RouteFallback />}><AdminApp /></Suspense>
    </Route>
    <Route><Gallery /></Route>
  </Switch>
);

export default App;
