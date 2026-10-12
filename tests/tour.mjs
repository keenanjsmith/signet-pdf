// Screenshots of each screen, light and dark, phone and desktop (for design review).
import { chromium } from 'playwright';
const OUT = process.argv[2]; const BASE = process.argv[3] || 'http://localhost:4173/';
const b = await chromium.launch();
for (const scheme of ['light', 'dark']) for (const mobile of [true, false]) {
  const tag = `${scheme}-${mobile ? 'phone' : 'desk'}`;
  const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 }, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(BASE + '?test'); await p.waitForSelector('.drop'); await p.waitForTimeout(1800);
  await p.screenshot({ path: `${OUT}/tour-${tag}-1home.png` });
  await p.setInputFiles('#open-file', 'tests/fixtures-out/form.pdf');
  await p.waitForSelector('.pdfViewer .page canvas'); await p.waitForTimeout(500);
  await p.click('.tool:has-text("Signature")'); await p.waitForSelector('canvas.pad'); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/tour-${tag}-2draw.png` });
  await p.click('dialog button:has-text("Type")'); await p.fill('dialog input[aria-label="Name to type"]', 'Keenan Smith'); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/tour-${tag}-3type.png` });
  await p.click('dialog button:has-text("Use this signature")');
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${OUT}/tour-${tag}-4placed.png` });
  await p.click('#finish-btn'); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/tour-${tag}-5finish.png` });
  await p.click('dialog button:has-text("Create signed PDF")'); await p.waitForSelector('dialog button:has-text("Download")'); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/tour-${tag}-6done.png` });
  await ctx.close();
}
await b.close(); console.log('tour done');
