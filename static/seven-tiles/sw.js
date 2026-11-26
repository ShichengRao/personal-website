/* Seven Tiles service worker: keeps the page, the scripts and the word lists
   on the device so the game opens instantly and works offline against the bot
   and pass-and-play. Cached first, refreshed in the background; when the
   refresh brings a new version of the game, the page is told and reloads into
   it. Online play and sign-in requests go to Supabase and are never cached;
   the Supabase browser library is, so a cached online game can still be shown
   offline. */
const CACHE = 'seven-tiles-v5';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js';
const SUPABASE_SRI = 'sha384-A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ';   // the same as the page's script tag
const INTEGRITY = { [SUPABASE_JS]: SUPABASE_SRI };   // so the cache only ever holds the checked file
const SHELL = ['/seven-tiles/', '/seven-tiles/core.js', '/seven-tiles/app.js', '/seven-tiles/words.bin',
  '/seven-tiles/common.bin', '/seven-tiles/manifest.webmanifest', '/seven-tiles/icon-192.png', '/seven-tiles/icon-512.png',
  '/seven-tiles/icon-180.png', '/seven-tiles/icon-maskable-512.png', '/seven-tiles/icon.svg'];
const CODE = ['/seven-tiles/app.js', '/seven-tiles/core.js'];   // a change to either is a new version of the game
const EXTRAS = [SUPABASE_JS];   // nice to have offline; a failure here must not block installing
// The theme's stylesheet has a fingerprinted name, so it is cached on first use (see fetch) rather than here.

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(SHELL);
    await Promise.all(EXTRAS.map((u) => fetch(new Request(u, { mode: u.startsWith('http') ? 'cors' : 'same-origin', integrity: INTEGRITY[u] || '' })).then((r) => { if (r.ok) return c.put(u, r); }).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const ours = url.origin === location.origin && (url.pathname.startsWith('/seven-tiles/') || url.pathname.startsWith('/ananke/css/'));
  if (e.request.method !== 'GET' || (!ours && e.request.url !== SUPABASE_JS)) return;
  // every game or profile address (/seven-tiles/otter-slate-plum, /seven-tiles/u/CODE, ?g=...) is the one
  // page; a real file under the folder (words.bin, index.xml, the scripts) is itself
  const pageLike = e.request.mode === 'navigate' && url.pathname.startsWith('/seven-tiles/') && !/\.[a-z0-9]+$/i.test(url.pathname);
  const key = !ours ? e.request.url : pageLike ? '/seven-tiles/' : url.pathname;
  const req = ours ? e.request : new Request(e.request.url, { mode: 'cors', integrity: INTEGRITY[e.request.url] || '' });   // a CORS response can be checked and refreshed; an opaque one cannot
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const cached = await c.match(key);
    const fresh = fetch(req, ours ? { cache: 'no-cache' } : undefined).then(async (r) => {
      if (!r || !r.ok) return r;
      const old = cached && CODE.includes(key) ? await c.match(key) : null;
      await c.put(key, r.clone());
      if (old && (await old.text()) !== (await r.clone().text())) await newVersion(c);
      return r;
    }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    const r = await fresh;
    return r || new Response('Offline', { status: 503, statusText: 'Offline' });
  }));
});
// Every open page is running the old game, since the cache they share held it
// until now. Each is told once the whole new version is in the cache, so a
// reload gets the new page and scripts together, and each reloads when it can.
async function newVersion(c) {
  await Promise.all(['/seven-tiles/', ...CODE].map((u) => fetch(u, { cache: 'no-cache' }).then((r) => r.ok && c.put(u, r)).catch(() => {})));
  for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'updated' });
}
// A home-screen app can stay open for days without loading anything, so it
// asks for a check when it comes back to the screen.
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'check') return;
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    for (const u of CODE) {
      const [old, r] = await Promise.all([c.match(u), fetch(u, { cache: 'no-cache' }).catch(() => null)]);
      if (old && r && r.ok && (await old.text()) !== (await r.text())) return newVersion(c);
    }
  }));
});

// Turn notifications: the push function sends {title, body, url, tag}. Every
// push shows a notification (iPhones withdraw permission from sites that stay
// silent), and a tap opens the game, reusing a window that has it open.
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Seven Tiles', {
    body: m.body || 'Your move.',
    tag: m.tag || 'seven-tiles',
    renotify: true,
    icon: '/seven-tiles/icon-192.png',
    badge: '/seven-tiles/icon-192.png',
    data: { url: m.url || '/seven-tiles/' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/seven-tiles/', location.origin);
  if (target.origin !== location.origin) return;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (new URL(c.url).pathname === target.pathname && 'focus' in c) return c.focus();
    for (const c of list) if (new URL(c.url).pathname.startsWith('/seven-tiles/') && 'navigate' in c) return c.navigate(target.href).then((w) => w && w.focus());
    return self.clients.openWindow(target.href);
  }));
});
