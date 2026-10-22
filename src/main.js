import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/homemade-apple/400.css';
import '@fontsource/mrs-saint-delafield/400.css';
import '@fontsource/dancing-script/500.css';
import '@fontsource/caveat/500.css';
import './styles.css';

import { h, $, icon, openDialog, confirmDialog, passwordDialog, toast, busy } from './ui.js';
import { store, uid } from './store.js';
import { createSignature, markImage } from './sigpad.js';
import * as drive from './drive.js';
import { editProfile, hasProfile, getRecord, lock as lockProfile } from './profile.js';
import { recordVoiceNote, canRecord, noteBadge, togglePlay, stopPlayback } from './voice.js';
import { voiceNoteName } from './pdf/names.js';

const app = $('#app');
const state = {
  doc: null,        // { bytes, name, password }
  viewer: null,
  items: null,
  result: null,     // { bytes, name } of the last finished PDF
  dirty: false,
  unlockedIds: new Map(), // id -> unlocked identity (memory only)
};

/* ===================================================================== */
/* Home                                                                  */
/* ===================================================================== */

async function renderHome() {
  document.title = 'Signet PDF';
  const fileIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'visually-hidden', id: 'open-file' });
  fileIn.addEventListener('change', () => { const f = fileIn.files?.[0]; fileIn.value = ''; if (f) openFile(f); });

  const drop = h('label', { class: 'drop', for: 'open-file' },
    h('div', { class: 'drop-sheet', 'aria-hidden': 'true' },
      h('div', { class: 'drop-lines' }, h('i'), h('i'), h('i'), h('i')),
      h('div', { class: 'drop-sign' }, h('span', { class: 'drop-x' }, '×'), h('span', { class: 'drop-scrawl' }, 'Signet'))),
    h('span', { class: 'drop-title' }, 'Open a PDF to sign'),
    h('span', { class: 'drop-sub' }, matchMedia('(pointer: fine)').matches ? 'Choose a file or drop it here' : 'Choose a file from your phone'),
    fileIn);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) openFile(f); });

  const driveBtn = (await drive.pickerAvailable())
    ? h('button', { class: 'btn btn-wide', onclick: openFromDrive }, icon('drive'), 'Open from Google Drive')
    : null;

  const sigRow = h('div', { class: 'sig-shelf' });
  const idRow = h('div', { class: 'id-list' });
  const meRow = h('div', { class: 'me-row' });

  const page = h('main', { class: 'home' },
    h('header', { class: 'home-head' },
      h('div', { class: 'brand' }, logo(), h('span', {}, 'Signet')),
      h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: openSettings }, icon('settings'))),
    h('section', { class: 'home-open' }, drop, driveBtn),
    h('section', { class: 'home-sec' },
      h('div', { class: 'sec-head' }, h('h2', {}, 'My info'),
        h('button', { class: 'btn btn-quiet', onclick: async () => { await editProfile(); renderMe(); } }, icon('fields'), 'Edit')),
      meRow),
    h('section', { class: 'home-sec' },
      h('div', { class: 'sec-head' }, h('h2', {}, 'Your signatures'),
        h('button', { class: 'btn btn-quiet', onclick: async () => { await newSignature('signature'); renderShelf(); } }, icon('plus'), 'Add')),
      sigRow),
    h('section', { class: 'home-sec' },
      h('div', { class: 'sec-head' }, h('h2', {}, 'Digital IDs'),
        h('button', { class: 'btn btn-quiet', onclick: async () => { await manageIds(); renderIds(); } }, icon('key'), 'Manage')),
      idRow),
    h('footer', { class: 'home-foot' },
      icon('shield'),
      h('p', {}, 'Your files stay on this device. Nothing is uploaded unless you tap Save to Google Drive. ',
        h('button', { class: 'link', onclick: showPrivacy }, 'How privacy works'))));

  async function renderShelf() {
    const sigs = await store.all('signatures');
    if (!sigs.length) {
      sigRow.replaceChildren(h('p', { class: 'muted small' }, 'Saved signatures and initials appear here so you can reuse them with one tap.'));
      return;
    }
    sigRow.replaceChildren(...sigs.map((s) => h('div', { class: 'sig-card' },
      h('img', { src: s.dataUrl, alt: s.kind === 'initials' ? 'Saved initials' : 'Saved signature' }),
      h('span', { class: 'small muted' }, s.kind === 'initials' ? 'Initials' : 'Signature'),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Delete', onclick: async () => {
        if (await confirmDialog('Delete this ' + (s.kind === 'initials' ? 'initials' : 'signature') + '?', 'It will be removed from this device.', 'Delete', true)) { await store.del('signatures', s.id); renderShelf(); }
      } }, icon('trash')))));
  }
  async function renderIds() {
    const ids = await store.all('ids');
    idRow.replaceChildren(ids.length
      ? h('ul', { class: 'plain' }, ...ids.map((i) => h('li', { class: 'id-chip' }, icon('seal'), h('span', {}, i.name), h('span', { class: 'small muted' }, i.selfSigned ? 'Personal' : i.issuer))))
      : h('p', { class: 'muted small' }, 'Optional. A digital ID adds a tamper-proof certificate signature, for places that ask for one.'));
  }
  async function renderMe() {
    const rec = await getRecord();
    const b = rec?.basic || {};
    const name = [b.firstName, b.lastName].filter(Boolean).join(' ');
    meRow.replaceChildren(await hasProfile()
      ? h('div', { class: 'id-chip' }, icon('fields'), h('div', { class: 'grow' }, h('strong', {}, name || 'Saved'), h('br'),
          h('span', { class: 'small muted' }, (rec.autoFill !== false ? 'Fills forms for you' : 'Fills forms when you ask') + ((rec.privateKeys || []).length ? ` \u2022 ${rec.privateKeys.length} private detail${rec.privateKeys.length === 1 ? '' : 's'} locked` : ''))))
      : h('p', { class: 'muted small' }, 'Add your name, address and other details once, and Signet fills them into forms for you. They stay on this device.'));
  }
  renderShelf(); renderIds(); renderMe();
  app.replaceChildren(page);
}

function logo() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('class', 'logo'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<circle cx="16" cy="16" r="15" fill="var(--pen)"/><path d="M8 20.5c2.6-.6 3.8-4.8 5-8.3.7-2 2.6-1.8 2.3.6-.4 3-2.3 6.7-1 7.1 1.1.4 2.1-2.4 3.2-2.3.9.1.5 1.8 1.4 1.9 1 .1 2-1 4.1-1" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 24h16" stroke="#fff" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round"/>';
  return s;
}

function showPrivacy() {
  openDialog({
    title: 'How privacy works',
    build: () => h('div', { class: 'prose' },
      h('p', {}, 'Signet runs entirely in your browser. Opening, signing and saving PDFs all happen on this device. There is no Signet server, no account, no tracking and no analytics.'),
      h('p', {}, 'Saved signatures and digital IDs are kept in this browser’s storage on this device only. Digital IDs stay locked with your password, and the password is never stored.'),
      h('p', {}, 'My info works like your browser’s autofill: your name, contact details and address are saved on this device. Private details (Social Security number, date of birth, VA file and service numbers) are encrypted with a passcode only you know, using AES-256. Signet asks for that passcode before using them, keeps them unlocked only in memory, and locks them again after 15 minutes or when the app closes. Finding and filling boxes happens entirely on this device; nothing about your documents or details is sent anywhere.'),
      h('p', {}, 'Read aloud uses only the voices built into your device. Voices that would send your text to an online service are never used. Voice notes are recorded on this device and only leave it inside the PDF or audio files you choose to save, share or send.'),
      h('p', {}, 'Google is only contacted if you set up Google Drive, and then only when you save to or open from Drive (the Finish screen gets Google’s sign-in ready in advance). The app asks for the narrowest Drive permission, which lets it see only the files it saves for you or that you pick yourself. Your Google sign-in is kept in memory and forgotten when the app closes.'),
      h('p', {}, 'The code is open source, so anyone can check these promises.')),
  });
}

/* ===================================================================== */
/* Opening files                                                          */
/* ===================================================================== */

async function readBytes(file) { return new Uint8Array(await file.arrayBuffer()); }

function looksLikePdf(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

async function openFile(file) {
  if (state.doc && !(await leaveEditor())) return;
  const bytes = await readBytes(file);
  await openBytes(bytes, file.name || 'document.pdf');
}

async function openFromDrive() {
  try {
    const got = await drive.pickFromDrive();
    if (got) await openBytes(got.bytes, got.name);
  } catch (e) { toast(e.message, 'error'); }
}

async function openBytes(bytes, name) {
  if (!looksLikePdf(bytes)) { toast('That file is not a PDF. Choose a file that ends in .pdf.', 'error'); return; }
  if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';
  await renderEditor();
  try {
    let password;
    await busy('Opening ' + name, async () => {
      password = await state.viewer.open(bytes);
    });
    state.doc = { bytes, name, password };
    state.result = null; state.dirty = false;
    document.title = name + ' – Signet';
    $('#doc-name').textContent = name;
    updatePageLabel();
    state.smart?.analyze().catch((e) => { console.warn('Box scan failed', e); $('#smart-bar').hidden = true; });
  } catch (e) {
    console.error(e);
    state.doc = null;
    renderHome();
    if (!/cancel/i.test(String(e?.message || e)) && e?.name !== 'AbortException') toast(friendlyOpenError(e), 'error');
  }
}

function friendlyOpenError(e) {
  const n = e?.name || '';
  if (n === 'PasswordException') return 'This PDF needs a password to open.';
  if (n === 'InvalidPDFException') return 'This PDF is damaged or not a real PDF, so it could not be opened.';
  return 'This PDF could not be opened: ' + (e?.message || e);
}

/* ===================================================================== */
/* Editor                                                                 */
/* ===================================================================== */

async function renderEditor() {
  const { Viewer } = await import('./viewer.js');
  const { Items } = await import('./items.js');
  const { Smart } = await import('./smart.js');
  const { ReadAloud } = await import('./readaloud.js');
  const { pdfjsLib } = await import('./viewer.js');

  const container = h('div', { class: 'stage', id: 'stage' }, h('div', { class: 'pdfViewer' }));
  const undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Undo', title: 'Undo', disabled: true, onclick: () => state.items.undo() }, icon('undo'));
  const pageLabel = h('span', { class: 'page-label', id: 'page-label', 'aria-live': 'polite' });
  const top = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Close document', title: 'Close', onclick: async () => { if (await leaveEditor()) renderHome(); } }, icon('back')),
    h('div', { class: 'doc-title' }, h('span', { id: 'doc-name' }, ''), pageLabel),
    h('div', { class: 'top-actions' },
      h('button', { class: 'icon-btn', id: 'read-btn', 'aria-label': 'Read aloud', title: 'Read aloud', onclick: () => {
        if (!state.doc) return;
        if (state.reader?.bar) { state.reader.close(); return; }
        state.reader ||= new ReadAloud({ viewer: state.viewer, pdfjs: pdfjsLib, host: stageWrap });
        state.reader.open();
      } }, icon('speaker')),
      undoBtn,
      h('button', { class: 'icon-btn hide-sm', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => state.viewer.zoom(1 / 1.2) }, icon('zoomOut')),
      h('button', { class: 'icon-btn hide-sm', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => state.viewer.zoom(1.2) }, icon('zoomIn')),
      h('button', { class: 'btn btn-primary', id: 'finish-btn', onclick: finish }, 'Finish')));

  const tool = (name, label, onclick) => h('button', { class: 'tool', type: 'button', onclick }, icon(name), h('span', {}, label));
  const dock = h('nav', { class: 'dock', 'aria-label': 'Add to page' },
    tool('sign', 'Signature', () => placeSignature('signature')),
    tool('initials', 'Initials', () => placeSignature('initials')),
    tool('text', 'Text', () => placeText('')),
    tool('date', 'Date', () => placeText(today(), 'date')),
    tool('check', 'Check', () => placeMark('check')),
    tool('cross', 'X', () => placeMark('cross')),
    canRecord() ? tool('mic', 'Voice', () => placeVoiceNote()) : null);

  const bar = h('div', { class: 'smart-bar', id: 'smart-bar', hidden: true, role: 'region', 'aria-label': 'Boxes to fill' });

  const stageWrap = h('div', { class: 'stage-wrap' }, container);
  const editor = h('div', { class: 'editor' }, top, bar, stageWrap, dock);
  app.replaceChildren(editor);

  state.items = null;
  state.viewer = new Viewer(container, {
    onPassword: (wrong) => passwordDialog(wrong ? 'Wrong password' : 'Password needed', wrong ? 'That password is not right. Try again.' : 'This PDF is protected. Enter its password to open it.'),
    onOverlay: (n, ov) => { state.smart?.mount(n, ov); state.items?.mount(n, ov); },
  });
  state.items = new Items(state.viewer, {
    onChange: (items) => {
      undoBtn.disabled = !items.canUndo;
      state.dirty = true; state.result = null;
      state.smart?.refresh();
    },
    onActivate: (it) => {
      if (it.kind !== 'audio') return;
      togglePlay(it, (id) => document.querySelectorAll('.item-audio').forEach((el) => el.classList.toggle('playing', el.dataset.id === id)));
    },
  });
  state.reader?.close(); state.reader = null;
  state.smart?.destroy();
  state.smart = new Smart({ viewer: state.viewer, items: state.items, chooseSignature, bar });
  state.viewer.eventBus.on('pagechanging', updatePageLabel);
}

function updatePageLabel() {
  const l = $('#page-label');
  if (l && state.viewer?.numPages) l.textContent = `Page ${state.viewer.currentPage} of ${state.viewer.numPages}`;
}

async function leaveEditor() {
  const unsaved = state.items?.count > 0 && !state.result;
  if (unsaved && !(await confirmDialog('Leave without finishing?', 'What you added to this PDF will be lost.', 'Leave', true))) return false;
  await state.viewer?.close();
  state.smart?.destroy(); state.smart = null;
  state.reader?.close(); state.reader = null; stopPlayback();
  state.doc = null; state.result = null; state.dirty = false;
  return true;
}

function today() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

function placement() {
  const page = state.viewer.pageNearestCenter();
  const c = state.viewer.visibleCenter(page);
  return { page, ...c };
}

async function newSignature(kind) {
  const r = await createSignature(kind);
  if (!r) return null;
  const rec = { id: uid(), kind, dataUrl: r.dataUrl, w: r.w, h: r.h, created: Date.now() };
  if (r.remember) await store.put('signatures', rec);
  return rec;
}

async function chooseSignature(kind) {
  const saved = (await store.all('signatures')).filter((s) => s.kind === kind);
  if (!saved.length) return newSignature(kind);
  return openDialog({
    title: kind === 'initials' ? 'Choose initials' : 'Choose a signature',
    build: (close) => h('div', { class: 'choose' },
      ...saved.map((s) => h('button', { class: 'choose-opt', onclick: () => close(s) }, h('img', { src: s.dataUrl, alt: 'Saved ' + kind }))),
      h('button', { class: 'btn btn-wide', onclick: async () => { close(await newSignature(kind)); } }, icon('plus'), kind === 'initials' ? 'New initials' : 'New signature')),
  });
}

async function placeSignature(kind) {
  // A "Sign here" box on the page you're looking at? Sign there, fitted to the box.
  const smart = state.smart;
  if (smart?.ready) {
    const page = state.viewer.pageNearestCenter();
    const t = smart.signTargets(kind).find((x) => x.page === page && !smart.isFilled(x));
    if (t) return smart.sign(t);
  }
  const sig = await chooseSignature(kind);
  if (!sig) return;
  const { page, x, y } = placement();
  const info = state.viewer.pageInfo[page - 1];
  const maxW = kind === 'initials' ? 60 : Math.min(180, info.width * 0.35);
  const maxH = kind === 'initials' ? 30 : 48;
  const ratio = sig.h / sig.w;
  let w = maxW, hh = w * ratio;
  if (hh > maxH) { hh = maxH; w = hh / ratio; }
  state.items.add({ kind, src: sig.dataUrl, w, h: hh }, page, x, y);
  coach();
}

function placeText(text, kind = 'text') {
  const { page, x, y } = placement();
  const it = state.items.add({ kind, text, size: 11, color: '#16181d' }, page, x, y);
  // Focus right away, inside the same tap, so phones open the keyboard.
  if (!text) state.items.edit(it.id);
  coach();
}

async function placeVoiceNote() {
  const note = await recordVoiceNote();
  if (!note) return;
  const { page, x, y } = placement();
  const { url, ...audio } = note;
  state.items.add({ kind: 'audio', src: noteBadge(), w: 20, h: 20, audio: { ...audio, url } }, page, x, y);
  toast('Voice note added. Tap it to play; drag it next to what it\u2019s about.');
}

const markCache = {};
function placeMark(kind) {
  const { page, x, y } = placement();
  markCache[kind] ||= markImage(kind);
  state.items.add({ kind, src: markCache[kind], w: 14, h: 14 }, page, x, y);
  coach();
}

let coached = false;
function coach() {
  if (coached) return;
  coached = true;
  toast('Drag to move. Drag the corner dot to resize.');
}

/* ===================================================================== */
/* Finish: build, then save / share / download                           */
/* ===================================================================== */

function signedName(name) {
  const base = name.replace(/\.pdf$/i, '');
  return /signed$/i.test(base) ? base + '.pdf' : base + ' - signed.pdf';
}

async function finish() {
  if (!state.doc) return;
  document.activeElement?.blur?.();
  drive.preload();
  const hasFields = await state.viewer.hasFormFields();
  const ids = await store.all('ids');
  const nothing = state.items.count === 0 && !state.viewer.formChanged;

  await openDialog({
    title: 'Finish',
    build: (close) => {
      const nameIn = h('input', { class: 'input', value: state.result?.name || signedName(state.doc.name), 'aria-label': 'File name' });
      const lock = h('input', { type: 'checkbox', checked: true });
      const useId = h('input', { type: 'checkbox' });
      const idSel = h('select', { class: 'input' }, ...ids.map((i) => h('option', { value: i.id }, `${i.name}${i.selfSigned ? ' (personal)' : ''}`)));
      const reason = h('input', { class: 'input', placeholder: 'Optional, like "I approve this document"' });
      const idBox = h('div', { class: 'stack', hidden: true }, h('label', { class: 'field' }, h('span', {}, 'Digital ID'), idSel), h('label', { class: 'field' }, h('span', {}, 'Reason'), reason),
        h('p', { class: 'small muted' }, 'A digital ID locks the file. Any later change will show as tampering.'));
      useId.addEventListener('change', () => { idBox.hidden = !useId.checked; });

      const actions = h('div', { class: 'stack' });
      const options = h('div', { class: 'stack' },
        nothing ? h('p', { class: 'notice' }, 'You have not added anything yet. You can still save a copy.') : null,
        h('label', { class: 'field' }, h('span', {}, 'File name'), nameIn),
        hasFields ? h('label', { class: 'check' }, lock, h('span', {}, h('strong', {}, 'Lock form fields'), h('br'), h('span', { class: 'small muted' }, 'Recommended for sending. Typed answers become part of the page.'))) : null,
        ids.length
          ? h('label', { class: 'check' }, useId, h('span', {}, h('strong', {}, 'Add digital ID signature'), h('br'), h('span', { class: 'small muted' }, 'Certificate signature that proves the file was not changed.')))
          : h('button', { class: 'link small left', onclick: async () => { close(); await manageIds(); } }, 'Set up a digital ID (optional)'),
        idBox);

      const createBtn = h('button', { class: 'btn btn-primary btn-wide', onclick: async () => {
        let name = nameIn.value.trim() || signedName(state.doc.name);
        if (!/\.pdf$/i.test(name)) name += '.pdf';
        name = name.replace(/[\\/:*?"<>|]+/g, '-');
        try {
          let identity = null;
          if (useId.checked && ids.length) {
            identity = await unlockId(ids.find((i) => i.id === idSel.value));
            if (!identity) return;
          }
          const bytes = await busy('Creating your PDF', async (msg) => {
            const { buildPdf } = await import('./pdf/export.js');
            const formBytes = await state.viewer.savedFormBytes();
            const res = await buildPdf({
              bytes: formBytes || state.doc.bytes,
              password: state.doc.password,
              items: state.items.items,
              pageInfo: state.viewer.pageInfo,
              flattenForm: hasFields && lock.checked,
            });
            res.warnings.forEach((w) => toast(w));
            if (!identity) return res.bytes;
            msg('Applying digital ID signature');
            const { signPdfWithId } = await import('./pdf/certsign.js');
            return signPdfWithId(res.bytes, identity, { reason: reason.value.trim() || undefined });
          });
          state.result = { bytes, name };
          options.hidden = true; createBtn.hidden = true;
          showActions();
        } catch (e) {
          console.error(e);
          toast('Could not create the PDF: ' + (e?.message || e), 'error');
        }
      } }, icon('check'), 'Create signed PDF');

      function showActions() {
        const r = state.result;
        const size = r.bytes.length > 1048576 ? (r.bytes.length / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(r.bytes.length / 1024)) + ' KB';
        const file = () => new File([r.bytes], r.name, { type: 'application/pdf' });
        // Voice notes can also go out as their own audio files, for viewers that can't play them inside a PDF.
        const notes = state.items.items.filter((i) => i.kind === 'audio' && i.audio?.bytes);
        const noteFiles = () => notes.map((it, k) => new File([it.audio.bytes], voiceNoteName(it, k + 1), { type: it.audio.mime }));
        const shareFiles = () => { const all = [file(), ...noteFiles()]; return navigator.canShare?.({ files: all }) ? all : [file()]; };
        const canShare = !!navigator.canShare && navigator.canShare({ files: [file()] });
        const status = h('p', { class: 'small muted', 'aria-live': 'polite' });
        actions.replaceChildren(...[
          h('div', { class: 'done' }, icon('check', 'done-icon'), h('div', {}, h('strong', {}, r.name), h('br'), h('span', { class: 'small muted' }, size + ' • ready to send'))),
          h('button', { class: 'btn btn-primary btn-wide', onclick: async (e) => {
            const btn = e.currentTarget;
            if (!(await drive.isConfigured())) { status.textContent = ''; return openSettings(true); }
            btn.disabled = true; status.textContent = 'Saving to Google Drive…';
            try {
              const f = await drive.uploadPdf(r.bytes, r.name);
              for (const nf of noteFiles()) await drive.uploadPdf(new Uint8Array(await nf.arrayBuffer()), nf.name, nf.type);
              status.replaceChildren(notes.length ? `Saved to Google Drive in the "Signet PDF" folder, with ${notes.length} voice note${notes.length === 1 ? '' : 's'} as audio files. ` : 'Saved to Google Drive in the "Signet PDF" folder. ', f.webViewLink ? h('a', { href: f.webViewLink, target: '_blank', rel: 'noopener noreferrer' }, 'Open in Drive') : '');
              toast('Saved to Google Drive');
            } catch (err) { status.textContent = ''; toast(err.message, 'error'); }
            finally { btn.disabled = false; }
          } }, icon('drive'), 'Save to Google Drive'),
          canShare ? h('button', { class: 'btn btn-wide', onclick: async () => {
            try { await navigator.share({ files: shareFiles(), title: r.name }); }
            catch (err) { if (err?.name !== 'AbortError') toast('Sharing did not work here. Use Download instead.', 'error'); }
          } }, icon('share'), 'Share or send') : null,
          h('button', { class: 'btn btn-wide', onclick: () => download(r.bytes, r.name) }, icon('download'), 'Download'),
          notes.length ? h('button', { class: 'btn btn-wide', onclick: async () => {
            for (const nf of noteFiles()) { download(new Uint8Array(await nf.arrayBuffer()), nf.name, nf.type); await new Promise((res) => setTimeout(res, 400)); }
          } }, icon('note'), notes.length === 1 ? 'Download voice note as audio' : `Download ${notes.length} voice notes as audio`) : null,
          notes.length ? h('p', { class: 'small muted' }, 'Voice notes are inside the PDF too. Adobe Acrobat and Reader play them; most other viewers can\u2019t, so send the audio along if the reader may not use Adobe.') : null,
          status].filter(Boolean));
      }
      if (state.result) { options.hidden = true; createBtn.hidden = true; setTimeout(showActions); }
      return h('div', { class: 'stack' }, options, createBtn, actions);
    },
  });
}

function download(bytes, name, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ===================================================================== */
/* Digital IDs                                                            */
/* ===================================================================== */

async function unlockId(rec) {
  if (!rec) return null;
  if (state.unlockedIds.has(rec.id)) return state.unlockedIds.get(rec.id);
  const { readP12 } = await import('./pdf/certsign.js');
  for (let tries = 0; tries < 5; tries++) {
    const pw = await passwordDialog('Unlock ' + rec.name, tries ? 'That password did not work. Try again.' : 'Enter the password for this digital ID.');
    if (pw == null) return null;
    try {
      const id = await busy('Unlocking', async () => readP12(rec.p12, pw));
      state.unlockedIds.set(rec.id, id); // memory only, gone when the app closes
      return id;
    } catch (e) { if (!/password/i.test(e.message)) { toast(e.message, 'error'); return null; } }
  }
  return null;
}

async function manageIds() {
  const { readP12, createPersonalId } = await import('./pdf/certsign.js');
  await openDialog({
    title: 'Digital IDs',
    build: (close) => {
      const list = h('div', { class: 'stack' });
      const render = async () => {
        const ids = await store.all('ids');
        list.replaceChildren(...(ids.length ? ids.map((i) => h('div', { class: 'id-row' },
          icon('seal'),
          h('div', { class: 'grow' }, h('strong', {}, i.name), h('br'),
            h('span', { class: 'small muted' }, (i.selfSigned ? 'Personal ID' : 'Issued by ' + i.issuer) + ' • valid until ' + new Date(i.notAfter).toLocaleDateString())),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Download backup', title: 'Download backup (.p12)', onclick: () => download(i.p12, i.name.replace(/[^\w.-]+/g, '_') + '.p12') }, icon('download')),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Delete', title: 'Delete', onclick: async () => {
            if (await confirmDialog('Delete ' + i.name + '?', 'This removes the digital ID from this device. Keep a backup if you may need it again.', 'Delete', true)) { await store.del('ids', i.id); state.unlockedIds.delete(i.id); render(); }
          } }, icon('trash'))))
          : [h('p', { class: 'muted' }, 'No digital IDs yet.')]));
      };
      render();

      const fileIn = h('input', { type: 'file', accept: '.p12,.pfx,application/x-pkcs12', class: 'visually-hidden', id: 'p12-file' });
      fileIn.addEventListener('change', async () => {
        const f = fileIn.files?.[0]; fileIn.value = '';
        if (!f) return;
        const bytes = await readBytes(f);
        const pw = await passwordDialog('Import digital ID', 'Enter the password for ' + f.name + '. It is only used to check the file and is never saved.');
        if (pw == null) return;
        try {
          const id = readP12(bytes, pw);
          await store.put('ids', { id: uid(), name: id.name, email: id.email, issuer: id.issuer, selfSigned: id.selfSigned, notAfter: id.notAfter.getTime(), p12: bytes, created: Date.now() });
          toast('Digital ID added');
          render();
        } catch (e) { toast(e.message, 'error'); }
      });

      return h('div', { class: 'stack' },
        h('p', { class: 'muted' }, 'A digital ID adds a certificate signature that proves who signed and that nothing changed afterward. Most everyday paperwork only needs your drawn signature.'),
        list,
        h('div', { class: 'row wrap' },
          h('label', { for: 'p12-file', class: 'btn' }, icon('upload'), 'Import .p12 / .pfx'), fileIn,
          h('button', { class: 'btn', onclick: async () => { if (await createIdFlow(createPersonalId)) render(); } }, icon('plus'), 'Create personal ID')),
        h('details', { class: 'small' }, h('summary', {}, 'Which one do I need?'),
          h('p', { class: 'muted' }, 'A personal ID is free and works right away. Recipients will see a valid signature from you, though Adobe may label the identity as "not verified" because no company vouched for it.'),
          h('p', { class: 'muted' }, 'If a workplace or agency requires a trusted certificate, they or a certificate company will give you a .p12 or .pfx file. Import it here.')));
    },
  });
}

async function createIdFlow(createPersonalId) {
  const vals = await openDialog({
    title: 'Create personal ID',
    build: (close) => {
      const name = h('input', { class: 'input', autocomplete: 'name', required: true });
      const email = h('input', { class: 'input', type: 'email', autocomplete: 'email' });
      const pw1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
      const pw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true });
      return h('form', { class: 'stack', onsubmit: (e) => {
        e.preventDefault();
        if (pw1.value.length < 8) return toast('Use at least 8 characters for the password.', 'error');
        if (pw1.value !== pw2.value) return toast('The passwords do not match.', 'error');
        close({ name: name.value.trim(), email: email.value.trim(), password: pw1.value });
      } },
        h('label', { class: 'field' }, h('span', {}, 'Full name, as it should appear'), name),
        h('label', { class: 'field' }, h('span', {}, 'Email (optional)'), email),
        h('label', { class: 'field' }, h('span', {}, 'Password to protect it'), pw1),
        h('label', { class: 'field' }, h('span', {}, 'Same password again'), pw2),
        h('p', { class: 'small muted' }, 'Write this password down. Nobody can recover it, including us.'),
        h('div', { class: 'row-end' }, h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { type: 'submit', class: 'btn btn-primary' }, 'Create ID')));
    },
  });
  if (!vals) return false;
  try {
    const p12 = await busy('Creating your digital ID', () => createPersonalId(vals));
    const { readP12 } = await import('./pdf/certsign.js');
    const id = readP12(p12, vals.password);
    await store.put('ids', { id: uid(), name: id.name, email: id.email, issuer: id.issuer, selfSigned: true, notAfter: id.notAfter.getTime(), p12, created: Date.now() });
    toast('Digital ID created. Download a backup from the list to keep it safe.');
    return true;
  } catch (e) { toast('Could not create the ID: ' + e.message, 'error'); return false; }
}

/* ===================================================================== */
/* Settings                                                               */
/* ===================================================================== */

async function openSettings(fromSave = false) {
  const cfg = await drive.getConfig();
  await openDialog({
    title: fromSave === true ? 'Connect Google Drive' : 'Settings',
    build: (close) => {
      const clientId = h('input', { class: 'input', value: cfg.clientId, placeholder: '1234-abc.apps.googleusercontent.com', autocomplete: 'off', spellcheck: 'false' });
      const apiKey = h('input', { class: 'input', value: cfg.apiKey, autocomplete: 'off', spellcheck: 'false' });
      const appId = h('input', { class: 'input', value: cfg.appId, inputmode: 'numeric', autocomplete: 'off' });
      return h('div', { class: 'stack' },
        h('h3', {}, 'Google Drive'),
        h('p', { class: 'small muted' }, 'Drive saving uses your own free Google Cloud project, so no one else is in the middle. Setup takes about 10 minutes and is explained step by step in the SETUP guide that came with the app.'),
        h('label', { class: 'field' }, h('span', {}, 'OAuth Client ID (needed to save to Drive)'), clientId),
        h('details', {}, h('summary', { class: 'small' }, 'Optional: open files from Drive'),
          h('div', { class: 'stack' },
            h('label', { class: 'field' }, h('span', {}, 'API key'), apiKey),
            h('label', { class: 'field' }, h('span', {}, 'Project number'), appId))),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn btn-primary', onclick: async () => {
            await drive.setConfig({ clientId: clientId.value.trim(), apiKey: apiKey.value.trim(), appId: appId.value.trim() });
            if (fromSave === true) { drive.preload(); toast('Saved. Tap Save to Google Drive again.'); } else toast('Saved');
            close();
            if (!state.doc) renderHome();
          } }, 'Save'),
          drive.connected() ? h('button', { class: 'btn', onclick: () => { drive.signOut(); toast('Signed out of Google'); close(); } }, 'Sign out of Google') : null),
        fromSave === true ? null : h('hr'),
        fromSave === true ? null : h('h3', {}, 'This device'),
        fromSave === true ? null : h('p', { class: 'small muted' }, 'Remove saved signatures, My info, digital IDs and settings from this browser.'),
        fromSave === true ? null : h('button', { class: 'btn btn-danger', onclick: async () => {
          if (!(await confirmDialog('Erase everything?', 'Saved signatures, My info, digital IDs and settings will be deleted from this device. This cannot be undone.', 'Erase', true))) return;
          drive.signOut(); state.unlockedIds.clear(); lockProfile();
          await store.wipe();
          toast('Everything was erased from this device');
          close(); renderHome();
        } }, icon('trash'), 'Erase everything'),
        h('p', { class: 'small muted' }, 'Signet PDF ' + __APP_VERSION__ + ' • open source (MIT)'));
    },
  });
}

/* ===================================================================== */
/* Startup                                                                */
/* ===================================================================== */

window.addEventListener('beforeunload', (e) => {
  if (state.items?.count > 0 && !state.result) { e.preventDefault(); e.returnValue = ''; }
});

/* A one-time tip: you can fill boxes by speaking, using your device's own dictation. */
function voiceTypingTip() {
  const ua = navigator.userAgent;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch) return 'Tip: tap the microphone on your keyboard to fill this in by speaking.';
  if (/Windows/.test(ua)) return 'Tip: press the Windows key + H to fill this in by speaking.';
  if (/Macintosh/.test(ua)) return 'Tip: press the Globe (fn) key twice to fill this in by speaking.';
  return null;
}
document.addEventListener('focusin', (e) => {
  const el = e.target;
  const isBox = el.matches?.('.annotationLayer input[type="text"], .annotationLayer textarea, .item .txt');
  if (!isBox) return;
  let seen = false;
  try { seen = localStorage.getItem('signet.tip.voiceTyping') === '1'; } catch {}
  if (seen) return;
  const tip = voiceTypingTip();
  if (!tip) return;
  try { localStorage.setItem('signet.tip.voiceTyping', '1'); } catch {}
  setTimeout(() => toast(tip), 700); // after the keyboard opens
});

async function start() {
  await renderHome();
  // Opened from the share menu (Android) - the service worker hands us the file.
  const params = new URLSearchParams(location.search);
  if (params.has('shared')) {
    history.replaceState(null, '', location.pathname);
    try {
      const cache = await caches.open('signet-share');
      const res = await cache.match('shared-file');
      if (res) {
        const name = decodeURIComponent(res.headers.get('X-File-Name') || 'shared.pdf');
        const bytes = new Uint8Array(await res.arrayBuffer());
        await cache.delete('shared-file');
        await openBytes(bytes, name);
      } else toast('No PDF was received from the share menu.', 'error');
    } catch (e) { toast('Could not open the shared file.', 'error'); }
  }
  // Opened by double-clicking a PDF (installed desktop app).
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      const handle = params.files?.[0];
      if (handle) openFile(await handle.getFile());
    });
  }
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  }
}

start();

// Exposed for automated tests only.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('test')) {
  window.__signet = { state, openBytes, store };
}
