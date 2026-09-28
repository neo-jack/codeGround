import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: { '^/(React|codeground/[^/]+)/api/': 'http://127.0.0.1:8091' },
  },
  build: { sourcemap: false },
});
