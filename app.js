/* Game 100 - standalone. No server, no accounts; data is static JSON. */

const S = {
  manifest: null, data: null,
  rangeId: null, post: false, catId: null, kind: 'span', custom: null,
  seats: ['', ''], rounds: 12, G: null, recSort: 'ppg', teams: [], teamMode: 'all',
  fmt: {on: false, ws: false, mode: 'bo', n: 7, randCat: false, randEra: false},
  SR: null,
};
/* The scoring rule, and the only place it lives. Rank 1-100 scores its own
   rank, 101-125 is the foul band, 126 and beyond is a strike - regardless of
   how far down the list is actually ranked. Naming the number-one player on
   the list earns a one-pick extension of the foul band to 140 (2026-07-29);
   the band was 101-110 before that day. */
const SCORE_TO = 100, FOUL_TO = 125, WIDE_TO = 140;
const REC_KEY = 'offtheboard:records';
let RECORDS = [];

/* ---------------------------------------------------------------- helpers */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtVal = v => v == null ? '' : (Number.isInteger(v) ? v.toLocaleString('en-US') : String(v));
const ord = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

function norm(s){
  const t = (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[.'\u2019`]/g, '')
    .replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ')
    .replace(/\s+/g, ' ').trim()
    /* only at the end: a suffix is a suffix. Stripping it anywhere turned
       "JR Murphy" into "Murphy" and handed the player a different man. */
    .replace(/ (jr|sr|ii|iii|iv)$/, '');
  /* Lahman writes initials apart - "C. J. Cron", "A. J. Burnett" - and people
     type them together. Join runs of two or more single letters so both spellings
     land in the same bucket. A lone initial is left alone, because "w mays" still
     has to find Willie Mays. 123 players are written this way. */
  const out = [];
  let run = '';
  for (const w of t.split(' ')){
    if (w.length === 1) run += w;
    else { if (run){ out.push(run); run = ''; } out.push(w); }
  }
  if (run) out.push(run);
  return out.join(' ');
}
const lastOf  = s => { const p = norm(s).split(' '); return p[p.length - 1] || ''; };
const firstOf = s => norm(s).split(' ')[0] || '';

function lev(a, b){
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({length: n + 1}, (_, i) => i), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++){
    cur[0] = i;
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i-1] === b[j-1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/* Nicknames Lahman does not carry. Keys are already normalised, so "A-Rod",
   "a rod" and "ARod" all arrive here as the same string. Only names that are
   genuinely better known by the nickname earn a place, and only when the
   nickname points at exactly one man - "Pudge" is Fisk and Rodriguez, "Doc" is
   Gooden and Halladay, so neither is here. An alias is a spelling shortcut, not
   a hint: it resolves to a name and that name then scores, fouls or strikes on
   its own merits like any other. */
const ALIASES = {
  'a rod': 'alex rodriguez', 'arod': 'alex rodriguez',
  'k rod': 'francisco rodriguez', 'krod': 'francisco rodriguez',
  'big papi': 'david ortiz', 'papi': 'david ortiz',
  'charlie hustle': 'pete rose',
  'mr october': 'reggie jackson',
  'the babe': 'babe ruth', 'bambino': 'babe ruth', 'sultan of swat': 'babe ruth',
  'say hey kid': 'willie mays', 'the say hey kid': 'willie mays',
  'hammerin hank': 'hank aaron', 'hammering hank': 'hank aaron',
  'the big unit': 'randy johnson', 'big unit': 'randy johnson',
  'the big hurt': 'frank thomas', 'big hurt': 'frank thomas',
  'king felix': 'felix hernandez',
  'joltin joe': 'joe dimaggio', 'yankee clipper': 'joe dimaggio',
  'the yankee clipper': 'joe dimaggio', 'joltin joe dimaggio': 'joe dimaggio',
  'splendid splinter': 'ted williams', 'the splendid splinter': 'ted williams',
  'teddy ballgame': 'ted williams',
  'stan the man': 'stan musial',
  'the iron horse': 'lou gehrig', 'iron horse': 'lou gehrig',
  'the ryan express': 'nolan ryan', 'ryan express': 'nolan ryan',
  'mr cub': 'ernie banks',
  'the mick': 'mickey mantle',
  'the rocket': 'roger clemens', 'rocket': 'roger clemens',
  'big mac': 'mark mcgwire',
  'the freak': 'tim lincecum',
  'crime dog': 'fred mcgriff', 'the crime dog': 'fred mcgriff',
  'kung fu panda': 'pablo sandoval',
  'thor': 'noah syndergaard',
  'el duque': 'orlando hernandez',
  'hebrew hammer': 'shawn green', 'the hebrew hammer': 'shawn green',
  'the kid': 'ken griffey', 'junior': 'ken griffey',
  'the man of steal': 'rickey henderson', 'man of steal': 'rickey henderson',
  'mad dog': 'greg maddux',
  'the wizard': 'ozzie smith', 'the wizard of oz': 'ozzie smith',
  'the big train': 'walter johnson', 'big train': 'walter johnson',
  'catfish': 'jim hunter',
  'eck': 'dennis eckersley',
  'the iron man': 'cal ripken', 'iron man': 'cal ripken',
  'mr padre': 'tony gwynn',
  'vlad': 'vladimir guerrero',
  'miggy': 'miguel cabrera',
  'the machine': 'albert pujols',
  'cool papa': 'cool papa bell',
  'sho': 'shohei ohtani', 'shotime': 'shohei ohtani', 'showtime': 'shohei ohtani',
  'pops': 'willie stargell',
};

/* Career span for a pool entry, when players.json happens to be loaded. It is
   the only thing the near-miss chooser is allowed to show alongside a name -
   see askCandidates. Returns null rather than throwing when it is not, so
   buildPool stays usable without the shared files (the suite does that). */
function spanOf(e){
  const p = CX.players;
  return (p && p.s && e && e.id != null) ? (p.s[e.id] || null) : null;
}

/* ------------------------------------------------------------------ data */
async function loadManifest(){
  S.manifest = await (await fetch('data/manifest.json')).json();
  const spans = S.manifest.ranges.filter(r => r.kind === 'span');
  S.rangeId = (spans[spans.length - 1] || S.manifest.ranges[0]).id;
}
function activeYears(){
  if (S.custom) return [S.custom.y0, S.custom.y1];
  const r = (S.manifest && S.manifest.ranges || []).find(x => x.id === S.rangeId);
  return r ? [r.y0, r.y1] : null;
}

/* Every tap on a range, a club or the season toggle starts a load, and a club
   board can fetch thirty files, so two quick taps can finish out of order. The
   sequence number lets a load that has been overtaken throw its result away
   rather than install a board for a selection that no longer exists. */
let loadSeq = 0;
async function loadRange(){
  const seq = ++loadSeq;
  const stale = () => seq !== loadSeq;
  $('start-note').textContent = 'Loading\u2026';
  $('start').disabled = true;
  const yrs = activeYears();
  /* The near-miss chooser shows career spans, which only players.json carries.
     Non-fatal on purpose: without it the chooser still works, just names only. */
  try { await loadShared(); } catch(e){ /* spans stay unavailable */ }
  let data;
  try{
    data = S.teams.length && yrs
      ? (S.teamMode === 'only'
          ? await buildTeamRange(yrs[0], yrs[1], S.post, S.teams)
          : await buildTeamMembers(yrs[0], yrs[1], S.post, S.teams))
      : await baseRange(S.post);
  }catch(e){
    if (stale()) return;
    S.data = null;
    $('start-note').textContent = 'Could not load that era.';
    return;
  }
  if (stale()) return;
  S.data = data;
  if (!S.data){
    $('start-note').textContent = S.teams.length
      ? 'Those clubs have nothing rankable in that span. Widen the years or pick another club.'
      : S.post ? 'No postseason play in those years.' : 'Nothing to play in those years.';
    return;
  }
  if (!S.data.cats[S.catId]) S.catId = Object.keys(S.data.cats)[0];
  renderCats();
}

/* ------------------------------------------------------------ custom ranges */
/* Any span of seasons, aggregated in the browser from the season files.
   Precomputing them is not an option - 1920-2025 contains 5,671 distinct
   ranges. The arithmetic below deliberately mirrors build_lists.py; the test
   suite rebuilds every shipped decade and span through this path and compares
   them cell for cell, so the two must not drift. */
const CX = {meta: null, players: null, league: null, awards: null, files: new Map()};

async function loadShared(){
  if (CX.meta) return;
  const get = f => fetch('data/' + f).then(r => r.json());
  const [meta, players, league, awards] = await Promise.all(
    [get('cats.json'), get('players.json'), get('league.json'), get('awards.json')]);
  Object.assign(CX, {meta, players, league, awards});
}

function seasonFile(y, post){
  const k = y + (post ? '-post' : '');
  if (!CX.files.has(k))
    CX.files.set(k, fetch(`data/${k}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
  return CX.files.get(k);
}

/* Python and numpy round half to even; JS rounds half up. The shipped ranges
   were built with the former, so a custom range has to use it too or the two
   disagree in the last digit and the same era gives two different boards. */
function rnd(v, d){
  const f = Math.pow(10, d), x = v * f, lo = Math.floor(x);
  if (Math.abs(x - lo - 0.5) < 1e-9) return (lo % 2 === 0 ? lo : lo + 1) / f;
  return Math.round(x) / f;
}
const numOf = v => Number.isInteger(v) ? v : rnd(v, 2);

function depthOf(vals, maxDepth, maxTieTail){
  if (!vals.length) return 0;
  const ranks = [];
  let prev = null, start = 0;
  vals.forEach((v, i) => { if (v !== prev){ start = i + 1; prev = v; } ranks.push(start); });
  let keep = vals.length;
  for (let i = 0; i < ranks.length; i++) if (ranks[i] > maxDepth){ keep = i; break; }
  if (!keep) return 0;
  const last = ranks[keep - 1];
  let tail = 0;
  for (let i = 0; i < keep; i++) if (ranks[i] === last) tail++;
  if (tail > maxTieTail && last > 1) keep -= tail;
  return Math.max(keep, 0);
}

/* One side's table, from {playerId -> {col: total}}. Mirrors make_side(). */
function sideFrom(totals, defs, y0, extra, have, M){
  const cols = [], cats = {};
  for (const [cid, col, label, abbr, since] of defs){
    if (y0 < since || !have.has(col)) continue;
    if (!cols.includes(col)) cols.push(col);
    cats[cid] = {col, label, abbr};
  }
  if (!Object.keys(cats).length) return [null, {}];
  for (const c of extra) if (have.has(c) && !cols.includes(c)) cols.push(c);

  const ids = [...totals.keys()].sort((a, b) => a - b);
  const rows = [], kept = [];
  for (const id of ids){
    const t = totals.get(id);
    const vals = cols.map(c => t[c] || 0);
    if (!vals.some(v => v !== 0)) continue;            // pandas drops all-zero rows
    rows.push([CX.players.n[id] || String(id), ...vals.map(numOf)]);
    kept.push(id);
  }
  if (!rows.length) return [null, {}];

  for (const [cid, meta] of Object.entries(cats)){
    const i = cols.indexOf(meta.col) + 1;
    const asc = meta.col === 'ERAm';
    const series = rows.map(r => r[i]).filter(v => v > 0).sort((a, b) => asc ? a - b : b - a);
    meta.depth = depthOf(series, M.max_depth, M.max_tie_tail);
    meta.dir = asc ? 'asc' : 'desc';
  }
  for (const k of Object.keys(cats)) if (!(cats[k].depth > 0)) delete cats[k];

  /* Namesakes again. A custom range has no per-range team, so the chooser gets
     the career span alone - still enough to tell two men apart. */
  const seen = new Map();
  for (const r of rows) seen.set(norm(r[0]), (seen.get(norm(r[0])) || 0) + 1);
  const who = {};
  rows.forEach((r, i) => {
    if (seen.get(norm(r[0])) > 1){
      const span = CX.players.s[kept[i]];
      if (span) who[String(i)] = ['', span];
    }
  });

  const side = {cols, rows};
  if (Object.keys(who).length) side.who = who;
  side.ids = kept;
  return [side, cats];
}

async function buildCustom(y0, y1, post){
  await loadShared();
  const M = CX.meta;
  const years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  const files = (await Promise.all(years.map(y => seasonFile(y, post)))).filter(Boolean);
  if (!files.length) return null;

  const sums = {}, have = {};
  for (const key of ['bat', 'pit']){
    const acc = new Map(), cols = new Set();
    for (const f of files){
      const s = f.sides[key];
      if (!s || !s.ids) continue;
      s.cols.forEach(c => cols.add(c));
      for (let i = 0; i < s.rows.length; i++){
        const id = s.ids[i];
        if (id < 0) continue;
        let e = acc.get(id);
        if (!e){ e = {}; acc.set(id, e); }
        for (let c = 0; c < s.cols.length; c++)
          e[s.cols[c]] = (e[s.cols[c]] || 0) + s.rows[i][c + 1];
      }
    }
    sums[key] = acc; have[key] = cols;
  }

  const sides = {}, cats = {};

  // batting: the three derived columns are recomputed from the totals
  for (const t of sums.bat.values()){
    t.TB  = (t.H || 0) + (t.X2B || 0) + 2 * (t.X3B || 0) + 3 * (t.HR || 0);
    t.XBH = (t.X2B || 0) + (t.X3B || 0) + (t.HR || 0);
    t.B1  = (t.H || 0) - (t.X2B || 0) - (t.X3B || 0) - (t.HR || 0);
  }
  ['TB', 'XBH', 'B1'].forEach(c => have.bat.add(c));
  {
    const [side, c] = sideFrom(sums.bat, M.bat, y0, [], have.bat, M);
    if (side){ sides.bat = side; Object.entries(c).forEach(([k, v]) => cats[k] = {...v, side: 'bat'}); }
  }

  // pitching: innings come from outs so the rounding happens once, and ERA-
  // is rebuilt against this range's own league context
  let defs = M.pit.slice();
  if (sums.pit.size){
    let lgOuts = 0, lgER = 0;
    for (const t of sums.pit.values()){
      t.IP = rnd((t.IPouts || 0) / 3, 1);
      lgOuts += t.IPouts || 0; lgER += t.ER || 0;
    }
    have.pit.add('IP');
    const lgIP = lgOuts / 3, lgEra = lgIP ? lgER * 9 / lgIP : 0;
    if (!post && lgEra){
      const sched = years.reduce((a, y) => a + (CX.league.g[y] || 0), 0);
      const minIP = Math.min(1500, Math.max(40, rnd(M.era_rate * sched, 0)));
      for (const t of sums.pit.values())
        t.ERAm = (t.IP > 0 && t.IP >= minIP) ? rnd((t.ER * 9 / t.IP) / lgEra * 100, 1) : 0;
      have.pit.add('ERAm');
      defs = defs.concat([['pit_era', 'ERAm', `ERA- (min ${minIP} IP)`, 'ERA-', 1920]]);
    }
    const [side, c] = sideFrom(sums.pit, defs, y0, ['IP', 'ER', 'IPouts'], have.pit, M);
    if (side){ sides.pit = side; Object.entries(c).forEach(([k, v]) => cats[k] = {...v, side: 'pit'}); }
  }

  // awards, on the same ten-season floor the shipped ranges use
  if (!post && years.length >= M.award_min_seasons){
    const acc = new Map(), cols = new Set(CX.awards.cols);
    for (const r of CX.awards.rows){
      if (r[1] < y0 || r[1] > y1) continue;
      let e = acc.get(r[0]);
      if (!e){ e = {}; acc.set(r[0], e); }
      CX.awards.cols.forEach((c, i) => e[c] = (e[c] || 0) + r[i + 2]);
    }
    if (acc.size){
      const [side, c] = sideFrom(acc, M.awd, y0, [], cols, M);
      if (side){ sides.awd = side; Object.entries(c).forEach(([k, v]) => cats[k] = {...v, side: 'awd'}); }
    }
  }

  if (!Object.keys(cats).length) return null;
  const label = y0 === y1 ? String(y0) : `${y0}–${y1}`;
  return {id: `${y0}-${y1}`, label, y0, y1, post, sides, cats};
}

/* ------------------------------------------------------------- team boards */
/* One club, or several, instead of all of baseball. Rows in data-teams are split
   per franchise, so a traded man's numbers land with the club he earned them at
   rather than following him around - 8.2% of player-seasons involve more than
   one team, which is too many to fudge.

   The league context for ERA- is still the whole league. A club's ace is
   measured against the baseball everyone was playing, not against his own
   rotation, or every team would field an average staff by definition. */
const TX = {ix: null, files: new Map()};

async function loadTeamIndex(){
  if (!TX.ix) TX.ix = await fetch('data-teams/index.json').then(r => r.json());
  return TX.ix;
}
function teamFile(y, post){
  const k = y + (post ? '-post' : '');
  if (!TX.files.has(k))
    TX.files.set(k, fetch(`data-teams/${k}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
  return TX.files.get(k);
}

async function buildTeamRange(y0, y1, post, teams){
  await loadShared();
  await loadTeamIndex();
  const M = CX.meta, want = new Set(teams);
  const years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  const files = (await Promise.all(years.map(y => teamFile(y, post)))).filter(Boolean);
  if (!files.length) return null;

  const sums = {bat: new Map(), pit: new Map()};
  const have = {bat: new Set(), pit: new Set()};
  let lgOuts = 0, lgER = 0;

  for (const f of files){
    for (const key of ['bat', 'pit']){
      const s = f[key];
      if (!s) continue;
      s.cols.forEach(c => have[key].add(c));
      const oi = s.cols.indexOf('IPouts'), ei = s.cols.indexOf('ER');
      for (let i = 0; i < s.rows.length; i++){
        if (key === 'pit'){
          if (oi >= 0) lgOuts += s.rows[i][oi];
          if (ei >= 0) lgER += s.rows[i][ei];
        }
        if (!want.has(s.fr[i])) continue;
        const id = s.ids[i];
        let e = sums[key].get(id);
        if (!e){ e = {}; sums[key].set(id, e); }
        for (let c = 0; c < s.cols.length; c++)
          e[s.cols[c]] = (e[s.cols[c]] || 0) + s.rows[i][c];
      }
    }
  }
  if (!sums.bat.size && !sums.pit.size) return null;

  const sides = {}, cats = {};
  for (const t of sums.bat.values()){
    t.TB  = (t.H || 0) + (t.X2B || 0) + 2 * (t.X3B || 0) + 3 * (t.HR || 0);
    t.XBH = (t.X2B || 0) + (t.X3B || 0) + (t.HR || 0);
    t.B1  = (t.H || 0) - (t.X2B || 0) - (t.X3B || 0) - (t.HR || 0);
  }
  ['TB', 'XBH', 'B1'].forEach(c => have.bat.add(c));
  {
    const [side, c] = sideFrom(sums.bat, M.bat, y0, [], have.bat, M);
    if (side){ sides.bat = side; Object.entries(c).forEach(([k, v]) => cats[k] = {...v, side: 'bat'}); }
  }

  let defs = M.pit.slice();
  if (sums.pit.size){
    for (const t of sums.pit.values()) t.IP = rnd((t.IPouts || 0) / 3, 1);
    have.pit.add('IP');
    const lgIP = lgOuts / 3, lgEra = lgIP ? lgER * 9 / lgIP : 0;
    if (!post && lgEra){
      const sched = years.reduce((a, y) => a + (CX.league.g[y] || 0), 0);
      const minIP = Math.min(1500, Math.max(40, rnd(M.era_rate * sched, 0)));
      for (const t of sums.pit.values())
        t.ERAm = (t.IP > 0 && t.IP >= minIP) ? rnd((t.ER * 9 / t.IP) / lgEra * 100, 1) : 0;
      have.pit.add('ERAm');
      defs = defs.concat([['pit_era', 'ERAm', `ERA- (min ${minIP} IP)`, 'ERA-', 1920]]);
    }
    const [side, c] = sideFrom(sums.pit, defs, y0, ['IP', 'ER', 'IPouts'], have.pit, M);
    if (side){ sides.pit = side; Object.entries(c).forEach(([k, v]) => cats[k] = {...v, side: 'pit'}); }
  }

  /* No awards side: an All-Star selection or an MVP is not a team statistic in
     any way this data can honestly split, so a team board leaves them out. */
  if (!Object.keys(cats).length) return null;
  const names = teams.map(t => (TX.ix.franchises[t] || {}).name || t);
  const span = y0 === y1 ? String(y0) : `${y0}–${y1}`;
  return {id: `${teams.join('+')}_${y0}-${y1}`,
          label: `${names.join(' + ')} · ${span}`,
          y0, y1, post, teams, sides, cats};
}

/* The other way to read "only this team": not the club's own numbers, but the
   men who wore the shirt - with everything they did, wherever they did it. So
   Randy Johnson counts for the Giants on the strength of his whole career, not
   on the half-season he spent there. */
async function teamMembers(y0, y1, teams){
  await loadTeamIndex();
  const want = new Set(teams), ids = new Set();
  const years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  /* membership always comes from the regular season: a man on a postseason
     roster was on the regular-season one too, and the reverse is not true */
  const files = (await Promise.all(years.map(y => teamFile(y, false)))).filter(Boolean);
  for (const f of files)
    for (const key of ['bat', 'pit']){
      const s = f[key];
      if (!s) continue;
      for (let i = 0; i < s.rows.length; i++) if (want.has(s.fr[i])) ids.add(s.ids[i]);
    }
  return ids;
}

async function baseRange(post){
  return S.custom
    ? await buildCustom(S.custom.y0, S.custom.y1, post)
    : await (await fetch(`data/${S.rangeId}${post ? '-post' : ''}.json`)).json();
}

async function buildTeamMembers(y0, y1, post, teams){
  await loadShared();
  const ids = await teamMembers(y0, y1, teams);
  if (!ids.size) return null;
  const base = await baseRange(post);
  if (!base) return null;
  const M = CX.meta, sides = {}, cats = {};

  for (const [key, s] of Object.entries(base.sides)){
    if (!s.ids) continue;
    const rows = [], keep = [];
    s.rows.forEach((r, i) => { if (ids.has(s.ids[i])){ rows.push(r); keep.push(s.ids[i]); } });
    if (rows.length) sides[key] = {cols: s.cols, rows, ids: keep};
  }
  /* the pool shrank, so every list has to be re-ranked and re-cut */
  for (const [cid, c] of Object.entries(base.cats)){
    const s = sides[c.side];
    if (!s) continue;
    const i = s.cols.indexOf(c.col) + 1;
    if (i === 0) continue;
    const asc = c.dir === 'asc';
    const series = s.rows.map(r => r[i]).filter(v => v > 0).sort((a, b) => asc ? a - b : b - a);
    const depth = depthOf(series, M.max_depth, M.max_tie_tail);
    if (depth > 0) cats[cid] = {...c, depth};
  }
  for (const s of Object.values(sides)){
    const seen = new Map();
    for (const r of s.rows) seen.set(norm(r[0]), (seen.get(norm(r[0])) || 0) + 1);
    const who = {};
    s.rows.forEach((r, i) => {
      if (seen.get(norm(r[0])) > 1){
        const span = CX.players.s[s.ids[i]];
        if (span) who[String(i)] = ['', span];
      }
    });
    if (Object.keys(who).length) s.who = who;
  }
  if (!Object.keys(cats).length) return null;
  const names = teams.map(t => (TX.ix.franchises[t] || {}).name || t);
  const span = y0 === y1 ? String(y0) : `${y0}\u2013${y1}`;
  return {id: `${teams.join('+')}~${y0}-${y1}`,
          label: `Played for ${names.join(' + ')} \u00b7 ${span}`,
          y0, y1, post, teams, mode: 'played', sides, cats};
}

/* Which clubs actually existed inside a span. */
function teamsInRange(y0, y1){
  if (!TX.ix) return [];
  return Object.entries(TX.ix.franchises)
    .filter(([, v]) => v.y1 >= y0 && v.y0 <= y1)
    .map(([id, v]) => ({id, name: v.name, y0: v.y0, y1: v.y1}))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* Build the playable board, the foul band, and a lookup index over everyone. */
function buildPool(){
  const cat = S.data.cats[S.catId];
  const side = S.data.sides[cat.side];
  const ci = side.cols.indexOf(cat.col) + 1;
  const asc = cat.dir === 'asc';

  /* `who` is keyed by original row index and only present for names the file
     carries more than once. Keying the lookup by row reference survives the
     filter and sort below, which the index would not. */
  const who = side.who || {};
  const whoOf = new Map(), idOf = new Map();
  side.rows.forEach((r, i) => {
    if (who[i]) whoOf.set(r, who[i]);
    if (side.ids) idOf.set(r, side.ids[i]);
  });

  const scored = side.rows.filter(r => r[ci] > 0)
                          .sort((a, b) => asc ? a[ci] - b[ci] : b[ci] - a[ci]);
  const ranks = [];
  let prev = null, start = 0;
  scored.forEach((r, i) => { if (r[ci] !== prev){ start = i + 1; prev = r[ci]; } ranks.push(start); });

  /* The zones are cut by rank, not by how deep the list happens to run.
     Rank 1-100 scores, 101-110 is the foul band, 111 and beyond is a strike.
     Rank rather than position matters because ties share a rank: sixty men tied
     at 50 all score 50 rather than the hundredth of them landing in the fouls.
     `cat.depth` still describes how far the list is ranked, which is what lets
     a strike report "he was 153rd" instead of just "no". */
  const board = [], foul = [], off = [];
  scored.forEach((r, i) => {
    const base = {name: r[0], val: r[ci], rank: ranks[i], who: whoOf.get(r) || null,
                  id: idOf.has(r) ? idOf.get(r) : null};
    if (base.rank <= SCORE_TO) board.push({...base, zone: 'board', drafted: false, by: null});
    else if (base.rank <= FOUL_TO) foul.push({...base, zone: 'foul', used: false});
    else off.push({...base, zone: 'off'});
  });
  for (const r of side.rows)
    if (!(r[ci] > 0)) off.push({name: r[0], val: r[ci], rank: null, zone: 'off',
                                id: idOf.has(r) ? idOf.get(r) : null});

  const all = board.concat(foul, off);
  const byName = new Map(), byLast = new Map(), byFirst = new Map();
  for (const e of all){
    const n = norm(e.name), l = lastOf(e.name), f = firstOf(e.name);
    (byName.get(n) || byName.set(n, []).get(n)).push(e);
    (byLast.get(l) || byLast.set(l, []).get(l)).push(e);
    /* First names index a much flatter space than last names - hundreds of
       Mikes - so this is only ever consulted when it points at one man. It
       exists for the mononyms: everybody calls Ichiro Suzuki "Ichiro", and
       before this the game told them he never played. */
    (byFirst.get(f) || byFirst.set(f, []).get(f)).push(e);
  }
  return {board, foul, all, byName, byLast, byFirst, abbr: cat.abbr, label: cat.label,
          depth: SCORE_TO, foulTo: FOUL_TO, listDepth: cat.depth,
          open: board.length, total: scored.length};
}

/* Board first, then the foul band, then everyone else. Ambiguity only
   matters when a pick could actually score, so board entries win ties. */
function resolve(raw){
  const q0 = norm(raw);
  if (!q0) return {k: 'empty'};
  const q = ALIASES[q0] || q0;
  const P = S.G.pool;

  const bestOf = l => l.reduce((a, b) => (a.rank <= b.rank ? a : b));

  const pick = list => {
    if (!list || !list.length) return null;
    const live = list.filter(e => e.zone === 'board' && !e.drafted);
    if (live.length === 1) return {k: 'hit', e: live[0]};
    /* Different men who share a name - the all-time board carries fifteen
       Smiths. "Use a first name" only helps when the full names differ. When
       they are identical, offer the choice if the data can actually tell them
       apart; otherwise the prompt is unanswerable and the slots would be
       undraftable, so award the better rank and leave the namesake up. */
    if (live.length > 1){
      if (new Set(live.map(e => norm(e.name))).size > 1) return {k: 'ambiguous', list: live};
      const tags = live.map(e => (e.who || []).join('|')).filter(Boolean);
      if (tags.length === live.length && new Set(tags).size === live.length)
        return {k: 'choose', list: live};
      return {k: 'hit', e: bestOf(live)};
    }
    const taken = list.filter(e => e.zone === 'board');
    if (taken.length)      return {k: 'taken', e: taken[0]};
    /* somebody has already burned this name. It costs nothing to say it again,
       exactly as naming a drafted player costs nothing. */
    const gone = list.find(e => e.missed);
    if (gone)              return {k: 'missed', e: gone};
    const f = list.filter(e => e.zone === 'foul' && !e.used);
    if (f.length)          return {k: 'foul', e: bestOf(f)};
    const off = list.filter(e => e.zone === 'off');
    if (off.length){
      off.sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9));
      return {k: 'off', e: off[0]};
    }
    return {k: 'missed', e: list[0]};
  };

  let r = pick(P.byName.get(q));
  if (r) return r;
  r = pick(P.byLast.get(q));
  if (r) return r;

  const tok = q.split(' ');
  if (tok.length === 2){
    const cand = (P.byLast.get(tok[1]) || []).filter(e => firstOf(e.name).startsWith(tok[0]))
      .concat((P.byLast.get(tok[0]) || []).filter(e => firstOf(e.name).startsWith(tok[1])));
    r = pick(cand);
    if (r) return r;
  }

  /* A bare first name, but only when it names one man. Anything ambiguous is
     dropped rather than reported, because listing every Mike in the era would
     both be useless and read out a chunk of the board. */
  if (tok.length === 1 && P.byFirst){
    const one = P.byFirst.get(q) || [];
    if (one.length === 1) return pick(one) || {k: 'none'};
    const live = one.filter(e => e.zone === 'board' && !e.drafted);
    if (live.length === 1 && new Set(one.map(e => norm(e.name))).size === 1) return pick(one) || {k: 'none'};
  }

  const near = candidates(q, P);
  if (near.length === 1) return {k: 'suggest', e: near[0]};
  if (near.length > 1)   return {k: 'candidates', list: near, q};
  return {k: 'none'};
}

/* Near misses for a query that matched nothing outright.
   Drawn from the WHOLE era - the top 100, the foul band and the hundreds who
   rank below - never from the board alone. That is the difference between
   fixing a spelling and handing over an answer: because a name being offered
   says nothing about whether it scores, the list cannot be fished. Sorted by
   edit distance and then alphabetically, deliberately never by rank. */
function candidates(q, P, limit = 5){
  const cap = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3;
  const out = [];
  for (const e of (P.all || [])){
    const n = norm(e.name);
    if (n === q) continue;              // an exact match would have resolved already
    const d = Math.min(lev(q, n), lev(q, lastOf(e.name)), lev(q, firstOf(e.name)));
    if (d <= cap) out.push({e, d});
  }
  if (!out.length) return [];
  out.sort((a, b) => a.d - b.d || (a.e.name < b.e.name ? -1 : a.e.name > b.e.name ? 1 : 0));
  /* Getting here means neither the full name nor the last name matched exactly,
     so a distance of nought can only be a shared first name. A crowd of those is
     ambiguity, not a misspelling - "Mike" is four hundred men and no five of them
     are a useful answer - so say nothing rather than offer an arbitrary handful.
     Volume alone cannot make this call: "jonson" is as populous as "mike" and is
     a genuine typo. The distance is what tells them apart. */
  const best = out[0].d;
  if (best === 0 && out.filter(x => x.d === 0).length > limit) return [];
  return out.slice(0, limit).map(x => x.e);
}

/* ------------------------------------------------------------------ game */
function startGame(){
  if (S.fmt.on && (!S.SR || S.SR.done)) startSeries();
  const pool = buildPool();
  S.G = {
    rangeId: S.rangeId, post: S.post, cat: S.catId,
    label: pool.label, abbr: pool.abbr, pool,
    players: S.seats.map((n, i) => ({name: (n.trim() || `Drafter ${i+1}`),
      pts: 0, strikes: 0, out: false, picks: 0, fouls: 0, ranks: [], picked: [],
      turns: 0, firstOk: 0, seq: '',
      /* unused foul-band extensions, one per number-one player named */
      wide: 0, wides: 0})),
    /* A World Series game is one pick each, whatever the rounds setting says.
       `first` rotates the opening pick through the seats from game to game
       inside a series: in a one-pick game the second picker knows the number
       to beat, so going first every time is a real handicap. */
    round: 0, pos: 0, maxRounds: (S.SR && S.SR.ws) ? 1 : S.rounds,
    first: (S.SR && !S.SR.done) ? S.SR.games.length % S.seats.length : 0,
    log: [], misses: [], saved: false,
    /* attempts inside the current turn. A re-prompt - already taken, already
       missed, ambiguous, empty - does not end the turn, so it must not count
       against a first guess either. */
    tries: 0,
  };
  show('game');
  $('g-era').textContent = S.data.label + (S.post ? ' \u00b7 Postseason' : '');
  $('g-cat').textContent = pool.label;
  setPlate('On the clock', '\u2014',
    `Top ${SCORE_TO} scores \u00b7 ${SCORE_TO + 1}\u2013${FOUL_TO} is a foul \u00b7 name a player`, '');
  /* a chooser left open when the last game was quit lives inside the game
     screen, so it would otherwise come back with this one and act on it */
  clearMsg(); clearConfirm(); renderGame(); focusGuess();
}

const order = r => {
  const n = S.G.players.length, f = S.G.first || 0;
  const a = [...Array(n).keys()].map(i => (i + f) % n);
  return r % 2 === 0 ? a : a.reverse();
};
const seat = () => order(S.G.round)[S.G.pos];
const alive = () => S.G.players.filter(p => !p.out).length;
const openLeft = () => S.G.pool.board.filter(e => !e.drafted).length;

function advance(){
  /* picks hand off through a short timer; End game inside that window already
     finished and saved this game, and finishing it again would land on the
     plain results screen and drop a running series */
  if (!S.G || S.G.saved) return;
  if (!alive() || !openLeft()) return finish();
  let guard = 0;
  do {
    S.G.pos++;
    if (S.G.pos >= S.G.players.length){ S.G.pos = 0; S.G.round++; }
    if (S.G.maxRounds && S.G.round >= S.G.maxRounds) return finish();
    if (++guard > 400) return finish();
  } while (S.G.players[seat()].out);
  S.G.tries = 0;
  renderGame(); focusGuess();
}

function submitGuess(){
  const raw = $('guess').value;
  clearConfirm();
  apply(resolve(raw), raw);
}

/* Acting on a resolution, split out of submitGuess so that a name picked from
   the near-miss chooser re-enters the same path instead of duplicating the zone
   rules. That is what keeps a chosen name honest: the chooser only settles how
   the name was spelled, and the pick then scores, fouls or strikes on its own
   merits exactly as if it had been typed correctly. */
function apply(r, raw){
  const box = $('guess');
  if (r.k === 'empty'){ setMsg('Type a name first.', 'warn'); return; }
  if (r.k === 'taken' || r.k === 'missed' || r.k === 'ambiguous') S.G.tries++;
  if (r.k === 'taken'){
    setMsg(`${r.e.name} is already off the board. Pick again \u2014 no strike.`, 'warn');
    box.value = ''; focusGuess(); return;
  }
  if (r.k === 'missed'){
    setMsg(`${r.e.name} has already been missed. Pick again \u2014 no strike.`, 'warn');
    box.value = ''; focusGuess(); return;
  }
  if (r.k === 'ambiguous'){
    setMsg(`Too many matches: ${r.list.map(e => e.name).join(', ')}. Use a first name \u2014 no strike.`, 'warn');
    box.value = ''; focusGuess(); return;
  }
  if (r.k === 'choose') return askChoose(r.list);
  if (r.k === 'candidates'){ S.G.tries++; return askCandidates(r.list, raw); }
  if (r.k === 'suggest'){ S.G.tries++; return askConfirm(r.e, raw); }
  if (r.k === 'hit')  return score(r.e);
  if (r.k === 'foul') return foul(r.e);
  return strike(raw, r.k === 'off' ? r.e : null);
}

/* Re-enter the turn through the name itself, so a chosen candidate obeys every
   rule a typed name obeys - drafted, already missed, foul band, off the list. */
const takeNamed = e => apply(resolve(e.name), e.name);

/* Two different men, one name. Team and career span are the only things shown -
   a rank or a stat line here would hand over the answer the game is asking for. */
function askChoose(list){
  $('confirm-slot').innerHTML = `
    <div class="msg warn" style="margin-top:12px">
      <div style="margin-bottom:8px">More than one <strong>${esc(list[0].name)}</strong> played. Which?</div>
      <div class="choose">
        ${list.map((e, i) => `<button class="btn small" data-pick="${i}">
             <span class="mono">${esc(e.who[0] || '—')}</span> ${esc(e.who[1] || '')}
           </button>`).join('')}
        <button class="btn ghost small" data-pick="none">Neither</button>
      </div>
    </div>`;
  $('confirm-slot').querySelectorAll('[data-pick]').forEach(el => el.onclick = () => {
    const v = el.dataset.pick;
    clearConfirm();
    if (v === 'none'){
      setMsg('Pick again — no strike.', 'warn');
      $('guess').value = ''; focusGuess(); return;
    }
    const e = list[+v];
    e.drafted ? (setMsg('Already off the board.', 'warn'), focusGuess()) : score(e);
  });
}

function askConfirm(e, raw){
  $('confirm-slot').innerHTML = `
    <div class="msg warn" style="margin-top:12px">
      <div style="margin-bottom:8px">Did you mean <strong>${esc(e.name)}</strong>?</div>
      <button class="btn small" id="c-yes">Yes, that's my pick</button>
      <button class="btn ghost small" id="c-no">No, that's not it</button>
    </div>`;
  $('c-yes').onclick = () => { clearConfirm(); takeNamed(e); };
  $('c-no').onclick  = () => {
    clearConfirm();
    // re-resolve ignoring the board so a near-miss can still be looked up
    const P = S.G.pool, q = norm(raw);
    const cand = (P.byName.get(q) || P.byLast.get(q) || []).filter(x => x.zone !== 'board');
    const f = cand.find(x => x.zone === 'foul' && !x.used);
    if (f) return foul(f);
    strike(raw, cand.find(x => x.zone === 'off') || null);
  };
}

/* Several plausible readings of what was typed. Career span only - no rank, no
   stat, no team - for the same reason the namesake chooser shows none: anything
   more would answer the question the game is asking. The names come from the
   whole era rather than the board, so the list itself gives nothing away.
   Picking costs no strike; "None of these" means the name really was not one of
   these, which is the ordinary miss it always was. */
function askCandidates(list, raw){
  const typed = (raw || '').trim().slice(0, 28);
  $('confirm-slot').innerHTML = `
    <div class="msg warn" style="margin-top:12px">
      <div style="margin-bottom:8px">No exact match for <strong>${esc(typed)}</strong>. Did you mean one of these?</div>
      <div class="choose">
        ${list.map((e, i) => `<button class="btn small" data-pick="${i}">
             ${esc(e.name)}${spanOf(e) ? ` <span class="mono">${esc(spanOf(e))}</span>` : ''}
           </button>`).join('')}
        <button class="btn ghost small" data-pick="none">None of these</button>
      </div>
      <div class="mono" style="margin-top:8px;opacity:.7">No strike for picking — the name still has to be on the list to score.</div>
    </div>`;
  $('confirm-slot').querySelectorAll('[data-pick]').forEach(el => el.onclick = () => {
    const v = el.dataset.pick;
    clearConfirm();
    if (v === 'none') return strike(raw, null);
    takeNamed(list[+v]);
  });
}

function score(e){
  const p = S.G.players[seat()];
  e.drafted = true; e.by = p.name;
  p.turns++; if (!S.G.tries) p.firstOk++; p.seq += 'p';
  p.pts += e.rank; p.picks++; p.ranks.push(e.rank);
  p.picked.push({n: e.name, r: e.rank, i: e.id});
  S.G.log.push({rank: e.rank, name: e.name, by: p.name, val: e.val, id: e.id});
  clearMsg();
  /* Naming the number-one player is the one pick that pays nothing extra in
     points - rank 1 is worth 1 - so it pays in rope instead: the foul band runs
     to WIDE_TO for one of this person's later picks. Ties at the top all count;
     two men level at rank 1 are both the best. */
  const top = e.rank === 1;
  if (top){ p.wide++; p.wides++; }
  setPlate(`${p.name} scores`, String(e.rank),
    `${e.name} \u00b7 ${fmtVal(e.val)} ${S.G.abbr} \u00b7 ${ord(e.rank)} of ${S.G.pool.depth}`, 'good');
  if (top) setMsg(`Number one. ${p.name}'s foul band runs to ${WIDE_TO} for one pick.`, 'good');
  $('guess').value = ''; renderGame();
  setTimeout(advance, 280);
}

/* Foul ball: free at two strikes, otherwise it costs one. Turn ends either way.
   `wide` marks a pick that only fouled because of an earned extension. */
function foul(f, wide){
  const p = S.G.players[seat()];
  f.used = true; f.missed = true; p.fouls++;
  p.turns++; p.seq += 'f';
  S.G.misses.push({kind: 'foul', name: f.name, rank: f.rank, val: f.val, by: p.name, wide: !!wide});
  const free = p.strikes >= 2;
  if (!free) p.strikes++;
  clearMsg();
  setPlate('Foul ball', 'FOUL',
    `${f.name} was ${ord(f.rank)} with ${fmtVal(f.val)} ${S.G.abbr}`, 'foul');
  const band = wide ? `${SCORE_TO + 1} to ${WIDE_TO} with the extension, now used` : `${SCORE_TO + 1} to ${FOUL_TO}`;
  setMsg(free ? `Past the top ${SCORE_TO}, but at two strikes the foul is free${wide ? ' \u2014 extension used' : ''}. Turn passes.`
              : `Past the top ${SCORE_TO} \u2014 ${band} is a foul. Strike ${p.strikes}. Turn passes.`,
         'warn');
  $('guess').value = ''; renderGame();
  setTimeout(advance, 420);
}

/* A strike still tells you what the player actually did. */
function strike(raw, e){
  const p = S.G.players[seat()];
  /* an earned extension turns a near miss into a foul, once */
  if (e && e.rank && e.rank > FOUL_TO && e.rank <= WIDE_TO && p.wide > 0){
    p.wide--;
    return foul(e, true);
  }
  p.strikes++;
  p.turns++; p.seq += 's';
  if (e) e.missed = true;
  S.G.misses.push({kind: 'strike', name: e ? e.name : (raw || '').trim().slice(0, 28),
                   rank: e ? e.rank : null, val: e ? e.val : null,
                   real: !!e, by: p.name});
  let sub;
  if (e && e.rank)      sub = `${e.name} \u2014 ${fmtVal(e.val)} ${S.G.abbr}, ${ord(e.rank)}`
                              + (e.rank > FOUL_TO ? ` \u00b7 only the top ${SCORE_TO} score` : '');
  else if (e)           sub = `${e.name} \u2014 no ${S.G.abbr} in this era`;
  else                  sub = `${(raw || '').trim().slice(0, 28) || '\u2014'} didn't play in this era`;
  if (p.strikes >= 3){
    p.out = true;
    setPlate(`${p.name} is out`, 'X', sub, 'bad');
  } else {
    setPlate('Strike', 'X'.repeat(p.strikes), sub, 'bad');
  }
  clearMsg(); $('guess').value = ''; renderGame();
  setTimeout(advance, 620);
}

function finish(){
  const G = S.G;
  let rec = null;
  /* Read before writing: practising needs a number to beat, and it has to be
     the best from *previous* attempts at this same board, not counting the one
     just played. Computed here because the record is pushed a few lines down. */
  const soloBest = soloPriorBest(G);
  if (!G.saved){
    G.saved = true;
    const best = Math.max(...G.players.map(p => p.pts));
    /* Solo practice has nobody to beat, so nothing is won. Marking every solo
       game a win would have made the win column meaningless the moment anyone
       practised; leaving `win` false without saying why would read as a long
       losing streak. The flag lets the records screen tell the difference. */
    const solo = G.players.length === 1;
    rec = {ts: Date.now(), range: G.rangeId, post: G.post, cat: G.cat, label: G.label,
      depth: G.pool.depth, y0: S.data && S.data.y0, y1: S.data && S.data.y1,
      teams: (S.data && S.data.teams) || null, solo,
      misses: G.misses.map(m => ({n: m.name, r: m.rank, k: m.kind, by: m.by, ...(m.wide ? {w: true} : {})})),
      players: G.players.map(p => ({name: p.name.trim(), pts: p.pts, strikes: p.strikes,
        picks: p.picks, fouls: p.fouls, ranks: p.ranks, picked: p.picked,
        turns: p.turns, firstOk: p.firstOk, seq: p.seq, wides: p.wides,
        win: !solo && p.pts === best}))};
    /* the series fields ride along on an otherwise ordinary game record, so
       nothing that reads records has to know series exist */
    if (S.SR){
      rec.sid = S.SR.id; rec.sno = S.SR.games.length + 1; rec.smode = S.SR.mode; rec.sn = S.SR.n;
      if (S.SR.ws) rec.sws = true;
    }
    RECORDS.push(rec);
    saveRecords();
  }
  const ranked = [...G.players].sort((a, b) => b.pts - a.pts);
  const top = ranked[0].pts, winners = ranked.filter(p => p.pts === top);
  $('over-head').textContent = G.players.length === 1
    ? (soloBest == null ? `${top} points`
       : top > soloBest ? `${top} points — your best on this board`
       : `${top} points · best ${soloBest}`)
    : winners.length > 1 ? 'Tie at the top' : `${winners[0].name} wins`;
  $('results').innerHTML = ranked.map((p, i) => `
    <div class="result-row ${p.pts === top ? 'win' : ''}">
      <div class="pos">${i+1}</div>
      <div class="nm">${esc(p.name)}${p.out ? ' <span class="mono">\u00b7 struck out</span>' : ''}</div>
      <div class="sc">${p.pts}</div>
    </div>`).join('');
  const left = G.pool.board.filter(e => !e.drafted).slice(0, 12);
  $('missed').innerHTML = left.length
    ? left.map(e => `${String(e.rank).padStart(4,' ')}  ${esc(e.name)}  \u00b7  ${fmtVal(e.val)} ${G.abbr}`).join('<br>')
    : 'Every player got taken.';
  if (S.SR && rec){
    seriesTake(rec);
    renderSeries();
    return show('series');
  }
  show('over');
}

/* Best this person has scored solo on this exact board before. Same category,
   same range, same postseason flag, same clubs - a different board is a
   different problem, the same way streaks do not carry between games. The club
   check matters because a club board records the league range's id plus the
   clubs separately, so without it a Giants-only 300 was measured against a
   whole-league 900. Null when this is the first attempt, so the screen can say
   nothing rather than compare against zero. */
const teamKey = t => (t && t.length) ? [...t].sort().join('+') : '';
function soloPriorBest(G){
  if (!G || G.players.length !== 1) return null;
  const who = (G.players[0].name || '').trim().toLowerCase();
  const mine = teamKey(S.data && S.data.teams);
  let best = null;
  for (const g of RECORDS){
    if (!g.solo || g.cat !== G.cat || g.range !== G.rangeId || !!g.post !== !!G.post) continue;
    if (teamKey(g.teams) !== mine) continue;
    for (const p of (g.players || [])){
      if ((p.name || '').trim().toLowerCase() !== who) continue;
      if (best == null || (p.pts || 0) > best) best = p.pts || 0;
    }
  }
  return best;
}

/* ---------------------------------------------------------------- series */
/* A series is a run of ordinary games sharing an id. Nothing about the game
   engine changes; the series only decides whether another one starts and keeps
   the running tally. Each finished game still writes its own record, so career
   stats and profiles carry on working untouched - the series fields are extra. */

const SMODES = {
  bo:     {label: 'Best of',       unit: 'games',  note: n => `First to ${Math.floor(n / 2) + 1} wins, at most ${n} games.`},
  wins:   {label: 'First to',      unit: 'wins',   note: n => `Plays until somebody has won ${n} game${n === 1 ? '' : 's'}.`},
  points: {label: 'First to',      unit: 'points', note: n => `Plays until somebody's running total reaches ${n}.`},
  games:  {label: 'Fixed',         unit: 'games',  note: n => `Exactly ${n} game${n === 1 ? '' : 's'}, most points overall wins.`},
};
const seriesTarget = sr => sr.mode === 'bo' ? Math.floor(sr.n / 2) + 1 : sr.n;

/* The World Series is a best of seven where every game is a random era, a
   random category and one pick each - whoever names the deeper player takes
   the game. It is a preset over the ordinary series machinery rather than a
   mode of its own, so everything that already works for a series (the tally,
   draws, records, the standings screen) works for it untouched. */
const WS = {n: 7, note: 'Best of seven. Every game is a random era and a random category, one pick each — the deeper player takes the game. First pick alternates.'};

function seriesLabel(sr){
  if (sr.ws) return 'World Series';
  const m = SMODES[sr.mode];
  return sr.mode === 'bo' ? `Best of ${sr.n}` : `${m.label} ${sr.n} ${m.unit}`;
}

function startSeries(){
  const ws = !!(S.fmt.on && S.fmt.ws);
  S.SR = {
    id: Date.now(), ws,
    mode: ws ? 'bo' : S.fmt.mode, n: ws ? WS.n : S.fmt.n,
    randCat: ws || S.fmt.randCat, randEra: ws || S.fmt.randEra,
    names: S.seats.map((n, i) => (n.trim() || `Drafter ${i + 1}`)),
    wins: {}, pts: {}, games: [], done: false,
  };
}

/* Fold a finished game into the running tally and decide whether that ends it. */
function seriesTake(rec){
  const sr = S.SR;
  /* A drawn game advances nobody. The record's own `win` flag marks every top
     scorer, which is right for career stats, but crediting both here let a
     best-of-three end 2-2 after two draws. Points still accumulate. */
  const top = Math.max(...rec.players.map(p => p.pts));
  const leaders = rec.players.filter(p => p.pts === top);
  const winner = leaders.length === 1 ? leaders[0].name : null;

  sr.games.push({
    no: sr.games.length + 1, label: rec.label, range: rec.range, post: rec.post,
    drawn: !winner,
    scores: rec.players.map(p => ({name: p.name, pts: p.pts, win: p.name === winner})),
  });
  for (const p of rec.players) sr.pts[p.name] = (sr.pts[p.name] || 0) + p.pts;
  if (winner) sr.wins[winner] = (sr.wins[winner] || 0) + 1;

  const target = seriesTarget(sr);
  const best = k => Math.max(0, ...Object.values(sr[k]));
  /* A World Series has to produce a champion. One-pick games draw often - both
     strike, or both land the same rank - so seven games can pass with nobody at
     four. Past game seven it becomes sudden death: it ends the moment somebody
     leads outright on wins, or at the same cap first-to-N-wins uses. */
  const soleLeader = () => {
    const w = Object.values(sr.wins);
    return w.length > 0 && w.filter(x => x === best('wins')).length === 1;
  };
  if (sr.ws)                     sr.done = best('wins') >= target
                                   || (sr.games.length >= sr.n && soleLeader())
                                   || sr.games.length >= 99;
  else if (sr.mode === 'points') sr.done = best('pts') >= target;
  else if (sr.mode === 'games')  sr.done = sr.games.length >= sr.n;
  else if (sr.mode === 'bo')     sr.done = best('wins') >= target || sr.games.length >= sr.n;
  /* first-to-N-wins has no natural end if every game is drawn, so it is capped;
     the standings screen also offers "End series now" at any point */
  else                           sr.done = best('wins') >= target || sr.games.length >= 99;
  return sr.done;
}

function seriesStanding(){
  const sr = S.SR;
  return sr.names.map(n => ({name: n, wins: sr.wins[n] || 0, pts: sr.pts[n] || 0}))
    .sort((a, b) => b.wins - a.wins || b.pts - a.pts);
}

function renderSeries(){
  const sr = S.SR, rows = seriesStanding(), target = seriesTarget(sr);
  const lead = rows[0], tied = rows.filter(r => r.wins === lead.wins && r.pts === lead.pts);

  const no = sr.games.length + 1;
  $('ser-head').textContent = sr.done
    ? (tied.length > 1 ? 'Series tied' : sr.ws ? `${lead.name} wins the World Series` : `${lead.name} takes the series`)
    : `${seriesLabel(sr)} — game ${no}${sr.ws && no > sr.n ? ' · sudden death' : ''}`;
  $('ser-sub').textContent = sr.done
    ? `${sr.games.length} game${sr.games.length === 1 ? '' : 's'} played.`
    : sr.ws ? WS.note : SMODES[sr.mode].note(sr.n);

  $('ser-table').innerHTML = rows.map((r, i) => `
    <div class="result-row ${i === 0 && sr.done ? 'win' : ''}">
      <div class="pos">${i + 1}</div>
      <div class="nm">${esc(r.name)}</div>
      <div class="sc">${sr.mode === 'points' ? r.pts : r.wins}</div>
    </div>`).join('');

  $('ser-games').innerHTML = sr.games.length ? [...sr.games].reverse().map(g => `
    <div class="hist">
      <div class="top">
        <div class="cat">${esc(g.label)} <span class="mono">${esc(g.range || '')}${g.post ? ' post' : ''}</span></div>
        <div class="when">Game ${g.no}</div>
      </div>
      <div class="line">${g.scores.slice().sort((a, b) => b.pts - a.pts)
        .map(s => `${s.win ? '★ ' : ''}${esc(s.name)} ${s.pts}`).join('   ·   ')}</div>
    </div>`).join('') : '<p class="hint">None yet.</p>';

  $('ser-next').classList.toggle('hidden', sr.done);
  $('ser-done').textContent = sr.done ? 'Done' : 'End series now';
}

/* A random era, drawn by kind first and then by range within the kind. The
   manifest is 106 seasons, 11 decades and 7 spans, so a uniform draw over
   ranges is a single season five times in six and a random series reads as
   "1943 again". Has to land on a range that actually exists for this season
   type - not every year has a postseason file. */
function rollEra(post){
  const pool = (S.manifest ? S.manifest.ranges : []).filter(r => post ? r.post : r.reg);
  if (!pool.length) return null;
  const kinds = [...new Set(pool.map(r => r.kind))];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const of = pool.filter(r => r.kind === kind);
  return of[Math.floor(Math.random() * of.length)];
}

async function seriesNextGame(){
  const sr = S.SR;
  if (sr.randEra && S.manifest){
    const r = rollEra(S.post);
    if (r){
      S.custom = null;
      /* a club filter is kept for an ordinary random-era series - "the Giants,
         random decade" is a fair game - but a World Series is the whole league,
         and a club that did not exist in the rolled era would end it early */
      if (sr.ws && S.teams.length){ S.teams = []; renderTeams(); }
      S.rangeId = r.id;
      renderRanges();
      await loadRange();
    }
  }
  if (sr.randCat && S.data){
    const keys = Object.keys(S.data.cats);
    if (keys.length) S.catId = keys[Math.floor(Math.random() * keys.length)];
    renderCats();
  }
  if (!S.data || !S.data.cats[S.catId]){
    setMsg('Could not load the next era. Ending the series here.', 'warn');
    sr.done = true; renderSeries(); return;
  }
  startGame();
}

function renderSeriesHistory(){
  const by = new Map();
  for (const g of RECORDS){
    if (!g.sid) continue;
    let e = by.get(g.sid);
    if (!e){ e = {id: g.sid, mode: g.smode, n: g.sn, ws: false, ts: g.ts, games: [], wins: {}, pts: {}}; by.set(g.sid, e); }
    if (g.sws) e.ws = true;
    e.games.push(g);
    e.ts = Math.max(e.ts, g.ts);
    for (const p of (g.players || [])){
      const k = (p.name || '').trim();
      e.pts[k] = (e.pts[k] || 0) + (p.pts || 0);
      if (p.win) e.wins[k] = (e.wins[k] || 0) + 1;
    }
  }
  const list = [...by.values()].sort((a, b) => b.ts - a.ts).slice(0, 20);
  $('ser-hist-empty').classList.toggle('hidden', list.length > 0);
  $('ser-history').innerHTML = list.map(e => {
    const rows = Object.keys(e.pts).map(n => ({name: n, wins: e.wins[n] || 0, pts: e.pts[n] || 0}))
      .sort((a, b) => b.wins - a.wins || b.pts - a.pts);
    const label = e.ws ? 'World Series' : e.mode === 'bo' ? `Best of ${e.n}`
      : `${(SMODES[e.mode] || {}).label || e.mode} ${e.n} ${(SMODES[e.mode] || {}).unit || ''}`.trim();
    const score = rows.map(r => `${esc(r.name)} ${e.mode === 'points' ? r.pts : r.wins}`).join('–');
    return `<div class="hist">
      <div class="top">
        <div class="cat">${esc(label)} <span class="mono">${e.games.length} game${e.games.length === 1 ? '' : 's'}</span></div>
        <div class="when">${new Date(e.ts).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}</div>
      </div>
      <div class="line">★ ${score}</div>
    </div>`;
  }).join('');
}

/* ---------------------------------------------------------------- render */
function renderGame(){
  const G = S.G;
  /* The cut has to stay on screen. It used to appear once on the opening plate
     and then get overwritten by the first pick, so mid-game there was no way to
     tell whether the man you just named was inside the list or past it. */
  $('g-depth').textContent = String(G.pool.depth);
  /* in a one-pick World Series game the round counter would read 1/1 for ever;
     which game of the seven this is tells the room far more */
  const sr = S.SR;
  if (sr && sr.ws){
    const no = sr.games.length + 1;
    $('g-round-lbl').textContent = 'Game';
    $('g-round').textContent = no <= sr.n ? `${no}/${sr.n}` : String(no);
  } else {
    $('g-round-lbl').textContent = 'Round';
    $('g-round').textContent = G.maxRounds ? `${Math.min(G.round+1, G.maxRounds)}/${G.maxRounds}` : String(G.round+1);
  }
  $('g-left').textContent = openLeft();
  const t = seat();
  $('board').innerHTML = G.players.map((p, i) => `
    <div class="seat-panel ${i === t && !p.out ? 'active' : ''} ${p.out ? 'dead' : ''}">
      <div class="turn-tag">${i === t && !p.out ? 'On the clock' : ''}</div>
      <div class="nm">${esc(p.name)}</div>
      <div class="pts">${p.pts}</div>
      <div class="strikes">${[0,1,2].map(s => `<i class="${s < p.strikes ? 'on' : ''}"></i>`).join('')}</div>
      <div class="wide-tag">${p.wide ? `foul to ${WIDE_TO}${p.wide > 1 ? ' ×' + p.wide : ''}` : ''}</div>
    </div>`).join('');
  $('log').innerHTML = [...G.log].sort((a,b) => a.rank - b.rank).map(r => `
    <div class="log-row">
      <div class="rk">${r.rank}</div>
      <div class="pl">${esc(r.name)} <span class="mono">${fmtVal(r.val)} ${G.abbr}</span></div>
      <div class="who">${esc(r.by)}</div>
    </div>`).join('');
  $('log-empty').classList.toggle('hidden', G.log.length > 0);
  /* misses sit under the taken list: a named man is out of play either way, and
     seeing what has already been burned is half the information in the room */
  const miss = G.misses || [];
  $('miss-label').classList.toggle('hidden', !miss.length);
  $('miss-log').innerHTML = miss.map(m => `
    <div class="log-row miss">
      <div class="rk">${m.rank ? m.rank : '\u2014'}</div>
      <div class="pl">${esc(m.name)}${m.real === false ? '' :
        ` <span class="mono">${m.val != null ? fmtVal(m.val) + ' ' + G.abbr : 'no ' + G.abbr}</span>`}
        ${m.kind === 'foul' ? '<span class="tag">foul</span>' : ''}</div>
      <div class="who">${esc(m.by)}</div>
    </div>`).join('');
  const p = G.players[t];
  $('guess').placeholder = p ? `${p.name} \u2014 name a player` : 'Name a player';
}

function setPlate(meta, big, sub, cls){
  $('plate').className = 'plate ' + (cls || '');
  $('plate-meta').textContent = meta;
  const b = $('plate-big');
  b.textContent = big;
  b.classList.remove('slotted'); void b.offsetWidth; b.classList.add('slotted');
  $('plate-sub').textContent = sub;
}
const setMsg = (t, c) => $('msg-slot').innerHTML = `<div class="msg ${c||''}">${esc(t)}</div>`;
const clearMsg = () => $('msg-slot').innerHTML = '';
const clearConfirm = () => $('confirm-slot').innerHTML = '';
const focusGuess = () => setTimeout(() => $('guess').focus(), 40);

function renderSeats(){
  $('seats').innerHTML = S.seats.map((n, i) => `
    <div class="seat">
      <div class="num">${i+1}</div>
      <input type="text" data-seat="${i}" value="${esc(n)}" placeholder="Drafter ${i+1}" maxlength="16">
      ${S.seats.length > 1 ? `<button data-drop="${i}" aria-label="Remove drafter ${i+1}">\u2715</button>` : ''}
    </div>`).join('');
  $('seats').querySelectorAll('input').forEach(el =>
    el.oninput = e => S.seats[+e.target.dataset.seat] = e.target.value);
  $('seats').querySelectorAll('button').forEach(el =>
    el.onclick = e => { S.seats.splice(+e.target.dataset.drop, 1); renderSeats(); });
  $('add-seat').disabled = S.seats.length >= 4;
  /* One drafter is solo practice: the same board and the same rules, with
     nobody taking players off it and nothing to win. Saying so on the setup
     screen matters because everything else here is worded for a room. */
  const solo = S.seats.length === 1;
  $('seat-note').textContent = solo
    ? 'Solo practice \u2014 no opponent, nothing to win, and the game is not counted as a win in your records. Pick "Until you are out" to keep going until three strikes.'
    : 'Use real names \u2014 records track people across games by name.';
  $('rounds-out').textContent = solo ? 'Until you are out' : "Until everyone's out";
  /* a series needs somebody to be ahead of */
  $('fmt-card').classList.toggle('hidden', solo);
  if (solo) S.fmt.on = false;
  syncFormat();
}

/* The setup screen has to agree with S.fmt wherever it was changed from - the
   format pills, the seat count, a finished series. A World Series needs no era,
   category or rounds of its own, so those cards go; leaving them up invites
   choosing something the roll is about to ignore. */
function syncFormat(){
  const press = (sel, on) => document.querySelectorAll(sel).forEach(x =>
    x.setAttribute('aria-pressed', String(on(x))));
  const solo = S.seats.length === 1;
  const ws = S.fmt.on && S.fmt.ws && !solo;
  const m = SMODES[S.fmt.mode];
  $('s-n-label').textContent = m.unit === 'points' ? 'Points' : (S.fmt.mode === 'bo' ? 'Games' : m.unit === 'wins' ? 'Wins' : 'Games');
  $('s-n-note').textContent = m.note(S.fmt.n);
  $('series-opts').classList.toggle('hidden', !S.fmt.on || ws);
  $('ws-note').classList.toggle('hidden', !ws);
  for (const id of ['era-card', 'team-card', 'cat-card', 'rounds-card'])
    $(id).classList.toggle('hidden', ws);
  press('#fmt-set .pill', x => x.dataset.fmt === (!S.fmt.on ? 'single' : S.fmt.ws ? 'ws' : 'series'));
  press('#smode-set .pill', x => x.dataset.smode === S.fmt.mode);
  press('#svary-set .pill', x => x.dataset.vary === 'cat' ? S.fmt.randCat : S.fmt.randEra);
  $('start').textContent = solo ? 'Start solo practice' : ws ? 'Play the World Series' : 'Start draft';
  /* the start button normally waits for a category to load; a World Series
     brings its own, so it only needs the manifest */
  if (ws) $('start').disabled = !S.manifest;
}

function renderRanges(){
  const custom = S.kind === 'custom';
  $('custom-set').classList.toggle('hidden', !custom);
  $('range-set').classList.toggle('hidden', custom);
  $('range-search').classList.toggle('hidden', custom);
  if (custom) return;

  const q = $('range-search').value.trim().toLowerCase();
  let list = S.manifest.ranges.filter(r => r.kind === S.kind);
  if (q) list = S.manifest.ranges.filter(r => r.id.includes(q) || r.label.toLowerCase().includes(q));
  list = list.filter(r => S.post ? r.post : r.reg);
  $('range-set').innerHTML = list.map(r =>
    `<button class="pill" data-range="${r.id}" aria-pressed="${S.rangeId === r.id}">${r.label}</button>`).join('')
    || '<p class="hint">Nothing matches.</p>';
  $('range-set').querySelectorAll('[data-range]').forEach(el =>
    el.onclick = () => { S.rangeId = el.dataset.range; S.custom = null; renderRanges(); renderTeams(); loadRange(); });
}

const TEAM_MODES = {
  only:   'Only what a player did **for that club** counts. A traded man\u2019s other numbers stay with his other team, so this is the club\u2019s own record book. Awards are left out \u2014 they cannot honestly be split by team.',
  played: 'Anyone who **wore the shirt** in this era, with their whole line for the era, wherever they earned it. Randy Johnson counts for the Giants on his full record, not on the half-season he spent there.',
};

async function renderTeams(){
  const on = S.teamMode !== 'all';
  $('team-picker').classList.toggle('hidden', !on);
  if (!on) return;
  await loadTeamIndex();
  const yrs = activeYears();
  if (!yrs){ $('team-set').innerHTML = '<p class="hint">Pick an era first.</p>'; return; }
  const q = $('team-search').value.trim().toLowerCase();
  let list = teamsInRange(yrs[0], yrs[1]);
  if (q) list = list.filter(t => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  $('team-set').innerHTML = list.map(t =>
    `<button class="pill" data-team="${t.id}" aria-pressed="${S.teams.includes(t.id)}"
             title="${esc(t.name)} ${t.y0}\u2013${t.y1}">${esc(t.name)}</button>`).join('')
    || '<p class="hint">No clubs match.</p>';
  $('team-set').querySelectorAll('[data-team]').forEach(el => el.onclick = () => {
    const id = el.dataset.team;
    S.teams = S.teams.includes(id) ? S.teams.filter(x => x !== id) : S.teams.concat([id]);
    renderTeams(); loadRange();
  });
  const n = S.teams.length;
  const blurb = (TEAM_MODES[S.teamMode] || '').replace(/\*\*(.+?)\*\*/g, '$1');
  $('team-note').textContent = n
    ? `${n} club${n === 1 ? '' : 's'} selected. ${blurb}`
    : `${list.length} clubs played inside this era. ${blurb}`;
}

function renderCats(){
  const groups = {bat: 'cats-bat', pit: 'cats-pit', awd: 'cats-awd'};
  const cats = S.data ? S.data.cats : {};
  for (const [side, elId] of Object.entries(groups)){
    const mine = Object.entries(cats).filter(([, c]) => c.side === side);
    $(elId).innerHTML = mine.map(([id, c]) =>
      `<button class="pill" data-cat="${id}" aria-pressed="${S.catId === id}">${c.label}</button>`).join('')
      || '<p class="hint">None for this era.</p>';
  }
  $('awd-label').classList.toggle('hidden', !Object.values(cats).some(c => c.side === 'awd'));
  $('cats-awd').classList.toggle('hidden', !Object.values(cats).some(c => c.side === 'awd'));
  document.querySelectorAll('[data-cat]').forEach(el =>
    el.onclick = () => { S.catId = el.dataset.cat; renderCats(); });
  const c = cats[S.catId];
  $('start').disabled = !c;
  $('start-note').textContent = c
    ? `Top ${SCORE_TO} in ${c.label.toLowerCase()}, ${S.data.label}${S.post ? ' postseason' : ''}`
      + ` \u2014 ranked ${c.depth} deep, so a miss still tells you where he stood.`
    : 'Pick a category.';
}

/* --------------------------------------------------------------- records */
function loadRecords(){
  /* "null" and "{}" both parse cleanly and neither is iterable, and the first
     thing to trip over that would be finish() - after the game, before the
     record is written. Import already checks the shape; loading has to too. */
  try { const v = JSON.parse(localStorage.getItem(REC_KEY) || '[]'); RECORDS = Array.isArray(v) ? v : []; }
  catch (e) { RECORDS = []; }
}
function saveRecords(){
  try { localStorage.setItem(REC_KEY, JSON.stringify(RECORDS.slice(-400))); }
  catch (e) { setMsg('Records could not be saved \u2014 storage is full or blocked.', 'warn'); }
}
/* How rarely anyone else names a player. Rarity is measured against the other
   people in the records, not against the whole population of picks: "nobody
   else goes there" is the thing worth rewarding, and it is the question that
   was actually asked. With one drafter there is no answer, so it stays null. */
function rarityIndex(){
  const byPlayer = new Map();      // pick key -> set of people who named him
  const people = new Set();
  for (const g of RECORDS)
    for (const p of (g.players || [])){
      const who = (p.name || '').trim().toLowerCase();
      if (!who) continue;
      people.add(who);
      for (const pk of (p.picked || [])){
        const k = pk.i != null ? 'i' + pk.i : 'n' + norm(pk.n || '');
        if (!byPlayer.has(k)) byPlayer.set(k, new Set());
        byPlayer.get(k).add(who);
      }
    }
  return {
    people,
    /* share of the *other* drafters who have never named him */
    of(key, me){
      const others = people.size - (people.has(me) ? 1 : 0);
      if (others <= 0) return null;
      const knew = [...(byPlayer.get(key) || [])].filter(w => w !== me).length;
      return 1 - knew / others;
    },
    key: pk => (pk.i != null ? 'i' + pk.i : 'n' + norm(pk.n || '')),
  };
}

/* Longest run of successful picks inside a single game. Streaks do not carry
   across games - a new board is a new problem. */
function bestStreak(seq){
  let best = 0, run = 0;
  for (const c of String(seq || '')){
    if (c === 'p'){ run++; if (run > best) best = run; } else run = 0;
  }
  return best;
}

function careerStats(){
  const RX = rarityIndex();
  const m = new Map();
  for (const g of RECORDS) for (const p of (g.players || [])){
    const k = (p.name || '').trim().toLowerCase();
    if (!k) continue;
    let r = m.get(k);
    if (!r){ r = {name: p.name.trim(), games:0, wins:0, solo:0, pts:0, picks:0, strikes:0, fouls:0,
                  ranks:[], best:0, turns:0, firstOk:0, streak:0, rare:0, rareN:0}; m.set(k, r); }
    r.games++; if (p.win) r.wins++;
    /* solo games are counted but never won, so the win column has to say how
       many of the games were unwinnable or it reads as a losing streak */
    if (g.solo || (g.players || []).length === 1) r.solo++;
    r.pts += p.pts||0; r.picks += p.picks||0; r.strikes += p.strikes||0; r.fouls += p.fouls||0;
    r.turns += p.turns||0; r.firstOk += p.firstOk||0;
    r.streak = Math.max(r.streak, bestStreak(p.seq));
    for (const pk of (p.picked || [])){
      const v = RX.of(RX.key(pk), k);
      if (v != null){ r.rare += (pk.r || 0) * v; r.rareN++; }
    }
    r.ranks.push(...(p.ranks || []));
    if ((p.pts||0) > r.best) r.best = p.pts||0;
  }
  return [...m.values()].map(r => ({...r,
    ppg: r.games ? r.pts / r.games : 0,
    hit: (r.picks + r.strikes) ? r.picks / (r.picks + r.strikes) : 0,
    ppp: r.picks ? r.pts / r.picks : 0,
    first: r.turns ? r.firstOk / r.turns : 0,
    rarePts: r.rare, streak: r.streak,
    depth: r.ranks.length ? r.ranks.reduce((a,b) => a+b, 0) / r.ranks.length : 0,
    deepest: r.ranks.length ? Math.max(...r.ranks) : 0,
  }));
}
const SORTERS = {
  ppg:  (a,b) => b.ppg - a.ppg,
  ppp:  (a,b) => b.ppp - a.ppp || b.ppg - a.ppg,
  hit:  (a,b) => b.hit - a.hit || b.ppg - a.ppg,
  depth:(a,b) => b.depth - a.depth || b.ppg - a.ppg,
  best: (a,b) => b.best - a.best || b.ppg - a.ppg,
  rare: (a,b) => b.rarePts - a.rarePts || b.ppg - a.ppg,
  first:(a,b) => b.first - a.first || b.ppg - a.ppg,
  streak:(a,b) => b.streak - a.streak || b.ppg - a.ppg,
  wins: (a,b) => b.wins - a.wins || b.ppg - a.ppg,
  pts:  (a,b) => b.pts - a.pts,
};
function renderRecords(){
  const rows = careerStats().sort(SORTERS[S.recSort]);
  $('rec-empty').classList.toggle('hidden', rows.length > 0);
  $('rec-list').innerHTML = rows.map((r, i) => `
    <div class="rec tappable ${i === 0 ? 'lead' : ''}" data-who="${esc(r.name)}" role="button" tabindex="0">
      <div class="rec-head">
        <div class="pos">${i+1}</div>
        <div class="nm">${esc(r.name)}</div>
        <div class="gm">${r.games} game${r.games===1?'':'s'} \u00b7 ${r.wins} won${r.solo ? ` \u00b7 ${r.solo} solo` : ''}</div>
      </div>
      <div class="rec-stats">
        <div><b>${r.ppg.toFixed(1)}</b><span>pts/game</span></div>
        <div><b>${r.ppp ? r.ppp.toFixed(0) : '\u2014'}</b><span>pts/pick</span></div>
        <div><b>${Math.round(r.hit*100)}%</b><span>hit rate</span></div>
        <div><b>${r.best || '\u2014'}</b><span>best game</span></div>
        <div><b>${r.deepest || '\u2014'}</b><span>deepest</span></div>
        <div><b>${r.fouls}</b><span>fouls</span></div>
      </div>
    </div>`).join('');
  $('rec-list').querySelectorAll('[data-who]').forEach(el => {
    const open = () => renderProfile(el.dataset.who);
    el.onclick = open;
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); } };
  });
  $('rec-tap').textContent = rows.length ? 'Tap anyone for their full breakdown.' : '';
  $('rec-key').textContent = rows.length
    ? 'Hit rate is picks that landed. Depth is the average rank of those picks \u2014 higher means further down the list, which is the harder knowledge.'
    : '';
  renderSeriesHistory();
  const h = [...RECORDS].reverse().slice(0, 40);
  $('hist-empty').classList.toggle('hidden', h.length > 0);
  /* Every game opens. The per-game detail used to live only inside one person's
     profile, which meant the game list on this screen looked tappable and did
     nothing - and it is the obvious place to ask "what happened in that game".
     Opening here shows every drafter at once, which the profile cannot: a
     profile is one person by definition. */
  $('hist-list').innerHTML = h.map((g, i) => {
    const o = [...(g.players||[])].sort((a,b) => b.pts - a.pts);
    return `<div class="hist-row">
      <button class="hist tappable" data-hist="${i}" aria-expanded="false" aria-controls="hist-body-${i}">
        <div class="top">
          <div class="cat">${esc(g.label || g.cat)} <span class="mono">${esc(g.range||'')}${g.post?' post':''}${g.solo?' \u00b7 solo':''}</span></div>
          <div class="when">${new Date(g.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
        </div>
        <div class="line">${o.map((p,n) => `${n===0 && !g.solo ?'\u2605 ':''}${esc(p.name)} ${p.pts}`).join('   \u00b7   ')}</div>
      </button>
      <div class="hist-body hidden" id="hist-body-${i}">
        ${o.map(p => `
          <div class="hb-who">${esc(p.name)}
            <span class="mono">${p.pts} pts \u00b7 ${p.picks||0} pick${(p.picks||0)===1?'':'s'} \u00b7 ${p.strikes||0} strike${(p.strikes||0)===1?'':'s'}${p.fouls ? ` \u00b7 ${p.fouls} foul${p.fouls===1?'':'s'}` : ''}</span></div>
          ${histPicks(g, p)}`).join('')}
      </div>
    </div>`;
  }).join('');
  $('hist-list').querySelectorAll('[data-hist]').forEach(el => el.onclick = () => {
    const b = $('hist-body-' + el.dataset.hist);
    const open = !b.classList.contains('hidden');
    b.classList.toggle('hidden', open);
    el.setAttribute('aria-expanded', String(!open));
  });
  $('hist-tap').textContent = h.length ? 'Tap any game for who picked what.' : '';
}

/* One drafter's picks and misses inside one game. Records written before picks
   carried names have only `ranks`, and ones written before the miss list have no
   `misses` at all, so both are reported as what they are rather than as an empty
   game - the same rule the breakdowns follow. */
function histPicks(g, p){
  const rows = [];
  const picked = p.picked || [];
  if (picked.length)
    rows.push(...picked.slice().sort((a,b) => a.r - b.r).map(pk =>
      `<div class="gm-pick"><span class="r">${pk.r}</span>${esc(pk.n)}</div>`));
  else if ((p.ranks || []).length)
    rows.push(`<div class="gm-pick"><span class="r">\u2014</span>${p.ranks.length} pick${p.ranks.length===1?'':'s'}, recorded before names were kept</div>`);
  else
    rows.push('<div class="gm-pick"><span class="r">\u2014</span>nothing landed</div>');
  const mine = (g.misses || []).filter(m => m.by === p.name);
  rows.push(...mine.map(m =>
    `<div class="gm-pick miss"><span class="r">${m.r || '\u2014'}</span>${esc(m.n)}<span class="tag">${m.k}${m.w ? ' \u00b7 ' + WIDE_TO : ''}</span></div>`));
  if (!g.misses && (p.strikes || p.fouls))
    rows.push('<div class="gm-pick miss"><span class="r">\u2014</span>misses were not recorded in this game</div>');
  return rows.join('');
}

/* --------------------------------------------------------------- profile */
/* Which seasons and which clubs a player belongs to, so a pick's points can be
   spread across them. Loaded once, lazily - the records screen is the only
   thing that wants it. */
const PX = {played: null, clubs: null, ok: false};
async function loadBreakdowns(){
  if (PX.played) return;
  /* An empty stand-in keeps the screen rendering when the index will not load,
     but it must not be mistaken for a real answer: everything downstream then
     finds nothing and would otherwise report "no successful picks" to someone
     who has plenty. PX.ok is what tells the two apart. A bad status has to be
     caught explicitly - /data/ is cache-first in the service worker, so a 404
     cached once would otherwise be served for good. */
  const [played, ix] = await Promise.all([
    fetch('data/played.json').then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      .catch(() => null),
    fetch('data-teams/index.json').then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      .catch(() => ({franchises: {}})),
  ]);
  PX.ok = !!(played && played.y && Object.keys(played.y).length);
  PX.played = played || {y: {}, f: {}};
  PX.clubs = ix.franchises || {};
  renderRecords();
}

/* A record written before this existed has no y0/y1; the range id still carries
   the years for every shape of range the game has ever produced. */
function recYears(g){
  if (Number.isInteger(g.y0) && Number.isInteger(g.y1)) return [g.y0, g.y1];
  const m = String(g.range || '').match(/(\d{4})(?:\D+(\d{4}))?/);
  if (!m) return null;
  return [+m[1], m[2] ? +m[2] : +m[1]];
}

/* Rescaled when scoring was cut to the top 100. The last bucket only holds
   picks from games played before that, which are still in people's records. */
const DEPTH_BUCKETS = [[1,10,'1\u201310'], [11,25,'11\u201325'], [26,50,'26\u201350'],
                       [51,75,'51\u201375'], [76,100,'76\u2013100'], [101,1e9,'101+']];

function profileFor(name){
  const key = name.trim().toLowerCase();
  const RX = rarityIndex();
  const mine = RECORDS.filter(g => (g.players||[]).some(p => (p.name||'').trim().toLowerCase() === key));
  const P = {name, games: mine.length, wins: 0, pts: 0, picks: 0, strikes: 0, fouls: 0,
             ranks: [], cats: new Map(), eras: new Map(), h2h: new Map(), sig: new Map(),
             years: new Map(), clubs: new Map(), log: [], h2hYears: new Map(),
             turns: 0, firstOk: 0, streak: 0, rarePts: 0, rareList: [],
             rareN: 0, rareSum: 0, idless: 0, idlessPts: 0, solo: 0};
  for (const g of mine){
    const me = g.players.find(p => (p.name||'').trim().toLowerCase() === key);
    const ranks = (me.picked && me.picked.length) ? me.picked.map(x => x.r) : (me.ranks || []);
    const span = recYears(g);          // needed by both the h2h and season splits
    if (me.win) P.wins++;
    if (g.solo || (g.players || []).length === 1) P.solo++;
    P.pts += me.pts||0; P.picks += me.picks||0; P.strikes += me.strikes||0; P.fouls += me.fouls||0;
    P.turns += me.turns||0; P.firstOk += me.firstOk||0;
    P.streak = Math.max(P.streak, bestStreak(me.seq));
    P.ranks.push(...ranks);

    const bump = (map, k, label) => {
      let e = map.get(k);
      if (!e){ e = {label, games:0, ranks:[], picks:0, strikes:0, pts:0}; map.set(k, e); }
      e.games++; e.ranks.push(...ranks); e.picks += me.picks||0; e.strikes += me.strikes||0;
      return e;
    };
    const bc = bump(P.cats, g.cat, (g.label || g.cat) + (g.post ? ' (post)' : ''));
    const be = bump(P.eras, g.range || '?', g.range || 'Unknown');
    for (const e of [bc, be]){
      e.pts += me.pts || 0;
      e.turns = (e.turns || 0) + (me.turns || 0);
      e.firstOk = (e.firstOk || 0) + (me.firstOk || 0);
    }

    for (const o of g.players){
      const ok = (o.name||'').trim().toLowerCase();
      if (ok === key) continue;
      let h = P.h2h.get(ok);
      if (!h){ h = {name: o.name.trim(), games:0, ahead:0, behind:0, tied:0, margin:0}; P.h2h.set(ok, h); }
      h.games++;
      if (me.pts > o.pts) h.ahead++; else if (me.pts < o.pts) h.behind++; else h.tied++;
      h.margin += (me.pts||0) - (o.pts||0);
      /* the same season split, run for both of them over the games they shared,
         so the chart shows where two people's knowledge actually diverges */
      if (PX.played){
        let yy = P.h2hYears.get(ok);
        if (!yy){ yy = new Map(); P.h2hYears.set(ok, yy); }
        const add = (side, picks) => {
          for (const pk of (picks || [])){
            if (pk.i == null) continue;
            const all = PX.played.y[pk.i] || [];
            const inside = span ? all.filter(y => y >= span[0] && y <= span[1]) : all;
            const ys = inside.length ? inside : all;
            if (!ys.length) continue;
            const share = pk.r / ys.length;
            for (const y of ys){
              const row = yy.get(y) || [0, 0];
              row[side] += share; yy.set(y, row);
            }
          }
        };
        add(0, me.picked); add(1, o.picked);
      }
    }
    for (const pk of (me.picked || [])){
      P.sig.set(pk.n, (P.sig.get(pk.n) || 0) + 1);
      /* Records written before picks carried a player id cannot be placed in a
         season or a club. Counting them is what lets the screen say so instead
         of claiming there were no picks at all. */
      if (pk.i == null){ P.idless++; P.idlessPts += pk.r || 0; }
      const v = RX.of(RX.key(pk), key);
      if (v != null){
        P.rarePts += (pk.r || 0) * v;
        P.rareSum += v; P.rareN++;
        P.rareList.push({name: pk.n, rank: pk.r, rare: v});
      }
    }

    /* Spread each pick across the seasons he played inside this era, and across
       his clubs weighted by how long he was at each. Splitting rather than
       counting him whole in every bucket keeps the totals reconciling with the
       points actually scored. */
    if (PX.played){
      for (const pk of (me.picked || [])){
        if (pk.i == null) continue;
        const all = PX.played.y[pk.i] || [];
        const inside = span ? all.filter(y => y >= span[0] && y <= span[1]) : all;
        /* fall back to his whole career if none of it lands inside the era -
           otherwise those points quietly disappear and the chart stops
           reconciling with the score */
        const ys = inside.length ? inside : all;
        if (ys.length){
          const share = pk.r / ys.length;
          for (const y of ys) P.years.set(y, (P.years.get(y) || 0) + share);
        } else P.unplaced = (P.unplaced || 0) + pk.r;
        const cl = PX.played.f[pk.i] || {};
        const tot = Object.values(cl).reduce((a, b) => a + b, 0);
        if (tot) for (const [fr, n] of Object.entries(cl))
          P.clubs.set(fr, (P.clubs.get(fr) || 0) + pk.r * n / tot);
      }
    }

    P.log.push({ts: g.ts, label: g.label || g.cat, range: g.range, post: g.post,
                pts: me.pts || 0, picks: me.picks || 0, strikes: me.strikes || 0,
                fouls: me.fouls || 0, win: !!me.win, teams: g.teams || null,
                picked: (me.picked || []).slice(), misses: g.misses || [],
                against: g.players.filter(o => (o.name || '').trim().toLowerCase() !== key)
                                  .map(o => ({name: o.name, pts: o.pts}))});
  }
  const avg = a => a.length ? a.reduce((x,y) => x+y, 0) / a.length : 0;
  P.ppg = P.games ? P.pts / P.games : 0;
  P.hit = (P.picks + P.strikes) ? P.picks / (P.picks + P.strikes) : 0;
  P.depth = avg(P.ranks);
  P.deepest = P.ranks.length ? Math.max(...P.ranks) : 0;
  /* points per game per era answers "which decades do you actually know", which
     average rank does not - a shallow list caps how deep anyone can go. Set
     before shape() copies these, or the copies come out without it. */
  for (const m of [P.cats, P.eras])
    for (const e of m.values()){
      e.ppg = e.games ? e.pts / e.games : 0;
      e.first = e.turns ? e.firstOk / e.turns : null;
    }
  const shape = m => [...m.values()].map(e => ({...e, depth: avg(e.ranks),
    hit: (e.picks+e.strikes) ? e.picks/(e.picks+e.strikes) : 0}))
    .filter(e => e.ranks.length).sort((a,b) => b.depth - a.depth);
  P.catList = shape(P.cats);
  P.eraList = shape(P.eras);
  P.h2hList = [...P.h2h.values()].sort((a,b) => b.games - a.games);
  for (const h of P.h2hList){
    const yy = P.h2hYears.get((h.name || '').trim().toLowerCase());
    h.years = yy ? [...yy.entries()].sort((a, b) => a[0] - b[0]) : [];
  }
  P.yearList = [...P.years.entries()].sort((a, b) => a[0] - b[0]);
  P.clubList = [...P.clubs.entries()].sort((a, b) => b[1] - a[1]);
  P.log.sort((a, b) => b.ts - a.ts);
  P.first = P.turns ? P.firstOk / P.turns : 0;
  P.rareAvg = P.rareN ? P.rareSum / P.rareN : null;
  P.rareList.sort((a, b) => b.rare - a.rare || b.rank - a.rank);
  P.best = P.log.reduce((m, g) => Math.max(m, g.pts), 0);
  P.sigList = [...P.sig.entries()].filter(([,n]) => n > 1).sort((a,b) => b[1] - a[1]).slice(0, 10);
  return P;
}

/* Two people's season points, back to back. Bars grow from a shared centre so
   the years one of them owns are obvious at a glance. */
function diverge(h){
  if (!h.years || !h.years.length)
    return '<p class="hint">No season data for the games you shared.</p>';
  const wide = h.years.length > 25;
  const rows = wide
    ? [...h.years.reduce((m, [y, v]) => {
        const d = Math.floor(y / 10) * 10, r = m.get(d) || [0, 0];
        r[0] += v[0]; r[1] += v[1]; return m.set(d, r);
      }, new Map())].sort((a, b) => a[0] - b[0]).map(([d, v]) => [d + 's', v])
    : h.years;
  const max = Math.max(1, ...rows.map(([, v]) => Math.max(v[0], v[1])));
  return `<div class="dv">${rows.map(([lab, v]) => `
    <div class="dv-row">
      <div class="dv-l"><div class="dv-bar mine" style="width:${v[0] / max * 100}%"></div></div>
      <div class="dv-lab">${esc(String(lab))}</div>
      <div class="dv-r"><div class="dv-bar theirs" style="width:${v[1] / max * 100}%"></div></div>
    </div>`).join('')}</div>
    <p class="hint">Left is you, right is ${esc(h.name)}, across the ${h.games} game${h.games === 1 ? '' : 's'} you shared.</p>`;
}

function renderProfile(name){
  S.profName = name;
  const P = profileFor(name);
  const key = name.trim().toLowerCase();
  $('prof-name').textContent = P.name;
  $('prof-top').innerHTML = [
    [P.games, 'games'], [P.wins, P.solo ? `wins · ${P.solo} solo` : 'wins'],
    [P.ppg.toFixed(1), 'pts/game'],
    [Math.round(P.hit*100) + '%', 'hit rate'],
    [P.turns ? Math.round(P.first*100) + '%' : '\u2014', 'first guess'],
    [P.streak || '\u2014', 'best streak'],
  ].map(([v,l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');

  const counts = DEPTH_BUCKETS.map(([lo,hi]) => P.ranks.filter(r => r >= lo && r <= hi).length);
  const max = Math.max(1, ...counts);
  $('prof-hist').innerHTML = P.ranks.length
    ? DEPTH_BUCKETS.map(([,,lab], i) => `
      <div class="bar-row">
        <div class="lab">${lab}</div>
        <div class="track"><div class="fill" style="width:${counts[i]/max*100}%"></div></div>
        <div class="n">${counts[i]}</div>
      </div>`).join('')
    : '<p class="hint">No successful picks yet.</p>';

  const brk = list => list.map(e => `
    <div class="brk">
      <div class="t">${esc(e.label)}</div>
      <div class="s">${e.games} game${e.games===1?'':'s'}</div>
      <div class="v">${e.depth.toFixed(0)}</div>
    </div>`).join('');
  $('prof-cats').innerHTML = P.catList.length ? brk(P.catList) : '<p class="hint">Nothing yet.</p>';
  $('prof-cats-note').textContent = P.catList.length > 1
    ? `Strongest: ${P.catList[0].label} at ${P.catList[0].depth.toFixed(0)} average. Weakest: ${P.catList[P.catList.length-1].label} at ${P.catList[P.catList.length-1].depth.toFixed(0)}.`
    : 'Play a few categories and the split shows up here.';
  /* eras are graded on points per game, not average rank: a shallow list caps
     how deep anyone can go, so rank flatters the eras nobody knows well */
  $('prof-eras').innerHTML = P.eraList.length ? P.eraList.slice()
    .sort((a, b) => (b.ppg || 0) - (a.ppg || 0)).map(e => `
    <div class="brk">
      <div class="t">${esc(e.label)}</div>
      <div class="s">${e.games} game${e.games===1?'':'s'} \u00b7 depth ${e.depth.toFixed(0)}${
        e.first == null ? '' : ` \u00b7 first guess ${Math.round(e.first*100)}%`}</div>
      <div class="v">${(e.ppg || 0).toFixed(0)}</div>
    </div>`).join('') : '<p class="hint">Nothing yet.</p>';
  $('prof-eras-note').textContent = P.eraList.length
    ? 'Graded on points per game, not average rank \u2014 a shallow list caps how deep anyone can go. First guess is how often the opening attempt of a turn landed.'
    : '';

  /* ---- deep cuts: what he knows that nobody else does ---- */
  const rare = P.rareList.filter(r => r.rare > 0).slice(0, 12);
  $('prof-rare').innerHTML = rare.length
    ? rare.map(r => `
      <div class="brk">
        <div class="t">${esc(r.name)}</div>
        <div class="s">rank ${r.rank} \u00b7 ${Math.round(r.rare*100)}% of the others never named him</div>
        <div class="v">${Math.round(r.rank * r.rare)}</div>
      </div>`).join('')
    : `<p class="hint">${P.rareAvg == null
        ? 'Rarity needs somebody to compare against \u2014 play a game with another drafter.'
        : 'Every pick so far is one the others have made too.'}</p>`;
  $('prof-rare-note').textContent = P.rareAvg == null ? ''
    : `Rarity points ${Math.round(P.rarePts)} of ${Math.round(P.pts)}. A pick counts for its rank times the share of the other drafters who have never named that player, so obvious picks are worth little here and nobody is rewarded for their own repeats.`;

  /* ---- seasons ---- */
  const bar = (rows, fmt) => {
    const max = Math.max(1, ...rows.map(r => r[1]));
    return rows.map(r => `
      <div class="bar-row">
        <div class="lab">${esc(String(r[0]))}</div>
        <div class="track"><div class="fill" style="width:${r[1] / max * 100}%"></div></div>
        <div class="n">${fmt(r[1])}</div>
      </div>`).join('');
  };
  const round0 = v => String(Math.round(v));
  if (!PX.played){
    $('prof-years').innerHTML = '<p class="hint">Loading the season index\u2026</p>';
    $('prof-clubs').innerHTML = '';
    loadBreakdowns().then(() => { if (S.profName === name) renderProfile(name); });
  } else {
    /* group into decades once there are more than ~25 seasons to show */
    const ys = P.yearList;
    const wide = ys.length > 25;
    const rows = wide
      ? [...ys.reduce((m, [y, v]) => m.set(Math.floor(y / 10) * 10, (m.get(Math.floor(y / 10) * 10) || 0) + v), new Map())]
          .sort((a, b) => a[0] - b[0]).map(([d, v]) => [d + 's', v])
      : ys;
    /* An empty chart has three quite different causes and they must not read
       the same. Telling somebody with forty picks that they have none reads as
       a bug, which is exactly what it looked like. */
    const empty = !PX.ok
      ? 'The season index could not be loaded, so these cannot be worked out. Reopen this screen once you are back online.'
      : (P.picks && P.idless === P.picks)
        ? `These ${P.picks} picks were recorded before the app kept track of which player was picked, so they cannot be placed. Games from here on will show up.`
        : 'No successful picks yet.';
    /* the chart shows what could actually be placed, so the total it claims to
       reconcile with has to exclude what could not */
    const placed = Math.round(P.pts - P.idlessPts - (P.unplaced || 0));
    const skipped = P.idless
      ? ` ${P.idless} older pick${P.idless === 1 ? '' : 's'} could not be placed and ${P.idless === 1 ? 'is' : 'are'} not counted here.`
      : '';

    $('prof-years').innerHTML = rows.length ? bar(rows, round0)
      : `<p class="hint">${esc(empty)}</p>`;
    $('prof-years-note').textContent = rows.length
      ? `A pick is shared across the seasons that player was active inside the era it was played, so these add up to his ${placed} points.`
        + (P.unplaced ? ` ${Math.round(P.unplaced)} could not be placed in a season.` : '') + skipped
      : '';

    const cl = P.clubList.slice(0, 14);
    $('prof-clubs').innerHTML = cl.length
      ? bar(cl.map(([f, v]) => [(PX.clubs[f] || {}).name || f, v]), round0)
      : `<p class="hint">${esc(empty)}</p>`;
    $('prof-clubs-note').textContent = cl.length
      ? 'A pick is shared across the clubs he played for, weighted by how long he was at each.' + skipped
      : '';
  }

  /* ---- game by game ---- */
  $('prof-games').innerHTML = P.log.length ? P.log.slice(0, 30).map((g, i) => `
    <div class="gm-row">
      <button class="gm-head" data-game="${i}" aria-expanded="false">
        <span class="d">${new Date(g.ts).toLocaleDateString('en-US', {month:'short', day:'numeric'})}</span>
        <span class="c">${esc(g.label)}<span class="mono"> ${esc(g.range || '')}${g.post ? ' post' : ''}</span></span>
        <span class="p">${g.pts}</span>
      </button>
      <div class="gm-body hidden" id="gm-${i}">
        <div class="gm-meta">${g.picks} pick${g.picks===1?'':'s'} \u00b7 ${g.strikes} strike${g.strikes===1?'':'s'} \u00b7 ${g.fouls} foul${g.fouls===1?'':'s'}${g.win ? ' \u00b7 won' : ''}${g.against.length ? ' \u00b7 vs ' + g.against.map(o => esc(o.name) + ' ' + o.pts).join(', ') : ''}</div>
        ${g.picked.length ? g.picked.slice().sort((a,b) => a.r - b.r).map(pk =>
          `<div class="gm-pick"><span class="r">${pk.r}</span>${esc(pk.n)}</div>`).join('')
          : '<div class="gm-pick"><span class="r">\u2014</span>nothing landed</div>'}
        ${(g.misses || []).filter(m => (m.by || '').trim().toLowerCase() === key).map(m =>
          `<div class="gm-pick miss"><span class="r">${m.r || '\u2014'}</span>${esc(m.n)}<span class="tag">${m.k}${m.w ? ' \u00b7 ' + WIDE_TO : ''}</span></div>`).join('')}
      </div>
    </div>`).join('') : '<p class="hint">No games yet.</p>';
  $('prof-games').querySelectorAll('[data-game]').forEach(el => el.onclick = () => {
    const b = $('gm-' + el.dataset.game);
    const open = !b.classList.contains('hidden');
    b.classList.toggle('hidden', open);
    el.setAttribute('aria-expanded', String(!open));
  });
  $('prof-games-note').textContent = P.log.length
    ? `Best game: ${P.best}. Tap any line for the picks and the misses.` : '';

  $('prof-h2h').innerHTML = P.h2hList.length ? P.h2hList.map(h => `
    <div class="h2h-row">
      <button class="brk h2h-head" data-h2h="${esc(h.name)}" aria-expanded="false">
        <div class="t">vs ${esc(h.name)}</div>
        <div class="s">${h.games} together${h.years && h.years.length ? ' \u00b7 tap for the season split' : ''}</div>
        <div class="v">${h.ahead}\u2013${h.behind}${h.tied?'\u2013'+h.tied:''}</div>
      </button>
      <div class="h2h-body hidden">${diverge(h)}</div>
    </div>`).join('') : '<p class="hint">No shared games yet.</p>';
  $('prof-h2h').querySelectorAll('[data-h2h]').forEach(el => el.onclick = () => {
    const b = el.parentElement.querySelector('.h2h-body');
    const open = !b.classList.contains('hidden');
    b.classList.toggle('hidden', open);
    el.setAttribute('aria-expanded', String(!open));
  });
  $('prof-h2h-note').textContent = P.h2hList.length
    ? 'Wins\u2013losses head to head, counting who finished higher in each shared game.'
    : '';

  $('prof-sig').innerHTML = P.sigList.length
    ? P.sigList.map(([n,c]) => `${String(c).padStart(2,' ')}\u00d7  ${esc(n)}`).join('<br>')
    : 'No repeats yet.';
  $('prof-sig-note').textContent = P.sigList.length ? 'Players he keeps going back to.' : '';
  show('profile');
}

/* ------------------------------------------------------------------- nav */
const SCREENS = ['setup','rules','records','profile','game','series','over'];
function show(name){
  SCREENS.forEach(s => $('screen-' + s).classList.toggle('hidden', s !== name));
  ['setup','rules','records'].forEach(s => {
    const b = $('nav-' + s); if (b) b.setAttribute('aria-current', String(s === name));
  });
  window.scrollTo({top: 0, behavior: 'instant'});
}

function wire(){
  $('nav-setup').onclick   = () => show('setup');
  $('nav-rules').onclick   = () => show('rules');
  $('nav-records').onclick = () => { renderRecords(); show('records'); };
  $('to-records').onclick  = () => { renderRecords(); show('records'); };
  $('prof-back').onclick   = () => { renderRecords(); show('records'); };
  $('again').onclick       = () => { S.SR = null; show('setup'); };

  $('add-seat').onclick = () => { if (S.seats.length < 4){ S.seats.push(''); renderSeats(); } };
  $('range-search').oninput = renderRanges;
  $('team-search').oninput = renderTeams;
  document.querySelectorAll('#team-mode .pill').forEach(el => el.onclick = () => {
    S.teamMode = el.dataset.tm;
    document.querySelectorAll('#team-mode .pill').forEach(x =>
      x.setAttribute('aria-pressed', String(x.dataset.tm === S.teamMode)));
    if (S.teamMode === 'all'){ S.teams = []; renderTeams(); return loadRange(); }
    renderTeams();
    if (S.teams.length) loadRange();
  });
  document.querySelectorAll('#kind-set .pill').forEach(el => el.onclick = () => {
    S.kind = el.dataset.kind;
    document.querySelectorAll('#kind-set .pill').forEach(x => x.setAttribute('aria-pressed','false'));
    el.setAttribute('aria-pressed','true');
    $('range-search').value = '';
    /* leaving Custom drops back to a real preset, since the id the custom
       build left behind has no file to load */
    if (S.kind !== 'custom' && S.custom){
      S.custom = null;
      const first = S.manifest.ranges.filter(r => r.kind === S.kind && (S.post ? r.post : r.reg))[0];
      if (first) S.rangeId = first.id;
      renderRanges(); loadRange(); return;
    }
    renderRanges();
  });

  const buildYears = () => {
    const lo = (CX.meta && CX.meta.first) || 1920, hi = (CX.meta && CX.meta.last) || 2025;
    let a = parseInt($('yr-from').value, 10), b = parseInt($('yr-to').value, 10);
    if (!Number.isInteger(a) || !Number.isInteger(b)){
      $('yr-note').textContent = 'Enter a start year and an end year.'; return;
    }
    if (a > b) [a, b] = [b, a];
    a = Math.min(hi, Math.max(lo, a)); b = Math.min(hi, Math.max(lo, b));
    $('yr-from').value = a; $('yr-to').value = b;
    const n = b - a + 1;
    $('yr-note').textContent =
      `${n} season${n === 1 ? '' : 's'}${n >= 10 ? '' : ' — awards need ten or more'}. Building…`;
    S.custom = {y0: a, y1: b};
    S.rangeId = `${a}-${b}`;
    loadRange().then(() => {
      $('yr-note').textContent = `${a}–${b} · ${n} season${n === 1 ? '' : 's'}` +
        (S.data ? ` · ${Object.keys(S.data.cats).length} categories` : '');
    });
  };
  $('yr-go').onclick = buildYears;
  ['yr-from', 'yr-to'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); buildYears(); }
  }));
  const setSeason = post => {
    S.post = post;
    $('tog-reg').setAttribute('aria-pressed', String(!post));
    $('tog-post').setAttribute('aria-pressed', String(post));
    renderRanges(); loadRange();
  };
  $('tog-reg').onclick  = () => setSeason(false);
  $('tog-post').onclick = () => setSeason(true);
  document.querySelectorAll('#rounds-set .pill').forEach(el => el.onclick = () => {
    S.rounds = +el.dataset.rounds;
    document.querySelectorAll('#rounds-set .pill').forEach(x => x.setAttribute('aria-pressed','false'));
    el.setAttribute('aria-pressed','true');
  });
  /* ---- format: single game, a series, or the World Series ---- */
  document.querySelectorAll('#fmt-set .pill').forEach(el => el.onclick = () => {
    S.fmt.on = el.dataset.fmt !== 'single';
    S.fmt.ws = el.dataset.fmt === 'ws';
    S.SR = null; syncFormat();
  });
  document.querySelectorAll('#smode-set .pill').forEach(el => el.onclick = () => {
    S.fmt.mode = el.dataset.smode;
    /* a sane default for each mode, since 7 points is not a series */
    S.fmt.n = {bo: 7, wins: 3, points: 500, games: 5}[S.fmt.mode];
    $('s-n').value = S.fmt.n;
    syncFormat();
  });
  $('s-n').oninput = () => {
    const v = parseInt($('s-n').value, 10);
    if (Number.isInteger(v) && v > 0) S.fmt.n = v;
    syncFormat();
  };
  document.querySelectorAll('#svary-set .pill').forEach(el => el.onclick = () => {
    if (el.dataset.vary === 'cat') S.fmt.randCat = !S.fmt.randCat;
    else S.fmt.randEra = !S.fmt.randEra;
    syncFormat();
  });
  syncFormat();

  $('ser-next').onclick = () => seriesNextGame();
  $('ser-done').onclick = () => { S.SR = null; renderRecords(); show('records'); };

  /* A World Series rolls its first era and category the same way it rolls the
     rest, so it starts through the series path rather than with whatever the
     setup screen happened to have selected. */
  $('start').onclick  = () => {
    S.SR = null;
    if (S.fmt.on && S.fmt.ws){ startSeries(); return seriesNextGame(); }
    startGame();
  };
  $('submit').onclick = submitGuess;
  $('guess').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); submitGuess(); } });
  $('quit').onclick = () => { if (S.G) finish(); };

  document.querySelectorAll('#rec-sort .pill').forEach(el => el.onclick = () => {
    S.recSort = el.dataset.sort;
    document.querySelectorAll('#rec-sort .pill').forEach(x => x.setAttribute('aria-pressed','false'));
    el.setAttribute('aria-pressed','true');
    renderRecords();
  });
  $('rec-export').onclick = () => {
    /* Blob encodes UTF-8 either way; the charset is declared for the tools that
       read the file afterwards and would otherwise sniff it as Latin-1, which
       is what turns "Acuña" into "AcuÃ±a". */
    const blob = new Blob([JSON.stringify(RECORDS)], {type: 'application/json;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `game-100-records-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  $('rec-import').onclick = () => $('rec-file').click();
  $('rec-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try{
      const incoming = JSON.parse(await f.text());
      if (!Array.isArray(incoming)) throw 0;
      const seen = new Set(RECORDS.map(g => g.ts));
      const added = incoming.filter(g => g && g.ts && !seen.has(g.ts));
      RECORDS = RECORDS.concat(added).sort((a,b) => a.ts - b.ts);
      saveRecords(); renderRecords();
      $('rec-msg').textContent = `Merged ${added.length} game${added.length===1?'':'s'}.`;
    }catch(err){ $('rec-msg').textContent = "That file didn't look like an export."; }
    e.target.value = '';
  };
  let armed = false;
  $('rec-clear').onclick = e => {
    if (!armed){ armed = true; e.target.textContent = 'Tap again to erase'; return; }
    RECORDS = []; saveRecords(); armed = false;
    e.target.textContent = 'Clear all'; renderRecords();
  };
}

/* The shell owns which game is on screen. Guarded so the test suite, which
   loads this file on its own, does not need to stub a registry. */
if (typeof Shell !== 'undefined'){
  Shell.register({
    id: 'game100', el: 'game-100',
    title: 'Game 100', tagline: 'Leaderboard snake draft',
    isDirty: () => !!(S.G && !S.G.saved),
    async boot(){
      loadRecords(); renderSeats(); wire();
      try{
        await loadManifest();
        renderRanges();
        await loadRange();
      }catch(e){
        $('start-note').textContent = 'Could not load the data folder. Serve this over http, not file://';
      }
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    },
  });
}
