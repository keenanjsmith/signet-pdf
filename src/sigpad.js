// Create a signature or initials: draw it, type it, or upload a photo of it.
import { h, icon, openDialog, toast } from './ui.js';

export const INKS = [
  { id: 'blue', label: 'Blue ink', color: '#1b3a9e' },
  { id: 'black', label: 'Black ink', color: '#16181d' },
];

const SCRIPT_FONTS = [
  { family: 'Homemade Apple', size: 0.42 },
  { family: 'Mrs Saint Delafield', size: 0.62 },
  { family: 'Dancing Script', size: 0.52 },
  { family: 'Caveat', size: 0.58 },
];

/** Trim transparent edges; returns { dataUrl, w, h } or null if empty. */
export function trimCanvas(canvas, pad = 6) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1, hh = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w; out.height = hh;
  out.getContext('2d').drawImage(canvas, minX, minY, w, hh, 0, 0, w, hh);
  return { dataUrl: out.toDataURL('image/png'), w, h: hh };
}

function drawPad(inkRef, kind) {
  const wrap = h('div', { class: 'pad-wrap' });
  const canvas = h('canvas', { class: 'pad', 'aria-label': kind === 'initials' ? 'Draw your initials here' : 'Draw your signature here' });
  const guide = h('div', { class: 'pad-guide', 'aria-hidden': 'true' }, h('span', { class: 'pad-x' }, '×'), h('span', { class: 'pad-line' }));
  const hint = h('p', { class: 'pad-hint' }, kind === 'initials' ? 'Draw your initials' : 'Sign with your finger, stylus, or mouse');
  wrap.append(guide, hint, canvas);

  let ctx, scale = 1, strokes = [], current = null;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    scale = Math.min(4, (window.devicePixelRatio || 1) * 2);
    canvas.width = Math.round(r.width * scale);
    canvas.height = Math.round(r.height * scale);
    ctx = canvas.getContext('2d');
    redraw();
  };
  const seg = (a, b, c) => {
    // quadratic smoothing through midpoints
    ctx.beginPath();
    ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
    ctx.lineWidth = b.w;
    ctx.stroke();
  };
  const drawStroke = (s) => {
    ctx.strokeStyle = inkRef.color;
    ctx.fillStyle = inkRef.color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const p = s.pts;
    if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0].x, p[0].y, p[0].w / 2, 0, Math.PI * 2); ctx.fill(); return; }
    for (let i = 1; i < p.length - 1; i++) seg(p[i - 1], p[i], p[i + 1]);
    // ends
    ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2); ctx.lineWidth = p[0].w; ctx.stroke();
    const n = p.length;
    ctx.beginPath(); ctx.moveTo((p[n - 2].x + p[n - 1].x) / 2, (p[n - 2].y + p[n - 1].y) / 2); ctx.lineTo(p[n - 1].x, p[n - 1].y); ctx.lineWidth = p[n - 1].w; ctx.stroke();
  };
  const redraw = () => {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(s);
    wrap.classList.toggle('has-ink', strokes.length > 0);
  };
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale, t: performance.now() };
  };
  const base = () => 2.6 * scale;
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pt(e);
    p.w = base();
    current = { pts: [p] };
    strokes.push(current);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const p = pt(ev);
      const last = current.pts[current.pts.length - 1];
      const dist = Math.hypot(p.x - last.x, p.y - last.y);
      if (dist < 0.8 * scale) continue;
      const v = dist / Math.max(1, p.t - last.t); // px per ms
      const pressure = ev.pointerType === 'pen' && ev.pressure > 0 ? 0.6 + ev.pressure : 1;
      const target = Math.max(0.9 * scale, Math.min(base() * 1.25, base() * (1.35 - v * 0.12 / scale))) * pressure;
      p.w = last.w * 0.6 + target * 0.4;
      current.pts.push(p);
    }
    redraw();
  });
  const end = () => { current = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  return {
    node: wrap,
    clear() { strokes = []; redraw(); },
    undo() { strokes.pop(); redraw(); },
    recolor() { redraw(); },
    isEmpty: () => strokes.length === 0,
    export() { return trimCanvas(canvas, 8 * scale / 2); },
    destroy() { ro.disconnect(); },
  };
}

async function renderTyped(text, font, color) {
  await document.fonts.load(`80px "${font.family}"`, text);
  const size = 160;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  // Some handwriting fonts have a hair-thin space, so lay words out with a real gap.
  const words = text.split(/\s+/).filter(Boolean);
  const gap = size * 0.45;
  ctx.font = `${size}px "${font.family}"`;
  const widths = words.map((wd) => ctx.measureText(wd).width);
  const w = Math.ceil(widths.reduce((a, b) => a + b, 0) + gap * (words.length - 1) + size);
  c.width = Math.max(10, w); c.height = Math.round(size * 2);
  ctx.font = `${size}px "${font.family}"`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  let x = size / 2;
  words.forEach((wd, i) => { ctx.fillText(wd, x, size * 1.3); x += widths[i] + gap; });
  return trimCanvas(c, 10);
}

/** Turn a photo of ink on paper into a clean transparent signature. */
async function cleanPhoto(file, color) {
  const bmp = await createImageBitmap(file);
  const maxSide = 1600;
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  // Estimate paper brightness from the brightest 10% of pixels.
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  let acc = 0, paper = 255; const target = (d.length / 4) * 0.1;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= target) { paper = v; break; } }
  const hi = paper - 18, lo = Math.max(0, paper - 140);
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    let a = lum >= hi ? 0 : lum <= lo ? 255 : Math.round(((hi - lum) / (hi - lo)) * 255);
    if (d[i + 3] < 255) a = Math.min(a, d[i + 3]);
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return trimCanvas(c, 6);
}

/**
 * Show the signature creator.
 * @param {'signature'|'initials'} kind
 * @returns {Promise<{dataUrl,w,h,remember}|undefined>}
 */
export function createSignature(kind = 'signature', defaultName = '') {
  const title = kind === 'initials' ? 'Add your initials' : 'Add your signature';
  return openDialog({
    title,
    wide: true,
    className: 'sig-dlg',
    build: (close) => {
      const ink = { ...INKS[0] };
      let mode = 'draw';
      let typedFont = SCRIPT_FONTS[0];
      let uploaded = null;
      let uploadFile = null;

      const pad = drawPad(ink, kind);
      const nameInput = h('input', { class: 'input', type: 'text', value: defaultName, placeholder: kind === 'initials' ? 'Your initials' : 'Your full name', autocomplete: 'name', 'aria-label': 'Name to type' });
      const fontList = h('div', { class: 'font-list', role: 'radiogroup', 'aria-label': 'Style' });
      const renderFonts = () => {
        fontList.replaceChildren(...SCRIPT_FONTS.map((f) => {
          const b = h('button', {
            type: 'button', role: 'radio', class: 'font-opt' + (f === typedFont ? ' on' : ''), 'aria-checked': String(f === typedFont),
            style: { fontFamily: `"${f.family}", cursive`, color: ink.color },
            onclick: () => { typedFont = f; renderFonts(); },
          }, nameInput.value.trim() || (kind === 'initials' ? 'KS' : 'Your name'));
          return b;
        }));
      };
      nameInput.addEventListener('input', renderFonts);
      renderFonts();

      const preview = h('div', { class: 'upload-preview' }, h('p', { class: 'muted' }, 'Sign a plain white sheet of paper, take a photo, and choose it here. The paper background is removed automatically.'));
      const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'sig-file' });
      fileIn.addEventListener('change', async () => {
        uploadFile = fileIn.files?.[0];
        if (!uploadFile) return;
        try {
          uploaded = await cleanPhoto(uploadFile, ink.color);
          if (!uploaded) throw new Error('No ink found');
          preview.replaceChildren(h('img', { src: uploaded.dataUrl, alt: 'Cleaned signature' }));
        } catch {
          uploaded = null;
          preview.replaceChildren(h('p', { class: 'error-text' }, 'No ink found in that photo. Try a darker pen on plain white paper.'));
        }
      });

      const panels = {
        draw: h('div', { class: 'panel' }, pad.node,
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => pad.undo() }, icon('undo'), 'Undo stroke'),
            h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => pad.clear() }, icon('trash'), 'Clear'))),
        type: h('div', { class: 'panel' }, h('label', { class: 'field' }, h('span', {}, kind === 'initials' ? 'Initials' : 'Full name'), nameInput), fontList),
        upload: h('div', { class: 'panel' }, preview,
          h('label', { for: 'sig-file', class: 'btn' }, icon('upload'), 'Choose a photo'), fileIn),
      };
      const tabs = h('div', { class: 'tabs', role: 'tablist' });
      const body = h('div', { class: 'tab-body' });
      const setMode = (m) => {
        mode = m;
        tabs.querySelectorAll('button').forEach((b) => { const on = b.dataset.m === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
        body.replaceChildren(panels[m]);
        if (m === 'type') setTimeout(() => nameInput.focus(), 30);
      };
      for (const [m, label] of [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Photo']]) {
        tabs.append(h('button', { type: 'button', role: 'tab', 'data-m': m, onclick: () => setMode(m) }, label));
      }
      const inkSel = h('div', { class: 'ink-sel', role: 'radiogroup', 'aria-label': 'Ink color' },
        ...INKS.map((i) => h('button', {
          type: 'button', role: 'radio', class: 'ink-dot' + (i.id === ink.id ? ' on' : ''), title: i.label, 'aria-label': i.label,
          'aria-checked': String(i.id === ink.id), style: { '--ink': i.color },
          onclick: async (e) => {
            Object.assign(ink, i);
            inkSel.querySelectorAll('.ink-dot').forEach((d) => { const on = d === e.currentTarget; d.classList.toggle('on', on); d.setAttribute('aria-checked', String(on)); });
            pad.recolor(); renderFonts();
            if (uploadFile) { uploaded = await cleanPhoto(uploadFile, ink.color); if (uploaded) preview.replaceChildren(h('img', { src: uploaded.dataUrl, alt: 'Cleaned signature' })); }
          },
        })));
      const remember = h('input', { type: 'checkbox', checked: true, id: 'sig-remember' });
      setMode('draw');

      const save = async () => {
        let result = null;
        if (mode === 'draw') { if (pad.isEmpty()) return toast('Draw your ' + (kind === 'initials' ? 'initials' : 'signature') + ' first.'); result = pad.export(); }
        if (mode === 'type') { const t = nameInput.value.trim(); if (!t) return toast('Type your ' + (kind === 'initials' ? 'initials' : 'name') + ' first.'); result = await renderTyped(t, typedFont, ink.color); }
        if (mode === 'upload') { if (!uploaded) return toast('Choose a photo first.'); result = uploaded; }
        if (!result) return toast('Nothing to save yet.');
        pad.destroy();
        close({ ...result, remember: remember.checked });
      };

      return h('div', { class: 'sig-creator' },
        tabs, body,
        h('div', { class: 'row space' },
          inkSel,
          h('label', { class: 'check' }, remember, h('span', {}, 'Save on this device'))),
        h('div', { class: 'row-end' },
          h('button', { type: 'button', class: 'btn', onclick: () => { pad.destroy(); close(undefined); } }, 'Cancel'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, kind === 'initials' ? 'Use these initials' : 'Use this signature')));
    },
  });
}

/** Small images for check and cross marks, drawn crisply as PNG. */
export function markImage(kind, color = '#16181d') {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = color; ctx.lineWidth = s * 0.12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'check') { ctx.moveTo(s * 0.16, s * 0.54); ctx.lineTo(s * 0.4, s * 0.78); ctx.lineTo(s * 0.86, s * 0.22); }
  else if (kind === 'dot') { ctx.fillStyle = color; ctx.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2); ctx.fill(); return c.toDataURL('image/png'); }
  else { ctx.moveTo(s * 0.2, s * 0.2); ctx.lineTo(s * 0.8, s * 0.8); ctx.moveTo(s * 0.8, s * 0.2); ctx.lineTo(s * 0.2, s * 0.8); }
  ctx.stroke();
  return c.toDataURL('image/png');
}
