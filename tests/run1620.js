#!/usr/bin/env node
/* 162-0. Same approach as tests/run.js: the game file is loaded into a vm with
   a stub DOM and a fetch that serves the repo off disk, then driven for real -
   spin, draft a full roster, simulate. Run `node tests/run1620.js`. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0, section = '';
const failures = [];

function group(n){ section = n; console.log(`\n── ${n}`); }
function ok(c, label, detail){
  if (c){ pass++; console.log(`   ✓ ${label}`); }
  else { fail++; console.log(`   ✗ ${label}${detail ? `  — ${detail}` : ''}`);
         failures.push(`${section} / ${label}${detail ? `: ${detail}` : ''}`); }
}
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), l,
                          `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

function stubEl(){
  return {textContent: '', innerHTML: '', value: '', disabled: false, dataset: {},
          classList: {toggle(){}, add(){}, remove(){}, contains(){ return false; }},
          setAttribute(){}, focus(){}, click(){}, addEventListener(){},
          querySelectorAll(){ return []; }, querySelector(){ return null; }};
}

function load(){
  const src = fs.readFileSync(path.join(ROOT, 'game1620.js'), 'utf8');
  const els = new Map();
  let registered = null;
  const sandbox = {
    console,
    Shell: {register: g => { registered = g; }},
    document: {getElementById(id){ if (!els.has(id)) els.set(id, stubEl()); return els.get(id); },
               createElement: stubEl, querySelectorAll: () => []},
    window: {}, navigator: {}, location: {origin: ''},
    localStorage: {getItem: () => null, setItem(){}, removeItem(){}},
    setTimeout: fn => { fn(); return 0; }, clearTimeout(){},
    confirm: () => true,
    fetch: url => {
      const p = path.join(ROOT, String(url));
      if (!fs.existsSync(p)) return Promise.resolve({ok: false, json: () => Promise.reject(new Error('404'))});
      return Promise.resolve({ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, 'utf8')))});
    },
    JSON, Math, Date, Map, Set, Array, Object, Number, String, Promise, Error, Intl,
    isNaN, parseInt, parseFloat,
  };
  sandbox.globalThis = sandbox;
  const api = vm.runInNewContext(
    src + `\n;({G, SLOTS, roster, leagueOver, spinnable, simulate, openSlots, take,
             start1620, doSpin, WINDOW, MIN_AB, MIN_OUTS, REF_RPG})`,
    sandbox, {filename: 'game1620.js'});
  api.__registered = () => registered;
  return api;
}

const app = load();

(async () => {
  group('shell registration');
  {
    const g = app.__registered();
    ok(!!g, 'registers itself with the shell');
    eq(g.id, '1620', 'under its own id');
    eq(g.el, 'game-1620', 'owning its own element');
    ok(typeof g.isDirty === 'function', 'and reports whether a draft is in progress');
  }

  group('data');
  const ix = JSON.parse(fs.readFileSync(path.join(ROOT, 'data-1620', 'index.json'), 'utf8'));
  const players = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8'));
  app.G.ix = ix; app.G.players = players;
  {
    const years = [];
    for (let y = ix.first; y <= ix.last; y++) years.push(y);
    const missing = years.filter(y => !fs.existsSync(path.join(ROOT, 'data-1620', `${y}.json`)));
    eq(missing, [], 'a season file for every year 1920-2025');
    ok(Object.keys(ix.franchises).length > 40, 'franchise index is populated');
    ok(!!ix.league['1968'] && !!ix.league['1999'], 'league context per season');
  }

  group('era normalization is doing real work');
  {
    const a = app.leagueOver(['1963', '1964', '1965', '1966', '1967', '1968']);
    const b = app.leagueOver(['1996', '1997', '1998', '1999', '2000']);
    ok(a.era < b.era, `the 1960s were a lower-scoring league (${a.era.toFixed(2)} vs ${b.era.toFixed(2)} ERA)`);
    ok(a.obp < b.obp, `and got on base less (${a.obp.toFixed(3)} vs ${b.obp.toFixed(3)} OBP)`);
    ok(a.slg < b.slg, 'and slugged less');
  }

  group('franchise rosters');
  let R;
  {
    R = await app.roster('NYY', 1927);
    ok(R.hitters.length >= 9, `1927-36 Yankees field a lineup (${R.hitters.length} qualified hitters)`);
    ok(R.arms.length >= 8, `and a staff (${R.arms.length} qualified arms)`);
    const ruth = R.hitters.find(h => h.name === 'Babe Ruth');
    ok(!!ruth, 'Babe Ruth is on it');
    ok(ruth && ruth.ops > 180, `and grades as an all-timer (${ruth && ruth.ops} OPS+)`);
    ok(R.hitters.every(h => h.ab >= app.MIN_AB), 'every hitter clears the playing-time floor');
    ok(R.arms.every(a => a.ip * 3 >= app.MIN_OUTS - 1), 'every arm does too');
    ok(R.hitters.every(h => ix.pos.includes(h.pos)), 'every hitter has a real position');
    ok(!R.hitters.some(h => h.pos === 'P'), 'no pitchers in the hitter pool');
    ok(R.arms.every(a => ['SP', 'RP', 'CL'].includes(a.pos)), 'arms are typed SP/RP/CL');
    ok(R.hitters[0].ops >= R.hitters[R.hitters.length - 1].ops, 'hitters sorted by OPS+');
    ok(R.arms[0].eraM <= R.arms[R.arms.length - 1].eraM, 'arms sorted by ERA−');
  }
  {
    /* a low-scoring era should not make its pitchers look superhuman */
    const g = await app.roster('LAD', 1963);
    const koufax = g.arms.find(a => a.name === 'Sandy Koufax');
    ok(!!koufax, 'Koufax is on the 1963-72 Dodgers');
    ok(koufax && koufax.era < 3, `with a raw ERA that looks absurd today (${koufax && koufax.era.toFixed(2)})`);
    ok(koufax && koufax.eraM > 40, `but a fair ERA− against his own league (${koufax && koufax.eraM})`);
  }

  group('spins');
  {
    const all = app.spinnable();
    ok(all.length > 1000, `${all.length} club-and-era combinations`);
    ok(all.every(([, y]) => y + app.WINDOW - 1 <= ix.last), 'no window runs past 2025');
    ok(all.every(([k]) => ix.franchises[k].n >= app.WINDOW), 'every club has a decade to draw from');
    const rolling = all.filter(([k]) => k === 'NYY').map(([, y]) => y);
    ok(rolling.includes(1927) && rolling.includes(1928), 'windows roll year by year, not by decade');
  }

  group('drafting');
  {
    app.G.seats = [{name: 'Solo', roster: {}, picks: 0}];
    app.G.turn = 0;
    app.G.spin = R;
    const seat = app.G.seats[0];

    const c = R.hitters.find(h => h.pos === 'C');
    if (c){
      const slots = app.openSlots(seat, c);
      ok(slots.length > 0, 'a catcher has somewhere to go');
      eq(slots[0].k, 'C', 'and his own position comes first');
    } else ok(true, 'no catcher on this club to test with');

    /* fill a roster the way the game does, then check the shape */
    let guard = 0;
    while (!app.SLOTS.every(s => seat.roster[s.k]) && guard++ < 400){
      const R2 = await app.roster(...app.spinnable()[guard * 37 % app.spinnable().length]);
      const all = [...R2.hitters, ...R2.arms];
      const fits = all.find(x => app.openSlots(seat, x).length);
      if (!fits) continue;
      const slot = app.openSlots(seat, fits)[0];
      seat.roster[slot.k] = {...fits, from: 'test'};
      seat.picks++;
    }
    eq(seat.picks, 21, 'a full roster is 21 players');
    eq(app.SLOTS.filter(s => s.kind === 'bat').length, 13, '13 hitters');
    eq(app.SLOTS.filter(s => s.pos === 'SP').length, 5, '5 starters');
    eq(app.SLOTS.filter(s => s.pos === 'RP').length, 2, '2 in relief');
    eq(app.SLOTS.filter(s => s.pos === 'CL').length, 1, '1 closer');
    ok(['C','1B','2B','3B','SS','LF','CF','RF','DH'].every(p => {
      const f = seat.roster[p];
      return f && f.pos === p;
    }), 'every fielding slot holds a player who actually played there');
    ok(app.SLOTS.filter(s => s.kind === 'pit').every(s => seat.roster[s.k].kind === 'pit'),
       'no hitters on the pitching staff');

    group('simulation');
    const m = app.simulate(seat);
    eq(m.w + m.l, 162, 'the season is 162 games');
    ok(m.w >= 0 && m.w <= 162, 'wins are in range');
    ok(m.wpct > 0 && m.wpct < 1, 'win rate is a probability');
    ok(m.rs > 1 && m.rs < 12, `runs scored per game is plausible (${m.rs.toFixed(2)})`);
    ok(m.ra > 1 && m.ra < 12, `runs allowed per game is plausible (${m.ra.toFixed(2)})`);
    ok(Math.abs(m.expW - 162 * m.wpct) < 1, 'expected wins follows the win rate');
    ok(m.streak >= 1 && m.streak <= 162, 'a longest streak is reported');

    /* the model has to reward a better roster */
    const strong = {roster: {}}, weak = {roster: {}};
    for (const s of app.SLOTS){
      const base = seat.roster[s.k];
      strong.roster[s.k] = {...base, obpP: 1.25, slgP: 1.35, eraM: 70, pa: 600};
      weak.roster[s.k]   = {...base, obpP: 0.85, slgP: 0.80, eraM: 130, pa: 600};
    }
    const S = app.simulate(strong), W = app.simulate(weak);
    ok(S.wpct > W.wpct, `a better roster wins more (${S.wpct.toFixed(3)} vs ${W.wpct.toFixed(3)})`);
    ok(S.rs > W.rs && S.ra < W.ra, 'scoring more and allowing fewer');
    ok(S.wpct > 0.6 && W.wpct < 0.4, 'and the spread is meaningful');

    /* Pythagorean, checked against the formula rather than the implementation */
    const want = Math.pow(S.rs, 1.83) / (Math.pow(S.rs, 1.83) + Math.pow(S.ra, 1.83));
    ok(Math.abs(S.wpct - want) < 1e-9, 'win rate is exactly the Pythagorean expectation');
  }
})().then(() => {
  console.log(`\n${'─'.repeat(52)}`);
  console.log(fail === 0 ? `ALL PASS  — ${pass} assertions` : `${pass} passed, ${fail} FAILED`);
  if (fail){ console.log(''); failures.forEach(f => console.log(`  ✗ ${f}`)); }
  process.exit(fail === 0 ? 0 : 1);
}, e => { console.error(e); process.exit(1); });
