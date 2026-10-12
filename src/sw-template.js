// Signet PDF service worker: offline support and the Android share menu.
// It never sends anything anywhere; it only serves the app's own files.
const VERSION = '__VERSION__';
const CACHE = 'signet-app-' + VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('signet-app-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // A PDF shared to the app from another app (Android share menu).
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.getAll('file').find((f) => f && typeof f !== 'string');
        if (file) {
          const cache = await caches.open('signet-share');
          await cache.put('shared-file', new Response(file, { headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name || 'shared.pdf') } }));
        }
      } catch {}
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET' || url.origin !== location.origin) return; // Google traffic is never touched

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.match('./', { ignoreSearch: true })) || (await caches.match(new URL('./', self.registration.scope).href, { ignoreSearch: true }))));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok && (url.pathname.includes('/pdfjs/') || url.pathname.includes('/assets/'))) {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  })());
});
