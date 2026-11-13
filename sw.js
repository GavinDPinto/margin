// Margin offline cache. Bump VERSION when you update the app files.
const VERSION = 'margin-v2';
const SHARE = 'margin-share';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './lib/pdf.min.mjs', './lib/pdf.worker.min.mjs'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
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
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(receiveShare(e.request)); return; }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Serve from cache instantly, refresh the cache in the background.
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r && r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('Offline', { status: 503 });
  }));
});
