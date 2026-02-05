/**
 * APP COMPONENT
 * =============
 * The root React component.
 * Responsible for:
 * 1. Bootstrapping the application.
 * 2. Fetching the manifest.json.
 * 3. Initializing the Zustand store.
 * 4. Rendering the UI and the 3D Canvas.
 */

import { useEffect, useState } from 'react';
import InfiniteVoid from './canvas/InfiniteVoid';
import Interface from './ui/Interface';
import useStore from './store/useStore';

function App() {
  // Local loading state
  const [loaded, setLoaded] = useState(false);

  // Access store actions
  const setManifest = useStore(state => state.setManifest);

  // --- BOOTSTRAP ---
  useEffect(() => {
    // 1. Fetch the Manifest
    // This file contains the graph of all artworks.
    fetch('/manifest.json')
      .then(res => res.json())
      .then(data => {
        // 2. Hydrate the Store
        // The store will calculate the initial path and setup the graph.
        setManifest(data.nodes);
        
        // 3. Signal Ready
        setLoaded(true);
      })
      .catch(err => {
        console.error("Failed to load manifest:", err);
      });
  }, [setManifest]);

  if (!loaded) {
    return (
      <div className="loader">
        <h1>INITIALIZING VOID...</h1>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* The 2D UI Overlay (HUD) */}
      <Interface />

      {/* The 3D Scene */}
      <InfiniteVoid />
      
      {/* Background Audio (Optional) */}
      <audio loop>
        <source src="/ambient_hum.mp3" type="audio/mpeg" />
      </audio>
    </div>
  );
}

export default App;
