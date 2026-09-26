import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base is relative so the built bundle works from any mount point,
// e.g. http://192.168.1.10/bluewrite/public/ — never hardcoded to localhost.
export default defineConfig({
  plugins: [react()],
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
    emptyOutDir: true,
  },
});
