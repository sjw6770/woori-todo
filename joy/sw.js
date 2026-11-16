// JOY 서비스 워커: "Still having fun?" 알림 + 오프라인 캐시 (범위: /joy/)
const CACHE = 'joy-v1';
const SHELL = ['./', 'index.html', 'css/joy.css', 'js/app.js', 'js/store.js', 'js/data.js', 'js/engine.js', 'js/config.js', '../js/config.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('joy-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'JOY', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'JOY', {
    body: data.body || '', tag: data.tag || 'joy', renotify: true,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: data.url || './' },
  }));
});

// 알림을 누르면: 열린 창이 있으면 그 창에 "check" 화면을 열라고 알리고, 없으면 새로 연다
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (mine) { mine.postMessage({ type: 'open', url: target }); return mine.focus(); }
    return self.clients.openWindow(target);
  })());
});
