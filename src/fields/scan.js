// Finds everything on a PDF that can be filled in:
//  - real form boxes (text boxes, check boxes, signature boxes) with their names,
//    tooltips and the printed label next to them
//  - on flat PDFs with no real boxes, the blank lines and boxes a person would
//    write on ("Name: ________", "Signature ______")
// Works in the browser and in Node (for tests): pass in the pdf.js library.

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Turn a technical field name into words: "F[0].Page_10[0].Date_Of_Birth_Month[0]" -> "date of birth month" */
export function nameWords(fieldName) {
  const last = String(fieldName || '').split('.').filter((p) => !/^(f|form1?|topmostsubform|#?subform|page\d*|p\d+)(\[\d+\])?$/i.test(p));
  return norm(last.join(' ')
    .replace(/\[\d+\]/g, ' ')
    .replace(/\\\./g, '.')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_#.\-]+/g, ' ')).toLowerCase();
}

/** Text items on a page, in page units (top-left origin, like the screen). */
async function pageText(page, viewport, pdfjs) {
  const tc = await page.getTextContent({ disableNormalization: false });
  const out = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const m = pdfjs.Util.transform(viewport.transform, it.transform);
    const fontH = Math.hypot(m[2], m[3]) || Math.abs(it.height) || 8;
    const rotated = Math.abs(m[1]) > Math.abs(m[0]) * 0.2; // skip vertical text
    if (rotated) continue;
    const x = m[4], base = m[5];
    out.push({ str: it.str, x, y: base - fontH * 0.8, w: it.width * (viewport.scale || 1), h: fontH, base });
  }
  return out;
}

/** Printed words near a box: on the same line to the left, or just above it. */
function labelFor(rect, texts) {
  const words = texts.filter((t) => /[a-z0-9]/i.test(t.str));
  const cy = rect.y + rect.h / 2;
  // Caption printed inside the top of the box.
  const inside = words.filter((t) => { const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2; return tcx > rect.x && tcx < rect.x + rect.w && tcy > rect.y - 1 && tcy < rect.y + Math.min(rect.h, 14); });
  if (inside.length) return norm(inside.sort((a, b) => a.base - b.base || a.x - b.x).map((t) => t.str).join(' '));
  // Words on the same line, ending just left of the box (stop at a gap).
  const same = words.filter((t) => Math.abs(t.y + t.h / 2 - cy) < Math.max(6, rect.h * 0.6) && t.x + t.w <= rect.x + 4).sort((a, b) => b.x + b.w - (a.x + a.w));
  if (same.length && rect.x - (same[0].x + same[0].w) < 70) {
    const chain = [same[0]];
    for (const t of same.slice(1)) { if (t.x + t.w >= chain[chain.length - 1].x - 10) chain.push(t); else break; }
    return norm(chain.reverse().map((t) => t.str).join(' '));
  }
  // The nearest line or two of words above that line up with the box.
  const above = words.filter((t) => {
    if (t.base > rect.y + 2 || t.base < rect.y - 30) return false;
    const ov = Math.min(t.x + t.w, rect.x + rect.w) - Math.max(t.x, rect.x);
    return ov >= Math.min(t.w, rect.w) * 0.3 || (t.x >= rect.x - 6 && t.x < rect.x + rect.w);
  }).sort((a, b) => b.base - a.base);
  if (!above.length) return '';
  const lines = [];
  for (const t of above) {
    const line = lines.find((l) => Math.abs(l.base - t.base) < 2);
    if (line) line.items.push(t); else if (lines.length < 2) lines.push({ base: t.base, items: [t] });
  }
  // Use the line above too only when the nearest line is the tail of a wrapped caption.
  const first = lines[0].items.sort((a, b) => a.x - b.x)[0].str.trim();
  if (lines.length > 1 && !/^[a-z(]/.test(first)) lines.length = 1;
  return norm(lines.reverse().map((l) => l.items.sort((a, b) => a.x - b.x).map((t) => t.str).join(' ')).join(' '));
}


/**
 * Lines and boxes drawn on the page, in page units:
 *  hs/vs  - horizontal and vertical line pieces (joined when they touch)
 *  rects  - closed, square-cornered boxes
 */
async function pageShapes(page, viewport, pdfjs) {
  const { OPS, Util } = pdfjs;
  const ops = await page.getOperatorList();
  const hs = [], vs = [], rects = [];
  let ctm = viewport.transform.slice();
  const stack = [];
  const fns = ops.fnArray, args = ops.argsArray;
  const pt = (x, y) => [x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]];
  const addSeg = (a, b) => {
    if (Math.abs(a[1] - b[1]) < 0.8 && Math.abs(a[0] - b[0]) >= 4) hs.push({ x1: Math.min(a[0], b[0]), x2: Math.max(a[0], b[0]), y: (a[1] + b[1]) / 2 });
    else if (Math.abs(a[0] - b[0]) < 0.8 && Math.abs(a[1] - b[1]) >= 4) vs.push({ y1: Math.min(a[1], b[1]), y2: Math.max(a[1], b[1]), x: (a[0] + b[0]) / 2 });
  };
  // A closed outline with 4 square corners is a box; a very thin one is a line.
  const finishPoly = (poly, filled) => {
    if (poly.length < 4 || poly.length > 6) return false;
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    const square = poly.every((p) => (Math.abs(p[0] - x1) < 0.8 || Math.abs(p[0] - x2) < 0.8) && (Math.abs(p[1] - y1) < 0.8 || Math.abs(p[1] - y2) < 0.8));
    if (!square) return false;
    const w = x2 - x1, h = y2 - y1;
    if (h <= 2.5 && w >= 4) { hs.push({ x1, x2, y: (y1 + y2) / 2 }); return true; }
    if (w <= 2.5 && h >= 4) { vs.push({ y1, y2, x: (x1 + x2) / 2 }); return true; }
    rects.push({ x: x1, y: y1, w, h, filled });
    return true;
  };
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i], a = args[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (a?.[0]) ctm = Util.transform(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.constructPath) {
      const [op, data, minMax] = a;
      if (!minMax || op === OPS.endPath || op === OPS.clip || op === OPS.eoClip) continue;
      const filled = op === OPS.fill || op === OPS.eoFill;
      const path = data?.[0];
      if (!path || typeof path.length !== 'number') continue;
      let poly = [], segs = [];
      const flush = (closed) => {
        if (poly.length && (closed || (poly.length === 5 && Math.hypot(poly[0][0] - poly[4][0], poly[0][1] - poly[4][1]) < 0.8))) {
          if (finishPoly(closed ? poly : poly.slice(0, 4), filled)) { segs = []; poly = []; return; }
        }
        if (!filled) for (const [p, q] of segs) addSeg(p, q);
        segs = []; poly = [];
      };
      for (let j = 0; j < path.length;) {
        const c = path[j];
        if (c === 0) { flush(false); poly.push(pt(path[j + 1], path[j + 2])); j += 3; }
        else if (c === 1) { const p = pt(path[j + 1], path[j + 2]); if (poly.length) segs.push([poly[poly.length - 1], p]); poly.push(p); j += 3; }
        else if (c === 2) { poly.push(pt(path[j + 5], path[j + 6])); poly.push([NaN, NaN]); j += 7; }
        else if (c === 3) { poly.push(pt(path[j + 3], path[j + 4])); poly.push([NaN, NaN]); j += 5; }
        else if (c === 4) { if (poly.length > 1) segs.push([poly[poly.length - 1], poly[0]]); flush(true); j += 1; }
        else break;
      }
      flush(false);
    }
  }
  return { hs: mergeH(hs), vs: mergeV(vs), rects };
}

// Join touching pieces of the same line.
function mergeH(segs) {
  segs.sort((a, b) => a.y - b.y || a.x1 - b.x1);
  const out = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - s.y) < 1 && s.x1 <= last.x2 + 2) last.x2 = Math.max(last.x2, s.x2);
    else out.push({ ...s });
  }
  return out;
}
function mergeV(segs) {
  segs.sort((a, b) => a.x - b.x || a.y1 - b.y1);
  const out = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - s.x) < 1 && s.y1 <= last.y2 + 2) last.y2 = Math.max(last.y2, s.y2);
    else out.push({ ...s });
  }
  return out;
}

const overlapRatio = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(1, Math.min(a.w * a.h, b.w * b.h)) : 0;
};
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;

const SIG_RX = /\b(signature|sign here|signed by|signer)\b/i;
const DATE_RX = /\bdate\b/i;

function kindOf(label) {
  const l = label.toLowerCase();
  if (SIG_RX.test(l) && !/\bdate (signed|of signature)\b|\bprint(ed)? name\b|\bname of\b/.test(l.replace(/^.*\b(signature)\b/, '$1'))) return 'signature';
  if (/\binitials?\b/.test(l) && !/middle initial/.test(l)) return 'initials';
  if (DATE_RX.test(l) && !/birth|expir|issue|discharge|release|entry|separation/.test(l)) return 'date';
  return 'text';
}

/** Blank places to write on a flat page. Prefers missing a spot over inventing one. */
async function findSpots(page, viewport, texts, pdfjs) {
  const { hs, vs, rects } = await pageShapes(page, viewport, pdfjs);
  const pageW = viewport.width;
  const textHits = (r) => texts.filter((t) => overlapRatio(r, t) > 0.3);
  const spots = [], boxSpots = [];

  // 1. Boxes. Neighboring tiny boxes (one letter each) join into one.
  let boxes = rects.filter((r) => r.h >= 9 && r.h <= 60 && r.w <= pageW * 0.95);
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  const dedup = [];
  for (const b of boxes) if (!dedup.some((d) => Math.abs(d.x - b.x) < 1.5 && Math.abs(d.y - b.y) < 1.5 && Math.abs(d.w - b.w) < 1.5 && Math.abs(d.h - b.h) < 1.5)) dedup.push({ ...b });
  const joined = [];
  for (const b of dedup.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = joined[joined.length - 1];
    if (last && b.w < 22 && Math.abs(last.y - b.y) < 1 && Math.abs(last.h - b.h) < 1 && b.x - (last.x + last.w) < 3 && b.x >= last.x + last.w - 1.5) last.w = b.x + b.w - last.x;
    else joined.push(b);
  }
  // Only innermost boxes (a box around other boxes is a section, not a blank).
  const leaves = joined.filter((b) => !joined.some((o) => o !== b && inside(o, b) && o.w * o.h < b.w * b.h * 0.9));
  for (const b of leaves) {
    if (b.w < 16 || (b.w < 15 && b.h < 15)) continue; // check boxes
    if (b.w > pageW * 0.9 && b.h > 40) continue;
    const hits = textHits(b);
    let cap = [];
    if (hits.length) {
      // A small caption in the top of the box is fine; anything else means it's filled or printed.
      cap = hits.filter((t) => t.base <= b.y + Math.max(11, b.h * 0.45));
      if (cap.length !== hits.length) continue;
    }
    let area = { ...b };
    let label = '';
    if (cap.length) {
      const bottom = Math.max(...cap.map((t) => t.base));
      label = norm(cap.sort((p, q) => p.base - q.base || p.x - q.x).map((t) => t.str).join(' '));
      area = { x: b.x, y: bottom + 1, w: b.w, h: b.y + b.h - bottom - 1 };
      if (area.h < 9) continue;
    }
    label ||= labelFor(b, texts);
    boxSpots.push({ ...area, line: area.y + area.h - 2, label, src: 'box', box: b });
  }
  // Boxes side by side on one row with only dashes or slashes between them are
  // parts of one answer (SSN, phone, date, name parts). They share the label of
  // the first box, and remember their order so each part gets the right piece.
  boxSpots.sort((a, b) => (Math.abs(a.box.y - b.box.y) < 3 ? a.box.x - b.box.x : a.box.y - b.box.y));
  let group = null, gid = 0;
  const between = (a, b) => texts.filter((t) => t.x >= a.x + a.w - 1 && t.x + t.w <= b.x + 1 && Math.abs(t.y + t.h / 2 - (b.y + b.h / 2)) < b.h);
  for (const s of boxSpots) {
    const prev = group?.[group.length - 1];
    const sameRow = prev && Math.abs(prev.box.y - s.box.y) < 3 && Math.abs(prev.box.h - s.box.h) < 3 && s.box.x - (prev.box.x + prev.box.w) < 30 && s.box.x > prev.box.x;
    if (sameRow && between(prev.box, s.box).every((t) => /^[\s\-\u2013\u2014\/.]*$/.test(t.str))) group.push(s);
    else { group = [s]; s.gid = ++gid; }
    s.gid = group[0].gid;
  }
  const groups = {};
  for (const s of boxSpots) (groups[s.gid] ||= []).push(s);
  for (const g of Object.values(groups)) {
    if (g.length > 1) g.forEach((s, i) => { s.label = g[0].label; s.part = i; s.parts = g.length; });
  }
  for (const s of boxSpots) if (s.label) spots.push(s);

  // 2. Stand-alone lines to write on (not the edge of a box or table cell).
  const edgeOfBox = (l) => joined.some((b) => (Math.abs(b.y - l.y) < 1.5 || Math.abs(b.y + b.h - l.y) < 1.5) && Math.min(b.x + b.w, l.x2) - Math.max(b.x, l.x1) > (l.x2 - l.x1) * 0.5);
  for (const l of hs) {
    const w = l.x2 - l.x1;
    if (w < 40 || w > pageW * 0.8 || edgeOfBox(l)) continue;
    const boxedAbove = hs.some((o) => o !== l && o.y < l.y - 3 && o.y > l.y - 26 && Math.min(o.x2, l.x2) - Math.max(o.x1, l.x1) > w * 0.5);
    const walls = vs.some((v) => (Math.abs(v.x - l.x1) < 2 || Math.abs(v.x - l.x2) < 2) && v.y2 >= l.y - 2 && v.y1 < l.y - 6);
    if (boxedAbove || walls) continue;
    const area = { x: l.x1, y: l.y - 20, w, h: 19 };
    if (textHits({ ...area, y: area.y + 3, h: area.h - 4 }).length) continue; // already written on
    let label = labelFor({ x: l.x1, y: l.y - 14, w, h: 14 }, texts);
    if (!label) {
      const below = texts.filter((t) => t.y >= l.y - 1 && t.y < l.y + 12 && t.x < l.x2 && t.x + t.w > l.x1);
      label = norm(below.map((t) => t.str).join(' '));
    }
    if (!label) continue;
    spots.push({ ...area, line: l.y, label, src: 'line' });
  }

  // 3. Table cells captioned as a signature ("33A. VETERAN SIGNATURE") with room to sign below.
  for (const cap of texts) {
    if (!/\b(signature|sign here)\b/i.test(cap.str) || /\bdate\b/i.test(cap.str)) continue;
    const below = hs.filter((l) => l.y > cap.base + 8 && l.y < cap.base + 90 && l.x1 <= cap.x + 2 && l.x2 >= cap.x + 40).sort((a, b) => a.y - b.y)[0];
    if (!below) continue;
    const crosses = (v) => v.y1 <= cap.base && v.y2 >= below.y - 2;
    const leftWall = vs.filter((v) => v.x <= cap.x + 1 && v.x >= below.x1 - 1 && crosses(v)).sort((a, b) => b.x - a.x)[0];
    const rightWall = vs.filter((v) => v.x > cap.x + cap.w && v.x <= below.x2 + 1 && crosses(v)).sort((a, b) => a.x - b.x)[0];
    const x1 = leftWall ? leftWall.x : below.x1, x2 = rightWall ? rightWall.x : below.x2;
    const capBottom = Math.max(cap.base, ...texts.filter((t) => t !== cap && t.x >= x1 && t.x < x2 && t.y < cap.base + 9 && t.base > cap.base && t.base < cap.base + 10).map((t) => t.base));
    const area = { x: x1 + 2, y: capBottom + 2, w: x2 - x1 - 4, h: below.y - capBottom - 3 };
    if (area.h < 12 || area.w < 60) continue;
    if (texts.some((t) => overlapRatio(area, t) > 0.2)) continue; // already signed
    spots.push({ ...area, line: below.y - 2, label: norm(cap.str), src: 'cell' });
  }

  // 4. Runs of underscores in the text: "Name: ________"
  for (const t of texts) {
    const rx = /_{4,}/g;
    let m;
    while ((m = rx.exec(t.str))) {
      const per = t.w / Math.max(1, t.str.length);
      const area = { x: t.x + m.index * per, y: t.base - 18, w: m[0].length * per, h: 19 };
      if (texts.some((o) => o !== t && overlapRatio({ ...area, y: area.y + 4, h: area.h - 6 }, o) > 0.2)) continue;
      const label = norm(t.str.slice(0, m.index).replace(/_+/g, ' ')) || labelFor(area, texts);
      spots.push({ ...area, line: t.base, label, src: 'underscore' });
    }
  }

  // Remove duplicates (an underscore run often sits on a drawn line).
  const kept = [];
  for (const s of spots) if (!kept.some((k) => overlapRatio(k, s) > 0.5)) kept.push(s);
  if (kept.length > 120) return []; // a grid or table, not a form
  return kept.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, line: s.line, label: s.label, kind: kindOf(s.label), src: s.src, ...(s.parts ? { part: s.part, parts: s.parts, group: s.gid } : {}) }));
}

/** The numbered heading a spot sits under ("13B. NEW ADDRESS ..."), for context. */
function sectionFor(spot, texts) {
  let best = null;
  for (const t of texts) {
    if (!/^\s*\d{1,2}[A-Z]?\.\s+\S/.test(t.str)) continue;
    if (t.base > spot.y + 2 || t.x > spot.x + 6 || spot.y - t.base > 160) continue;
    if (!best || t.base > best.base) best = t;
  }
  return best ? norm(best.str) : '';
}

/**
 * Scan the whole document.
 * @returns {Promise<{fields: Array, spots: Array}>}
 *   field: { id, page, name, words, tu, label, type, rect:{x,y,w,h}, maxLen, comb, multiLine, readOnly, value, exportValue }
 *   spot:  { id, page, x, y, w, h, line, label, kind }
 */
export async function scanDocument(doc, pdfjs, { maxSpotPages = 30 } = {}) {
  const fields = [], spots = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const anns = (await page.getAnnotations()).filter((a) => a.subtype === 'Widget' && !a.hidden);
    let texts = null;
    const getTexts = async () => (texts ||= await pageText(page, viewport, pdfjs));
    for (const a of anns) {
      if (!a.rect) continue;
      const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
      const rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      if (rect.w < 2 || rect.h < 2) continue;
      const type = a.fieldType === 'Tx' ? 'text' : a.fieldType === 'Sig' ? 'sig' : a.fieldType === 'Ch' ? 'choice'
        : a.fieldType === 'Btn' ? (a.checkBox ? 'check' : a.radioButton ? 'radio' : 'button') : 'other';
      if (type === 'button' || type === 'other') continue;
      fields.push({
        id: a.id, page: n, name: a.fieldName || '', words: nameWords(a.fieldName), tu: norm(a.alternativeText),
        label: labelFor(rect, await getTexts()), type, rect,
        maxLen: a.maxLen || 0, comb: !!a.comb, multiLine: !!a.multiLine, readOnly: !!a.readOnly,
        value: a.fieldValue ?? '', exportValue: a.exportValue ?? a.buttonValue, options: a.options,
      });
    }
    if (!anns.length && n <= maxSpotPages) {
      const tx = await getTexts();
      const found = await findSpots(page, viewport, tx, pdfjs);
      found.forEach((s, i) => spots.push({ id: `spot-${n}-${i}`, page: n, ...s, section: sectionFor(s, tx) }));
    }
    page.cleanup?.();
  }
  // Reading order: page, then top to bottom, then left to right.
  const order = (a, b) => a.page - b.page || (Math.abs((a.rect?.y ?? a.y) - (b.rect?.y ?? b.y)) > 4 ? (a.rect?.y ?? a.y) - (b.rect?.y ?? b.y) : (a.rect?.x ?? a.x) - (b.rect?.x ?? b.x));
  fields.sort(order);
  spots.sort(order);
  return { fields, spots };
}
