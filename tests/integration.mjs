// Checks Google Drive upload (against a stand-in for Google), the Android share
// menu handoff, offline use, and that the app makes no network calls on its own.
// Usage: node tests/integration.mjs <outdir> [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.argv[2] || 'test-results';
const BASE = process.argv[3] || 'http://localhost:4173/';
const problems = [];
const ok = (m) => console.log('   ok:', m);
const fail = (m) => { problems.push(m); console.log('   FAIL:', m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => fail('page error: ' + e.message));
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) fail('CSP: ' + m.text()); });

/* 1. No outside requests while using the app normally. */
console.log('1. Privacy: no outside requests during normal use');
const outside = [];
page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(BASE).origin) outside.push(r.url()); });

/* Stand-in for Google, so we can check exactly what would be sent. */
const uploads = [];
await ctx.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
  contentType: 'text/javascript',
  body: `window.google = { accounts: { oauth2: {
    initTokenClient(cfg) { return { callback: cfg.callback, requestAccessToken() { setTimeout(() => this.callback({ access_token: 'FAKE_TOKEN', expires_in: 3600, scope: '${'https://www.googleapis.com/auth/drive.file'}' }), 20); } }; },
    hasGrantedAllScopes(resp, s) { return resp.scope === s; },
    revoke(t, cb) { cb && cb(); } } } };`,
}));
await ctx.route('https://www.googleapis.com/**', async (route) => {
  const req = route.request();
  const url = req.url();
  const auth = req.headers()['authorization'];
  if (auth !== 'Bearer FAKE_TOKEN') return route.fulfill({ status: 401, body: '{}' });
  if (url.includes('/drive/v3/files?q=')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ files: [] }) });
  if (url.includes('/drive/v3/files?fields=id') && req.method() === 'POST') {
    uploads.push({ kind: 'folder', body: req.postData() });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'FOLDER123' }) });
  }
  if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
    const buf = req.postDataBuffer();
    uploads.push({ kind: 'file', size: buf.length, contentType: req.headers()['content-type'], buf });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'FILE1', name: 'x.pdf', webViewLink: 'https://drive.google.com/file/d/FILE1/view' }) });
  }
  return route.fulfill({ status: 404, body: '{}' });
});

await page.goto(BASE + '?test');
await page.waitForSelector('.drop');
await page.setInputFiles('#open-file', 'tests/fixtures-out/form.pdf');
await page.waitForSelector('.pdfViewer .page canvas');
await page.fill('.annotationLayer input[type="text"]', 'Drive Upload Test');
await page.click('.tool:has-text("Date")');
await page.mouse.click(5, 400);
await page.click('#finish-btn');
await page.click('dialog button:has-text("Create signed PDF")');
await page.waitForSelector('dialog button:has-text("Save to Google Drive")');
if (outside.length) fail('outside requests before using Drive: ' + outside.join(', ')); else ok('no requests left this device');

/* 2. Drive not set up: tapping Save to Google Drive opens setup. */
console.log('2. Google Drive');
await page.click('dialog button:has-text("Save to Google Drive")');
await page.waitForSelector('dialog[open] h2:has-text("Connect Google Drive")');
ok('setup screen shown when Drive is not configured');
await page.fill('dialog[open] input[placeholder$="googleusercontent.com"]', 'test-client.apps.googleusercontent.com');
await page.locator('dialog[aria-label="Connect Google Drive"]').getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(300);
// The Finish dialog is still open underneath; save now.
await page.click('dialog button:has-text("Save to Google Drive")');
await page.waitForSelector('dialog p:has-text("Saved to Google Drive")', { timeout: 10000 });
const file = uploads.find((u) => u.kind === 'file');
const folder = uploads.find((u) => u.kind === 'folder');
if (!folder || !/"name":"Signet PDF"/.test(folder.body)) fail('folder not created as expected'); else ok('created "Signet PDF" folder');
if (!file) fail('no file uploaded');
else {
  const text = file.buf.toString('latin1');
  const meta = text.match(/\{"name":[^\r\n]*\}/)?.[0];
  const pdfStart = text.indexOf('%PDF-');
  const pdfEnd = text.lastIndexOf('%%EOF');
  if (!meta || !meta.includes('"parents":["FOLDER123"]') || !meta.includes('"mimeType":"application/pdf"')) fail('bad metadata: ' + meta);
  else ok('upload metadata: ' + meta);
  if (pdfStart < 0 || pdfEnd < 0) fail('PDF bytes not in upload');
  else { fs.writeFileSync(`${OUT}/drive-upload.pdf`, file.buf.subarray(pdfStart, pdfEnd + 5)); ok(`PDF bytes uploaded (${pdfEnd - pdfStart} bytes)`); }
}
const nonGoogle = outside.filter((u) => !/^https:\/\/(accounts\.google\.com|www\.googleapis\.com)\//.test(u));
if (nonGoogle.length) fail('unexpected hosts contacted: ' + nonGoogle.join(', ')); else ok('only Google was contacted, and only after tapping Drive');
await page.click('dialog .dlg-head button[aria-label="Close"]');

/* 3. Share menu (Android): a PDF posted to /share-target opens in the app. */
console.log('3. Share menu handoff');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.evaluate(() => navigator.serviceWorker.ready);
const pdfB64 = fs.readFileSync('tests/fixtures-out/rotated.pdf').toString('base64');
const status = await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const fd = new FormData();
  fd.append('file', new File([bytes], 'Shared Lease.pdf', { type: 'application/pdf' }));
  const r = await fetch('./share-target', { method: 'POST', body: fd, redirect: 'manual' });
  return r.type + ' ' + r.status;
}, pdfB64);
await page.goto(BASE + '?shared=1&test');
try {
  await page.waitForSelector('.pdfViewer .page canvas', { timeout: 10000 });
  const name = await page.textContent('#doc-name');
  if (name === 'Shared Lease.pdf') ok('shared file opened: ' + name + ` (${status})`); else fail('shared file name wrong: ' + name);
} catch { fail('shared file did not open (' + status + ')'); }

/* 4. Works offline once installed. */
console.log('4. Offline');
await page.goto(BASE);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(1500);
await ctx.setOffline(true);
await page.goto(BASE + '?test').catch(() => {});
try {
  await page.waitForSelector('.drop', { timeout: 8000 });
  await page.setInputFiles('#open-file', 'tests/fixtures-out/form.pdf');
  await page.waitForSelector('.pdfViewer .page canvas', { timeout: 10000 });
  await page.click('.tool:has-text("Signature")');
  await page.waitForSelector('canvas.pad');
  ok('app loads, opens a PDF and signs while offline');
} catch (e) { fail('offline use failed: ' + e.message); }
await ctx.setOffline(false);

await browser.close();
console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nAll integration checks passed.');
process.exit(problems.length ? 1 : 0);
