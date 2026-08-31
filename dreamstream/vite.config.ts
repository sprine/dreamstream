import { defineConfig } from 'vite';

// WebHID is a secure-context API, so the dev server must be reached over
// localhost (which counts as secure) rather than a LAN IP.
export default defineConfig(({ command }) => ({
  // Served from https://sprine.github.io/dreamstream/, so built assets need
  // that prefix; the dev server still serves from the root.
  base: command === 'build' ? '/dreamstream/' : '/',
  server: { host: 'localhost', port: 5173, open: true },
  build: { target: 'es2022' },
}));
