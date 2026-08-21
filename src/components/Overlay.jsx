import React, { useEffect, useRef, useState } from 'react';
import useStore from '../store/useStore';
import { bgSweepLevel } from './TheaterPainting';

// Fallback matches /public/site-content.json exactly, so a missing or
// malformed fetch (offline, 404 on a stale deploy) never blanks the menu
// — it just silently keeps whatever shipped in this bundle. Edited via
// the /admin app's "Site" tab, not by hand.
const DEFAULT_SITE_CONTENT = {
  about: 'The canvas is a closet. The paint is light. You navigate the dark by following what your eye almost-recognises.',
  menuLinks: [
    { label: 'github', href: 'https://github.com/HereLiesAz', external: true },
    { label: 'instagram', href: 'https://instagram.com/hereliesaz', external: true },
    { label: 'email', href: 'mailto:hereliesaz@gmail.com', external: false },
    { label: 'projects', href: '/projects', external: false },
  ],
};

/**
 * The thin ink layer over the closet — see AESTHETIC §3, §6.
 *
 * Three pieces:
 *   1. Signature, top-left, hand-drawn-feel SVG that draws itself on
 *      first mount via a clip-path reveal. Click to open the menu.
 *   2. Caption, lower-left, white ink, tracked loose. Opacity follows
 *      |cos(πr)| over each segment — a trough whose floor sits at
 *      mid-segment (where neither painting is the dominant gestalt)
 *      and whose peaks land at the nulls (where the title is fully
 *      legible). The title text swaps at r = 0.5 so each peak
 *      announces the painting it belongs to.
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
  /* Driven per-frame from JS (see the apply() subscription below) with
     how far the site background has swept from black toward white
     (TheaterPainting's bgSweepLevel()). The signature/caption text colour
     (#f4f0e6, near-white) reads fine on black but drops to ~1.1:1
     contrast against a fully white background with nothing else to help
     it — text-shadow alone can't fix that since it's a glow, not a solid
     backing. --ink-scrim drives a dark backing panel behind that text
     (see .ink-signature::before / .ink-caption::before) that fades in as
     the background lightens, the same "scrim under text" trick the vellum
     modal already uses (.ink-modal-backdrop) for the same reason. */
  --ink-scrim: 0;
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
.ink-signature::before,
.ink-caption::before {
  content: '';
  position: absolute;
  inset: -0.5em -0.7em;
  background: #000;
  opacity: var(--ink-scrim);
  border-radius: 3px;
  pointer-events: none;
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
  pointer-events: none;
  /* Real painting ids are long, unbroken, punctuation-joined filename
     stems (e.g. "PXL_20250508_213441321.RAW-01.COVER~9") with no natural
     line-breaking opportunity, so without this a long id can overflow past
     max-width instead of wrapping inside it. */
  overflow-wrap: break-word;
  word-break: break-word;
  /* Initial state lives here, not on the JSX style prop, so a React
     re-render (e.g. showMenu toggling) doesn't stomp the per-frame
     ref-driven opacity / visibility updates. */
  opacity: 0;
  visibility: hidden;
  /* Manual per-frame updates would otherwise be smoothed by the
     browser's transition machinery — kill it. */
  transition: none;
}
.ink-caption__title { font-size: 0.95rem; letter-spacing: 0.22em; }
.ink-caption__price { font-size: 0.7rem; opacity: 0.85; margin-top: 0.2em; }
.ink-caption__price:empty { display: none; }

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

/* --- Load error --------------------------------------------------------
   Minimal, unobtrusive notice for the total-data-loss case (no theater
   bake AND no legacy graph.json) — otherwise the screen just stays
   black forever with no indication anything is wrong. Styled like the
   caption: same ink colour/serif, centred instead of corner-anchored so
   it reads as a message rather than a painting title. */
.ink-load-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  font-size: 0.9rem;
  letter-spacing: 0.12em;
  text-shadow: 0 0 16px rgba(0, 0, 0, 0.95);
  pointer-events: none;
}
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
  // Only the low-frequency state goes through React. transitionProgress
  // ticks every frame; reading it here would re-render the entire
  // Overlay tree at 60–120 Hz. The caption wires itself directly to the
  // store via a transient subscription below.
  const showMenu   = useStore(s => s.showMenu);
  const toggleMenu = useStore(s => s.toggleMenu);
  const loadError  = useStore(s => s.loadError);

  // Hand-authored menu copy/links, edited via /admin — see DEFAULT_SITE_CONTENT.
  const [siteContent, setSiteContent] = useState(DEFAULT_SITE_CONTENT);
  useEffect(() => {
    let cancelled = false;
    fetch('/site-content.json')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(c => {
        if (cancelled || !c || !Array.isArray(c.menuLinks)) return;
        setSiteContent(c);
      });
    return () => { cancelled = true; };
  }, []);

  // Inject styles once.
  useEffect(() => {
    const sheet = document.createElement('style');
    sheet.dataset.inkOverlay = 'true';
    sheet.textContent = STYLES;
    document.head.appendChild(sheet);
    return () => { document.head.removeChild(sheet); };
  }, []);

  // Caption refs. We bypass React reconciliation for the per-frame
  // opacity / title updates and write straight to the DOM.
  const overlayRef = useRef(null);
  const captionRef = useRef(null);
  const titleRef   = useRef(null);
  const priceRef   = useRef(null);
  const lastIdRef  = useRef(null);

  useEffect(() => {
    const apply = (state) => {
      const start = state.activeClusters[state.currentSegmentIndex];
      const end   = state.activeClusters[state.currentSegmentIndex + 1];
      const id = (state.transitionProgress < 0.5 ? start?.id : end?.id)
              || start?.id || end?.id || null;
      // |cos(πr)| → 1 at the nulls, 0 at the mid-segment trough.
      const opacity = id ? Math.abs(Math.cos(state.transitionProgress * Math.PI)) : 0;
      if (captionRef.current) {
        captionRef.current.style.opacity = String(opacity);
        captionRef.current.style.visibility = id ? 'visible' : 'hidden';
      }
      if (id !== lastIdRef.current) {
        const info = id ? state.meta?.[id] : null;
        if (titleRef.current) titleRef.current.textContent = info?.title || id || '';
        if (priceRef.current) {
          priceRef.current.textContent = (info?.forSale && info?.price != null)
            ? `${info.currency === 'USD' || !info.currency ? '$' : ''}${info.price}${info.currency && info.currency !== 'USD' ? ` ${info.currency}` : ''} — for sale`
            : '';
        }
        lastIdRef.current = id;
      }
      // bgSweepLevel() isn't store state (it lives in TheaterPainting's
      // module-level bgSweep map) but this subscription already fires at
      // scroll-frame frequency, so it's a convenient place to piggyback
      // this per-frame DOM write too, matching the pattern above. Capped
      // at 0.78: comfortably clears 4.5:1 contrast for this text colour
      // even against a fully white swept background, without going fully
      // opaque (the ink aesthetic elsewhere is deliberately translucent —
      // see .ink-modal-backdrop's 0.86).
      if (overlayRef.current) {
        overlayRef.current.style.setProperty('--ink-scrim', String(Math.min(0.78, bgSweepLevel())));
      }
    };
    apply(useStore.getState());
    return useStore.subscribe(apply);
  }, []);

  // Focus management for the menu modal: move focus into it on open and
  // restore it to the signature button on close, so a keyboard user isn't
  // dropped back at the top of an unfocused document. Skips the initial
  // mount (prevShowMenu starts false, showMenu starts false) so the page
  // doesn't yank focus onto the signature button unprompted on load.
  const signatureRef   = useRef(null);
  const closeButtonRef = useRef(null);
  const prevShowMenu   = useRef(false);
  useEffect(() => {
    if (showMenu) {
      closeButtonRef.current?.focus();
    } else if (prevShowMenu.current) {
      signatureRef.current?.focus();
    }
    prevShowMenu.current = showMenu;
  }, [showMenu]);

  // Escape closes the modal — the conventional dialog-dismissal key, and
  // otherwise the only way out is a mouse click (the backdrop) or tabbing
  // all the way to the close button.
  useEffect(() => {
    if (!showMenu) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') toggleMenu();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showMenu, toggleMenu]);

  return (
    <div className="ink-overlay" ref={overlayRef}>
      <button
        type="button"
        className="ink-signature"
        onClick={toggleMenu}
        aria-label="open menu"
        ref={signatureRef}
        // Excluded from the tab order while the modal is open, rather than
        // left reachable underneath it — the modal has no separate focus
        // trap, so without this Tab could walk focus out of the dialog and
        // onto a button visually hidden behind the backdrop.
        tabIndex={showMenu ? -1 : 0}
        aria-hidden={showMenu}
      >
        <svg width="160" height="40" viewBox="0 0 160 40">
          <text x="0" y="28" className="ink-signature__stroke">HereLiesAz</text>
        </svg>
      </button>

      <div ref={captionRef} className="ink-caption">
        <div ref={titleRef} className="ink-caption__title" />
        <div ref={priceRef} className="ink-caption__price" />
      </div>

      {loadError && (
        <div className="ink-load-error">{loadError}</div>
      )}

      {showMenu && (
        <div className="ink-modal-backdrop" onClick={toggleMenu}>
          <div
            className="ink-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ink-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <VellumFrame />
            <button type="button" className="ink-modal__close" onClick={toggleMenu} aria-label="close" ref={closeButtonRef}>×</button>
            <h2 id="ink-modal-title">here lies az</h2>
            <p>{siteContent.about}</p>
            <ul>
              {siteContent.menuLinks.map(link => (
                <li key={link.href}>
                  {link.external
                    ? <a href={link.href} target="_blank" rel="noreferrer noopener">{link.label}</a>
                    : <a href={link.href}>{link.label}</a>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default Overlay;
