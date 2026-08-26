/* The baseball layer both roster games sit on: the season files, the league
   context, the rate formulas and the season simulation.

   It exists because era normalization is the thing that makes a roster game
   worth playing, and there is now more than one of them. League batting average
   was .296 in 1930 and .237 in 1968; on raw numbers every optimal roster is a
   1930s roster and the draft stops mattering. Every card therefore carries OPS+
   and ERA− measured against that player's own league-seasons, and the
   simulation eats those, never the raw line.

   162-0 and the League both use it. Duplicating any of it would let the two
   games drift apart on the one thing they must agree on. What is NOT here is
   how each game gathers its players: 162-0 wants one franchise inside a rolling
   decade, the League wants everybody in a span, and those are genuinely
   different queries over the same rows. */

const BB = (() => {
  const FIELD = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
  /* Nine in the field and six arms. No bench: every hitter has to fit a real
     position, which is what makes a good shortstop a decision rather than a
     freebie. */
  const SLOTS = [
    ...FIELD.map(p => ({k: p, pos: p, kind: 'bat'})),
    ...[1, 2, 3].map(i => ({k: 'SP' + i, pos: 'SP', kind: 'pit'})),
    ...[1, 2].map(i => ({k: 'RP' + i, pos: 'RP', kind: 'pit'})),
    {k: 'CL', pos: 'CL', kind: 'pit'},
  ];
  const MIN_AB = 200;      // a card has to represent real playing time
  const MIN_OUTS = 150;    // 50 innings
  const REF_RPG = 4.4;     // runs per game a league-average offence scores
  const PYTH = 1.83;

  const files = new Map();
  let ix = null, players = null;

  async function load(){
    if (ix) return {ix, players};
    const [a, b] = await Promise.all([
      fetch('data-teams/index.json').then(r => r.ok ? r.json() : Promise.reject(new Error(r.status))),
      fetch('data/players.json').then(r => r.ok ? r.json() : Promise.reject(new Error(r.status))),
    ]);
    ix = a; players = b;
    return {ix, players};
  }
  const season = y => {
    if (!files.has(y))
      files.set(y, fetch(`data-teams/${y}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
    return files.get(y);
  };
  const nameOf = id => (players && players.n[id]) || '?';

  /* League rates for a set of seasons, so a line can be made relative to the
     baseball actually being played around it. */
  function leagueOver(years){
    const t = {AB: 0, H: 0, X2B: 0, X3B: 0, HR: 0, BB: 0, HBP: 0, SF: 0,
               ER: 0, IPouts: 0, pHR: 0, pBB: 0, pSO: 0};
    for (const y of years){
      const l = ix && ix.league[y];
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

  const r1 = n => Math.round(n * 10) / 10;

  /* One hitter's totals turned into a card. Null when he did not play enough. */
  function bat(id, tot, pos, lg){
    const t = tot;
    if (t.AB < MIN_AB) return null;
    const pa = t.AB + t.BB + t.HBP + t.SF;
    const tb = t.H + t.X2B + 2 * t.X3B + 3 * t.HR;
    const obp = pa ? (t.H + t.BB + t.HBP) / pa : 0;
    const slg = t.AB ? tb / t.AB : 0;
    const obpP = lg.obp ? obp / lg.obp : 1;
    const slgP = lg.slg ? slg / lg.slg : 1;
    return {
      id, name: nameOf(id), kind: 'bat', pos,
      pa, ab: t.AB, h: t.H, hr: t.HR, r: t.R, rbi: t.RBI, sb: t.SB, g: t.G,
      avg: t.AB ? t.H / t.AB : 0, obp, slg, obpP, slgP,
      ops: Math.round(100 * (obpP + slgP - 1)),
    };
  }

  /* And one pitcher's. His role comes from how he was used, not from a guess:
     mostly starting is SP, ten or more saves is CL, otherwise RP. */
  function pit(id, tot, lg){
    const t = tot;
    if (t.IPouts < MIN_OUTS) return null;
    const ip = t.IPouts / 3;
    const era = ip ? t.ER * 9 / ip : 99;
    const fip = ip ? (13 * t.HR + 3 * t.BB - 2 * t.SO) / ip : 9;
    const starter = t.G ? t.GS / t.G : 0;
    return {
      id, name: nameOf(id), kind: 'pit',
      pos: starter > 0.5 ? 'SP' : (t.SV >= 10 ? 'CL' : 'RP'),
      ip: r1(ip), er: t.ER, so: t.SO, bb: t.BB, w: t.W, l: t.L, sv: t.SV,
      gs: t.GS, g: t.G, era,
      whip: ip ? (t.BB + t.H) / ip : 9,
      eraM: lg.era ? Math.round(100 * era / lg.era) : 100,
      fipM: lg.fip ? Math.round(100 * fip / lg.fip) : 100,
    };
  }

  /* Which slots a card could fill on a roster. A closer can take a relief slot
     and the other way round, and the DH takes any hitter - which is what a
     designated hitter is, a bat with no glove.

     That last one is not a convenience. Position comes from where a man
     actually started most often, and nobody's most common position was DH
     before the rule existed in 1973, so restricting the slot to DH-primary
     players made every era before then impossible to field. Every other
     fielding slot still needs a man who really played there. */
  /* Every position a man can be asked to play. Bryce Harper is a right fielder
     who has played a fifth of his games at first, and a game that only lets him
     play right is wrong about him. A position qualifies on POS_SHARE of his
     games there and POS_MIN of them outright, so a fortnight's emergency
     cover does not make somebody a catcher. */
  const POS_SHARE = 0.15, POS_MIN = 30;
  function positions(counts, primary){
    const tot = Object.values(counts || {}).reduce((a, b) => a + b, 0);
    const out = new Set([primary]);
    if (tot) for (const [p, g] of Object.entries(counts))
      if (g >= POS_MIN && g / tot >= POS_SHARE) out.add(p);
    return [...out];
  }
  const canPlay = (card, pos) => (card.poss || [card.pos]).includes(pos);

  function openSlots(roster, card){
    const out = SLOTS.filter(s => {
      if (roster[s.k]) return false;
      if (s.kind !== card.kind) return false;
      if (card.kind === 'bat') return canPlay(card, s.pos) || s.pos === 'DH';
      return s.pos === card.pos || (s.pos === 'RP' && card.pos === 'CL')
          || (s.pos === 'CL' && card.pos === 'RP');
    });
    /* his own position first, then anywhere else he can play, then the DH. A
       right fielder who can cover first should land in right when both are
       open - SLOTS order alone put Harper at first base, which reads as a bug. */
    const rank = s => s.pos === card.pos ? 0 : s.pos === 'DH' ? 2 : 1;
    return out.sort((a, b) => rank(a) - rank(b));
  }

  /* A roster's runs scored and allowed per game, both relative to a league
     average offence. Deliberately a short chain, because every screen that
     shows a result has to be able to explain it. */
  function strength(roster){
    const bats = SLOTS.filter(s => s.kind === 'bat').map(s => roster[s.k]).filter(Boolean);
    const paTot = bats.reduce((a, b) => a + b.pa, 0) || 1;
    const obpP = bats.reduce((a, b) => a + b.obpP * b.pa, 0) / paTot;
    const slgP = bats.reduce((a, b) => a + b.slgP * b.pa, 0) / paTot;
    const rs = REF_RPG * obpP * slgP;
    /* innings split: three starters carry a little over half a short staff */
    const share = {SP1: .19, SP2: .19, SP3: .18, RP1: .16, RP2: .15, CL: .13};
    let raM = 0, wsum = 0;
    for (const s of SLOTS.filter(s => s.kind === 'pit')){
      const p = roster[s.k]; if (!p) continue;
      const w = share[s.k] || 0.1;
      raM += p.eraM * w; wsum += w;
    }
    raM = wsum ? raM / wsum : 100;
    return {obpP, slgP, rs, raM, ra: REF_RPG * raM / 100};
  }

  const pyth = (rs, ra) =>
    Math.pow(rs, PYTH) / (Math.pow(rs, PYTH) + Math.pow(ra, PYTH));

  /* A season against nobody in particular: the roster measured against a
     league-average opponent, which is what 162-0 plays. */
  function season162(roster, games = 162){
    const s = strength(roster);
    const wpct = pyth(s.rs, s.ra);
    let w = 0, best = 0, run = 0;
    for (let i = 0; i < games; i++){
      const win = Math.random() < wpct;
      if (win){ w++; run++; best = Math.max(best, run); } else run = 0;
    }
    return {...s, wpct, w, l: games - w, streak: best, expW: Math.round(games * wpct)};
  }

  /* One game between two rosters. Each offence is scaled by how good the other
     side's pitching is relative to the league, then the same Pythagorean line
     turns the two run rates into a win probability. Symmetric by construction:
     swapping the arguments gives one minus the answer. */
  function headToHead(a, b){
    const A = a.rs * (b.raM / 100), B = b.rs * (a.raM / 100);
    return pyth(A, B);
  }

  /* ------------------------------------------------- names as people type them */
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

  /* Find one man in a list of cards by whatever somebody typed. Zone-free, so
     it works for any board: The League hands it the manager's own pool. Game
     100 keeps its own resolver because that one also has to know about the
     foul band and the strike zone; this is the same matching without the
     scoring. */
  function findByName(raw, cards){
    const q0 = norm(raw);
    if (!q0) return {k: 'empty'};
    const q = ALIASES[q0] || q0;

    const byName = new Map(), byLast = new Map(), byFirst = new Map();
    for (const c of cards){
      const n = norm(c.name), l = lastOf(c.name), f = firstOf(c.name);
      (byName.get(n) || byName.set(n, []).get(n)).push(c);
      (byLast.get(l) || byLast.set(l, []).get(l)).push(c);
      (byFirst.get(f) || byFirst.set(f, []).get(f)).push(c);
    }
    const pick = list => {
      if (!list || !list.length) return null;
      /* two different men with the same name is a question only the player can
         answer, so it is asked rather than guessed */
      if (list.length > 1) return {k: 'choose', list};
      return {k: 'hit', card: list[0]};
    };
    let r = pick(byName.get(q)); if (r) return r;
    r = pick(byLast.get(q));     if (r) return r;

    const tok = q.split(' ');
    if (tok.length === 2){
      const cand = (byLast.get(tok[1]) || []).filter(c => firstOf(c.name).startsWith(tok[0]))
        .concat((byLast.get(tok[0]) || []).filter(c => firstOf(c.name).startsWith(tok[1])));
      r = pick(cand); if (r) return r;
    }
    /* a bare first name, but only when it names one man - "Ichiro" */
    if (tok.length === 1){
      const one = byFirst.get(q) || [];
      if (one.length === 1) return {k: 'hit', card: one[0]};
    }

    /* near misses, drawn from the whole board. Sorted by distance and then
       alphabetically, never by how good the player is. */
    const cap = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3;
    const near = [];
    for (const c of cards){
      const n = norm(c.name);
      if (n === q) continue;
      const d = Math.min(lev(q, n), lev(q, lastOf(c.name)), lev(q, firstOf(c.name)));
      if (d <= cap) near.push({c, d});
    }
    if (near.length){
      near.sort((a, b) => a.d - b.d || (a.c.name < b.c.name ? -1 : 1));
      /* a crowd at distance nought is a shared first name, not a misspelling */
      if (!(near[0].d === 0 && near.filter(x => x.d === 0).length > 5))
        return {k: 'suggest', list: near.slice(0, 5).map(x => x.c)};
    }
    return {k: 'none'};
  }

  /* ------------------------------------------------------------ records */
  /* Both roster games finish the same way: some managers, a roster each and a
     win-loss record. So they share a store and a screen, and a manager's career
     spans both - a season is a season. Game 100's records are a different shape
     and stay where they are, under their own key. */
  const REC_KEY = 'agon:rosters';
  let RECS = null;

  function recs(){
    if (RECS) return RECS;
    try {
      const v = JSON.parse(localStorage.getItem(REC_KEY) || '[]');
      RECS = Array.isArray(v) ? v : [];      // "null" and "{}" both parse
    } catch (e){ RECS = []; }
    return RECS;
  }
  function saveRecs(){
    try { localStorage.setItem(REC_KEY, JSON.stringify(RECS)); } catch (e){ /* full or private */ }
  }
  /* Trim a roster down to what a record needs: who, where he played and how
     good he was. Keeping whole cards would be a few hundred KB a league. */
  const thin = roster => SLOTS.map(sl => {
    const p = roster[sl.k];
    return p ? {k: sl.k, n: p.name, i: p.id, pos: p.pos,
                g: p.kind === 'bat' ? p.ops : p.eraM, b: p.kind === 'bat'} : null;
  }).filter(Boolean);

  function addRec(rec){
    recs().push(rec);
    /* a couple of hundred seasons is plenty of history and keeps this well
       inside what localStorage will hold */
    if (RECS.length > 200) RECS = RECS.slice(-200);
    saveRecs();
    return rec;
  }
  /* Merge by timestamp, exactly as Game 100's import does, so re-importing the
     same file twice is harmless. */
  function importRecs(list){
    if (!Array.isArray(list)) return 0;
    const have = new Set(recs().map(r => r.ts));
    const add = list.filter(r => r && Number.isInteger(r.ts) && !have.has(r.ts));
    RECS = recs().concat(add).sort((a, b) => a.ts - b.ts);
    saveRecs();
    return add.length;
  }

  /* One row per person, across whichever games are asked for. A solo 162-0
     season has nobody to beat, so it counts as a season played and never as a
     title - the same rule Game 100's solo practice follows. */
  function career(game){
    const m = new Map();
    for (const r of recs()){
      if (game && r.game !== game) continue;
      /* a league of computers is not a career, and beating three of them is not
         beating three people - so a season counts as won only against somebody,
         and solo means nobody human to beat */
      const solo = (r.players || []).filter(p => !p.cpu).length < 2;
      for (const p of (r.players || [])){
        if (p.cpu) continue;                 // computers do not keep a career
        const k = (p.name || '').trim().toLowerCase();
        if (!k) continue;
        let e = m.get(k);
        if (!e){ e = {name: p.name.trim(), seasons: 0, titles: 0, solo: 0,
                      w: 0, l: 0, best: null, worst: null, rs: 0, ra: 0}; m.set(k, e); }
        e.seasons++;
        if (solo) e.solo++;
        /* beating nobody but computers is not a title, for the same reason a
           solo season is not one: there was nobody there to beat */
        if (p.win && !solo) e.titles++;
        e.w += p.w || 0; e.l += p.l || 0;
        e.rs += p.rs || 0; e.ra += p.ra || 0;
        if (e.best == null || (p.w || 0) > e.best) e.best = p.w || 0;
        if (e.worst == null || (p.w || 0) < e.worst) e.worst = p.w || 0;
      }
    }
    return [...m.values()].map(e => ({...e,
      pct: (e.w + e.l) ? e.w / (e.w + e.l) : 0,
      rsAvg: e.seasons ? e.rs / e.seasons : 0,
      raAvg: e.seasons ? e.ra / e.seasons : 0,
    })).sort((a, b) => b.titles - a.titles || b.pct - a.pct || b.seasons - a.seasons);
  }

  /* -------------------------------------------------------- records screen */
  /* One renderer, two games. Each game owns the three elements and passes their
     ids in, so neither has to grow a copy of this and the two cannot drift. */
  const esc = x => String(x).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const pct3 = n => (n < 1 ? '.' : '') + String(Math.round(n * 1000)).padStart(3, '0');
  const when = ts => new Date(ts).toLocaleDateString('en-US', {month: 'short', day: 'numeric'});

  function renderRecs(ids, game){
    const list = recs().filter(r => !game || r.game === game).slice().reverse();
    const rows = career(game);
    const el = id => document.getElementById(id);

    el(ids.career).innerHTML = rows.length ? rows.map((r, i) => `
      <div class="rec ${i === 0 ? 'lead' : ''}">
        <div class="rec-head">
          <div class="nm">${esc(r.name)}</div>
          <div class="gm">${r.seasons} season${r.seasons === 1 ? '' : 's'} · ${r.titles} won${r.solo ? ` · ${r.solo} solo` : ''}</div>
        </div>
        <div class="rec-stats">
          <div><b>${r.w}-${r.l}</b><span>overall</span></div>
          <div><b>${pct3(r.pct)}</b><span>win rate</span></div>
          <div><b>${r.best == null ? '—' : r.best}</b><span>best season</span></div>
          <div><b>${r.rsAvg.toFixed(2)}</b><span>runs scored</span></div>
          <div><b>${r.raAvg.toFixed(2)}</b><span>runs allowed</span></div>
        </div>
      </div>`).join('')
      : '<p class="hint">Nothing played yet. Finish a season and it lands here.</p>';

    el(ids.list).innerHTML = list.length ? list.map((r, i) => {
      const table = [...(r.players || [])].sort((a, b) => (b.w || 0) - (a.w || 0));
      return `<div class="hist-row">
        <button class="hist tappable" data-rec="${i}" aria-expanded="false">
          <div class="top">
            <div class="cat">${esc(r.label || '')}</div>
            <div class="when">${when(r.ts)}</div>
          </div>
          <div class="line">${table.map(p =>
            `${p.win ? '★ ' : ''}${esc(p.name)} ${p.w}-${p.l}`).join('   ·   ')}</div>
        </button>
        <div class="hist-body hidden" id="${ids.list}-b${i}">
          ${table.map(p => `
            <div class="hb-who">${esc(p.name)}
              <span class="mono">${p.w}-${p.l} · ${p.rs != null ? p.rs.toFixed(2) + ' RS / ' + p.ra.toFixed(2) + ' RA' : ''}${p.from ? ' · ' + esc(p.from) : ''}</span></div>
            ${(p.roster || []).map(x =>
              `<div class="gm-pick"><span class="r">${x.k}</span>${esc(x.n)}<span class="tag">${x.g} ${x.b ? 'OPS+' : 'ERA−'}</span></div>`).join('')
              || '<div class="gm-pick"><span class="r">—</span>roster not recorded</div>'}
          `).join('')}
        </div>
      </div>`;
    }).join('') : '<p class="hint">No seasons yet.</p>';

    el(ids.list).querySelectorAll('[data-rec]').forEach(b => b.onclick = () => {
      const body = el(`${ids.list}-b${b.dataset.rec}`);
      const open = !body.classList.contains('hidden');
      body.classList.toggle('hidden', open);
      b.setAttribute('aria-expanded', String(!open));
    });
    if (ids.note) el(ids.note).textContent = list.length
      ? 'Tap any season for the rosters. Records are kept on this device only.'
      : '';
  }

  return {FIELD, SLOTS, MIN_AB, MIN_OUTS, REF_RPG, PYTH,
          positions, canPlay, POS_SHARE, POS_MIN,
          norm, lastOf, firstOf, lev, ALIASES, findByName,
          REC_KEY, recs, addRec, importRecs, career, thin, renderRecs,
          clearRecs(){ RECS = []; saveRecs(); },
          /* the suites reload the store to prove it survives one */
          _resetRecs(){ RECS = null; },
          load, season, leagueOver, nameOf, bat, pit, openSlots,
          strength, pyth, season162, headToHead,
          get ix(){ return ix; }, get players(){ return players; },
          /* the suites hand the index in from disk rather than over fetch */
          _set(a, b){ ix = a; players = b; },
          _reset(){ files.clear(); ix = null; players = null; }};
})();
