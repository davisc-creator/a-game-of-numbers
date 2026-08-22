#!/usr/bin/env node
/* Service worker suite. Plain node, no dependencies — run `node tests/run-sw.js`.

   sw.js is written against globals a browser supplies, so it is loaded into a vm
   with a stub CacheStorage, a controllable fetch and an event object that
   captures whatever respondWith is handed. That keeps sw.js free of any test
   scaffolding, the same way run.js treats app.js.

   This file exists because sw.js has twice shipped a caching bug that could not
   be seen from the page: cache-first on the shell pinned installed browsers to a
   stale app.js, and Cache.put storing a 404 could break a data file on a device
   for good. Both are silent, both survive a reload, and neither shows up in any
   other suite. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://example.test';

let pass = 0, fail = 0, section = '';
const failures = [];
function group(name){ section = name; console.log(`\n── ${name}`); }
function ok(cond, label, detail){
  if (cond){ pass++; console.log(`   ✓ ${label}`); }
  else {
    fail++; console.log(`   ✗ ${label}${detail ? `  — ${detail}` : ''}`);
    failures.push(`${section} / ${label}${detail ? `: ${detail}` : ''}`);
  }
}
const eq = (a, b, label) =>
  ok(JSON.stringify(a) === JSON.stringify(b), label, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ------------------------------------------------------------- stub world */
const res = (status, body) => ({
  status, ok: status >= 200 && status < 300, body,
  clone(){ return res(status, body); },
});

function loadSW(){
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const store = new Map();                       // cacheName -> Map(url -> response)
  const cacheFor = n => store.get(n) || (store.set(n, new Map()), store.get(n));
  let net = () => Promise.reject(new Error('offline'));
  const netLog = [], inits = [];

  const caches = {
    open: async n => ({
      put: async (req, r) => { cacheFor(n).set(req.url, r); },
      addAll: async () => {},
    }),
    match: async req => {
      for (const c of store.values()) if (c.has(req.url)) return c.get(req.url);
      return undefined;
    },
    keys: async () => [...store.keys()],
    delete: async n => store.delete(n),
  };

  const handlers = {};
  const sandbox = {
    console, URL, Promise, Map, Set, Array, Object, JSON, Error, RegExp,
    location: {origin: ORIGIN},
    caches,
    fetch: (req, init) => { netLog.push(req.url); inits.push(init || null); return net(req); },
    self: {
      addEventListener: (t, fn) => { handlers[t] = fn; },
      skipWaiting(){}, clients: {claim(){}},
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self.location = sandbox.location;
  vm.runInNewContext(src, sandbox, {filename: 'sw.js'});

  return {
    handlers, store, netLog, inits,
    setNet: fn => { net = fn; },
    seed: (cacheName, url, r) => cacheFor(cacheName).set(url, r),
    cached: (cacheName, url) => (store.get(cacheName) || new Map()).get(url),
    /* drive a GET through the fetch handler and hand back what it answered
       with, or the string 'passthrough' when it declined to handle it */
    get: async (url, method = 'GET') => {
      const e = {request: {url, method}, _p: null, respondWith(p){ this._p = p; }};
      handlers.fetch(e);
      if (!e._p) return 'passthrough';
      return await e._p;
    },
    activate: async () => {
      let waited = null;
      handlers.activate({waitUntil: p => { waited = p; }});
      return await waited;
    },
  };
}

const DATA_URL  = `${ORIGIN}/data/played.json`;
const SEASON_URL = `${ORIGIN}/data-teams/1998.json`;
const SHELL_URL = `${ORIGIN}/app.js`;

/* ==================================================================== tests */
async function main(){
  group('what the worker declines to touch');
  {
    const sw = loadSW();
    eq(await sw.get(SHELL_URL, 'POST'), 'passthrough', 'a POST is left alone');
    eq(await sw.get('https://elsewhere.test/app.js'), 'passthrough', 'so is another origin');
  }

  group('data files are cache-first, but only good ones are kept');
  {
    const sw = loadSW();
    /* a 404 during a deploy must not become permanent. Cache.put stores it as
       happily as a 200, and cache-first would then serve it for ever. */
    sw.setNet(() => Promise.resolve(res(404, 'not found')));
    const miss = await sw.get(DATA_URL);
    eq(miss.status, 404, 'a 404 is passed through to the page');
    eq(sw.cached('otb-data-v1', DATA_URL), undefined, 'and is never written to the cache');

    sw.setNet(() => Promise.resolve(res(200, 'real')));
    const good = await sw.get(DATA_URL);
    eq(good.body, 'real', 'so the next attempt reaches the network and succeeds');
    ok(sw.cached('otb-data-v1', DATA_URL), 'and that one is cached');

    const before = sw.netLog.length;
    const again = await sw.get(DATA_URL);
    eq(again.body, 'real', 'a cached data file is then served from the cache');
    eq(sw.netLog.length, before, 'without touching the network — offline play rests on this');
  }
  {
    /* the pattern matches every data folder, not just /data/, so 162-0's
       seasons cache too */
    const sw = loadSW();
    sw.setNet(() => Promise.resolve(res(200, 'season')));
    await sw.get(SEASON_URL);
    ok(sw.cached('otb-data-v1', SEASON_URL), 'data-teams/ is cached the same way');
  }

  group('a cache poisoned before this fix heals itself');
  {
    /* exactly the state a device could already be stuck in: a 404 sitting in
       the data cache, served for ever because cache-first never re-checks */
    const sw = loadSW();
    sw.seed('otb-data-v1', DATA_URL, res(404, 'stale not found'));
    sw.setNet(() => Promise.resolve(res(200, 'real')));
    const r = await sw.get(DATA_URL);
    eq(r.body, 'real', 'a cached failure is stepped over rather than served');
    eq(sw.cached('otb-data-v1', DATA_URL).body, 'real', 'and replaced with the good copy');
    ok(true, 'which is why DATA needs no version bump — nobody loses their offline eras');
  }
  {
    /* still offline-safe: if the network cannot answer, a cached copy is all
       there is, and handing it back beats failing outright */
    const sw = loadSW();
    sw.seed('otb-data-v1', DATA_URL, res(200, 'offline copy'));
    sw.setNet(() => Promise.reject(new Error('offline')));
    const r = await sw.get(DATA_URL);
    eq(r.body, 'offline copy', 'a good cached data file still works with no network');
  }
  {
    /* but a poisoned one is not handed back just because the network is gone -
       the first version of this fix did exactly that in its catch */
    const sw = loadSW();
    sw.seed('otb-data-v1', DATA_URL, res(404, 'stale not found'));
    sw.setNet(() => Promise.reject(new Error('offline')));
    eq(await sw.get(DATA_URL), undefined, 'offline, a poisoned data entry is not served either');
  }

  group('the shell is network-first');
  {
    /* and revalidates: without cache: 'no-cache' the browser's own HTTP cache
       answers for ten minutes and the worker never sees the network */
    const sw = loadSW();
    sw.setNet(() => Promise.resolve(res(200, 'app')));
    await sw.get(SHELL_URL);
    eq(sw.inits[0] && sw.inits[0].cache, 'no-cache', 'a shell fetch revalidates against the server');
    await sw.get(DATA_URL);
    eq(sw.inits[1], null, 'a data fetch does not - those files never change');
  }
  {
    /* the bug that pinned installed browsers to whatever app.js they first saw,
       and that wrote four games' records in a stale shape on 2026-07-28 */
    const sw = loadSW();
    sw.seed('otb-shell-v3', SHELL_URL, res(200, 'old app.js'));
    sw.setNet(() => Promise.resolve(res(200, 'new app.js')));
    const r = await sw.get(SHELL_URL);
    eq(r.body, 'new app.js', 'a cached shell file is still re-fetched');
    eq(sw.cached('otb-shell-v3', SHELL_URL).body, 'new app.js', 'and the cache is updated');
  }
  {
    const sw = loadSW();
    sw.seed('otb-shell-v3', SHELL_URL, res(200, 'good app.js'));
    sw.setNet(() => Promise.reject(new Error('offline')));
    const r = await sw.get(SHELL_URL);
    eq(r.body, 'good app.js', 'and falls back to the cache when the network is gone');
  }
  {
    const sw = loadSW();
    sw.seed('otb-shell-v3', SHELL_URL, res(200, 'good app.js'));
    sw.setNet(() => Promise.resolve(res(500, 'boom')));
    await sw.get(SHELL_URL);
    eq(sw.cached('otb-shell-v3', SHELL_URL).body, 'good app.js',
       'a bad response never overwrites a good cached shell file');
  }
  {
    /* an entry cached before keep() existed could be a 404; serving it offline
       would look like the app itself is broken */
    const sw = loadSW();
    sw.seed('otb-shell-v3', SHELL_URL, res(404, 'stale not found'));
    sw.setNet(() => Promise.reject(new Error('offline')));
    eq(await sw.get(SHELL_URL), undefined,
       'offline, a poisoned shell entry is not served — nothing beats a lie');
  }

  group('activate evicts the superseded caches only');
  {
    const sw = loadSW();
    sw.seed('otb-shell-v1', SHELL_URL, res(200, 'ancient'));
    sw.seed('otb-shell-v3', SHELL_URL, res(200, 'current'));
    sw.seed('otb-data-v1', DATA_URL, res(200, 'keep me'));
    await sw.activate();
    eq(sw.cached('otb-shell-v1', SHELL_URL), undefined, 'the old shell cache goes');
    ok(sw.cached('otb-shell-v3', SHELL_URL), 'the current one stays');
    ok(sw.cached('otb-data-v1', DATA_URL), 'and the data cache is left alone');
  }
}

main().then(() => {
  console.log('\n' + '─'.repeat(52));
  if (fail){
    console.log(`${fail} FAILED, ${pass} passed`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`ALL PASS  — ${pass} assertions`);
}).catch(e => { console.error(e); process.exit(1); });
