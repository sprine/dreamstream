import { defineConfig } from 'vite';

// WebHID is a secure-context API, so the dev server must be reached over
// localhost (which counts as secure) rather than a LAN IP.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/dreamstream/' : '/',
  server: { host: 'localhost', port: 5173, open: true },
  build: { target: 'es2022' },
});
