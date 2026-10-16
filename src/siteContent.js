// Single source of truth for the menu's fallback copy/links and for link
// sanitising. Shared by the gallery overlay (src/components/Overlay.jsx),
// the /admin "Site" tab (src/admin/SiteContentEditor.jsx) and the projects
// page (src/projects/ProjectsPage.jsx).

// Bundled fallback for /site-content.json. Kept in sync, by hand, with
// public/site-content.json so a missing or malformed fetch (offline, 404 on
// a stale deploy) never blanks the menu. The live text is edited via the
// /admin app's "Site" tab, which writes public/site-content.json — if you
// change that file's defaults, change these too.
export const DEFAULT_SITE_CONTENT = {
  about: '"... the visual aesthetic of an inside joke told at a funeral."',
  menuLinks: [
    { label: 'github', href: 'https://github.com/HereLiesAz', external: true },
    { label: 'instagram', href: 'https://instagram.com/hereliesaz', external: true },
    { label: 'email', href: 'mailto:hereliesaz@gmail.com', external: false },
    { label: 'projects', href: '/projects', external: false },
  ],
};

// Allowlist of link targets: http(s), mailto, or a site-root path. Anything
// else (javascript:, data:, protocol-relative //host, bare words) is
// rejected. A leading "//" is protocol-relative — an off-site URL that only
// LOOKS like a path — so it's excluded explicitly.
const SAFE_HREF = /^(https?:|mailto:|\/(?!\/))/i;

/** Returns `href` if it passes the scheme allowlist, otherwise null. */
export function safeHref(href) {
  if (typeof href !== 'string') return null;
  const trimmed = href.trim();
  return SAFE_HREF.test(trimmed) ? trimmed : null;
}

/** True for a same-origin, site-root path that the client router can own
 * (e.g. "/projects"). Anything with a scheme (https:, mailto:) must be a
 * plain <a>, never a router <Link>. */
export function isInternalPath(href) {
  return typeof href === 'string' && /^\/(?!\/)/.test(href);
}
