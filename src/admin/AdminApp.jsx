import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { hasToken } from './github.js';
import TokenSetup from './TokenSetup.jsx';
import PaintingsList from './PaintingsList.jsx';
import AddPainting from './AddPainting.jsx';
import SiteContentEditor from './SiteContentEditor.jsx';
import { lockDownAdminPage } from './lockdown.js';

const TABS = ['paintings', 'add', 'site', 'settings'];

const STYLES = `
.admin-shell {
  /* index.css sets body { overflow: hidden; height: 100% } so the gallery
     can hijack scroll itself — that rule isn't scoped to "/", so without
     this the admin page would inherit it and nothing here could scroll.
     Own height + overflow makes this its own scrolling context regardless
     of what the body does. */
  height: 100vh; height: 100dvh; overflow-y: auto; -webkit-overflow-scrolling: touch;
  box-sizing: border-box;
  background: var(--field); color: var(--ink);
  font-family: var(--font-utility); padding: 1rem 1rem 3rem;
}
.admin-shell a { color: var(--ink); }
.admin-nav { display: flex; gap: 0.5rem; margin-bottom: 1.2rem; flex-wrap: wrap; }
.admin-nav button {
  background: transparent; border: 1px solid var(--ink-line); color: var(--ink);
  padding: 0.4em 0.9em; font-family: inherit; text-transform: lowercase; letter-spacing: 0.08em;
  cursor: pointer; font-size: 0.8rem; min-height: var(--hit);
}
.admin-nav button[data-active="true"] { background: var(--ink); color: var(--field); }
.admin-panel { max-width: 42rem; }
.admin-panel h2 { font-size: 1.1rem; letter-spacing: 0.08em; text-transform: lowercase; margin: 0 0 0.6em; }
.admin-panel h3 { font-size: 0.9rem; letter-spacing: 0.08em; text-transform: lowercase; margin: 1em 0 0.4em; }
.admin-panel p { font-size: 0.85rem; line-height: 1.5; color: var(--ink-dim); }
.admin-label { display: block; font-size: 0.75rem; text-transform: lowercase; letter-spacing: 0.08em; color: var(--ink-dim); margin: 0.8em 0 0.3em; }
.admin-input {
  width: 100%; box-sizing: border-box; background: transparent; border: 1px solid var(--ink-line);
  color: var(--ink); font-family: inherit; font-size: 0.85rem; padding: 0.5em 0.6em; margin-top: 0.2em;
  border-radius: 0;
}
.admin-input:focus { outline: none; border-color: var(--ink); }
.admin-row { display: flex; gap: 0.8em; align-items: center; margin: 0.6em 0; flex-wrap: wrap; }
.admin-row--between { justify-content: space-between; }

/* One button shape, square. Primary is ink on field; plain is an outline;
   danger is a double rule. Disabled is dashed, never a dimmed copy of the
   primary (a half-opacity ink fill reads as a grey slab). State is carried by
   outline and rule style, not by hue. */
button {
  background: var(--ink); color: var(--field); border: 1px solid var(--ink); border-radius: 0;
  padding: 0.5em 1em; font-family: inherit; text-transform: lowercase; letter-spacing: 0.06em;
  cursor: pointer; font-size: 0.8rem; min-height: var(--hit);
  transition: outline-color var(--dur-fast) ease;
}
button:hover:not(:disabled) { outline: 1px solid var(--ink); outline-offset: 2px; }
button:focus-visible, .admin-shell a:focus-visible { outline: 1px solid var(--ink); outline-offset: 3px; }
button:disabled { background: transparent; color: var(--ink-faint); border: 1px dashed var(--ink-line); cursor: default; }
.admin-btn-danger { background: transparent; color: var(--ink); border: 3px double var(--ink); }
.admin-btn-plain { background: transparent; color: var(--ink); border: 1px solid var(--ink-line); }
/* Status is marked, not coloured. */
.admin-ok, .admin-error { font-size: 0.8rem; color: var(--ink); }
.admin-ok::before { content: '\\2713\\00a0'; }
.admin-error::before { content: '\\2715\\00a0'; }
.admin-error { white-space: pre-wrap; }
.admin-file-list { font-size: 0.8rem; color: var(--ink-dim); }
.admin-thumb-large { width: 100%; max-width: 20rem; display: block; margin: 0.6em 0; background: var(--field); }
.admin-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); gap: 0.6em; margin-top: 0.8em; }
.admin-grid-item {
  background: transparent; color: var(--ink); border: 1px solid var(--ink-hairline); padding: 0.4em; text-align: left;
  display: flex; flex-direction: column; gap: 0.3em; position: relative;
}
.admin-grid-item:hover:not(:disabled) { border-color: var(--ink-line); outline: none; }
.admin-grid-item img { width: 100%; aspect-ratio: 1; object-fit: cover; background: var(--field); }
.admin-grid-item span { font-size: 0.65rem; word-break: break-word; color: var(--ink-dim); }
.admin-badge { position: absolute; top: 0.3em; right: 0.3em; background: var(--ink); color: var(--field);
  font-size: 0.6rem; padding: 0.15em 0.4em; text-transform: lowercase; }
`;

/** The whole admin surface — gated on a GitHub token (see TokenSetup),
 * not linked from the public gallery UI. See docs/ARCHITECTURE.md. */
export default function AdminApp() {
  useEffect(() => {
    lockDownAdminPage();
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
