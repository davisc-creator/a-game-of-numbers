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
  seats: [], mode: 'solo', turn: 0, round: 0,
  spin: null, respinTeam: 0, respinEra: 0, done: false, results: null,
};

const SLOTS = [
  ...['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'].map(p => ({k: p, pos: p, kind: 'bat'})),
  ...[1, 2, 3, 4].map(i => ({k: 'BN' + i, pos: null, kind: 'bat'})),
  ...[1, 2, 3, 4, 5].map(i => ({k: 'SP' + i, pos: 'SP', kind: 'pit'})),
  ...[1, 2].map(i => ({k: 'RP' + i, pos: 'RP', kind: 'pit'})),
  {k: 'CL', pos: 'CL', kind: 'pit'},
];
const RESPINS = 3;
const WINDOW = 10;
const MIN_AB = 200;      // a card has to represent real playing time for the club
const MIN_OUTS = 150;    // 50 innings
const REF_RPG = 4.4;     // runs per game a league-average offence scores

const $$ = id => document.getElementById(id);
const esc1 = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const r1 = n => Math.round(n * 10) / 10;
const r3 = n => Math.round(n * 1000) / 1000;
const pct = n => (n * 1000 < 1000 ? '.' : '') + String(Math.round(n * 1000)).padStart(3, '0');

/* ------------------------------------------------------------------- data */
async function seasonOf(y){
  if (!G.files.has(y))
    G.files.set(y, fetch(`data-teams/${y}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
  return G.files.get(y);
}

/* League rates for a window, so a player's line can be made relative to the
   baseball actually being played around him. */
function leagueOver(years){
  const t = {AB: 0, H: 0, X2B: 0, X3B: 0, HR: 0, BB: 0, HBP: 0, SF: 0,
             ER: 0, IPouts: 0, pHR: 0, pBB: 0, pSO: 0};
  for (const y of years){
    const l = G.ix.league[y];
    if (!l) continue;
    for (const k of Object.keys(t)) t[k] += l[k] || 0;
  }
  const pa = t.AB + t.BB + t.HBP + t.SF;
  const tb = t.H + t.X2B + 2 * t.X3B + 3 * t.HR;
  const ip = t.IPouts / 3;
  return {
    obp: pa ? (t.H + t.BB + t.HBP) / pa : 0.33,
    slg: t.AB ? tb / t.AB : 0.4,
    era: ip ? t.ER * 9 / ip : 4.0,
    fip: ip ? (13 * t.pHR + 3 * t.pBB - 2 * t.pSO) / ip : 3.2,
  };
}

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
    const t = e.tot;
    if (t.AB < MIN_AB) continue;
    const pa = t.AB + t.BB + t.HBP + t.SF;
    const tb = t.H + t.X2B + 2 * t.X3B + 3 * t.HR;
    const obp = pa ? (t.H + t.BB + t.HBP) / pa : 0;
    const slg = t.AB ? tb / t.AB : 0;
    hitters.push({
      id: e.id, name: G.players.n[e.id] || '?', kind: 'bat',
      pos: Object.entries(e.pos).sort((a, b) => b[1] - a[1])[0][0],
      pa, ab: t.AB, h: t.H, hr: t.HR, r: t.R, rbi: t.RBI, sb: t.SB, g: t.G,
      avg: t.AB ? t.H / t.AB : 0, obp, slg,
      obpP: lg.obp ? obp / lg.obp : 1,
      slgP: lg.slg ? slg / lg.slg : 1,
      ops: Math.round(100 * ((lg.obp ? obp / lg.obp : 1) + (lg.slg ? slg / lg.slg : 1) - 1)),
    });
  }
  for (const e of pits.values()){
    const t = e.tot;
    if (t.IPouts < MIN_OUTS) continue;
    const ip = t.IPouts / 3;
    const era = ip ? t.ER * 9 / ip : 99;
    const fip = ip ? (13 * t.HR + 3 * t.BB - 2 * t.SO) / ip : 9;
    const starter = t.G ? t.GS / t.G : 0;
    arms.push({
      id: e.id, name: G.players.n[e.id] || '?', kind: 'pit',
      pos: starter > 0.5 ? 'SP' : (t.SV >= 10 ? 'CL' : 'RP'),
      ip: r1(ip), er: t.ER, so: t.SO, bb: t.BB, w: t.W, l: t.L, sv: t.SV,
      gs: t.GS, g: t.G, era,
      whip: ip ? (t.BB + t.H) / ip : 9,
      eraM: lg.era ? Math.round(100 * era / lg.era) : 100,
      fipM: lg.fip ? Math.round(100 * fip / lg.fip) : 100,
    });
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
  if (!cand.length) cand = all;
  const [franch, y0] = pick(cand);
  $$('sx-status').textContent = 'Loading the club…';
  const R = await roster(franch, y0);
  G.spin = R;
  renderSpin();
}

/* ---------------------------------------------------------------- roster */
const me = () => G.seats[G.turn];

function openSlots(seat, card){
  return SLOTS.filter(s => {
    if (seat.roster[s.k]) return false;
    if (s.kind !== card.kind) return false;
    if (!s.pos) return true;                       // bench takes any hitter
    if (card.kind === 'bat') return s.pos === card.pos;
    return s.pos === card.pos || (s.pos === 'RP' && card.pos === 'CL')
        || (s.pos === 'CL' && card.pos === 'RP');
  });
}

function take(card){
  const seat = me();
  const slots = openSlots(seat, card);
  if (!slots.length){
    $$('sx-status').textContent =
      `No open slot for a ${card.kind === 'bat' ? card.pos : card.pos}. ` +
      (card.kind === 'bat' ? 'His position and your bench are full.' : 'Your staff is full.');
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
    /* snake, exactly as Game 100 orders its rounds */
    const n = G.seats.length;
    G.turn++;
    if (G.turn >= n){ G.turn = 0; G.round++; }
    const fwd = G.round % 2 === 0;
    const idx = fwd ? G.turn : n - 1 - G.turn;
    G.turn = idx;
    let guard = 0;
    while (rosterFull(G.seats[G.turn]) && guard++ < 64){
      G.turn = (G.turn + 1) % n;
    }
  }
  await doSpin();
}

/* ------------------------------------------------------------- simulation */
/* Deliberately a short chain, because the result screen has to explain it.
   Team on-base and slugging are taken relative to the leagues the players
   actually played in, multiplied against a reference offence, and turned into
   a record by Pythagorean expectation. Every number below is shown. */
function simulate(seat){
  const bats = SLOTS.filter(s => s.kind === 'bat').map(s => seat.roster[s.k]).filter(Boolean);
  const arms = SLOTS.filter(s => s.kind === 'pit').map(s => seat.roster[s.k]).filter(Boolean);

  const paTot = bats.reduce((a, b) => a + b.pa, 0) || 1;
  const obpP = bats.reduce((a, b) => a + b.obpP * b.pa, 0) / paTot;
  const slgP = bats.reduce((a, b) => a + b.slgP * b.pa, 0) / paTot;
  const rs = REF_RPG * obpP * slgP;

  /* innings split: five starters carry about two thirds of a season */
  const share = {SP1: .13, SP2: .13, SP3: .13, SP4: .13, SP5: .12,
                 RP1: .13, RP2: .12, CL: .11};
  let raM = 0, wsum = 0;
  for (const s of SLOTS.filter(s => s.kind === 'pit')){
    const p = seat.roster[s.k]; if (!p) continue;
    const w = share[s.k] || 0.1;
    raM += p.eraM * w; wsum += w;
  }
  raM = wsum ? raM / wsum : 100;
  const ra = REF_RPG * raM / 100;

  const ex = 1.83;
  const wpct = Math.pow(rs, ex) / (Math.pow(rs, ex) + Math.pow(ra, ex));

  let w = 0;
  const log = [];
  for (let i = 0; i < 162; i++){ const win = Math.random() < wpct; if (win) w++; log.push(win); }

  let best = 0, run = 0;
  for (const g of log){ run = g ? run + 1 : 0; best = Math.max(best, run); }
  return {obpP, slgP, rs, raM, ra, wpct, w, l: 162 - w, streak: best,
          expW: Math.round(162 * wpct)};
}

function finish1620(){
  G.done = true;
  for (const s of G.seats) s.sim = simulate(s);
  const ranked = [...G.seats].sort((a, b) => b.sim.w - a.sim.w || b.sim.wpct - a.sim.wpct);
  G.results = ranked;
  renderResults();
  showScreen('over');
}

/* ---------------------------------------------------------------- render */
function showScreen(name){
  ['setup', 'draft', 'over'].forEach(s =>
    $$('x-' + s).classList.toggle('hidden', s !== name));
  $$('x-nav-setup').setAttribute('aria-current', String(name === 'setup'));
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

function renderSpin(){
  const R = G.spin, f = G.ix.franchises[R.franch];
  $$('sx-club').textContent = f ? f.name : R.franch;
  $$('sx-era').textContent = `${R.y0}–${R.y1}`;
  $$('sx-status').textContent = '';
  $$('sx-respin-team').textContent = `Respin club (${RESPINS - G.respinTeam})`;
  $$('sx-respin-era').textContent = `Respin era (${RESPINS - G.respinEra})`;
  $$('sx-respin-team').disabled = G.respinTeam >= RESPINS;
  $$('sx-respin-era').disabled = G.respinEra >= RESPINS;

  const seat = me();
  const all = [...R.hitters, ...R.arms];
  const usable = all.filter(c => openSlots(seat, c).length);
  $$('sx-count').textContent =
    `${all.length} qualified · ${usable.length} fit an open slot`;
  $$('sx-cards').innerHTML = all.length
    ? all.map(c => {
        const fits = openSlots(seat, c).length > 0;
        return card(c).replace('<button class="pcard"',
          `<button class="pcard${fits ? '' : ' dim'}"${fits ? '' : ' disabled'}`);
      }).join('')
    : '<p class="hint">Nobody on this club cleared the playing-time floor. Respin.</p>';
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
  G.turn = 0; G.round = 0; G.respinTeam = 0; G.respinEra = 0; G.done = false;
  showScreen('draft');
  await doSpin();
}

function wire1620(){
  $$('x-nav-setup').onclick = () => showScreen('setup');
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
  $$('sx-quit').onclick = () => {
    if (G.seats.some(s => s.picks) && !confirm('Abandon this draft?')) return;
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
      const [ix, players] = await Promise.all([
        fetch('data-teams/index.json').then(r => r.json()),
        fetch('data/players.json').then(r => r.json()),
      ]);
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
