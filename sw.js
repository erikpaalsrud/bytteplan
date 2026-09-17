const CACHE = 'bytteplan-v11';
const ASSETS = ['./', './index.html', './manifest.json', './crest.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('bytteplan-') && k !== CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}));
    }
    return res;
  }).catch(async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    if (e.request.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
    return Response.error();
  }));
});

// Notifications are emitted by the running page, not a background timer.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = self.registration.scope;
  event.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(async clients => {
    const client = clients.find(c => c.url.startsWith(target));
    if (client) {
      await client.focus();
      client.postMessage({type:'OPEN_MATCH'});
    } else await self.clients.openWindow(target);
  }));
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data.json(); } catch { return; }
    if (!payload || typeof payload.title !== 'string' || payload.expiresAt < Date.now()) return;
    await self.registration.showNotification(payload.title, {
      body: payload.body, icon: 'icon-192.png',
      tag: payload.eventId === 'test' ? 'bytteplan-test' : 'bytteplan-match',
      renotify: true, silent: !!payload.silent,
      data: {url: self.registration.scope, eventId: payload.eventId}
    });
  })());
});
