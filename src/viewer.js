// PDF viewing, built on Mozilla's pdf.js (the same engine Firefox uses).
// The "legacy" build adds compatibility code so older phones and Safari work too.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
globalThis.pdfjsLib = pdfjsLib;
const viewerLib = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs');

const abs = (p) => new URL(import.meta.env.BASE_URL + p, location.href).href;
const ASSETS = {
  cMapUrl: abs('pdfjs/cmaps/'),
  cMapPacked: true,
  standardFontDataUrl: abs('pdfjs/standard_fonts/'),
  wasmUrl: abs('pdfjs/wasm/'),
  iccUrl: abs('pdfjs/iccs/'),
};

export class Viewer {
  constructor(container, { onPassword, onPagesReady, onOverlay }) {
    this.container = container;
    this.onPassword = onPassword;
    this.onPagesReady = onPagesReady;
    this.onOverlay = onOverlay; // (pageNumber, overlayEl) when an overlay is created
    this.eventBus = new viewerLib.EventBus();
    this.linkService = new viewerLib.PDFLinkService({ eventBus: this.eventBus, externalLinkTarget: viewerLib.LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
    this.viewer = new viewerLib.PDFViewer({
      container,
      eventBus: this.eventBus,
      linkService: this.linkService,
      textLayerMode: 0,
      annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
      removePageBorders: false,
      maxCanvasPixels: 2 ** 24,
    });
    this.linkService.setViewer(this.viewer);
    this.overlays = new Map(); // pageNumber -> overlay element
    this.pageInfo = [];        // index -> { width, height, rotate, viewport }
    this.autoFit = true;

    this.eventBus.on('pagesinit', () => { this.fit(); this.attachAll(); });
    this.eventBus.on('pagerendered', (e) => this.attach(e.pageNumber));
    this.eventBus.on('pagesloaded', () => this.attachAll());
    this.eventBus.on('scalechanging', () => requestAnimationFrame(() => this.attachAll()));

    this._ro = new ResizeObserver(() => { if (this.autoFit && this.doc) this.fit(); });
    this._ro.observe(container);
    this._setupPinch();
  }

  /** Open from bytes. Resolves when pages are laid out. Returns the password used (if any). */
  async open(bytes) {
    await this.close();
    let usedPassword;
    const task = pdfjsLib.getDocument({
      data: bytes.slice(), // pdf.js takes ownership of the buffer
      ...ASSETS,
      isEvalSupported: false,
      enableXfa: false,
      stopAtErrors: false,
    });
    task.onPassword = async (update, reason) => {
      const wrong = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
      const pw = await this.onPassword(wrong);
      if (pw == null) { task.destroy(); return; }
      usedPassword = pw;
      update(pw);
    };
    this.task = task;
    const doc = await task.promise;
    this.doc = doc;
    this.pageInfo = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      this.pageInfo.push({ width: viewport.width, height: viewport.height, rotate: viewport.rotation, viewport });
    }
    const ready = new Promise((r) => this.eventBus.on('pagesinit', r, { once: true }));
    this.viewer.setDocument(doc);
    this.linkService.setDocument(doc, null);
    await ready;
    this.onPagesReady?.(this.pageInfo);
    return usedPassword;
  }

  async close() {
    this.overlays.clear();
    this._hasFields = undefined;
    if (this.doc) {
      this.viewer.setDocument(null);
      this.linkService.setDocument(null, null);
      try { await this.task.destroy(); } catch {}
      this.doc = null;
    }
  }

  get numPages() { return this.doc?.numPages || 0; }
  get currentPage() { return this.viewer.currentPageNumber || 1; }

  pageDiv(n) { return this.viewer.getPageView(n - 1)?.div; }

  overlay(n) {
    let ov = this.overlays.get(n);
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'sig-overlay';
      ov.dataset.page = String(n);
      this.overlays.set(n, ov);
      this.onOverlay?.(n, ov);
    }
    return ov;
  }

  attach(n) {
    const div = this.pageDiv(n);
    if (!div) return;
    const ov = this.overlay(n);
    if (ov.parentNode !== div) div.append(ov);
  }

  attachAll() { for (let i = 1; i <= this.numPages; i++) this.attach(i); }

  /** Fit the page width to the screen. */
  fit() {
    if (!this.doc) return;
    this.autoFit = true;
    this.viewer.currentScaleValue = 'page-width';
    // On big screens a full-width page is too large to work with comfortably.
    if (this.viewer.currentScale > 1.25) this.viewer.currentScale = 1.25;
  }

  zoom(factor) {
    if (!this.doc) return;
    this.autoFit = false;
    this.viewer.currentScale = Math.min(5, Math.max(0.3, this.viewer.currentScale * factor));
  }

  /** Has the user typed into any form fields? */
  get formChanged() { return !!this.doc && this.doc.annotationStorage.size > 0; }

  /** PDF bytes with form field entries written in (or null if nothing was typed). */
  async savedFormBytes() {
    if (!this.formChanged) return null;
    // Make sure focused inputs commit their value.
    document.activeElement?.blur?.();
    await new Promise((r) => setTimeout(r, 50));
    return this.doc.saveDocument();
  }

  async hasFormFields() {
    if (!this.doc) return false;
    if (this._hasFields !== undefined) return this._hasFields;
    let found = false;
    try {
      const f = await this.doc.getFieldObjects();
      found = !!f && Object.keys(f).length > 0;
    } catch {}
    for (let i = 1; !found && i <= Math.min(this.numPages, 200); i++) {
      try {
        const annots = await (await this.doc.getPage(i)).getAnnotations();
        found = annots.some((a) => a.subtype === 'Widget' && a.fieldType && a.fieldType !== 'Sig');
      } catch {}
    }
    this._hasFields = found;
    return found;
  }

  /** Visible page whose center is closest to the middle of the screen. */
  pageNearestCenter() {
    const c = this.container.getBoundingClientRect();
    const cy = c.top + c.height / 2;
    let best = this.currentPage, bestD = Infinity;
    for (let i = 1; i <= this.numPages; i++) {
      const d = this.pageDiv(i);
      if (!d) continue;
      const r = d.getBoundingClientRect();
      if (r.bottom < c.top || r.top > c.bottom) continue;
      const dist = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0;
      if (dist < bestD) { bestD = dist; best = i; }
    }
    return best;
  }

  /** Point (in page units) at the center of the visible part of page n. */
  visibleCenter(n) {
    const d = this.pageDiv(n);
    const info = this.pageInfo[n - 1];
    if (!d || !info) return { x: 100, y: 100 };
    const r = d.getBoundingClientRect();
    const c = this.container.getBoundingClientRect();
    const top = Math.max(r.top, c.top), bottom = Math.min(r.bottom, c.bottom);
    const left = Math.max(r.left, c.left), right = Math.min(r.right, c.right);
    const k = info.width / r.width;
    return { x: ((left + right) / 2 - r.left) * k, y: ((top + bottom) / 2 - r.top) * k };
  }

  _setupPinch() {
    const el = this.container;
    let start = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2 && this.doc) {
        start = { d: dist(e.touches), scale: this.viewer.currentScale };
      }
    }, { passive: true });
    let pending = null;
    el.addEventListener('touchmove', (e) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const target = Math.min(5, Math.max(0.3, start.scale * (dist(e.touches) / start.d)));
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        this.autoFit = false;
        this.viewer.currentScale = target;
      });
    }, { passive: false });
    el.addEventListener('touchend', (e) => { if (e.touches.length < 2) start = null; });
    // Ctrl/Cmd + wheel (and trackpad pinch) zoom on desktop.
    el.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !this.doc) return;
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
  }
}

export { pdfjsLib };
