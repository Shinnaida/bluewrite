import { readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * THE DOCUMENT ROOT IS THE RUNNING APP, so a build may not take it apart.
 *
 * `public/` is not just a folder of output. The PHP server serves it as its
 * document root (`router.php` hands `/api/*` to `public/api.php` and everything
 * else to the built shell), so while a build runs, every file it deletes is a
 * file the browser is trying to fetch — and the app can only report that as
 * "can't reach the BlueWrite server".
 *
 * Vite's default empties the root at the START of the build. Measured on this
 * machine against a ~10s build: `index.html` and the whole `assets/` folder were
 * missing for ~1.6 SECONDS of it. A page reloaded in that window comes back
 * blank; a page already open loses the hashed CSS and JS it is running on,
 * because those were deleted before their replacements existed. (`api.php` and
 * `.htaccess` were missing for a single 25ms sample — the copy from
 * `public-assets/` — so the API itself rides it out, which is why the banner was
 * never this.)
 *
 * So the root is never emptied: the previous build's files stay in place until
 * this build has written its own. That also means a FAILED build can no longer
 * destroy a working app — Vite writes nothing on failure, so nothing is swept.
 *
 * Which leaves the previous build's hashed bundles behind, and that is what this
 * sweeps: `writeBundle` is handed every file THIS build emitted, so anything
 * else under `assets/` is a bundle nothing references any more. The sweep is
 * scoped to `assets/` on purpose — `api.php` and `.htaccess` are copied in from
 * `public-assets/` and are not in the bundle at all — and it does nothing at all
 * if the bundle came back empty, so a sweep can never be the thing that empties
 * the root.
 */
function keepTheDocRootWhole() {
  let outDir = resolve('public');
  let assetsDir = 'assets';

  return {
    name: 'bw-keep-the-doc-root-whole',

    configResolved(config) {
      // Read rather than assumed: `assetsDir` is a build option, and a sweep that
      // guessed it wrong would delete nothing (harmless) or the wrong folder.
      outDir = resolve(config.root, config.build.outDir);
      assetsDir = config.build.assetsDir;
    },

    writeBundle(_options, bundle) {
      const emitted = new Set(Object.keys(bundle).map((p) => p.split('\\').join('/')));
      if (emitted.size === 0) return;

      const dir = resolve(outDir, assetsDir);
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // No assets folder: nothing of ours to sweep.
      }

      for (const entry of entries) {
        if (emitted.has(`${assetsDir}/${entry.name}`)) continue;
        rmSync(resolve(dir, entry.name), { recursive: true, force: true });
      }
    },
  };
}

// Base is relative so the built bundle works from any mount point,
// e.g. http://192.168.1.10/bluewrite/public/ — never hardcoded to localhost.
export default defineConfig({
  plugins: [react(), keepTheDocRootWhole()],
  base: './',
  // The document root carries TWO kinds of file: the built bundle, and the two
  // hand-written files Apache/the dev router need to reach PHP at all —
  // api.php (the front-controller shim) and .htaccess (the /api rewrite).
  //
  // They live in public-assets/ and are Vite's publicDir ON PURPOSE. A build
  // EMPTIES outDir, so anything that is not copied back by the build itself is
  // destroyed by the next one — and a document root without api.php answers
  // every /api/* request with a PHP fatal error, which the browser can only
  // report as "can't reach the BlueWrite server". Naming the folder here makes
  // the copy part of the build, so the two halves cannot drift apart and no
  // second command has to run afterwards for the app to work.
  //
  // (That emptying is OFF now — see keepTheDocRootWhole above, which is what
  // replaced it. The copy is still what puts the two files back, and it is still
  // the reason they are named here rather than left to a second command.)
  publicDir: 'public-assets',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8099',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'public',
    // Never true: this folder is SERVED while the build writes to it. The stale
    // bundles that leaves are swept by keepTheDocRootWhole above, which is the
    // safe half of emptying.
    emptyOutDir: false,
  },
});
