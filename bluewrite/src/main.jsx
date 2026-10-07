import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './login-theme.css';
// Last, on purpose: it only carries [data-theme='dark'] rules, which win on
// specificity wherever they are, but keeping it last also makes the sheet's
// part in the cascade plain to read.
import './dark-theme.css';
import './fonts/fonts.css';

createRoot(document.getElementById('root')).render(<App />);

// THE OFFLINE SHELL (public-assets/sw.js, copied to the document root by the
// build). Registered ONLY in a production build, and that is not a detail: in dev
// the app is served as unbundled modules that change on every keystroke, so a
// worker answering those requests from a cache would be a broken live-reload —
// the very thing the dev server is for. The built app is the opposite case: its
// files are content-hashed and its shell is cached network-first, so a page
// opened while the station server is unreachable still draws the app, its
// wordmark and its seals instead of Chrome's "this site can't be reached".
//
// Registration is deliberately forgiving: a browser that refuses workers, or an
// origin that cannot scope one (file://, an insecure host), leaves the app
// exactly as it was — this must never be able to break the screen it protects.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Relative, so it names the app's own directory rather than the server root:
    // the LAN deployment serves BlueWrite from a subpath.
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
