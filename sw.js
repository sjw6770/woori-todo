// 우리할일 서비스 워커: 푸시 알림 표시 + 오프라인 시 앱 화면 캐시
const CACHE = 'woori-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/schedule.js', 'js/config.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선, 실패하면 캐시 (같은 출처의 GET 만)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: '우리할일', body: e.data?.text() }; }
  const title = data.title || '우리할일';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.location.href).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) return w.focus(); }
    return self.clients.openWindow(target);
  })());
});
