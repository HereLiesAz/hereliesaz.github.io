import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { hasToken } from './github.js';
import TokenSetup from './TokenSetup.jsx';
import PaintingsList from './PaintingsList.jsx';
import AddPainting from './AddPainting.jsx';
import SiteContentEditor from './SiteContentEditor.jsx';

const TABS = ['paintings', 'add', 'site', 'settings'];

const STYLES = `
.admin-shell {
  /* index.css sets body { overflow: hidden; height: 100% } so the gallery
     can hijack scroll itself — that rule isn't scoped to "/", so without
     this the admin page would inherit it and nothing here could scroll.
     Own height + overflow makes this its own scrolling context regardless
     of what the body does. */
  height: 100vh; overflow-y: auto; -webkit-overflow-scrolling: touch;
  box-sizing: border-box;
  background: #0a0a0a; color: #f4f0e6;
  font-family: monospace; padding: 1rem 1rem 3rem;
}
.admin-shell a { color: #f4f0e6; }
.admin-nav { display: flex; gap: 0.5rem; margin-bottom: 1.2rem; flex-wrap: wrap; }
.admin-nav button {
  background: transparent; border: 1px solid rgba(244,240,230,0.3); color: #f4f0e6;
  padding: 0.4em 0.9em; font-family: inherit; text-transform: lowercase; letter-spacing: 0.08em;
  cursor: pointer; font-size: 0.8rem; min-height: 44px;
}
.admin-nav button[data-active="true"] { background: #f4f0e6; color: #0a0a0a; }
.admin-panel { max-width: 42rem; }
.admin-panel h2 { font-size: 1.1rem; letter-spacing: 0.08em; text-transform: lowercase; margin: 0 0 0.6em; }
.admin-panel h3 { font-size: 0.9rem; letter-spacing: 0.08em; text-transform: lowercase; margin: 1em 0 0.4em; }
.admin-panel p { font-size: 0.85rem; line-height: 1.5; opacity: 0.85; }
.admin-label { display: block; font-size: 0.75rem; text-transform: lowercase; letter-spacing: 0.08em; opacity: 0.75; margin: 0.8em 0 0.3em; }
.admin-input {
  width: 100%; box-sizing: border-box; background: #141414; border: 1px solid rgba(244,240,230,0.25);
  color: #f4f0e6; font-family: inherit; font-size: 0.85rem; padding: 0.5em 0.6em; margin-top: 0.2em;
}
.admin-row { display: flex; gap: 0.8em; align-items: center; margin: 0.6em 0; flex-wrap: wrap; }
.admin-row--between { justify-content: space-between; }
button { background: #f4f0e6; color: #0a0a0a; border: none; padding: 0.5em 1em; font-family: inherit;
  text-transform: lowercase; letter-spacing: 0.06em; cursor: pointer; font-size: 0.8rem; min-height: 44px; }
button:disabled { opacity: 0.5; cursor: default; }
.admin-btn-danger { background: #3a1414; color: #f4b0b0; }
.admin-btn-plain { background: transparent; color: #f4f0e6; border: 1px solid rgba(244,240,230,0.3); }
.admin-ok { color: #b0e0b0; font-size: 0.8rem; }
.admin-error { color: #f4b0b0; font-size: 0.8rem; white-space: pre-wrap; }
.admin-file-list { font-size: 0.8rem; opacity: 0.8; }
.admin-thumb-large { width: 100%; max-width: 20rem; display: block; margin: 0.6em 0; background: #000; }
.admin-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); gap: 0.6em; margin-top: 0.8em; }
.admin-grid-item {
  background: #141414; border: 1px solid rgba(244,240,230,0.15); padding: 0.4em; text-align: left;
  display: flex; flex-direction: column; gap: 0.3em; position: relative;
}
.admin-grid-item img { width: 100%; aspect-ratio: 1; object-fit: cover; background: #000; }
.admin-grid-item span { font-size: 0.65rem; word-break: break-word; opacity: 0.85; }
.admin-badge { position: absolute; top: 0.3em; right: 0.3em; background: #f4f0e6; color: #0a0a0a;
  font-size: 0.6rem; padding: 0.15em 0.4em; text-transform: lowercase; }
`;

/** The whole admin surface — gated on a GitHub token (see TokenSetup),
 * not linked from the public gallery UI. See docs/ARCHITECTURE.md. */
export default function AdminApp() {
  useEffect(() => {
    const sheet = document.createElement('style');
    sheet.dataset.adminApp = 'true';
    sheet.textContent = STYLES;
    document.head.appendChild(sheet);
    return () => { document.head.removeChild(sheet); };
  }, []);

  const [authed, setAuthed] = useState(hasToken());
  const [tab, setTab] = useState('paintings');

  if (!authed) {
    return (
      <div className="admin-shell">
        <TokenSetup onVerified={() => setAuthed(true)} />
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <nav className="admin-nav" role="tablist">
        {TABS.map(t => (
          <button
            type="button"
            key={t}
            role="tab"
            id={`admin-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`admin-tabpanel-${t}`}
            data-active={tab === t}
            onClick={() => setTab(t)}
          >{t}</button>
        ))}
        <Link href="/" className="admin-btn-plain" style={{ marginLeft: 'auto', textDecoration: 'none', padding: '0.4em 0.9em', fontSize: '0.8rem' }}>← gallery</Link>
      </nav>
      <div role="tabpanel" id={`admin-tabpanel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'paintings' && <PaintingsList />}
        {tab === 'add' && <AddPainting />}
        {tab === 'site' && <SiteContentEditor />}
        {tab === 'settings' && <TokenSetup onVerified={() => setAuthed(true)} />}
      </div>
    </div>
  );
}
