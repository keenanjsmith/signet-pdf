// Google Drive: save finished PDFs and (optionally) open PDFs from Drive.
// Uses the narrow "drive.file" permission: the app can only see files it created
// or that you pick yourself. Nothing loads from Google until you use a Drive feature.
// Your sign-in token is kept in memory only and forgotten when the app closes.
import { store } from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Signet PDF';

let token = null; // { access_token, expires_at }
let tokenClient = null;
let tokenClientId = null;

export async function getConfig() {
  const saved = (await store.get('googleConfig')) || {};
  return {
    clientId: saved.clientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    apiKey: saved.apiKey || import.meta.env.VITE_GOOGLE_API_KEY || '',
    appId: saved.appId || import.meta.env.VITE_GOOGLE_APP_ID || '',
  };
}

export async function setConfig(cfg) {
  await store.set('googleConfig', cfg);
  token = null; tokenClient = null; tokenClientId = null;
}

export async function isConfigured() { return !!(await getConfig()).clientId; }
export async function pickerAvailable() { const c = await getConfig(); return !!(c.clientId && c.apiKey && c.appId); }
export const connected = () => !!token && token.expires_at > Date.now() + 60_000;

const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new Error('Could not reach Google. Check your internet connection.')); };
      document.head.append(s);
    });
  }
  return scripts[src];
}

/**
 * If you have set up Drive, fetch Google's sign-in script ahead of time (on the
 * Finish screen), so the sign-in window can open the moment you tap Save.
 * Browsers block pop-up windows that open too long after a tap.
 */
export async function preload() {
  if (!(await isConfigured()) || connected()) return;
  loadScript('https://accounts.google.com/gsi/client').catch(() => {});
}

/** Get an access token, asking you to sign in if needed. Call from a tap/click. */
export async function signIn() {
  if (connected()) return token.access_token;
  const { clientId } = await getConfig();
  if (!clientId) throw new Error('Google Drive is not set up yet. Add your Google Client ID in Settings.');
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    if (!tokenClient || tokenClientId !== clientId) {
      tokenClientId = clientId;
      tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: () => {} });
    }
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in failed: ' + resp.error));
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) return reject(new Error('Drive access was not allowed. Tick the Drive box when Google asks.'));
      token = { access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
      resolve(token.access_token);
    };
    tokenClient.error_callback = (err) => {
      const t = err?.type;
      reject(new Error(t === 'popup_closed' ? 'Google sign-in was closed before finishing.' : t === 'popup_failed_to_open' ? 'Your browser blocked the Google sign-in window. Allow pop-ups for this app and try again.' : 'Google sign-in failed.'));
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export function signOut() {
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {});
  token = null;
}

async function api(url, opts = {}, retry = true) {
  const at = await signIn();
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + at } });
  if (res.status === 401 && retry) { token = null; return api(url, opts, false); }
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    throw new Error('Google Drive said: ' + msg);
  }
  return res;
}

async function folderId() {
  const cached = await store.get('driveFolderId');
  if (cached) {
    try {
      const r = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cached)}?fields=id,trashed`);
      const j = await r.json();
      if (!j.trashed) return cached;
    } catch {}
  }
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)).json();
  let id = found.files?.[0]?.id;
  if (!id) {
    const created = await (await api('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    })).json();
    id = created.id;
  }
  await store.set('driveFolderId', id);
  return id;
}

/** Upload a PDF into the "Signet PDF" folder. Returns { id, name, webViewLink }. */
export async function uploadPdf(bytes, name) {
  await signIn();
  const parent = await folderId();
  const meta = { name, mimeType: 'application/pdf', parents: [parent] };
  const boundary = 'signet' + Math.random().toString(16).slice(2);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Blob([head, bytes, tail]);
  if (bytes.length < 4.5 * 1024 * 1024) {
    const r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
    return r.json();
  }
  // Larger files: resumable upload.
  const init = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/pdf', 'X-Upload-Content-Length': String(bytes.length) },
    body: JSON.stringify(meta),
  });
  const loc = init.headers.get('Location');
  if (!loc) throw new Error('Google Drive did not accept the upload. Try again.');
  const put = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes });
  if (!put.ok) throw new Error('Upload to Google Drive failed (' + put.status + ').');
  return put.json();
}

/** Let you pick a PDF from Drive. Returns { bytes, name } or null. */
export async function pickFromDrive() {
  const cfg = await getConfig();
  const at = await signIn();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((r) => gapi.load('picker', r));
  const picked = await new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes('application/pdf').setIncludeFolders(true).setSelectFolderEnabled(false);
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(at)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setOrigin(location.origin)
      .setCallback((data) => {
        const a = data[google.picker.Response.ACTION];
        if (a === google.picker.Action.PICKED) resolve(data[google.picker.Response.DOCUMENTS][0]);
        else if (a === google.picker.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
  if (!picked) return null;
  const id = picked[google.picker.Document.ID];
  const res = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), name: picked[google.picker.Document.NAME] || 'document.pdf' };
}
