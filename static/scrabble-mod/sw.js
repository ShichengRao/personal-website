/* Scrabble Mod service worker: keeps the page, the scripts and the word lists
   on the device so the game opens instantly and works offline against the bot
   and pass-and-play. Cached first, refreshed in the background, so a new
   version shows up on the next open. Online play and sign-in requests go to
   Supabase and are never cached; the Supabase browser library is, so a
   cached online game can still be shown offline. */
const CACHE = 'scrabble-mod-v3';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
const SHELL = ['/scrabble-mod/', '/scrabble-mod/core.js', '/scrabble-mod/app.js', '/scrabble-mod/words.txt',
  '/scrabble-mod/common.txt', '/scrabble-mod/manifest.webmanifest', '/scrabble-mod/icon-192.png', '/scrabble-mod/icon-512.png',
  '/scrabble-mod/icon-180.png', '/scrabble-mod/icon-maskable-512.png', SUPABASE_JS];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { mode: u.startsWith('http') ? 'cors' : 'same-origin' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const ours = url.origin === location.origin && url.pathname.startsWith('/scrabble-mod/');
  if (e.request.method !== 'GET' || (!ours && e.request.url !== SUPABASE_JS)) return;
  // every game or profile address (/scrabble-mod/otter-slate-plum, /scrabble-mod/u/CODE, ?g=...) is the one
  // page; a real file under the folder (words.txt, index.xml, the scripts) is itself
  const pageLike = e.request.mode === 'navigate' && !/\.[a-z0-9]+$/i.test(url.pathname);
  const key = !ours ? e.request.url : pageLike ? '/scrabble-mod/' : url.pathname;
  const req = ours ? e.request : new Request(e.request.url, { mode: 'cors' });   // a CORS response can be checked and refreshed; an opaque one cannot
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const cached = await c.match(key);
    const fresh = fetch(req).then((r) => { if (r && r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
    if (cached) { fresh.catch(() => {}); return cached; }
    const r = await fresh;
    return r || new Response('Offline', { status: 503, statusText: 'Offline' });
  }));
});
