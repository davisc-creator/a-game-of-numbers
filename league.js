/* The League. Two to eight managers draft from the same era, snake order, the
   same fifteen-man roster 162-0 uses, and then a full round robin decides who
   would actually have won.

   What makes it a different game from 162-0 is the pool. There the club and the
   decade are spun for you and you take what that one team had; here the era is
   chosen and everyone who played in it is on the board, so the draft is about
   reading a whole era rather than one roster. The scarcity is real: one pool,
   and a man taken is gone.

   Era normalization, the roster shape and the arithmetic all come from
   baseball.js, so this game and 162-0 cannot drift apart on the one thing they
   have to agree about. */

const L = {
  seats: [], y0: 1970, y1: 1979, pool: null, lg: null,
  turn: 0, pos: 0, round: 0, done: false, results: null,
  filter: 'all', search: '', sortBy: 'best', loading: false,
};

const MAX_SEATS = 8;
const SPAN_MAX = 20;          // twenty season files is about a megabyte

const $L = id => document.getElementById(id);
const escL = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pctL = n => (n * 1000 < 1000 ? '.' : '') + String(Math.round(n * 1000)).padStart(3, '0');

/* ------------------------------------------------------------------- pool */
/* Everybody who played in the span, each man's whole line across every club he
   played for. 162-0 splits a player by franchise because there the club is the
   point; here it is the era, so a traded man is one card. */
/* named apart from Game 100's buildPool for the same reason as fullL */
async function buildLeaguePool(y0, y1){
  const years = [];
  for (let y = y0; y <= y1; y++) if (y >= BB.ix.first && y <= BB.ix.last) years.push(y);
  const files = (await Promise.all(years.map(BB.season))).filter(Boolean);
  const lg = BB.leagueOver(years);

  const bats = new Map(), pits = new Map();
  for (const f of files){
    if (f.bat) for (let i = 0; i < f.bat.rows.length; i++){
      const id = f.bat.ids[i];
      let e = bats.get(id);
      if (!e){ e = {id, pos: {}, tot: {}}; bats.set(id, e); }
      f.bat.cols.forEach((c, j) => e.tot[c] = (e.tot[c] || 0) + f.bat.rows[i][j]);
      const p = f.bat.pos[i];
      e.pos[p] = (e.pos[p] || 0) + f.bat.rows[i][f.bat.cols.indexOf('G')];
    }
    if (f.pit) for (let i = 0; i < f.pit.rows.length; i++){
      const id = f.pit.ids[i];
      let e = pits.get(id);
      if (!e){ e = {id, tot: {}}; pits.set(id, e); }
      f.pit.cols.forEach((c, j) => e.tot[c] = (e.tot[c] || 0) + f.pit.rows[i][j]);
    }
  }

  const cards = [];
  for (const e of bats.values()){
    const pos = Object.entries(e.pos).sort((a, b) => b[1] - a[1])[0][0];
    const c = BB.bat(e.id, e.tot, pos, lg);
    if (c) cards.push(c);
  }
  for (const e of pits.values()){
    const c = BB.pit(e.id, e.tot, lg);
    if (c) cards.push(c);
  }
  /* best first, each side on its own index, so "best available" means something */
  cards.sort((a, b) => rank(b) - rank(a));
  return {y0, y1: years[years.length - 1], years, lg, cards};
}

/* One number to sort a mixed board by: how far above average he was, in the
   units each side is already measured in. */
const rank = c => c.kind === 'bat' ? c.ops - 100 : 100 - c.eraM;

/* ------------------------------------------------------------------ draft */
const meL = () => L.seats[L.turn];
/* named apart from 162-0's: both games are classic scripts sharing one
   global scope, so a top-level name declared twice is a hard load error */
const fullL = s => BB.SLOTS.every(x => s.roster[x.k]);
const takenIds = () => {
  const t = new Set();
  for (const s of L.seats) for (const p of Object.values(s.roster)) t.add(p.kind + ':' + p.id);
  return t;
};

function available(){
  const gone = takenIds();
  return L.pool.cards.filter(c => !gone.has(c.kind + ':' + c.id));
}

function takeL(card){
  const seat = meL();
  if (takenIds().has(card.kind + ':' + card.id)){
    $L('l-status').textContent = `${card.name} is already on a roster.`;
    return;
  }
  const slots = BB.openSlots(seat.roster, card);
  if (!slots.length){
    $L('l-status').textContent = card.kind === 'bat'
      ? `No open slot at ${card.pos}. There is no bench.`
      : 'Your staff is full.';
    return;
  }
  seat.roster[slots[0].k] = card;
  seat.picks++;
  nextTurnL();
}

function nextTurnL(){
  if (L.seats.every(fullL)) return finishLeague();
  /* Snake. The position in the round and the seat it maps to are kept apart -
     writing the mapped seat back into the counter is what once gave 162-0's
     last drafter twice as many picks as anyone else. */
  const n = L.seats.length;
  let guard = 0;
  do {
    L.pos++;
    if (L.pos >= n){ L.pos = 0; L.round++; }
    L.turn = L.round % 2 === 0 ? L.pos : n - 1 - L.pos;
  } while (fullL(L.seats[L.turn]) && guard++ < 200);
  L.search = '';
  const box = $L('l-search'); if (box) box.value = '';
  renderDraft();
}

/* ---------------------------------------------------------------- the season */
/* A full round robin: every club plays every other club the same number of
   times, as close to 162 games as divides evenly. Each game is one weighted
   coin flip, weighted by the two rosters against each other rather than
   against an average opponent - in a league you play the teams that are there. */
function playLeague(seats, games = 162){
  const n = seats.length;
  const per = Math.max(1, Math.round(games / Math.max(1, n - 1)));
  const st = seats.map(s => ({seat: s, ...BB.strength(s.roster)}));
  const rec = seats.map(s => ({name: s.name, w: 0, l: 0, rs: 0, ra: 0}));
  const grid = seats.map(() => seats.map(() => null));

  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++){
    const p = BB.headToHead(st[i], st[j]);
    let iw = 0;
    for (let g = 0; g < per; g++) if (Math.random() < p) iw++;
    rec[i].w += iw; rec[i].l += per - iw;
    rec[j].w += per - iw; rec[j].l += iw;
    grid[i][j] = {w: iw, l: per - iw, p};
    grid[j][i] = {w: per - iw, l: iw, p: 1 - p};
  }
  for (let i = 0; i < n; i++){
    rec[i].rs = st[i].rs; rec[i].ra = st[i].ra;
    rec[i].obpP = st[i].obpP; rec[i].slgP = st[i].slgP; rec[i].raM = st[i].raM;
    rec[i].pct = rec[i].w + rec[i].l ? rec[i].w / (rec[i].w + rec[i].l) : 0;
    rec[i].i = i;
  }
  const table = [...rec].sort((a, b) => b.w - a.w || b.pct - a.pct || (b.rs - b.ra) - (a.rs - a.ra));
  return {table, grid, per, games: per * (n - 1)};
}

function finishLeague(){
  L.done = true;
  L.results = playLeague(L.seats);
  renderLeagueResults();
  showL('over');
}

/* ---------------------------------------------------------------- render */
function showL(name){
  ['setup', 'draft', 'over'].forEach(s =>
    $L('l-' + s).classList.toggle('hidden', s !== name));
  $L('l-nav-setup').setAttribute('aria-current', String(name === 'setup'));
}

function cardL(c, fits){
  const line = c.kind === 'bat'
    ? `<span class="mono">${pctL(c.avg)}/${pctL(c.obp)}/${pctL(c.slg)}</span> <span>${c.hr} HR · ${c.rbi} RBI · ${c.pa} PA</span>`
    : `<span class="mono">${c.era.toFixed(2)} ERA</span> <span>${c.w}-${c.l} · ${c.so} K · ${c.ip} IP</span>`;
  const grade = c.kind === 'bat' ? `${c.ops} OPS+` : `${c.eraM} ERA−`;
  return `<button class="pcard${fits ? '' : ' dim'}"${fits ? '' : ' disabled'} data-id="${c.id}" data-kind="${c.kind}">
    <div class="pc-top"><span class="pc-pos">${c.pos}</span><span class="pc-nm">${escL(c.name)}</span><span class="pc-gr">${grade}</span></div>
    <div class="pc-line">${line}</div>
  </button>`;
}

function renderSeatsL(){
  $L('l-seat-list').innerHTML = L.seats.map((s, i) => `
    <div class="seat">
      <div class="num">${i + 1}</div>
      <input type="text" data-lseat="${i}" value="${escL(s.name || '')}" placeholder="Manager ${i + 1}" maxlength="16">
      ${L.seats.length > 2 ? `<button data-ldrop="${i}" aria-label="Remove manager ${i + 1}">✕</button>` : ''}
    </div>`).join('');
  $L('l-seat-list').querySelectorAll('input').forEach(el =>
    el.oninput = e => L.seats[+e.target.dataset.lseat].name = e.target.value);
  $L('l-seat-list').querySelectorAll('button').forEach(el =>
    el.onclick = e => { L.seats.splice(+e.target.dataset.ldrop, 1); renderSeatsL(); });
  $L('l-add-seat').disabled = L.seats.length >= MAX_SEATS;
  const need = L.seats.length * BB.SLOTS.length;
  $L('l-seat-note').textContent =
    `${L.seats.length} managers · ${BB.SLOTS.length} players each · ${need} drafted in all.`;
}

function filterOptionsL(cards, seat){
  const out = [{k: 'all', label: 'Everyone'}];
  if (cards.some(c => BB.openSlots(seat.roster, c).length)) out.push({k: 'fits', label: 'Fits a slot'});
  for (const p of [...BB.FIELD, 'SP', 'RP', 'CL'])
    if (cards.some(c => c.pos === p)) out.push({k: p, label: p});
  return out;
}

function applyFilterL(cards, seat){
  let out = cards;
  if (L.filter === 'fits') out = out.filter(c => BB.openSlots(seat.roster, c).length);
  else if (L.filter !== 'all') out = out.filter(c => c.pos === L.filter);
  const q = L.search.trim().toLowerCase();
  if (q) out = out.filter(c => c.name.toLowerCase().includes(q));
  return out;
}

const SHOWN = 60;

function renderDraft(){
  const seat = meL();
  const all = available();
  $L('l-era').textContent = `${L.pool.y0}–${L.pool.y1}`;
  $L('l-whose').textContent = `${seat.name} on the clock`;
  $L('l-filled').textContent = `${seat.picks}/${BB.SLOTS.length}`;
  $L('l-round').textContent = `${L.round + 1}`;

  const opts = filterOptionsL(all, seat);
  if (!opts.some(o => o.k === L.filter)) L.filter = 'all';
  $L('l-filter').innerHTML = opts.map(o =>
    `<button class="pill" data-lf="${o.k}" aria-pressed="${L.filter === o.k}">${o.label}</button>`).join('');
  $L('l-filter').querySelectorAll('[data-lf]').forEach(el => el.onclick = () => {
    L.filter = el.dataset.lf; renderDraft();
  });

  const shown = applyFilterL(all, seat);
  $L('l-count').textContent =
    `${all.length} left in the pool · showing ${Math.min(shown.length, SHOWN)}${shown.length > SHOWN ? ` of ${shown.length}` : ''}`;
  $L('l-cards').innerHTML = shown.length
    ? shown.slice(0, SHOWN).map(c => cardL(c, BB.openSlots(seat.roster, c).length > 0)).join('')
    : `<p class="hint">${L.search ? 'Nobody by that name is left.' : 'Nobody matches that filter.'}</p>`;
  $L('l-cards').querySelectorAll('[data-id]').forEach(el => el.onclick = () => {
    const c = all.find(x => String(x.id) === el.dataset.id && x.kind === el.dataset.kind);
    if (c) takeL(c);
  });

  $L('l-rosters').innerHTML = L.seats.map((s, i) => `
    <div class="lg-team${i === L.turn ? ' on' : ''}">
      <div class="lg-nm">${escL(s.name)} <span class="mono">${s.picks}/${BB.SLOTS.length}</span></div>
      <div class="lg-slots">${BB.SLOTS.map(sl => {
        const p = s.roster[sl.k];
        return `<div class="slot${p ? ' on' : ''}"><span class="k">${sl.k}</span><span class="v">${p ? escL(p.name) : '—'}</span></div>`;
      }).join('')}</div>
    </div>`).join('');
}

function renderLeagueResults(){
  const {table, grid, per, games} = L.results;
  const champ = table[0];
  $L('l-champ').textContent = `${champ.name} wins the league`;
  $L('l-champ-sub').textContent =
    `${champ.w}-${champ.l} over ${games} games · ${L.pool.y0}–${L.pool.y1}`;
  $L('l-table').innerHTML = table.map((r, i) => `
    <div class="result-row ${i === 0 ? 'win' : ''}">
      <div class="pos">${i + 1}</div>
      <div class="nm">${escL(r.name)}</div>
      <div class="sc">${r.w}-${r.l}</div>
    </div>`).join('');
  $L('l-detail').innerHTML = table.map(r => `
    <div class="lg-line">
      <div class="lg-nm">${escL(r.name)}</div>
      <div class="mono">${(r.obpP * 100).toFixed(0)} OBP+ · ${(r.slgP * 100).toFixed(0)} SLG+ · ${r.raM.toFixed(0)} staff ERA−</div>
      <div class="mono">${r.rs.toFixed(2)} runs scored a game, ${r.ra.toFixed(2)} allowed</div>
    </div>`).join('');
  /* the round robin, so a manager can see who actually beat whom */
  $L('l-grid').innerHTML = `<table class="lg-grid"><thead><tr><th></th>${
    table.map(r => `<th>${escL(r.name.slice(0, 4))}</th>`).join('')}</tr></thead><tbody>${
    table.map(r => `<tr><th>${escL(r.name)}</th>${table.map(o => {
      if (o.i === r.i) return '<td class="self">—</td>';
      const g = grid[r.i][o.i];
      return `<td>${g.w}-${g.l}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
  $L('l-how').textContent =
    `Each pair played ${per} games. A club's offence is its hitters' on-base and slugging against the era's league average, weighted by plate appearances; its pitching is the staff ERA− weighted by a realistic innings split. In a game between two clubs each offence is scaled by the other's staff, and ${BB.PYTH} is the Pythagorean exponent that turns the two run rates into a win chance.`;
}

/* ------------------------------------------------------------------ wiring */
async function startLeague(){
  if (L.loading) return;
  const a = parseInt($L('l-from').value, 10), b = parseInt($L('l-to').value, 10);
  let y0 = Math.min(a, b), y1 = Math.max(a, b);
  if (!Number.isInteger(y0) || !Number.isInteger(y1)){
    $L('l-start-note').textContent = 'Enter a start year and an end year.'; return;
  }
  y0 = Math.max(BB.ix.first, y0); y1 = Math.min(BB.ix.last, y1);
  if (y1 - y0 + 1 > SPAN_MAX){
    $L('l-start-note').textContent = `That is more than ${SPAN_MAX} seasons; the pool would take too long to build.`;
    return;
  }
  L.seats = L.seats.map((s, i) => ({
    name: (s.name || '').trim() || `Manager ${i + 1}`, roster: {}, picks: 0,
  }));
  L.loading = true;
  $L('l-start').disabled = true;
  $L('l-start-note').textContent = 'Building the pool…';
  try {
    L.pool = await buildLeaguePool(y0, y1);
  } catch (e){
    L.loading = false; $L('l-start').disabled = false;
    $L('l-start-note').textContent = 'Could not build that era. Check your connection.';
    return;
  }
  L.loading = false; $L('l-start').disabled = false;
  const need = L.seats.length * BB.SLOTS.length;
  /* with no bench every hitter needs his own position, so a thin era can leave
     a roster unfillable - say so before the draft rather than during it */
  const short = shortPositions(L.pool.cards, L.seats.length);
  if (short.length){
    $L('l-start-note').textContent =
      `${L.pool.cards.length} qualified, but not enough at ${short.join(', ')} for ${L.seats.length} managers. Widen the years or drop a manager.`;
    return;
  }
  if (L.pool.cards.length < need){
    $L('l-start-note').textContent =
      `${L.pool.cards.length} players qualified but ${need} are needed. Widen the years or drop a manager.`;
    return;
  }
  L.turn = 0; L.pos = 0; L.round = 0; L.done = false; L.filter = 'all'; L.search = '';
  showL('draft');
  renderDraft();
}

/* Positions with fewer qualified men than the league needs. Pitchers are
   pooled because a closer can relieve and the other way round. */
function shortPositions(cards, seats){
  const short = [];
  /* DH is left out: any hitter can fill it, so it needs no pool of its own -
     only enough hitters in total, which the count below covers */
  for (const p of BB.FIELD){
    if (p === 'DH') continue;
    const n = cards.filter(c => c.kind === 'bat' && c.pos === p).length;
    if (n < seats) short.push(p);
  }
  if (cards.filter(c => c.kind === 'bat').length < seats * 9) short.push('hitters');
  const sp = cards.filter(c => c.pos === 'SP').length;
  if (sp < seats * 3) short.push('SP');
  const pen = cards.filter(c => c.pos === 'RP' || c.pos === 'CL').length;
  if (pen < seats * 3) short.push('relief');
  return short;
}

function wireLeague(){
  $L('l-nav-setup').onclick = () => {
    if (!L.done && L.seats.some(s => s.picks) && !confirm('Abandon this draft?')) return;
    if (L.seats.some(s => s.picks)) L.done = true;
    showL('setup');
  };
  $L('l-add-seat').onclick = () => {
    if (L.seats.length < MAX_SEATS){ L.seats.push({name: ''}); renderSeatsL(); }
  };
  $L('l-start').onclick = startLeague;
  $L('l-again').onclick = () => showL('setup');
  $L('l-quit').onclick = () => {
    if (L.seats.some(s => s.picks) && !confirm('Abandon this draft?')) return;
    L.done = true;
    showL('setup');
  };
  $L('l-search').oninput = e => { L.search = e.target.value; renderDraft(); };
  for (const id of ['l-from', 'l-to'])
    $L(id).addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); startLeague(); } });
}

/* -------------------------------------------------------------------- boot */
Shell.register({
  id: 'league', el: 'game-league', title: 'The League',
  tagline: 'Draft an era, play it out',
  isDirty: () => !L.done && L.seats.some(s => s.picks),
  async boot(){
    L.seats = [{name: ''}, {name: ''}];
    wireLeague();
    renderSeatsL();
    showL('setup');
    try {
      await BB.load();
      $L('l-start-note').textContent =
        `Seasons ${BB.ix.first} to ${BB.ix.last}. Up to ${SPAN_MAX} at a time.`;
      $L('l-start').disabled = false;
    } catch (e){
      $L('l-start-note').textContent = 'Could not load the league data. Serve this over http, not file://';
    }
  },
});
