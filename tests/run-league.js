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
    localStorage: (() => { const m = new Map(); return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: k => m.delete(k), _m: m }; })(),
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
      available, takenIds, playLeague, shortPositions, finishLeague, renderDraft, rank,
      startLeague, seatEraOf, cleanEra, seasonsNeeded, clubOptions, defaults,
      renderSeatsL, poolFor, eraKey, boardFor, saveLeague, showL})`,
    sandbox, {filename: 'league.js'});
  api.__els = els;
  api.__ls = sandbox.localStorage;
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

  group('one club, or one each');
  {
    const clubs = app.clubOptions();
    ok(clubs.length > 20, `${clubs.length} franchises to choose from`);
    ok(clubs[0].n >= clubs[clubs.length - 1].n, 'longest-lived first, so the famous clubs are near the top');

    /* a club board really is only that club's men */
    const sfg = await app.buildLeaguePool(1960, 1979, 'SFG');
    ok(sfg.cards.length > 20 && sfg.cards.length < 200,
       `the Giants of 1960-79 are ${sfg.cards.length} players, not the whole era`);
    eq(sfg.club, 'SFG', 'and the pool says whose it is');
    const era = await app.buildLeaguePool(1960, 1979);
    ok(era.cards.length > sfg.cards.length * 5, 'the era pool is far bigger than one club');
    const ids = new Set(era.cards.map(c => c.kind + ':' + c.id));
    ok(sfg.cards.every(c => ids.has(c.kind + ':' + c.id)), 'and every Giant is in it');
    ok(sfg.cards.some(c => /Mays|McCovey|Marichal/.test(c.name)), 'the club board has the men you would expect');
  }

  group('a cross-club league: the Giants against the Brewers');
  {
    app.L.src = 'club'; app.L.each = true; app.L.allTime = true;
    app.L.seats = [{name: 'A', club: 'SFG'}, {name: 'B', club: 'MIL'}];
    app.defaults();
    await app.startLeague();
    ok(app.L.seats.every(s => s.pool), 'both managers got a board');
    eq(app.L.seats.map(s => s.pool.club), ['SFG', 'MIL'], 'and each is his own club');
    /* all time means that franchise's own span, which differs by club */
    const f = app.BB.ix.franchises;
    eq([app.L.seats[0].y0, app.L.seats[0].y1], [f.SFG.y0, f.SFG.y1], "all time is the Giants' own span");
    ok(app.L.seats[1].y0 !== app.L.seats[0].y0 || app.L.seats[1].y1 !== app.L.seats[0].y1
       || f.MIL.y0 === f.SFG.y0, "and the Brewers' is the Brewers'");

    let guard = 0;
    while (!app.L.seats.every(app.fullL) && guard++ < 200){
      const seat = app.L.seats[app.L.turn];
      const fits = app.available().find(c => app.BB.openSlots(seat.roster, c).length);
      if (!fits) break;
      app.takeL(fits);
    }
    ok(app.L.seats.every(app.fullL), 'both filled a roster from their own club');
    /* nobody drafted somebody else's player */
    for (const s of app.L.seats){
      const ids = new Set(s.pool.cards.map(c => c.kind + ':' + c.id));
      const stray = Object.values(s.roster).filter(c => !ids.has(c.kind + ':' + c.id));
      eq(stray.map(c => c.name), [], `${s.name} drafted only from ${s.pool.club}`);
    }
    const r = app.playLeague(app.L.seats);
    eq(r.table.length, 2, 'and the two clubs played each other');
    ok(r.table[0].w + r.table[0].l === r.games, 'over a full schedule');
  }

  group('one club between them is a real scramble');
  {
    app.L.src = 'club'; app.L.each = false; app.L.allTime = true;
    app.L.seats = [{name: 'A', club: 'NYY'}, {name: 'B', club: 'NYY'}];
    app.defaults();
    eq(app.L.seats.map(s => s.club), ['NYY', 'NYY'], 'one shared club means one choice for the table');
    await app.startLeague();
    ok(app.L.seats.every(s => s.pool), 'both drafting the same Yankees board');
    eq(app.eraKey(app.L.seats[0].y0, app.L.seats[0].y1, app.L.seats[0].club),
       app.eraKey(app.L.seats[1].y0, app.L.seats[1].y1, app.L.seats[1].club),
       'it is literally the same board');
    let guard = 0;
    while (!app.L.seats.every(app.fullL) && guard++ < 200){
      const seat = app.L.seats[app.L.turn];
      const fits = app.available().find(c => app.BB.openSlots(seat.roster, c).length);
      if (!fits) break;
      app.takeL(fits);
    }
    ok(app.L.seats.every(app.fullL), 'and there were enough Yankees for both');
    const all = app.L.seats.flatMap(s => Object.values(s.roster)).map(c => c.kind + ':' + c.id);
    eq(all.length, new Set(all).size, 'with no man on both rosters — a pick is taken off the other');
  }

  group('a club too thin to field is refused');
  {
    /* the Rays only exist from 1998, so a 1930s window has nobody at all */
    app.L.src = 'club'; app.L.each = true; app.L.allTime = false;
    app.L.seats = [{name: 'A', club: 'TBA', y0: 1930, y1: 1939},
                   {name: 'B', club: 'NYY', y0: 1930, y1: 1939}];
    app.defaults();
    /* park the draft screen out of sight so "did not start" means something */
    app.__els.get('l-draft').classList.add('hidden');
    await app.startLeague();
    const note = app.__els.get('l-start-note').textContent;
    ok(/cannot field/.test(note), `it says so before the draft: "${note}"`);
    ok(app.__els.get('l-draft')._cls.has('hidden'), 'and the draft never opens');
  }

  group('own eras, one league');
  {
    app.L.src = 'era'; app.L.each = true; app.L.allTime = false;
    app.L.seats = [{name: 'Ruth', y0: 1927, y1: 1936}, {name: 'Bonds', y0: 1995, y1: 2004}];
    app.defaults();
    await app.startLeague();
    eq(app.L.seats.map(s => [s.y0, s.y1]), [[1927, 1936], [1995, 2004]], 'each manager kept his own decade');
    ok(app.L.seats[0].pool !== app.L.seats[1].pool, 'and they are different boards');
    const a = new Set(app.L.seats[0].pool.cards.map(c => c.id));
    ok(!app.L.seats[1].pool.cards.some(c => a.has(c.id)), 'with nobody in common, seventy years apart');
    let guard = 0;
    while (!app.L.seats.every(app.fullL) && guard++ < 200){
      const seat = app.L.seats[app.L.turn];
      const fits = app.available().find(c => app.BB.openSlots(seat.roster, c).length);
      if (!fits) break;
      app.takeL(fits);
    }
    ok(app.L.seats.every(app.fullL), 'both filled a roster out of their own era');
    /* the whole point: era normalization makes the two comparable */
    const r = app.playLeague(app.L.seats);
    ok(r.table.every(t => t.rs > 2 && t.rs < 9),
       `both clubs score believable runs (${r.table.map(t => t.rs.toFixed(2)).join(' vs ')})`);
    ok(Math.abs(r.table[0].pct - 0.5) < 0.45, 'and neither era runs away with it on raw numbers');
  }

  group('what the load actually costs');
  {
    eq(app.seasonsNeeded([{y0: 1990, y1: 1999}]), 10, 'a decade is ten season files');
    eq(app.seasonsNeeded([{y0: 1990, y1: 1999}, {y0: 1995, y1: 2004}]), 15,
       'two overlapping decades share the overlap and cost fifteen, not twenty');
    eq(app.seasonsNeeded([{y0: 1920, y1: 2025}]), 106, 'and all time is the whole set');
  }

  group('records');
  {
    app.BB.clearRecs();
    eq(app.BB.recs(), [], 'the store starts empty');
    eq(app.BB.career(), [], 'and so does the career table');

    /* the league just played gets written when it finishes */
    app.L.saved = false;
    app.finishLeague();
    const list = app.BB.recs();
    eq(list.length, 1, 'finishing a league writes one record');
    const r = list[0];
    eq(r.game, 'league', 'tagged as a league');
    ok(/Eras|Clubs|\d{4}/.test(r.label), `and labelled with the mode: "${r.label}"`);
    eq(r.players.length, app.L.seats.length, 'a row per manager');
    ok(r.players.every(p => Number.isInteger(p.w) && Number.isInteger(p.l)), 'each with a record');
    /* the season is simulated, so two managers can genuinely finish level -
       and everybody level is a draw that crowns nobody, as everywhere else */
    const top = Math.max(...r.players.map(p => p.w));
    const leaders = r.players.filter(p => p.w === top);
    eq(r.players.filter(p => p.win).length,
       leaders.length === r.players.length ? 0 : leaders.length,
       leaders.length === r.players.length
         ? 'a league that finishes level crowns nobody'
         : `${leaders.length} champion${leaders.length === 1 ? '' : 's'}, one per club on top`);
    eq(r.players[0].roster.length, app.BB.SLOTS.length, 'the whole roster is kept');
    ok(r.players[0].roster.every(x => x.n && x.k && Number.isFinite(x.g)),
       'with the name, the slot and how good he was');
    ok(JSON.stringify(r).length < 40000, `and it is small enough to keep (${JSON.stringify(r).length} bytes)`);

    /* it survives a reload, which is the whole point of a records screen */
    app.BB._resetRecs();
    eq(app.BB.recs().length, 1, 'and it is still there after a reload');
  }
  {
    /* careers add up across seasons, and a solo season is never a title */
    app.BB.clearRecs();
    app.BB.addRec({ts: 1, game: '1620', label: 'a', players: [
      {name: 'Carson', w: 100, l: 62, rs: 5, ra: 4, win: true, roster: []},
      {name: 'Bish', w: 80, l: 82, rs: 4, ra: 4, win: false, roster: []}]});
    app.BB.addRec({ts: 2, game: '1620', label: 'b', players: [
      {name: 'carson', w: 90, l: 72, rs: 5, ra: 4, win: false, roster: []},
      {name: 'Bish', w: 95, l: 67, rs: 5, ra: 4, win: true, roster: []}]});
    app.BB.addRec({ts: 3, game: '1620', label: 'solo', players: [
      {name: 'Carson', w: 120, l: 42, rs: 6, ra: 3, win: false, roster: []}]});
    const c = app.BB.career('1620');
    const carson = c.find(x => /carson/i.test(x.name));
    eq(carson.seasons, 3, 'three seasons, however the name was capitalised');
    eq(carson.titles, 1, 'one title');
    eq(carson.solo, 1, 'and one of them solo, which can never be a title');
    eq([carson.w, carson.l], [310, 176], 'the win-loss adds up');
    eq(carson.best, 120, 'and the best season is the best season');
    ok(Math.abs(carson.pct - 310 / 486) < 1e-9, 'the win rate is over the games actually played');

    /* the two games keep separate tables but one store */
    app.BB.addRec({ts: 4, game: 'league', label: 'lg', players: [
      {name: 'Carson', w: 50, l: 50, rs: 5, ra: 5, win: true, roster: []}]});
    eq(app.BB.career('1620').find(x => /carson/i.test(x.name)).seasons, 3, '162-0 records stay 162-0');
    eq(app.BB.career('league').find(x => /carson/i.test(x.name)).seasons, 1, 'league records stay league');
    eq(app.BB.career().find(x => /carson/i.test(x.name)).seasons, 4, 'and a career spans both');
  }
  {
    /* the shapes a store can be in that are not a list of records */
    app.BB.clearRecs();
    const ls = app.__ls;
    for (const bad of ['null', '{}', 'not json', '[1,2]']){
      ls.setItem(app.BB.REC_KEY, bad);
      app.BB._resetRecs();
      ok(Array.isArray(app.BB.recs()), `"${bad.slice(0, 9)}" loads as a list rather than throwing`);
    }
    /* import merges by timestamp, so the same file twice is harmless */
    app.BB.clearRecs();
    const file = [{ts: 10, game: '1620', label: 'x', players: [{name: 'A', w: 1, l: 1, roster: []}]},
                  {ts: 11, game: '1620', label: 'y', players: [{name: 'A', w: 2, l: 0, roster: []}]}];
    eq(app.BB.importRecs(file), 2, 'two records imported');
    eq(app.BB.importRecs(file), 0, 'and importing the same file again adds nothing');
    eq(app.BB.recs().length, 2, 'so nothing is duplicated');
    eq(app.BB.importRecs('rubbish'), 0, 'and rubbish imports nothing');
  }
  {
    /* the screen renders from whatever is in the store */
    app.BB.clearRecs();
    app.BB.addRec({ts: 5, game: 'league', label: 'Clubs · Giants v Brewers · 162 games', players: [
      {name: 'Carson', w: 92, l: 70, rs: 6.1, ra: 4.2, win: true, from: 'San Francisco Giants · 1920–2025',
       roster: [{k: 'C', n: 'Buster Posey', i: 1, pos: 'C', g: 129, b: true}]},
      {name: 'Bish', w: 70, l: 92, rs: 4.9, ra: 5.1, win: false, from: 'Milwaukee Brewers · 1969–2025',
       roster: [{k: 'SP1', n: 'Teddy Higuera', i: 2, pos: 'SP', g: 78, b: false}]}]});
    app.showL('recs');
    const career = app.__els.get('l-rec-career').innerHTML;
    const hist = app.__els.get('l-rec-list').innerHTML;
    ok(/Carson/.test(career) && /92-70/.test(career), 'the career table shows the manager and his record');
    ok(/Giants v Brewers/.test(hist), 'the season list names the league');
    ok(/★ Carson/.test(hist), 'and stars the champion');
    ok(/Buster Posey/.test(hist) && /129 OPS\+/.test(hist), 'the roster is there with his grade');
    ok(/Teddy Higuera/.test(hist) && /78 ERA/.test(hist), 'pitchers graded on their own scale');
    ok(/data-rec="0"/.test(hist), 'and every season opens');
  }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(fail === 0 ? `ALL PASS  — ${pass} assertions` : `${pass} passed, ${fail} FAILED`);
  if (fail){ console.log(''); failures.forEach(f => console.log(`  ✗ ${f}`)); }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
