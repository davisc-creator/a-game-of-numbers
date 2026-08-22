/* Cache the app shell up front, then any data file the moment it's first used. */
const SHELL = 'otb-shell-v3';
const DATA  = 'otb-data-v1';
const FILES = ['./', './index.html', './styles.css', './shell.js', './baseball.js',
               './app.js', './game1620.js', './league.js',
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
  /* Data files never change once generated, so cache-first is right for them and is
     what makes offline play work. The shell is the opposite: cache-first pinned every
     installed browser to whatever app.js shipped the day it installed. The test
     matches every data folder, not just /data/, so 162-0's seasons cache too. */
  /* Only a good response is worth keeping. Cache.put stores a 404 as happily as
     a 200, and under cache-first that entry is then served for ever - one bad
     moment during a deploy and the file is broken on that device permanently,
     with nothing on screen to say so. Checking hit.ok on the way in as well
     means a cache poisoned before this lands heals itself on the next load,
     which is why DATA does not need a version bump to fix it. */
  const keep = (name, req, res) => {
    if (res && res.ok){ const copy = res.clone(); caches.open(name).then(c => c.put(req, copy)); }
    return res;
  };
  if (/\/data[^/]*\//.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(hit => (hit && hit.ok) ? hit
        /* reaching the catch means any cached copy was already refused as
           not-ok, so handing it back now would be the lie the check exists
           to prevent */
        : fetch(e.request).then(res => keep(DATA, e.request, res)).catch(() => undefined))
    );
    return;
  }
  /* no-cache means revalidate, not skip: the browser's own HTTP cache would
     otherwise hand back a ten-minute-old app.js without this worker ever
     seeing the network, which is how a phone stayed on old code after a
     deploy. With an ETag the usual answer is a 304, so it costs nothing. */
  e.respondWith(
    fetch(e.request, {cache: 'no-cache'}).then(res => keep(SHELL, e.request, res))
      /* the same check on the way out: an entry cached before keep() existed
         could be a 404, and serving that offline would look like the app itself
         is broken. Nothing is a better answer than a lie. */
      .catch(() => caches.match(e.request).then(hit => (hit && hit.ok) ? hit : undefined))
  );
});
