import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { buildCsp } from './csp.ts';

/** Inject the CSP <meta> tag: strict in builds, relaxed only as far as HMR needs in dev. */
function csp(): Plugin {
  let mode: 'production' | 'development' = 'production';
  return {
    name: 'sslm-csp',
    configResolved(c) {
      mode = c.command === 'serve' ? 'development' : 'production';
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp(mode) }, injectTo: 'head-prepend' }];
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the deploy workflow sets BASE_PATH. Locally and
  // on Vercel the app lives at the root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), csp()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
