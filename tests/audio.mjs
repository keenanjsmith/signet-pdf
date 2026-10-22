// Browser test for read aloud, voice notes and the voice-typing tip.
// Uses a fake microphone and a stand-in speech engine (headless browsers have no voices).
// Usage: node tests/audio.mjs <outdir> [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.argv[2] || 'test-results';
const BASE = process.argv[3] || 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const ok = (m) => console.log('   ok:', m);
const fail = (m) => { problems.push(m); console.log('   FAIL:', m); };
const check = (c, m) => (c ? ok(m) : fail(m));

// Stand-in speech engine. One voice is "online" (localService false): it must never be used.
const speechMock = (voices) => `(() => {
  const voices = ${JSON.stringify(voices)};
  window.__spoken = []; window.__cancels = 0;
  let current = null, timer = null;
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.rate = 1; } };
  const synth = {
    getVoices: () => voices, addEventListener() {}, removeEventListener() {},
    speak(u) { current = u; window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, rate: u.rate });
      timer = setTimeout(() => { if (current === u) { current = null; u.onend && u.onend({}); } }, 120); },
    cancel() { window.__cancels++; clearTimeout(timer); const u = current; current = null; if (u && u.onerror) u.onerror({ error: 'interrupted' }); },
    pause() {}, resume() {}, get speaking() { return !!current; },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  // Keep track of microphone streams so the test can check they get switched off.
  window.__streams = [];
  const gum = navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  if (gum) navigator.mediaDevices.getUserMedia = async (c) => { const st = await gum(c); window.__streams.push(st); return st; };
})();`;
const LOCAL = { name: 'Microsoft Aria (Natural)', lang: 'en-US', localService: true, default: true };
const ONLINE = { name: 'Google US English', lang: 'en-US', localService: false, default: false };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

async function session({ voices = [ONLINE, LOCAL], ua } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true, permissions: ['microphone'], ...(ua ? { userAgent: ua } : {}) });
  await ctx.addInitScript(speechMock(voices));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail('page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy|Refused/.test(m.text())) fail('console: ' + m.text()); });
  await page.goto(BASE + '?test');
  await page.waitForSelector('.drop');
  return { ctx, page };
}
async function open(page, file) {
  await page.setInputFiles('#open-file', file);
  await page.waitForSelector('.pdfViewer .page canvas', { timeout: 30000 });
  await page.waitForFunction(() => window.__signet.state.smart?.ready, null, { timeout: 30000 });
}

/* 1. Read aloud */
console.log('1. Read aloud');
{
  const { ctx, page } = await session();
  await open(page, 'tests/fixtures-out/agreement.pdf');
  await page.click('#read-btn');
  await page.waitForSelector('.ra-bar');
  await page.waitForFunction(() => window.__spoken.length >= 2, null, { timeout: 5000 });
  const spoken = await page.evaluate(() => window.__spoken);
  check(spoken[0].text.startsWith('Rental Agreement'), 'starts reading at the top of the page: ' + JSON.stringify(spoken[0].text.slice(0, 40)));
  check(spoken.every((s) => s.voice === LOCAL.name), 'only the on-device voice is used, never the online one');
  check(await page.locator('.ra-hl').count() === 1, 'the passage being read is highlighted');
  await page.screenshot({ path: `${OUT}/readaloud.png` });
  await page.click('.ra-bar button[aria-label="Pause"]');
  const n = await page.evaluate(() => window.__spoken.length);
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__spoken.length) === n, 'pause stops reading');
  await page.selectOption('.ra-speed', '1.5');
  await page.click('.ra-bar button[aria-label="Read"]');
  await page.waitForFunction((n) => window.__spoken.length > n, n);
  const last = await page.evaluate(() => window.__spoken[window.__spoken.length - 1]);
  check(last.rate === 1.5, 'speed setting is used');
  check(last.text === spoken[n - 1].text, 'resume picks up the passage it paused on');
  await page.click('.ra-bar button[aria-label="Forward one passage"]');
  await page.waitForTimeout(100);
  await page.waitForFunction(() => window.__spoken.length >= 1);
  // Reads to the end and says so.
  await page.waitForSelector('.ra-status:has-text("Finished")', { timeout: 10000 });
  ok('reads through to the end');
  const all = await page.evaluate(() => window.__spoken.map((s) => s.text));
  check(all.some((t) => /Tenant name: blank/.test(t)) && !all.some((t) => /___/.test(t)), 'blank lines are read as "blank", not as underscores');
  await page.click('.ra-bar button[aria-label="Close read aloud"]');
  check(await page.locator('.ra-bar').count() === 0 && await page.locator('.ra-hl').count() === 0, 'close removes the player and highlight');
  await page.click('button[aria-label="Close document"]');
  await open(page, 'tests/fixtures-out/notext.pdf');
  await page.click('#read-btn');
  await page.waitForSelector('.ra-status:has-text("no text")');
  ok('explains when a PDF has no text (like a scan)');
  await ctx.close();
}
{
  const { ctx, page } = await session({ voices: [ONLINE] });
  await open(page, 'tests/fixtures-out/agreement.pdf');
  await page.click('#read-btn');
  await page.waitForSelector('.ra-msg:has-text("no built-in voice")');
  await page.waitForTimeout(400);
  check((await page.evaluate(() => window.__spoken.length)) === 0, 'with only online voices: nothing is sent, and it explains how to add one');
  await ctx.close();
}

/* 2. Voice notes */
console.log('2. Voice notes');
{
  const { ctx, page } = await session();
  await open(page, 'tests/fixtures-out/agreement.pdf');
  await page.click('.tool:has-text("Voice")');
  await page.waitForSelector('dialog .vn-mic');
  await page.click('dialog .vn-mic');
  await page.waitForSelector('dialog .vn-mic.rec');
  let peak = 0;
  for (let i = 0; i < 22; i++) {
    peak = Math.max(peak, await page.evaluate(() => { const m = /matrix\(([\d.]+)/.exec(getComputedStyle(document.querySelector('.vn-meter i')).transform); return m ? Number(m[1]) : 0; }));
    await page.waitForTimeout(100);
  }
  check(peak > 0.05, `level meter moves while recording (peak ${peak.toFixed(2)})`);
  await page.click('dialog .vn-mic');
  await page.waitForSelector('dialog audio', { timeout: 5000 });
  check(await page.isEnabled('dialog button:has-text("Add to page")'), 'recording can be listened to and added');
  await page.click('dialog button:has-text("Add to page")');
  await page.waitForSelector('.item-audio');
  const note = await page.evaluate(() => { const it = window.__signet.state.items.items.find((i) => i.kind === 'audio'); return { mime: it.audio.mime, ext: it.audio.ext, size: it.audio.bytes.length, dur: it.audio.duration }; });
  check(note.size > 2000 && note.dur > 1.5, `recorded ${note.dur.toFixed(1)}s as ${note.mime} (${note.size} bytes)`);
  const len = await page.evaluate(() => new Promise((res) => {
    const it = window.__signet.state.items.items.find((i) => i.kind === 'audio');
    const a = new Audio(URL.createObjectURL(new Blob([it.audio.bytes], { type: it.audio.mime })));
    a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(-1); setTimeout(() => res(-2), 4000);
  }));
  check(Number.isFinite(len) && len > 1.5, `the audio file knows its own length (${Number(len).toFixed(1)}s), so players can skip through it`);
  // The microphone is switched off once recording stops.
  const mic = await page.evaluate(() => ({ n: window.__streams.length, live: window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState !== 'ended').length }));
  check(mic.n === 1 && mic.live === 0, 'microphone is switched off after recording');
  // Tap to play (also right after adding, while it's still selected).
  const box = await page.locator('.item-audio').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('.item-audio.playing', { timeout: 4000 }).then(() => ok('tapping the note plays it')).catch(() => fail('tapping the note did not play it'));
  // Drag it somewhere else; it still exists once.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 40, { steps: 8 }); await page.mouse.up();
  check(await page.locator('.item-audio').count() === 1, 'note can be dragged into place');
  await page.screenshot({ path: `${OUT}/voicenote.png` });

  // Finish: PDF with the note inside, and the note as its own file.
  await page.click('#finish-btn');
  await page.click('dialog button:has-text("Create signed PDF")');
  await page.waitForSelector('dialog button:has-text("Download voice note")', { timeout: 30000 });
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('dialog button:text-is("Download")')]);
  await pdf.saveAs(`${OUT}/voicenote.pdf`);
  const [aud] = await Promise.all([page.waitForEvent('download'), page.click('dialog button:has-text("Download voice note")')]);
  await aud.saveAs(`${OUT}/${aud.suggestedFilename()}`);
  fs.writeFileSync(`${OUT}/voicenote-name.txt`, aud.suggestedFilename());
  check(/^Voice note 1 \(page 1\)\.(m4a|webm|ogg)$/.test(aud.suggestedFilename()), 'voice note downloads as its own audio file: ' + aud.suggestedFilename());
  await page.screenshot({ path: `${OUT}/voicenote-finish.png` });
  await ctx.close();
}

/* 3. Voice typing tip */
console.log('3. Voice typing tip');
{
  const { ctx, page } = await session({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
  await open(page, 'tests/fixtures-out/form.pdf');
  await page.click('.annotationLayer input[type="text"]');
  await page.waitForSelector('#toast.show:has-text("Windows key + H")', { timeout: 4000 }).then(() => ok('Windows: tip about Windows key + H')).catch(() => fail('no voice typing tip on Windows'));
  await page.waitForTimeout(3600);
  await page.click('.tool:has-text("Text")');
  await page.waitForTimeout(1200);
  check(!(await page.isVisible('#toast.show:has-text("Windows key + H")')), 'the tip shows only once');
  await ctx.close();
}

await browser.close();
console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nAll audio checks passed.');
process.exit(problems.length ? 1 : 0);
