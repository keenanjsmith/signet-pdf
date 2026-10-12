// Writes dist/sw.js with a versioned list of the app's files, so the app
// works offline and updates cleanly when a new version is published.
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(dist, p).split(sep).join('/'));
  }
};
walk(dist);

// Everything except the big character-map set (only needed for some Asian-language PDFs;
// those are cached the first time they are used).
const precache = files.filter((f) => f !== 'sw.js' && !f.startsWith('pdfjs/cmaps/') && !f.startsWith('pdfjs/iccs/'));
const hash = createHash('sha256');
for (const f of precache.sort()) hash.update(f).update(readFileSync(join(dist, f)));
const version = hash.digest('hex').slice(0, 12);

const template = readFileSync(fileURLToPath(new URL('../src/sw-template.js', import.meta.url)), 'utf8');
const sw = template
  .replace('__VERSION__', version)
  .replace('__PRECACHE__', JSON.stringify(['./', ...precache.map((f) => './' + f)], null, 0));
writeFileSync(join(dist, 'sw.js'), sw);
console.log(`sw.js written: version ${version}, ${precache.length} files precached`);
