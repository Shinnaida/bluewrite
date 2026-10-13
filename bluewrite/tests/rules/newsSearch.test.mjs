// BlueWrite — the dashboard's "Search the news" panel and the server proxy behind it.
//
// THE RULES THAT MATTER. The Webz token must stay on the server: the browser calls
// our own /news/search, never the vendor. The endpoint is Admin-only, like the
// dashboard it sits in. And a station with no token gets a plain "not set up"
// answer, not a broken panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the news proxy is Admin-only and reads its token from the server environment', () => {
  const src = read('app/controllers/NewsController.php');
  assert.match(src, /Auth::requireRole\('Admin'\)/, 'the news search must be Admin-only');
  assert.match(src, /getenv\('WEBZ_API_TOKEN'\)/, 'the token must come from the environment');
  assert.match(src, /'configured' => false/, 'a station without a token must get a plain answer');
  assert.doesNotMatch(src, /echo\s+\$raw/, 'the raw vendor payload must not be passed through');
});

test('the route is registered in the API front controller', () => {
  const api = read('api/index.php');
  assert.match(api, /require __DIR__ \. '\/\.\.\/app\/controllers\/NewsController\.php'/);
  assert.match(api, /\$seg0 === 'news' && \$seg1 === 'search' && \$method === 'GET'/);
});

test('the panel calls our proxy, never the vendor, and opens links in a new tab', () => {
  const src = read('src/components/NewsSearch.jsx');
  assert.match(src, /api\(`\/news\/search\?q=/);
  assert.doesNotMatch(src, /api\.webz\.io/i, 'the browser must not call the news vendor directly');
  assert.match(src, /target="_blank" rel="noopener noreferrer"/);
});

test('the panel says what is missing when the station has no token', () => {
  const src = read('src/components/NewsSearch.jsx');
  assert.match(src, /result\.configured === false/);
  assert.match(src, /WEBZ_API_TOKEN/);
});

test('the dashboard does not mount the news panel (removed on request)', () => {
  const src = read('src/components/Dashboard.jsx');
  assert.doesNotMatch(src, /NewsSearch/);
});

test('the panel animates in, and the motion is switched off for reduced motion', () => {
  const css = read('src/components/NewsSearch.css');
  assert.match(css, /@keyframes ns-rise/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
