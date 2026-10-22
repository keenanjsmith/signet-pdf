import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

// Content Security Policy: the app may only talk to itself, plus Google
// when (and only when) you use a Google Drive feature.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com https://ssl.gstatic.com",
  "font-src 'self' data: blob:",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com https://content.googleapis.com",
  "frame-src https://accounts.google.com https://docs.google.com https://drive.google.com https://content.googleapis.com",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
  plugins: [{
    name: 'signet-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  }],
});
