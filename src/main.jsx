/**
 * ENTRY POINT
 * ===========
 * This is the standard entry point for a React application built with Vite.
 * It mounts the root component (<App />) into the DOM element with id 'root'.
 */

// Import the React library.
import React from 'react';

// Import the ReactDOM client for rendering the app into the DOM.
import ReactDOM from 'react-dom/client';

// Import the main application component.
import App from './App';

// Import global CSS styles.
import './index.css';

// Find the HTML element with id 'root' (in index.html) and create a React Root.
ReactDOM.createRoot(document.getElementById('root')).render(
  // React.StrictMode activates additional checks and warnings for its descendants.
  // Note: This causes double-rendering in development mode, which is expected behavior.
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
import JulesBoundary from './components/JulesBoundary';
import './utils/Logger'; // Initialize logger

ReactDOM.createRoot(document.getElementById('root')).render(
  <JulesBoundary>
    <App />
  </JulesBoundary>
);
