// BlueWrite — connection-resilience rules: a failed connection costs FRESH DATA,
// never the screen. Four pins:
//
//   1. the api layer bounds every request in time and translates a bare fetch
//      rejection into the classified Error every screen already draws;
//   2. the workspace answers the browser's own online/offline events, not just
//      the next failed refresh;
//   3. a panel that throws is fenced to a card (ErrorBoundary), never a blank
//      page — and both the gate and the workspace stand behind one;
//   4. the stylesheet holds layout without network bytes (pictures keep their
//      box, lists keep their height).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT as root } from './renderHarness.mjs';

const readSrc = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

test('every request is time-bounded and a dead server reads as the classified offline error', async () => {
  const src = await readSrc('src/lib/api.js');
  assert.match(src, /FETCH_TIMEOUT_MS/, 'no request bound in time: a hung server holds the spinner forever');
  assert.match(src, /AbortController/, 'the bound is not enforced: nothing aborts a hung request');
  assert.match(src, /function offlineError/, 'a bare fetch rejection is not translated where it is raised');
  assert.match(src, /cause = 'offline'/, 'the translated failure carries no cause the UI can classify');
  for (const fn of ['export async function api\\(', 'export async function apiUpload\\(', 'export async function apiBlobUrl\\(']) {
    const body = src.slice(src.search(new RegExp(fn)));
    assert.match(body.slice(0, 900), /fetchWithTimeout/, `${fn} still calls raw fetch: one path hangs while the others recover`);
  }
  assert.match(src, /keepalive/, 'the exit-flush still skips the bound: a closing page must not wait');
});

test('the workspace banners the browser offline state at once and re-reads on return', async () => {
  for (const file of ['src/components/Shell.jsx', 'src/components/layout/Shell.jsx']) {
    const src = await readSrc(file);
    assert.match(src, /addEventListener\('offline'/, `${file} never hears the cable being pulled`);
    assert.match(src, /addEventListener\('online'/, `${file} never hears the return trip`);
    assert.match(src, /navigator\.onLine/, `${file} opens wrong on a computer that is already offline`);
  }
});

test('a throwing panel is fenced to a card, and both the gate and the workspace stand behind one', async () => {
  const fence = await readSrc('src/components/ErrorBoundary.jsx');
  assert.match(fence, /getDerivedStateFromError/, 'the fence never trips: no static error state');
  assert.match(fence, /componentDidCatch/, 'the failure is never logged where it can be found');
  assert.match(fence, /Try again/, 'the fence traps the officer: no way back without reloading');
  const app = await readSrc('src/App.jsx');
  assert.match(app, /ErrorBoundary/, 'no fence is mounted: one throwing panel still blanks the app');
  assert.match(app, /fallback=\"the sign-in gate\"/, 'the gate stands outside the fence');
  assert.match(app, /fallback=\"the workspace\"/, 'the workspace stands outside the fence');
});

test('the design holds without network bytes: pictures keep their box, lists keep their height', async () => {
  const css = await readSrc('src/styles.css');
  assert.match(css, /\.error-fence/, 'the fence has no face: unstyled fallback card');
  assert.match(css, /object-fit:\s*cover/, 'a photograph that cannot load re-flows the words beside it');
  assert.match(css, /min-height:\s*12rem/, 'a list that cannot reload collapses and jumps on retry');
});
