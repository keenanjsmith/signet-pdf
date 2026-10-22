// Build the finished PDF: form entries, signatures and text written permanently into the pages.
import { StandardFonts, rgb, degrees, PDFName, PDFString, PDFHexString, PDFArray, PDFDict } from '@cantoo/pdf-lib';
import { loadForEdit } from './load.js';
import { voiceNoteName } from './names.js';

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

  // Voice notes: each becomes a file attached to the page at its speaker icon
  // (Acrobat plays it from there) and is listed in the PDF's attachments.
  let n = 0;
  for (const it of items) {
    if (it.kind !== 'audio' || !it.audio?.bytes) continue;
    const page = pages[it.page - 1], info = pageInfo[it.page - 1];
    if (!page || !info) continue;
    n++;
    attachVoiceNote(doc, page, info, it, voiceNoteName(it, n));
  }

  const out = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  return { bytes: new Uint8Array(out), warnings };
}


function attachVoiceNote(doc, page, info, it, name) {
  const ctx = doc.context;
  const now = new Date();
  const secs = Math.round(it.audio.duration || 0);
  const desc = `Voice note, ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} long. Recorded in Signet PDF.`;
  const file = ctx.stream(it.audio.bytes, {
    Type: 'EmbeddedFile',
    Subtype: PDFName.of(it.audio.mime || 'audio/mp4'),
    Params: { Size: it.audio.bytes.length, CreationDate: PDFString.fromDate(now), ModDate: PDFString.fromDate(now) },
  });
  const fileRef = ctx.register(file);
  const spec = ctx.obj({
    Type: 'Filespec',
    F: PDFString.of(name),
    UF: PDFHexString.fromText(name),
    EF: { F: fileRef, UF: fileRef },
    Desc: PDFHexString.fromText(desc),
    AFRelationship: 'Supplement',
  });
  const specRef = ctx.register(spec);

  // Where the speaker icon is, in PDF coordinates.
  const [ax, ay] = info.viewport.convertToPdfPoint(it.x, it.y);
  const [bx, by] = info.viewport.convertToPdfPoint(it.x + it.w, it.y + it.h);
  const rect = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  // An empty look: the speaker icon is already drawn on the page, so viewers
  // that know about attachments don't cover it with their own pin.
  const ap = ctx.register(ctx.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, rect[2] - rect[0], rect[3] - rect[1]] }));
  const annot = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'FileAttachment', Rect: rect, FS: specRef,
    Contents: PDFHexString.fromText(desc), T: PDFHexString.fromText('Signet PDF'),
    Name: 'PushPin', F: 4, M: PDFString.fromDate(now), AP: { N: ap },
  }));
  page.node.addAnnot(annot);

  // List it in the document's attachments (Chrome, Edge and others show this list).
  const catalog = doc.catalog;
  let names = catalog.lookup(PDFName.of('Names'));
  if (!(names instanceof PDFDict)) { names = ctx.obj({}); catalog.set(PDFName.of('Names'), names); }
  let tree = names.lookup(PDFName.of('EmbeddedFiles'));
  if (!(tree instanceof PDFDict)) { tree = ctx.obj({ Names: [] }); names.set(PDFName.of('EmbeddedFiles'), tree); }
  const arr = tree.lookup(PDFName.of('Names'));
  if (!(arr instanceof PDFArray)) return; // an existing, complex list: the page attachment still works
  // Keep the list sorted by name, as the PDF rules require.
  const entries = [];
  for (let i = 0; i + 1 < arr.size(); i += 2) entries.push([arr.get(i), arr.get(i + 1)]);
  entries.push([PDFHexString.fromText(name), specRef]);
  const key = (k) => (k.decodeText ? k.decodeText() : String(k));
  entries.sort((a, b) => (key(a[0]) < key(b[0]) ? -1 : 1));
  while (arr.size()) arr.remove(0);
  for (const [k, v] of entries) { arr.push(k); arr.push(v); }
}
