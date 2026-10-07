// BlueWrite — the offline shell: the app still draws when the server is gone.
//
// WHY THIS FILE EXISTS. `public-assets/sw.js` is the only thing in this project
// that runs when the app cannot: a browser asking for the app's URL with no server
// behind it gets the cached shell instead of Chrome's "this site can't be
// reached", and the wordmark, the seals and the hashed bundles come back with it.
// That makes three of its promises load-bearing, and none of them can be seen in a
// diff or in a normal test run:
//
//   1. IT ANSWERS A NAVIGATION WITH THE SHELL when the network is gone, and says
//      something honest when even the shell was never cached.
//   2. IT NEVER STORES THE API'S JSON. A station PC is shared and a cached
//      register is readable by the next officer — the app keeps its own
//      session-scoped copy precisely so this file does not have to. Officer
//      PHOTOGRAPHS are the one exception, and they are asserted separately so the
//      exception stays exactly as wide as it is.
//   3. IT IS REGISTERED IN A PRODUCTION BUILD ONLY. In dev the app is served as
//      unbundled modules, and a cache answering those requests is a broken
//      live-reload.
//
// HOW IT IS READ. The worker is a classic script written against the service
// worker globals, so it is loaded here the way a worker would load it — with
// fakes for `self`, `caches` and `fetch` — and then driven through real requests.
// A source-level check could only prove the words are present; this proves what
// the file does with a request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SW_PATH = new URL('../../public-assets/sw.js', import.meta.url);
const SW = readFileSync(SW_PATH, 'utf8');
const MAIN = readFileSync(new URL('../../src/main.jsx', import.meta.url), 'utf8');

const ORIGIN = 'http://127.0.0.1:5180/';

/* ---- the fakes the worker runs against ------------------------------------ */

/** A response-shaped object with just the parts the worker touches. */
function fakeResponse(body, url) {
  return {
    ok: true,
    status: 200,
    url,
    clone: () => fakeResponse(body, url),
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

/**
 * In-memory CacheStorage, keyed the way a browser keys it: by URL.
 *
 * `fetchRef` is the same live network the worker is handed, so `add`/`addAll`
 * fill the cache from it — which is what the worker's install does to cache the
 * files the shell names. A cache that could not fetch would report that work as
 * missing when it is only unable to happen here.
 */
function fakeCaches(fetchRef) {
  const stores = new Map();
  const keyOf = (request) => (typeof request === 'string' ? new URL(request, ORIGIN).href : request.url);
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      add: async (url) => {
        const key = keyOf(url);
        const res = await fetchRef.current(url);
        if (res && res.ok) store.set(key, res);
      },
      addAll: async (urls) => {
        for (const url of urls) {
          const key = keyOf(url);
          const res = await fetchRef.current(url);
          if (res && res.ok) store.set(key, res);
        }
      },
      put: async (request, response) => store.set(keyOf(request), response),
      match: async (request) => store.get(keyOf(request)),
      keys: async () => [...store.keys()],
      delete: async (request) => store.delete(keyOf(request)),
    };
  };
  return {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    _stores: stores,
  };
}

/** The network, as the worker sees it: a table of bodies, and an outage switch. */
function network({ down = false, bodies = {} } = {}) {
  const calls = [];
  const fetchFn = async (input) => {
    const url = typeof input === 'string' ? new URL(input, ORIGIN).href : input.url;
    calls.push(url);
    if (down) throw new TypeError('Failed to fetch');
    const body = bodies[url] ?? bodies[url.split('?')[0]];
    if (body === undefined) throw new TypeError('Failed to fetch');
    if (body === false) return { ok: false, status: 500, url, clone() { return this; }, text: async () => '' };
    return fakeResponse(body, url);
  };
  fetchFn.calls = calls;
  return fetchFn;
}

/** Load the worker into fakes, exactly as a browser would. */
function loadWorker({ fetchFn }) {
  const listeners = new Map();
  // One live network, shared by the worker and by the caches it fills, and
  // swappable so a test can pull the server out from under a running worker.
  const fetchRef = { current: fetchFn };
  const cacheStorage = fakeCaches(fetchRef);
  const self = {
    // origin is spelled out because a real Location has one, and every scoping
    // decision in the worker is measured against it: a fake without it would let
    // an off-origin request look like the app's own.
    location: { href: `${ORIGIN}sw.js`, origin: ORIGIN.slice(0, -1) },
    addEventListener: (type, handler) => listeners.set(type, handler),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'URL', SW)(
    self,
    cacheStorage,
    (input, init) => fetchRef.current(input, init),
    Response,
    URL,
  );

  const call = async (type, event) => {
    let served = null;
    const waits = [];
    listeners.get(type)({
      request: event.request,
      respondWith: (p) => {
        served = p;
      },
      waitUntil: (p) => waits.push(p),
    });
    // BOTH KINDS OF WORK ARE AWAITED, as a browser would: the response the page
    // waits for, and the work the worker asked to finish after it (the install, and
    // the quiet refresh behind a cached answer). A harness that dropped the second
    // would report the caching as missing when it is merely still in flight.
    const [response] = await Promise.all([served ? served : null, Promise.all(waits)]);
    return { response, waits, cache: cacheStorage };
  };

  return { call, listeners, cache: cacheStorage, self, setNetwork: (fn) => (fetchRef.current = fn) };
}

const navigate = (path = './') => ({ request: { method: 'GET', mode: 'navigate', url: `${ORIGIN}${path.replace('./', '')}`, destination: 'document' } });
const get = (url, destination = '') => ({ request: { method: 'GET', mode: 'cors', url, destination } });

const SHELL_HTML = '<!doctype html><html><head><link rel="stylesheet" href="./assets/index-abc.css">'
  + '<script type="module" src="./assets/index-def.js"></script></head><body></body></html>';

test('a navigation with no server behind it is answered from the cached shell', async () => {
  const up = network({ bodies: { [`${ORIGIN}index.html`]: SHELL_HTML, [`${ORIGIN}`]: SHELL_HTML, [`${ORIGIN}assets/index-abc.css`]: 'body{}', [`${ORIGIN}assets/index-def.js`]: 'export {}' } });
  const worker = loadWorker({ fetchFn: up });

  // First load, with the server up: install caches the shell and the files it names.
  await worker.call('install', {});
  const installCache = await worker.cache.open('bw-shell-v1-shell');
  const shellKeys = await installCache.keys();
  assert.ok(shellKeys.includes(`${ORIGIN}index.html`), 'the shell itself was not cached');
  assert.ok(
    shellKeys.includes(`${ORIGIN}assets/index-abc.css`) && shellKeys.includes(`${ORIGIN}assets/index-def.js`),
    'the files the shell names were not cached, so an offline open would be unstyled and dead',
  );

  // Then the station server goes away, and the browser asks for the app again.
  const down = network({ down: true });
  worker.setNetwork(down);
  const served = await worker.call('fetch', navigate('./'));
  assert.ok(served.response, 'the worker refused to answer a navigation at all');
  assert.match(await served.response.text(), /index-abc\.css/, 'the offline answer was not the cached shell');
});

test('a first visit during an outage says what is wrong instead of failing', async () => {
  const worker = loadWorker({ fetchFn: network({ down: true }) });
  const served = await worker.call('fetch', navigate('./'));
  assert.ok(served.response, 'nothing was answered');
  assert.equal(served.response.status, 200, 'the offline notice is not a page a browser will render');
  const html = await served.response.text();
  assert.match(html, /No connection to the station server/);
  assert.doesNotMatch(html, /<(link|script|img)/, 'the notice reaches for a file it cannot fetch');
});

test('the API is never stored, and a photograph is the one exception', async () => {
  const photo = `${ORIGIN}api/v1/users/9/photo?v=4`;
  const reports = `${ORIGIN}api/v1/reports?page=1`;
  const bodies = {
    [photo]: 'PHOTO-BYTES-ONE',
    [reports]: '{"reports":[{"id":1}]}',
  };
  const worker = loadWorker({ fetchFn: network({ bodies }) });
  await worker.call('install', {});

  // A register read: the worker stays out of it entirely — NOT calling
  // respondWith is how the request reaches the network untouched — and stores
  // nothing.
  const list = await worker.call('fetch', get(reports));
  assert.equal(list.response, null, 'the worker answered an API read out of its own hands');
  assert.ok(list.waits.length === 0, 'the worker scheduled work for an API read');
  // ...and nothing it owns holds the register, whichever cache it might be in.
  const stored = [];
  for (const name of await worker.cache.keys()) {
    for (const key of await (await worker.cache.open(name)).keys()) stored.push(key);
  }
  assert.ok(!stored.includes(reports), `the register was stored on this computer: ${stored.join(', ')}`);

  // A face: cached, and served from the cache even with the server gone.
  await worker.call('fetch', get(photo, 'image'));
  const photos = await worker.cache.open('bw-shell-v1-photos');
  assert.ok((await photos.keys()).includes(photo), 'the photograph was not kept, so the rail breaks mid-shift');
  worker.setNetwork(network({ bodies: { [photo]: 'PHOTO-BYTES-TWO' } }));
  const again = await worker.call('fetch', get(photo, 'image'));
  assert.equal(await again.response.text(), 'PHOTO-BYTES-ONE', 'the photograph was refetched rather than served from the cache');
});

test('a hashed bundle is served from the cache, because its name can never be stale', async () => {
  const asset = `${ORIGIN}assets/index-abc.css`;
  const worker = loadWorker({ fetchFn: network({ bodies: { [asset]: 'BUNDLE-ONE', [`${ORIGIN}index.html`]: SHELL_HTML, [`${ORIGIN}`]: SHELL_HTML } }) });
  await worker.call('install', {});
  worker.setNetwork(network({ bodies: { [asset]: 'BUNDLE-TWO' } }));
  const served = await worker.call('fetch', get(asset, 'style'));
  assert.equal(await served.response.text(), 'BUNDLE-ONE', 'a hashed bundle was fetched over the cached copy');
});

test('one version of the shell at a time, and it takes over without a reload', () => {
  assert.match(SW, /const VERSION = '[^']+'/, 'the shell cache is no longer versioned');
  const activate = SW.slice(SW.indexOf("addEventListener('activate'"));
  assert.match(activate, /caches\.keys\(\)/, 'activation no longer enumerates the caches');
  assert.match(activate, /filter\(\(name\) => !name\.startsWith\(VERSION\)\)[\s\S]*?caches\.delete/, 'an older shell would survive beside the new one');
  assert.match(activate, /clients\.claim\(\)/, 'the new worker would not take over until every tab was closed');
  assert.match(SW, /await self\.skipWaiting\(\)/, 'a fixed worker would wait for the next visit to install');
});

test('the worker is registered by the built app only, and never by the dev server', () => {
  // THE PREMISE: it is a public-assets file, so the build copies it into the
  // document root at /sw.js with the scope of the whole app.
  assert.match(MAIN, /import\.meta\.env\.PROD && 'serviceWorker' in navigator/, 'the shell is registered in dev, where it would answer live modules from a cache');
  assert.match(MAIN, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/, 'the worker is registered somewhere other than the app\'s own directory');
  assert.match(MAIN, /\.register\('\.\/sw\.js'\)\.catch\(\(\) => \{\}\)/, 'a browser that refuses workers would break the app it is meant to protect');
  // ...and the file is where the build will find it, in the folder that is copied
  // into the document root on every build (vite.config.js publicDir).
  assert.ok(SW.length > 1000, 'the worker is not there to copy');
});
