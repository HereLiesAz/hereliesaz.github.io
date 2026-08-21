import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import JulesBoundary from './components/JulesBoundary';
import './utils/Logger'; // Initialize the logger immediately

// Restore the path public/404.html stashed before bouncing here (GitHub
// Pages has no server-side SPA fallback, so a direct nav/reload to a
// client-side route like /admin lands on 404.html first). Must run before
// wouter reads window.location below. sessionStorage can throw (site data
// blocked, storage-partitioned contexts) — that must never take down the
// whole app, including "/", which has no dependency on this at all.
try {
  const spaRedirect = sessionStorage.getItem('spaRedirect');
  if (spaRedirect) {
    sessionStorage.removeItem('spaRedirect');
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (spaRedirect !== current) window.history.replaceState(null, '', spaRedirect);
  }
} catch { /* storage unavailable — fall through with whatever URL we already have */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <JulesBoundary>
      <App />
    </JulesBoundary>
  </React.StrictMode>,
);
