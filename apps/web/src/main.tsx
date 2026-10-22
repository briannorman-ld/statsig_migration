import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

/**
 * Clickjacking guard. Vercel sends `frame-ancestors 'none'` as a header, but static hosts like
 * GitHub Pages can't send headers and browsers ignore frame-ancestors in a <meta> CSP. People
 * paste API tokens here, so refuse to render inside someone else's frame.
 */
function framed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true; // a cross-origin parent makes window.top inaccessible
  }
}

const root = document.getElementById('root')!;
if (import.meta.env.PROD && framed()) {
  root.textContent = 'This app cannot run inside a frame. Open it directly in a browser tab.';
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
