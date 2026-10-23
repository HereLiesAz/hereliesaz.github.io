// Tighten the page's Content-Security-Policy once the admin app is open.
//
// index.html's policy has to allow Google Tag Manager and Analytics for the
// public gallery. Policies delivered by <meta> add up: a second policy can only
// restrict further, never loosen, and it applies to everything fetched from then
// on. So the admin route adds one that allows scripts only from this origin and
// network calls only to this origin and api.github.com, which closes the
// analytics hosts as a place to send the stored GitHub token.
const POLICY = "script-src 'self'; connect-src 'self' https://api.github.com; frame-src 'none'; img-src 'self' data: blob:";

export function lockDownAdminPage() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('meta[data-admin-csp]')) return;
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = POLICY;
  meta.dataset.adminCsp = 'true';
  document.head.appendChild(meta);
}
