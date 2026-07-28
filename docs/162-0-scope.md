# 162-0 — scope

Status: proposed, nothing built. Written 2026-07-28.

Spin a random team and a random ten-year era, look at everyone who played for
that franchise in that window, take one for your roster. Repeat until you have
21: 13 hitters, 5 starters, 2 relievers, 1 closer. Three team respins and three
era respins. Then the roster plays a season and you find out how it did.

The versions of this floating around online do the spin-and-draft part fine and
then hand-wave the ending. The three things asked for here — better stats, real
opponents, and scoring you can actually follow — are all downstream of one
decision, so that comes first.

---

## The decision everything else depends on: era normalization

A 1930 hitter batted .296 league-wide. A 1968 hitter batted .237. If the cards
show raw numbers and the simulation adds up raw numbers, then every good roster
is a 1920s-1930s roster, the spin stops mattering, and the game is solved in a
week.

Game 100 already solved this once. ERA− is league-relative: 100 is average,
lower is better, and the brief is explicit that it is the only category sorting
ascending. The same idea has to run through all of 162-0:

- **Hitters** carry OPS+ style indices — on-base and slugging measured against
  that player's own league-seasons, weighted by his playing time.
- **Pitchers** carry ERA− and FIP−, same construction.
- Raw counting stats still appear on the card, because they are what people
  recognise. They just are not what the simulation eats.

This means a 1968 Bob Gibson and a 1999 Pedro Martinez arrive at the simulation
comparable, and the spin stays meaningful. It also gives the scoring screen
something honest to explain, which is the third request.

**Cost:** league-context tables per season (runs, PA, OBP, SLG, ERA) computed
once in `build_lists.py`. Small. Everything else here assumes it exists.

---

## Data: Lahman already has all of it

Worth stating plainly because it was the main unknown. No new source is needed.

| Need | Lahman table | Notes |
|---|---|---|
| Who played for which team, which years | `Batting`, `Pitching` | Both carry `playerID`, `yearID`, `teamID`, `stint` |
| Stable franchise identity | `Teams.franchID` | Required — `teamID` changes when a club moves. MON and WAS are one franchise |
| Positions | `Appearances` | `G_c`, `G_1b` … `G_rf`, `G_dh`; assign a player his most-played position in the era |
| League context per season | `Teams` | Aggregate to league-season for the normalization above |
| Relief vs closer split | `Pitching` | `SV` and `GS` separate starters, relievers and closers cleanly enough |

`build_lists.py` already loads `Batting`, `Pitching`, `People` and `Teams`. It
needs `Appearances` added and a second output path. It does **not** need
rewriting — the aggregation it does per era is the same shape, just grouped by
franchise as well.

### Shape and size

Eras are the ten-year windows that already exist in `data/manifest.json`
(`kind: "decade"`), so the era spinner reuses the range vocabulary Game 100
already ships.

```
data-1620/franchises.json     franchID -> name, era availability
data-1620/<franch>-<era>.json one roster: players, positions, indices, raw stats
```

Roughly 30 franchises × 11 decades, minus expansion gaps, so on the order of
250-300 files — the same order as `data/` and loadable the same lazy way. A
franchise-era file is small; only players who actually cleared a playing-time
floor for that franchise in that window are included.

**Open:** a playing-time floor is needed or every roster is 300 names, most of
them September call-ups. Something like 200 PA or 50 IP *for that franchise in
that era*. Needs a pass over real numbers to pick, which cannot be done until
the Lahman tarball is downloaded.

---

## Draft

21 slots, 21 spins. Spin gives franchise + era together; respins are separate
pools (3 team, 3 era) so you can keep a good era and reroll a bad club.

**Positional constraints.** "13 hitters" can mean 13 bats, or a real lineup.
Real positions are more interesting — they make a great shortstop a genuine
decision rather than a free win — and `Appearances` supports it. Proposed:
C, 1B, 2B, 3B, SS, LF, CF, RF, DH, plus 4 bench of any position. Flagged as an
open question because it materially changes difficulty.

**Cards** show, per player: era-normalized index up top (the number that
counts), raw slash line and counting stats below, position, and years with that
franchise in that era. Sorting and filtering the card grid is necessary at
300 players; searching it is not — browsing is the point of this game, unlike
Game 100 where browsing would be cheating.

---

## Simulation and scoring

The requirement is that a person can read the result and understand why they
got it. That rules out a black box and it rules out a full play-by-play engine
nobody can audit. The middle path:

1. **Team offense.** Aggregate the 13 hitters' normalized on-base and slugging,
   weighted by projected plate appearances (starters get more than bench).
   Convert to runs per game.
2. **Team defense.** The 5 starters, 2 relievers and closer, weighted by a
   realistic innings split (~65% starters, ~25% relief, ~10% closer). Convert
   to runs allowed per game.
3. **Expected record.** Pythagorean expectation, exponent 1.83:
   `W% = RS^1.83 / (RS^1.83 + RA^1.83)`. This is the whole scoring model and it
   fits on one line, which is exactly why it is the right choice.
4. **The season.** Simulate 162 games rather than just reporting the
   expectation — each game a weighted coin flip around that win percentage — so
   there is a streak, a final record, and some luck.

The results screen then shows the chain: *your hitters produced 5.1 runs a
game, your staff allowed 3.9, that is a .627 expectation, you went 104-58.*
Each number links back to the players who drove it. No step is hidden.

**Not included, deliberately:** park factors, platoon splits, aging curves,
defence beyond position eligibility. Each adds real accuracy and costs more
explainability than it returns here.

---

## Multiplayer

Two modes, sharing one engine.

- **Head-to-head / up to 4.** Everyone drafts, then the rosters play a round
  robin — each pairing simulated with the same Pythagorean model, home team
  taken from the better seed. Standings, then a final.
- **Contested draft (recommended).** All drafters share one spin sequence and
  pick in snake order, so a player taken is gone for everyone. This is exactly
  Game 100's mechanic, it makes the draft social rather than parallel, and it
  reuses the snake ordering already written and tested.

Pass-and-play on one device, consistent with Game 100. No backend.

**Records** go under `agon:1620:records`, per the namespacing in
[shell-architecture.md](shell-architecture.md). Game 100 keeps its legacy key.

---

## Open questions

1. **Positions or just 13 bats?** Changes the difficulty and the data work.
2. **Playing-time floor** for appearing on a card — needs real numbers to set.
3. **Fixed decades or rolling ten-year windows?** Decades reuse the existing
   manifest and are cheaper. Rolling windows (1927-1936) spin more variety.
4. **Do respins carry between drafters** in contested mode, or does each get
   their own three and three?
5. **Postseason?** The data exists. A 162-game season that ends without one
   feels unfinished, but it doubles the simulation surface.

---

## Build order

The shell refactor in [shell-architecture.md](shell-architecture.md) comes
first — building this inside the current single-game structure means doing that
work twice.

| Step | Depends on | Size |
|---|---|---|
| 1. League-context tables + normalized indices in `build_lists.py` | Lahman tarball, `pip install pyreadr` | Medium |
| 2. Franchise-era roster generation → `data-1620/` | 1 | Medium |
| 3. Spin + card grid + roster board | 2, shell | Large |
| 4. Simulation engine + results screen | 1 | Medium |
| 5. Multiplayer modes | 3, 4 | Medium |
| 6. Tests throughout | | |

Step 1 is the one that decides whether the game is any good. It is also the one
that cannot start until the Lahman database is downloaded locally, which has
not happened on this machine yet.
