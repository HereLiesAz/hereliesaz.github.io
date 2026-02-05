/**
 * OVERLAY COMPONENT
 * =================
 * The 2D Heads-Up Display (HUD).
 * Renders the interface elements on top of the 3D canvas.
 * Includes the Signature, Info Panel, and Glass Menu.
 *
 * This component handles standard HTML/CSS rendering, bypassing the Three.js canvas.
 */

// React Imports
import React from 'react';

// State Management
import useStore from '../store/useStore';

const Overlay = () => {
  // --- STATE ACCESS ---
  // We subscribe to specific changes in the store.

  // The ID of the current artwork (to display title).
  const activeId = useStore(state => state.activeId);

  // The full graph data (to look up details about activeId).
  const graph = useStore(state => state.graph);

  // The travel progress (used to fade UI out during flight).
  const transitionProgress = useStore(state => state.transitionProgress);

  // Menu visibility state.
  const showMenu = useStore(state => state.showMenu);

  // Action to toggle menu.
  const toggleMenu = useStore(state => state.toggleMenu);
  
  // Get the actual data object for the current artwork.
  const activeNode = graph[activeId];
  
  // --- OPACITY CALCULATION ---
  // We want the UI to fade out when the user is "flying" between artworks.
  // - At 0.0 (Sweet Spot): Opacity 1.0
  // - At >0.2 (Moving): Opacity 0.0
  // Formula: Max(0, 1 - (progress * 5))
  // - If progress is 0.1, result is 0.5.
  // - If progress is 0.2, result is 0.0.
  const infoOpacity = Math.max(0, 1 - (transitionProgress * 5));

  return (
    // Main Container
    <div className="overlay-container">

      {/* 1. SIGNATURE (Top Left) */}
      {/* Serves as the branding and the Menu Button. */}
      <div 
        className="signature"
        onClick={toggleMenu}
        style={{ cursor: 'pointer', pointerEvents: 'auto' }} // Ensure clicks work
      >
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 300, letterSpacing: '0.2em' }}>
          HereLiesAz
        </h1>
      </div>

      {/* 2. INFO PANEL (Bottom Center) */}
      {/* Displays Title and Metadata of the current artwork. */}
      {/* Only renders if we have valid node data. */}
      {activeNode && (
        <div 
          className="info-panel"
          style={{ opacity: infoOpacity }} // Bind dynamic opacity
        >
          {/* Title: Display ID (splitting at ~ to remove versioning if present) */}
          <h2 style={{ fontSize: '1rem', fontWeight: 600, textTransform: 'uppercase' }}>
            {activeNode.id.split('~')[0]}
          </h2>
          {/* Metadata: Stroke Count and Resolution */}
          <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>
            {activeNode.stroke_count} STROKES // {activeNode.resolution[0]}x{activeNode.resolution[1]}
          </p>
        </div>
      )}

      {/* 3. GLASS MENU (Modal) */}
      {/* Fullscreen navigation overlay. */}
      {showMenu && (
        <div className="glass-modal">
          <div className="glass-content">
             {/* Close Button */}
             <button className="close-btn" onClick={toggleMenu}>×</button>

             {/* Manifesto / Content */}
             <h2>Manifesto</h2>
             <p>
               The canvas is infinite. The paint is data.
               We are merely pattern matching in the void.
             </p>

             {/* External Links */}
             <ul className="links">
               <li><a href="#">Github</a></li>
               <li><a href="#">Instagram</a></li>
               <li><a href="#">Email</a></li>
             </ul>
          </div>
        </div>
      )}
    </div>
  );
};

// --- CSS INJECTION ---
// For a small portfolio, injecting styles via JS is portable and easy.
// In a larger app, we would use CSS Modules or Styled Components.
const styles = `
  /* Container spans the whole screen but lets clicks pass through */
  .overlay-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none; /* Crucial: Allows clicking the 3D canvas behind */
    color: #eee;
    font-family: 'Courier New', Courier, monospace;
    padding: 2rem;
    box-sizing: border-box;
  }
  
  /* Top-left positioning for signature */
  .signature {
    position: absolute;
    top: 2rem;
    left: 2rem;
    text-shadow: 0 0 10px rgba(0,0,0,0.5); /* Improve readability */
  }
  
  /* Bottom-center positioning for info */
  .info-panel {
    position: absolute;
    bottom: 2rem;
    width: 100%;
    text-align: center;
    transition: opacity 0.2s ease; /* Smooth fade */
    text-shadow: 0 0 10px rgba(0,0,0,0.8);
  }

  /* Fullscreen Backdrop Blur for Modal */
  .glass-modal {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    background: rgba(0, 0, 0, 0.4); /* Dark dim */
    pointer-events: auto; /* Re-enable clicks for the menu */
    backdrop-filter: blur(10px); /* The "Frosted Glass" effect */
    z-index: 100; /* Ensure it's on top of everything */
  }

  /* The actual menu box */
  .glass-content {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1); /* Subtle border */
    padding: 3rem;
    max-width: 400px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5); /* Deep shadow */
    position: relative;
  }
  
  .close-btn {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: none;
    border: none;
    color: white;
    font-size: 1.5rem;
    cursor: pointer;
  }
  
  .links {
    list-style: none;
    padding: 0;
    margin-top: 2rem;
  }
  
  .links li { margin: 0.5rem 0; }
  .links a { color: white; text-decoration: none; border-bottom: 1px solid transparent; }
  .links a:hover { border-bottom: 1px solid white; }
`;

// Append styles dynamically to the document head
const styleSheet = document.createElement("style");
styleSheet.innerText = styles;
document.head.appendChild(styleSheet);

export default Overlay;
