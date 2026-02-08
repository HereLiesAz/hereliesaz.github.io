import React, { useEffect } from 'react';
import useStore from '../store/useStore';

const Overlay = () => {
  const currentNodeId = useStore(state => state.currentNodeId);
  const nodes = useStore(state => state.nodes);
  const transitionProgress = useStore(state => state.transitionProgress);
  const showMenu = useStore(state => state.showMenu);
  const toggleMenu = useStore(state => state.toggleMenu);
  
  const activeNode = nodes && currentNodeId ? nodes.find(n => n.id === currentNodeId) : null;
  
  // Calculate Opacity for Info
  // Fade in when progress is near 0 (Sweet Spot), fade out as we fly away
  const infoOpacity = Math.max(0, 1 - (transitionProgress * 3));

  // CSS Injection
  useEffect(() => {
    const styles = `
      .overlay-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none; /* Let clicks pass through to canvas */
        color: #eee;
        font-family: 'Courier New', Courier, monospace;
        padding: 2rem;
        box-sizing: border-box;
      }
      
      .signature {
        position: absolute;
        top: 2rem;
        left: 2rem;
        text-shadow: 0 0 10px rgba(0,0,0,0.5);
      }
      
      .info-panel {
        position: absolute;
        bottom: 2rem;
        width: 100%;
        text-align: center;
        transition: opacity 0.2s ease;
        text-shadow: 0 0 10px rgba(0,0,0,0.8);
      }
    
      .glass-modal {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        background: rgba(0, 0, 0, 0.4);
        pointer-events: auto;
        backdrop-filter: blur(10px);
        z-index: 100;
      }
    
      .glass-content {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 3rem;
        max-width: 400px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.5);
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
    
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);
    
    return () => {
        document.head.removeChild(styleSheet);
    }
  }, []);

  return (
    <div className="overlay-container">
      {/* 1. Signature (Top Left) */}
      <div 
        className="signature"
        onClick={toggleMenu}
        style={{ cursor: 'pointer', pointerEvents: 'auto' }}
      >
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 300, letterSpacing: '0.2em' }}>
          HereLiesAz
        </h1>
      </div>

      {/* 2. Info Panel (Bottom, Fades) */}
      {activeNode && (
        <div 
          className="info-panel"
          style={{ opacity: infoOpacity }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 600, textTransform: 'uppercase' }}>
            {activeNode.id.split('~')[0]}
          </h2>
          <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>
             {/* Fallback metadata if missing */}
            {(activeNode.shards?.length || 0)} SHARDS // {(activeNode.resolution || ['?','?']).join('x')}
          </p>
        </div>
      )}

      {/* 3. Glass Menu (Center) */}
      {showMenu && (
        <div className="glass-modal">
          <div className="glass-content">
             <button className="close-btn" onClick={toggleMenu}>×</button>
             <h2>Manifesto</h2>
             <p>
               The canvas is infinite. The paint is data.
               We are merely pattern matching in the void.
             </p>
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

export default Overlay;
