/* Game 100 - standalone. No server, no accounts; data is static JSON. */

const S = {
  manifest: null, data: null,
  rangeId: null, post: false, catId: null, kind: 'span', custom: null,
  seats: ['', ''], rounds: 12, G: null, recSort: 'ppg',
};
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
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[.'\u2019`]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ')
    .replace(/\s+/g, ' ').trim();
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

/* ------------------------------------------------------------------ data */
async function loadManifest(){
  S.manifest = await (await fetch('data/manifest.json')).json();
  const spans = S.manifest.ranges.filter(r => r.kind === 'span');
  S.rangeId = (spans[spans.length - 1] || S.manifest.ranges[0]).id;
}
async function loadRange(){
  $('start-note').textContent = 'Loading\u2026';
  $('start').disabled = true;
  try{
    S.data = S.custom
      ? await buildCustom(S.custom.y0, S.custom.y1, S.post)
      : await (await fetch(`data/${S.rangeId}${S.post ? '-post' : ''}.json`)).json();
  }catch(e){
    S.data = null;
    $('start-note').textContent = 'Could not load that era.';
    return;
  }
  if (!S.data){
    $('start-note').textContent = S.post
      ? 'No postseason play in those years.' : 'Nothing to play in those years.';
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
  for (const r of rows) seen.set(r[0], (seen.get(r[0]) || 0) + 1);
  const who = {};
  rows.forEach((r, i) => {
    if (seen.get(r[0]) > 1){
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
  const whoOf = new Map();
  side.rows.forEach((r, i) => { if (who[i]) whoOf.set(r, who[i]); });

  const scored = side.rows.filter(r => r[ci] > 0)
                          .sort((a, b) => asc ? a[ci] - b[ci] : b[ci] - a[ci]);
  const ranks = [];
  let prev = null, start = 0;
  scored.forEach((r, i) => { if (r[ci] !== prev){ start = i + 1; prev = r[ci]; } ranks.push(start); });

  const depth = Math.min(cat.depth, scored.length);
  const board = scored.slice(0, depth).map((r, i) =>
    ({name: r[0], val: r[ci], rank: ranks[i], zone: 'board', drafted: false, by: null,
      who: whoOf.get(r) || null}));
  const foul = scored.slice(depth, depth + 10).map((r, i) =>
    ({name: r[0], val: r[ci], rank: ranks[depth + i], zone: 'foul', used: false,
      who: whoOf.get(r) || null}));

  // everyone else, purely so a strike can still be told what he did
  const off = [];
  for (let i = depth + 10; i < scored.length; i++)
    off.push({name: scored[i][0], val: scored[i][ci], rank: ranks[i], zone: 'off'});
  for (const r of side.rows)
    if (!(r[ci] > 0)) off.push({name: r[0], val: r[ci], rank: null, zone: 'off'});

  const all = board.concat(foul, off);
  const byName = new Map(), byLast = new Map();
  for (const e of all){
    const n = norm(e.name), l = lastOf(e.name);
    (byName.get(n) || byName.set(n, []).get(n)).push(e);
    (byLast.get(l) || byLast.set(l, []).get(l)).push(e);
  }
  return {board, foul, byName, byLast, depth, abbr: cat.abbr, label: cat.label,
          total: scored.length};
}

/* Board first, then the foul band, then everyone else. Ambiguity only
   matters when a pick could actually score, so board entries win ties. */
function resolve(raw){
  const q = norm(raw);
  if (!q) return {k: 'empty'};
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
    const f = list.filter(e => e.zone === 'foul' && !e.used);
    if (f.length)          return {k: 'foul', e: bestOf(f)};
    const off = list.filter(e => e.zone === 'off');
    if (off.length){
      off.sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9));
      return {k: 'off', e: off[0]};
    }
    return {k: 'usedfoul', e: list[0]};
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

  // fuzzy, but only against players who could actually score
  let best = null, bestD = 99;
  for (const e of P.board){
    if (e.drafted) continue;
    const d = Math.min(lev(q, norm(e.name)), lev(q, lastOf(e.name)));
    if (d < bestD){ bestD = d; best = e; }
  }
  if (best && bestD <= (q.length <= 5 ? 1 : 2)) return {k: 'suggest', e: best};
  return {k: 'none'};
}

/* ------------------------------------------------------------------ game */
function startGame(){
  const pool = buildPool();
  S.G = {
    rangeId: S.rangeId, post: S.post, cat: S.catId,
    label: pool.label, abbr: pool.abbr, pool,
    players: S.seats.map((n, i) => ({name: (n.trim() || `Drafter ${i+1}`),
      pts: 0, strikes: 0, out: false, picks: 0, fouls: 0, ranks: [], picked: []})),
    round: 0, pos: 0, maxRounds: S.rounds, log: [], saved: false,
  };
  show('game');
  $('g-era').textContent = S.data.label + (S.post ? ' \u00b7 Postseason' : '');
  $('g-cat').textContent = pool.label;
  setPlate('On the clock', '\u2014', `Top ${pool.depth} \u00b7 name a player`, '');
  clearMsg(); renderGame(); focusGuess();
}

const order = r => {
  const a = [...Array(S.G.players.length).keys()];
  return r % 2 === 0 ? a : a.reverse();
};
const seat = () => order(S.G.round)[S.G.pos];
const alive = () => S.G.players.filter(p => !p.out).length;
const openLeft = () => S.G.pool.board.filter(e => !e.drafted).length;

function advance(){
  if (!alive() || !openLeft()) return finish();
  let guard = 0;
  do {
    S.G.pos++;
    if (S.G.pos >= S.G.players.length){ S.G.pos = 0; S.G.round++; }
    if (S.G.maxRounds && S.G.round >= S.G.maxRounds) return finish();
    if (++guard > 400) return finish();
  } while (S.G.players[seat()].out);
  renderGame(); focusGuess();
}

function submitGuess(){
  const box = $('guess'), raw = box.value;
  const r = resolve(raw);
  clearConfirm();
  if (r.k === 'empty'){ setMsg('Type a name first.', 'warn'); return; }
  if (r.k === 'taken'){
    setMsg(`${r.e.name} is already off the board. Pick again \u2014 no strike.`, 'warn');
    box.value = ''; focusGuess(); return;
  }
  if (r.k === 'ambiguous'){
    setMsg(`Too many matches: ${r.list.map(e => e.name).join(', ')}. Use a first name \u2014 no strike.`, 'warn');
    box.value = ''; focusGuess(); return;
  }
  if (r.k === 'choose') return askChoose(r.list);
  if (r.k === 'suggest') return askConfirm(r.e, raw);
  if (r.k === 'hit')  return score(r.e);
  if (r.k === 'foul') return foul(r.e);
  return strike(raw, r.k === 'off' || r.k === 'usedfoul' ? r.e : null);
}

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
  $('c-yes').onclick = () => { clearConfirm(); e.drafted ? (setMsg('Already off the board.', 'warn'), focusGuess()) : score(e); };
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

function score(e){
  const p = S.G.players[seat()];
  e.drafted = true; e.by = p.name;
  p.pts += e.rank; p.picks++; p.ranks.push(e.rank);
  p.picked.push({n: e.name, r: e.rank});
  S.G.log.push({rank: e.rank, name: e.name, by: p.name, val: e.val});
  clearMsg();
  setPlate(`${p.name} scores`, String(e.rank), `${e.name} \u00b7 ${fmtVal(e.val)} ${S.G.abbr}`, 'good');
  $('guess').value = ''; renderGame();
  setTimeout(advance, 280);
}

/* Foul ball: free at two strikes, otherwise it costs one. Turn ends either way. */
function foul(f){
  const p = S.G.players[seat()];
  f.used = true; p.fouls++;
  const free = p.strikes >= 2;
  if (!free) p.strikes++;
  clearMsg();
  setPlate('Foul ball', 'FOUL',
    `${f.name} was ${ord(f.rank)} with ${fmtVal(f.val)} ${S.G.abbr}`, 'foul');
  setMsg(free ? 'Two strikes \u2014 the foul is free. Turn passes.'
              : `Just off the board. Strike ${p.strikes}. Turn passes.`, 'warn');
  $('guess').value = ''; renderGame();
  setTimeout(advance, 420);
}

/* A strike still tells you what the player actually did. */
function strike(raw, e){
  const p = S.G.players[seat()];
  p.strikes++;
  let sub;
  if (e && e.rank)      sub = `${e.name} \u2014 ${fmtVal(e.val)} ${S.G.abbr}, ${ord(e.rank)}`;
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
  if (!G.saved){
    G.saved = true;
    const best = Math.max(...G.players.map(p => p.pts));
    RECORDS.push({ts: Date.now(), range: G.rangeId, post: G.post, cat: G.cat, label: G.label,
      depth: G.pool.depth,
      players: G.players.map(p => ({name: p.name.trim(), pts: p.pts, strikes: p.strikes,
        picks: p.picks, fouls: p.fouls, ranks: p.ranks, picked: p.picked,
        win: p.pts === best}))});
    saveRecords();
  }
  const ranked = [...G.players].sort((a, b) => b.pts - a.pts);
  const top = ranked[0].pts, winners = ranked.filter(p => p.pts === top);
  $('over-head').textContent = winners.length > 1 ? 'Tie at the top' : `${winners[0].name} wins`;
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
  show('over');
}

/* ---------------------------------------------------------------- render */
function renderGame(){
  const G = S.G;
  $('g-round').textContent = G.maxRounds ? `${Math.min(G.round+1, G.maxRounds)}/${G.maxRounds}` : String(G.round+1);
  $('g-left').textContent = openLeft();
  const t = seat();
  $('board').innerHTML = G.players.map((p, i) => `
    <div class="seat-panel ${i === t && !p.out ? 'active' : ''} ${p.out ? 'dead' : ''}">
      <div class="turn-tag">${i === t && !p.out ? 'On the clock' : ''}</div>
      <div class="nm">${esc(p.name)}</div>
      <div class="pts">${p.pts}</div>
      <div class="strikes">${[0,1,2].map(s => `<i class="${s < p.strikes ? 'on' : ''}"></i>`).join('')}</div>
    </div>`).join('');
  $('log').innerHTML = [...G.log].sort((a,b) => a.rank - b.rank).map(r => `
    <div class="log-row">
      <div class="rk">${r.rank}</div>
      <div class="pl">${esc(r.name)} <span class="mono">${fmtVal(r.val)} ${G.abbr}</span></div>
      <div class="who">${esc(r.by)}</div>
    </div>`).join('');
  $('log-empty').classList.toggle('hidden', G.log.length > 0);
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
      ${S.seats.length > 2 ? `<button data-drop="${i}" aria-label="Remove drafter ${i+1}">\u2715</button>` : ''}
    </div>`).join('');
  $('seats').querySelectorAll('input').forEach(el =>
    el.oninput = e => S.seats[+e.target.dataset.seat] = e.target.value);
  $('seats').querySelectorAll('button').forEach(el =>
    el.onclick = e => { S.seats.splice(+e.target.dataset.drop, 1); renderSeats(); });
  $('add-seat').disabled = S.seats.length >= 4;
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
    el.onclick = () => { S.rangeId = el.dataset.range; S.custom = null; renderRanges(); loadRange(); });
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
    ? `Top ${c.depth} in ${c.label.toLowerCase()}, ${S.data.label}${S.post ? ' postseason' : ''}.`
    : 'Pick a category.';
}

/* --------------------------------------------------------------- records */
function loadRecords(){
  try { RECORDS = JSON.parse(localStorage.getItem(REC_KEY) || '[]'); }
  catch (e) { RECORDS = []; }
}
function saveRecords(){
  try { localStorage.setItem(REC_KEY, JSON.stringify(RECORDS.slice(-400))); }
  catch (e) { setMsg('Records could not be saved \u2014 storage is full or blocked.', 'warn'); }
}
function careerStats(){
  const m = new Map();
  for (const g of RECORDS) for (const p of (g.players || [])){
    const k = (p.name || '').trim().toLowerCase();
    if (!k) continue;
    let r = m.get(k);
    if (!r){ r = {name: p.name.trim(), games:0, wins:0, pts:0, picks:0, strikes:0, fouls:0, ranks:[], best:0}; m.set(k, r); }
    r.games++; if (p.win) r.wins++;
    r.pts += p.pts||0; r.picks += p.picks||0; r.strikes += p.strikes||0; r.fouls += p.fouls||0;
    r.ranks.push(...(p.ranks || []));
    if ((p.pts||0) > r.best) r.best = p.pts||0;
  }
  return [...m.values()].map(r => ({...r,
    ppg: r.games ? r.pts / r.games : 0,
    hit: (r.picks + r.strikes) ? r.picks / (r.picks + r.strikes) : 0,
    depth: r.ranks.length ? r.ranks.reduce((a,b) => a+b, 0) / r.ranks.length : 0,
    deepest: r.ranks.length ? Math.max(...r.ranks) : 0,
  }));
}
const SORTERS = {
  ppg:  (a,b) => b.ppg - a.ppg,
  hit:  (a,b) => b.hit - a.hit || b.ppg - a.ppg,
  depth:(a,b) => b.depth - a.depth || b.ppg - a.ppg,
  wins: (a,b) => b.wins - a.wins || b.ppg - a.ppg,
};
function renderRecords(){
  const rows = careerStats().sort(SORTERS[S.recSort]);
  $('rec-empty').classList.toggle('hidden', rows.length > 0);
  $('rec-list').innerHTML = rows.map((r, i) => `
    <div class="rec tappable ${i === 0 ? 'lead' : ''}" data-who="${esc(r.name)}" role="button" tabindex="0">
      <div class="rec-head">
        <div class="pos">${i+1}</div>
        <div class="nm">${esc(r.name)}</div>
        <div class="gm">${r.games} game${r.games===1?'':'s'} \u00b7 ${r.wins} won</div>
      </div>
      <div class="rec-stats">
        <div><b>${r.ppg.toFixed(1)}</b><span>pts/game</span></div>
        <div><b>${Math.round(r.hit*100)}%</b><span>hit rate</span></div>
        <div><b>${r.depth ? r.depth.toFixed(0) : '\u2014'}</b><span>avg depth</span></div>
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
  const h = [...RECORDS].reverse().slice(0, 40);
  $('hist-empty').classList.toggle('hidden', h.length > 0);
  $('hist-list').innerHTML = h.map(g => {
    const o = [...(g.players||[])].sort((a,b) => b.pts - a.pts);
    return `<div class="hist">
      <div class="top">
        <div class="cat">${esc(g.label || g.cat)} <span class="mono">${esc(g.range||'')}${g.post?' post':''}</span></div>
        <div class="when">${new Date(g.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
      </div>
      <div class="line">${o.map((p,i) => `${i===0?'\u2605 ':''}${esc(p.name)} ${p.pts}`).join('   \u00b7   ')}</div>
    </div>`;
  }).join('');
}

/* --------------------------------------------------------------- profile */
const DEPTH_BUCKETS = [[1,25,'1\u201325'], [26,50,'26\u201350'], [51,100,'51\u2013100'],
                       [101,200,'101\u2013200'], [201,350,'201\u2013350'], [351,1e9,'351+']];

function profileFor(name){
  const key = name.trim().toLowerCase();
  const mine = RECORDS.filter(g => (g.players||[]).some(p => (p.name||'').trim().toLowerCase() === key));
  const P = {name, games: mine.length, wins: 0, pts: 0, picks: 0, strikes: 0, fouls: 0,
             ranks: [], cats: new Map(), eras: new Map(), h2h: new Map(), sig: new Map()};
  for (const g of mine){
    const me = g.players.find(p => (p.name||'').trim().toLowerCase() === key);
    const ranks = (me.picked && me.picked.length) ? me.picked.map(x => x.r) : (me.ranks || []);
    if (me.win) P.wins++;
    P.pts += me.pts||0; P.picks += me.picks||0; P.strikes += me.strikes||0; P.fouls += me.fouls||0;
    P.ranks.push(...ranks);

    const bump = (map, k, label) => {
      let e = map.get(k);
      if (!e){ e = {label, games:0, ranks:[], picks:0, strikes:0}; map.set(k, e); }
      e.games++; e.ranks.push(...ranks); e.picks += me.picks||0; e.strikes += me.strikes||0;
      return e;
    };
    bump(P.cats, g.cat, (g.label || g.cat) + (g.post ? ' (post)' : ''));
    bump(P.eras, g.range || '?', g.range || 'Unknown');

    for (const o of g.players){
      const ok = (o.name||'').trim().toLowerCase();
      if (ok === key) continue;
      let h = P.h2h.get(ok);
      if (!h){ h = {name: o.name.trim(), games:0, ahead:0, behind:0, tied:0, margin:0}; P.h2h.set(ok, h); }
      h.games++;
      if (me.pts > o.pts) h.ahead++; else if (me.pts < o.pts) h.behind++; else h.tied++;
      h.margin += (me.pts||0) - (o.pts||0);
    }
    for (const pk of (me.picked || []))
      P.sig.set(pk.n, (P.sig.get(pk.n) || 0) + 1);
  }
  const avg = a => a.length ? a.reduce((x,y) => x+y, 0) / a.length : 0;
  P.ppg = P.games ? P.pts / P.games : 0;
  P.hit = (P.picks + P.strikes) ? P.picks / (P.picks + P.strikes) : 0;
  P.depth = avg(P.ranks);
  P.deepest = P.ranks.length ? Math.max(...P.ranks) : 0;
  const shape = m => [...m.values()].map(e => ({...e, depth: avg(e.ranks),
    hit: (e.picks+e.strikes) ? e.picks/(e.picks+e.strikes) : 0}))
    .filter(e => e.ranks.length).sort((a,b) => b.depth - a.depth);
  P.catList = shape(P.cats);
  P.eraList = shape(P.eras);
  P.h2hList = [...P.h2h.values()].sort((a,b) => b.games - a.games);
  P.sigList = [...P.sig.entries()].filter(([,n]) => n > 1).sort((a,b) => b[1] - a[1]).slice(0, 10);
  return P;
}

function renderProfile(name){
  const P = profileFor(name);
  $('prof-name').textContent = P.name;
  $('prof-top').innerHTML = [
    [P.games, 'games'], [P.wins, 'wins'], [P.ppg.toFixed(1), 'pts/game'],
    [Math.round(P.hit*100) + '%', 'hit rate'], [P.depth ? P.depth.toFixed(0) : '\u2014', 'avg depth'],
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
  $('prof-eras').innerHTML = P.eraList.length ? brk(P.eraList) : '<p class="hint">Nothing yet.</p>';

  $('prof-h2h').innerHTML = P.h2hList.length ? P.h2hList.map(h => `
    <div class="brk">
      <div class="t">vs ${esc(h.name)}</div>
      <div class="s">${h.games} together</div>
      <div class="v">${h.ahead}\u2013${h.behind}${h.tied?'\u2013'+h.tied:''}</div>
    </div>`).join('') : '<p class="hint">No shared games yet.</p>';
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
const SCREENS = ['setup','rules','records','profile','game','over'];
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
  $('again').onclick       = () => show('setup');

  $('add-seat').onclick = () => { if (S.seats.length < 4){ S.seats.push(''); renderSeats(); } };
  $('range-search').oninput = renderRanges;
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
  $('start').onclick  = startGame;
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
    const blob = new Blob([JSON.stringify(RECORDS)], {type: 'application/json'});
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
