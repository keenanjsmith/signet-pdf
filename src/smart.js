// Smart filling in the editor:
//  - finds every box (real form boxes, signature boxes, blanks on flat PDFs)
//  - "Sign here" tags that fit your signature into the box with one tap
//  - fills dates next to a signature when you sign
//  - fills your details from My info, highlighted for you to check, with undo
//  - "Next" button to jump from box to box
import { h, icon, toast } from './ui.js';
import { pdfjsLib } from './viewer.js';
import { scanDocument } from './fields/scan.js';
import { plan, todayFor, classify } from './fields/match.js';
import { getProfile, hasProfile, unlock, editProfile, onProfileChange, isUnlocked } from './profile.js';
import { textWidth } from './items.js';
const BASELINE = 0.0665 + 0.905; // same as the PDF writer (pdf/export.js)

export class Smart {
  /**
   * @param {object} o
   * @param {import('./viewer.js').Viewer} o.viewer
   * @param {import('./items.js').Items} o.items
   * @param {(kind: 'signature'|'initials') => Promise<{dataUrl,w,h}|null>} o.chooseSignature
   * @param {HTMLElement} o.bar  where the smart bar lives
   */
  constructor({ viewer, items, chooseSignature, bar }) {
    Object.assign(this, { viewer, items, chooseSignature, bar });
    this.targets = [];
    this.byId = new Map();
    this.roles = new Map();
    this.autoFilled = [];   // { kind: 'field', id, prev } | { kind: 'item', id }
    this.layers = new Map(); // page -> tag layer element
    this.cursor = -1;
    this.ready = false;
    this.off = onProfileChange(() => this.renderBar());
    viewer.eventBus.on('annotationlayerrendered', (e) => this.decorateFields(e.pageNumber));
  }

  destroy() { this.off?.(); }

  /* ---------------- discovery ---------------- */

  async analyze() {
    this.renderBar('scanning');
    const { fields, spots } = await scanDocument(this.viewer.doc, pdfjsLib);
    this.targets = [
      ...fields.map((f) => ({ ...f, source: 'field' })),
      ...spots.map((s) => ({ ...s, source: 'spot', type: 'spot', rect: { x: s.x, y: s.y, w: s.w, h: s.h } })),
    ];
    this.byId = new Map(this.targets.map((t) => [t.id, t]));
    for (const t of this.targets) t.info = classify(t);
    // Section-level decisions (other people, row groups) come from the planner.
    const { roles } = plan(this.targets, {}, {});
    this.roles = roles;
    for (const t of this.targets) {
      const r = roles.get(t.id);
      t.role = r?.role || (t.source === 'spot' && t.kind !== 'text' ? (t.kind === 'date' ? null : t.kind) : null);
      t.other = r?.other ?? t.info.other;
    }
    this.ready = true;
    for (const [n] of this.viewer.overlays) this.mount(n, this.viewer.overlay(n));
    this.viewer.attachAll();
    for (let n = 1; n <= this.viewer.numPages; n++) this.decorateFields(n);

    const profile = await getProfile();
    if (profile?.autoFill && (await hasProfile())) await this.autofill({ quiet: true });
    else this.renderBar();
  }

  get counts() {
    const fields = this.targets.filter((t) => t.source === 'field' && t.type !== 'sig' && !t.readOnly).length;
    const spots = this.targets.filter((t) => t.source === 'spot').length;
    const signs = this.signTargets().length;
    return { fields, spots, signs };
  }

  signTargets(kind = null) {
    return this.targets.filter((t) => (t.role === 'signature' || t.role === 'initials') && !t.other && (!kind || t.role === kind));
  }

  isFilled(t) {
    if (this.items.items.some((i) => i.target === t.id)) return true;
    if (t.source === 'field') {
      const v = this.fieldValue(t);
      return t.type === 'check' || t.type === 'radio' ? v === true || (v && v !== 'Off') : !!String(v ?? '').trim();
    }
    return false;
  }

  /* ---------------- form boxes ---------------- */

  fieldValue(t) {
    const st = this.viewer.doc?.annotationStorage;
    const stored = st?.getRawValue?.(t.id);
    if (stored && 'value' in stored) return stored.value;
    return t.value;
  }

  setField(t, value) {
    const st = this.viewer.doc.annotationStorage;
    st.setValue(t.id, { value });
    const el = document.querySelector(`[data-element-id="${CSS.escape(t.id)}"]`);
    if (el && 'value' in el && typeof value === 'string') {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /** Mark auto-filled boxes so you can see what to check. */
  decorateFields(n) {
    const auto = new Set(this.autoFilled.filter((a) => a.kind === 'field').map((a) => a.id));
    const page = this.viewer.pageDiv(n);
    if (!page) return;
    page.querySelectorAll('.annotationLayer section[data-annotation-id]').forEach((sec) => {
      sec.classList.toggle('sf-auto', auto.has(sec.dataset.annotationId));
    });
  }

  /* ---------------- tags and spots on the page ---------------- */

  mount(n, overlay) {
    if (!this.ready) return;
    let layer = this.layers.get(n);
    if (!layer) {
      layer = h('div', { class: 'tgt-layer' });
      this.layers.set(n, layer);
    }
    if (layer.parentNode !== overlay) overlay.prepend(layer);
    this.renderLayer(n);
  }

  renderLayer(n) {
    const layer = this.layers.get(n);
    const info = this.viewer.pageInfo[n - 1];
    if (!layer || !info) return;
    const pct = (r) => ({ left: (r.x / info.width) * 100 + '%', top: (r.y / info.height) * 100 + '%', width: (r.w / info.width) * 100 + '%', height: (r.h / info.height) * 100 + '%' });
    const nodes = [];
    for (const t of this.targets) {
      if (t.page !== n || this.isFilled(t)) continue;
      const sign = (t.role === 'signature' || t.role === 'initials') && !t.other;
      if (sign) {
        const inside = t.rect.w >= 100 || t.rect.x < 90; // tag inside the box unless the box is small and there's room beside it
        nodes.push(h('div', { class: 'tgt tgt-sign' + (inside ? ' tag-in' : ''), style: pct(t.rect), 'data-target': t.id, onclick: () => this.sign(t) },
          h('button', { class: 'sign-tag', type: 'button', 'aria-label': t.role === 'initials' ? 'Initial here' : 'Sign here', onclick: (e) => { e.stopPropagation(); this.sign(t); } },
            icon(t.role === 'initials' ? 'initials' : 'sign'), h('span', {}, t.role === 'initials' ? 'Initial' : 'Sign here'))));
      } else if (t.source === 'spot' && !t.other) {
        nodes.push(h('button', { class: 'tgt tgt-spot', type: 'button', style: pct(t.rect), 'data-target': t.id, 'aria-label': 'Fill in: ' + (t.label || 'blank'), title: t.label || '', onclick: () => this.fillSpot(t) }));
      }
    }
    layer.replaceChildren(...nodes);
  }

  refresh() {
    for (const n of this.layers.keys()) this.renderLayer(n);
    this.renderBar();
  }

  /* ---------------- signing ---------------- */

  /** Fit a signature into a box: as large as fits, never wider than a normal signature. */
  fitIntoTarget(t, sig, kind) {
    const r = t.rect;
    const pad = Math.min(3, r.h * 0.12);
    const ratio = sig.h / sig.w;
    const maxW = kind === 'initials' ? Math.min(r.w - pad * 2, 70) : Math.min(r.w - pad * 2, 210);
    // Short boxes: let the signature rise above the box a little, like a pen would.
    const short = r.h < 18;
    let hh = short ? Math.min(kind === 'initials' ? 16 : 20, r.h * 1.45) : Math.min(r.h - pad * 2, kind === 'initials' ? 36 : 54);
    let w = hh / ratio;
    if (w > maxW) { w = maxW; hh = w * ratio; }
    const x = r.x + pad;
    // Sit on the line for underlines and short boxes; centre in roomy boxes.
    const y = t.source === 'spot' && t.line != null && t.src !== 'box' ? t.line - hh * 0.9
      : short ? r.y + r.h - hh - pad * 0.5 : r.y + (r.h - hh) / 2;
    return { x, y, w, h: hh };
  }

  async sign(t) {
    const kind = t.role === 'initials' ? 'initials' : 'signature';
    const sig = await this.chooseSignature(kind);
    if (!sig) return;
    const box = this.fitIntoTarget(t, sig, kind);
    this.items.add({ kind, src: sig.dataUrl, w: box.w, h: box.h, target: t.id }, t.page, box.x + box.w / 2, box.y + box.h / 2);
    this.items.select(null);
    if (kind === 'signature') this.dateNear(t);
    this.refresh();
  }

  /** After signing, fill the "date signed" boxes that belong to that signature. */
  dateNear(sigTarget) {
    const num = (t) => /^(\d+)/.exec(t.source === 'spot' ? (t.label || '').trim() : (t.tu || '').trim())?.[1];
    const sn = num(sigTarget);
    const cands = this.targets.filter((t) => t.page === sigTarget.page && (t.info.role === 'dateSigned' || (t.source === 'spot' && t.kind === 'date' && /sign/i.test(t.label || ''))) && !this.isFilled(t));
    if (!cands.length) return;
    const dist = (t) => Math.hypot(t.rect.x - (sigTarget.rect.x + sigTarget.rect.w), t.rect.y - sigTarget.rect.y);
    let pick = sn ? cands.filter((t) => num(t) === sn) : [];
    if (!pick.length) {
      const nearest = cands.sort((a, b) => dist(a) - dist(b))[0];
      if (dist(nearest) > 320) return;
      // Take the whole row of date pieces (month / day / year) next to it.
      pick = cands.filter((t) => Math.abs(t.rect.y - nearest.rect.y) < 6 && (t.source !== 'spot' || t.group === nearest.group));
    }
    for (const t of pick) {
      const v = todayFor(t);
      if (!v) continue;
      if (t.source === 'field') this.setField(t, v);
      else this.addText(t, v, { target: true });
    }
  }

  /* ---------------- blanks on flat PDFs ---------------- */

  /** Put text on a blank's line, sized to fit. */
  addText(t, text, { target = true, auto = false } = {}) {
    const r = t.rect;
    let size = Math.max(7, Math.min(11, r.h * 0.62));
    while (size > 6 && textWidth(text, size) + 6 > r.w) size -= 0.5;
    const baseline = (t.line ?? r.y + r.h) - Math.max(2, r.h * 0.18);
    const y = baseline - size * BASELINE;
    const w = textWidth(text, size) + 5;
    const it = this.items.add({ kind: t.kind === 'date' ? 'date' : 'text', text, size, color: '#16181d', target: target ? t.id : undefined, auto }, t.page, r.x + 1.5 + w / 2, y + (size * 1.25) / 2);
    this.items.select(null);
    return it;
  }

  fillSpot(t) {
    if (t.kind === 'signature' || t.kind === 'initials') return this.sign(t);
    if (t.kind === 'date') { this.addText(t, todayFor(t)); this.refresh(); return; }
    const it = this.addText(t, '');
    this.items.edit(it.id);
    this.refresh();
  }

  /* ---------------- My info ---------------- */

  async autofill({ quiet = false, includePrivate = false } = {}) {
    if (!(await hasProfile())) {
      if (!quiet) { if (await editProfile()) return this.autofill({ quiet, includePrivate }); }
      return this.renderBar();
    }
    if (includePrivate && !isUnlocked() && !(await unlock())) return this.renderBar();
    const profile = await getProfile();
    const free = this.targets.filter((t) => !this.isFilled(t));
    const { fills, lockedCount } = plan(free, profile, { unlocked: isUnlocked() });
    let n = 0;
    for (const f of fills) {
      const t = f.target;
      if (t.source === 'field') {
        this.autoFilled.push({ kind: 'field', id: t.id, prev: this.fieldValue(t) ?? '' });
        this.setField(t, f.value);
      } else {
        const it = this.addText(t, f.value, { auto: true });
        this.autoFilled.push({ kind: 'item', id: it.id });
      }
      n++;
    }
    this.lockedCount = lockedCount;
    this.lastFill = n;
    for (let p = 1; p <= this.viewer.numPages; p++) this.decorateFields(p);
    this.refresh();
    if (!quiet && !n && !lockedCount) toast('Nothing on this PDF matches My info.');
  }

  undoAutofill() {
    for (const a of this.autoFilled.reverse()) {
      if (a.kind === 'field') this.setField(this.byId.get(a.id), a.prev);
      else if (this.items.get(a.id)) this.items.remove(a.id);
    }
    this.autoFilled = [];
    this.lastFill = 0;
    for (let p = 1; p <= this.viewer.numPages; p++) this.decorateFields(p);
    this.refresh();
    toast('Removed what My info filled in');
  }

  /* ---------------- next box ---------------- */

  stops() {
    return this.targets.filter((t) => !t.readOnly && !t.other && !(t.role === 'dateSigned') && (t.source === 'spot' || t.type !== 'sig' || t.role === 'signature'))
      .filter((t) => !this.isFilled(t));
  }

  async next() {
    const stops = this.stops();
    if (!stops.length) { toast('Every box is filled in.'); return; }
    // Continue from the last box you visited, in reading order.
    const order = this.targets;
    const last = this.cursor >= 0 ? order[this.cursor] : null;
    let t = stops.find((s) => !last || order.indexOf(s) > this.cursor) || stops[0];
    this.cursor = order.indexOf(t);
    await this.goTo(t);
  }

  async goTo(t) {
    const info = this.viewer.pageInfo[t.page - 1];
    const [px, py] = info.viewport.convertToPdfPoint(Math.max(0, t.rect.x - 30), Math.max(0, t.rect.y - 80));
    this.viewer.viewer.scrollPageIntoView({ pageNumber: t.page, destArray: [null, { name: 'XYZ' }, px, py, null], allowNegativeOffset: true });
    if (t.source === 'field' && t.type !== 'sig') {
      for (let i = 0; i < 40; i++) {
        const el = document.querySelector(`[data-element-id="${CSS.escape(t.id)}"]`);
        if (el) { el.focus({ preventScroll: true }); return; }
        await new Promise((r) => setTimeout(r, 50));
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 120));
    const el = document.querySelector(`.tgt[data-target="${CSS.escape(t.id)}"]`);
    if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); el.querySelector('button')?.focus({ preventScroll: true }) || (el.focus?.({ preventScroll: true })); }
  }

  /* ---------------- the bar ---------------- */

  async renderBar(mode) {
    const bar = this.bar;
    if (!bar) return;
    if (mode === 'scanning') { bar.hidden = false; bar.replaceChildren(h('div', { class: 'sbar-msg' }, h('span', { class: 'spinner sm' }), h('span', {}, 'Looking for boxes to fill…'))); return; }
    const { fields, spots, signs } = this.counts;
    if (!fields && !spots && !signs) { bar.hidden = true; return; }
    bar.hidden = false;
    const left = this.stops().length;
    const have = await hasProfile();
    const what = fields ? `${fields} fill-in box${fields === 1 ? '' : 'es'}` : `${spots} blank${spots === 1 ? '' : 's'} found`;
    const parts = [h('span', { class: 'sbar-count' }, icon('fields'), h('span', {}, left ? `${what} • ${left} to go` : `${what} • all done`))];
    const actions = h('div', { class: 'sbar-actions' });
    if (this.autoFilled.length) {
      parts.push(h('span', { class: 'sbar-note' }, `Filled ${this.autoFilled.length} from My info. Check the green ones.`));
      actions.append(h('button', { class: 'btn btn-quiet sm', type: 'button', onclick: () => this.undoAutofill() }, icon('undo'), 'Undo fill'));
    }
    if (this.lockedCount && !isUnlocked()) actions.append(h('button', { class: 'btn sm', type: 'button', onclick: () => this.autofill({ includePrivate: true }) }, icon('lock'), `Fill ${this.lockedCount} private`));
    else if (!this.autoFilled.length) actions.append(h('button', { class: 'btn sm', type: 'button', onclick: () => this.autofill() }, icon('fields'), have ? 'Fill my info' : 'Set up My info'));
    if (left) actions.append(h('button', { class: 'btn btn-primary sm', type: 'button', onclick: () => this.next() }, 'Next box', icon('back', 'flip')));
    bar.replaceChildren(h('div', { class: 'sbar-main' }, ...parts), actions);
  }
}
