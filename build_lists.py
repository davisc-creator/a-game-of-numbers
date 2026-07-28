#!/usr/bin/env python3
"""
Game 100 - leaderboard builder v2.

Writes one JSON per range holding a full player table per side (batting,
pitching, awards). The client sorts a column to build a leaderboard, cuts
at the stored depth, takes the next 10 as the foul band, and can still
look up any player past that - which is what makes "you struck out, but
here is where he actually ranked" possible.

Regular season -> <range>.json
Postseason     -> <range>-post.json

Source: github.com/cdalzell/Lahman  (1871-2025)
Needs:  pip install pandas pyreadr
"""
import json, os, re
import pandas as pd

FIRST_YEAR, LAST_YEAR = 1920, 2025
MAX_DEPTH, MAX_TIE_TAIL, FOUL_BAND = 500, 30, 10
ERA_QUAL_RATE = 0.6
AWARD_MIN_SEASONS = 10          # "most MVPs in 2024" is not a leaderboard

LAHMAN_DIR = os.environ.get('LAHMAN_DIR', 'lah/data')
OUT_DIR    = os.environ.get('OUT_DIR', 'data')

# id, column, label, abbr, first reliable year
BAT = [('bat_h','H','Hits','H',1920), ('bat_r','R','Runs','R',1920),
       ('bat_rbi','RBI','RBI','RBI',1920), ('bat_hr','HR','Home Runs','HR',1920),
       ('bat_2b','X2B','Doubles','2B',1920), ('bat_3b','X3B','Triples','3B',1920),
       ('bat_bb','BB','Walks','BB',1920), ('bat_so','SO','Strikeouts','SO',1920),
       ('bat_sb','SB','Stolen Bases','SB',1920), ('bat_hbp','HBP','Hit By Pitch','HBP',1920),
       ('bat_sh','SH','Sac Bunts','SH',1920), ('bat_g','G','Games Played','G',1920),
       ('bat_tb','TB','Total Bases','TB',1920), ('bat_xbh','XBH','Extra-Base Hits','XBH',1920),
       ('bat_1b','B1','Singles','1B',1920), ('bat_gidp','GIDP','GIDP','GIDP',1940),
       ('bat_cs','CS','Caught Stealing','CS',1951), ('bat_ibb','IBB','Intentional BB','IBB',1955)]

PIT = [('pit_ip','IP','Innings','IP',1920), ('pit_so','SO','Strikeouts','SO',1920),
       ('pit_w','W','Wins','W',1920), ('pit_l','L','Losses','L',1920),
       ('pit_sv','SV','Saves','SV',1920), ('pit_g','G','Appearances','G',1920),
       ('pit_gs','GS','Games Started','GS',1920), ('pit_cg','CG','Complete Games','CG',1920),
       ('pit_sho','SHO','Shutouts','SHO',1920), ('pit_hra','HR','Home Runs Given','HR',1920),
       ('pit_bba','BB','Walks Given','BB',1920), ('pit_wp','WP','Wild Pitches','WP',1920)]

# No start-year gate: an award tally only counts what happened inside the
# range, so a 1920-2025 All-Star count is complete rather than partial.
AWD = [('awd_as','AS','All-Star Selections','AS',0),
       ('awd_mvp','MVP','MVP Awards','MVP',0),
       ('awd_cy','CY','Cy Young Awards','CY',0),
       ('awd_gg','GG','Gold Gloves','GG',0),
       ('awd_ss','SS','Silver Sluggers','SS',0)]

AWARD_SRC = {'MVP':'Most Valuable Player', 'CY':'Cy Young Award',
             'GG':'Gold Glove', 'SS':'Silver Slugger'}

BAT_NUM = ['G','AB','R','H','X2B','X3B','HR','RBI','BB','SO','SB','CS','IBB','HBP','SH','SF','GIDP']
PIT_NUM = ['W','L','G','GS','IPouts','ER','SO','BB','SV','CG','SHO','HR','WP']


def load():
    import pyreadr
    def tbl(n):
        return list(pyreadr.read_r(os.path.join(LAHMAN_DIR, n + '.RData')).values())[0]
    bat, pit, ppl, tms = tbl('Batting'), tbl('Pitching'), tbl('People'), tbl('Teams')
    bpost, ppost       = tbl('BattingPost'), tbl('PitchingPost')
    allstar, awards    = tbl('AllstarFull'), tbl('AwardsPlayers')

    names = (ppl.nameFirst.fillna('') + ' ' + ppl.nameLast.fillna('')).str.strip()
    name_of = dict(zip(ppl.playerID, names))

    # Career span, used only to tell namesakes apart in the client.
    def yr(v):
        s = str(v)
        return int(s[:4]) if len(s) >= 4 and s[:4].isdigit() else None
    span_of = {}
    for pid, dbt, fin in zip(ppl.playerID, ppl.debut, ppl.finalGame):
        a, b = yr(dbt), yr(fin)
        if a:
            span_of[pid] = str(a) if not b or b == a else f'{a}-{b}'
    for df, cols in ((bat, BAT_NUM), (pit, PIT_NUM), (bpost, BAT_NUM), (ppost, PIT_NUM)):
        for c in cols:
            if c in df.columns:
                df[c] = pd.to_numeric(df[c], errors='coerce')
        df['yearID'] = df.yearID.astype(int)
    allstar['yearID'] = allstar.yearID.astype(int)
    awards['yearID']  = awards.yearID.astype(int)
    # Stable integer id per player, so the client can aggregate any span of
    # seasons without joining on name - which would re-merge the namesakes.
    # Award tables too: a handful of Negro League All-Stars have a selection
    # but no batting or pitching line, and dropping them would shorten the
    # awards board the client builds for a custom range.
    seen = set()
    for df in (bat, pit, allstar, awards):
        d = df[(df.yearID >= FIRST_YEAR) & (df.yearID <= LAST_YEAR)]
        seen.update(d.playerID.unique())
    order = sorted(seen)
    idx_of = {p: i for i, p in enumerate(order)}

    return dict(bat=bat, pit=pit, bpost=bpost, ppost=ppost, allstar=allstar,
                awards=awards, name_of=name_of, span_of=span_of,
                idx_of=idx_of, idx_order=order,
                gpy=tms.groupby('yearID').G.median())


def teams_in(frames, y0, y1):
    """playerID -> the team he appeared for most in this range."""
    best = {}
    for df in frames:
        if 'teamID' not in df.columns:
            continue
        d = df[(df.yearID >= y0) & (df.yearID <= y1)]
        if not len(d):
            continue
        g = d.groupby(['playerID', 'teamID'], as_index=False).G.sum()
        for pid, tid, games in zip(g.playerID, g.teamID, g.G):
            if games > best.get(pid, (None, -1))[1]:
                best[pid] = (str(tid), games)
    return {p: t for p, (t, _) in best.items()}


def depth_of(values):
    """Competition-rank sorted values, return how deep the playable list should go."""
    if not values:
        return 0
    ranks, prev, start = [], None, 0
    for i, v in enumerate(values):
        if v != prev:
            start, prev = i + 1, v
        ranks.append(start)
    keep = len(values)
    for i, r in enumerate(ranks):
        if r > MAX_DEPTH:
            keep = i
            break
    if not keep:
        return 0
    last = ranks[keep - 1]
    tail = sum(1 for r in ranks[:keep] if r == last)
    if tail > MAX_TIE_TAIL and last > 1:
        keep -= tail
    return max(keep, 0)


def norm_name(s):
    """Mirror of norm() in app.js. The client decides two men share a name by
    this, so `who` has to be keyed by it - "Jose Lopez" and "Jose Lopez" with an
    accent are different display names that collide once accents come off."""
    import unicodedata
    t = unicodedata.normalize('NFD', s or '')
    t = ''.join(c for c in t if not unicodedata.combining(c)).lower()
    t = re.sub(r"[.'\u2019`]", '', t)
    t = re.sub(r'[^a-z\s-]', ' ', t)
    t = re.sub(r'-', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r' (jr|sr|ii|iii|iv)$', '', t)      # a suffix is only a suffix at the end
    out, run = [], ''
    for w in t.split(' '):
        if len(w) == 1:
            run += w
        else:
            if run:
                out.append(run); run = ''
            out.append(w)
    if run:
        out.append(run)
    return ' '.join(out)


def num(v):
    v = float(v)
    return int(v) if v == int(v) else round(v, 2)


def make_side(agg, cat_defs, name_of, y0, extra_cols=(), ident=None, idx_of=None):
    cols, cats = [], {}
    for cid, col, label, abbr, since in cat_defs:
        if y0 < since or col not in agg.columns:
            continue
        if col not in cols:
            cols.append(col)
        cats[cid] = {'col': col, 'label': label, 'abbr': abbr}
    if not cats:
        return None, {}
    for c in extra_cols:
        if c in agg.columns and c not in cols:
            cols.append(c)

    tab = agg[['playerID'] + cols].copy()
    filled = tab[cols].fillna(0)
    tab = tab[(filled != 0).any(axis=1)]
    pids = list(tab.playerID)
    rows = [[name_of.get(p, p)] + [num(v) for v in vv]
            for p, vv in zip(tab.playerID, tab[cols].fillna(0).values)]

    # Only namesakes need telling apart, so `who` stays small: row index ->
    # [team, career span]. The client shows it when a typed name is contested.
    who = {}
    if ident:
        seen = {}
        for r in rows:
            k = norm_name(r[0])
            seen[k] = seen.get(k, 0) + 1
        for i, (pid, r) in enumerate(zip(pids, rows)):
            if seen[norm_name(r[0])] > 1:
                team, span = ident.get(pid, (None, None))
                if team or span:
                    who[str(i)] = [team or '', span or '']

    for cid, meta in cats.items():
        i = cols.index(meta['col']) + 1
        asc = (meta['col'] == 'ERAm')
        series = [r[i] for r in rows if r[i] > 0]
        series.sort(reverse=not asc)
        meta['depth'] = depth_of(series)
        meta['dir'] = 'asc' if asc else 'desc'
    cats = {k: v for k, v in cats.items() if v.get('depth', 0) > 0}
    side = {'cols': cols, 'rows': rows}
    if who:
        side['who'] = who
    if idx_of is not None:
        side['ids'] = [idx_of.get(p, -1) for p in pids]
    return side, cats


def build(D, y0, y1, post=False):
    bat_src = D['bpost'] if post else D['bat']
    pit_src = D['ppost'] if post else D['pit']
    n_seasons = y1 - y0 + 1
    sides, cats = {}, {}

    team_of = teams_in((bat_src, pit_src), y0, y1)
    span_of = D['span_of']
    ident = {p: (team_of.get(p), span_of.get(p))
             for p in set(team_of) | set(span_of)}

    b = bat_src[(bat_src.yearID >= y0) & (bat_src.yearID <= y1)]
    if len(b):
        agg = b.groupby('playerID', as_index=False).sum(numeric_only=True)
        agg['TB']  = agg.H + agg.X2B + 2 * agg.X3B + 3 * agg.HR
        agg['XBH'] = agg.X2B + agg.X3B + agg.HR
        agg['B1']  = agg.H - agg.X2B - agg.X3B - agg.HR
        side, c = make_side(agg, BAT, D['name_of'], y0, ident=ident, idx_of=D['idx_of'])
        if side:
            sides['bat'] = side
            cats.update({k: dict(v, side='bat') for k, v in c.items()})

    p = pit_src[(pit_src.yearID >= y0) & (pit_src.yearID <= y1)]
    if len(p):
        agg = p.groupby('playerID', as_index=False).sum(numeric_only=True)
        agg['IP'] = (agg.IPouts / 3.0).round(1)
        defs = list(PIT)
        if not post:
            lg_ip = agg.IPouts.sum() / 3.0
            lg_era = (agg.ER.sum() * 9.0 / lg_ip) if lg_ip else None
            sched = float(D['gpy'].loc[(D['gpy'].index >= y0) & (D['gpy'].index <= y1)].sum())
            min_ip = min(1500, max(40, round(ERA_QUAL_RATE * sched)))
            if lg_era:
                ip = agg.IP.replace(0, float('nan'))
                agg['ERAm'] = ((agg.ER * 9.0 / ip) / lg_era * 100).round(1)
                agg.loc[agg.IP < min_ip, 'ERAm'] = 0
                agg['ERAm'] = agg.ERAm.fillna(0)
                defs = defs + [('pit_era', 'ERAm', f'ERA- (min {min_ip:g} IP)', 'ERA-', 1920)]
        side, c = make_side(agg, defs, D['name_of'], y0, extra_cols=('IP', 'ER', 'IPouts'),
                            ident=ident, idx_of=D['idx_of'])
        if side:
            sides['pit'] = side
            cats.update({k: dict(v, side='pit') for k, v in c.items()})

    if not post and n_seasons >= AWARD_MIN_SEASONS:
        a = D['allstar']
        a = a[(a.yearID >= y0) & (a.yearID <= y1)].drop_duplicates(['playerID', 'yearID'])
        tally = a.groupby('playerID').size().rename('AS').to_frame()
        aw = D['awards']
        aw = aw[(aw.yearID >= y0) & (aw.yearID <= y1)]
        for key, label in AWARD_SRC.items():
            tally = tally.join(aw[aw.awardID == label].groupby('playerID').size().rename(key),
                               how='outer')
        if len(tally):
            tally = tally.fillna(0).reset_index()
            side, c = make_side(tally, AWD, D['name_of'], y0, ident=ident, idx_of=D['idx_of'])
            if side:
                sides['awd'] = side
                cats.update({k: dict(v, side='awd') for k, v in c.items()})

    return sides, cats


def write_globals(D):
    """Everything the client needs to aggregate an arbitrary span of seasons
    itself. Precomputing every range is not an option - 1920-2025 alone has
    5,671 of them."""
    # The category tables themselves, so the client aggregator does not carry a
    # second hand-maintained copy of them that can drift from this one.
    with open(os.path.join(OUT_DIR, 'cats.json'), 'w', encoding='utf-8') as f:
        json.dump({'bat': BAT, 'pit': PIT, 'awd': AWD,
                   'era_rate': ERA_QUAL_RATE, 'award_min_seasons': AWARD_MIN_SEASONS,
                   'max_depth': MAX_DEPTH, 'max_tie_tail': MAX_TIE_TAIL,
                   'first': FIRST_YEAR, 'last': LAST_YEAR},
                  f, separators=(',', ':'))

    order = D['idx_order']
    with open(os.path.join(OUT_DIR, 'players.json'), 'w', encoding='utf-8') as f:
        json.dump({'n': [D['name_of'].get(p, p) for p in order],
                   's': [D['span_of'].get(p, '') for p in order]},
                  f, ensure_ascii=False, separators=(',', ':'))

    # Median team games per season, for the ERA- innings qualifier.
    gpy = D['gpy']
    with open(os.path.join(OUT_DIR, 'league.json'), 'w', encoding='utf-8') as f:
        json.dump({'g': {str(int(y)): float(v) for y, v in gpy.items()
                         if FIRST_YEAR <= y <= LAST_YEAR}},
                  f, separators=(',', ':'))

    # Award tallies per player-season, so ranges of ten seasons or more can
    # build the awards board without a precomputed file.
    idx = D['idx_of']
    rows = {}
    a = D['allstar']
    a = a[(a.yearID >= FIRST_YEAR) & (a.yearID <= LAST_YEAR)]
    a = a.drop_duplicates(['playerID', 'yearID'])
    for pid, yr in zip(a.playerID, a.yearID):
        if pid in idx:
            rows.setdefault((idx[pid], int(yr)), [0, 0, 0, 0, 0])[0] += 1
    aw = D['awards']
    aw = aw[(aw.yearID >= FIRST_YEAR) & (aw.yearID <= LAST_YEAR)]
    for slot, (key, label) in enumerate(AWARD_SRC.items(), start=1):
        sub = aw[aw.awardID == label]
        for pid, yr in zip(sub.playerID, sub.yearID):
            if pid in idx:
                rows.setdefault((idx[pid], int(yr)), [0, 0, 0, 0, 0])[slot] += 1
    flat = [[p, y] + v for (p, y), v in sorted(rows.items())]
    with open(os.path.join(OUT_DIR, 'awards.json'), 'w', encoding='utf-8') as f:
        json.dump({'cols': ['AS'] + list(AWARD_SRC), 'rows': flat},
                  f, separators=(',', ':'))
    return len(order), len(flat)


##############################################################################
# Per-team season lines. One row per player per franchise per season, so a
# traded man's stats land with the club he earned them at - 8.2% of
# player-seasons involve more than one team, which is too many to fudge.
# Feeds both the team filter in Game 100 and the rosters in 162-0.
##############################################################################

OUT_TEAMS = os.environ.get('OUT_TEAMS', 'data-teams')

# G_p is in the scan so a pitcher taking his turn at bat is identified as a
# pitcher and kept out of the hitter pool, rather than defaulting to DH.
POS_COLS = [('G_c', 'C'), ('G_1b', '1B'), ('G_2b', '2B'), ('G_3b', '3B'),
            ('G_ss', 'SS'), ('G_lf', 'LF'), ('G_cf', 'CF'), ('G_rf', 'RF'),
            ('G_dh', 'DH'), ('G_p', 'P')]
FIELD_POS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']

# everything Game 100 ranks, so a team-filtered board offers the same categories
BAT_T = ['G','AB','R','H','X2B','X3B','HR','RBI','BB','SO','SB','CS','IBB','HBP','SH','SF','GIDP']
PIT_T = ['W','L','G','GS','IPouts','ER','SO','BB','SV','CG','SHO','HR','WP','H']


def load_teams():
    import pyreadr
    def tbl(n):
        return list(pyreadr.read_r(os.path.join(LAHMAN_DIR, n + '.RData')).values())[0]
    app, tms = tbl('Appearances'), tbl('Teams')
    app['yearID'] = app.yearID.astype(int)
    tms['yearID'] = tms.yearID.astype(int)

    franch = {(str(t), int(y)): str(f)
              for t, y, f in zip(tms.teamID, tms.yearID, tms.franchID)}
    names = {}
    for f, y, n in sorted(zip(tms.franchID, tms.yearID, tms.name), key=lambda r: r[1]):
        names[str(f)] = str(n)

    app = app[(app.yearID >= FIRST_YEAR) & (app.yearID <= LAST_YEAR)]
    cols = [c for c, _ in POS_COLS if c in app.columns]
    labels = [lbl for c, lbl in POS_COLS if c in app.columns]
    grp = app.groupby(['playerID', 'yearID', 'teamID'])[cols].sum()
    pos_of = {}
    for (pid, yr, tid), row in zip(grp.index, grp.values):
        fr = franch.get((str(tid), int(yr)))
        if not fr:
            continue
        best, n = None, 0
        for lbl, v in zip(labels, row):
            if v and v > n:
                best, n = lbl, v
        if best:
            pos_of[(pid, int(yr), fr)] = best
    return franch, names, pos_of


def team_side(df, y, cols, franch):
    """One row per (player, franchise) for this season."""
    d = df[df.yearID == y]
    if not len(d) or 'teamID' not in d.columns:
        return None
    d = d.copy()
    d['fr'] = [franch.get((str(t), y)) for t in d.teamID]
    d = d[d.fr.notna()]
    if not len(d):
        return None
    have = [c for c in cols if c in d.columns]
    agg = d.groupby(['playerID', 'fr'], as_index=False)[have].sum()
    return agg, have


def build_teams(D, franch, pos_of):
    os.makedirs(OUT_TEAMS, exist_ok=True)
    idx = D['idx_of']
    seasons, lg, total = {}, {}, 0

    for post in (False, True):
        bsrc = D['bpost'] if post else D['bat']
        psrc = D['ppost'] if post else D['pit']
        for y in range(FIRST_YEAR, LAST_YEAR + 1):
            out = {'y': y, 'post': post}

            got = team_side(bsrc, y, BAT_T, franch)
            if got:
                agg, have = got
                rows, ids, frs, poss = [], [], [], []
                for pid, fr, vals in zip(agg.playerID, agg.fr, agg[have].fillna(0).values):
                    if pid not in idx:
                        continue
                    pos = pos_of.get((pid, y, fr), 'DH')
                    if pos == 'P':          # pitchers hit, but they are not hitters
                        continue
                    rows.append([num(v) for v in vals])
                    ids.append(idx[pid]); frs.append(fr); poss.append(pos)
                if rows:
                    out['bat'] = {'cols': have, 'ids': ids, 'fr': frs, 'pos': poss, 'rows': rows}

            got = team_side(psrc, y, PIT_T, franch)
            if got:
                agg, have = got
                rows, ids, frs = [], [], []
                for pid, fr, vals in zip(agg.playerID, agg.fr, agg[have].fillna(0).values):
                    if pid not in idx:
                        continue
                    rows.append([num(v) for v in vals])
                    ids.append(idx[pid]); frs.append(fr)
                if rows:
                    out['pit'] = {'cols': have, 'ids': ids, 'fr': frs, 'rows': rows}

            if 'bat' not in out and 'pit' not in out:
                continue

            # whole-league context for this season, so a rate can be made
            # relative even when the board is filtered to one club
            key = str(y) + ('p' if post else '')
            tot = {}
            if 'bat' in out:
                c = out['bat']['cols']
                for k in ('AB', 'H', 'X2B', 'X3B', 'HR', 'BB', 'HBP', 'SF'):
                    if k in c:
                        tot[k] = sum(r[c.index(k)] for r in out['bat']['rows'])
            if 'pit' in out:
                c = out['pit']['cols']
                for k, lab in (('ER', 'ER'), ('IPouts', 'IPouts'), ('HR', 'pHR'),
                               ('BB', 'pBB'), ('SO', 'pSO')):
                    if k in c:
                        tot[lab] = sum(r[c.index(k)] for r in out['pit']['rows'])
            lg[key] = tot

            fn = f'{y}-post.json' if post else f'{y}.json'
            path = os.path.join(OUT_TEAMS, fn)
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
            total += os.path.getsize(path)

            if not post:
                for side in ('bat', 'pit'):
                    for fr in set(out.get(side, {}).get('fr', [])):
                        seasons.setdefault(fr, set()).add(y)

    return seasons, lg, total


def main():
    D = load()
    os.makedirs(OUT_DIR, exist_ok=True)
    n_players, n_awards = write_globals(D)
    print(f"players.json {n_players}  awards.json {n_awards} player-seasons")

    franch, fnames, pos_of = load_teams()
    seasons, lg, sz = build_teams(D, franch, pos_of)
    with open(os.path.join(OUT_TEAMS, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'first': FIRST_YEAR, 'last': LAST_YEAR, 'window': 10,
                   'pos': FIELD_POS,
                   'franchises': {k: {'name': fnames.get(k, k),
                                      'y0': min(v), 'y1': max(v), 'n': len(v)}
                                  for k, v in sorted(seasons.items())},
                   'league': lg},
                  f, ensure_ascii=False, separators=(',', ':'))
    print(f"teams: {len(seasons)} franchises, {sz/1024/1024:.1f} MB\n")
    ranges = [(y, y, str(y), str(y), 'season') for y in range(FIRST_YEAR, LAST_YEAR + 1)]
    for d in range(1920, LAST_YEAR + 1, 10):
        a, b = max(d, FIRST_YEAR), min(d + 9, LAST_YEAR)
        ranges.append((a, b, f'{a}-{b}', f'{d}s', 'decade'))
    for a, b in [(1920, 2025), (1947, 2025), (1969, 2025), (1994, 2025),
                 (2000, 2025), (2010, 2025), (2015, 2025)]:
        ranges.append((a, b, f'{a}-{b}', f'{a}\u2013{b}', 'span'))

    manifest, total = [], 0
    for y0, y1, rid, label, kind in ranges:
        entry = {'id': rid, 'label': label, 'y0': y0, 'y1': y1, 'kind': kind}
        for post in (False, True):
            sides, cats = build(D, y0, y1, post)
            if not cats:
                continue
            fn = f'{rid}-post.json' if post else f'{rid}.json'
            path = os.path.join(OUT_DIR, fn)
            with open(path, 'w', encoding='utf-8') as f:
                json.dump({'id': rid, 'label': label, 'y0': y0, 'y1': y1,
                           'post': post, 'sides': sides, 'cats': cats},
                          f, ensure_ascii=False, separators=(',', ':'))
            sz = os.path.getsize(path); total += sz
            entry['post' if post else 'reg'] = {'cats': len(cats), 'bytes': sz}
        if 'reg' in entry or 'post' in entry:
            manifest.append(entry)
            print(f"{rid:>12}  reg {entry.get('reg',{}).get('cats',0):>2}c "
                  f"{entry.get('reg',{}).get('bytes',0)/1024:>7.0f}K   "
                  f"post {entry.get('post',{}).get('cats',0):>2}c "
                  f"{entry.get('post',{}).get('bytes',0)/1024:>6.0f}K")

    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump({'source': 'Lahman database (cdalzell/Lahman)', 'first': FIRST_YEAR,
                   'last': LAST_YEAR, 'max_depth': MAX_DEPTH, 'foul_band': FOUL_BAND,
                   'ranges': manifest}, f, separators=(',', ':'))
    print(f"\n{len(manifest)} ranges, {total/1024/1024:.1f} MB")


if __name__ == '__main__':
    main()
