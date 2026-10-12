// Browser test for smart filling: My info, autofill, private details,
// sign-here boxes, signing dates, flat PDFs and the next-box button.
// Usage: node tests/smart.mjs <outdir> [baseUrl] [extra.pdf ...]
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.argv[2] || 'test-results';
const BASE = process.argv[3] || 'http://localhost:4173/';
const EXTRA = process.argv.slice(4);
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const ok = (m) => console.log('   ok:', m);
const fail = (m) => { problems.push(m); console.log('   FAIL:', m); };
const check = (cond, m) => (cond ? ok(m) : fail(m));

const now = new Date();
const TODAY = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
const ME = { firstName: 'Alex', middleName: 'Quinn', lastName: 'Rivera', email: 'alex@example.com', phone: '217-555-0142', street: '123 Main St', unit: '4B', city: 'Springfield', state: 'IL', zip: '62701', country: 'United States', dob: '1990-07-04', ssn: '123456789', vaFile: '987654321', serviceNumber: '1234567890' };
const PASS = 'blue horse 42';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => fail('page error: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') fail('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());

async function home() { await page.goto(BASE + '?test'); await page.waitForSelector('.drop'); }
async function open(file) {
  await page.setInputFiles('#open-file', file);
  await page.waitForSelector('.pdfViewer .page canvas', { timeout: 30000 });
  await page.waitForFunction(() => window.__signet.state.smart?.ready, null, { timeout: 30000 });
  await page.waitForTimeout(500);
}
const val = (name) => page.evaluate((n) => { const el = document.querySelector(`.annotationLayer [name="${n}"]`); return el ? el.value : null; }, name);
async function finishDownload(file) {
  await page.click('#finish-btn');
  await page.click('dialog button:has-text("Create signed PDF")');
  await page.waitForSelector('dialog button:has-text("Download")', { timeout: 30000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog button:has-text("Download")')]);
  await dl.saveAs(`${OUT}/${file}`);
  await page.click('dialog .dlg-head button[aria-label="Close"]');
}

/* 1. Set up My info, with private details behind a passcode. */
console.log('1. Set up My info');
await home();
check(await page.isVisible('text=Add your name, address'), 'home explains My info');
await page.click('.home-sec:has(h2:text("My info")) button:has-text("Edit")');
for (const k of ['firstName', 'middleName', 'lastName', 'email', 'phone', 'street', 'unit', 'city', 'state', 'zip']) await page.fill(`#pf-${k}`, ME[k]);
await page.click('dialog button:has-text("Add private details")');
await page.fill('#pf-dob', ME.dob);
await page.fill('#pf-ssn', ME.ssn);
await page.fill('#pf-vaFile', ME.vaFile);
await page.fill('#pf-pass1', 'short');
await page.fill('#pf-pass2', 'short');
await page.click('dialog button:has-text("Save")');
check(await page.isVisible('#toast:has-text("at least 8")'), 'short passcode refused');
await page.fill('#pf-pass1', PASS);
await page.fill('#pf-pass2', PASS);
await page.click('dialog button:has-text("Save")');
await page.waitForSelector('dialog', { state: 'detached' });
check(await page.isVisible('.me-row:has-text("Alex Rivera")'), 'home shows saved My info');
check(await page.isVisible('.me-row:has-text("private details locked")'), 'home says private details are locked');
// Stored data: private details must not be readable.
const stored = await page.evaluate(async () => JSON.stringify(await window.__signet.store.get('profile'), (k, v) => (v instanceof Uint8Array ? Array.from(v) : v)));
check(!stored.includes(ME.ssn) && !stored.includes('1990') && !stored.includes(ME.vaFile), 'SSN, birth date and VA file number are not stored in readable form');
check(stored.includes('Rivera'), 'everyday details are stored');

/* 2. Fillable application: autofill on open. Private details locked after a restart. */
console.log('2. Fillable form');
await home(); // a fresh start locks private details
await open('tests/fixtures-out/application.pdf');
await page.waitForSelector('.smart-bar:has-text("Filled")', { timeout: 10000 });
await page.screenshot({ path: `${OUT}/smart-application.png` });
check(await val('Applicant.FirstName') === 'Alex', 'first name filled');
check(await val('Applicant.LastName') === 'Rivera', 'last name filled');
check(await val('Applicant.Address') === '123 Main St', 'street filled');
check(await val('Applicant.City') === 'Springfield', 'city filled');
check(await val('Applicant.State') === 'IL', 'state filled');
check(await val('Applicant.Zip') === '62701', 'ZIP filled');
check(await val('Applicant.Phone') === '(217) 555-0142', 'phone filled and formatted');
check(await val('Applicant.Email') === 'alex@example.com', 'email filled');
check(await val('EmergencyContact.Name') === '' && await val('EmergencyContact.Phone') === '', 'emergency contact left empty');
check(await val('SpouseName') === '', 'spouse left empty');
check(await val('Applicant.SSN') === '' && await val('Applicant.DOB') === '', 'private details wait for the passcode');
check(await page.locator('.annotationLayer section.sf-auto').count() >= 8, 'auto-filled boxes are highlighted');

await page.click('.smart-bar button:has-text("private")');
await page.fill('#pw-in', 'wrong passcode');
await page.click('dialog button:has-text("Continue")');
await page.waitForSelector('dialog p:has-text("did not work")');
ok('wrong passcode refused');
await page.fill('#pw-in', PASS);
await page.click('dialog button:has-text("Continue")');
await page.waitForFunction(() => document.querySelector('.annotationLayer [name="Applicant.SSN"]')?.value);
check(await val('Applicant.SSN') === '123-45-6789', 'SSN filled after unlocking');
check(await val('Applicant.DOB') === '07/04/1990', 'birth date filled after unlocking');

// Sign here: create a typed signature, fitted into the signature box; date filled.
check(await page.locator('.tgt-sign').count() === 1, 'one sign-here box shown');
await page.click('.tgt-sign .sign-tag');
await page.click('dialog button:has-text("Type")');
await page.fill('dialog input[aria-label="Name to type"]', 'Alex Rivera');
await page.click('dialog button:has-text("Use this signature")');
await page.waitForSelector('.item-signature');
const fit = await page.evaluate(() => {
  const s = window.__signet.state.smart; const it = window.__signet.state.items.items.find((i) => i.kind === 'signature');
  const t = s.byId.get(it.target); const r = t.rect;
  return { inside: it.x >= r.x - 0.5 && it.y >= r.y - 0.5 && it.x + it.w <= r.x + r.w + 0.5 && it.y + it.h <= r.y + r.h + 0.5, fills: it.h / r.h };
});
check(fit.inside && fit.fills > 0.6, `signature fits inside the box (${Math.round(fit.fills * 100)}% of its height)`);
check(await val('DateSigned') === TODAY, 'date signed filled with today');
check(await page.locator('.tgt-sign').count() === 0, 'sign-here tag goes away once signed');
await page.screenshot({ path: `${OUT}/smart-application-signed.png` });

// Undo the signature: the tag comes back.
await page.click('button[aria-label="Undo"]');
await page.waitForTimeout(200);
check(await page.locator('.tgt-sign').count() === 1, 'undo brings the sign-here box back');
await page.click('.tgt-sign .sign-tag');
await page.click('dialog .choose-opt');
await page.waitForSelector('.item-signature');
ok('saved signature reused with one tap');

await finishDownload('smart-application.pdf');

/* 3. Flat agreement: blanks found, autofill, sign on the line, date next to it. */
console.log('3. Flat agreement');
await page.click('button[aria-label="Close document"]');
await open('tests/fixtures-out/agreement.pdf');
await page.waitForSelector('.smart-bar:has-text("Filled")', { timeout: 10000 });
const texts = await page.evaluate(() => window.__signet.state.items.items.filter((i) => i.auto).map((i) => i.text));
check(texts.includes('Alex Quinn Rivera') && texts.includes('(217) 555-0142') && texts.includes('alex@example.com'), 'name, phone and email written on their blanks: ' + JSON.stringify(texts));
check(!texts.some((t) => /555/.test(t) && texts.filter((x) => x === t).length > 1), 'emergency contact phone left empty');
check(await page.locator('.tgt-sign').count() === 1, "one sign-here line (the landlord's is left alone)");
await page.click('.tgt-sign .sign-tag');
await page.click('dialog .choose-opt');
await page.waitForSelector('.item-signature');
const dateItem = await page.evaluate(() => window.__signet.state.items.items.find((i) => i.kind === 'date')?.text);
check(dateItem === TODAY, 'date blank next to the signature filled with today');
await page.screenshot({ path: `${OUT}/smart-agreement.png` });

// Undo what My info filled, then use Next box and type into a blank.
await page.click('.smart-bar button:has-text("Undo fill")');
check((await page.evaluate(() => window.__signet.state.items.items.filter((i) => i.auto).length)) === 0, 'undo removes what My info filled');
await page.click('.smart-bar button:has-text("Next box")');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
await page.keyboard.type('Typed by hand');
await page.mouse.click(5, 400);
const typed = await page.evaluate(() => window.__signet.state.items.items.find((i) => i.text === 'Typed by hand'));
check(!!typed && typed.target, 'next box, then typing, writes on the blank');
await finishDownload('smart-agreement.pdf');

/* 4. Extra real forms (optional, kept private): count what gets filled. */
for (const f of EXTRA) {
  console.log('4. Extra form', f.split('/').pop());
  await page.click('button[aria-label="Close document"]').catch(() => {});
  await home();
  await open(f);
  await page.waitForSelector('.smart-bar:has-text("Filled"), .smart-bar:has-text("Fill my info")', { timeout: 30000 });
  const n = await page.evaluate(() => window.__signet.state.smart.autoFilled.length);
  const signs = await page.evaluate(() => window.__signet.state.smart.signTargets().length);
  console.log(`   filled ${n} boxes; ${signs} sign-here box(es)`);
  if (signs) {
    const t = await page.evaluate(() => { const s = window.__signet.state.smart; return s.signTargets()[0].id; });
    await page.evaluate((id) => window.__signet.state.smart.goTo(window.__signet.state.smart.byId.get(id)), t);
    await page.waitForTimeout(600);
    await page.click(`.tgt[data-target="${t}"] .sign-tag`);
    await page.click('dialog .choose-opt');
    await page.waitForTimeout(400);
    const dates = await page.evaluate(() => { const s = window.__signet.state.smart; return s.targets.filter((x) => x.info.role === 'dateSigned' && !x.other && s.isFilled(x)).length; });
    console.log(`   signed; ${dates} date box(es) filled`);
    await page.screenshot({ path: `${OUT}/smart-extra-${EXTRA.indexOf(f)}.png` });
  }
  await finishDownload(`smart-extra-${EXTRA.indexOf(f)}.pdf`);
}

await browser.close();
console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nAll smart-filling checks passed.');
process.exit(problems.length ? 1 : 0);
