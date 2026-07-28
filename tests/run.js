#!/usr/bin/env node
/* Test runner. Plain node, no dependencies, no build step — run `node tests/run.js`.

   app.js is a browser script with no exports, so it is loaded into a vm context
   with a stub DOM and an appended expression that hands back its top-level
   bindings. That keeps app.js itself free of test scaffolding. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

/* ------------------------------------------------------------ tiny harness */
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

/* -------------------------------------------------------------- stub world */
function stubEl(){
  const el = {
    textContent: '', innerHTML: '', value: '', disabled: false, dataset: {},
    classList: {toggle(){}, add(){}, remove(){}, contains(){ return false; }},
    setAttribute(){}, getAttribute(){ return null; }, focus(){}, click(){},
    addEventListener(){}, removeEventListener(){}, appendChild(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; },
  };
  return el;
}

function loadApp(){
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const store = new Map();
  const timers = [];
  const els = new Map();

  const sandbox = {
    console,
    document: {
      getElementById(id){
        if (!els.has(id)) els.set(id, stubEl());
        return els.get(id);
      },
      createElement(){ return stubEl(); },
      querySelectorAll(){ return []; },
    },
    window: {scrollTo(){}},
    navigator: {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    /* queued, not fired — the game engine chains turns through setTimeout, so
       tests drain it deliberately instead of racing it */
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout(){},
    fetch: () => Promise.reject(new Error('no network in tests')),
    URL: {createObjectURL: () => 'blob:', revokeObjectURL(){}},
    Blob: function(){},
    JSON, Math, Date, Map, Set, Array, Object, Number, String, Promise, Error,
    Intl, isNaN, parseInt, parseFloat,
  };
  sandbox.globalThis = sandbox;

  const epilogue = `
;({norm, lastOf, firstOf, lev, ord, fmtVal, esc, buildPool, resolve, order, seat,
   alive, openLeft, startGame, submitGuess, score, foul, strike, finish, advance,
   careerStats, profileFor, DEPTH_BUCKETS, S,
   getRecords: () => RECORDS, setRecords: v => { RECORDS = v; }})`;

  const api = vm.runInNewContext(src + epilogue, sandbox, {filename: 'app.js'});
  api.__timers = timers;
  api.__drain = () => { let n = 0; while (timers.length && n++ < 500) timers.shift()(); };
  api.__els = els;
  return api;
}

/* ------------------------------------------------------------- fixture era */
const FIX = () => ({
  id: 'test', label: 'Test Era', y0: 2000, y1: 2001, post: false,
  sides: {
    bat: {
      cols: ['H', 'HR'],
      rows: [
        ['Babe Ruth',    60, 5],
        ['Lou Gehrig',   60, 4],   // ties Ruth on H
        ['Hank Aaron',   44, 3],
        ['Willie Mays',  40, 2],
        ['Barry Bonds',  30, 1],
        ['Bobby Bonds',  20, 0],   // shared last name, zero HR
        ['Jose Ramirez', 10, 0],   // ASCII spelling, zero HR
      ],
    },
    pit: {cols: ['ERAm'], rows: [['Pedro Martinez', 80], ['Greg Maddux', 90], ['Roger Clemens', 100]]},
    /* two distinct men called Bob Miller, two called Alex Gonzalez — the shape
       that made 3,480 real board slots undraftable */
    dup: {
      cols: ['H'],
      rows: [
        ['Bob Miller', 50], ['Bob Miller', 45],
        ['Alex Gonzalez', 40], ['Alex Gonzalez', 40],
        ['Willie Mays', 30], ['Barry Bonds', 20], ['Bobby Bonds', 10],
      ],
    },
  },
  cats: {
    bat_h:   {side: 'bat', col: 'H',    label: 'Hits',      abbr: 'H',    depth: 3, dir: 'desc'},
    bat_h6:  {side: 'bat', col: 'H',    label: 'Hits Deep', abbr: 'H',    depth: 6, dir: 'desc'},
    bat_hr:  {side: 'bat', col: 'HR',   label: 'Home Runs', abbr: 'HR',   depth: 3, dir: 'desc'},
    pit_em:  {side: 'pit', col: 'ERAm', label: 'ERA-',      abbr: 'ERA-', depth: 2, dir: 'asc'},
    dup_h:   {side: 'dup', col: 'H',    label: 'Dup Hits',  abbr: 'H',    depth: 7, dir: 'desc'},
  },
});

function poolFor(app, catId){
  app.S.data = FIX();
  app.S.catId = catId;
  return app.buildPool();
}
function gameOn(app, catId, names){
  app.S.data = FIX();
  app.S.catId = catId;
  app.S.rangeId = 'test';
  app.S.post = false;
  app.S.seats = names;
  app.S.rounds = 12;
  app.startGame();
  app.__drain();
  return app.S.G;
}

/* ==================================================================== tests */
const app = loadApp();

group('helpers');
eq(app.norm('José Ramírez'), 'jose ramirez', 'norm strips accents');
eq(app.norm("Ken Griffey Jr."), 'ken griffey', 'norm drops Jr. and periods');
eq(app.norm('  Cal   Ripken  '), 'cal ripken', 'norm collapses whitespace');
eq(app.norm("O'Neill"), 'oneill', 'norm drops apostrophes');
eq(app.norm('Jean-Luc Picard'), 'jean luc picard', 'norm splits hyphens');
eq(app.norm(null), '', 'norm tolerates null');
eq(app.lastOf('Babe Ruth'), 'ruth', 'lastOf');
eq(app.firstOf('Babe Ruth'), 'babe', 'firstOf');
eq(app.lev('kitten', 'sitting'), 3, 'levenshtein distance');
eq(app.lev('same', 'same'), 0, 'levenshtein identity');
eq(app.lev('', 'abc'), 3, 'levenshtein against empty');
eq([1, 2, 3, 4, 11, 12, 13, 21, 101].map(app.ord),
   ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '101st'], 'ordinals incl. teens');
eq(app.fmtVal(1234567), '1,234,567', 'fmtVal thousands');
eq(app.fmtVal(null), '', 'fmtVal null');
eq(app.esc('<b>&"x"</b>'), '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;', 'esc escapes html');

group('buildPool');
{
  const P = poolFor(app, 'bat_h');
  eq(P.board.map(e => e.rank), [1, 1, 3], 'ties share a rank, next rank skips');
  eq(P.board.map(e => e.name), ['Babe Ruth', 'Lou Gehrig', 'Hank Aaron'], 'board is the top `depth`');
  eq(P.depth, 3, 'depth honoured');
  eq(P.total, 7, 'total counts everyone with a value');
  eq(P.foul.map(e => e.rank), [4, 5, 6, 7], 'foul band is the next ten (or what is left)');
  ok(P.board.every(e => !e.drafted), 'board starts undrafted');
  ok(P.foul.every(e => !e.used), 'foul band starts unused');
}
{
  const P = poolFor(app, 'bat_hr');
  const zero = [...P.byName.get('bobby bonds'), ...P.byName.get('jose ramirez')];
  ok(zero.every(e => e.zone === 'off' && e.rank === null),
     'players with no value land off-board with a null rank');
}
{
  const P = poolFor(app, 'pit_em');
  eq(P.board.map(e => e.name), ['Pedro Martinez', 'Greg Maddux'], 'asc category sorts low-first');
  eq(P.board.map(e => e.rank), [1, 2], 'asc ranks ascend');
}
{
  const shallow = poolFor(app, 'bat_h');
  ok(shallow.board.length <= shallow.depth, 'board never exceeds depth');
  const P = poolFor(app, 'bat_h6');
  eq(P.board.length, 6, 'deeper cut takes more of the list');
  eq(P.foul.length, 1, 'foul band is only what remains past the cut');
}

group('resolve');
{
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  const P = G.pool;
  eq(app.resolve('').k, 'empty', 'empty input');
  eq(app.resolve('Babe Ruth').k, 'hit', 'exact full name');
  eq(app.resolve('ruth').k, 'hit', 'bare last name when unambiguous');
  eq(app.resolve('José Ramírez').k, 'foul', 'accented input matches ASCII record');
  const amb = app.resolve('bonds');
  eq(amb.k, 'ambiguous', 'shared last name on the board is ambiguous');
  eq(amb.list.length, 2, 'ambiguous lists both');
  eq(app.resolve('barry bonds').k, 'hit', 'first name disambiguates');
  eq(app.resolve('b bonds').k, 'ambiguous', 'initial that still matches two is ambiguous');
  eq(app.resolve('w mays').k, 'hit', 'first-initial lastname resolves');
  const sug = app.resolve('Babe Ruthh');
  eq(sug.k, 'suggest', 'near miss suggests');
  eq(sug.e.name, 'Babe Ruth', 'suggests the right player');
  eq(app.resolve('Zzzqqqwww').k, 'none', 'nonsense resolves to nothing');
  P.board.find(e => e.name === 'Babe Ruth').drafted = true;
  eq(app.resolve('Babe Ruth').k, 'taken', 'drafted player reports as taken');
}

group('players who share a name');
{
  const G = gameOn(app, 'dup_h', ['A', 'B']);
  eq(app.resolve('miller').k, 'hit', 'bare last name shared by identical names resolves');
  const r1 = app.resolve('Bob Miller');
  eq(r1.k, 'hit', 'identical names on the board are draftable, not ambiguous');
  eq(r1.e.rank, 1, 'the better rank is awarded first');
  app.score(r1.e); app.__drain();
  const r2 = app.resolve('Bob Miller');
  eq(r2.k, 'hit', 'the namesake is still on the board afterwards');
  eq(r2.e.rank, 2, 'and is worth his own rank');
  app.score(r2.e); app.__drain();
  eq(app.resolve('Bob Miller').k, 'taken', 'once both are gone the name reports as taken');

  eq(app.resolve('Alex Gonzalez').k, 'hit', 'identical names tied on value still resolve');

  /* the case a first name genuinely does fix must still ask */
  const amb = app.resolve('bonds');
  eq(amb.k, 'ambiguous', 'different men sharing a last name still ask for a first name');
  eq(amb.list.length, 2, 'and both are offered');
  eq(G.pool.board.filter(e => !e.drafted).every(e => e.zone === 'board'), true, 'board intact');
}

group('snake order');
{
  gameOn(app, 'bat_h6', ['A', 'B', 'C']);
  eq(app.order(0), [0, 1, 2], 'even round runs forward');
  eq(app.order(1), [2, 1, 0], 'odd round reverses');
  eq(app.order(2), [0, 1, 2], 'and back again');
}

group('scoring and strikes');
{
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  app.score(G.pool.board.find(e => e.name === 'Hank Aaron'));
  app.__drain();
  eq(G.players[0].pts, 3, 'a pick scores its rank');
  eq(G.players[0].picks, 1, 'pick counted');
  eq(G.players[0].ranks, [3], 'rank recorded');
  eq(G.players[0].picked, [{n: 'Hank Aaron', r: 3}], 'pick recorded with name');
  ok(G.pool.board.find(e => e.name === 'Hank Aaron').drafted, 'drafted player leaves the pool');
}
{
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  app.strike('nobody', null); app.__drain();
  eq(G.players.map(p => p.strikes), [1, 0], 'strike lands on the player at the plate');
  const first = G.players[0];
  app.S.G.pos = 0; app.S.G.round = 0;
  app.strike('nobody', null); app.__drain();
  app.S.G.pos = 0; app.S.G.round = 0;
  app.strike('nobody', null); app.__drain();
  eq(first.strikes, 3, 'three strikes counted');
  ok(first.out, 'three strikes puts the player out');
  ok(!G.players[1].out, 'the other player keeps drafting');
}
{
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  const f = G.pool.foul[0];
  app.foul(f); app.__drain();
  eq(G.players[0].strikes, 1, 'a foul under two strikes costs one');
  eq(G.players[0].fouls, 1, 'foul counted');
  ok(f.used, 'that foul is spent');
  const p = G.players[0];
  p.strikes = 2;
  app.S.G.pos = 0; app.S.G.round = 0;
  app.foul(G.pool.foul[0]); app.__drain();
  eq(p.strikes, 2, 'a foul at two strikes is free');
}

group('records and profile');
{
  app.setRecords([
    {ts: 1, range: '2024', cat: 'bat_h', label: 'Hits', post: false, players: [
      {name: 'Carson', pts: 30, picks: 2, strikes: 1, fouls: 0, ranks: [10, 20],
       picked: [{n: 'A', r: 10}, {n: 'B', r: 20}], win: true},
      {name: 'Sam', pts: 12, picks: 1, strikes: 2, fouls: 1, ranks: [12],
       picked: [{n: 'C', r: 12}], win: false},
    ]},
    /* an older record: `ranks` only, no `picked` — must still work */
    {ts: 2, range: '1970-1979', cat: 'bat_hr', label: 'Home Runs', post: false, players: [
      {name: 'Carson', pts: 40, picks: 1, strikes: 0, fouls: 0, ranks: [40], win: true},
      {name: 'Sam', pts: 5, picks: 1, strikes: 0, fouls: 0, ranks: [5], win: false},
    ]},
  ]);
  const car = app.careerStats().find(r => r.name === 'Carson');
  eq(car.games, 2, 'games counted');
  eq(car.wins, 2, 'wins counted');
  eq(car.pts, 70, 'points summed');
  eq(car.ppg, 35, 'points per game');
  eq(car.hit, 3 / 4, 'hit rate is picks over picks+strikes');
  eq(car.deepest, 40, 'deepest pick');

  const P = app.profileFor('Carson');
  eq(P.games, 2, 'profile finds both games');
  eq(P.ranks.slice().sort((a, b) => a - b), [10, 20, 40], 'profile reads picked and ranks alike');
  eq(P.deepest, 40, 'profile deepest');
  eq(P.h2hList.length, 1, 'one head-to-head opponent');
  eq(P.h2hList[0].ahead, 2, 'ahead in both meetings');
  eq(P.catList.length, 2, 'per-category breakdown');
  eq(P.eraList.length, 2, 'per-era breakdown');
  ok(app.profileFor('CARSON').games === 2, 'profile lookup is case-insensitive');
  eq(app.profileFor('Nobody').games, 0, 'unknown player yields an empty profile');
}
{
  /* import merges by ts, so re-importing the same file must be a no-op */
  app.setRecords([{ts: 1, players: []}, {ts: 2, players: []}]);
  const incoming = [{ts: 2, players: []}, {ts: 3, players: []}];
  const seen = new Set(app.getRecords().map(g => g.ts));
  const added = incoming.filter(g => g && g.ts && !seen.has(g.ts));
  eq(added.map(g => g.ts), [3], 'merge by ts drops the duplicate');
}

group('full game to completion');
{
  const G = gameOn(app, 'bat_h', ['A', 'B']);   // 3-deep board
  app.S.G.maxRounds = 12;
  let guard = 0;
  while (!G.saved && guard++ < 50){
    const open = G.pool.board.filter(e => !e.drafted);
    if (open.length) app.score(open[0]); else app.strike('nobody', null);
    app.__drain();
  }
  ok(G.saved, 'game reaches a finish');
  eq(G.pool.board.filter(e => !e.drafted).length, 0, 'board empties');
  const rec = app.getRecords()[app.getRecords().length - 1];
  ok(!!rec && rec.range === 'test', 'a record was written');
  eq(rec.players.length, 2, 'record holds both players');
  ok(rec.players.some(p => p.win), 'a winner is marked');
  const best = Math.max(...rec.players.map(p => p.pts));
  ok(rec.players.filter(p => p.win).every(p => p.pts === best), 'only top scorers marked as winners');
}

/* ================================================== real data integrity */
group('shipped data');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  ok(Array.isArray(manifest.ranges), 'manifest has a ranges array');
  eq(manifest.ranges.length, 124, 'manifest lists 124 ranges');

  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json') && f !== 'manifest.json');

  /* 1994 has no postseason file because the strike cancelled it. The manifest
     omits its `post` entry and renderRanges filters on that, so the era never
     appears in the postseason picker. Expect exactly that one gap. */
  const missing = [], orphan = [];
  for (const r of manifest.ranges){
    if (!fs.existsSync(path.join(DATA, `${r.id}.json`))) missing.push(`${r.id}.json`);
    const hasPost = fs.existsSync(path.join(DATA, `${r.id}-post.json`));
    if (r.post && !hasPost) missing.push(`${r.id}-post.json`);
    if (!r.post && hasPost) orphan.push(`${r.id}-post.json unlisted in manifest`);
  }
  eq(missing, [], 'every range the manifest advertises has its file on disk');
  eq(orphan, [], 'no postseason file is hidden from the manifest');
  eq(manifest.ranges.filter(r => !r.post).map(r => r.id), ['1994'],
     '1994 is the only range with no postseason (players’ strike)');
  eq(files.length, manifest.ranges.length * 2 - 1, 'file count matches: 124 ranges, minus 1994 post');

  const badCol = [], dupCol = [], badSide = [], badDir = [], badDepth = [],
        badRow = [], nonAscii = [], emptyCat = [];
  let cats = 0, rows = 0, accented = 0;

  for (const f of files){
    const d = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
    for (const [side, s] of Object.entries(d.sides || {})){
      for (const r of s.rows){
        rows++;
        if (r.length !== s.cols.length + 1) badRow.push(`${f} ${side} ${r[0]}`);
        if (typeof r[0] !== 'string' || !r[0].trim()) badRow.push(`${f} ${side} blank name`);
        /* Most of Lahman is ASCII but the Negro League records are not, so an
           accented name must still be reachable by its plain spelling. */
        else if (/[^\x20-\x7E]/.test(r[0])){
          accented++;
          if (/[^\x20-\x7E]/.test(app.norm(r[0]))) nonAscii.push(`${f} ${r[0]} -> ${app.norm(r[0])}`);
        }
      }
    }
    for (const [id, c] of Object.entries(d.cats || {})){
      cats++;
      const s = (d.sides || {})[c.side];
      if (!s){ badSide.push(`${f} ${id} -> ${c.side}`); continue; }
      const hits = s.cols.filter(x => x === c.col).length;
      if (hits === 0) badCol.push(`${f} ${id} -> ${c.col}`);
      if (hits > 1) dupCol.push(`${f} ${id} -> ${c.col} appears ${hits}x in cols`);
      if (c.dir !== 'asc' && c.dir !== 'desc') badDir.push(`${f} ${id} dir=${c.dir}`);
      if (!(c.depth > 0)) badDepth.push(`${f} ${id} depth=${c.depth}`);
      const ci = s.cols.indexOf(c.col) + 1;
      if (ci > 0 && !s.rows.some(r => r[ci] > 0)) emptyCat.push(`${f} ${id}`);
    }
  }
  console.log(`   (${files.length} files, ${cats} categories, ${rows.toLocaleString('en-US')} rows, ${accented} accented names)`);
  eq(badSide.slice(0, 5), [], 'every category points at a real side');
  eq(badCol.slice(0, 5), [], 'every category column exists in that side');
  eq(dupCol.slice(0, 5), [], 'no category column name is duplicated (indexOf would pick the wrong one)');
  eq(badDir.slice(0, 5), [], 'every category sorts asc or desc');
  eq(badDepth.slice(0, 5), [], 'every category has a positive depth');
  eq(badRow.slice(0, 5), [], 'every row matches its column count and is named');
  eq(nonAscii.slice(0, 5), [], 'accented names normalise to plain ASCII so either spelling matches');
  eq(emptyCat.slice(0, 5), [], 'every category has at least one player with a value');
}

group('buildPool over every shipped category');
{
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json') && f !== 'manifest.json');
  const bad = [];
  let built = 0, sharedBoards = 0, sharedSlots = 0;
  for (const f of files){
    const d = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
    app.S.data = d;
    for (const id of Object.keys(d.cats || {})){
      app.S.catId = id;
      let P;
      try { P = app.buildPool(); }
      catch (e){ bad.push(`${f} ${id} threw ${e.message}`); continue; }
      built++;
      if (!P.board.length) bad.push(`${f} ${id} empty board`);
      if (P.board.length > P.depth) bad.push(`${f} ${id} board deeper than depth`);
      if (P.foul.length > 10) bad.push(`${f} ${id} foul band over ten`);
      const asc = d.cats[id].dir === 'asc';
      for (let i = 1; i < P.board.length; i++){
        if (P.board[i].rank < P.board[i - 1].rank) bad.push(`${f} ${id} ranks not monotonic`);
        const a = P.board[i - 1].val, b = P.board[i].val;
        if (asc ? b < a : b > a) bad.push(`${f} ${id} values out of order`);
        break;
      }
      if (P.board[0].rank !== 1) bad.push(`${f} ${id} board does not start at rank 1`);
      /* Shared names are legitimate — distinct men. What matters is that every
         one of them can actually be drafted. */
      const seen = new Map();
      for (const e of P.board) seen.set(e.name, (seen.get(e.name) || 0) + 1);
      const shared = [...seen].filter(([, n]) => n > 1);
      if (shared.length){
        sharedBoards++;
        app.S.G = {pool: P};
        for (const [name] of shared){
          sharedSlots += seen.get(name);
          const r = app.resolve(name);
          if (r.k !== 'hit') bad.push(`${f} ${id} "${name}" resolves as ${r.k}, not draftable`);
        }
      }
    }
  }
  console.log(`   (${built} category boards built; ${sharedBoards} carry ${sharedSlots} shared-name slots)`);
  eq(bad.slice(0, 5), [], 'every shipped category builds a sane, fully draftable board');
}

/* -------------------------------------------------------------------- done */
console.log(`\n${'─'.repeat(52)}`);
console.log(fail === 0 ? `ALL PASS  — ${pass} assertions` : `${pass} passed, ${fail} FAILED`);
if (fail){
  console.log('');
  failures.forEach(f => console.log(`  ✗ ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
