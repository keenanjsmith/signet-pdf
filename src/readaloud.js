// Read aloud: speaks the PDF's text using a voice built into this device.
// Voices that send text to an online service are never used, so what you
// listen to stays on your device.
import { h, icon, toast } from './ui.js';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

/** On-device voices only, best match for your language first. */
export async function localVoices() {
  const synth = globalThis.speechSynthesis;
  if (!synth) return [];
  let voices = synth.getVoices();
  if (!voices.length) {
    await new Promise((r) => {
      const done = () => { synth.removeEventListener?.('voiceschanged', done); r(); };
      synth.addEventListener?.('voiceschanged', done);
      setTimeout(done, 1500);
    });
    voices = synth.getVoices();
  }
  const lang = (navigator.language || 'en-US').toLowerCase();
  const base = lang.split('-')[0];
  const score = (v) => (v.lang?.toLowerCase() === lang ? 3 : v.lang?.toLowerCase().startsWith(base) ? 2 : 0) + (v.default ? 1 : 0);
  return voices.filter((v) => v.localService === true).sort((a, b) => score(b) - score(a));
}

/** Break a page's text into short passages, each with its place on the page. */
async function pagePassages(page, viewport, pdfjs) {
  const tc = await page.getTextContent();
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur) {
      const text = cur.text.replace(/_{3,}/g, ' blank ').replace(/\.{4,}/g, ' ').replace(/\s+/g, ' ').trim();
      if (/[a-z0-9]/i.test(text)) out.push({ text, rect: { x: cur.x1, y: cur.y1, w: cur.x2 - cur.x1, h: cur.y2 - cur.y1 } });
    }
    cur = null;
  };
  let lastBase = null;
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue;
    const m = pdfjs.Util.transform(viewport.transform, it.transform);
    const fh = Math.hypot(m[2], m[3]) || 8;
    const x = m[4], base = m[5], w = (it.width || 0) * viewport.scale;
    // A big jump in position starts a new passage (new column or section).
    if (cur && lastBase != null && (Math.abs(base - lastBase) > fh * 2.2 || x < cur.x1 - 200)) flush();
    if (!it.str.trim()) { if (cur && it.hasEOL) cur.text += ' '; continue; }
    if (!cur) cur = { text: '', x1: x, y1: base - fh, x2: x + w, y2: base + fh * 0.25 };
    cur.text += (cur.text && !/\s$/.test(cur.text) && !/^[\s,.;:!?)]/.test(it.str) ? ' ' : '') + it.str;
    cur.x1 = Math.min(cur.x1, x); cur.x2 = Math.max(cur.x2, x + w);
    cur.y1 = Math.min(cur.y1, base - fh); cur.y2 = Math.max(cur.y2, base + fh * 0.25);
    lastBase = base;
    if (it.hasEOL) cur.text += ' ';
    // End a passage at the end of a sentence, or when it gets long.
    const t = cur.text.trim();
    if ((/[.!?:]["')\]]?$/.test(t) && t.length > 40) || t.length > 260) flush();
  }
  flush();
  return out;
}

export class ReadAloud {
  constructor({ viewer, pdfjs, host }) {
    Object.assign(this, { viewer, pdfjs, host });
    this.passages = null; // [{ page, text, rect }]
    this.index = 0;
    this.playing = false;
    this.rate = 1;
    this.voice = null;
    this.token = 0;
    this.hl = null;
  }

  async load() {
    if (this.passages) return this.passages;
    const all = [];
    for (let n = 1; n <= this.viewer.numPages; n++) {
      const page = await this.viewer.doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      for (const p of await pagePassages(page, vp, this.pdfjs)) all.push({ page: n, ...p });
    }
    this.passages = all;
    return all;
  }

  /** Open the player and start reading from the page you're looking at. */
  async open() {
    if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) {
      toast('This browser can’t read aloud. Try Chrome, Edge or Safari.', 'error');
      return;
    }
    const voices = await localVoices();
    this.voices = voices;
    this.render();
    if (!voices.length) return; // the player explains what to do
    this.voice = voices[0];
    await this.load();
    if (!this.passages.length) { this.setStatus('This PDF has no text to read. It may be a scan (a picture of a page).'); return; }
    const page = this.viewer.pageNearestCenter();
    const first = this.passages.findIndex((p) => p.page >= page);
    this.index = first >= 0 ? first : 0;
    this.play();
  }

  close() {
    this.stop();
    this.bar?.remove();
    this.bar = null;
    this.clearHighlight();
  }

  play() {
    if (!this.passages?.length) return;
    this.playing = true;
    this.speak();
    this.render();
  }

  pause() {
    this.playing = false;
    this.token++;
    speechSynthesis.cancel(); // resume starts this passage again; works the same in every browser
    this.render();
  }

  stop() { this.playing = false; this.token++; try { speechSynthesis.cancel(); } catch {} }

  skip(delta) {
    if (!this.passages?.length) return;
    this.index = Math.max(0, Math.min(this.passages.length - 1, this.index + delta));
    this.token++;
    speechSynthesis.cancel();
    if (this.playing) this.speak(); else this.showCurrent();
    this.render();
  }

  speak() {
    const p = this.passages[this.index];
    if (!p) { this.playing = false; this.render(); this.setStatus('Finished reading.'); this.clearHighlight(); return; }
    const my = ++this.token;
    const u = new SpeechSynthesisUtterance(p.text);
    u.voice = this.voice;
    u.lang = this.voice?.lang || navigator.language;
    u.rate = this.rate;
    u.onend = () => {
      if (my !== this.token || !this.playing) return;
      this.index++;
      this.speak();
    };
    u.onerror = (e) => {
      if (my !== this.token || e.error === 'interrupted' || e.error === 'canceled') return;
      this.playing = false; this.render();
      this.setStatus('Reading stopped: ' + (e.error || 'the voice had a problem') + '.');
    };
    this.showCurrent();
    speechSynthesis.speak(u);
  }

  /** Highlight the passage being read and keep it on screen. */
  showCurrent() {
    const p = this.passages[this.index];
    if (!p) return;
    this.clearHighlight();
    const ov = this.viewer.overlay(p.page);
    const info = this.viewer.pageInfo[p.page - 1];
    const pad = 2;
    this.hl = h('div', { class: 'ra-hl', 'aria-hidden': 'true', style: {
      left: ((p.rect.x - pad) / info.width) * 100 + '%', top: ((p.rect.y - pad) / info.height) * 100 + '%',
      width: ((p.rect.w + pad * 2) / info.width) * 100 + '%', height: ((p.rect.h + pad * 2) / info.height) * 100 + '%',
    } });
    ov.prepend(this.hl);
    this.viewer.attach(p.page);
    // Scroll only when the passage is off screen.
    const r = this.hl.getBoundingClientRect(), c = this.viewer.container.getBoundingClientRect();
    if (!r.height || r.top < c.top + 20 || r.bottom > c.bottom - 20) {
      const [px, py] = info.viewport.convertToPdfPoint(0, Math.max(0, p.rect.y - 60));
      this.viewer.viewer.scrollPageIntoView({ pageNumber: p.page, destArray: [null, { name: 'XYZ' }, px, py, null], allowNegativeOffset: true });
    }
    this.setStatus(`Page ${p.page} of ${this.viewer.numPages}`);
  }

  clearHighlight() { this.hl?.remove(); this.hl = null; }

  setStatus(text) { const s = this.bar?.querySelector('.ra-status'); if (s) s.textContent = text; }

  render() {
    if (!this.bar) {
      this.bar = h('div', { class: 'ra-bar', role: 'region', 'aria-label': 'Read aloud' });
      this.host.append(this.bar);
    }
    const btn = (name, label, fn, extra = '') => h('button', { class: 'icon-btn ra-btn ' + extra, type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(name));
    if (!this.voices?.length) {
      this.bar.replaceChildren(
        h('div', { class: 'ra-msg' }, icon('speaker'),
          h('span', {}, 'This device has no built-in voice for reading aloud privately. On Windows, add one in Settings > Time & language > Speech. On a Mac, in System Settings > Accessibility > Spoken Content.')),
        btn('close', 'Close read aloud', () => this.close()));
      return;
    }
    const speed = h('select', { class: 'input ra-speed', 'aria-label': 'Reading speed', onchange: (e) => { this.rate = Number(e.target.value); if (this.playing) { this.token++; speechSynthesis.cancel(); this.speak(); } } },
      ...SPEEDS.map((s) => h('option', { value: s, selected: s === this.rate }, s + '×')));
    const voice = this.voices.length > 1 ? h('select', { class: 'input ra-voice', 'aria-label': 'Voice', onchange: (e) => { this.voice = this.voices[Number(e.target.value)]; if (this.playing) { this.token++; speechSynthesis.cancel(); this.speak(); } } },
      ...this.voices.map((v, i) => h('option', { value: i, selected: v === this.voice }, v.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s*\(.*\)$/, '')))) : null;
    this.bar.replaceChildren(...[
      h('div', { class: 'ra-controls' },
        btn('prev', 'Back one passage', () => this.skip(-1)),
        this.playing ? btn('pause', 'Pause', () => this.pause(), 'ra-main') : btn('play', 'Read', () => this.play(), 'ra-main'),
        btn('next', 'Forward one passage', () => this.skip(1))),
      h('span', { class: 'ra-status', 'aria-live': 'polite' }, this.passages?.[this.index] ? `Page ${this.passages[this.index].page} of ${this.viewer.numPages}` : 'Getting ready…'),
      h('div', { class: 'ra-opts' }, speed, voice),
      btn('close', 'Close read aloud', () => this.close()),
    ].filter(Boolean));
  }
}
