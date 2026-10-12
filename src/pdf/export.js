// Build the finished PDF: form entries, signatures and text written permanently into the pages.
import { StandardFonts, rgb, degrees } from '@cantoo/pdf-lib';
import { loadForEdit } from './load.js';

// Where the text baseline sits inside a placed text box, as a fraction of font size.
// Matches the on-screen layout (line-height 1.25, Helvetica/Arial metrics).
export const BASELINE = 0.0665 + 0.905;
export const TEXT_PAD = 2;

function hexToRgb(hex = '#16181d') {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function dataUrlBytes(url) {
  const comma = url.indexOf(',');
  const b64 = url.slice(comma + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Keep only characters the built-in PDF font can show; swap common lookalikes. */
export function safeText(font, text) {
  const map = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', ' ': ' ' };
  let out = '';
  for (const ch of String(text)) {
    try { font.encodeText(ch); out += ch; }
    catch { const alt = map[ch]; out += alt != null ? alt : '?'; }
  }
  return out;
}

function hasValue(field) {
  try {
    if (field.getText) return !!field.getText();
    if (field.isChecked) return field.isChecked();
    if (field.getSelected) { const s = field.getSelected(); return Array.isArray(s) ? s.length > 0 : !!s; }
  } catch {}
  return false;
}

/** Convert a point in on-screen page units to PDF user space. */
function toPdf(info, x, y) {
  const [px, py] = info.viewport.convertToPdfPoint(x, y);
  return { x: px, y: py };
}

/**
 * @param {object} o
 * @param {Uint8Array} o.bytes   source PDF (with any typed form entries already saved in)
 * @param {string}     o.password
 * @param {Array}      o.items
 * @param {Array}      o.pageInfo  from the viewer
 * @param {boolean}    o.flattenForm  lock form fields so they can't be changed
 * @returns {Promise<{bytes: Uint8Array, warnings: string[]}>}
 */
export async function buildPdf({ bytes, password, items, pageInfo, flattenForm }) {
  const warnings = [];
  const doc = await loadForEdit(bytes, password);

  if (flattenForm) {
    try {
      const form = doc.getForm();
      const fields = form.getFields();
      if (fields.length) {
        // A filled-in field with no drawn look of its own would vanish when locked,
        // so draw it first. Fields that already look right are left untouched.
        const helv = await doc.embedFont(StandardFonts.Helvetica);
        for (const f of fields) {
          const missing = f.acroField.getWidgets().some((w) => !w.getAppearances()?.normal);
          if (!missing || !hasValue(f)) continue;
          try { f.defaultUpdateAppearances?.(helv); } catch {}
        }
        // pdf-lib logs (harmless) complaints about empty fields with no look; keep the console clean.
        const err = console.error;
        console.error = () => {};
        try { form.flatten({ updateFieldAppearances: false }); }
        catch { form.flatten({ updateFieldAppearances: true }); }
        finally { console.error = err; }
      }
    } catch (e) {
      warnings.push('Some form fields could not be locked, so they stay editable.');
      console.warn(e);
    }
  }

  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const imgCache = new Map();

  for (const it of items) {
    const page = pages[it.page - 1];
    const info = pageInfo[it.page - 1];
    if (!page || !info) continue;
    const rot = degrees(info.rotate || 0);

    if (it.src) {
      let img = imgCache.get(it.src);
      if (!img) { img = await doc.embedPng(await dataUrlBytes(it.src)); imgCache.set(it.src, img); }
      const o = toPdf(info, it.x, it.y + it.h); // on-screen bottom-left corner
      page.drawImage(img, { x: o.x, y: o.y, width: it.w, height: it.h, rotate: rot });
    } else if (it.kind === 'text' || it.kind === 'date') {
      const text = safeText(font, it.text || '');
      if (!text.trim()) continue;
      const o = toPdf(info, it.x + TEXT_PAD, it.y + it.size * BASELINE);
      page.drawText(text, { x: o.x, y: o.y, size: it.size, font, color: hexToRgb(it.color), rotate: rot });
    }
  }

  const out = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  return { bytes: new Uint8Array(out), warnings };
}
