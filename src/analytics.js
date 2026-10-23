// Google tag, loaded on demand instead of from index.html.
//
// The /admin app keeps a GitHub token with write access in localStorage, and
// localStorage is shared by every page on this origin. A third-party script on
// the same page is the most direct way for that token to leak, so the admin
// route never loads this (App.jsx) and tightens the page's Content-Security-
// Policy as well (admin/lockdown.js). Public pages load it exactly as the
// inline snippet in index.html used to.
const MEASUREMENT_ID = 'G-QEVWXVQY66';

let loaded = false;

export function loadAnalytics() {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  // gtag.js reads the Arguments object itself, not an array, so this must not
  // become an arrow function with rest parameters.
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID);
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}
