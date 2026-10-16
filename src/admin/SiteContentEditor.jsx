import { useEffect, useState } from 'react';
import { loadSiteContent, saveSiteContent } from './data.js';
import { DEFAULT_SITE_CONTENT, safeHref } from '../siteContent';


/** Edits public/site-content.json — currently just the about paragraph
 * and the menu's link list (see src/components/Overlay.jsx). Intentionally
 * narrow for now; more hardcoded site bits can move into this same file
 * as they come up. */
export default function SiteContentEditor() {
  const [content, setContent] = useState(null);
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved' | { error }

  useEffect(() => {
    // Guard a file that parses but lacks menuLinks (or has a non-array
    // there) — every render below maps over it.
    const normalize = (c) => (c && typeof c === 'object'
      ? { about: typeof c.about === 'string' ? c.about : DEFAULT_SITE_CONTENT.about,
          menuLinks: Array.isArray(c.menuLinks) ? c.menuLinks : [] }
      : DEFAULT_SITE_CONTENT);
    loadSiteContent().then(c => setContent(normalize(c))).catch(() => setContent(DEFAULT_SITE_CONTENT));
  }, []);

  if (!content) return <div className="admin-panel"><p>loading…</p></div>;

  const updateLink = (i, key, value) => {
    const links = content.menuLinks.slice();
    links[i] = { ...links[i], [key]: value };
    setContent({ ...content, menuLinks: links });
  };
  const addLink = () => setContent({ ...content, menuLinks: [...content.menuLinks, { label: '', href: '', external: true }] });
  const removeLink = (i) => setContent({ ...content, menuLinks: content.menuLinks.filter((_, j) => j !== i) });

  const badLinks = content.menuLinks.filter(l => !safeHref(l.href));

  const save = async () => {
    if (badLinks.length > 0) {
      setStatus({ error: `Links must start with https://, http://, mailto: or / — fix: ${badLinks.map(l => l.label || l.href || '(blank)').join(', ')}` });
      return;
    }
    setStatus('saving');
    try {
      await saveSiteContent(content);
      setStatus('saved');
    } catch (e) {
      setStatus({ error: e.message });
    }
  };

  return (
    <div className="admin-panel">
      <h2>Site content</h2>
      <label className="admin-label">About (menu paragraph)
        <textarea
          className="admin-input"
          rows={4}
          value={content.about}
          onChange={e => setContent({ ...content, about: e.target.value })}
        />
      </label>

      <h3>Menu links</h3>
      {content.menuLinks.map((link, i) => (
        <div className="admin-row" key={i}>
          <input className="admin-input" style={{ maxWidth: '8rem' }} placeholder="label" value={link.label} onChange={e => updateLink(i, 'label', e.target.value)} />
          <input className="admin-input" placeholder="href" value={link.href} onChange={e => updateLink(i, 'href', e.target.value)} />
          <label><input type="checkbox" checked={!!link.external} onChange={e => updateLink(i, 'external', e.target.checked)} /> new tab</label>
          <button type="button" onClick={() => removeLink(i)} className="admin-btn-danger">remove</button>
        </div>
      ))}
      <button type="button" onClick={addLink} className="admin-btn-plain">+ add link</button>

      <div className="admin-row">
        <button type="button" onClick={save} disabled={status === 'saving'}>{status === 'saving' ? 'saving…' : 'save'}</button>
      </div>
      {status === 'saved' && <p className="admin-ok" role="status" aria-live="polite">Saved — live after the next deploy (usually under a minute).</p>}
      {status?.error && <p className="admin-error" role="alert">{status.error}</p>}
    </div>
  );
}
