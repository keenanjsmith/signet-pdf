// Local-only storage (IndexedDB). Nothing here is ever sent anywhere.
const DB_NAME = 'signet';
const DB_VERSION = 1;
let dbPromise;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('signatures')) d.createObjectStore('signatures', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('ids')) d.createObjectStore('ids', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const store = {
  async all(name) {
    const d = await db();
    const items = await reqP(d.transaction(name).objectStore(name).getAll());
    return items.sort((a, b) => (a.created || 0) - (b.created || 0));
  },
  put(name, value) { return tx(name, 'readwrite', (s) => { s.put(value); }); },
  del(name, id) { return tx(name, 'readwrite', (s) => { s.delete(id); }); },
  async get(key) {
    const d = await db();
    return reqP(d.transaction('kv').objectStore('kv').get(key));
  },
  set(key, value) { return tx('kv', 'readwrite', (s) => { s.put(value, key); }); },
  async wipe() {
    const d = await db();
    d.close();
    dbPromise = null;
    await new Promise((res) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  },
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
