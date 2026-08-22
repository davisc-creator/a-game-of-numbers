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
  /* two axes, and every combination is a real game:
       era  + shared  one era, one board, everybody drafting against each other
       era  + each    a decade apiece, Ruth's 1930s against Bonds' 2000s
       club + shared  one franchise, everybody fighting over its players
       club + each    the Giants against the Brewers, each manager his own club */
  src: 'era', each: false, allTime: false,
  seats: [], y0: 1970, y1: 1979, pool: null, lg: null,
  turn: 0, pos: 0, round: 0, done: false, results: null,
  filter: 'all', search: '', sortBy: 'best', loading: false,
};

const MAX_SEATS = 8;
const SPAN_MAX = 20;          // twenty season files is about a megabyte
/* Every season file is ~54 KB and there are 106 of them, so all-time is 5.7 MB
   once. Managers who overlap share the fetch and the service worker keeps them
   for good, so the cap is the whole dataset and the note says what it costs. */
const SEASONS_MAX = 106;
const KB_PER_SEASON = 54;

/* Own-era mode leans entirely on era normalization: a 150 OPS+ in 1930 and a
   150 OPS+ in 1999 are the same distance above the baseball being played
   around them, which is the only reason a Ruth club and a Bonds club can be
   put on the same field at all. Raw lines would hand it to whoever picked the
   highest-scoring decade. */
const POOLS = new Map();
const eraKey = (y0, y1, club) => `${club || '*'}:${y0}-${y1}`;
async function poolFor(y0, y1, club){
  const k = eraKey(y0, y1, club);
  if (!POOLS.has(k)) POOLS.set(k, buildLeaguePool(y0, y1, club));
  return POOLS.get(k);
}
/* how many distinct season files a set of eras actually costs, since two
   managers whose decades overlap only pay for the overlap once */
function seasonsNeeded(eras){
  const y = new Set();
  for (const e of eras) for (let i = e.y0; i <= e.y1; i++) y.add(i);
  return y.size;
}

const $L = id => document.getElementById(id);
const escL = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pctL = n => (n * 1000 < 1000 ? '.' : '') + String(Math.round(n * 1000)).padStart(3, '0');

/* ------------------------------------------------------------------- pool */
/* Everybody who played in the span, each man's whole line across every club he
   played for. 162-0 splits a player by franchise because there the club is the
   point; here it is the era, so a traded man is one card. */
/* named apart from Game 100's buildPool for the same reason as fullL */
async function buildLeaguePool(y0, y1, club){
  const years = [];
  for (let y = y0; y <= y1; y++) if (y >= BB.ix.first && y <= BB.ix.last) years.push(y);
  const files = (await Promise.all(years.map(BB.season))).filter(Boolean);
  const lg = BB.leagueOver(years);

  const bats = new Map(), pits = new Map();
  for (const f of files){
    if (f.bat) for (let i = 0; i < f.bat.rows.length; i++){
      if (club && f.bat.fr[i] !== club) continue;
      const id = f.bat.ids[i];
      let e = bats.get(id);
      if (!e){ e = {id, pos: {}, tot: {}}; bats.set(id, e); }
      f.bat.cols.forEach((c, j) => e.tot[c] = (e.tot[c] || 0) + f.bat.rows[i][j]);
      const p = f.bat.pos[i];
      e.pos[p] = (e.pos[p] || 0) + f.bat.rows[i][f.bat.cols.indexOf('G')];
    }
    if (f.pit) for (let i = 0; i < f.pit.rows.length; i++){
      if (club && f.pit.fr[i] !== club) continue;
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
  return {y0, y1: years[years.length - 1], years, lg, cards, club: club || null};
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

/* Whose board is on the table. In own-era mode it is the manager on the
   clock's; the taken set stays global, so two managers whose eras overlap are
   genuinely competing for the men they share and nobody can be on two clubs. */
const boardFor = seat => (seat.pool || L.pool).cards;
const clubName = k => (BB.ix && BB.ix.franchises[k] ? BB.ix.franchises[k].name : k);
/* what a manager is drafting out of, in words */
const seatSource = s => L.src === 'club'
  ? `${clubName(s.club)} · ${s.y0}–${s.y1}`
  : `${s.y0}–${s.y1}`;

function available(){
  const gone = takenIds();
  return boardFor(meL()).filter(c => !gone.has(c.kind + ':' + c.id));
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

/* a spread of decades, so own-era mode opens on something worth playing rather
   than eight managers all sitting in the same ten years */
const DEFAULT_ERAS = [[1927, 1936], [1995, 2004], [1961, 1970], [1975, 1984],
                      [2010, 2019], [1946, 1955], [1985, 1994], [1998, 2007]];
const seatEra = i => DEFAULT_ERAS[i % DEFAULT_ERAS.length];

function renderSeatsL(){
  const each = L.each, club = L.src === 'club';
  const opts = clubOptions();
  $L('l-seat-list').innerHTML = L.seats.map((s, i) => `
    <div class="seat">
      <div class="num">${i + 1}</div>
      <input type="text" data-lseat="${i}" value="${escL(s.name || '')}" placeholder="Manager ${i + 1}" maxlength="16">
      ${L.seats.length > 2 ? `<button data-ldrop="${i}" aria-label="Remove manager ${i + 1}">✕</button>` : ''}
    </div>
    ${club && (each || i === 0) ? `<div class="seat-era">
      <label for="l-club-${i}">${each ? 'Club' : 'Everyone drafts'}</label>
      <select id="l-club-${i}" data-lclub="${i}">${opts.map(o =>
        `<option value="${o.k}"${o.k === s.club ? ' selected' : ''}>${escL(o.label)}</option>`).join('')}</select>
    </div>` : ''}
    ${(each && !L.allTime) ? `<div class="seat-era">
      <label for="l-y0-${i}">Era</label>
      <input type="number" id="l-y0-${i}" data-ly0="${i}" inputmode="numeric" min="1920" max="2025" value="${s.y0}">
      <span class="dash">to</span>
      <label for="l-y1-${i}" class="sr-only">to</label>
      <input type="number" id="l-y1-${i}" data-ly1="${i}" inputmode="numeric" min="1920" max="2025" value="${s.y1}">
    </div>` : ''}`).join('');

  $L('l-seat-list').querySelectorAll('[data-lseat]').forEach(el =>
    el.oninput = e => L.seats[+e.target.dataset.lseat].name = e.target.value);
  $L('l-seat-list').querySelectorAll('[data-ly0]').forEach(el =>
    el.oninput = e => { L.seats[+e.target.dataset.ly0].y0 = parseInt(e.target.value, 10); noteSeats(); });
  $L('l-seat-list').querySelectorAll('[data-ly1]').forEach(el =>
    el.oninput = e => { L.seats[+e.target.dataset.ly1].y1 = parseInt(e.target.value, 10); noteSeats(); });
  $L('l-seat-list').querySelectorAll('[data-lclub]').forEach(el =>
    el.onchange = e => {
      const i = +e.target.dataset.lclub;
      /* one shared club means one choice for the table */
      if (L.each) L.seats[i].club = e.target.value;
      else L.seats.forEach(x => x.club = e.target.value);
      renderSeatsL();
    });
  $L('l-seat-list').querySelectorAll('[data-ldrop]').forEach(el =>
    el.onclick = e => { L.seats.splice(+e.target.dataset.ldrop, 1); renderSeatsL(); });

  $L('l-add-seat').disabled = L.seats.length >= MAX_SEATS;
  $L('l-era-card').classList.toggle('hidden', each || L.allTime);
  $L('l-alltime-row').classList.toggle('hidden', !club);
  press('#l-src .pill', x => x.dataset.lsrc === L.src);
  press('#l-each .pill', x => (x.dataset.leach === 'each') === L.each);
  $L('l-alltime').setAttribute('aria-pressed', String(L.allTime));
  $L('l-each-note').textContent = L.src === 'club'
    ? (L.each ? 'Each manager drafts from his own club.' : 'Everyone drafts from the same club, so you are fighting over its players.')
    : (L.each ? 'Each manager brings his own era.' : 'One era, one board, everyone drafting against each other.');
  noteSeats();
}

const press = (sel, on) => document.querySelectorAll(sel).forEach(x =>
  x.setAttribute('aria-pressed', String(on(x))));

/* Franchises that actually have seasons in the data, longest-lived first so the
   clubs people mean are near the top of the list. */
function clubOptions(){
  if (!BB.ix) return [];
  return Object.entries(BB.ix.franchises)
    .map(([k, v]) => ({k, label: `${v.name} (${v.y0}–${v.y1})`, n: v.n, name: v.name}))
    .sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
}

/* What a manager's board will actually be, once the toggles are applied. In
   club mode "all time" means that franchise's own span, which differs per club:
   the Giants go back to 1920, the Rays to 1998. */
function seatEraOf(s){
  if (L.src === 'club' && L.allTime){
    const f = BB.ix && BB.ix.franchises[s.club];
    return f ? {y0: f.y0, y1: f.y1} : cleanEra(s);
  }
  if (!L.each) return cleanEra({y0: L.y0, y1: L.y1});
  return cleanEra(s);
}

function noteSeats(){
  const need = L.seats.length * BB.SLOTS.length;
  const eras = L.seats.map(seatEraOf);
  const n = seasonsNeeded(eras);
  const mb = (n * KB_PER_SEASON / 1024).toFixed(1);
  const cost = `${n} season${n === 1 ? '' : 's'} to load${n > 30 ? `, about ${mb} MB the first time` : ''}.`;
  if (L.src === 'club'){
    const clubs = new Set(L.seats.map(x => x.club));
    $L('l-seat-note').textContent =
      `${L.seats.length} managers · ${BB.SLOTS.length} players each · ${cost} `
      + (clubs.size === 1
          ? 'One club between them, so every pick is taken off the others.'
          : `${clubs.size} clubs, so nobody is competing for the same men.`);
    return;
  }
  if (!L.each){
    $L('l-seat-note').textContent =
      `${L.seats.length} managers · ${BB.SLOTS.length} players each · ${need} drafted in all.`;
    return;
  }
  const overlap = eras.some((e, i) => eras.some((f, j) =>
    j !== i && e.y0 <= f.y1 && f.y0 <= e.y1));
  $L('l-seat-note').textContent =
    `${L.seats.length} managers · ${BB.SLOTS.length} players each · ${cost} `
    + (overlap ? 'Overlapping eras share players, so those managers are drafting against each other.'
               : 'No two eras overlap, so nobody is competing for the same men.');
}

/* Fill in whatever the current toggles need and the seat has not got: an era
   apiece, or a club apiece. One shared club means the whole table gets the
   first seat's, since there is only one choice to make. */
function defaults(){
  const clubs = clubOptions();
  L.seats.forEach((s, i) => {
    if (!Number.isInteger(s.y0)){ const [a, b] = seatEra(i); s.y0 = a; s.y1 = b; }
    if (L.src === 'club' && !s.club)
      s.club = (clubs[L.each ? i % clubs.length : 0] || {}).k || null;
  });
  if (L.src === 'club' && !L.each && L.seats.length)
    L.seats.forEach(s => s.club = L.seats[0].club);
}

/* a seat's era, clamped to the data and to the span cap */
function cleanEra(s){
  const lo = BB.ix ? BB.ix.first : 1920, hi = BB.ix ? BB.ix.last : 2025;
  let y0 = Number.isInteger(s.y0) ? s.y0 : lo, y1 = Number.isInteger(s.y1) ? s.y1 : hi;
  if (y0 > y1) [y0, y1] = [y1, y0];
  y0 = Math.max(lo, Math.min(hi, y0)); y1 = Math.max(lo, Math.min(hi, y1));
  if (y1 - y0 + 1 > SPAN_MAX) y1 = y0 + SPAN_MAX - 1;
  return {y0, y1};
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
  $L('l-era').textContent = (L.each || L.src === 'club')
    ? `${seat.name} · ${seatSource(seat)}`
    : `${L.pool.y0}–${L.pool.y1}`;
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
    `${all.length} left ${(L.each || L.src === 'club') ? 'on his board' : 'in the pool'} · showing ${Math.min(shown.length, SHOWN)}${shown.length > SHOWN ? ` of ${shown.length}` : ''}`;
  $L('l-cards').innerHTML = shown.length
    ? shown.slice(0, SHOWN).map(c => cardL(c, BB.openSlots(seat.roster, c).length > 0)).join('')
    : `<p class="hint">${L.search ? 'Nobody by that name is left.' : 'Nobody matches that filter.'}</p>`;
  $L('l-cards').querySelectorAll('[data-id]').forEach(el => el.onclick = () => {
    const c = all.find(x => String(x.id) === el.dataset.id && x.kind === el.dataset.kind);
    if (c) takeL(c);
  });

  $L('l-rosters').innerHTML = L.seats.map((s, i) => `
    <div class="lg-team${i === L.turn ? ' on' : ''}">
      <div class="lg-nm">${escL(s.name)} <span class="mono">${(L.each || L.src === 'club') ? seatSource(s) + ' · ' : ''}${s.picks}/${BB.SLOTS.length}</span></div>
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
  const eraOf = n => { const s = L.seats.find(x => x.name === n); return s ? seatSource(s) : ''; };
  $L('l-champ-sub').textContent = (L.each || L.src === 'club')
    ? `${champ.w}-${champ.l} over ${games} games · ${eraOf(champ.name)}`
    : `${champ.w}-${champ.l} over ${games} games · ${L.pool.y0}–${L.pool.y1}`;
  $L('l-table').innerHTML = table.map((r, i) => `
    <div class="result-row ${i === 0 ? 'win' : ''}">
      <div class="pos">${i + 1}</div>
      <div class="nm">${escL(r.name)}</div>
      <div class="sc">${r.w}-${r.l}</div>
    </div>`).join('');
  $L('l-detail').innerHTML = table.map(r => `
    <div class="lg-line">
      <div class="lg-nm">${escL(r.name)}${(L.each || L.src === 'club') ? ` <span class="mono">${eraOf(r.name)}</span>` : ''}</div>
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
    ((L.each || L.src === 'club') ? 'Every club is measured against the baseball played in its own era — a 150 OPS+ in 1930 and a 150 OPS+ in 1999 are the same distance above average — which is what lets clubs from different decades meet. ' : '') +
    `Each pair played ${per} games. A club's offence is its hitters' on-base and slugging against the era's league average, weighted by plate appearances; its pitching is the staff ERA− weighted by a realistic innings split. In a game between two clubs each offence is scaled by the other's staff, and ${BB.PYTH} is the Pythagorean exponent that turns the two run rates into a win chance.`;
}

/* ------------------------------------------------------------------ wiring */
/* One path for all four combinations. Each manager ends up with a board — his
   own or the table's — and the taken set is always global, so wherever two
   managers' boards overlap they are genuinely drafting against each other and
   nobody can end up on two clubs. */
async function startLeague(){
  if (L.loading) return;
  if (!L.each && L.src === 'era'){
    const a = parseInt($L('l-from').value, 10), b = parseInt($L('l-to').value, 10);
    if (!Number.isInteger(a) || !Number.isInteger(b)){
      $L('l-start-note').textContent = 'Enter a start year and an end year.'; return;
    }
    const e = cleanEra({y0: a, y1: b});
    L.y0 = e.y0; L.y1 = e.y1;
  }
  const eras = L.seats.map(seatEraOf);
  const total = seasonsNeeded(eras);
  if (total > SEASONS_MAX){
    $L('l-start-note').textContent = `${total} seasons is more than the ${SEASONS_MAX} in the data.`;
    return;
  }
  L.seats = L.seats.map((s, i) => ({
    name: (s.name || '').trim() || `Manager ${i + 1}`,
    club: L.src === 'club' ? s.club : null,
    y0: eras[i].y0, y1: eras[i].y1, roster: {}, picks: 0, pool: null,
  }));

  L.loading = true; $L('l-start').disabled = true;
  $L('l-start-note').textContent = total > 30
    ? `Building ${total} seasons — this is the slow one, and only the first time…`
    : 'Building the board…';
  try {
    const pools = await Promise.all(L.seats.map(s => poolFor(s.y0, s.y1, s.club)));
    L.seats.forEach((s, i) => { s.pool = pools[i]; });
  } catch (e){
    L.loading = false; $L('l-start').disabled = false;
    $L('l-start-note').textContent = 'Could not build that board. Check your connection.';
    return;
  }
  L.loading = false; $L('l-start').disabled = false;

  /* Every board has to field a full roster for everybody sharing it. With no
     bench each hitter needs his own position, so a thin club or a short era
     would otherwise dead-end the draft half way through. */
  for (const s of L.seats){
    const key = eraKey(s.y0, s.y1, s.club);
    const sharing = L.seats.filter(o => eraKey(o.y0, o.y1, o.club) === key).length;
    const short = shortPositions(s.pool.cards, sharing);
    if (short.length){
      const who = L.src === 'club' ? `${clubName(s.club)} in ${s.y0}–${s.y1}` : `${s.y0}–${s.y1}`;
      $L('l-start-note').textContent = sharing > 1
        ? `${who} cannot field ${sharing} rosters — short at ${short.join(', ')}. Widen it, split the clubs, or drop a manager.`
        : `${who} cannot field a full roster — short at ${short.join(', ')}. Widen it${L.src === 'club' ? ' or pick a longer-lived club' : ''}.`;
      return;
    }
  }

  /* the shared-era case keeps one board on L.pool so the draft screen has
     something to name when nobody owns an era of their own */
  L.pool = (!L.each && L.src === 'era') ? L.seats[0].pool : null;
  if (!L.each && L.src === 'era') L.seats.forEach(s => { s.pool = L.pool; });
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
    if (L.seats.length < MAX_SEATS){
      const [a, b] = seatEra(L.seats.length);
      L.seats.push({name: '', y0: a, y1: b, club: null});
      defaults(); renderSeatsL();
    }
  };
  $L('l-start').onclick = startLeague;
  document.querySelectorAll('#l-src .pill').forEach(el => el.onclick = () => {
    L.src = el.dataset.lsrc;
    if (L.src !== 'club') L.allTime = false;
    defaults(); renderSeatsL();
  });
  document.querySelectorAll('#l-each .pill').forEach(el => el.onclick = () => {
    L.each = el.dataset.leach === 'each';
    defaults(); renderSeatsL();
  });
  $L('l-alltime').onclick = () => { L.allTime = !L.allTime; renderSeatsL(); };
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
    L.seats = [0, 1].map(i => { const [a, b] = seatEra(i); return {name: '', y0: a, y1: b, club: null}; });
    wireLeague();
    renderSeatsL();
    showL('setup');
    try {
      await BB.load();
      defaults(); renderSeatsL();
      $L('l-start-note').textContent =
        `Seasons ${BB.ix.first} to ${BB.ix.last}. Up to ${SPAN_MAX} at a time.`;
      $L('l-start').disabled = false;
    } catch (e){
      $L('l-start-note').textContent = 'Could not load the league data. Serve this over http, not file://';
    }
  },
});
