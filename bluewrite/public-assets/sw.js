/* ============================================================================
   BlueWrite — the offline shell.

   THE FAILURE THIS EXISTS FOR. When the station server cannot be reached, a
   browser asked for http://127.0.0.1:5180/ (or the PHP origin on 8099) has
   nothing to draw with: the whole app arrives from that origin, so the tab shows
   Chrome's own "This site can't be reached" page — no app, no wordmark, no seals,
   not even the sentence that would explain what is wrong. Reloading during an
   outage, or opening the bookmark after one, is the one moment the app should be
   holding its ground, and instead it disappears. This file is the browser-side
   half of not disappearing: once the app has been opened successfully ONE time,
   the shell it was drawn from — and the logo/seal pictures in it — live on in
   this computer's cache, and a navigation with no server behind it is answered
   from there.

   WHAT IT DELIBERATELY DOES NOT CACHE: the API. Not one JSON answer. The station
   PCs are shared, a cached register would be readable by the next officer who
   signs in, and the app already has a place for the last list it showed — a
   SESSION store that dies with the tab (src/lib/offlineCache.js, and the reason
   it is sessionStorage rather than localStorage is written down there). The only
   server images fetched through /api that this keeps are the officer photographs,
   so a face in the presence rail does not turn into a broken image mid-shift; a
   photograph is not a report.

   THE RULES, by request:
     * navigation                → network first, cached shell when the network is
                                   gone (this is the whole point of the file), and
                                   an offline notice if even that is missing;
     * same-origin /assets/*     → cache first: those names are content-hashed by
                                   the build, so a hit can never be stale, and a
                                   miss is fetched and kept;
     * /api/v1/users/<id>/photo  → cache first, kept in a cache of its own;
     * any other /api/*          → network only, never stored;
     * everything else           → the network, with the cache as a fallback for
                                   images, fonts, styles and scripts.

   IT IS A CLASSIC SCRIPT, NOT A MODULE, and it is copied into the built document
   root by Vite (public-assets/ is the build's publicDir; see vite.config.js) —
   so it sits at /sw.js with the scope of the whole app. Registration is in
   src/main.jsx and happens in a PRODUCTION build only: in dev the app is served
   as unbundled modules that change on every keystroke, and a cache answering
   those requests with yesterday's source is a broken live-reload.

   BUMP `VERSION` WHEN THE SHELL CHANGES SHAPE. Activation deletes every cache
   that does not carry the current version, which is what keeps this file from
   becoming the thing that serves last month's app.
   ========================================================================= */

const VERSION = 'bw-shell-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const PHOTOS_CACHE = `${VERSION}-photos`;

// The starting point: the one URL that is the app. `./` rather than `/` because
// the LAN deployment serves this app from a subpath (the document root is
// .../bluewrite/public/) and a leading slash would name the server's root instead.
const SHELL = ['./', './index.html'];

// What the app's own directory is, from the location of this worker: '/sw.js' at
// the root, '/bluewrite/public/sw.js' under Apache. Every request is measured
// against it rather than against an assumed root.
const BASE = new URL('./', self.location.href).pathname;

const sameApp = (url) => url.origin === self.location.origin && url.pathname.startsWith(BASE);

// The path inside the app, whatever the app's own directory happens to be — so
// every test below reads the same on localhost and under a subpath on the LAN.
const withinApp = (url) => url.pathname.slice(BASE.length);

// `/assets/` anywhere under the app: the build's content-hashed bundles, and the
// logo and seal pictures bundled with them.
const isAsset = (url) => sameApp(url) && url.pathname.includes('/assets/');

const isApi = (url) => sameApp(url) && withinApp(url).startsWith('api/');

// An officer's photograph. Deliberately the ONLY /api request this file keeps:
// `?v=` is the server's own cache-buster, so a replaced photograph is a new URL
// and a stale face cannot be served under a changed one.
const isPhoto = (url) =>
  sameApp(url) && /^api\/v1\/users\/[^/]+\/photo\/?$/.test(withinApp(url));

// Anything the browser draws with. Kept in the shell cache.
const CACHEABLE_DESTINATIONS = ['image', 'font', 'style', 'script', 'manifest'];

/* ---- install ---------------------------------------------------------------
   The shell is cached from the network, and so are the files it names. The
   bundles carry content hashes, so there is no way to enumerate them from here —
   the only honest way to learn their names is to read the shell that references
   them, which is what this does. A failed asset (a build mid-flight) is skipped
   rather than failing the install: an app that works when the server is up beats
   an install that refuses to complete. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL).catch(() => {});
      try {
        const shell = await fetch('./index.html', { cache: 'no-cache' });
        if (!shell || !shell.ok) return;
        const html = await shell.clone().text();
        await cache.put('./index.html', shell);
        const refs = html.match(/(?:src|href)="([^"]+)"/g) || [];
        const urls = [];
        for (const ref of refs) {
          const url = ref.slice(ref.indexOf('"') + 1, -1);
          // Same-directory, relative references only: './assets/index-abc.js',
          // 'assets/x.css'. An absolute or off-origin reference is not ours.
          if (/^(\.\/)?assets\//.test(url) || /^\.\/[^/]+\.(png|ico|svg|css|js)$/.test(url)) {
            urls.push(new URL(url, self.location.href).href);
          }
        }
        await Promise.all(urls.map((u) => cache.add(u).catch(() => {})));
      } catch {
        // No shell to read: the app simply has no offline copy yet.
      }
      await self.skipWaiting();
    })(),
  );
});

/* ---- activate --------------------------------------------------------------
   One version at a time. Everything older is deleted, so "offline" can never mean
   "yesterday's app". */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/* The offline notice, for the case where the app has never been opened on this
   computer and there is therefore nothing to answer with. It is deliberately
   tiny, self-contained and logo-free: it is the one page here that must not
   depend on a single fetched byte. */
function offlineNotice() {
  const html = [
    '<!doctype html><meta charset="utf-8">',
    '<title>BlueWrite — no connection</title>',
    '<style>',
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;',
    'background:#0B1220;color:#E6EAF0;font:15px/1.6 Segoe UI,Tahoma,sans-serif}',
    'div{max-width:34rem;padding:2rem}',
    'h1{font-size:1rem;letter-spacing:.14em;text-transform:uppercase;color:#F0B429;margin:0 0 .6rem}',
    'p{margin:.5rem 0 0;color:#9FB0C7}',
    '</style>',
    '<div><h1>No connection to the station server</h1>',
    '<p>This computer has not opened BlueWrite successfully yet, so there is no saved copy to show.',
    ' The page will work again as soon as the server is back — press retry, or reopen the app in a moment.</p>',
    '<p>Nothing was lost: reports are saved on the server.</p></div>',
  ].join('');
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/* ---- fetch ----------------------------------------------------------------- */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // The API's JSON: never stored here. The app keeps its own session-scoped copy
  // of the last list (src/lib/offlineCache.js), and that is the only place
  // server data belongs on a shared workstation.
  if (isApi(url) && !isPhoto(url)) return;

  // A page: the app itself, answered from the cache when nothing answers on the
  // network — this is the reason the file exists.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached = (await cache.match('./index.html')) || (await cache.match('./'));
          return cached || offlineNotice();
        }
      })(),
    );
    return;
  }

  // A face. Cache first so it survives the server going away mid-shift.
  if (isPhoto(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PHOTOS_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const fresh = await fetch(request);
        // Awaited, not fired and forgotten: a put that has not finished when the
        // tab is closed is a face that is not there the next time it is needed.
        if (fresh && fresh.ok) await cache.put(request, fresh.clone()).catch(() => {});
        return fresh;
      })(),
    );
    return;
  }

  // A hashed bundle, or a picture: a hit cannot be stale, so it is served at once
  // and refreshed quietly in the background.
  if (isAsset(url) || CACHEABLE_DESTINATIONS.includes(request.destination)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(request);
        if (hit) {
          event.waitUntil(
            fetch(request)
              .then((fresh) => (fresh && fresh.ok ? cache.put(request, fresh.clone()) : null))
              .catch(() => null),
          );
          return hit;
        }
        // A miss with no network behind it rejects, exactly as the browser's own
        // fetch would: nothing here invents a response for a bundle.
        const fresh = await fetch(request);
        if (fresh && fresh.ok) await cache.put(request, fresh.clone()).catch(() => {});
        return fresh;
      })(),
    );
  }
});
