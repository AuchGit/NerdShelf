// src/main.jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './core/theme/theme.css';
import './shared/pwa/pwa.css';
// Section-specific mobile layout enhancements (MTG, DnD).
// All rules are gated on `body[data-pwa-layouts='true']`. Disable at
// runtime with `?pwaLayouts=0`. Code-side revert: remove this import.
import './shared/pwa/mobile-layouts.css';

// PWA on GitHub Pages is served from a sub-path (BASE_URL='/NerdShelf/'). The
// app fetches static JSON assets via absolute URLs like '/data/5e/...'. In
// Tauri BASE_URL is '/' so this is a no-op; in the PWA it rewrites the path
// to '/NerdShelf/data/...'. Keeps the existing fetch call sites untouched.
{
  const base = import.meta.env.BASE_URL;
  if (base && base !== '/') {
    const trimmed = base.replace(/\/$/, '');
    const origFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (typeof input === 'string' && input.startsWith('/') && !input.startsWith(base) && !input.startsWith('//')) {
        input = trimmed + input;
      }
      return origFetch(input, init);
    };
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);