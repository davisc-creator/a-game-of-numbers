#!/usr/bin/env node
/* The League suite. Plain node, no dependencies — run `node tests/run-league.js`.

   league.js and baseball.js are browser scripts with no exports, so they are
   loaded into a vm with a stub DOM, exactly as run.js treats app.js. The draft
   is driven through the real takeL/nextTurnL, and the pool is built from the
   real season files, because the things worth asserting here — that the snake
   is even, that a drafted man is gone, that every roster comes out legal — are
   properties of the whole loop rather than of any one function. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0, section = '';
const failures = [];
function group(n){ section = n; console.log(`\n── ${n}`); }
function ok(c, label, detail){
  if (c){ pass++; console.log(`   ✓ ${label}`); }
  else { fail++; console.log(`   ✗ ${label}${detail ? `  — ${detail}` : ''}`); failures.push(`${section} / ${label}`); }
}
const eq = (a, b, label) =>
  ok(JSON.stringify(a) === JSON.stringify(b), label, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

function stubEl(){
  const e = {textContent: '', innerHTML: '', value: '', disabled: false, dataset: {}, _cls: new Set(),
    setAttribute(){}, getAttribute(){ return null; }, focus(){}, click(){},
    addEventListener(){}, removeEventListener(){}, appendChild(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; }};
  e.classList = {toggle: (c, f) => { f ? e._cls.add(c) : e._cls.delete(c); },
                 add: c => e._cls.add(c), remove: c => e._cls.delete(c),
                 contains: c => e._cls.has(c)};
  return e;
}

function load(){
  const els = new Map();
  let registered = null;
  const sandbox = {
    console,
    document: {getElementById(id){ if (!els.has(id)) els.set(id, stubEl()); return els.get(id); },
               createElement: stubEl, querySelectorAll: () => [], addEventListener(){}},
    window: {}, confirm: () => true, addEventListener(){},
    Shell: {register(g){ registered = g; }},
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
  const src = ['baseball.js', 'league.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const api = vm.runInNewContext(src + `\n;({BB, L, buildLeaguePool, takeL, nextTurnL, fullL,
      available, takenIds, playLeague, shortPositions, finishLeague, renderDraft, rank})`,
    sandbox, {filename: 'league.js'});
  api.__els = els;
  api.__registered = () => registered;
  return api;
}

const app = load();

(async () => {
  group('registration');
  {
    const g = app.__registered();
    ok(g && g.id === 'league', 'the League registers with the shell');
    eq(g.el, 'game-league', 'and owns its own element');
    ok(typeof g.isDirty === 'function', 'and reports whether a draft is in progress');
  }

  await app.BB.load();

  group('the pool is the whole era, not one club');
  const pool = await app.buildLeaguePool(1970, 1979);
  {
    ok(pool.cards.length > 400, `${pool.cards.length} players qualified across the 1970s`);
    const ids = pool.cards.filter(c => c.kind === 'bat').map(c => c.id);
    eq(ids.length, new Set(ids).size, 'each man appears once however many clubs he played for');
    ok(pool.cards.some(c => c.kind === 'bat') && pool.cards.some(c => c.kind === 'pit'),
       'hitters and pitchers both');
    ok(pool.cards.every(c => c.kind !== 'bat' || c.pa >= app.BB.MIN_AB * 0.9),
       'every hitter cleared the playing-time floor');
    /* era normalization is the whole point: the indices have to be there */
    ok(pool.cards.filter(c => c.kind === 'bat').every(c => Number.isFinite(c.ops)), 'every hitter has an OPS+');
    ok(pool.cards.filter(c => c.kind === 'pit').every(c => Number.isFinite(c.eraM)), 'every pitcher an ERA−');
    const best = pool.cards[0];
    ok(app.rank(best) >= app.rank(pool.cards[pool.cards.length - 1]), 'and the board is sorted best first');
    /* a traded man is one card here, where 162-0 would split him by club */
    const rj = pool.cards.find(c => /Reggie Jackson/.test(c.name));
    ok(rj && rj.pa > 3000, `a man who moved clubs is one card (${rj ? rj.name + ' ' + rj.pa + ' PA' : 'not found'})`);
  }

  group('a full draft');
  {
    app.L.pool = pool;
    app.L.seats = ['A', 'B', 'C', 'D'].map(n => ({name: n, roster: {}, picks: 0}));
    app.L.turn = 0; app.L.pos = 0; app.L.round = 0; app.L.done = false; app.L.filter = 'all'; app.L.search = '';

    const order = [app.L.turn];
    let guard = 0;
    while (!app.L.seats.every(app.fullL) && guard++ < 500){
      const seat = app.L.seats[app.L.turn];
      const fits = app.available().find(c => app.BB.openSlots(seat.roster, c).length);
      if (!fits) break;                      // the pool dried up; asserted below
      app.takeL(fits);
      if (!app.L.done) order.push(app.L.turn);
    }
    ok(app.L.seats.every(app.fullL), 'every manager filled a roster');
    eq(app.L.seats.map(s => s.picks), [15, 15, 15, 15], 'fifteen players each');

    /* the snake: over the first two rounds every seat picks exactly twice */
    eq(order.slice(0, 8), [0, 1, 2, 3, 3, 2, 1, 0], 'the draft snakes 0-1-2-3-3-2-1-0');
    const counts = order.reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {});
    eq(Object.values(counts), [15, 15, 15, 15], 'and every seat picks the same number of times');

    /* one pool, and a man taken is gone */
    const all = app.L.seats.flatMap(s => Object.values(s.roster)).map(c => c.kind + ':' + c.id);
    eq(all.length, new Set(all).size, 'no player is on two rosters');
    const gone = app.takenIds();
    ok(app.available().every(c => !gone.has(c.kind + ':' + c.id)), 'and the drafted are out of the pool');

    /* every roster is legal: no bench means every hitter fits a real position */
    for (const s of app.L.seats){
      const bad = app.BB.SLOTS.filter(sl => {
        const p = s.roster[sl.k];
        if (!p) return true;
        if (sl.kind !== p.kind) return true;
        /* the DH takes any bat; every other fielding slot needs its own man */
        if (p.kind === 'bat') return sl.pos !== 'DH' && p.pos !== sl.pos;
        return !(sl.pos === p.pos || (sl.pos === 'RP' && p.pos === 'CL') || (sl.pos === 'CL' && p.pos === 'RP'));
      });
      eq(bad.map(x => x.k), [], `${s.name}'s roster is legal at every slot`);
    }
  }

  group('the season');
  {
    const r = app.playLeague(app.L.seats);
    eq(r.table.length, 4, 'a row per club');
    ok(r.table.every(t => t.w + t.l === r.games), `every club played the same ${r.games} games`);
    const totalW = r.table.reduce((a, b) => a + b.w, 0);
    const totalL = r.table.reduce((a, b) => a + b.l, 0);
    eq(totalW, totalL, 'every win is somebody else’s loss');
    ok(r.table[0].w >= r.table[r.table.length - 1].w, 'the table is sorted by wins');
    ok(r.table.every(t => Number.isFinite(t.rs) && Number.isFinite(t.ra) && t.rs > 0 && t.ra > 0),
       'and every club has a real run rate');
    /* the head-to-head grid has to agree with the table */
    for (let i = 0; i < 4; i++){
      const row = r.table.find(t => t.i === i);
      let w = 0;
      for (let j = 0; j < 4; j++) if (j !== i) w += r.grid[i][j].w;
      eq(w, row.w, `the grid adds up to ${row.name}'s record`);
    }
  }

  group('the arithmetic both roster games share');
  {
    /* symmetry: swapping the two clubs gives one minus the answer, or the
       schedule would favour whoever happened to be listed first */
    const a = {rs: 5.0, raM: 90}, b = {rs: 4.0, raM: 110};
    const p = app.BB.headToHead(a, b), q = app.BB.headToHead(b, a);
    ok(Math.abs(p + q - 1) < 1e-12, `head to head is symmetric (${p.toFixed(3)} / ${q.toFixed(3)})`);
    ok(p > 0.5, 'and the better club is favoured');
    const even = app.BB.headToHead(a, a);
    ok(Math.abs(even - 0.5) < 1e-12, 'a club against itself is a coin flip');
    /* the same roster scored two ways must agree on strength */
    const s = app.BB.strength(app.L.seats[0].roster);
    ok(s.rs > 2 && s.rs < 9, `a real roster scores a believable ${s.rs.toFixed(2)} runs a game`);
    ok(s.raM > 50 && s.raM < 160, `and allows a believable ${s.raM.toFixed(0)} ERA−`);
  }

  group('an era too thin to fill');
  {
    /* with no bench, every hitter needs his own position; a short era can leave
       a roster unfillable, and it is better to say so before the draft */
    const tiny = await app.buildLeaguePool(1920, 1920);
    ok(app.shortPositions(tiny.cards, 2).length === 0,
       `one season of 1920 is enough for two managers (${tiny.cards.length} qualified, and the DH takes any bat)`);
    /* eight managers need eight men at every real position; find the seat count
       a single early season genuinely cannot support */
    let n = 2;
    while (n < 40 && app.shortPositions(tiny.cards, n).length === 0) n++;
    ok(n < 40, `1920 alone runs out at ${n} managers — short at ${app.shortPositions(tiny.cards, n).join(', ')}`);
    ok(app.shortPositions(pool.cards, 8).length === 0, 'a full decade is enough for eight');
    /* and the check is what stops a draft that could not finish */
    ok(app.shortPositions([], 2).length > 0, 'an empty era is refused outright');
  }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(fail === 0 ? `ALL PASS  — ${pass} assertions` : `${pass} passed, ${fail} FAILED`);
  if (fail){ console.log(''); failures.forEach(f => console.log(`  ✗ ${f}`)); }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
