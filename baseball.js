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
  function openSlots(roster, card){
    return SLOTS.filter(s => {
      if (roster[s.k]) return false;
      if (s.kind !== card.kind) return false;
      if (card.kind === 'bat') return s.pos === card.pos || s.pos === 'DH';
      return s.pos === card.pos || (s.pos === 'RP' && card.pos === 'CL')
          || (s.pos === 'CL' && card.pos === 'RP');
    });
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

  return {FIELD, SLOTS, MIN_AB, MIN_OUTS, REF_RPG, PYTH,
          load, season, leagueOver, nameOf, bat, pit, openSlots,
          strength, pyth, season162, headToHead,
          get ix(){ return ix; }, get players(){ return players; },
          /* the suites hand the index in from disk rather than over fetch */
          _set(a, b){ ix = a; players = b; },
          _reset(){ files.clear(); ix = null; players = null; }};
})();
