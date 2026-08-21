import { useEffect, useState } from 'react';
import { Link } from 'wouter';

const STYLES = `
.projects-shell {
  /* Same fix as AdminApp.jsx's .admin-shell: index.css's body {overflow:
     hidden} isn't scoped to "/", so this needs its own scroll context. */
  height: 100vh; overflow-y: auto; -webkit-overflow-scrolling: touch;
  box-sizing: border-box;
  background: #0a0a0a; color: #f4f0e6; font-family: monospace;
  padding: 2rem 1.5rem 4rem;
}
.projects-shell a { color: #f4f0e6; }
.projects-header { max-width: 48rem; margin: 0 auto 2rem; }
.projects-header h1 { font-size: 1.3rem; letter-spacing: 0.1em; text-transform: lowercase; margin: 0 0 0.4em; }
.projects-header p { font-size: 0.85rem; opacity: 0.75; line-height: 1.5; }
.projects-header a.back { font-size: 0.8rem; opacity: 0.6; text-decoration: none; }
.projects-grid { max-width: 48rem; margin: 0 auto; display: grid; gap: 0.8em; }
.projects-card {
  border: 1px solid rgba(244,240,230,0.18); padding: 1em 1.2em; text-decoration: none; color: inherit;
  display: block; transition: border-color 160ms ease;
}
.projects-card:hover { border-color: rgba(244,240,230,0.5); }
.projects-card h2 { font-size: 0.95rem; letter-spacing: 0.04em; margin: 0 0 0.3em; }
.projects-card p { font-size: 0.78rem; opacity: 0.7; line-height: 1.4; margin: 0; }
.projects-card .meta { font-size: 0.65rem; opacity: 0.5; margin-top: 0.5em; text-transform: uppercase; letter-spacing: 0.06em; }
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
            url: r.homepage || `https://${USER.toLowerCase()}.github.io/${r.name}/`,
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
      <div className="projects-grid">
        {repos === null && !error && <p style={{ textAlign: 'center', opacity: 0.6 }}>loading…</p>}
        {error && <p style={{ textAlign: 'center', color: '#f4b0b0' }}>{error}</p>}
        {repos?.length === 0 && <p style={{ textAlign: 'center', opacity: 0.6 }}>nothing here yet</p>}
        {repos?.map(p => (
          <a key={p.name} className="projects-card" href={p.url} target="_blank" rel="noreferrer noopener">
            <h2>{p.name}</h2>
            {p.description && <p>{p.description}</p>}
            <div className="meta">{[p.language, p.pushedAt ? new Date(p.pushedAt).toLocaleDateString() : null].filter(Boolean).join(' · ')}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
