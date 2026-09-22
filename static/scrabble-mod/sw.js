/* Scrabble Mod service worker: keeps the page, the scripts and the word lists
   on the device so the game opens instantly and works offline against the bot
   and pass-and-play. Cached first, refreshed in the background, so a new
   version shows up on the next open. Online play and sign-in go to other
   origins and are never cached. */
const CACHE = 'scrabble-mod-v1';
const SHELL = ['/scrabble-mod/', '/scrabble-mod/core.js', '/scrabble-mod/app.js', '/scrabble-mod/words.txt',
  '/scrabble-mod/common.txt', '/scrabble-mod/manifest.webmanifest', '/scrabble-mod/icon-192.png', '/scrabble-mod/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/scrabble-mod/')) return;
  // every game address (/scrabble-mod/otter-slate-plum, or ?g=...) is the one page
  const key = e.request.mode === 'navigate' ? '/scrabble-mod/' : url.pathname;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const cached = await c.match(key);
    const fresh = fetch(e.request).then((r) => { if (r && r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
    if (cached) { fresh.catch(() => {}); return cached; }
    const r = await fresh;
    return r || new Response('Offline', { status: 503, statusText: 'Offline' });
  }));
});
