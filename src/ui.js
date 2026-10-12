// Small UI helpers: element builder, dialogs, toasts, busy indicator.

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) node.style.setProperty(sk, sv);
        else node.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v; // only ever used with our own static markup
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- icons (inline SVG, no external requests) ---------- */
const P = {
  sign: '<path d="M3 17c3-1 4.5-5 6-9 .8-2 2.6-2 2.4.4-.3 3.3-2.8 7.6-1.4 8.1 1.2.4 2.4-2.7 3.6-2.6 1 .1.6 2 1.6 2.1 1 .1 2-1.2 3.8-1.2"/><path d="M3 21h18"/>',
  initials: '<path d="M5 18V6l5 8 5-8v12"/><path d="M3 21h18"/>',
  text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
  date: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  open: '<path d="M4 20V5a1 1 0 011-1h5l2 2h7a1 1 0 011 1v3"/><path d="M4 20l3-8h15l-3 8z"/>',
  drive: '<path d="M8.5 3.5h7l6 10.5-3.5 6h-12L2.5 14z"/><path d="M8.5 3.5L15 14.5h6.5M2.5 14l3.5 6 6.5-11"/>',
  share: '<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M5 11v9h14v-9"/>',
  download: '<path d="M12 3v12M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
  seal: '<circle cx="12" cy="10" r="6"/><path d="M9 15l-1.5 6 4.5-2.5 4.5 2.5L15 15"/><path d="M10 10l1.5 1.5L14.5 8"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  fields: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M6.5 7h5M6.5 17h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  upload: '<path d="M12 16V4M7.5 8.5L12 4l4.5 4.5"/><path d="M5 20h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'icon ' + cls);
  s.innerHTML = P[name] || '';
  return s;
}

/* ---------- dialogs ---------- */

/**
 * Open a dialog. `build(close)` returns the body content.
 * Resolves with whatever value close() is called with (undefined if dismissed).
 */
export function openDialog({ title, wide = false, build, dismissible = true, className = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const dlg = h('dialog', { class: 'dlg ' + (wide ? 'dlg-wide ' : '') + className, 'aria-label': title });
    const close = (value) => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    const head = h('header', { class: 'dlg-head' },
      h('h2', {}, title),
      dismissible ? h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close(undefined) }, icon('close')) : null);
    const body = h('div', { class: 'dlg-body' });
    dlg.append(head, body);
    document.body.append(dlg);
    const content = build(close, dlg);
    if (content) body.append(content);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissible) close(undefined); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg && dismissible) close(undefined); });
    dlg.showModal();
  });
}

export function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  return openDialog({
    title,
    build: (close) => h('div', {},
      h('p', { class: 'muted' }, message),
      h('div', { class: 'row-end' },
        h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => close(true) }, okLabel))),
  }).then((v) => !!v);
}

export function passwordDialog(title, message, label = 'Password') {
  return openDialog({
    title,
    build: (close) => {
      const input = h('input', { type: 'password', autocomplete: 'off', class: 'input', id: 'pw-in' });
      const form = h('form', { onsubmit: (e) => { e.preventDefault(); close(input.value); } },
        message ? h('p', { class: 'muted' }, message) : null,
        h('label', { class: 'field' }, h('span', {}, label), input),
        h('div', { class: 'row-end' },
          h('button', { type: 'button', class: 'btn', onclick: () => close(undefined) }, 'Cancel'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, 'Continue')));
      setTimeout(() => input.focus(), 50);
      return form;
    },
  });
}

/* ---------- toast + busy ---------- */
let toastTimer;
const canPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

/**
 * Put an element in the browser's "top layer" so it shows above any open
 * window (dialogs live in the top layer too, and would otherwise cover it).
 * Showing it again moves it above windows opened since.
 */
function raise(el) {
  if (canPopover) {
    if (!el.popover) el.popover = 'manual';
    if (el.parentNode !== document.body) document.body.append(el);
    try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); return; } catch {}
  }
  // Older browsers: place it inside the topmost open window instead.
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  (dialogs[dialogs.length - 1] || document.body).append(el);
}
function lower(el) {
  if (canPopover && el.popover) { try { el.hidePopover(); } catch {} }
}

export function toast(message, kind = '') {
  let t = document.getElementById('toast');
  if (!t) t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
  t.textContent = message;
  t.className = kind;
  raise(t);
  requestAnimationFrame(() => { t.className = 'show ' + kind; });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = kind; setTimeout(() => { if (!t.classList.contains('show')) lower(t); }, 250); }, kind === 'error' ? 6000 : 3200);
}

export async function busy(message, fn) {
  const b = h('div', { class: 'busy', role: 'alert', 'aria-busy': 'true' }, h('div', { class: 'busy-card' }, h('div', { class: 'spinner' }), h('p', {}, message)));
  raise(b);
  // Let the overlay paint before heavy work starts.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  try { return await fn((m) => { b.querySelector('p').textContent = m; }); }
  finally { lower(b); b.remove(); }
}
