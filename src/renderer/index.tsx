/**
 * index.tsx - React Application Entry Point
 * 
 * This is the entry point for the Renderer process (UI layer).
 * 
 * SECURITY REMINDER:
 * - NO direct file system access (use window.electronAPI)
 * - NO localStorage/sessionStorage (not supported in Electron context)
 * - All state managed via React hooks
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * Get root element from DOM.
 * TypeScript assertion ensures element exists.
 */
const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Root element not found. Check index.html for <div id="root"></div>');
}

/**
 * Create React root and render application.
 * 
 * React.StrictMode:
 * - Highlights potential problems in development
 * - Activates additional checks and warnings
 * - Does not affect production build
 */
const root = createRoot(rootElement);

root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
