// BlueWrite — the render harness: bundle a fixture, hand back the module.
//
// WHY SOME TESTS BUNDLE INSTEAD OF READING TEXT. Almost every test in tests/rules
// reads source as TEXT. That is cheap and it catches what text can catch — a class
// name, a copy string, the order two statements must be in. It cannot catch the one
// failure that has actually shipped twice in this project: a component that throws,
// or paints nothing, while all of its tests pass. A text test is satisfied by a
// component that reads correctly and renders a blank panel.
//
// So these fixtures are bundled with esbuild — the bundler Vite already ships, so
// this adds no dependency — and rendered with react-dom/server, and the tests read
// the markup. No browser and no jsdom are involved.
//
// WHAT THIS CANNOT CHECK, and it is important: effects do not run under
// renderToString. Anything that fetches, subscribes, or starts an interval is
// invisible to a render test by construction. That is why the fixture components
// take their data as props: the DRAWING is what gets checked, and the lifecycle
// stays in the wrapper where presence.test.mjs and the API tests cover the rules.

import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

/**
 * Where the bundles are written. NOT the OS temp directory: React stays external so
 * the bundle links against the installed copy, and node resolves a bare `react`
 * relative to the importing FILE — from outside the project there is no node_modules
 * above it to find. Inside node_modules (already ignored by git) it resolves, and
 * nothing is left lying around in the repository.
 */
const OUT_DIR = path.join(ROOT, 'node_modules/.cache/bw-render');

/**
 * Bundle a fixture and import it. Built per call rather than cached, because a cached
 * module would hide the failure these tests exist to find: a fixture that no longer
 * compiles.
 *
 * @param {string} relativePath fixture, relative to the project root
 */
export async function loadFixture(relativePath) {
  await mkdir(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${path.basename(relativePath, path.extname(relativePath))}-${process.pid}-${Date.now()}.mjs`);
  await esbuild.build({
    entryPoints: [path.join(ROOT, relativePath)],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server'],
    logLevel: 'silent',
  });
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    await rm(out, { force: true });
  }
}
