import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import JulesBoundary from './components/JulesBoundary';
import './utils/Logger'; // Initialize the logger immediately

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <JulesBoundary>
      <App />
    </JulesBoundary>
  </React.StrictMode>,
);
