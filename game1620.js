/* 162-0. Spin a franchise and a ten-year window, take one player off that
   club, repeat until the roster is full, then play a season with it.

   The one thing that decides whether this game is any good is era
   normalization. League batting average was .296 in 1930 and .237 in 1968; on
   raw numbers every optimal roster is a 1930s roster and the spin stops
   mattering. So every card carries indices measured against that player's own
   league-seasons, and the simulation eats those, never the raw line. Raw
   numbers still show on the card because they are what people recognise. */

const G = {
  ix: null, files: new Map(), players: null,
  seats: [], mode: 'solo', turn: 0, pos: 0, round: 0,
  spin: null, respinTeam: 0, respinEra: 0, done: false, results: null,
  filter: 'all',
};

/* Nine in the field and six arms. No bench: every hitter has to fit a real
   position, which is what makes a good shortstop a decision rather than a
   freebie. It also means a spin can come up with nobody you can use - see the
   free respin in renderSpin(). */
/* the roster shape, the rate formulas and the simulation live in baseball.js,
   which the League game shares - see the note at the top of that file */
const FIELD = BB.FIELD, SLOTS = BB.SLOTS;
const RESPINS = 3;
const WINDOW = 10;
const MIN_AB = BB.MIN_AB, MIN_OUTS = BB.MIN_OUTS, REF_RPG = BB.REF_RPG;

const $$ = id => document.getElementById(id);
const esc1 = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const r1 = n => Math.round(n * 10) / 10;
const r3 = n => Math.round(n * 1000) / 1000;
const pct = n => (n * 1000 < 1000 ? '.' : '') + String(Math.round(n * 1000)).padStart(3, '0');

/* ------------------------------------------------------------------- data */
const seasonOf = y => BB.season(y);
const leagueOver = years => BB.leagueOver(years);

/* Everyone who played for one franchise inside one window, aggregated. */
async function roster(franch, y0){
  const years = [];
  for (let y = y0; y < y0 + WINDOW; y++) if (y >= G.ix.first && y <= G.ix.last) years.push(y);
  const files = (await Promise.all(years.map(seasonOf))).filter(Boolean);
  const lg = leagueOver(years);

  const bats = new Map(), pits = new Map();
  for (const f of files){
    if (f.bat) for (let i = 0; i < f.bat.rows.length; i++){
      if (f.bat.fr[i] !== franch) continue;
      const id = f.bat.ids[i];
      let e = bats.get(id);
      if (!e){ e = {id, pos: {}, tot: {}}; bats.set(id, e); }
      f.bat.cols.forEach((c, j) => e.tot[c] = (e.tot[c] || 0) + f.bat.rows[i][j]);
      const p = f.bat.pos[i];
      e.pos[p] = (e.pos[p] || 0) + f.bat.rows[i][f.bat.cols.indexOf('G')];
    }
    if (f.pit) for (let i = 0; i < f.pit.rows.length; i++){
      if (f.pit.fr[i] !== franch) continue;
      const id = f.pit.ids[i];
      let e = pits.get(id);
      if (!e){ e = {id, tot: {}}; pits.set(id, e); }
      f.pit.cols.forEach((c, j) => e.tot[c] = (e.tot[c] || 0) + f.pit.rows[i][j]);
    }
  }

  const hitters = [], arms = [];
  for (const e of bats.values()){
    const pos = Object.entries(e.pos).sort((a, b) => b[1] - a[1])[0][0];
    const c = BB.bat(e.id, e.tot, pos, lg);
    if (c) hitters.push(c);
  }
  for (const e of pits.values()){
    const c = BB.pit(e.id, e.tot, lg);
    if (c) arms.push(c);
  }
  hitters.sort((a, b) => b.ops - a.ops);
  arms.sort((a, b) => a.eraM - b.eraM);
  return {franch, y0, y1: years[years.length - 1], years, lg, hitters, arms};
}

/* ------------------------------------------------------------------ spins */
function spinnable(){
  const out = [];
  for (const [k, v] of Object.entries(G.ix.franchises)){
    if (v.n < WINDOW) continue;                 // a club needs a decade to draw from
    for (let y = v.y0; y + WINDOW - 1 <= v.y1; y++) out.push([k, y]);
  }
  return out;
}
const pick = a => a[Math.floor(Math.random() * a.length)];

async function doSpin({team = true, era = true} = {}){
  const all = spinnable();
  let cand = all;
  if (!team && G.spin) cand = all.filter(([k]) => k === G.spin.franch);
  if (!era && G.spin) cand = all.filter(([, y]) => y === G.spin.y0);
  /* a respin that can come up identical is a respin that can cost a turn for
     nothing; when the club's only window is the one showing, widen instead */
  if (G.spin) cand = cand.filter(([k, y]) => !(k === G.spin.franch && y === G.spin.y0));
  if (!cand.length) cand = all.filter(([k, y]) => !G.spin || !(k === G.spin.franch && y === G.spin.y0));
  if (!cand.length) cand = all;
  const [franch, y0] = pick(cand);
  $$('sx-status').textContent = 'Loading the club…';
  const R = await roster(franch, y0);
  G.spin = R;
  renderSpin();
}

/* ---------------------------------------------------------------- roster */
const me = () => G.seats[G.turn];

const openSlots = (seat, card) => BB.openSlots(seat.roster, card);

/* Every man already on somebody's roster. The spin rebuilds its card set from
   the season files each time, so without this the same player could be drafted
   twice - by two seats, or into two slots by one. */
function taken(){
  const t = new Set();
  for (const s of G.seats) for (const p of Object.values(s.roster)) t.add(p.kind + ':' + p.id);
  return t;
}
const isTaken = (c, t) => t.has(c.kind + ':' + c.id);

function take(card){
  const seat = me();
  if (isTaken(card, taken())){
    $$('sx-status').textContent = `${card.name} has already been drafted.`;
    return;
  }
  const slots = openSlots(seat, card);
  if (!slots.length){
    $$('sx-status').textContent =
      `No open slot for a ${card.kind === 'bat' ? card.pos : card.pos}. ` +
      (card.kind === 'bat' ? 'His position is filled.' : 'Your staff is full.');
    return;
  }
  seat.roster[slots[0].k] = {...card, from: `${G.spin.franch} ${G.spin.y0}–${G.spin.y1}`};
  seat.picks++;
  nextTurn();
}

function rosterFull(seat){ return SLOTS.every(s => seat.roster[s.k]); }

async function nextTurn(){
  if (G.seats.every(rosterFull)) return finish1620();
  if (G.seats.length > 1){
    /* Snake, exactly as Game 100 orders its rounds. The position in the round
       and the seat it maps to are kept apart on purpose: an earlier version
       wrote the mapped seat back into the counter, so every backward round was
       one pick long and the last seat drew twice as often as anyone else. */
    const n = G.seats.length;
    let guard = 0;
    do {
      G.pos++;
      if (G.pos >= n){ G.pos = 0; G.round++; }
      G.turn = G.round % 2 === 0 ? G.pos : n - 1 - G.pos;
    } while (rosterFull(G.seats[G.turn]) && guard++ < 64);
  }
  await doSpin();
}

/* ------------------------------------------------------------- simulation */
/* Deliberately a short chain, because the result screen has to explain it.
   Team on-base and slugging are taken relative to the leagues the players
   actually played in, multiplied against a reference offence, and turned into
   a record by Pythagorean expectation. Every number below is shown. */
const simulate = seat => BB.season162(seat.roster);

function finish1620(){
  G.done = true;
  for (const s of G.seats) s.sim = simulate(s);
  const ranked = [...G.seats].sort((a, b) => b.sim.w - a.sim.w || b.sim.wpct - a.sim.wpct);
  G.results = ranked;
  if (!G.saved){ G.saved = true; saveSeason(ranked); }
  renderResults();
  showScreen('over');
}

/* One finished season, for the records screen. A solo draft has nobody to
   beat, so nothing is won - the same rule Game 100's solo practice follows -
   and everybody level is a draw that advances nobody. */
function saveSeason(ranked){
  const top = Math.max(...ranked.map(s => s.sim.w));
  const leaders = ranked.filter(s => s.sim.w === top);
  const solo = ranked.length < 2;
  const drawn = leaders.length === ranked.length;
  BB.addRec({
    ts: Date.now(), game: '1620',
    label: `162-0 · ${ranked.length} manager${ranked.length === 1 ? '' : 's'}`,
    players: ranked.map(s => ({
      name: s.name, w: s.sim.w, l: s.sim.l,
      rs: s.sim.rs, ra: s.sim.ra, raM: s.sim.raM,
      win: !solo && !drawn && s.sim.w === top,
      from: Object.values(s.roster)[0] ? Object.values(s.roster)[0].from : '',
      roster: BB.thin(s.roster),
    })),
  });
}

/* ---------------------------------------------------------------- render */
function showScreen(name){
  ['setup', 'draft', 'over', 'recs'].forEach(s =>
    $$('x-' + s).classList.toggle('hidden', s !== name));
  $$('x-nav-setup').setAttribute('aria-current', String(name === 'setup'));
  $$('x-nav-recs').setAttribute('aria-current', String(name === 'recs'));
  if (name === 'recs')
    BB.renderRecs({career: 'x-rec-career', list: 'x-rec-list', note: 'x-rec-note'}, '1620');
}

function card(c){
  const line = c.kind === 'bat'
    ? `<span class="mono">${pct(c.avg)}/${pct(c.obp)}/${pct(c.slg)}</span>
       <span>${c.hr} HR · ${c.rbi} RBI · ${c.sb} SB · ${c.pa} PA</span>`
    : `<span class="mono">${r1(c.era).toFixed(2)} ERA · ${r1(c.whip).toFixed(2)} WHIP</span>
       <span>${c.w}-${c.l}${c.sv ? ` · ${c.sv} SV` : ''} · ${c.so} K · ${c.ip} IP</span>`;
  const idx = c.kind === 'bat'
    ? `<b class="${c.ops >= 100 ? 'up' : ''}">${c.ops}</b><span>OPS+</span>`
    : `<b class="${c.eraM <= 100 ? 'up' : ''}">${c.eraM}</b><span>ERA−</span>`;
  return `<button class="pcard" data-id="${c.id}" data-kind="${c.kind}">
    <div class="ph"><span class="pos">${c.pos}</span><span class="nm">${esc1(c.name)}</span></div>
    <div class="pidx">${idx}</div>
    <div class="pline">${line}</div>
  </button>`;
}

/* Filters for the card grid: the two sides, then whichever positions this club
   actually has, then the one that matters most late on - who can I still use. */
function filterOptions(all, seat){
  const has = new Set(all.map(c => c.pos));
  const opts = [{k: 'all', label: 'All'}, {k: 'fits', label: 'Fits an open slot'},
                {k: 'bat', label: 'Hitters'}, {k: 'pit', label: 'Pitchers'}];
  for (const p of [...FIELD, 'SP', 'RP', 'CL']) if (has.has(p)) opts.push({k: p, label: p});
  return opts;
}
function applyFilter(all, seat){
  const f = G.filter;
  if (f === 'all') return all;
  if (f === 'bat' || f === 'pit') return all.filter(c => c.kind === f);
  if (f === 'fits') return all.filter(c => openSlots(seat, c).length);
  return all.filter(c => c.pos === f);
}

function renderSpin(){
  const R = G.spin, f = G.ix.franchises[R.franch];
  $$('sx-club').textContent = f ? f.name : R.franch;
  $$('sx-era').textContent = `${R.y0}–${R.y1}`;
  $$('sx-status').textContent = '';
  $$('sx-respin-team').textContent = `Respin club (${RESPINS - G.respinTeam})`;
  $$('sx-respin-era').textContent = `Respin era (${RESPINS - G.respinEra})`;
  $$('sx-respin-team').disabled = G.respinTeam >= RESPINS;
  $$('sx-respin-era').disabled = G.respinEra >= RESPINS;

  const seat = me(), gone = taken();
  const all = [...R.hitters, ...R.arms].filter(c => !isTaken(c, gone));
  const usable = all.filter(c => openSlots(seat, c).length);

  const opts = filterOptions(all, seat);
  if (!opts.some(o => o.k === G.filter)) G.filter = 'all';
  $$('sx-filter').innerHTML = opts.map(o =>
    `<button class="pill" data-f="${o.k}" aria-pressed="${G.filter === o.k}">${o.label}</button>`).join('');
  $$('sx-filter').querySelectorAll('[data-f]').forEach(el => el.onclick = () => {
    G.filter = el.dataset.f; renderSpin();
  });

  const shown = applyFilter(all, seat);
  $$('sx-count').textContent = usable.length
    ? `${all.length} qualified · ${usable.length} fit an open slot` +
      (G.filter === 'all' ? '' : ` · showing ${shown.length}`)
    : `${all.length} qualified, but none of them fits a slot you still have open.`;

  /* with no bench a club can genuinely be useless to you, so that respin is
     free - otherwise the draft can dead-end with the roster half filled */
  $$('sx-free').classList.toggle('hidden', usable.length > 0);

  $$('sx-cards').innerHTML = shown.length
    ? shown.map(c => {
        const fits = openSlots(seat, c).length > 0;
        return card(c).replace('<button class="pcard"',
          `<button class="pcard${fits ? '' : ' dim'}"${fits ? '' : ' disabled'}`);
      }).join('')
    : `<p class="hint">${all.length ? 'Nobody matches that filter.'
        : 'Nobody on this club cleared the playing-time floor.'}</p>`;
  $$('sx-cards').querySelectorAll('[data-id]').forEach(el => el.onclick = () => {
    const c = all.find(x => String(x.id) === el.dataset.id && x.kind === el.dataset.kind);
    if (c) take(c);
  });
  renderRoster();
}

function renderRoster(){
  const seat = me();
  $$('sx-whose').textContent = G.seats.length > 1 ? `${seat.name} on the clock` : seat.name;
  $$('sx-filled').textContent = `${seat.picks}/${SLOTS.length}`;
  $$('sx-roster').innerHTML = SLOTS.map(s => {
    const p = seat.roster[s.k];
    return `<div class="slot${p ? ' on' : ''}">
      <span class="k">${s.k}</span>
      <span class="v">${p ? esc1(p.name) : '—'}</span>
      <span class="i">${p ? (p.kind === 'bat' ? p.ops + ' OPS+' : p.eraM + ' ERA−') : ''}</span>
    </div>`;
  }).join('');
  if (G.seats.length > 1)
    $$('sx-seats').innerHTML = G.seats.map((s, i) => `
      <div class="seat-panel${i === G.turn ? ' active' : ''}">
        <div class="nm">${esc1(s.name)}</div>
        <div class="pts">${s.picks}</div>
      </div>`).join('');
}

function renderResults(){
  const rows = G.results.map((s, i) => {
    const m = s.sim;
    return `<div class="result-row${i === 0 ? ' win' : ''}">
      <div class="pos">${i + 1}</div>
      <div class="nm">${esc1(s.name)}</div>
      <div class="sc">${m.w}-${m.l}</div>
    </div>`;
  }).join('');
  $$('x-results').innerHTML = rows;
  const top = G.results[0], m = top.sim;
  $$('x-head').textContent = G.seats.length > 1
    ? `${top.name} wins the season` : `${m.w}-${m.l}`;

  /* the whole scoring model, shown rather than asserted */
  $$('x-explain').innerHTML = `
    <div class="chain">
      <div class="step"><b>${r3(m.obpP).toFixed(2)}×</b><span>your hitters' on-base, against their own leagues</span></div>
      <div class="step"><b>${r3(m.slgP).toFixed(2)}×</b><span>and their slugging</span></div>
      <div class="step"><b>${r1(m.rs).toFixed(2)}</b><span>runs scored per game &nbsp;=&nbsp; ${REF_RPG} × ${r3(m.obpP).toFixed(2)} × ${r3(m.slgP).toFixed(2)}</span></div>
      <div class="step"><b>${Math.round(m.raM)}</b><span>staff ERA−, weighted by innings (100 is average, lower is better)</span></div>
      <div class="step"><b>${r1(m.ra).toFixed(2)}</b><span>runs allowed per game &nbsp;=&nbsp; ${REF_RPG} × ${Math.round(m.raM)} ÷ 100</span></div>
      <div class="step"><b>${pct(m.wpct)}</b><span>expected win rate &nbsp;=&nbsp; RS<sup>1.83</sup> ÷ (RS<sup>1.83</sup> + RA<sup>1.83</sup>)</span></div>
      <div class="step"><b>${m.expW}-${162 - m.expW}</b><span>the record that predicts</span></div>
      <div class="step last"><b>${m.w}-${m.l}</b><span>what 162 simulated games actually gave — longest win streak ${m.streak}</span></div>
    </div>
    <p class="hint">Every player is measured against the baseball played around him,
    so a 1968 arm and a 1999 arm arrive here comparable. Park factors, platoon
    splits and defence are deliberately left out: each would add accuracy and
    cost more explanation than it returns.</p>`;
}

/* ------------------------------------------------------------------ setup */
function renderSeats1620(){
  $$('x-seat-list').innerHTML = G.seats.map((s, i) => `
    <div class="seat">
      <div class="num">${i + 1}</div>
      <input type="text" data-seat="${i}" value="${esc1(s.name)}" placeholder="Drafter ${i + 1}" maxlength="18">
      ${G.seats.length > 1 ? `<button data-drop="${i}" aria-label="Remove">×</button>` : ''}
    </div>`).join('');
  $$('x-seat-list').querySelectorAll('[data-seat]').forEach(el =>
    el.oninput = () => G.seats[+el.dataset.seat].name = el.value);
  $$('x-seat-list').querySelectorAll('[data-drop]').forEach(el =>
    el.onclick = () => { G.seats.splice(+el.dataset.drop, 1); renderSeats1620(); });
  $$('x-add-seat').disabled = G.seats.length >= 4;
}

async function start1620(){
  G.seats = G.seats.map((s, i) => ({
    name: (s.name || '').trim() || `Drafter ${i + 1}`,
    roster: {}, picks: 0, sim: null,
  }));
  G.turn = 0; G.pos = 0; G.round = 0; G.respinTeam = 0; G.respinEra = 0;
  G.done = false; G.saved = false;
  showScreen('draft');
  await doSpin();
}

function wire1620(){
  $$('x-nav-setup').onclick = () => {
    if (!G.done && G.seats.some(s => s.picks) && !confirm('Abandon this draft?')) return;
    if (G.seats.some(s => s.picks)) G.done = true;
    showScreen('setup');
  };
  $$('x-add-seat').onclick = () => { if (G.seats.length < 4){ G.seats.push({name: ''}); renderSeats1620(); } };
  $$('x-start').onclick = start1620;
  $$('x-again').onclick = () => showScreen('setup');
  $$('sx-respin-team').onclick = async () => {
    if (G.respinTeam >= RESPINS) return;
    G.respinTeam++; await doSpin({team: true, era: false});
  };
  $$('sx-respin-era').onclick = async () => {
    if (G.respinEra >= RESPINS) return;
    G.respinEra++; await doSpin({team: false, era: true});
  };
  $$('x-nav-recs').onclick = () => {
    if (!G.done && G.seats.some(s => s.picks) && !confirm('Abandon this draft?')) return;
    if (G.seats.some(s => s.picks)) G.done = true;
    showScreen('recs');
  };
  $$('sx-free').onclick = () => doSpin();
  $$('sx-quit').onclick = () => {
    if (G.seats.some(s => s.picks) && !confirm('Abandon this draft?')) return;
    /* abandoned is abandoned: the shell must not ask a second time on the way out */
    G.done = true;
    showScreen('setup');
  };
}

/* ------------------------------------------------------------------- boot */
Shell.register({
  id: '1620', el: 'game-1620', title: '162-0', tagline: 'Spin, draft, play the season',
  isDirty: () => !G.done && G.seats.some(s => s.picks),
  async boot(){
    G.seats = [{name: ''}];
    wire1620();
    renderSeats1620();
    showScreen('setup');
    try{
      const {ix, players} = await BB.load();
      G.ix = ix; G.players = players;
      const n = spinnable().length;
      $$('x-start-note').textContent =
        `${Object.keys(ix.franchises).length} franchises, ${n} club-and-era combinations to spin.`;
      $$('x-start').disabled = false;
    }catch(e){
      $$('x-start-note').textContent = 'Could not load the 162-0 data. Serve this over http, not file://';
    }
  },
});
