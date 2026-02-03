import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Auto-reload when new content is available
const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm("New art has been added to the void. Reload?")) {
      updateSW(true);
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
