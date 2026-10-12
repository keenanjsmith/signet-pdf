// End-to-end test in a real browser (Chromium via Playwright).
// Usage: node tests/e2e.mjs <outdir> [baseUrl]
// Drives the app like a person would and saves the resulting PDFs for checking.
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.argv[2] || 'test-results';
const BASE = process.argv[3] || 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('  ', ...a);
const problems = [];

const browser = await chromium.launch();

async function session(label, { mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${label}] page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${label}] console: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '?test');
  await page.waitForSelector('.drop');
  return { ctx, page };
}

async function open(page, file) {
  await page.setInputFiles('#open-file', file);
  await page.waitForSelector('.pdfViewer .page canvas', { timeout: 20000 });
  await page.waitForTimeout(600);
}

async function pageBox(page, n) {
  return page.locator(`.pdfViewer .page[data-page-number="${n}"]`).boundingBox();
}

/** Screen point for page units (x, y from top-left of page). */
async function at(page, n, x, y) {
  const b = await pageBox(page, n);
  const info = await page.evaluate((n) => { const i = window.__signet.state.viewer.pageInfo[n - 1]; return { w: i.width, h: i.height }; }, n);
  const k = b.width / info.w;
  return { x: b.x + x * k, y: b.y + y * k, k };
}


/** Scroll page by page until a fill-in box appears, then type into it. */
async function fillFirstField(page, value) {
  const sel = '.annotationLayer input[type="text"]:visible, .annotationLayer textarea:visible';
  for (let n = 1; n <= 20; n++) {
    const pg = page.locator(`.pdfViewer .page[data-page-number="${n}"]`);
    if (!(await pg.count())) break;
    await pg.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const f = pg.locator(sel);
    if (await f.count()) { await f.first().fill(value); return n; }
  }
  throw new Error('no fill-in box found');
}

async function drawSignature(page) {
  const pad = page.locator('canvas.pad');
  await pad.waitFor();
  await page.waitForTimeout(200);
  const b = await pad.boundingBox();
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push([b.x + b.width * (0.12 + 0.75 * t), b.y + b.height * (0.55 - 0.22 * Math.sin(t * Math.PI * 3) * (1 - t * 0.4))]);
  }
  await page.mouse.move(...pts[0]); await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 2 });
  await page.mouse.up();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.35); await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.34, b.y + b.height * 0.7, { steps: 6 }); await page.mouse.up();
}

async function dragItemTo(page, itemSel, n, x, y) {
  const it = page.locator(itemSel).last();
  const b = await it.boundingBox();
  const to = await at(page, n, x, y);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function finishAndDownload(page, file, { lock = true, digitalId = null } = {}) {
  await page.click('#finish-btn');
  await page.waitForSelector('dialog.dlg[open]');
  const lockBox = page.locator('dialog .check:has-text("Lock form fields") input');
  if (await lockBox.count()) await lockBox.setChecked(lock);
  if (digitalId) {
    await page.locator('dialog .check:has-text("Add digital ID") input').check();
    await page.fill('dialog input[placeholder^="Optional"]', 'I approve this document');
  }
  await page.click('dialog button:has-text("Create signed PDF")');
  if (digitalId) {
    await page.waitForSelector('#pw-in');
    await page.fill('#pw-in', digitalId);
    await page.click('dialog button:has-text("Continue")');
  }
  await page.waitForSelector('dialog button:has-text("Download")', { timeout: 30000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog button:has-text("Download")')]);
  await dl.saveAs(`${OUT}/${file}`);
  log('saved', file, '(' + dl.suggestedFilename() + ')');
  await page.click('dialog .dlg-head button[aria-label="Close"]');
}

/* ---------------- 1. Form: type in fields, sign, date, text ---------------- */
for (const mobile of [false, true]) {
  const label = mobile ? 'phone' : 'desktop';
  console.log(`1. Fill and sign a form (${label})`);
  const { ctx, page } = await session(label, { mobile });
  await open(page, 'tests/fixtures-out/form.pdf');
  await page.waitForSelector('.smart-bar:has-text("fill-in box")', { timeout: 10000 }).catch(() => problems.push(`[${label}] fill-in box bar not shown`));

  await page.fill('.annotationLayer input[type="text"]', 'Keenan Q. Tester');
  await page.locator('.annotationLayer input[type="checkbox"]').check();

  await page.click('.tool:has-text("Signature")');
  await drawSignature(page);
  await page.click('dialog button:has-text("Use this signature")');
  await page.waitForSelector('.item-signature');
  // Put the signature on the signature line (line spans about x 128-245, y 592).
  const sb = await page.locator('.item-signature').boundingBox();
  const sz = await at(page, 1, 0, 0);
  await dragItemTo(page, '.item-signature', 1, 186, 592 - (sb.height / sz.k) / 2);

  await page.click('.tool:has-text("Date")');
  await dragItemTo(page, '.item-date', 1, 362, 586);

  await page.click('.tool:has-text("Text")');
  await page.keyboard.type('Hello World 123');
  await page.mouse.click(5, 300); // tap outside to finish typing
  await dragItemTo(page, '.item-text', 1, 230, 470);

  await page.click('.tool:has-text("Check")');
  await dragItemTo(page, '.item-check', 1, 420, 400);

  // Resize the signature bigger with the corner dot.
  await page.locator('.item-signature').click();
  const g = await page.locator('.item-signature .item-grip').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + 30, g.y + 8, { steps: 6 }); await page.mouse.up();

  // Undo the resize, then redo it isn't needed; just check undo works.
  const before = await page.evaluate(() => window.__signet.state.items.items.find((i) => i.kind === 'signature').w);
  await page.click('button[aria-label="Undo"]');
  const after = await page.evaluate(() => window.__signet.state.items.items.find((i) => i.kind === 'signature').w);
  if (!(after < before)) problems.push(`[${label}] undo did not revert resize (${before} -> ${after})`);

  await page.mouse.click(5, 300);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/editor-form-${label}.png` });
  const items = await page.evaluate(() => window.__signet.state.items.items.map(({ src, ...r }) => r));
  fs.writeFileSync(`${OUT}/items-form-${label}.json`, JSON.stringify(items, null, 1));
  await finishAndDownload(page, `form-${label}.pdf`);
  // Saved signature should now be on the home screen.
  await page.click('button[aria-label="Close document"]');
  await page.waitForSelector('.sig-card img');
  await page.screenshot({ path: `${OUT}/home-after-${label}.png` });
  await ctx.close();
}

/* ---------------- 2. Rotated pages ---------------- */
{
  console.log('2. Rotated pages');
  const { ctx, page } = await session('rotated');
  await open(page, 'tests/fixtures-out/rotated.pdf');
  for (let n = 1; n <= 4; n++) {
    await page.locator(`.pdfViewer .page[data-page-number="${n}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const info = await page.evaluate((n) => { const i = window.__signet.state.viewer.pageInfo[n - 1]; return { w: i.width, h: i.height }; }, n);
    await page.click('.tool:has-text("Text")');
    await page.keyboard.type(`TOPLEFT${n}`);
    await page.mouse.click(5, 400);
    await dragItemTo(page, '.item-text', n, 70, 40);
    await page.getByRole('button', { name: 'X', exact: true }).click();
    await dragItemTo(page, '.item-cross', n, info.w - 40, info.h - 40);
  }
  const items = await page.evaluate(() => window.__signet.state.items.items.map(({ src, ...r }) => r));
  fs.writeFileSync(`${OUT}/items-rotated.json`, JSON.stringify(items, null, 1));
  await finishAndDownload(page, 'rotated-out.pdf');
  await ctx.close();
}

/* ---------------- 3. Protected PDFs ---------------- */
for (const [file, pw] of [['enc_owner.pdf', null], ['enc_user256.pdf', 'userpw']]) {
  const src = `${OUT}/../pdfs/${file}`;
  if (!fs.existsSync(src)) { log('skip', file); continue; }
  console.log('3. Protected PDF', file);
  const { ctx, page } = await session(file);
  await page.setInputFiles('#open-file', src);
  if (pw) {
    await page.waitForSelector('#pw-in');
    await page.fill('#pw-in', 'wrong');
    await page.click('dialog button:has-text("Continue")');
    await page.waitForSelector('dialog[open] h2:has-text("Wrong password")');
    await page.fill('#pw-in', pw);
    await page.click('dialog button:has-text("Continue")');
  }
  await page.waitForSelector('.pdfViewer .page canvas', { timeout: 30000 });
  await page.waitForTimeout(800);
  log('filled field on page', await fillFirstField(page, 'PROTECTED FILL'));
  await page.click('.tool:has-text("Text")');
  await page.keyboard.type('Protected text');
  await page.mouse.click(5, 400);
  await finishAndDownload(page, 'out_' + file);
  await ctx.close();
}

/* ---------------- 4. Digital ID ---------------- */
{
  console.log('4. Digital ID');
  const { ctx, page } = await session('digital-id');
  await page.click('button:has-text("Manage")');
  await page.click('dialog button:has-text("Create personal ID")');
  const inputs = page.locator('dialog[open] form input');
  await inputs.nth(0).fill('Keenan Tester');
  await inputs.nth(1).fill('tester@example.com');
  await inputs.nth(2).fill('correct horse');
  await inputs.nth(3).fill('correct horse');
  await page.click('dialog[open] button:has-text("Create ID")');
  await page.waitForSelector('dialog[open] .id-row', { timeout: 30000 });
  await page.click('dialog[open] .dlg-head button[aria-label="Close"]');
  await open(page, 'tests/fixtures-out/form.pdf');
  await page.fill('.annotationLayer input[type="text"]', 'Digitally Signed Person');
  await page.click('.tool:has-text("Signature")');
  await drawSignature(page);
  await page.click('dialog button:has-text("Use this signature")');
  await finishAndDownload(page, 'digital-id.pdf', { digitalId: 'correct horse' });
  // Backup download of the ID
  await page.click('button[aria-label="Close document"]');
  await page.click('button:has-text("Manage")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] button[aria-label="Download backup"]')]);
  await dl.saveAs(`${OUT}/backup.p12`);
  log('saved backup.p12');
  await ctx.close();
}

/* ---------------- 5. Real-world government form (if provided) ---------------- */
{
  const src = `${OUT}/../pdfs/form526.pdf`;
  if (fs.existsSync(src)) {
    console.log('5. Large real-world form');
    const { ctx, page } = await session('real-form', { mobile: true });
    await open(page, src);
    log('filled field on page', await fillFirstField(page, 'REALFORM TEST'));
    await page.click('.tool:has-text("Signature")');
    await page.click('dialog button:has-text("Type")');
    await page.fill('dialog input[aria-label="Name to type"]', 'Real Form Tester');
    await page.click('dialog button:has-text("Use this signature")');
    await finishAndDownload(page, 'realform-out.pdf');
    await ctx.close();
  }
}

/* ---------------- 6. Filled field without a saved look ---------------- */
{
  console.log('6. Prefilled field with no saved appearance');
  const { ctx, page } = await session('noap');
  await open(page, 'tests/fixtures-out/noap.pdf');
  await page.click('.tool:has-text("Date")');
  await page.mouse.click(5, 400);
  await finishAndDownload(page, 'noap-out.pdf');
  await ctx.close();
}

await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'Browser run finished with no errors.');
process.exit(problems.length ? 1 : 0);
