// Margin offline cache. Bump VERSION when you update the app files.
const VERSION = 'margin-v1';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './lib/pdf.min.mjs', './lib/pdf.worker.min.mjs'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Serve from cache instantly, refresh the cache in the background.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r && r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('Offline', { status: 503 });
  }));
});
