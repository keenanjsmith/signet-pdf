// Things you place on the page: signatures, initials, text, dates, marks.
// Positions are stored in page units (PDF points, top-left origin, as seen on screen),
// so they stay put at any zoom level.
import { h, icon } from './ui.js';
import { uid } from './store.js';

export const TEXT_FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif';
const measureCtx = document.createElement('canvas').getContext('2d');
export function textWidth(text, size) {
  measureCtx.font = `${size}px ${TEXT_FONT}`;
  return measureCtx.measureText(text || ' ').width;
}
const TEXT_PAD = 2; // page units on each side

export class Items {
  constructor(viewer, { onChange, onActivate }) {
    this.viewer = viewer;
    this.onChange = onChange;
    this.onActivate = onActivate; // tap on an item that's already selected (plays a voice note)
    this.items = [];
    this.history = [];
    this.selected = null;
    this.els = new Map();

    viewer.container.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.item')) this.select(null);
    });
    document.addEventListener('keydown', (e) => {
      if (!this.selected) return;
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return; // typing in a form box or dialog
      if (document.querySelector('dialog[open]')) return;
      const editing = a?.isContentEditable;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editing) { e.preventDefault(); this.remove(this.selected); }
      if (e.key === 'Escape') { if (editing) document.activeElement.blur(); else this.select(null); }
      if (!editing && (e.key === 'Enter' || e.key === ' ') && this.get(this.selected)?.kind === 'audio') { e.preventDefault(); this.onActivate?.(this.get(this.selected)); }
      if (!editing && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const it = this.get(this.selected); const step = e.shiftKey ? 10 : 1;
        this.snapshot();
        if (e.key === 'ArrowLeft') it.x -= step; if (e.key === 'ArrowRight') it.x += step;
        if (e.key === 'ArrowUp') it.y -= step; if (e.key === 'ArrowDown') it.y += step;
        this.clamp(it); this.place(it); this.changed();
      }
    });
  }

  reset() {
    this.items = []; this.history = []; this.selected = null;
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    this.changed();
  }

  get(id) { return this.items.find((i) => i.id === id); }
  get count() { return this.items.length; }
  get canUndo() { return this.history.length > 0; }

  snapshot() {
    this.history.push(this.items.map((i) => ({ ...i })));
    if (this.history.length > 100) this.history.shift();
  }

  undo() {
    if (!this.history.length) return;
    const prev = this.history.pop();
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    this.items = prev.filter((i) => !((i.kind === 'text' || i.kind === 'date') && !String(i.text || '').trim()));
    this.selected = null;
    for (const it of this.items) this.render(it);
    this.changed();
  }

  changed() { this.onChange?.(this); }

  info(page) { return this.viewer.pageInfo[page - 1]; }

  clamp(it) {
    const p = this.info(it.page);
    it.w = Math.min(it.w, p.width); it.h = Math.min(it.h, p.height);
    it.x = Math.max(0, Math.min(p.width - it.w, it.x));
    it.y = Math.max(0, Math.min(p.height - it.h, it.y));
  }

  /** Add an item centered on (cx, cy) of the given page. */
  add(partial, page, cx, cy) {
    this.snapshot();
    const it = { id: uid(), page, ...partial };
    if (it.kind === 'text' || it.kind === 'date') this.fitText(it);
    it.x = cx - it.w / 2; it.y = cy - it.h / 2;
    this.clamp(it);
    this.items.push(it);
    this.render(it);
    this.select(it.id);
    this.changed();
    return it;
  }

  remove(id) {
    this.snapshot();
    this.items = this.items.filter((i) => i.id !== id);
    this.els.get(id)?.remove();
    this.els.delete(id);
    if (this.selected === id) this.selected = null;
    this.changed();
  }

  fitText(it) {
    it.w = textWidth(it.text || '', it.size) + TEXT_PAD * 2 + 1;
    it.h = it.size * 1.25;
  }

  /** Re-attach elements to overlays (after an overlay is created). */
  mount(page, overlay) {
    const info = this.info(page);
    const ro = new ResizeObserver(() => {
      overlay.style.setProperty('--k', String(overlay.clientWidth / info.width));
    });
    ro.observe(overlay);
    for (const it of this.items) if (it.page === page) overlay.append(this.element(it));
  }

  element(it) {
    let el = this.els.get(it.id);
    if (el) return el;
    el = h('div', { class: 'item item-' + it.kind + (it.auto ? ' item-auto' : ''), 'data-id': it.id, tabindex: '0', role: 'group',
      'aria-label': { signature: 'Signature', initials: 'Initials', text: 'Text', date: 'Date', check: 'Check mark', cross: 'X mark', dot: 'Dot', audio: 'Voice note. Tap to play.' }[it.kind],
      title: it.kind === 'audio' ? 'Voice note: tap to play, drag to move' : null });
    if (it.src) el.append(h('img', { src: it.src, alt: '', draggable: 'false' }));
    if (it.kind === 'text' || it.kind === 'date') {
      const span = h('span', { class: 'txt', spellcheck: 'false', 'data-placeholder': 'Type here' });
      span.textContent = it.text;
      try { span.contentEditable = 'plaintext-only'; } catch { span.contentEditable = 'true'; }
      if (span.contentEditable !== 'plaintext-only') span.contentEditable = 'true';
      span.addEventListener('focus', () => { this._editStart = it.text; });
      span.addEventListener('input', () => {
        it.text = span.innerText.replace(/[\r\n]+/g, ' ');
        this.fitText(it); this.clamp(it); this.place(it);
      });
      span.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); span.blur(); } });
      span.addEventListener('paste', (e) => {
        e.preventDefault();
        const t = (e.clipboardData?.getData('text/plain') || '').replace(/[\r\n]+/g, ' ');
        document.execCommand('insertText', false, t);
      });
      span.addEventListener('blur', () => {
        span.textContent = it.text;
        if (this._editStart !== it.text) {
          this.history.push(this.items.map((i) => (i.id === it.id ? { ...i, text: this._editStart } : { ...i })));
          this.fitText(it); this.place(it);
        }
        if (!it.text.trim()) this.remove(it.id);
        this.changed();
      });
      el.append(span);
    }
    const del = h('button', { class: 'item-del', type: 'button', 'aria-label': 'Remove', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); this.remove(it.id); } }, icon('close'));
    const grip = h('div', { class: 'item-grip', 'aria-hidden': 'true' });
    el.append(del, grip);
    this.els.set(it.id, el);
    this.bindDrag(el, it, grip);
    this.place(it);
    return el;
  }

  render(it) {
    const el = this.element(it);
    const ov = this.viewer.overlay(it.page);
    if (el.parentNode !== ov) ov.append(el);
    this.place(it);
  }

  place(it) {
    const el = this.els.get(it.id);
    const p = this.info(it.page);
    if (!el || !p) return;
    el.style.left = (it.x / p.width) * 100 + '%';
    el.style.top = (it.y / p.height) * 100 + '%';
    el.style.width = (it.w / p.width) * 100 + '%';
    el.style.height = (it.h / p.height) * 100 + '%';
    if (it.size) el.style.fontSize = `calc(var(--k, 1) * ${it.size}px)`;
    if (it.color) el.style.color = it.color;
  }

  select(id) {
    if (this.selected === id) return;
    if (this.selected) this.els.get(this.selected)?.classList.remove('sel');
    this.selected = id;
    if (id) this.els.get(id)?.classList.add('sel');
    this.changed();
  }

  bindDrag(el, it, grip) {
    let drag = null;
    const k = () => this.info(it.page).width / el.parentNode.getBoundingClientRect().width;
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      const span = e.target.closest('.txt');
      if (span && document.activeElement === span) return; // editing text: let the caret move
      e.preventDefault();
      e.stopPropagation();
      const wasSelected = this.selected === it.id;
      this.select(it.id);
      el.setPointerCapture(e.pointerId);
      const resizing = e.target === grip;
      drag = { sx: e.clientX, sy: e.clientY, x: it.x, y: it.y, w: it.w, h: it.h, size: it.size, k: k(), moved: false, resizing, wasSelected, span };
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.sx) * drag.k, dy = (e.clientY - drag.sy) * drag.k;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      if (!drag.moved) { drag.moved = true; this.snapshot(); el.classList.add('dragging'); }
      if (drag.resizing) {
        const p = this.info(it.page);
        const ratio = drag.h / drag.w;
        let w = Math.max(12, drag.w + dx);
        w = Math.min(w, p.width - it.x, (p.height - it.y) / ratio);
        if (it.size) { it.size = Math.max(5, drag.size * (w / drag.w)); this.fitText(it); }
        else { it.w = w; it.h = w * ratio; }
      } else {
        it.x = drag.x + dx; it.y = drag.y + dy;
      }
      this.clamp(it);
      this.place(it);
    });
    const end = () => {
      if (!drag) return;
      const d = drag; drag = null;
      el.classList.remove('dragging');
      if (d.moved) { this.changed(); return; }
      if (!d.span && (d.wasSelected || it.kind === 'audio')) this.onActivate?.(it);
      // A tap on a selected text item starts editing.
      if (d.span && d.wasSelected) {
        d.span.focus();
        const r = document.createRange(); r.selectNodeContents(d.span); r.collapse(false);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** Start editing a text item right away (used when it is first placed). */
  edit(id) {
    const span = this.els.get(id)?.querySelector('.txt');
    if (!span) return;
    span.focus();
    const r = document.createRange(); r.selectNodeContents(span); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
}
