// Renders the app icons from SVG (run once; output is committed).
import { chromium } from 'playwright';
const svg = (bleed) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${bleed
  ? '<rect width="32" height="32" fill="#1b3a9e"/><g transform="translate(16 16) scale(.7) translate(-16 -16)">'
  : '<g>'}<circle cx="16" cy="16" r="15" fill="#1b3a9e"/><path d="M8 20.5c2.6-.6 3.8-4.8 5-8.3.7-2 2.6-1.8 2.3.6-.4 3-2.3 6.7-1 7.1 1.1.4 2.1-2.4 3.2-2.3.9.1.5 1.8 1.4 1.9 1 .1 2-1 4.1-1" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 24h16" stroke="#fff" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round"/></g></svg>`;
const b = await chromium.launch();
const p = await b.newPage();
for (const [name, size, bleed] of [['icon-192', 192, false], ['icon-512', 512, false], ['maskable-512', 512, true], ['apple-touch-icon', 180, true]]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg(bleed).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: `public/icons/${name}.png`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await b.close();
console.log('icons done');
