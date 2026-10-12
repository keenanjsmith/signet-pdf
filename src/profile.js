// "My info": your details for filling in forms. Stored only on this device.
//  - Everyday details (name, contact, address) are saved like browser autofill.
//  - Private details (SSN, date of birth, VA file and service numbers) are
//    encrypted with a passcode you choose (AES-256-GCM, key from PBKDF2-SHA256
//    with 600,000 rounds). The passcode is never saved. Unlocked details live in
//    memory only and lock again after 15 minutes without use or when the app closes.
import { h, icon, openDialog, passwordDialog, confirmDialog, toast, busy } from './ui.js';
import { store } from './store.js';
import { PROFILE_FIELDS, PRIVATE_KEYS } from './fields/match.js';

const ROUNDS = 600_000;
const LOCK_AFTER_MS = 15 * 60 * 1000;
const enc = new TextEncoder(), dec = new TextDecoder();

let unlocked = null;   // private details while unlocked
let session = null;    // { key, salt } while unlocked, so changes can be saved without asking again
let lockTimer = null;
const listeners = new Set();
export const onProfileChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((fn) => { try { fn(); } catch {} });

function touch() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lock, LOCK_AFTER_MS);
}
export function lock() { unlocked = null; session = null; clearTimeout(lockTimer); changed(); }
export const isUnlocked = () => !!unlocked;

async function deriveKey(passcode, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ROUNDS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function seal(data, passcode, existing = null) {
  const salt = existing?.salt || crypto.getRandomValues(new Uint8Array(16));
  const key = existing?.key || await deriveKey(passcode, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data))));
  session = { key, salt };
  return { v: 1, salt, iv, ct };
}

async function open(vault, passcode) {
  const key = await deriveKey(passcode, vault.salt);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: vault.iv }, key, vault.ct);
    session = { key, salt: vault.salt };
    return JSON.parse(dec.decode(pt));
  } catch { return null; }
}

/** Saved profile record (everyday details plus the locked vault). */
export async function getRecord() {
  return (await store.get('profile')) || null;
}

/** Your details for filling, including private ones if unlocked. */
export async function getProfile() {
  const rec = await getRecord();
  if (!rec) return null;
  const p = { ...rec.basic, privateKeys: rec.privateKeys || [], autoFill: rec.autoFill !== false };
  if (unlocked) { Object.assign(p, unlocked); touch(); }
  return p;
}

export const hasProfile = async () => {
  const r = await getRecord();
  return !!r && Object.values(r.basic || {}).some((v) => String(v || '').trim());
};

/** Ask for the passcode and unlock private details. Returns true when unlocked. */
export async function unlock(reason = 'Enter your passcode to use your private details.') {
  if (unlocked) return true;
  const rec = await getRecord();
  if (!rec?.vault) return false;
  for (let tries = 0; tries < 5; tries++) {
    const pass = await passwordDialog('Unlock private details', tries ? 'That passcode did not work. Try again.' : reason, 'Passcode');
    if (pass == null) return false;
    const data = await busy('Unlocking', () => open(rec.vault, pass));
    if (data) { unlocked = data; touch(); changed(); return true; }
  }
  toast('Too many tries. Close this and try again later.', 'error');
  return false;
}

/* ---------------- editor ---------------- */

const US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP AA AE AP'.split(' ');

export async function editProfile() {
  const rec = (await getRecord()) || { basic: { country: 'United States' }, autoFill: true, privateKeys: [], vault: null };
  let vaultOpen = unlocked ? { ...unlocked } : null;
  return openDialog({
    title: 'My info',
    wide: true,
    build: (close) => {
      const inputs = {};
      const field = (f, value) => {
        const attrs = { class: 'input', type: f.type || 'text', autocomplete: f.autocomplete || 'off', value: value || '', name: f.key, id: 'pf-' + f.key, spellcheck: 'false' };
        if (f.key === 'state') attrs.list = 'pf-states';
        if (f.key === 'ssn' || f.key === 'vaFile' || f.key === 'serviceNumber') { attrs.inputmode = 'numeric'; attrs.autocomplete = 'off'; }
        if (f.key === 'zip') attrs.inputmode = 'numeric';
        const input = h('input', attrs);
        inputs[f.key] = input;
        return h('label', { class: 'field' + (f.key === 'street' ? ' span2' : '') }, h('span', {}, f.label), input);
      };
      const group = (g) => PROFILE_FIELDS.filter((f) => f.group === g).map((f) => field(f, rec.basic?.[f.key]));

      const auto = h('input', { type: 'checkbox', checked: rec.autoFill !== false });
      const privBox = h('div', { class: 'stack' });

      const renderPrivate = () => {
        if (rec.vault && !vaultOpen) {
          privBox.replaceChildren(
            h('div', { class: 'locked-row' }, icon('lock'),
              h('div', { class: 'grow' }, h('strong', {}, 'Locked'), h('br'), h('span', { class: 'small muted' }, `${(rec.privateKeys || []).length} private detail${(rec.privateKeys || []).length === 1 ? '' : 's'} saved`)),
              h('button', { class: 'btn', type: 'button', onclick: async () => { if (await unlock('Enter your passcode to view or change your private details.')) { vaultOpen = { ...unlocked }; renderPrivate(); } } }, 'Unlock')));
          return;
        }
        if (!rec.vault && !vaultOpen) {
          privBox.replaceChildren(
            h('p', { class: 'small muted' }, 'Social Security number, date of birth, VA file number and service number. These are encrypted with a passcode only you know, and Signet asks for it before using them.'),
            h('button', { class: 'btn', type: 'button', onclick: () => { vaultOpen = {}; renderPrivate(); } }, icon('plus'), 'Add private details'));
          return;
        }
        const pf = PROFILE_FIELDS.filter((f) => f.private);
        const pass1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', id: 'pf-pass1' });
        const pass2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', id: 'pf-pass2' });
        privBox.replaceChildren(
          h('div', { class: 'grid2' }, ...pf.map((f) => field(f, vaultOpen[f.key]))),
          rec.vault
            ? h('p', { class: 'small muted' }, 'Leave the passcode boxes empty to keep your current passcode.')
            : h('p', { class: 'small muted' }, 'Choose a passcode of at least 8 characters. Write it down; nobody can recover it.'),
          h('div', { class: 'grid2' },
            h('label', { class: 'field' }, h('span', {}, rec.vault ? 'New passcode (optional)' : 'Passcode'), pass1),
            h('label', { class: 'field' }, h('span', {}, 'Same passcode again'), pass2)),
          rec.vault ? h('button', { class: 'link small left', type: 'button', onclick: async () => {
            if (!(await confirmDialog('Remove private details?', 'Your saved SSN, date of birth and ID numbers will be deleted from this device.', 'Remove', true))) return;
            rec.vault = null; rec.privateKeys = []; vaultOpen = null; unlocked = null; session = null;
            await store.set('profile', rec); changed(); renderPrivate(); toast('Private details removed');
          } }, 'Remove private details') : null);
      };
      renderPrivate();

      const save = async () => {
        const basic = {};
        for (const f of PROFILE_FIELDS) if (!f.private) basic[f.key] = (inputs[f.key]?.value || '').trim();
        if (basic.state) basic.state = basic.state.length === 2 ? basic.state.toUpperCase() : basic.state;
        const next = { ...rec, basic, autoFill: auto.checked, updated: Date.now() };
        if (vaultOpen) {
          const priv = {};
          for (const f of PROFILE_FIELDS) if (f.private) { const v = (inputs[f.key]?.value || '').trim(); if (v) priv[f.key] = v; }
          if (priv.ssn && priv.ssn.replace(/\D/g, '').length !== 9) return toast('A Social Security number has 9 digits.', 'error');
          const p1 = document.getElementById('pf-pass1')?.value || '', p2 = document.getElementById('pf-pass2')?.value || '';
          let passcode = null;
          if (p1 || p2 || !rec.vault) {
            if (Object.keys(priv).length && p1.length < 8) return toast('Use a passcode of at least 8 characters.', 'error');
            if (p1 !== p2) return toast('The passcodes do not match.', 'error');
            passcode = p1;
          }
          if (Object.keys(priv).length) {
            let keep = null;
            if (!passcode) {
              keep = session;
              if (!keep) {
                const again = await passwordDialog('Confirm passcode', 'Enter your current passcode to save the changes.', 'Passcode');
                if (again == null) return;
                if (!(await open(rec.vault, again))) return toast('That passcode is not right.', 'error');
                keep = session;
              }
            }
            next.vault = await busy('Encrypting', () => seal(priv, passcode, keep));
            next.privateKeys = Object.keys(priv);
            unlocked = priv; touch();
          } else { next.vault = null; next.privateKeys = []; unlocked = null; session = null; }
        }
        await store.set('profile', next);
        changed();
        toast('My info saved');
        close(true);
      };

      return h('div', { class: 'stack profile' },
        h('p', { class: 'muted' }, 'Signet uses this to fill in forms for you. It stays on this device and is never uploaded.'),
        h('h3', {}, 'Name'), h('div', { class: 'grid2' }, ...group('name')),
        h('h3', {}, 'Contact'), h('div', { class: 'grid2' }, ...group('contact')),
        h('h3', {}, 'Address'), h('div', { class: 'grid2' }, ...group('address')),
        h('datalist', { id: 'pf-states' }, ...US_STATES.map((s) => h('option', { value: s }))),
        h('h3', {}, 'Private details'), privBox,
        h('label', { class: 'check' }, auto, h('span', {}, h('strong', {}, 'Fill in forms automatically'), h('br'), h('span', { class: 'small muted' }, 'When you open a form, matching boxes are filled and highlighted for you to check.'))),
        h('div', { class: 'row-end' },
          h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Save')));
    },
  });
}

export { PRIVATE_KEYS };
