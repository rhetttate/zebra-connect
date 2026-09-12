// Service worker for the static site — served as a template; tools/build-site.mjs
// fills in the version and the file list. On the Node server nothing registers it.
const CACHE = 'zc-__VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Same-origin GETs come from the cache first; the API host and anything else
// go straight to the network. Labels live in IndexedDB, never here.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(event.request);
    if (res.ok) (await caches.open(CACHE)).put(event.request, res.clone());
    return res;
  })());
});
