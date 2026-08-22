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
const RANGE_FILE = /^\d{4}(-\d{4})?(-post)?\.json$/;

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
    /* serves data/ off disk so the custom-range aggregator can be exercised
       exactly as the browser runs it */
    fetch: url => {
      const p = path.join(ROOT, String(url));
      if (!fs.existsSync(p)) return Promise.resolve({ok: false, json: () => Promise.reject(new Error('404'))});
      return Promise.resolve({ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, 'utf8')))});
    },
    URL: {createObjectURL: () => 'blob:', revokeObjectURL(){}},
    Blob: function(){},
    JSON, Math, Date, Map, Set, Array, Object, Number, String, Promise, Error,
    Intl, isNaN, parseInt, parseFloat,
  };
  sandbox.globalThis = sandbox;

  const epilogue = `
;({norm, lastOf, firstOf, lev, ord, fmtVal, esc, buildPool, resolve, order, seat,
   alive, openLeft, startGame, submitGuess, score, foul, strike, finish, advance,
   careerStats, profileFor, DEPTH_BUCKETS, S, buildCustom, rnd, depthOf, CX,
   startSeries, seriesTake, seriesTarget, seriesLabel, seriesStanding, SMODES,
   renderSeries, renderSeriesHistory, buildTeamRange, buildTeamMembers,
   teamMembers, teamsInRange, loadTeamIndex, TX, PX, loadBreakdowns, recYears,
   renderProfile, SORTERS, rarityIndex, bestStreak, diverge,
   candidates, apply, askCandidates, takeNamed, spanOf, ALIASES,
   soloPriorBest, renderSeats, renderRecords, histPicks, syncFormat, rollEra, WS,
   revealDone, renderReveal, sealed,
   SCORE_TO, FOUL_TO, WIDE_TO, loadRecords, loadRange,
   getRecords: () => RECORDS, setRecords: v => { RECORDS = v; }})`;

  const api = vm.runInNewContext(src + epilogue, sandbox, {filename: 'app.js'});
  api.__timers = timers;
  api.__drain = () => { let n = 0; while (timers.length && n++ < 500) timers.shift()(); };
  api.__els = els;
  api.__store = store;
  return api;
}

/* ------------------------------------------------------------- fixture era */
/* names have to be alphabetic — norm() strips digits, so "Filler 994" and
   "Filler 993" would collapse to the same name and share a lookup bucket */
const AZ = 'abcdefghijklmnopqrstuvwxyz';
const alpha = n => AZ[Math.floor(n / 26) % 26].toUpperCase() + AZ[n % 26];
const fill = (n, from) => Array.from({length: n}, (_, i) => [`Filler ${alpha(from - i)}`, from - i, 0]);

const FIX = () => withIds({
  id: 'test', label: 'Test Era', y0: 2000, y1: 2001, post: false,
  sides: {
    /* 150 deep, so every boundary is exercised: 1-100 scores, 101-125 is the
       foul band, 126-140 is only a foul with an earned extension, 141+ is a
       strike no matter what. The named men sit at fixed ranks; fillers occupy
       everything between. */
    bat: {
      cols: ['H', 'HR'],
      rows: [
        ['Babe Ruth',   1000, 5],   // rank 1
        ['Lou Gehrig',  1000, 4],   // rank 1, ties Ruth on H
        ['Hank Aaron',   998, 3],   // rank 3
        ['Willie Mays',  997, 2],   // rank 4
        ['Barry Bonds',  996, 1],   // rank 5
        ['Bobby Bonds',  995, 0],   // rank 6, shared last name, zero HR
        ...fill(94, 994),           // ranks 7-100
        ['Jose Ramirez', 900, 0],   // rank 101, first of the foul band
        ...fill(24, 899),           // ranks 102-125, rest of the foul band
        ...fill(15, 875),           // ranks 126-140, the extension zone
        ...fill(10, 860),           // ranks 141-150, a strike however you cut it
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
      /* row index -> [team, career span]; only namesakes carry it */
      who: {'0': ['DET', '1953-1962'], '1': ['NYN', '1957-1974'],
            '2': ['TOR', '1994-2006'], '3': ['FLO', '1998-2014']},
    },
    /* same shape, but the two namesakes are indistinguishable */
    dupblind: {
      cols: ['H'],
      rows: [['Smith', 50], ['Smith', 45], ['Willie Mays', 30]],
    },
  },
  cats: {
    bat_h:   {side: 'bat', col: 'H',    label: 'Hits',      abbr: 'H',    depth: 3, dir: 'desc'},
    bat_h6:  {side: 'bat', col: 'H',    label: 'Hits Deep', abbr: 'H',    depth: 150, dir: 'desc'},
    bat_hr:  {side: 'bat', col: 'HR',   label: 'Home Runs', abbr: 'HR',   depth: 3, dir: 'desc'},
    pit_em:  {side: 'pit', col: 'ERAm', label: 'ERA-',      abbr: 'ERA-', depth: 2, dir: 'asc'},
    dup_h:   {side: 'dup', col: 'H',    label: 'Dup Hits',  abbr: 'H',    depth: 7, dir: 'desc'},
    blind_h: {side: 'dupblind', col: 'H', label: 'Blind',   abbr: 'H',    depth: 3, dir: 'desc'},
  },
});

/* every shipped side carries `ids`; the fixture has to as well, or the pool
   entries come back with a null player id and the breakdowns have nothing to
   attribute to */
function withIds(f){
  let base = 0;
  for (const s of Object.values(f.sides)){
    s.ids = s.rows.map((_, i) => base + i);
    base += s.rows.length;
  }
  return f;
}

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
  /* a series left over from an earlier group would rotate the opening pick
     and force one-pick games; every ordinary game starts from a clean slate */
  app.S.SR = null; app.S.fmt.on = false; app.S.fmt.ws = false;
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
eq(app.norm('C. J. Cron'), 'cj cron', 'norm joins spaced initials — Lahman writes them apart');
eq(app.norm('CJ Cron'), 'cj cron', 'and typing them together lands in the same place');
eq(app.norm('C.J. Cron'), 'cj cron', 'as does the half-spaced spelling');
eq(app.norm('J. D. Martinez'), 'jd martinez', 'same for any two initials');
eq(app.norm('w mays'), 'w mays', 'a lone initial is left alone, so first-initial search still works');
eq(app.norm('A. B. C. Smith'), 'abc smith', 'a longer run joins too');
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
  eq(P.board.map(e => e.rank).slice(0, 3), [1, 1, 3], 'ties share a rank, next rank skips');
  eq(P.board.map(e => e.name).slice(0, 3), ['Babe Ruth', 'Lou Gehrig', 'Hank Aaron'], 'board leads with the best');
  eq(P.depth, 100, 'only the top 100 score');
  eq(P.foulTo, 125, 'and 101-125 is the foul band');
  eq(P.board.length, 100, 'the board holds exactly those 100');
  eq(P.board[P.board.length - 1].rank, 100, 'ending at rank 100');
  eq(P.foul.length, 25, 'twenty-five in the foul band');
  eq(P.foul.map(e => e.rank), Array.from({length: 25}, (_, i) => 101 + i), 'ranks 101 to 125');
  eq(P.total, 150, 'total counts everyone with a value');
  ok(P.board.every(e => e.rank <= 100), 'nothing past 100 can score');
  ok(P.foul.every(e => e.rank > 100 && e.rank <= 125), 'nothing inside 100 is a foul');
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
  eq(P.board.map(e => e.name), ['Pedro Martinez', 'Greg Maddux', 'Roger Clemens'], 'asc category sorts low-first');
  eq(P.board.map(e => e.rank), [1, 2, 3], 'asc ranks ascend');
  eq(P.foul.length, 0, 'a short list has no foul band at all');
}
{
  /* names Lahman writes with spaced initials have to be reachable */
  {
    const P = poolFor(app, 'bat_h');
    ok(!!P, 'fixture builds');
  }
  /* the whole point of the change: how deep the list is ranked must not move
     the scoring cut. `bat_h6` ranks 130 deep, `bat_h` claims 3. Same board. */
  const shallow = poolFor(app, 'bat_h'), deep = poolFor(app, 'bat_h6');
  eq(shallow.board.length, deep.board.length, 'list depth does not change the cut');
  eq(shallow.foul.map(e => e.rank), deep.foul.map(e => e.rank), 'nor the foul band');
  eq(deep.listDepth, 150, 'the list depth is still carried, for reporting a miss');

  /* rank 126 and beyond is off the board even though it is in the data */
  const past = deep.byName.get(('Filler ' + alpha(865)).toLowerCase());
  ok(past && past[0].zone === 'off', 'rank 126+ sits off the board');
  eq(past && past[0].rank, 136, 'but keeps its real rank so a strike can report it');
  eq(past && past[0].val, 865, 'and its real value');
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
  const r1 = app.resolve('Bob Miller');
  eq(r1.k, 'choose', 'namesakes offer a choice rather than a dead end');
  eq(r1.list.length, 2, 'both are offered');
  eq(r1.list.map(e => e.who), [['DET', '1953-1962'], ['NYN', '1957-1974']],
     'each option carries team and career span');
  ok(r1.list.every(e => e.who[0] && e.who[1]), 'no option is unlabelled');
  eq(app.resolve('miller').k, 'choose', 'bare last name reaches the same chooser');

  /* choosing is just scoring the entry the player picked */
  app.score(r1.list[1]); app.__drain();
  eq(G.players[0].pts, 2, 'the chosen man scores his own rank, not the better one');
  const r2 = app.resolve('Bob Miller');
  eq(r2.k, 'hit', 'with one drafted the survivor needs no chooser');
  eq(r2.e.rank, 1, 'and is the one left standing');
  app.score(r2.e); app.__drain();
  eq(app.resolve('Bob Miller').k, 'taken', 'once both are gone the name reports as taken');

  eq(app.resolve('Alex Gonzalez').k, 'choose', 'namesakes tied on value still offer a choice');

  /* the case a first name genuinely does fix must still ask */
  const amb = app.resolve('bonds');
  eq(amb.k, 'ambiguous', 'different men sharing a last name still ask for a first name');
  eq(amb.list.length, 2, 'and both are offered');
  eq(G.pool.board.filter(e => !e.drafted).every(e => e.zone === 'board'), true, 'board intact');
}
{
  /* no metadata to tell them apart -> asking would be unanswerable, so the
     better rank is awarded rather than stranding the slots */
  const G = gameOn(app, 'blind_h', ['A', 'B']);
  const r = app.resolve('Smith');
  eq(r.k, 'hit', 'indistinguishable namesakes fall back to awarding');
  eq(r.e.rank, 1, 'and award the better rank');
  ok(G.pool.board.every(e => e.who === null), 'no identity data on this board');
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
  eq(G.players[0].picked.map(p => [p.n, p.r]), [['Hank Aaron', 3]], 'pick recorded with name');
  ok(G.players[0].picked[0].i != null, 'and with the player id, for the year and club breakdowns');
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

group('the cut is always on screen');
{
  /* a pick worth 153 is only legitimate if the list runs at least 153 deep,
     and the player has to be able to see that while playing */
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  eq(app.__els.get('g-depth').textContent, '100',
     'the cut is rendered in the header, not just on the opening plate');
  app.score(G.pool.board.find(e => e.rank === 3)); app.__drain();
  const sub = app.__els.get('plate-sub').innerHTML || app.__els.get('plate-sub').textContent;
  ok(/3rd of 100/.test(sub), 'a scored pick says where it landed', sub);
  eq(app.__els.get('g-depth').textContent, '100', 'and the header still shows it after a pick');
}
{
  const G = gameOn(app, 'bat_h', ['A', 'B']);
  const p = G.players[0];
  p.strikes = 2;
  app.foul(G.pool.foul[0]); app.__drain();
  const msg = app.__els.get('msg-slot').innerHTML;
  ok(/Past the top 100/.test(msg), 'a foul says what it fell past', msg);
  eq(p.strikes, 2, 'and is still free at two strikes');
}
{
  /* the invariant behind all of it, on the fixture boards */
  for (const cat of ['bat_h', 'bat_h6', 'bat_hr', 'dup_h']){
    const P = poolFor(app, cat);
    ok(P.board.every(e => e.rank <= 100), `${cat}: nothing past 100 scores`);
    ok(P.foul.every(e => e.rank > 100 && e.rank <= 125), `${cat}: the foul band is 101-125`);
  }
}

group('series');
{
  const rec = (ts, a, b) => ({ts, range: '2024', cat: 'bat_h', label: 'Hits', post: false,
    players: [{name: 'A', pts: a, picks: 1, strikes: 0, fouls: 0, ranks: [a], win: a >= b},
              {name: 'B', pts: b, picks: 1, strikes: 0, fouls: 0, ranks: [b], win: b >= a}]});
  const run = (mode, n, games) => {
    app.S.fmt = {on: true, mode, n, randCat: false, randEra: false};
    app.S.seats = ['A', 'B'];
    app.startSeries();
    let done = false, played = 0;
    for (const [a, b] of games){
      if (done) break;
      done = app.seriesTake(rec(1000 + played, a, b));
      played++;
    }
    return {done, played, sr: app.S.SR, standing: app.seriesStanding()};
  };

  eq(app.seriesTarget({mode: 'bo', n: 7}), 4, 'best of 7 needs four wins');
  eq(app.seriesTarget({mode: 'bo', n: 3}), 2, 'best of 3 needs two');
  eq(app.seriesLabel({mode: 'bo', n: 5}), 'Best of 5', 'best-of label');
  eq(app.seriesLabel({mode: 'points', n: 500}), 'First to 500 points', 'points label');
  eq(app.seriesLabel({mode: 'wins', n: 3}), 'First to 3 wins', 'wins label');

  {
    const r = run('bo', 7, [[10,1],[10,1],[1,10],[10,1],[10,1],[9,9],[9,9]]);
    ok(r.done, 'best of 7 ends as soon as someone takes four');
    eq(r.played, 5, 'after five games, not seven');
    eq(r.standing[0].name, 'A', 'and the right player leads');
    eq(r.standing[0].wins, 4, 'with four wins');
  }
  {
    const r = run('bo', 3, [[1,10],[1,10],[10,1]]);
    ok(r.done && r.played === 2, 'best of 3 ends at two straight');
    eq(r.standing[0].name, 'B', 'won by B');
  }
  {
    const r = run('wins', 3, [[10,1],[1,10],[10,1],[1,10],[10,1],[10,1]]);
    ok(r.done, 'first to 3 wins ends');
    eq(r.standing[0].wins, 3, 'at exactly three');
    eq(r.played, 5, 'taking five games to get there');
  }
  {
    const r = run('points', 500, [[200,100],[200,100],[200,100]]);
    ok(r.done, 'first to 500 points ends');
    eq(r.played, 3, 'when the running total crosses');
    eq(r.standing[0].pts, 600, 'on cumulative points, not per game');
  }
  {
    const r = run('games', 4, [[10,1],[1,10],[10,1],[1,10],[10,1]]);
    ok(r.done, 'a fixed run ends');
    eq(r.played, 4, 'after exactly that many games');
    eq(r.sr.games.length, 4, 'and records that many');
  }
  {
    /* a drawn game advances nobody - crediting both let a best-of-3 end 2-2 */
    const r = run('games', 2, [[5,5],[7,7]]);
    ok(r.done, 'ties do not stall a fixed run');
    eq(r.standing.map(x => x.wins), [0, 0], 'a drawn game is a win for neither');
    eq(r.standing.map(x => x.pts), [12, 12], 'but the points still count');
    ok(r.sr.games.every(g => g.drawn), 'and both games are marked drawn');
  }
  {
    const r = run('bo', 3, [[5,5],[5,5],[5,5]]);
    eq(r.played, 3, 'a best-of-3 of nothing but draws still stops at three');
    ok(r.done, 'and ends');
    eq(r.standing.map(x => x.wins), [0, 0], 'with nobody having won one');
  }
  {
    const r = run('bo', 5, [[10,1],[10,1],[10,1]]);
    eq(r.sr.games[0].scores.map(s => s.pts), [10, 1], 'each game keeps its own scores');
    eq(r.sr.games.length, 3, 'and every game played is kept');
  }
}
{
  /* series fields ride on ordinary game records, so nothing else has to change */
  app.setRecords([
    {ts: 1, sid: 900, sno: 1, smode: 'bo', sn: 3, range: '2024', label: 'Hits', players: [
      {name: 'A', pts: 40, picks: 2, strikes: 0, fouls: 0, ranks: [20, 20], win: true},
      {name: 'B', pts: 10, picks: 1, strikes: 1, fouls: 0, ranks: [10], win: false}]},
    {ts: 2, sid: 900, sno: 2, smode: 'bo', sn: 3, range: '2024', label: 'Hits', players: [
      {name: 'A', pts: 30, picks: 1, strikes: 0, fouls: 0, ranks: [30], win: true},
      {name: 'B', pts: 20, picks: 1, strikes: 0, fouls: 0, ranks: [20], win: false}]},
    {ts: 3, range: '1998', label: 'Runs', players: [                       // a loose game
      {name: 'A', pts: 5, picks: 1, strikes: 0, fouls: 0, ranks: [5], win: true}]},
  ]);
  const car = app.careerStats().find(r => r.name === 'A');
  eq(car.games, 3, 'career stats count series games and loose games alike');
  eq(car.pts, 75, 'and sum them all');
  const P = app.profileFor('A');
  eq(P.games, 3, 'profiles are unaffected by the series fields');
  app.renderSeriesHistory();
  const html = app.__els.get('ser-history').innerHTML;
  ok(/Best of 3/.test(html), 'series history names the format', html.slice(0, 80));
  ok(/2 games/.test(html), 'and how many games it ran');
  ok(/A 2/.test(html), 'and the winner with their tally');
  ok(!/Runs/.test(html), 'the loose game is not shown as a series');
}

group('misses are out of play');
{
  const G = gameOn(app, 'bat_h', ['A', 'B']);
  const foulMan = G.pool.foul[0];
  app.foul(foulMan); app.__drain();
  ok(foulMan.missed, 'a fouled player is marked missed');
  eq(G.misses.length, 1, 'and lands on the miss list');
  eq(G.misses[0].kind, 'foul', 'tagged as a foul');

  const before = G.players.map(p => p.strikes);
  const again = app.resolve(foulMan.name);
  eq(again.k, 'missed', 'naming him again is neither a foul nor a strike');
  app.submitGuess();
  eq(G.players.map(p => p.strikes), before, 'nobody is charged for it');

  /* a struck-out player is burned the same way */
  const deep = G.pool.byName.get(('Filler ' + alpha(865)).toLowerCase());
  const off = deep && deep[0];
  ok(off && off.zone === 'off', 'found an off-board player to strike on');
  app.strike('x', off); app.__drain();
  ok(off.missed, 'a struck-out player is marked missed');
  eq(app.resolve(off.name).k, 'missed', 'and naming him again costs nothing');
  ok(G.misses.some(m => m.kind === 'strike'), 'strikes join the miss list');
  ok(G.misses.some(m => m.name === off.name), 'by name, so the board can show them');

  /* a strike on a name nobody recognises still counts against you */
  const s0 = G.players[app.seat()].strikes;
  app.strike('Zzzqqq', null); app.__drain();
  ok(G.misses.some(m => m.real === false), 'an unrecognised name is logged as a miss too');
}

group('breakdowns');
{
  app.setRecords([
    {ts: 10, range: '2000-2025', y0: 2000, y1: 2025, cat: 'bat_h', label: 'Hits', post: false,
     players: [{name: 'Carson', pts: 60, picks: 2, strikes: 1, fouls: 0, ranks: [20, 40],
                picked: [{n: 'A', r: 20, i: 1}, {n: 'B', r: 40, i: 2}], win: true},
               {name: 'Sam', pts: 10, picks: 1, strikes: 2, fouls: 1, ranks: [10],
                picked: [{n: 'C', r: 10, i: 3}], win: false}],
     misses: [{n: 'Dud', r: 400, k: 'strike', by: 'Carson'}]},
    {ts: 20, range: '1998', y0: 1998, y1: 1998, cat: 'bat_hr', label: 'Home Runs', post: false,
     players: [{name: 'Carson', pts: 25, picks: 1, strikes: 0, fouls: 0, ranks: [25],
                picked: [{n: 'D', r: 25, i: 4}], win: true}]},
  ]);
  /* a stand-in index: player 1 played four seasons for two clubs, 2 and 3 one each */
  app.PX.played = {y: {1: [2000, 2001, 2002, 2003], 2: [2010], 3: [2020], 4: [1998]},
                   f: {1: {NYY: 3, BOS: 1}, 2: {LAD: 1}, 3: {SFG: 1}, 4: {NYY: 1}}};
  app.PX.clubs = {NYY: {name: 'New York Yankees'}, BOS: {name: 'Boston Red Sox'},
                  LAD: {name: 'Los Angeles Dodgers'}, SFG: {name: 'San Francisco Giants'}};

  const P = app.profileFor('Carson');
  eq(P.games, 2, 'both games counted');
  eq(P.pts, 85, 'points summed');

  /* year split: pick worth 20 over 4 seasons = 5 each; pick worth 40 over 1 = 40 */
  const yr = Object.fromEntries(P.yearList);
  eq(yr[2000], 5, 'a pick is shared evenly across the seasons he played');
  eq(yr[2001], 5, 'every one of them');
  eq(yr[2010], 40, 'a single-season player takes the whole pick');
  const yearTotal = P.yearList.reduce((a, [, v]) => a + v, 0);
  ok(Math.abs(yearTotal - P.pts) < 1e-9,
     `the season chart reconciles with total points (${yearTotal} vs ${P.pts})`);

  eq(yr[1998], 25, 'a pick from another era lands in its own season');
  const cl = Object.fromEntries(P.clubList);
  ok(Math.abs(cl.NYY - (20 * 3 / 4 + 25)) < 1e-9, 'clubs split by seasons served, not evenly');
  ok(Math.abs(cl.BOS - (20 / 4)) < 1e-9, 'the shorter stay gets the smaller share');
  const clubTotal = P.clubList.reduce((a, [, v]) => a + v, 0);
  ok(Math.abs(clubTotal - P.pts) < 1e-9, 'the club chart reconciles too');

  /* per-game log */
  eq(P.log.length, 2, 'a row per game');
  eq(P.log[0].ts, 20, 'newest first');
  eq(P.log[1].pts, 60, 'carrying that game\u2019s score');
  eq(P.log[1].against.map(o => o.name), ['Sam'], 'and who it was against');
  eq(P.log[1].picked.length, 2, 'and the picks');
  eq(P.log[1].misses.length, 1, 'and the misses');
  eq(P.best, 60, 'best single game');

  /* eras graded on points per game */
  const eras = Object.fromEntries(P.eraList.map(e => [e.label, e.ppg]));
  eq(eras['2000-2025'], 60, 'era grading is points per game');
  eq(eras['1998'], 25, 'for every era played');
  eq(P.catList.every(c => typeof c.ppg === 'number'), true, 'categories carry it too');

  /* a pick whose player has no season data must not vanish from the chart */
  app.PX.played = {y: {1: [2000, 2001, 2002, 2003], 2: [2010], 3: [2020]}, f: {}};
  const Q = app.profileFor('Carson');
  const qTotal = Q.yearList.reduce((a, [, v]) => a + v, 0) + (Q.unplaced || 0);
  ok(Math.abs(qTotal - Q.pts) < 1e-9, 'unknown players are counted as unplaced, not dropped');

  ok(app.SORTERS.ppp && app.SORTERS.best && app.SORTERS.pts, 'new grading options exist');
  const rows = app.careerStats();
  const c = rows.find(r => r.name === 'Carson');
  eq(c.ppp, 85 / 3, 'points per pick');
  eq(c.best, 60, 'best game in career stats');
}
{
  /* records written before y0/y1 existed still place their picks in time */
  eq(app.recYears({range: '1970-1979'}), [1970, 1979], 'a range id yields its years');
  eq(app.recYears({range: '1998'}), [1998, 1998], 'a single season too');
  eq(app.recYears({y0: 2000, y1: 2025, range: 'whatever'}), [2000, 2025], 'explicit years win');
  eq(app.recYears({range: 'SFG_1994-2025'}), [1994, 2025], 'and a team board id parses');
}

group('rarity, first guess, streaks and divergence');
{
  eq(app.bestStreak('ppspppf'), 3, 'longest run of picks inside a game');
  eq(app.bestStreak('sss'), 0, 'no picks, no streak');
  eq(app.bestStreak(''), 0, 'nothing at all');
  eq(app.bestStreak('pppp'), 4, 'a clean sweep');
  eq(app.bestStreak(undefined), 0, 'an older record with no sequence');

  const G = (ts, rows) => ({ts, range: '2000-2025', y0: 2000, y1: 2025, cat: 'bat_h',
    label: 'Hits', post: false, players: rows});
  const pl = (name, pts, picks, strikes, picked, turns, firstOk, seq, win) =>
    ({name, pts, picks, strikes, fouls: 0, ranks: picked.map(p => p.r), picked,
      turns, firstOk, seq, win});

  app.setRecords([
    G(1, [pl('Carson', 30, 2, 1, [{n: 'Common', r: 10, i: 1}, {n: 'Deep', r: 20, i: 2}], 3, 2, 'pps', true),
          pl('Sam',    10, 1, 2, [{n: 'Common', r: 10, i: 1}], 3, 0, 'spp'.slice(0,1) + 'ss', false)]),
    G(2, [pl('Carson', 20, 1, 0, [{n: 'Common', r: 20, i: 1}], 1, 1, 'p', true),
          pl('Sam',    15, 1, 1, [{n: 'Alsodeep', r: 15, i: 3}], 2, 1, 'ps', false)]),
  ]);
  app.PX.played = {y: {1: [2001], 2: [2010, 2011], 3: [2020]}, f: {}};

  const RX = app.rarityIndex();
  eq(RX.people.size, 2, 'two drafters on record');
  eq(RX.of('i1', 'carson'), 0, 'a player the other one also names is worth no rarity');
  eq(RX.of('i2', 'carson'), 1, 'a player nobody else has named is fully rare');
  eq(RX.of('i3', 'carson'), 0, 'and one only they have named is not yours to claim');
  /* rarity is always "how rare would this be for the person who named him" —
     Deep is rare to Carson because Sam never found him, and not rare to Sam
     because Carson did */
  eq(RX.of('i2', 'sam'), 0, 'the same player is not rare to somebody the other one already knows');
  eq(RX.of('i9', 'carson'), 1, 'an unseen player is rare by definition');

  const C = app.profileFor('Carson');
  eq(C.rarePts, 20, 'rarity points are rank times the share of others who missed him');
  ok(C.rareList.length === 3, 'every pick is scored for rarity');
  eq(C.rareList[0].name, 'Deep', 'the rarest is listed first');
  eq(C.rarePts <= C.pts, true, 'and rarity can never exceed the points actually scored');

  eq(C.turns, 4, 'turns counted');
  eq(C.firstOk, 3, 'first-attempt hits counted');
  eq(Math.round(C.first * 100), 75, 'first-guess accuracy');
  eq(C.streak, 2, 'best streak inside a single game');

  const eras = C.eraList.filter(e => e.label === '2000-2025');
  eq(eras.length, 1, 'one era played');
  eq(Math.round(eras[0].first * 100), 75, 'first-guess accuracy per era');
  eq(eras[0].ppg, 25, 'and era grading stays points per game');

  /* streaks must not run across games: two games of 'p' each is a streak of 1 */
  app.setRecords([G(1, [pl('Solo', 10, 1, 0, [{n: 'A', r: 10, i: 1}], 1, 1, 'p', true)]),
                  G(2, [pl('Solo', 10, 1, 0, [{n: 'B', r: 10, i: 2}], 1, 1, 'p', true)])]);
  eq(app.profileFor('Solo').streak, 1, 'a streak does not carry across games');
  eq(app.profileFor('Solo').rareAvg, null, 'rarity needs somebody to compare against');
  eq(app.profileFor('Solo').rarePts, 0, 'and scores nothing on your own');

  /* careerStats has to carry the same four, or the records list sorts on
     undefined - which is exactly what it was doing */
  app.setRecords([
    G(1, [pl('Carson', 30, 2, 1, [{n: 'Common', r: 10, i: 1}, {n: 'Deep', r: 20, i: 2}], 3, 2, 'pps', true),
          pl('Sam',    10, 1, 2, [{n: 'Common', r: 10, i: 1}], 3, 0, 'sss', false)]),
  ]);
  const cs = app.careerStats();
  const car = cs.find(r => r.name === 'Carson');
  ok(Number.isFinite(car.rarePts), 'career rarity is a number, not NaN');
  eq(car.rarePts, 20, 'and matches the profile');
  eq(car.turns, 3, 'career turns');
  eq(Math.round(car.first * 100), 67, 'career first-guess accuracy');
  eq(car.streak, 2, 'career best streak');
  ok(cs.every(r => Number.isFinite(r.rarePts) && Number.isFinite(r.streak)
                && Number.isFinite(r.first)), 'every row is sortable on the new columns');
  for (const k of ['rare', 'first', 'streak'])
    ok(Number.isFinite(app.SORTERS[k](cs[0], cs[1] || cs[0])), `SORTERS.${k} compares cleanly`);
}
{
  /* the divergence chart */
  const mk = (ts, cPicked, sPicked) => ({ts, range: '2000-2025', y0: 2000, y1: 2025,
    cat: 'bat_h', label: 'Hits', post: false, players: [
      {name: 'Carson', pts: 10, picks: 1, strikes: 0, fouls: 0, ranks: [10], picked: cPicked, win: true},
      {name: 'Sam', pts: 10, picks: 1, strikes: 0, fouls: 0, ranks: [10], picked: sPicked, win: false}]});
  app.setRecords([mk(1, [{n: 'Old', r: 40, i: 1}], [{n: 'New', r: 30, i: 3}])]);
  app.PX.played = {y: {1: [2001], 3: [2020]}, f: {}};
  const P = app.profileFor('Carson');
  eq(P.h2hList.length, 1, 'one opponent');
  const yrs = Object.fromEntries(P.h2hList[0].years);
  eq(yrs[2001], [40, 0], 'a season only you scored in shows on your side alone');
  eq(yrs[2020], [0, 30], 'and theirs on theirs');
  const html = app.diverge(P.h2hList[0]);
  ok(/dv-bar mine/.test(html) && /dv-bar theirs/.test(html), 'the chart draws both sides');
  ok(/2001/.test(html) && /2020/.test(html), 'labelled by season');
  ok(/No season data/.test(app.diverge({years: [], games: 1, name: 'X'})),
     'and says so when there is nothing to draw');
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
  const G = gameOn(app, 'blind_h', ['A', 'B']);   // a three-man board, so it empties
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
group('names as people actually type them');
{
  const d = JSON.parse(fs.readFileSync(path.join(DATA, '2000-2025.json'), 'utf8'));
  app.S.data = d; app.S.catId = 'bat_h'; app.S.rangeId = '2000-2025';
  app.S.post = false; app.S.seats = ['A', 'B']; app.S.rounds = 12;
  app.startGame(); app.__drain();

  /* the reported bug: "CJ Cron" said he never played. He did. */
  for (const q of ['CJ Cron', 'C.J. Cron', 'c j cron', 'C. J. Cron']){
    const r = app.resolve(q);
    ok(r.k !== 'none', `"${q}" finds someone`);
    ok(r.e && r.e.name === 'C. J. Cron', `"${q}" finds the right man`, r.e && r.e.name);
  }
  const jd = app.resolve('JD Martinez');
  ok(jd.k === 'hit' && /Martinez/.test(jd.e.name), 'JD Martinez lands on the board');

  /* how many of the spaced-initial players are now reachable at all */
  const P = app.S.G.pool;
  const spaced = [];
  for (const list of P.byName.values())
    for (const e of list) if (/^[A-Z]\. [A-Z]\. /.test(e.name)) spaced.push(e.name);
  const uniq = [...new Set(spaced)];
  ok(uniq.length > 20, `${uniq.length} spaced-initial players in this era`);
  /* "J. J. Hardy" as a person would type it: "JJ Hardy" */
  const typed = n => n.replace(/\./g, '').replace(/\b([A-Z]) ([A-Z])\b/g, '$1$2');
  const unreachable = uniq.filter(n => app.resolve(typed(n)).k === 'none');
  eq(unreachable.slice(0, 3), [], 'every one of them answers to the run-together spelling');
  const wrongMan = uniq.filter(n => {
    const r = app.resolve(typed(n));
    return r.e && r.e.name !== n && r.k !== 'choose';
  });
  eq(wrongMan.slice(0, 3), [], 'and none of them resolves to somebody else');
}
{
  /* display names that differ but normalise the same must still offer a choice,
     not be silently awarded - "Jose Lopez" and "José Lopez" are two men */
  const d = JSON.parse(fs.readFileSync(path.join(DATA, '2000-2025.json'), 'utf8'));
  const rows = d.sides.bat.rows, who = d.sides.bat.who || {};
  const byNorm = new Map();
  rows.forEach((r, i) => {
    const k = app.norm(r[0]);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(i);
  });
  const shared = [...byNorm].filter(([, ix]) => ix.length > 1);
  ok(shared.length > 0, `${shared.length} normalised names cover more than one man`);
  const naked = shared.filter(([, ix]) => ix.some(i => !who[i]));
  eq(naked.slice(0, 3).map(([k]) => k), [], 'every one of them carries identity data');

  const mixed = shared.filter(([, ix]) => new Set(ix.map(i => rows[i][0])).size > 1);
  ok(mixed.length > 0, `${mixed.length} of them are spelled differently on the page`);
  ok(mixed.every(([, ix]) => ix.every(i => who[i])),
     'including the ones whose display names differ — the old rule missed these');
}

group('misspellings, mononyms and nicknames');
{
  const d = JSON.parse(fs.readFileSync(path.join(DATA, '2000-2025.json'), 'utf8'));
  app.S.data = d; app.S.catId = 'bat_h'; app.S.rangeId = '2000-2025';
  app.S.post = false; app.S.seats = ['A', 'B']; app.S.rounds = 12;
  app.startGame(); app.__drain();

  /* the reported bug: "Ichiro" was told he never played. He was third. */
  const ich = app.resolve('Ichiro');
  eq(ich.k, 'hit', 'a bare first name finds the mononym');
  eq(ich.e.name, 'Ichiro Suzuki', 'and finds the right man');
  eq(app.resolve('Ichiro Suzuki').k, 'hit', 'the full name still works');

  const ar = app.resolve('A-Rod');
  eq(ar.k, 'hit', 'a nickname resolves');
  eq(ar.e.name, 'Alex Rodriguez', 'to the right man');
  eq(app.resolve('arod').e.name, 'Alex Rodriguez', 'however it is punctuated');
  eq(app.resolve('Big Papi').e.name, 'David Ortiz', 'and so does another');

  const g = app.resolve('guerero');
  eq(g.k, 'candidates', 'a misspelling offers a list rather than a strike');
  ok(g.list.length > 1 && g.list.length <= 5, `${g.list.length} offered, capped at five`);
  ok(g.list.some(e => e.name === 'Vladimir Guerrero'), 'including the man actually meant');

  /* the whole point of drawing from the era rather than the board: being
     offered a name has to say nothing about whether that name scores */
  const probes = ['guerero', 'rodrigez', 'martines', 'jonson', 'wiliams', 'sanchz',
                  'gonzales', 'hernandes', 'ramires', 'perex', 'lopes', 'molena'];
  let offered = 0, onBoard = 0;
  for (const q of probes){
    const r = app.resolve(q);
    if (r.k !== 'candidates') continue;
    for (const e of r.list){ offered++; if (e.zone === 'board') onBoard++; }
  }
  ok(offered > 20, `${offered} names offered across the probes`);
  ok(onBoard / offered < 0.35,
     `only ${Math.round(onBoard / offered * 100)}% of them can score — the list cannot be fished`);

  /* a first name shared by hundreds is ambiguity, not a misspelling. Volume
     alone cannot tell the two apart, so the distance has to. */
  eq(app.resolve('Mike').k, 'none', 'a crowded first name offers nothing');
  eq(app.resolve('Zzzqqqwww').k, 'none', 'nor does nonsense');
}
{
  /* an alias pointing at nobody is a silent dead end, and an alias that happens
     to be somebody's actual name would shadow that man */
  const players = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'));
  const known = new Set(players.n.map(app.norm));
  const dead = Object.entries(app.ALIASES).filter(([, v]) => !known.has(v)).map(([k]) => k);
  eq(dead.slice(0, 3), [], `all ${Object.keys(app.ALIASES).length} aliases point at a real player`);
  const shadow = Object.keys(app.ALIASES).filter(k => known.has(k));
  eq(shadow.slice(0, 3), [], 'and none of them shadows a real name');
}
{
  /* choosing settles how the name was spelled and nothing else */
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  app.takeNamed(G.pool.all.find(e => e.zone === 'off')); app.__drain();
  eq(G.players[0].strikes, 1, 'a chosen name that is off the list still strikes');
}
{
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  app.takeNamed(G.pool.board.find(e => e.name === 'Hank Aaron')); app.__drain();
  eq(G.players[0].pts, 3, 'a chosen board name scores its own rank');
  eq(G.players[0].strikes, 0, 'and costs no strike');
}
{
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  app.takeNamed(G.pool.foul[0]); app.__drain();
  eq(G.players[0].fouls, 1, 'and a chosen foul-band name still fouls');
}
{
  /* the chooser may show a career span and nothing else — a rank or a stat here
     hands over the answer the game is asking for, exactly as in askChoose */
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  app.askCandidates([G.pool.board.find(e => e.name === 'Hank Aaron')], 'hank aron');
  const html = app.__els.get('confirm-slot').innerHTML;
  ok(/Hank Aaron/.test(html), 'the chooser names the candidate');
  ok(!/rank/i.test(html), 'and never says rank');
  const visible = html.replace(/<[^>]*>/g, ' ');
  ok(!/\d/.test(visible), 'no number reaches the screen — not the rank, not the stat');
}

group('past games open on the records screen');
{
  /* the game list looked tappable and did nothing: per-game detail existed only
     inside one person's profile, which is also the one place that cannot show
     everybody who played */
  app.setRecords([
    {ts: 100, range: '2000-2025', y0: 2000, y1: 2025, cat: 'bat_h', label: 'Hits', post: false,
     misses: [{n: 'Dud', r: 400, k: 'strike', by: 'Carson'},
              {n: 'Foulball', r: 105, k: 'foul', by: 'Bish'}],
     players: [{name: 'Carson', pts: 60, picks: 2, strikes: 1, fouls: 0, ranks: [20, 40],
                picked: [{n: 'Bravo', r: 40, i: 2}, {n: 'Alpha', r: 20, i: 1}], win: true},
               {name: 'Bish', pts: 10, picks: 1, strikes: 1, fouls: 1, ranks: [10],
                picked: [{n: 'Charlie', r: 10, i: 3}], win: false}]},
  ]);
  app.renderRecords();
  const html = app.__els.get('hist-list').innerHTML;
  ok(/data-hist="0"/.test(html), 'a past game is a button, not an inert div');
  ok(/id="hist-body-0"/.test(html), 'with a body to open');
  ok(/hist-body-0" class="hidden"|class="hist-body hidden"/.test(html), 'closed to begin with');
  ok(html.indexOf('Carson') < html.indexOf('Bish'), 'drafters listed best first');
  ok(/Alpha/.test(html) && /Bravo/.test(html) && /Charlie/.test(html),
     'every drafter’s picks are shown, which a single profile cannot do');
  ok(html.indexOf('Alpha') < html.indexOf('Bravo'), 'picks sorted by rank');
  ok(/Dud/.test(html) && /Foulball/.test(html), 'and the misses too');
  eq(app.__els.get('hist-tap').textContent, 'Tap any game for who picked what.',
     'and the screen says the row opens');
}
{
  /* the shapes actually sitting in people's records */
  const modern = {misses: [{n: 'Dud', r: 400, k: 'strike', by: 'Carson'}]};
  const p = {name: 'Carson', pts: 60, picks: 2, strikes: 1, fouls: 0, ranks: [20, 40],
             picked: [{n: 'Alpha', r: 20}, {n: 'Bravo', r: 40}]};
  ok(/Alpha/.test(app.histPicks(modern, p)), 'a modern record lists its picks by name');
  ok(/Dud/.test(app.histPicks(modern, p)), 'and its misses');

  /* records written before picks carried names — only `ranks` survived */
  const old = {players: []};
  const oldP = {name: 'Carson', pts: 60, picks: 2, strikes: 1, fouls: 0, ranks: [20, 40]};
  const oldHtml = app.histPicks(old, oldP);
  ok(/recorded before names were kept/.test(oldHtml),
     'an older record says why it has no names rather than looking empty');
  ok(/misses were not recorded/.test(oldHtml),
     'and says the misses were never stored rather than implying there were none');

  /* a genuinely empty game is a third thing again */
  const none = app.histPicks({misses: []}, {name: 'Carson', pts: 0, picks: 0, strikes: 3, fouls: 0, ranks: [], picked: []});
  ok(/nothing landed/.test(none), 'and a real blank still reads as a blank');
  ok(!/recorded before/.test(none), 'without borrowing the older-record wording');
}

group('solo practice');
{
  /* one drafter is an ordinary game with nobody else in it: same board, same
     rules, same scoring. The engine already handled it; only the records had
     to learn that nothing is won. */
  const G = gameOn(app, 'bat_h6', ['Solo']);
  eq(G.players.length, 1, 'a game can be started with one drafter');
  eq(app.order(0), [0], 'the snake order is just the one seat');
  eq(app.order(1), [0], 'in both directions');
  app.score(G.pool.board.find(e => e.name === 'Hank Aaron')); app.__drain();
  eq(G.players[0].pts, 3, 'a solo pick scores its rank as usual');
  ok(!G.players[0].out, 'and play carries on');
}
{
  /* three strikes ends a solo game rather than hanging: alive() hits zero */
  app.setRecords([]);
  const G = gameOn(app, 'bat_h6', ['Solo']);
  for (let i = 0; i < 3; i++){
    app.S.G.pos = 0; app.S.G.round = 0;
    app.strike('nobody', null); app.__drain();
  }
  ok(G.players[0].out, 'three strikes puts the solo player out');
  ok(G.saved, 'and the game ends and is recorded rather than hanging');
  const rec = app.getRecords()[0];
  ok(rec.solo, 'the record is marked solo');
  eq(rec.players[0].win, false, 'and nothing was won — there was nobody to beat');
}
{
  /* the win column must not read as a losing streak once anyone practises */
  const rows = app.careerStats();
  const solo = rows.find(r => r.name === 'Solo');
  eq(solo.games, 1, 'a solo game still counts as a game played');
  eq(solo.wins, 0, 'with no win');
  eq(solo.solo, 1, 'but is counted as solo, so the zero is explained');
  for (const k of Object.keys(app.SORTERS))
    ok(Number.isFinite(app.SORTERS[k](rows[0], rows[0])), `sorting by ${k} still returns a number`);
}
{
  /* something to beat: the best previous attempt at this same board */
  app.setRecords([
    {ts: 1, solo: true, range: 'test', post: false, cat: 'bat_h6', label: 'Hits Deep',
     players: [{name: 'Solo', pts: 40, picks: 2, strikes: 3, fouls: 0, ranks: [], picked: [], win: false}]},
    {ts: 2, solo: true, range: 'test', post: false, cat: 'bat_h6', label: 'Hits Deep',
     players: [{name: 'Solo', pts: 90, picks: 3, strikes: 3, fouls: 0, ranks: [], picked: [], win: false}]},
    {ts: 3, solo: true, range: 'test', post: false, cat: 'bat_hr', label: 'Home Runs',
     players: [{name: 'Solo', pts: 500, picks: 9, strikes: 3, fouls: 0, ranks: [], picked: [], win: false}]},
  ]);
  const G = {players: [{name: 'Solo'}], cat: 'bat_h6', rangeId: 'test', post: false};
  eq(app.soloPriorBest(G), 90, 'the best previous solo score on this board');
  eq(app.soloPriorBest({...G, cat: 'bat_hr'}), 500, 'a different category is its own board');
  eq(app.soloPriorBest({...G, rangeId: 'other'}), null, 'and so is a different era');
  eq(app.soloPriorBest({...G, post: true}), null, 'postseason is a different board again');
  eq(app.soloPriorBest({...G, players: [{name: 'Nobody'}]}), null, 'a first attempt compares against nothing');
  eq(app.soloPriorBest({players: [{name: 'Solo'}, {name: 'Other'}], cat: 'bat_h6', rangeId: 'test', post: false}),
     null, 'and a two-player game has no solo best at all');
}
{
  /* a series needs somebody to be ahead of */
  app.S.seats = ['Solo']; app.S.fmt.on = true;
  app.renderSeats();
  eq(app.S.fmt.on, false, 'choosing one drafter turns a series off');
  app.S.seats = ['A', 'B'];
  app.renderSeats();
  ok(true, 'and two drafters render without complaint');
}

group('the foul band and the earned extension');
{
  eq([app.SCORE_TO, app.FOUL_TO, app.WIDE_TO], [100, 125, 140], 'the cut is 100, fouls run to 125, the extension to 140');
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  const at = r => G.pool.all.find(e => e.rank === r);
  ok(at(126) && at(126).zone === 'off' && at(140).zone === 'off' && at(141).zone === 'off',
     '126, 140 and 141 all sit off the board');
  ok(at(125).zone === 'foul', 'and 125 is the last foul');

  /* nobody has an extension yet: 130 is a plain strike */
  app.strike('x', at(130)); app.__drain();
  eq(G.players[0].strikes, 1, 'without an extension 130 is a strike');
  eq(G.players[0].wide, 0, 'and nothing was earned');

  /* B names a number one - Ruth and Gehrig tie at rank 1, and both count */
  app.S.G.pos = 1; app.S.G.round = 0;
  app.score(G.pool.board.find(e => e.name === 'Lou Gehrig')); app.__drain();
  const B = G.players[1];
  eq(B.wide, 1, 'naming a number-one player earns one extension');
  eq(B.wides, 1, 'and it is counted for the record');
  ok(/foul to 140/.test(app.__els.get('board').innerHTML), 'the seat panel shows it');

  /* it is kept until it matters: at no strikes a near miss is an ordinary
     strike and the extension stays in hand */
  app.S.G.pos = 1; app.S.G.round = 0;
  app.strike('x', at(135)); app.__drain();
  eq(B.strikes, 1, 'at no strikes, 135 is a strike');
  eq(B.wide, 1, 'and the extension is not spent on it');
  app.S.G.pos = 1; app.S.G.round = 0;
  app.strike('x', at(136)); app.__drain();
  eq([B.strikes, B.wide], [2, 1], 'at one strike, the same');

  /* at two strikes it is what stands between a near miss and being out */
  app.S.G.pos = 1; app.S.G.round = 0;
  const f0 = B.fouls, t0 = B.turns;
  app.strike('x', at(137)); app.__drain();
  eq(B.strikes, 2, 'at two strikes, 137 with an extension is a foul - and a foul at two strikes is free');
  ok(!B.out, 'so B is still in');
  eq([B.fouls - f0, B.turns - t0], [1, 1], 'one foul, turn over');
  eq(B.wide, 0, 'and the extension is used up');
  ok(at(137).missed, 'the man named is burned like any foul');
  const last = app.S.G.misses[app.S.G.misses.length - 1];
  eq([last.kind, last.wide], ['foul', true], 'and the miss says it was the extension that saved it');

  /* spent: the next near miss is strike three; and 141 never fouls */
  app.S.G.pos = 1; app.S.G.round = 0;
  app.strike('x', at(138)); app.__drain();
  ok(B.out && B.strikes === 3, 'with the extension gone, 138 is strike three');
  const G2 = gameOn(app, 'bat_h6', ['A']);
  const p = G2.players[0];
  p.strikes = 2; p.wide = 1;
  app.strike('x', G2.pool.all.find(e => e.rank === 145)); app.__drain();
  ok(p.out, '145 is a strike even with an extension in hand at two strikes');
  eq(p.wide, 1, 'and does not consume it');
}
{
  /* the record carries the count, and an old record without it reads as zero */
  app.setRecords([]);
  const G = gameOn(app, 'bat_h6', ['A']);
  app.score(G.pool.board.find(e => e.name === 'Babe Ruth')); app.__drain();
  app.finish();
  eq(app.getRecords()[0].players[0].wides, 1, 'the record says how many number ones were named');
  const P = app.profileFor('A');
  ok(Number.isFinite(P.pts), 'and the profile still computes');
}

group('World Series');
{
  app.S.seats = ['A', 'B'];
  app.S.fmt = {on: true, ws: true, mode: 'points', n: 500, randCat: false, randEra: false};
  app.startSeries();
  const sr = app.S.SR;
  ok(sr.ws, 'the series is marked as a World Series');
  eq([sr.mode, sr.n], ['bo', 7], 'and is a best of seven whatever the series controls said');
  eq(sr.wsn, 1, 'one player each by default');
  ok(sr.randCat && sr.randEra, 'with a random era and category every game');
  eq(app.seriesLabel(sr), 'World Series', 'labelled as such');

  /* a game inside it is one pick each, and the opening pick rotates */
  app.S.data = FIX(); app.S.catId = 'bat_h6'; app.S.rangeId = 'test'; app.S.post = false; app.S.rounds = 12;
  app.startGame(); app.__drain();
  let G = app.S.G;
  eq(G.maxRounds, 1, 'a World Series game is one round, ignoring the rounds setting');
  eq(G.first, 0, 'A opens game one');
  eq(app.order(0), [0, 1], 'so the order is A then B');
  eq(app.__els.get('g-round-lbl').textContent, 'Game', 'the header counts games, not rounds');
  eq(app.__els.get('g-round').textContent, '1/7', 'and says which of the seven this is');
  app.score(G.pool.board.find(e => e.name === 'Hank Aaron')); app.__drain();
  ok(!G.saved, 'after A picks the game is still on');
  app.score(G.pool.board.find(e => e.name === 'Willie Mays')); app.__drain();
  ok(G.saved, 'after B picks it is over - one pick each');
  const rec = app.getRecords()[app.getRecords().length - 1];
  ok(rec.sws && rec.sid === sr.id, 'the record carries the World Series flag and the series id');
  /* face down: the game stops at the turn-over and only counts once asked */
  eq(sr.games.length, 0, 'the game is not taken until the picks are turned over');
  ok(/Willie Mays/.test(app.__els.get('rv-rows').innerHTML)
     && /Hank Aaron/.test(app.__els.get('rv-rows').innerHTML), 'the reveal shows both picks');
  app.revealDone();
  eq(sr.games.length, 1, 'and the series takes it when the room has seen them');
  eq(sr.games[0].scores.find(x => x.name === 'B').win, true, 'B took game one with the deeper pick');

  app.S.data = FIX(); app.startGame(); app.__drain();
  G = app.S.G;
  eq(G.maxRounds, 1, 'still one pick each at the default');
  eq(G.first, 1, 'B opens game two');
  eq(app.order(0), [1, 0], 'so the order flips');
  eq(app.__els.get('g-round').textContent, '2/7', 'game two of seven');
}
{
  /* the end rule: four wins ends it; seven games with an outright leader ends
     it; level after seven goes to sudden death rather than a shared title */
  const rec = (ts, a, b) => ({ts, range: '2024', cat: 'bat_h', label: 'Hits', post: false,
    players: [{name: 'A', pts: a, picks: 1, strikes: 0, fouls: 0, ranks: [a], win: a >= b},
              {name: 'B', pts: b, picks: 1, strikes: 0, fouls: 0, ranks: [b], win: b >= a}]});
  const run = games => {
    app.S.seats = ['A', 'B'];
    app.S.fmt = {on: true, ws: true, mode: 'bo', n: 7, randCat: true, randEra: true};
    app.startSeries();
    let done = false, played = 0;
    for (const [a, b] of games){ if (done) break; done = app.seriesTake(rec(2000 + played, a, b)); played++; }
    return {done, played, standing: app.seriesStanding()};
  };
  let r = run([[10,1],[10,1],[10,1],[10,1],[10,1]]);
  ok(r.done && r.played === 4, 'four wins ends a World Series');
  r = run([[10,1],[1,10],[10,1],[1,10],[10,1],[1,10],[10,1]]);
  ok(r.done && r.played === 7 && r.standing[0].name === 'A', 'game seven decides a 3-3 series');
  r = run([[10,1],[1,10],[10,1],[1,10],[10,1],[1,10],[5,5],[5,5],[1,10]]);
  ok(!r.done || r.played > 7, 'level after seven is not the end');
  eq(r.played, 9, 'it goes to sudden death until somebody wins a game');
  eq(r.standing[0].name, 'B', 'and the one who does takes it');
  r = run([[10,1],[5,5],[5,5],[5,5],[5,5],[5,5],[5,5]]);
  ok(r.done && r.played === 7 && r.standing[0].name === 'A', 'one win and six draws is still an outright lead after seven');
  app.S.SR = null; app.S.fmt = {on: false, ws: false, mode: 'bo', n: 7, randCat: false, randEra: false};
}
{
  /* the era roll is balanced by kind, or five games in six are a single season */
  app.S.manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  const kinds = new Map();
  for (let i = 0; i < 300; i++){ const r = app.rollEra(false); kinds.set(r.kind, (kinds.get(r.kind) || 0) + 1); }
  eq([...kinds.keys()].sort(), ['decade', 'season', 'span'], 'every kind of range comes up');
  ok(kinds.get('span') > 40 && kinds.get('decade') > 40,
     `spans (${kinds.get('span')}) and decades (${kinds.get('decade')}) come up about as often as seasons (${kinds.get('season')}), not one time in eighteen`);
  ok([...Array(50)].every(() => app.rollEra(true).post), 'a postseason roll only lands on ranges with a postseason file');
  ok([...Array(100)].every(() => app.rollEra(false).kind !== 'custom'), 'an ordinary series never rolls a span that has to be built');
  /* the World Series may: a span nobody has a file for, capped so it arrives */
  const customs = [...Array(400)].map(() => app.rollEra(false, true)).filter(r => r.kind === 'custom');
  ok(customs.length > 50, `${customs.length} of 400 World Series rolls are a built span`);
  ok(customs.every(r => r.y1 - r.y0 + 1 >= 3 && r.y1 - r.y0 + 1 <= 12), 'between three and twelve seasons long');
  ok(customs.every(r => r.y0 >= 1920 && r.y1 <= 2025), 'and inside the data');
  ok(customs.every(r => r.id === `${r.y0}-${r.y1}`), 'with the id shape the records and recYears expect');
}
{
  /* the setup screen: a World Series needs no era, category or rounds of its own */
  app.S.seats = ['A', 'B'];
  app.S.fmt = {on: true, ws: true, mode: 'bo', n: 7, randCat: false, randEra: false};
  const hidden = new Map();
  for (const id of ['era-card', 'team-card', 'cat-card', 'rounds-card', 'series-opts', 'ws-opts'])
    app.__els.get(id).classList.toggle = (c, on) => hidden.set(id, on);
  app.syncFormat();
  ok(['era-card', 'team-card', 'cat-card', 'rounds-card'].every(id => hidden.get(id) === true), 'the era, club, category and rounds cards are hidden');
  eq(hidden.get('ws-opts'), false, 'and the World Series options are shown');
  eq(app.__els.get('start').textContent, 'Play the World Series', 'the start button says what it starts');
  app.S.seats = ['A'];
  app.syncFormat();
  ok(['era-card', 'cat-card'].every(id => hidden.get(id) === false), 'one drafter cannot play a World Series, so the cards come back');
  app.S.seats = ['A', 'B']; app.S.fmt = {on: false, ws: false, mode: 'bo', n: 7, randCat: false, randEra: false};
  app.syncFormat();
  eq(app.__els.get('start').textContent, 'Start draft', 'and a single game reads as before');
}

group('World Series: shared wins, tiebreaks and depth');
{
  const rec = (ts, scores) => ({ts, range: '2024', cat: 'bat_h', label: 'Hits', post: false,
    players: Object.entries(scores).map(([name, pts]) => ({name, pts, picks: 1, strikes: 0, fouls: 0, ranks: [pts]}))});
  const run = (names, games, wsn) => {
    app.S.seats = names;
    app.S.fmt = {on: true, ws: true, mode: 'bo', n: 7, wsn: wsn || 1, randCat: true, randEra: true};
    app.startSeries();
    let done = false, played = 0;
    for (const g of games){ if (done) break; done = app.seriesTake(rec(3000 + played, g)); played++; }
    return {done, played, sr: app.S.SR, standing: app.seriesStanding()};
  };

  /* two of three level at the top have still beaten the third, so both win */
  let r = run(['A','B','C'], [{A: 50, B: 50, C: 10}]);
  eq(r.sr.games[0].drawn, false, 'two of three tying is not a draw');
  eq(r.sr.games[0].scores.filter(s => s.win).map(s => s.name).sort(), ['A','B'], 'both leaders take a win');
  eq([r.standing[0].wins, r.standing[1].wins], [1, 1], 'and both are on one');
  eq(r.sr.wins.C, undefined, 'the drafter they beat gets nothing');

  /* the whole table level is still a draw and advances nobody */
  r = run(['A','B','C'], [{A: 50, B: 50, C: 50}]);
  eq(r.sr.games[0].drawn, true, 'everybody level is a draw');
  eq(r.sr.games[0].scores.filter(s => s.win).length, 0, 'and advances nobody');
  r = run(['A','B'], [{A: 50, B: 50}]);
  eq(r.sr.games[0].drawn, true, 'which with two drafters is the old rule, unchanged');

  /* shared wins can still finish it: four apiece is four each */
  r = run(['A','B','C'], [{A:9,B:9,C:1},{A:9,B:9,C:1},{A:9,B:9,C:1},{A:9,B:9,C:1}]);
  ok(r.done && r.played === 4, 'four shared wins ends the series');
  eq([r.standing[0].wins, r.standing[1].wins], [4, 4], 'with two champions on four');

  /* level on wins after seven: total points decides */
  /* A's wins are bigger than B's, so the totals differ even at three apiece */
  r = run(['A','B'], [{A:20,B:1},{A:1,B:9},{A:20,B:1},{A:1,B:9},{A:20,B:1},{A:1,B:9},{A:5,B:5}]);
  ok(r.done, 'three wins each and a draw in game seven still ends it');
  eq(r.played, 7, 'at seven games');
  eq(r.standing[0].wins, r.standing[1].wins, 'level on wins');
  eq([r.standing[0].name, r.standing[0].pts, r.standing[1].pts], ['A', 68, 35], 'so the higher total takes it');

  /* level on wins AND points goes to sudden death */
  r = run(['A','B'], [{A:9,B:1},{A:1,B:9},{A:9,B:1},{A:1,B:9},{A:9,B:1},{A:1,B:9},{A:5,B:5},{A:9,B:1}]);
  eq(r.played, 8, 'level on both is sudden death');
  ok(r.done && r.standing[0].name === 'A', 'until somebody leads outright');
}
{
  /* 1, 3, 5 or 7 players each: the rounds setting is ignored either way */
  for (const wsn of [1, 3, 5, 7]){
    app.S.seats = ['A','B'];
    app.S.fmt = {on: true, ws: true, mode: 'bo', n: 7, wsn, randCat: false, randEra: false};
    app.startSeries();
    eq(app.S.SR.wsn, wsn, `a World Series of ${wsn} players each carries it`);
    app.S.data = FIX(); app.S.catId = 'bat_h6'; app.S.rangeId = 'test'; app.S.post = false; app.S.rounds = 12;
    app.startGame(); app.__drain();
    eq(app.S.G.maxRounds, wsn, `and the game runs ${wsn} round${wsn === 1 ? '' : 's'}`);
  }
  /* three each: the game ends after three rounds, not twelve */
  const G = app.S.G;   // wsn 7 from the loop; rebuild at 3
  void G;
  app.S.fmt.wsn = 3; app.startSeries();
  app.S.data = FIX(); app.startGame(); app.__drain();
  const board = app.S.G.pool.board.filter(e => !e.drafted);
  for (let i = 0; i < 6 && !app.S.G.saved; i++){ app.score(board[i]); app.__drain(); }
  ok(app.S.G.saved, 'three picks each ends the game');
  eq(app.S.G.players.map(p => p.picks), [3, 3], 'three apiece');
  app.revealDone();
  eq(app.S.SR.games.length, 1, 'and it counts once turned over');
  app.S.SR = null; app.S.fmt = {on: false, ws: false, mode: 'bo', n: 7, wsn: 1, randCat: false, randEra: false};
}
{
  /* face down: nothing on the game screen tells the next picker the target */
  app.S.seats = ['A','B'];
  app.S.fmt = {on: true, ws: true, mode: 'bo', n: 7, wsn: 1, randCat: false, randEra: false};
  app.startSeries();
  app.S.data = FIX(); app.S.catId = 'bat_h6'; app.S.rangeId = 'test'; app.S.post = false; app.S.rounds = 12;
  app.startGame(); app.__drain();
  ok(app.sealed(), 'a World Series game is sealed');
  app.score(app.S.G.pool.board.find(e => e.name === 'Hank Aaron')); app.__drain();
  const board = app.__els.get('board').innerHTML, log = app.__els.get('log').innerHTML;
  ok(!/Hank Aaron/.test(board + log), 'the pick is not named anywhere on the screen');
  ok(!/>3</.test(board), 'nor its rank');
  ok(!/Aaron/.test(app.__els.get('plate-sub').textContent), 'and the plate does not give it away');
  eq(app.__els.get('plate-big').textContent, '\u2713', 'it just says a pick landed');
  app.score(app.S.G.pool.board.find(e => e.name === 'Willie Mays')); app.__drain();
  ok(/Hank Aaron/.test(app.__els.get('rv-rows').innerHTML), 'the turn-over names them');
  app.revealDone();
  app.S.SR = null; app.S.fmt = {on: false, ws: false, mode: 'bo', n: 7, wsn: 1, randCat: false, randEra: false};
}
{
  /* an ordinary game still plays face up */
  const G = gameOn(app, 'bat_h6', ['A','B']);
  ok(!app.sealed(), 'a single game is not sealed');
  app.score(G.pool.board.find(e => e.name === 'Hank Aaron')); app.__drain();
  ok(/Hank Aaron/.test(app.__els.get('log').innerHTML), 'and shows the draft list as it fills');
  eq(app.__els.get('plate-big').textContent, '3', 'and the rank on the plate');
}

group('review fixes');
{
  /* a chooser left open when a game is quit must not act on the next game */
  const G = gameOn(app, 'bat_h6', ['A', 'B']);
  app.askCandidates([G.pool.board.find(e => e.name === 'Hank Aaron')], 'hank aron');
  ok(app.__els.get('confirm-slot').innerHTML.length > 0, 'a chooser is open');
  app.finish();
  gameOn(app, 'bat_hr', ['A', 'B']);
  eq(app.__els.get('confirm-slot').innerHTML, '', 'and a new game starts without it');
}
{
  /* End game inside the hand-off timer used to finish the game twice */
  app.S.seats = ['A', 'B'];
  app.S.fmt = {on: true, ws: false, mode: 'bo', n: 3, randCat: false, randEra: false};
  app.startSeries();
  app.S.data = FIX(); app.S.catId = 'bat_h6'; app.S.rangeId = 'test'; app.S.post = false; app.S.rounds = 1;
  app.startGame(); app.__drain();
  const G = app.S.G;
  /* watch which screen is on top: the bug landed on the plain results screen
     instead of the series standings, and Play again there drops the series */
  let shown = null;
  for (const sc of ['over', 'series'])
    app.__els.get('screen-' + sc).classList.toggle = (c, hide) => { if (!hide) shown = sc; };
  app.score(G.pool.board.find(e => e.name === 'Hank Aaron')); app.__drain();   // A's pick, handed off
  app.score(G.pool.board.find(e => e.name === 'Willie Mays'));                 // B's pick: the last of the round, timer queued
  app.finish();                                                                // End game lands inside the timer
  eq(shown, 'series', 'End game in a series goes to the standings');
  const games = app.S.SR.games.length;
  app.__drain();                                                         // the queued advance fires
  eq(shown, 'series', 'and the late hand-off does not bounce it to the single-game results');
  eq(app.S.SR.games.length, games, 'nor finish the game a second time');
  ok(app.S.SR && !app.S.SR.done, 'and the series is still standing');
  for (const sc of ['over', 'series']) app.__els.get('screen-' + sc).classList.toggle = () => {};
  app.S.SR = null; app.S.fmt.on = false; app.S.rounds = 12;
}
{
  /* a stored value that parses but is not an array */
  const store = app.__store;
  store.set('offtheboard:records', '{"not":"an array"}');
  app.loadRecords();
  eq(app.getRecords(), [], 'a non-array under the records key loads as empty');
  store.set('offtheboard:records', 'null');
  app.loadRecords();
  eq(app.getRecords(), [], 'and so does null');
  store.delete('offtheboard:records');
}
{
  /* a solo best is per board, and a club board is a different board */
  app.setRecords([
    {ts: 1, solo: true, range: '2000-2025', post: false, cat: 'bat_h', teams: null,
     players: [{name: 'Solo', pts: 900, picks: 9, strikes: 3, fouls: 0, ranks: [], picked: [], win: false}]},
    {ts: 2, solo: true, range: '2000-2025', post: false, cat: 'bat_h', teams: ['SFG'],
     players: [{name: 'Solo', pts: 300, picks: 3, strikes: 3, fouls: 0, ranks: [], picked: [], win: false}]},
  ]);
  const G = {players: [{name: 'Solo'}], cat: 'bat_h', rangeId: '2000-2025', post: false};
  app.S.data = {teams: ['SFG']};
  eq(app.soloPriorBest(G), 300, 'on the Giants board the best is the Giants score');
  app.S.data = {teams: null};
  eq(app.soloPriorBest(G), 900, 'on the league board it is the league score');
  app.S.data = {teams: ['SFG', 'LAD']};
  eq(app.soloPriorBest(G), null, 'and a two-club board has no history yet');
}
{
  /* the profile merges a name regardless of case; its misses have to as well */
  app.setRecords([
    {ts: 5, range: '2024', y0: 2024, y1: 2024, cat: 'bat_h', label: 'Hits', post: false,
     misses: [{n: 'Dud', r: 400, k: 'strike', by: 'carson'}],
     players: [{name: 'carson', pts: 10, picks: 1, strikes: 1, fouls: 0, ranks: [10], picked: [{n: 'A', r: 10}], win: true}]},
    {ts: 6, range: '2024', y0: 2024, y1: 2024, cat: 'bat_h', label: 'Hits', post: false,
     misses: [{n: 'Flub', r: 500, k: 'strike', by: 'Carson'}],
     players: [{name: 'Carson', pts: 20, picks: 1, strikes: 1, fouls: 0, ranks: [20], picked: [{n: 'B', r: 20}], win: true}]},
  ]);
  app.PX.played = {y: {}, f: {}}; app.PX.ok = true;
  app.renderProfile('Carson');
  const html = app.__els.get('prof-games').innerHTML;
  ok(/Dud/.test(html) && /Flub/.test(html), 'misses from both spellings of the name show on the profile');
}

group('an empty breakdown says which kind of empty');
{
  /* picks recorded before the app stored a player id cannot be placed in a
     season or a club. Telling somebody with plenty of picks that they have none
     reads as a bug, which is what it looked like. */
  app.setRecords([
    {ts: 30, range: '2010-2019', y0: 2010, y1: 2019, cat: 'bat_h', label: 'Hits', post: false,
     players: [{name: 'Carson', pts: 30, picks: 2, strikes: 0, fouls: 0, ranks: [10, 20],
                picked: [{n: 'A', r: 10}, {n: 'B', r: 20}], win: true}]},
  ]);
  app.PX.played = {y: {1: [2011]}, f: {1: {NYY: 1}}}; app.PX.ok = true; app.PX.clubs = {};
  const P = app.profileFor('Carson');
  eq(P.idless, 2, 'picks with no player id are counted');
  eq(P.yearList.length, 0, 'and none of them can be placed');
  app.S.profName = 'Carson';
  app.renderProfile('Carson');
  const html = app.__els.get('prof-years').innerHTML;
  ok(/recorded before/i.test(html), 'the screen says why they are missing');
  ok(!/No successful picks/i.test(html), 'rather than claiming there were none');
}
{
  /* a season index that would not load is a third thing again, and cache-first
     on /data/ means a cached 404 would otherwise persist silently */
  app.PX.played = {y: {}, f: {}}; app.PX.ok = false;
  app.renderProfile('Carson');
  ok(/could not be loaded/i.test(app.__els.get('prof-years').innerHTML),
     'a missing season index says so instead');
}
{
  /* mixed old and new: the note must not claim to reconcile with points it left out */
  app.setRecords([
    {ts: 40, range: '2010-2019', y0: 2010, y1: 2019, cat: 'bat_h', label: 'Hits', post: false,
     players: [{name: 'Carson', pts: 30, picks: 2, strikes: 0, fouls: 0, ranks: [10, 20],
                picked: [{n: 'A', r: 10, i: 1}, {n: 'B', r: 20}], win: true}]},
  ]);
  app.PX.played = {y: {1: [2011]}, f: {1: {NYY: 1}}}; app.PX.ok = true;
  const P = app.profileFor('Carson');
  eq(P.idless, 1, 'the one placeless pick is counted');
  eq(P.idlessPts, 20, 'along with its points');
  app.renderProfile('Carson');
  const note = app.__els.get('prof-years-note').textContent;
  ok(/add up to his 10 points/.test(note), 'the note claims only what it actually placed');
  ok(/1 older pick could not be placed/.test(note), 'and says what it left out');
}

group('shipped data');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  ok(Array.isArray(manifest.ranges), 'manifest has a ranges array');
  eq(manifest.ranges.length, 124, 'manifest lists 124 ranges');

  /* the shared tables the custom-range aggregator reads are not ranges */
  const GLOBAL = new Set(['manifest.json', 'cats.json', 'players.json',
                          'league.json', 'awards.json', 'played.json']);
  GLOBAL.forEach(g => ok(fs.existsSync(path.join(DATA, g)), `${g} is shipped`));
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json') && !GLOBAL.has(f));

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
  const files = fs.readdirSync(DATA).filter(f => RANGE_FILE.test(f));
  const bad = [];
  let built = 0, sharedBoards = 0, sharedSlots = 0, chooseable = 0, awarded = 0;
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
      if (P.board.some(e => e.rank > 100)) bad.push(`${f} ${id} a board player ranked past 100`);
      if (P.foul.some(e => e.rank <= 100 || e.rank > 125)) bad.push(`${f} ${id} foul band outside 101-125`);
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
          /* either the player is offered the choice, or - when the data cannot
             tell the namesakes apart - one is awarded outright. Never a dead end. */
          if (r.k === 'choose') chooseable++;
          else if (r.k === 'hit') awarded++;
          else bad.push(`${f} ${id} "${name}" resolves as ${r.k}, not draftable`);
          /* Lahman has no debut/finalGame for some Negro League players, so an
             option may carry a team and no span. What must hold is that every
             option says *something* and no two say the same thing. */
          if (r.k === 'choose'){
            const tags = r.list.map(e => (e.who || []).filter(Boolean).join(' '));
            if (tags.some(t => !t)) bad.push(`${f} ${id} "${name}" offered a blank option`);
            if (new Set(tags).size !== tags.length)
              bad.push(`${f} ${id} "${name}" offered two identical options`);
          }
        }
      }
    }
  }
  console.log(`   (${built} category boards built; ${sharedBoards} carry ${sharedSlots} shared-name slots)`);
  console.log(`   (${chooseable} contested names offer a choice, ${awarded} auto-awarded for want of identity data)`);
  eq(bad.slice(0, 5), [], 'every shipped category builds a sane, fully draftable board');
}

/* ===================================================== custom year ranges */
/* The shipped decades and spans are ground truth: rebuilding each one through
   the client aggregator must reproduce it cell for cell. If these pass, an
   arbitrary range like 1963-1977 is built by exactly the same arithmetic. */
async function customRanges(){
  group('custom ranges vs the shipped ones');
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  const multi = manifest.ranges.filter(r => r.y1 > r.y0);
  const seasons = manifest.ranges.filter(r => r.y1 === r.y0);

  const strip = d => {
    const c = JSON.parse(JSON.stringify(d));
    for (const s of Object.values(c.sides)) delete s.who;   // team is per-range; see below
    return c;
  };

  let checked = 0;
  const mismatch = [];
  for (const r of multi.concat(seasons.slice(0, 6))){
    const built = await app.buildCustom(r.y0, r.y1, false);
    const want = JSON.parse(fs.readFileSync(path.join(DATA, `${r.id}.json`), 'utf8'));
    checked++;
    if (!built){ mismatch.push(`${r.id}: nothing built`); continue; }
    const a = strip(built), b = strip(want);
    if (JSON.stringify(a.cats) !== JSON.stringify(b.cats)) mismatch.push(`${r.id}: cats`);
    for (const k of Object.keys(b.sides)){
      if (!a.sides[k]){ mismatch.push(`${r.id}: missing side ${k}`); continue; }
      for (const field of ['cols', 'rows', 'ids'])
        if (JSON.stringify(a.sides[k][field]) !== JSON.stringify(b.sides[k][field]))
          mismatch.push(`${r.id}.${k}.${field}`);
    }
    if (Object.keys(a.sides).length !== Object.keys(b.sides).length)
      mismatch.push(`${r.id}: side count`);
  }
  console.log(`   (${checked} shipped ranges rebuilt from season files)`);
  eq(mismatch.slice(0, 6), [], 'every shipped multi-year range rebuilds cell for cell');

  const dec = await app.buildCustom(1970, 1979, false);
  const shipped = JSON.parse(fs.readFileSync(path.join(DATA, '1970-1979.json'), 'utf8'));
  eq(dec.cats.bat_h.depth, shipped.cats.bat_h.depth, 'depth is recomputed, not guessed');
  eq(dec.sides.pit.cols.includes('ERAm'), true, 'ERA- is rebuilt for the range');
  eq(dec.cats.pit_era.label, shipped.cats.pit_era.label, 'and carries the same innings qualifier');
  ok(!!dec.sides.awd, 'a ten-season range gets the awards board');

  const short = await app.buildCustom(1963, 1971, false);
  ok(!short.sides.awd, 'a nine-season range does not');

  /* the point of the whole exercise: a range nobody precomputed */
  const odd = await app.buildCustom(1963, 1977, false);
  ok(!!odd, '1963-1977 builds');
  eq(odd.label, '1963–1977', 'and labels itself');
  ok(Object.keys(odd.cats).length > 20, 'with a full slate of categories');
  app.S.data = odd; app.S.catId = 'bat_h';
  const P = app.buildPool();
  eq(P.board[0].rank, 1, 'its board starts at rank 1');
  ok(P.board.length === P.depth, 'and is cut to its own depth');
  ok(P.board[0].val >= P.board[P.board.length - 1].val, 'sorted');

  /* era gates still apply from the range start, not the season files */
  const early = await app.buildCustom(1930, 1945, false);
  ok(!early.cats.bat_gidp, 'GIDP stays gated for a range starting before 1940');
  const late = await app.buildCustom(1955, 1970, false);
  ok(!!late.cats.bat_ibb, 'and appears for one starting after 1955');

  /* namesakes remain separable in a custom range */
  const g = await app.buildCustom(1994, 2005, false);
  app.S.data = g; app.S.catId = 'bat_rbi';
  app.S.rangeId = '1994-2005'; app.S.post = false; app.S.seats = ['A', 'B']; app.S.rounds = 12;
  app.startGame(); app.__drain();
  /* a 100-deep board carries far fewer namesakes than the old 500-deep one, so
     sweep every category of the range rather than betting on one */
  let shared = 0, bad = [], spanned = 0;
  for (const cid of Object.keys(g.cats)){
    app.S.catId = cid; app.startGame(); app.__drain();
    const counts = new Map();
    for (const e of app.S.G.pool.board) counts.set(e.name, (counts.get(e.name) || 0) + 1);
    for (const [name, n] of counts){
      if (n < 2) continue;
      shared++;
      const r = app.resolve(name);
      if (!['choose', 'hit'].includes(r.k)) bad.push(`${cid} "${name}" -> ${r.k}`);
      if (r.k === 'choose' && r.list.every(e => e.who && e.who[1])) spanned++;
    }
  }
  ok(shared > 0, `1994-2005 carries namesakes inside the top 100 (${shared} across its categories)`);
  eq(bad.slice(0, 3), [], 'and every one of them is draftable');
  ok(spanned > 0 || shared === 0, 'chooser options carry a career span');
}

/* ======================================================== team boards */
async function teamBoards(){
  group('team boards');
  await app.loadTeamIndex();
  app.S.manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  app.S.rangeId = '1994-2025'; app.S.custom = null; app.S.post = false;

  const only   = await app.buildTeamRange(1994, 2025, false, ['SFG']);
  const played = await app.buildTeamMembers(1994, 2025, false, ['SFG']);
  ok(!!only && !!played, 'both modes build a board');

  /* the case that separates them: a great career, a short stay */
  const find = (d, cat, name) => {
    app.S.data = d; app.S.catId = cat;
    const P = app.buildPool();
    const hit = (P.byName.get(name.toLowerCase()) || [])[0];
    return hit ? {val: hit.val, rank: hit.rank, zone: hit.zone} : null;
  };
  const rjOnly = find(only, 'pit_so', 'Randy Johnson');
  const rjAll  = find(played, 'pit_so', 'Randy Johnson');
  ok(rjOnly && rjAll, 'Randy Johnson is in both');
  ok(rjAll.val > rjOnly.val * 10,
     `his full record dwarfs his Giants stint (${rjAll.val} K vs ${rjOnly.val})`);
  ok(rjOnly.zone !== 'board', 'his Giants line does not make the club board');
  eq(rjAll.rank, 1, 'his full record tops the anyone-who-played-there board');

  eq(only.label, 'San Francisco Giants · 1994–2025', 'club board says whose it is');
  ok(/^Played for /.test(played.label), 'and the other mode says so plainly');

  ok(!only.cats.awd_as, 'a club board leaves awards out');
  ok(!!played.cats.awd_as, 'an anyone-who-played-there board keeps them');

  /* a club board must not contain anyone who never played for the club */
  const ids = await app.teamMembers(1994, 2025, ['SFG']);
  const stray = (only.sides.bat.ids || []).filter(i => !ids.has(i));
  eq(stray.slice(0, 3), [], 'nobody on the club board is a stranger to the club');

  /* every board is smaller than all of baseball, and still well-formed */
  const all = JSON.parse(fs.readFileSync(path.join(DATA, '1994-2025.json'), 'utf8'));
  ok(only.sides.bat.rows.length < all.sides.bat.rows.length, 'a club board is a subset');
  ok(played.sides.bat.rows.length < all.sides.bat.rows.length, 'so is a membership board');
  ok(played.sides.bat.rows.length > only.sides.bat.rows.length,
     'and membership is the looser of the two');

  for (const [name, d] of [['club', only], ['membership', played]]){
    app.S.data = d;
    const bad = [];
    for (const cid of Object.keys(d.cats)){
      app.S.catId = cid;
      const P = app.buildPool();
      if (!P.board.length) bad.push(`${cid} empty`);
      if (P.board[0].rank !== 1) bad.push(`${cid} does not start at 1`);
      if (P.board.some(e => e.rank > 100)) bad.push(`${cid} ranks past 100`);
    }
    eq(bad.slice(0, 3), [], `${name} board: every category re-ranks cleanly`);
  }

  /* two clubs at once */
  const both = await app.buildTeamRange(1994, 2025, false, ['SFG', 'LAD']);
  ok(both.sides.bat.rows.length > only.sides.bat.rows.length, 'two clubs give a bigger pool');
  ok(/Giants \+ /.test(both.label), 'and the label names both');

  /* the traded-player split is the reason this data exists */
  const y = JSON.parse(fs.readFileSync(path.join(ROOT, 'data-teams', '1998.json'), 'utf8'));
  const seen = new Map();
  for (const id of y.bat.ids) seen.set(id, (seen.get(id) || 0) + 1);
  ok([...seen.values()].some(n => n > 1), 'a traded player has a row per club, not one blended row');

  const clubs = app.teamsInRange(1994, 2025);
  ok(clubs.length >= 30, `${clubs.length} clubs existed in that span`);
  ok(clubs.every(c => c.y1 >= 1994 && c.y0 <= 2025), 'and every one of them overlaps it');
  ok(!app.teamsInRange(1925, 1930).some(c => c.id === 'ARI'), 'a club is absent from an era before it existed');
}

/* -------------------------------------------------------------------- done */
function done(){
  console.log(`\n${'─'.repeat(52)}`);
  console.log(fail === 0 ? `ALL PASS  — ${pass} assertions` : `${pass} passed, ${fail} FAILED`);
  if (fail){
    console.log('');
    failures.forEach(f => console.log(`  ✗ ${f}`));
  }
  process.exit(fail === 0 ? 0 : 1);
}

customRanges().then(teamBoards).then(done, e => { console.error(e); process.exit(1); });
