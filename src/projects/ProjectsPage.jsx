import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { safeHref } from '../siteContent';

const STYLES = `
.projects-shell {
  /* Same fix as AdminApp.jsx's .admin-shell: index.css's body {overflow:
     hidden} isn't scoped to "/", so this needs its own scroll context. */
  height: 100vh; height: 100dvh; overflow-y: auto; -webkit-overflow-scrolling: touch;
  box-sizing: border-box;
  background: var(--field); color: var(--ink); font-family: var(--font-display);
  padding: 2.4rem 1.8rem 4rem;
}
.projects-shell a { color: var(--ink); }
.projects-header { max-width: 40rem; margin: 0 auto 2.4rem; }
.projects-header h1 { font-size: 1.05rem; font-weight: 400; letter-spacing: 0.22em; text-transform: lowercase; margin: 1.6rem 0 0.5em; }
.projects-header p { font-size: 0.85rem; letter-spacing: 0.04em; color: var(--ink-dim); line-height: 1.6; margin: 0; }
.projects-header a.back { font-size: 0.78rem; letter-spacing: 0.16em; text-transform: lowercase; color: var(--ink-faint); text-decoration: none; }
.projects-header a.back:hover { color: var(--ink); }
/* A list, not cards: no boxes (AESTHETIC.md §3). Each entry is a name with a
   hairline under it, like the menu's links. */
.projects-list { max-width: 40rem; margin: 0 auto; display: grid; gap: 1.6rem; }
.projects-item {
  display: block; text-decoration: none; color: inherit; position: relative;
  padding-bottom: 0.9rem; border-bottom: 0.5px solid var(--ink-hairline);
  transition: border-color var(--dur-fast) ease;
}
.projects-item:hover { border-bottom-color: var(--ink); }
.projects-item:focus-visible { outline: 1px solid var(--ink); outline-offset: 6px; }
.projects-item h2 { font-size: 0.95rem; font-weight: 400; letter-spacing: 0.16em; text-transform: lowercase; margin: 0 0 0.35em; }
.projects-item p { font-size: 0.8rem; letter-spacing: 0.04em; color: var(--ink-dim); line-height: 1.55; margin: 0; }
.projects-item .meta { font-size: 0.68rem; color: var(--ink-faint); margin-top: 0.55em; text-transform: lowercase; letter-spacing: 0.14em; }
.projects-note { text-align: center; color: var(--ink-faint); letter-spacing: 0.14em; font-size: 0.8rem; }
`;

// Every repo you own with GitHub Pages enabled, fetched live and
// unauthenticated straight from the public GitHub API — no build step,
// no token, no staleness. New project, enable Pages, it shows up here on
// the next visit. See docs/ARCHITECTURE.md.
const USER = 'HereLiesAz';
const SELF_REPO = 'hereliesaz.github.io';

export default function ProjectsPage() {
  useEffect(() => {
    const sheet = document.createElement('style');
    sheet.dataset.projectsPage = 'true';
    sheet.textContent = STYLES;
    document.head.appendChild(sheet);
    return () => { document.head.removeChild(sheet); };
  }, []);

  const [repos, setRepos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = [];
        for (let page = 1; page <= 5; page++) {
          const res = await fetch(
            `https://api.github.com/users/${USER}/repos?per_page=100&page=${page}&type=owner`,
            { headers: { Accept: 'application/vnd.github+json' } },
          );
          if (!res.ok) {
            throw new Error(res.status === 403
              ? 'GitHub is rate-limiting this page right now (too many people on your network hit the GitHub API recently) — try again in a bit.'
              : `GitHub API returned ${res.status}`);
          }
          const batch = await res.json();
          all.push(...batch);
          if (batch.length < 100) break;
        }
        if (cancelled) return;
        const pages = all
          .filter(r => r.has_pages && !r.fork && !r.archived && r.name !== SELF_REPO)
          .map(r => ({
            name: r.name,
            description: r.description || '',
            url: safeHref(r.homepage) || `https://${USER.toLowerCase()}.github.io/${r.name}/`,
            language: r.language,
            pushedAt: r.pushed_at,
          }))
          .sort((a, b) => new Date(b.pushedAt) - new Date(a.pushedAt));
        setRepos(pages);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="projects-shell">
      <div className="projects-header">
        <Link href="/" className="back">← back to the gallery</Link>
        <h1>projects</h1>
        <p>Other things I've built, live wherever they live.</p>
      </div>
      <div className="projects-list">
        {repos === null && !error && <p className="projects-note">loading…</p>}
        {error && <p className="projects-note" role="alert">✕ {error}</p>}
        {repos?.length === 0 && <p className="projects-note">nothing here yet</p>}
        {repos?.map(p => (
          <a key={p.name} className="projects-item" href={p.url} target="_blank" rel="noreferrer noopener">
            <h2>{p.name}</h2>
            {p.description && <p>{p.description}</p>}
            <div className="meta">{[p.language, p.pushedAt ? new Date(p.pushedAt).toLocaleDateString() : null].filter(Boolean).join(' · ')}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
