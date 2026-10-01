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
import { mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

/**
 * Vite's `import.meta.glob`, answered for esbuild.
 *
 * WHY A PLUGIN FOR ONE FUNCTION. `import.meta.glob` is a Vite TRANSFORM, not
 * JavaScript: it is replaced at build time by the object of matching modules,
 * which is exactly what makes it the right way for a screen to look for an
 * OPTIONAL file — `import hero from '../assets/home-hero.jpg'` is a build error
 * when the file is absent, and a string URL breaks under a sub-path. So the
 * production code keeps it, and this harness — which is esbuild, and does not
 * implement it — rewrites the one call it knows about to an empty result.
 *
 * EMPTY IS A REAL STATE, not a failure: the screen using it (Home, looking for a
 * station photograph) draws its own navy field when there is no picture, which is
 * the case every fixture exercises. Nothing else in the project uses the glob,
 * and the filter below leaves every other module untouched.
 */
function stubViteGlob() {
  return {
    name: 'stub-vite-glob',
    setup(build) {
      build.onLoad({ filter: /\.jsx?$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8');
        if (!source.includes('import.meta.glob')) return null;
        return {
          contents: source.replace(/import\.meta\.glob\(/g, 'bwStubViteGlob('),
          loader: 'jsx',
        };
      });
    },
  };
}

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
    inject: [path.join(here, 'stubViteGlob.js')],
    // A fixture that imports a real SCREEN imports what that screen imports,
    // and the screens import two things esbuild has no default loader for:
    // stylesheets (the whole document grammar) and images (the seals Home and
    // the printed sheet both print). Neither has anything to do with the
    // MARKUP these tests read, so neither is a reason to make a fixture import
    // a copy of the component instead of the component.
    //
    // CSS is emptied — it is a stylesheet, and a bundle of it next to the JS
    // output would be a file nothing reads. Images become data URLs rather than
    // being emptied too, because `src` is part of what a test may want to see:
    // "the footer draws the PNP seal" is an assertion about an attribute.
    // VITE'S OWN `import.meta.glob` IS ANSWERED BY THE PLUGIN BELOW: esbuild is
    // not Vite and does not implement it.
    plugins: [stubViteGlob()],
    loader: {
      '.css': 'empty',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.jpeg': 'dataurl',
      '.webp': 'dataurl',
      '.svg': 'dataurl',
    },
  });
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    await rm(out, { force: true });
  }
}
