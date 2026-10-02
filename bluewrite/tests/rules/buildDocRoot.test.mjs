// BlueWrite — the build must not take the served document root apart.
//
// WHY THIS FILE EXISTS. `public/` is not only output: the PHP server serves it as
// its document root (`router.php`), so for as long as a build deletes files
// there, it is deleting files the app is fetching. Vite's default does exactly
// that — the root is emptied the moment the build starts — and it was measured
// here before this was changed: `index.html` and the whole `assets/` folder were
// missing for ~1.6 SECONDS of a ~7s build. A page reloaded in that window came
// back blank, and a page already open lost the hashed CSS and JS it was running
// on, because those were deleted before their replacements existed.
//
// Nothing about that throws, and nothing about it shows up in a diff — which is
// the whole reason it is asserted here rather than left to whoever reads the
// config next. The three things that have to stay true are read from the config
// itself: the root is never emptied, the files that let PHP answer at all are
// still copied in by the build, and the previous build's bundles are swept by
// the one hook that knows what this build emitted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CONFIG = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = code(CONFIG);

test('the build never empties the document root', () => {
  const build = SRC.match(/build:\s*\{[^}]*\}/);
  assert.ok(build, 'vite.config.js no longer states its build options');
  assert.match(build[0], /outDir:\s*'public'/, 'the build no longer writes into the served root');
  // The one setting this file exists for. `true` (and Vite's own default for an
  // outDir inside the project) empties the root AT THE START of the build, which
  // is the ~1.6s window every open page fell through.
  assert.match(build[0], /emptyOutDir:\s*false/, 'the build empties the document root it is served from');
  assert.doesNotMatch(build[0], /emptyOutDir:\s*true/, 'the build empties the document root it is served from');
});

test('the two files that let PHP answer are still put back by the build', () => {
  // A document root without api.php answers every /api/* request with a PHP fatal
  // error. They are copied by naming public-assets/ as Vite's publicDir, so the
  // copy is part of the build and cannot drift from it.
  assert.match(SRC, /publicDir:\s*'public-assets'/, 'the PHP shims are no longer copied in by the build');
  assert.match(SRC, /'\/api':\s*\{[\s\S]*?target:\s*'http:\/\/localhost:8099'/, 'the dev proxy no longer points at the API on 8099');
});

test('the previous build’s bundles are swept by the hook that knows what this one emitted', () => {
  // Not emptying the root means the previous build's hashed bundles stay behind.
  // `writeBundle` is the only place that is handed every file THIS build emitted,
  // so the sweep belongs there and nowhere else.
  assert.match(SRC, /writeBundle\(_options,\s*bundle\)/, 'the sweep no longer runs on the bundle it has to compare against');
  assert.match(
    SRC,
    /Object\.keys\(bundle\)/,
    'the sweep no longer reads the emitted file list, so it cannot tell a stale bundle from a live one',
  );
  // …and it must never run on an empty list: the one way a sweep could become the
  // thing that empties the root is a bundle that came back with nothing in it.
  assert.match(
    SRC,
    /if\s*\(emitted\.size\s*===\s*0\)\s*return;/,
    'the sweep runs even when the build emitted nothing — that is an empty document root',
  );
  // Scoped to the build's own assets folder, and read from the resolved config
  // rather than guessed: `api.php` and `.htaccess` live in the root and are not in
  // the bundle, so a sweep aimed at the root would delete them on every build.
  assert.match(SRC, /config\.build\.assetsDir/, 'the sweep guesses the assets folder instead of reading it');
  assert.match(SRC, /resolve\(outDir,\s*assetsDir\)/, 'the sweep is no longer scoped to the build’s assets folder');
  assert.match(SRC, /plugins:\s*\[react\(\),\s*keepTheDocRootWhole\(\)\]/, 'the sweep plugin is not registered');
});
