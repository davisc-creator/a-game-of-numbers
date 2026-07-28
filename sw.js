/* Cache the app shell up front, then any data file the moment it's first used. */
const SHELL = 'otb-shell-v1';
const DATA  = 'otb-data-v1';
const FILES = ['./', './index.html', './styles.css', './app.js',
               './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isData = url.pathname.includes('/data/');
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(isData ? DATA : SHELL).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => hit))
  );
});
