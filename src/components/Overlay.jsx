import React, { useEffect } from 'react';
import useStore from '../store/useStore';

const Overlay = () => {
  const history = useStore(state => state.history);
  const historyPosition = useStore(state => state.historyPosition);
  const nodes = useStore(state => state.nodes);
  const transitionProgress = useStore(state => state.transitionProgress);
  const showMenu = useStore(state => state.showMenu);
  const toggleMenu = useStore(state => state.toggleMenu);
  
  const currentEntry = history[historyPosition];
  const activeNode   = currentEntry ? nodes.find(n => n.id === currentEntry.id) : null;
  
  // Calculate Opacity for Info: only visible near sweet spots (t < 0.25)
  // We use a steep power curve for an "ethereal" fade
  const infoOpacity = Math.max(0, Math.pow(1 - transitionProgress * 4.0, 2.0));

  // CSS Injection
  useEffect(() => {
    const styles = `
      .overlay-root {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        color: rgba(255, 255, 255, 0.85);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
      }
      
      .signature-layer {
        position: absolute;
        top: 2rem; left: 2rem;
        pointer-events: auto;
        cursor: pointer;
        transition: opacity 0.5s ease;
      }
      
      .signature-text {
        font-family: 'Courier New', Courier, monospace;
        font-weight: 300;
        font-size: 1.5rem;
        letter-spacing: 0.2em;
        opacity: 0.8;
        transition: opacity 0.3s ease;
      }
      .signature-layer:hover .signature-text { opacity: 1.0; }
      
      .info-layer {
        position: absolute;
        bottom: 4rem;
        left: 0; width: 100%;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
      }
      
      .artwork-title {
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.4em;
        opacity: 0.9;
        font-weight: 300;
      }
      
      .artwork-meta {
        font-size: 0.7rem;
        letter-spacing: 0.2em;
        opacity: 0.4;
        font-weight: 300;
      }

      .glass-modal-overlay {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        background: rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(25px);
        -webkit-backdrop-filter: blur(25px);
        pointer-events: auto;
        z-index: 1000;
        transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
      }
      
      .glass-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        padding: 4rem;
        max-width: 500px;
        text-align: center;
        position: relative;
        box-shadow: 0 40px 100px rgba(0,0,0,0.4);
      }
      
      .glass-card h2 {
        font-family: "Georgia", serif;
        font-style: italic;
        font-weight: 300;
        font-size: 2rem;
        margin-bottom: 2rem;
        opacity: 0.9;
      }
      
      .glass-card p {
        line-height: 1.8;
        font-size: 0.95rem;
        opacity: 0.7;
        font-weight: 300;
      }
      
      .menu-links {
        margin-top: 3rem;
        display: flex;
        justify-content: center;
        gap: 2rem;
        list-style: none;
        padding: 0;
      }
      
      .menu-links a {
        color: inherit;
        text-decoration: none;
        font-size: 0.8rem;
        letter-spacing: 0.1em;
        opacity: 0.5;
        border-bottom: 1px solid transparent;
        transition: all 0.3s ease;
      }
      .menu-links a:hover { opacity: 1; border-bottom-color: rgba(255,255,255,0.4); }
      
      .close-icon {
        position: absolute;
        top: 2rem; right: 2rem;
        cursor: pointer;
        opacity: 0.3;
        font-size: 1.5rem;
        transition: opacity 0.3s ease;
      }
      .close-icon:hover { opacity: 1; }
    `;
    
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);
    
    return () => {
        document.head.removeChild(styleSheet);
    }
  }, []);

  return (
    <div className="overlay-root">
      {/* 1. Persistent Signature (Top Left) */}
      <div className="signature-layer" onClick={toggleMenu} aria-label="Menu">
        <span className="signature-text">HereLiesAz</span>
      </div>

      {/* 2. Ethereal Info (Bottom, Perspective Faded) */}
      {activeNode && (
        <div className="info-layer" style={{ opacity: infoOpacity }}>
          <div className="artwork-title">{activeNode.id.split('~')[0].replace(/-/g, ' ')}</div>
          <div className="artwork-meta">Fragments of a Void</div>
        </div>
      )}

      {/* 3. The Central Glass Window */}
      {showMenu && (
        <div className="glass-modal-overlay" onClick={toggleMenu}>
          <div className="glass-card" onClick={e => e.stopPropagation()}>
            <div className="close-icon" onClick={toggleMenu}>×</div>
            <h2>Manifesto</h2>
            <p>
              "Imagine you're in a dark closet and can't see anything. 
              How little light does it take to be able to make something out?"
              <br/><br/>
              The Infinite Canvas is a psychological experience of pattern, paint, and memory.
              A shifting world where navigation and content are one.
            </p>
            <ul className="menu-links">
              <li><a href="#">Github</a></li>
              <li><a href="#">Instagram</a></li>
              <li><a href="#">Contact</a></li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default Overlay;

