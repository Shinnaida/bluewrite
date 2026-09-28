import reactPlugin from '@vitejs/plugin-react';

const config = {
  configFile: false,
  plugins: [reactPlugin()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: '.tmp-gate-dist',
    emptyOutDir: true,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: '.tmp-gate-entry.jsx',
      formats: ['iife'],
      name: 'GateProbe',
      fileName: () => 'probe.js',
    },
  },
};

export default config;
