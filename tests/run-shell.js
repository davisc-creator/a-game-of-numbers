#!/usr/bin/env node
/* The shell, with both games loaded into one context the way index.html loads
   them. Catches the integration faults the per-game suites cannot see: load
   order, registration, masthead swapping, and the containers actually toggling.
   Run `node tests/run-shell.js`. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];
function group(n){ console.log(`\n── ${n}`); }
function ok(c, label, detail){
  if (c){ pass++; console.log(`   ✓ ${label}`); }
  else { fail++; console.log(`   ✗ ${label}${detail ? `  — ${detail}` : ''}`); failures.push(label); }
}

function el(id){
  const e = {id, textContent: '', innerHTML: '', value: '', disabled: false, dataset: {}, _cls: new Set(),
    setAttribute(k, v){ e['_' + k] = v; }, getAttribute(k){ return e['_' + k]; },
    focus(){}, click(){}, addEventListener(){}, contains(){ return false; },
    querySelectorAll(){ return []; }, querySelector(){ return null; }};
  e.classList = {toggle: (c, f) => { f ? e._cls.add(c) : e._cls.delete(c); },
                 add: c => e._cls.add(c), remove: c => e._cls.delete(c),
                 contains: c => e._cls.has(c)};
  return e;
}

const els = new Map();
const get = id => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); };
const hidden = id => get(id)._cls.has('hidden');

const sandbox = {
  console,
  document: {getElementById: get, createElement: () => el('x'), querySelectorAll: () => [],
             readyState: 'complete', addEventListener(){}},
  window: {scrollTo(){}}, navigator: {}, history: {replaceState(){}},
  location: {hash: '', origin: ''}, confirm: () => true, addEventListener(){},
  localStorage: {getItem: () => null, setItem(){}, removeItem(){}},
  setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout(){},
  fetch: url => {
    const p = path.join(ROOT, String(url));
    if (!fs.existsSync(p)) return Promise.resolve({ok: false, json: () => Promise.reject(new Error('404'))});
    return Promise.resolve({ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, 'utf8')))});
  },
  JSON, Math, Date, Map, Set, Array, Object, Number, String, Promise, Error, Intl,
  isNaN, parseInt, parseFloat,
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

/* index.html loads them in this order; the shell must not care */
const ORDER = ['shell.js', 'baseball.js', 'app.js', 'game1620.js', 'league.js'];
for (const f of ORDER) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, {filename: f});

/* every script tag in index.html must actually exist and be loaded here */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const tags = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);

setTimeout(async () => {
  const Shell = vm.runInContext('Shell', ctx);

  group('script wiring');
  ok(JSON.stringify(tags) === JSON.stringify(ORDER),
     `index.html loads exactly ${ORDER.join(', ')}`, `found ${tags.join(', ')}`);
  tags.forEach(t => ok(fs.existsSync(path.join(ROOT, t)), `${t} exists`));

  group('registration');
  ok(!!Shell, 'the shell is reachable from the other scripts');
  ok(Shell.games.length === 3, 'all three games registered');
  ok(Shell.games.map(g => g.id).join() === 'game100,1620,league', 'in load order');
  const ids = Shell.games.map(g => g.el);
  ok(new Set(ids).size === ids.length, 'each game owns a distinct element');

  group('first paint');
  ok(Shell.current.id === 'game100', 'the first game shows by default');
  ok(get('game-title').textContent === 'Game 100', 'masthead carries its title');
  ok(!hidden('game-100') && hidden('game-1620'), 'only its container is visible');
  ok(get('start-note').textContent.length > 0, 'and it booted and loaded its data');
  ok(get('switch-menu').innerHTML.includes('162-0'), 'the switcher lists the other game');

  group('switching');
  await Shell.show('1620');
  ok(Shell.current.id === '1620', 'switches on request');
  ok(get('game-title').textContent === '162-0', 'masthead follows');
  ok(get('game-tagline').textContent === 'Spin, draft, play the season', 'tagline too');
  ok(hidden('game-100') && !hidden('game-1620'), 'containers swap');
  ok(/\d+ franchises/.test(get('x-start-note').textContent), 'the second game boots on first switch');
  ok(get('x-start').disabled === false, 'and is ready to play');

  await Shell.show('game100');
  ok(Shell.current.id === 'game100', 'and switches back');
  ok(get('game-title').textContent === 'Game 100', 'restoring the masthead');
  ok(!hidden('game-100') && hidden('game-1620'), 'and the containers');

  group('no id collisions between the games');
  const collide = [];
  const idsOf = src => new Set([...src.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const g100 = html.slice(html.indexOf('<div id="game-100">'), html.indexOf('<!-- /game-100 -->'));
  const g1620 = html.slice(html.indexOf('<div id="game-1620"'), html.indexOf('<!-- /game-1620 -->'));
  const glg = html.slice(html.indexOf('<div id="game-league"'), html.indexOf('<!-- /game-league -->'));
  const sets = [['Game 100', idsOf(g100)], ['162-0', idsOf(g1620)], ['League', idsOf(glg)]];
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++)
    for (const id of sets[i][1]) if (sets[j][1].has(id)) collide.push(`${sets[i][0]}/${sets[j][0]}: ${id}`);
  ok(collide.length === 0, 'no two games share an element id', collide.join(', '));
  ok(idsOf(glg).size > 20, `the League markup is present (${idsOf(glg).size} ids)`);

  group('no top-level name collisions between the scripts');
  {
    /* classic scripts share one global scope. A repeated const or let is a hard
       load error, which is loud - but a repeated function or var silently wins,
       and one game would quietly call the other's. */
    const decls = f => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const out = new Set();
      for (const m of src.matchAll(/^(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/gm))
        out.add(m[1]);
      return out;
    };
    const seen = new Map(), clash = [];
    for (const f of ORDER)
      for (const n of decls(f)){
        if (seen.has(n)) clash.push(`${n} in both ${seen.get(n)} and ${f}`);
        else seen.set(n, f);
      }
    ok(clash.length === 0, `${seen.size} top-level names across ${ORDER.length} scripts, all distinct`, clash.join('; '));
  }

  group('keeping an installed phone current');
  {
    /* a second context with a service worker present: the shell registers it,
       re-checks whenever the app comes back to the foreground, reloads when a
       new worker takes over - and only offers to when a draft is live */
    const els2 = new Map();
    const get2 = id => { if (!els2.has(id)) els2.set(id, el(id)); return els2.get(id); };
    const docHandlers = {}, swHandlers = {};
    let reloads = 0, updates = 0;
    const sb = {...sandbox,
      document: {getElementById: get2, createElement: () => el('x'), querySelectorAll: () => [],
                 readyState: 'complete', addEventListener: (t, fn) => { docHandlers[t] = fn; },
                 visibilityState: 'visible', lastModified: '08/21/2026 19:30:07'},
      navigator: {serviceWorker: {controller: {}, register: () => Promise.resolve({update: () => { updates++; return Promise.resolve(); }}),
                                  addEventListener: (t, fn) => { swHandlers[t] = fn; }}},
      location: {hash: '', origin: '', reload: () => { reloads++; }},
    };
    sb.globalThis = sb;
    const c2 = vm.createContext(sb);
    for (const f of ORDER) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c2, {filename: f});
    setTimeout(() => {
      ok(typeof swHandlers.controllerchange === 'function', 'the shell registers the worker and listens for a new one');
      docHandlers.visibilitychange();
      setTimeout(() => {
        ok(updates === 1, 'coming back to the foreground checks for an update');
        swHandlers.controllerchange();
        ok(reloads === 1, 'a new worker taking over reloads the page when nothing is in progress');
        ok(/updated Aug 21/.test(get2('build-stamp').textContent), `the rules screen says when this copy was built: "${get2('build-stamp').textContent}"`);
        /* now with a draft in progress */
        const g100 = vm.runInContext('Shell', c2).games.find(g => g.id === 'game100');
        g100.isDirty = () => true;
        swHandlers.controllerchange();
        ok(reloads === 1, 'with a draft live it does not reload');
        ok(!get2('update-note')._cls.has('hidden'), 'it offers the reload instead');
        get2('update-go').onclick();
        ok(reloads === 2, 'and the offer works');
        done();
      }, 20);
    }, 200);
  }

  function done(){
    console.log(`\n${'─'.repeat(52)}`);
    console.log(fail === 0 ? `ALL PASS  — ${pass} assertions` : `${pass} passed, ${fail} FAILED`);
    if (fail){ console.log(''); failures.forEach(f => console.log(`  ✗ ${f}`)); }
    process.exit(fail === 0 ? 0 : 1);
  }
}, 2500);
