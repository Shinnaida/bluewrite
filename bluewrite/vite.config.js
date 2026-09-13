import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base is relative so the built bundle works from any mount point,
// e.g. http://192.168.1.10/bluewrite/public/ — never hardcoded to localhost.
export default defineConfig({
  plugins: [react()],
  base: './',
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
