import React, { useEffect, useMemo } from 'react';
import useStore from '../store/useStore';

/**
 * The thin ink layer over the closet — see AESTHETIC §3, §6.
 *
 * Three pieces:
 *   1. Signature, top-left, hand-drawn-feel SVG that draws itself on
 *      first mount via a clip-path reveal. Click to open the menu.
 *   2. Caption, lower-left, white ink, tracked loose, fading with the
 *      painting (bell shape over each segment so it dips to silence at
 *      mid-segment when neither painting is the dominant gestalt).
 *   3. Vellum modal, no glass / blur / cards. A dimmed canvas with a
 *      hand-drawn ink frame and white-on-black text inside it.
 */
const STYLES = `
.ink-overlay, .ink-overlay * {
  box-sizing: border-box;
  font-family: 'Iowan Old Style', 'Palatino Linotype', 'Georgia', serif;
  letter-spacing: 0.04em;
  color: #f4f0e6;
}
.ink-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}

/* --- Signature -------------------------------------------------------- */
.ink-signature {
  position: absolute;
  top: 1.6rem;
  left: 1.8rem;
  pointer-events: auto;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  display: block;
  filter: drop-shadow(0 0 12px rgba(0, 0, 0, 0.85));
}
.ink-signature svg {
  display: block;
  overflow: visible;
}
.ink-signature .ink-signature__stroke {
  fill: none;
  stroke: #f4f0e6;
  stroke-width: 0.7;
  stroke-linejoin: round;
  stroke-linecap: round;
  letter-spacing: 0.06em;
  font-size: 22px;
  font-style: italic;
  font-weight: 400;
  font-family: 'Iowan Old Style', 'Palatino Linotype', 'Georgia', serif;
  animation: ink-signature-reveal 720ms cubic-bezier(0.22, 0.7, 0.2, 1) 180ms backwards;
}
.ink-signature:hover .ink-signature__stroke { stroke-width: 1.0; }
@keyframes ink-signature-reveal {
  from { clip-path: inset(0 102% 0 -2%); }
  to   { clip-path: inset(0 -2%  0 -2%); }
}

/* --- Caption ---------------------------------------------------------- */
.ink-caption {
  position: absolute;
  bottom: 1.6rem;
  left: 1.8rem;
  max-width: 60vw;
  font-size: 0.78rem;
  text-transform: lowercase;
  letter-spacing: 0.18em;
  text-shadow: 0 0 16px rgba(0, 0, 0, 0.95);
  transition: opacity 240ms ease;
  pointer-events: none;
}
.ink-caption__title { font-size: 0.95rem; letter-spacing: 0.22em; }
.ink-caption__meta  { opacity: 0.55; margin-top: 0.4rem; }

/* --- Vellum modal ----------------------------------------------------- */
.ink-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.86);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  animation: ink-modal-backdrop-in 240ms ease-out;
}
@keyframes ink-modal-backdrop-in {
  from { opacity: 0; } to { opacity: 1; }
}
.ink-modal {
  position: relative;
  width: min(440px, 86vw);
  padding: 2.6rem 2.2rem 2.4rem;
  pointer-events: auto;
}
.ink-modal__frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
  animation: ink-modal-frame-in 600ms cubic-bezier(0.22, 0.7, 0.2, 1) backwards;
}
@keyframes ink-modal-frame-in {
  from { stroke-dashoffset: 1200; opacity: 0; }
  to   { stroke-dashoffset: 0;    opacity: 1; }
}
.ink-modal__frame path {
  fill: none;
  stroke: #f4f0e6;
  stroke-width: 0.8;
  stroke-linejoin: round;
  stroke-linecap: round;
  stroke-dasharray: 1200;
}
.ink-modal__close {
  position: absolute;
  top: 0.4rem;
  right: 0.6rem;
  background: none;
  border: none;
  padding: 0.2rem 0.5rem;
  font-size: 1.1rem;
  cursor: pointer;
  color: #f4f0e6;
  font-style: italic;
}
.ink-modal h2 {
  margin: 0 0 1.2rem;
  font-size: 1.05rem;
  text-transform: lowercase;
  letter-spacing: 0.32em;
  font-weight: 400;
}
.ink-modal p {
  margin: 0 0 1.4rem;
  font-size: 0.86rem;
  line-height: 1.55;
}
.ink-modal ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.ink-modal li {
  margin: 0.3rem 0;
  font-size: 0.82rem;
  letter-spacing: 0.16em;
}
.ink-modal a {
  color: #f4f0e6;
  text-decoration: none;
  border-bottom: 0.5px solid rgba(244, 240, 230, 0.35);
  padding-bottom: 1px;
}
.ink-modal a:hover { border-bottom-color: rgba(244, 240, 230, 0.95); }
`;

/**
 * Hand-coded "vellum" border — four wobbly poly-bezier paths instead of a
 * CSS rectangle. The wobble is small and deliberate so the panel reads as
 * "drawn around the content" rather than "rounded rectangle".
 */
function VellumFrame() {
  // Coordinate system is the 0..100 inset of the panel (drawn via
  // preserveAspectRatio="none"), so the frame stretches with the modal.
  return (
    <svg className="ink-modal__frame" viewBox="0 0 100 100" preserveAspectRatio="none">
      {/* top edge */}
      <path d="M0.6 0.9 C 12 1.4, 28 0.5, 42 1.0 S 70 1.6, 84 0.7 S 98 1.3, 99.4 1.1" />
      {/* right edge */}
      <path d="M99.2 0.7 C 99.6 14, 98.7 28, 99.5 44 S 99.2 70, 98.9 84 S 99.5 98, 99.3 99.4" />
      {/* bottom edge */}
      <path d="M99.4 99.1 C 86 99.6, 70 98.7, 56 99.2 S 28 98.5, 14 99.4 S 2 98.9, 0.6 99.2" />
      {/* left edge */}
      <path d="M0.7 99.3 C 0.5 86, 1.3 70, 0.6 56 S 0.9 28, 1.2 14 S 0.4 2, 0.6 0.6" />
    </svg>
  );
}

const Overlay = () => {
  // The closet's chrome runs off this state.
  const activeClusters       = useStore(s => s.activeClusters);
  const currentSegmentIndex  = useStore(s => s.currentSegmentIndex);
  const transitionProgress   = useStore(s => s.transitionProgress);
  const showMenu             = useStore(s => s.showMenu);
  const toggleMenu           = useStore(s => s.toggleMenu);

  // Inject styles once.
  useEffect(() => {
    const sheet = document.createElement('style');
    sheet.dataset.inkOverlay = 'true';
    sheet.textContent = STYLES;
    document.head.appendChild(sheet);
    return () => { document.head.removeChild(sheet); };
  }, []);

  // Pick the painting nearest the camera within the active segment.
  const { activeId, captionOpacity } = useMemo(() => {
    const start = activeClusters[currentSegmentIndex];
    const end   = activeClusters[currentSegmentIndex + 1];
    const id = (transitionProgress < 0.5 ? start?.id : end?.id) || start?.id || end?.id || null;
    // |cos(πr)| → 1 at the nulls, 0 at the mid-segment dip — fades the
    // caption out while no painting dominates, fades it back in as the
    // next gestalt locks.
    const opacity = Math.abs(Math.cos(transitionProgress * Math.PI));
    return { activeId: id, captionOpacity: opacity };
  }, [activeClusters, currentSegmentIndex, transitionProgress]);

  return (
    <div className="ink-overlay">
      <button type="button" className="ink-signature" onClick={toggleMenu} aria-label="open menu">
        <svg width="160" height="32" viewBox="0 0 160 32">
          <text x="0" y="22" className="ink-signature__stroke">HereLiesAz</text>
        </svg>
      </button>

      {activeId && (
        <div className="ink-caption" style={{ opacity: captionOpacity }}>
          <div className="ink-caption__title">{activeId}</div>
        </div>
      )}

      {showMenu && (
        <div className="ink-modal-backdrop" onClick={toggleMenu}>
          <div className="ink-modal" onClick={e => e.stopPropagation()}>
            <VellumFrame />
            <button type="button" className="ink-modal__close" onClick={toggleMenu} aria-label="close">×</button>
            <h2>here lies az</h2>
            <p>The canvas is a closet. The paint is light. You navigate the dark by following what your eye almost-recognises.</p>
            <ul>
              <li><a href="https://github.com/HereLiesAz" target="_blank" rel="noreferrer noopener">github</a></li>
              <li><a href="https://instagram.com/hereliesaz" target="_blank" rel="noreferrer noopener">instagram</a></li>
              <li><a href="mailto:hereliesaz@gmail.com">email</a></li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default Overlay;
