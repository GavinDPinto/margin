// Margin service worker. Bump VERSION when you update the app files.
const VERSION = 'margin-v7';
const SHARE = 'margin-share';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './lib/pdf.min.mjs', './lib/pdf.worker.min.mjs'];

self.addEventListener('install', e => {
  // cache:'reload' skips the browser's HTTP cache so a new version is always fetched fresh
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== SHARE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Share sheet target (Android / desktop Chrome; iOS doesn't support this yet).
async function receiveShare(req) {
  const fd = await req.formData();
  const files = fd.getAll('file').filter(f => f && typeof f !== 'string');
  const c = await caches.open(SHARE);
  for (const k of await c.keys()) await c.delete(k);
  let i = 0;
  for (const f of files) await c.put(new URL('shared/' + (i++), self.registration.scope).href, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'Shared file') } }));
  return Response.redirect(new URL('./?shared=' + i, self.registration.scope).href, 303);
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  if (isPage) {
    // App page: always try the network first so updates show up straight away; fall back to the saved copy offline.
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const r = await fetch(req, { cache: 'no-store' });
        if (r && r.ok) { cache.put('./index.html', r.clone()); return r; }
      } catch (err) {}
      return (await cache.match('./index.html')) || (await cache.match('./')) || new Response('Offline', { status: 503 });
    })());
    return;
  }
  // Everything else (PDF reader, icons): saved copy first, refreshed in the background.
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('Offline', { status: 503 });
  }));
});
