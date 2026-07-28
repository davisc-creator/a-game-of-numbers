# A Game of Numbers — project brief

**A Game of Numbers** is the collection. **Game 100** and **162-0** are the two
games in it. More are planned, so treat the shell as a container rather than as
one game's chrome.

*Renamed 2026-07-28. The whole thing was called "Off the Board" and the draft
game had no separate name. The localStorage key is still `offtheboard:records`
and must stay that way — changing it orphans every saved game on every device.*

**Game 100** is a leaderboard snake draft. Pick an era and a stat, players take
turns naming ballplayers, you score their rank on that leaderboard. Deep cuts
pay more than obvious ones. Everything below this line describes Game 100
unless it says otherwise.

Pure static site — HTML, CSS, JS and a folder of JSON. No server, no build
step, no framework, no dependencies. It must stay that way.

---

## State

Live at `https://davisc-creator.github.io/a-game-of-numbers/`, deployed from
`main` at `~/Projects/a-game-of-numbers` via GitHub Pages (branch `main`, root,
`.nojekyll` committed because Jekyll must not process 250+ data files).

**Two working copies exist** — `~/Desktop/app` is where edits happen and
`~/Projects/a-game-of-numbers` is the git repo. Verify which tree you are in
before running any git command:

```bash
pwd && ls index.html shell.js app.js game1620.js data/manifest.json
```

Consolidating to one folder is still open, and there is now a strong reason to:
**`~/Desktop` is iCloud-synced.** Rewriting `data/` in bulk repeatedly left
`"<name> 2.json"` conflict copies behind — 106 once, then 82 more that appeared
spontaneously later. The test suite catches them as a file-count failure, which
is the only reason they were noticed. After any bulk regeneration run
`find data data-teams -name "* 2.json" -delete` and check the count. The repo
copy in `~/Projects` is not affected.

**Do not run `gh auth login`, enter GitHub credentials, or create a personal
access token.** Authentication is the owner's to perform. The SSH key at
`~/.ssh/id_ed25519` is already registered and pushes work.

---

## Layout

```
index.html            markup for both games, no logic
styles.css            all styling; CSS custom properties at :root
shell.js              game registry, switcher, hash routing
app.js                Game 100 — state, data loading, game engine, records
game1620.js           162-0 — spin, draft, simulation
sw.js                 service worker, offline caching
manifest.webmanifest  PWA metadata
icon.svg
build_lists.py        regenerates data/ from the Lahman database
tests/run.js          Game 100 suite, no dependencies, not shipped to the page
tests/run1620.js      162-0 suite
tests/run-shell.js    both games in one context: load order, switching, id collisions
data-teams/<year>.json  one row per player per franchise per season, full stat set
data-teams/<year>-post.json  postseason equivalent
data-teams/index.json   franchises, their seasons, and league context per year
data/manifest.json    index of all ranges
data/<range>.json     e.g. 2024.json, 1970-1979.json, 2000-2025.json
data/<range>-post.json  postseason equivalents
data/cats.json        the category tables, shared with the client aggregator
data/players.json     name and career span per player id
data/league.json      median team games per season, for the ERA- qualifier
data/awards.json      award tallies per player-season
```

Screens are `<section id="screen-*">` toggled by `show(name)` in app.js. There
is no router.

---

## Data format

One file per range. `sides` holds full player tables; `cats` describes how to
turn a column into a leaderboard.

```json
{
  "id": "2000-2025", "label": "2000–2025", "y0": 2000, "y1": 2025, "post": false,
  "sides": {
    "bat": { "cols": ["H","R","RBI","…"], "rows": [["Albert Pujols", 3384, 1914, …]] },
    "pit": { "cols": ["IP","SO","W","…","ERAm","IP"], "rows": […] },
    "awd": { "cols": ["AS","MVP","CY","GG","SS"], "rows": […] }
  },
  "cats": {
    "bat_h": { "side": "bat", "col": "H", "label": "Hits",
               "abbr": "H", "depth": 500, "dir": "desc" }
  }
}
```

`rows[i][0]` is the player name; the rest align with `cols`. `buildPool()` in
app.js sorts a column, assigns competition ranks, cuts at `depth`, takes the
next ten as the foul band, and indexes everyone else for lookup.

Every side also carries `ids`: the player id for each row, drawn from
`players.json`. It exists so a custom range can add a player's seasons together
without joining on name — which would re-merge the namesakes. Pitching sides
additionally carry `ER` and `IPouts`, which ERA− has to be rebuilt from.

A side may also carry `who`: `{"<row index>": ["<team>", "<career span>"]}`,
present only for names the file holds more than once. It exists so the client
can tell namesakes apart — see the data caveats. `buildPool` keys its lookup by
row *reference*, not index, because the index does not survive the filter and
sort. Adding 5,530 of these entries across the set cost 0.14 MB.

Full tables ship deliberately — the game tells you a struck-out guess's real
value and rank, which needs every player, not just the ranked ones.

---

## Rules the code implements

- Snake draft, 2–4 players, pass-and-play on one device.
- **Rank 1–100 scores its own rank.** Rank 87 is worth 87 points.
- **Rank 101–110 is the foul band.** Costs a strike below two, free at two.
  Either way the turn ends; each of the ten only works once.
- **Rank 111 and beyond is a strike**, however good the player was. He is still
  in the pool and still reported — "he was 153rd" — because seeing how far off
  you were is the point. He simply cannot be drafted and cannot score.
- The cut is by **rank, not list position**, because ties share a rank. Sixty
  men tied at 50 all score 50; the hundredth of them does not fall into the
  fouls. `SCORE_TO` and `FOUL_TO` at the top of app.js are the only place this
  lives.
- Drafted players leave the shared pool for everyone.
- **Ties share a rank.** Two players with equal totals score the same.
- **A strike still reports the truth** — the player's actual value and rank, or
  that he had none in this era, or that he did not play in it.
- Three strikes ends that person's drafting; everyone else continues.
- Already-drafted names and ambiguous last names cost nothing and re-prompt.
- Near misses get one "did you mean?" confirmation before a strike lands.

**The cut has to stay visible.** The depth is in the game header (`g-depth`) and
every scored pick says "Nth of DEPTH". It used to appear only on the opening
plate, where the first pick overwrote it — which reads as a bug the moment a
deep list pays out 153 points and nothing on screen says the list runs 500 deep.
The rank *is* the score by design; the boundary being invisible was the defect.

Name matching (`norm`, `resolve` in app.js) strips accents and punctuation,
resolves bare last names when only one board player matches, handles
"first-initial lastname", and falls back to Levenshtein distance.

Three rules in `norm` that look fussy and are each load-bearing:

- **Spaced initials are joined.** Lahman writes "C. J. Cron" and "A. J.
  Burnett"; people type "CJ Cron". 123 players are written this way, and before
  this they answered to nothing — the game said they never played.
- **A lone initial is left alone**, so "w mays" still finds Willie Mays.
- **A Jr./Sr./II/III/IV suffix is only stripped at the end of the name.**
  Stripping it anywhere turned "JR Murphy" into "Murphy" and handed the player a
  different man. Only two names in the whole set carry a suffix, but two
  players' *initials* are J.R.

Suffix-stripping means "Ken Griffey Jr." and "Ken Griffey" normalise the same,
which is intended — they are two men and the chooser separates them. Lahman
mostly does not store suffixes anyway: Vladimir Guerrero Jr. is recorded as
plain "Vladimir Guerrero", identical to his father, so that pair was already
handled.

---

## Data caveats — do not silently "fix" these

- **Depth varies by list, and is not the scoring cut.** 1920 had 116 players
  with a home run; 2024 had 453. `cat.depth` says how far a list is *ranked*,
  which is what lets a strike report "he was 153rd". It has nothing to do with
  what scores — that is a flat top 100 (see the rules above). An earlier version
  of this brief said "never hardcode 100 or 500" and the code cut the board at
  `cat.depth`, which meant a 500-deep list paid out 500-point picks. The owner
  corrected that on 2026-07-28: the cut is 100 everywhere. Do not wire the two
  concepts back together.
- **Four categories are era-gated** for real data-coverage reasons: GIDP from
  1940, Caught Stealing from 1951, Intentional Walks from 1955. Awards start
  when the award did — All-Star 1933, Cy Young 1956, Gold Glove 1957, Silver
  Slugger 1980.
- **ERA− is league-relative with no park adjustment.** It will not match
  FanGraphs. 100 is average, lower is better, and it sorts ascending
  (`dir: "asc"` — the only category that does).
- **Names are mostly ASCII, but not all.** 2,367 rows carry accents — almost all
  of them Negro League players ("José Méndez", "Cristóbal Torriente"). Lahman
  ships them that way. `norm` strips accents on both sides, so typing either
  spelling matches. Do not transliterate the data to force ASCII.
- **Different men share a name.** 1,236 of the 7,331 category boards carry at
  least one repeated name — fifteen distinct players called "Smith" on the
  all-time board, two Alex Gonzalezes in 1998. These are not duplicate rows and
  must not be merged. `resolve` returns `k: 'choose'` and the player picks from
  a list showing team and career span. Where Lahman cannot tell the namesakes
  apart (8 cases in the whole set) it awards the better rank instead, because
  asking an unanswerable question would strand the slots.
- **The chooser must never show a rank or a stat.** Team and career span only.
  Anything else hands over the answer the game is asking for. This is also why
  there is no general autocomplete: suggesting board names as you type would
  turn the draft into reading the leaderboard.
- **Data ends at 2025.** Lahman has no 2026.

Regenerating data needs `pip install pandas pyreadr` and the Lahman tarball
from `codeload.github.com/cdalzell/Lahman/tar.gz/refs/heads/master`, extracted
so the `.RData` files sit in `lah/data/`.

---

## Custom year ranges

The **Custom** tab takes any span from 1920 to 2025 and aggregates it in the
browser out of the season files. Precomputing them was never an option: 1920 to
2025 contains 5,671 distinct ranges.

`buildCustom()` in app.js is a deliberate reimplementation of `build()` in
`build_lists.py` — the same era gates, the same all-zero row drop, the same
derived columns, the same ERA− against the range's own league context, the same
`depth_of` with its tie tail, the same ten-season floor on awards.

**These two must not drift.** The suite rebuilds all 18 shipped decades and
spans plus a sample of seasons through the client path and compares them cell
for cell against the shipped files. Change the arithmetic on either side and
that test fails, which is the point. Two things make it work and are easy to
break by accident:

- **Row order.** pandas `groupby` sorts by `playerID`; ids are assigned in the
  same sorted order, so sorting rows by id reproduces it. Assign ids any other
  way and every row order diverges.
- **Rounding.** Python and numpy round half to *even*; JS rounds half *up*.
  `rnd()` implements the former. Use `Math.round` here and ranges disagree in
  the last digit.

One deliberate difference: a custom range has no per-range team, so its
namesake chooser shows the career span alone rather than team and span. The
test strips `who` before comparing for exactly this reason.

---

## Records

`localStorage` under key `offtheboard:records`, an array of finished games.
Per person the app derives points/game, hit rate, average pick depth, deepest
pick, fouls, plus per-category and per-era breakdowns, head-to-head, a
pick-depth histogram, and repeat picks.

Two things to preserve when touching this:

- **Backward compatibility.** Older records lack the `picked` array and only
  have `ranks`. `profileFor()` handles both — keep it that way.
- **Export/import merges by `ts`.** Re-importing the same file is harmless.
  Do not switch to index-based merging.

Records are per-device. There is no sync and no backend, by design — nothing a
player does is sent anywhere. Moving them between devices is Export on one and
Import on the other; the merge is by `ts`, so importing the same file twice is
harmless. The Records screen says so, because "why aren't my records on my
phone" is otherwise a reasonable thing to read as a bug.

---

## Series

A series is a run of ordinary games sharing an `sid`. The game engine is
untouched: a series only decides whether another game starts and keeps the
running tally. Each game still writes its own record with the series fields
(`sid`, `sno`, `smode`, `sn`) riding along, so `careerStats` and `profileFor`
carry on working without knowing series exist. The suite asserts that.

Four formats, in `SMODES`: best of N, first to N wins, first to N points
(cumulative across games), and a fixed number of games. Either or both of the
era and the category can be re-rolled between games.

**A drawn game advances nobody.** The record's own `win` flag marks every top
scorer, which is right for career stats — but crediting both in a series let a
best-of-three finish 2–2 after two draws. Points still accumulate. First-to-N-wins
is capped at 99 games so a series of nothing but draws cannot run forever.

---

## Service worker

Fixed 2026-07-28. `sw.js` was cache-first for every same-origin GET, which
pinned installed browsers to the `app.js` they first saw. The shell is now
network-first with a cache fallback; `/data/` stays cache-first because those
files are immutable and offline play depends on it. `SHELL` was bumped to
`otb-shell-v2` to evict the stale entries; `DATA` stayed `v1` so nobody lost
their offline eras.

Keep the split. If you ever go back to cache-first for the shell, bump `SHELL`
on every single deploy or changes will not reach installed phones.

---

## Possible next steps

Not requested yet; the owner will direct priorities.

- A mixed mode that randomizes era and category each round.
- Solo play against the clock.
- Rate-stat categories (AVG, OBP, SLG, WHIP) — these need their own qualifier
  design, which is why they were skipped.
- More Lahman tables: Fielding has errors and passed balls; there is also
  salary data covering 1985–2016.
- Range picker gets unwieldy at 124 entries; it has a search box and a
  kind filter (spans / decades / seasons) but could be better on mobile.

---

## Conventions

- Vanilla JS, no build step, no framework, no npm. Do not introduce one.
- Two-space indent, single quotes, semicolons.
- Test locally with `python3 -m http.server 8000` — `file://` fails because the
  app fetches JSON.
- Verify with `node --check app.js` after edits.
- **Run all three suites before every commit** — `node tests/run.js`,
  `node tests/run1620.js`, `node tests/run-shell.js`. 202 assertions, no
  dependencies, about fifteen seconds. It loads `app.js` into a `vm` with a stub DOM
  rather than requiring any test scaffolding inside `app.js` — keep it that way.
  The last third of the suite walks all 247 data files and builds all 7,331
  category boards, so it catches data regressions as well as logic ones.
- Comments explain *why* a thing is unusual, not what the line does. Match that.

---

## 162-0

Spin a franchise and a rolling ten-year window, take one player off that club,
repeat until the roster is full, then play a season with it. Three respins of
the club, three of the era.

**The roster is 15**: nine hitters — the eight positions and a DH — then three
starters, two in relief and a closer. **There is no bench**, so every hitter has
to fit a real position, which is what makes a good shortstop a decision rather
than a freebie.

No bench also means a spin can come up genuinely useless to you: over 40
simulated drafts, 2 spins in 602 (0.3%) offered nobody who fitted an open slot.
That respin is free — `sx-free` — because otherwise a draft can dead-end with
the roster half filled and the paid respins gone. No simulated draft failed to
complete; the average was 15.1 spins for 15 slots.

The card grid filters by side, by any position the club actually has, and by
"fits an open slot", which is the one that matters late in a draft. Filters that
would show an empty grid are not offered.

**Era normalization is the whole game.** League batting average was .296 in 1930
and .237 in 1968. On raw numbers every optimal roster is a 1930s roster and the
spin stops mattering. So every card carries OPS+ and ERA− measured against that
player's own league-seasons, and the simulation eats those, never the raw line.
Raw numbers still appear on the card because they are what people recognise.
Koufax's 1.86 ERA over 1963-72 becomes a 54 ERA− — still elite, no longer
absurd. The test suite asserts exactly that, and that the 1960s league was
lower-scoring than the 1990s one.

`data-teams/<year>.json` holds every player's line for that season plus his
franchise and the position he actually played. Franchise-era rosters are
assembled in the browser, for the same reason custom ranges are: rolling windows
over 1920-2025 give 2,273 club-and-era combinations and precomputing them is
absurd. Positions come from Lahman's `Appearances`, taking the spot a player
started at most that season; `G_p` is in that scan so a pitcher taking his turn
at bat is identified as a pitcher rather than defaulting to DH. Skip that and
half the "hitters" are pitchers.

A card has to clear a playing-time floor for that club in that window — 200 AB
or 50 IP — or a spin returns three hundred September call-ups.

**Scoring is Pythagorean and every step is shown on the results screen.** Team
on-base and slugging relative to their own leagues, multiplied against a
reference offence of 4.4 runs a game, gives runs scored; staff ERA− weighted by
a realistic innings split gives runs allowed; `RS^1.83 / (RS^1.83 + RA^1.83)`
gives the win rate; 162 weighted coin flips give the record. It was chosen for
explainability, not accuracy. Park factors, platoon splits and defence beyond
position eligibility are deliberately absent — each adds accuracy and costs more
explanation than it returns.

## The shell

`shell.js` holds a registry, swaps which game element is visible, keeps the
masthead in step, and routes `#/game100` and `#/1620`. Games register
themselves; the shell knows nothing about their internals.

This is **not** the `$`-scoped refactor sketched in
`docs/shell-architecture.md`. That rewrites fifty working, tested call sites in
Game 100 to solve an id collision that does not exist — the two games share no
element ids, and `tests/run-shell.js` asserts it stays that way. Do the refactor
if a third game ever wants to reuse ids, not before.

Two things that look incidental and are not:

- **Boot is deferred.** Games register when their own script runs, which is
  after `shell.js`. Booting inline would find an empty registry.
- **A draft in progress is only in memory.** `isDirty()` lets the shell confirm
  before a switch throws it away.


---

## Team boards

Two different questions, and the difference is the whole feature:

- **What they did there** (`buildTeamRange`) — the club's own record book. Only
  what a player did *for that club* counts. Randy Johnson shows 86 strikeouts
  for the Giants and does not make their board.
- **Anyone who played there** (`buildTeamMembers`) — the men who wore the shirt,
  with everything they did in the era wherever they did it. Randy Johnson shows
  3,749 and tops it.

`data-teams/` carries one row per **(player, franchise, season)**, which is why
the first mode is honest: 8.2% of player-seasons involve more than one club, so
attributing a traded man's whole season to his "primary" team would have been a
lot of quiet fiction. The split also made 162-0's rosters more accurate, since
it filters the same rows.

Three things worth not undoing:

- **League context stays league-wide.** A club's ace is measured against the
  baseball everyone was playing, not against his own rotation — otherwise every
  team fields an average staff by definition.
- **Club boards drop the awards side.** An All-Star selection or an MVP cannot
  be split by team in any way this data supports. Membership boards keep them,
  because there the stats are the player's own anyway.
- **Membership always comes from the regular season**, even for a postseason
  board. A man on a postseason roster was on the regular-season one; the reverse
  is not true.

Both modes re-rank and re-cut from scratch, because the pool shrank — a top 100
of the Giants is not a slice of the top 100 of baseball.
