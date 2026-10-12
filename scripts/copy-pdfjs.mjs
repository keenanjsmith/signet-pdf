// Copies pdf.js support files (fonts, character maps, decoders) into public/
// so the app never fetches them from a third-party CDN.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';

const src = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const dest = new URL('../public/pdfjs/', import.meta.url);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = new URL(dir + '/', src);
  if (existsSync(from)) cpSync(from, new URL(dir + '/', dest), { recursive: true });
}
console.log('pdf.js assets copied to public/pdfjs');
