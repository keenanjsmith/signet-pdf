// Voice notes: record a short spoken comment and pin it to the page.
// Recording happens on this device; the clip only leaves it when you save,
// share or send the PDF.
import { h, icon, openDialog, toast } from './ui.js';
import fixWebmDuration from 'fix-webm-duration';

const MAX_SECONDS = 5 * 60;
// AAC in .m4a plays almost everywhere, so it comes first; then the formats each browser does best.
const TYPES = [
  ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'm4a'],
  ['audio/webm;codecs=opus', 'audio/webm', 'webm'],
  ['audio/mp4', 'audio/mp4', 'm4a'],
  ['audio/webm', 'audio/webm', 'webm'],
  ['audio/ogg;codecs=opus', 'audio/ogg', 'ogg'],
];

export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder);

function pickType() {
  for (const [rec, mime, ext] of TYPES) {
    try { if (MediaRecorder.isTypeSupported(rec)) return { rec, mime, ext }; } catch {}
  }
  return { rec: '', mime: 'audio/webm', ext: 'webm' };
}

export const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The speaker badge drawn on the page where a voice note is pinned. */
let badgeCache = null;
export function noteBadge() {
  if (badgeCache) return badgeCache;
  const s = 128, c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b3a9e';
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(s * 0.16, s * 0.16); ctx.scale((s * 0.68) / 24, (s * 0.68) / 24);
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.fill(new Path2D('M4 9.5h3.5L12 5.5v13l-4.5-4H4z'));
  ctx.stroke(new Path2D('M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11'));
  ctx.restore();
  return (badgeCache = c.toDataURL('image/png'));
}

/**
 * Record a voice note. Resolves with { bytes, mime, ext, duration } or undefined.
 */
export function recordVoiceNote() {
  if (!canRecord()) { toast('This browser can’t record audio. Try Chrome, Edge or Safari.', 'error'); return Promise.resolve(); }
  return openDialog({
    title: 'Record a voice note',
    className: 'vn-dlg',
    build: (close, dlg) => {
      let stream = null, rec = null, chunks = [], started = 0, timer = null, result = null, url = null;
      const type = pickType();
      const time = h('div', { class: 'vn-time', 'aria-live': 'polite' }, '0:00');
      const status = h('p', { class: 'muted small vn-status' }, 'Tap the microphone and speak. Up to 5 minutes.');
      const meter = h('div', { class: 'vn-meter', 'aria-hidden': 'true' }, h('i'));
      const player = h('div', { class: 'vn-player' });
      const micBtn = h('button', { class: 'vn-mic', type: 'button', 'aria-label': 'Start recording' }, icon('mic'));
      const addBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Add to page');
      let raf = 0;

      const cleanup = () => {
        clearInterval(timer); cancelAnimationFrame(raf);
        stream?.getTracks().forEach((t) => t.stop()); stream = null;
      };
      const finish = (value) => { cleanup(); if (url && !value) URL.revokeObjectURL(url); close(value); };

      const start = async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch (e) {
          status.textContent = e?.name === 'NotAllowedError'
            ? 'Signet needs permission to use your microphone. Allow it in your browser’s site settings, then try again.'
            : 'No microphone was found. Plug one in or check your sound settings, then try again.';
          status.classList.add('error-text');
          return;
        }
        chunks = []; result = null; player.replaceChildren(); addBtn.disabled = true;
        rec = new MediaRecorder(stream, type.rec ? { mimeType: type.rec, audioBitsPerSecond: 64000 } : undefined);
        rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
        rec.onstop = async () => {
          cleanup();
          const duration = (performance.now() - started) / 1000;
          let blob = new Blob(chunks, { type: type.mime });
          // Browsers leave the length out of WebM recordings; add it so players can show and skip through it.
          if (type.mime === 'audio/webm' && blob.size) { try { blob = await fixWebmDuration(blob, duration * 1000, { logger: false }); } catch {} }
          if (!blob.size) { status.textContent = 'Nothing was recorded. Try again.'; return; }
          result = { bytes: new Uint8Array(await blob.arrayBuffer()), mime: type.mime, ext: type.ext, duration };
          url = URL.createObjectURL(blob);
          player.replaceChildren(h('audio', { controls: true, src: url, preload: 'metadata' }));
          status.textContent = 'Listen back, then add it to the page, or record again.';
          micBtn.classList.remove('rec'); micBtn.setAttribute('aria-label', 'Record again');
          micBtn.replaceChildren(icon('mic'));
          addBtn.disabled = false;
        };
        rec.start(1000);
        started = performance.now();
        micBtn.classList.add('rec'); micBtn.setAttribute('aria-label', 'Stop recording');
        micBtn.replaceChildren(icon('stop'));
        status.classList.remove('error-text');
        status.textContent = 'Recording… tap to stop.';
        timer = setInterval(() => {
          const s = (performance.now() - started) / 1000;
          time.textContent = formatTime(s);
          if (s >= MAX_SECONDS) rec.state === 'recording' && rec.stop();
        }, 250);
        // A simple level meter so you can see the microphone is hearing you.
        try {
          const ac = new AudioContext();
          ac.resume?.();
          const an = ac.createAnalyser(); an.fftSize = 512;
          ac.createMediaStreamSource(stream).connect(an);
          const data = new Uint8Array(an.fftSize);
          const bar = meter.firstChild;
          const tick = () => {
            if (!stream) { ac.close(); bar.style.transform = 'scaleX(0)'; return; }
            an.getByteTimeDomainData(data);
            let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
            bar.style.transform = `scaleX(${Math.min(1, peak / 64)})`;
            raf = requestAnimationFrame(tick);
          };
          tick();
        } catch {}
      };

      // However the window closes, let go of the microphone.
      dlg.addEventListener('close', () => { if (rec?.state === 'recording') { rec.onstop = null; rec.stop(); } cleanup(); });
      micBtn.addEventListener('click', () => { if (rec?.state === 'recording') rec.stop(); else start(); });
      addBtn.addEventListener('click', () => { if (result) finish({ ...result, url }); });

      return h('div', { class: 'stack vn' },
        h('div', { class: 'vn-row' }, micBtn, h('div', { class: 'grow' }, time, meter)),
        status, player,
        h('p', { class: 'small muted' }, 'The note is saved inside the PDF. Adobe Acrobat and Reader can play it; many other viewers can’t, so when you finish you can also send it as its own audio file.'),
        h('div', { class: 'row-end' },
          h('button', { class: 'btn', type: 'button', onclick: () => { if (rec?.state === 'recording') { rec.onstop = null; rec.stop(); } finish(); } }, 'Cancel'),
          addBtn));
    },
  });
}

/* ---------------- playback of notes on the page ---------------- */

let audioEl = null, playingId = null;
export function togglePlay(item, onState) {
  if (!audioEl) audioEl = new Audio();
  if (playingId === item.id && !audioEl.paused) { audioEl.pause(); playingId = null; onState?.(null); return; }
  if (!item.audio.url) item.audio.url = URL.createObjectURL(new Blob([item.audio.bytes], { type: item.audio.mime }));
  audioEl.src = item.audio.url;
  audioEl.onended = () => { playingId = null; onState?.(null); };
  audioEl.play().then(() => { playingId = item.id; onState?.(item.id); }).catch(() => toast('This voice note can’t be played in this browser.', 'error'));
}
export function stopPlayback() { if (audioEl) audioEl.pause(); playingId = null; }
