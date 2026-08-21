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

**There is one copy: `~/Projects/a-game-of-numbers`.** Work there.

It used to be two — a working copy on the Desktop and the repo here — and the
Desktop one was iCloud-synced, which left `"<name> 2.json"` conflict copies
behind every time `data/` was rewritten in bulk: 106, then 82, then 251. The
file-count assertion in the suite was the only thing that ever caught them.
Consolidated 2026-07-28; the old folder went to `~/.Trash/app-consolidated-2026-07-28`
rather than being deleted. Do not put a working copy back under `~/Desktop`.

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
icon.svg              app icon, numerals drawn as shapes
apple-touch-icon.png  180x180 raster of the same; the only icon iOS will use
build_lists.py        regenerates data/ from the Lahman database
tests/run.js          Game 100 suite, no dependencies, not shipped to the page
tests/run1620.js      162-0 suite
tests/run-shell.js    both games in one context: load order, switching, id collisions
tests/run-sw.js       the service worker, against a stub CacheStorage
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
next twenty-five as the foul band, and indexes everyone else for lookup.

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

- Snake draft, 1–4 players, pass-and-play on one device. One is solo practice —
  see below.
- **Rank 1–100 scores its own rank.** Rank 87 is worth 87 points.
- **Rank 101–125 is the foul band.** Costs a strike below two, free at two.
  Either way the turn ends; each of the twenty-five only works once. *Widened
  from 101–110 on 2026-07-29 at the owner's direction.*
- **Naming the number-one player earns a one-pick extension of the foul band to
  140** (`WIDE_TO`). Rank 1 is worth one point, the least on the board, so it
  pays in rope instead. It is per person, counted in `p.wide`, spent by the
  first pick that lands in 126–140 (which then fouls instead of striking, and
  burns the man named like any foul), and shown on the seat panel until spent.
  Ties at rank 1 all count — two men level at the top are both the best. A pick
  at 141 or beyond is a strike with or without it, and does not consume it. The
  miss record carries `w: true` so the per-game views can say which foul it
  was; `wides` on the player record counts how many were earned.
- **Rank 126 and beyond is a strike**, however good the player was. He is still
  in the pool and still reported — "he was 153rd" — because seeing how far off
  you were is the point. He simply cannot be drafted and cannot score.
- The cut is by **rank, not list position**, because ties share a rank. Sixty
  men tied at 50 all score 50; the hundredth of them does not fall into the
  fouls. `SCORE_TO`, `FOUL_TO` and `WIDE_TO` at the top of app.js are the only
  place this lives. The rules screen in index.html states all three; keep it in
  step.
- Drafted players leave the shared pool for everyone.
- **Ties share a rank.** Two players with equal totals score the same.
- **A strike still reports the truth** — the player's actual value and rank, or
  that he had none in this era, or that he did not play in it.
- Three strikes ends that person's drafting; everyone else continues.
- **A missed player is out of play.** Once a name has been fouled or struck out
  on, saying it again costs nothing and re-prompts — the same as naming someone
  already drafted. The miss list sits under the draft list on the game screen,
  because what has already been burned is half the information in the room.
  This replaces the older rule that a used foul cost a strike the second time.
- Already-drafted names and ambiguous last names cost nothing and re-prompt.
- Near misses get a "did you mean?" confirmation before a strike lands — one
  name if only one is close, otherwise a list of up to five.

**The cut has to stay visible.** The depth is in the game header (`g-depth`) and
every scored pick says "Nth of DEPTH". It used to appear only on the opening
plate, where the first pick overwrote it — which reads as a bug the moment a
deep list pays out 153 points and nothing on screen says the list runs 500 deep.
The rank *is* the score by design; the boundary being invisible was the defect.

Name matching (`norm`, `resolve` in app.js) strips accents and punctuation,
resolves bare last names when only one board player matches, handles
"first-initial lastname", and falls back to Levenshtein distance.

Three later additions, in the order `resolve` tries them:

- **Nicknames** (`ALIASES`). Lahman carries none, so the table is hand-built —
  67 entries, keys already normalised so "A-Rod", "a rod" and "ARod" all arrive
  as one string. A name earns a place only when the nickname is genuinely more
  famous *and* points at one man: "Pudge" is Fisk and Rodriguez, "Doc" is Gooden
  and Halladay, so neither is there. The suite asserts every alias resolves to a
  real player and that none shadows somebody's actual name.
- **Bare first names**, but only when they name one man. This is the mononym
  case: everyone says "Ichiro", and before this the game answered that Ichiro
  Suzuki — third on the 2000–2025 hit list — never played. Anything ambiguous is
  dropped silently rather than reported, because listing every Mike in the era
  would be useless and would read out a chunk of the board.
- **A near-miss chooser** (`candidates`, `askCandidates`) for everything else.

**The near-miss chooser draws from the whole era, never from the board.** This
is the difference between fixing a spelling and handing over an answer. Because
the top 100, the foul band and the hundreds below it are all eligible, a name
being offered says nothing about whether it scores — across the suite's probes
about 6% of offered names are on the board, so the list cannot be fished. Narrow
it to board members to "improve" the suggestions and it becomes the autocomplete
that was deliberately refused.

Two more things hold that line and are easy to undo:

- **Candidates sort by edit distance, then alphabetically. Never by rank.**
- **A distance of nought is ambiguity, not a misspelling.** Reaching
  `candidates` means neither the full name nor the last name matched exactly, so
  an exact hit can only be a shared first name; more than five of those means
  the query was a crowded first name and nothing is offered. Volume cannot make
  this call — "jonson" matches 340 men and is a real typo, "mike" matches 401
  and is not. The distance is what separates them.

Picking a candidate costs an attempt but no strike, and then re-enters the turn
through `takeNamed` → `resolve(e.name)` → `apply`, so a chosen name obeys every
rule a typed one does: drafted, already missed, foul band, off the list. That
routing is the point — an earlier `askConfirm` scored its suggestion directly,
which would have quietly awarded points for a man ranked 400th once suggestions
stopped coming from the board alone. "None of these" is the ordinary miss it
always was, and strikes.

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
- **Neither chooser may ever show a rank or a stat.** The namesake chooser shows
  team and career span; the near-miss chooser shows the span alone. Anything
  else hands over the answer the game is asking for, and the suite asserts no
  number reaches the screen at all. This is also why there is no general
  autocomplete: suggesting board names *as you type* would turn the draft into
  reading the leaderboard. The near-miss list is not that — it fires only on
  submit, only when nothing matched outright, and it is drawn from the whole era
  rather than the board.
- **Data ends at 2025.** Lahman has no 2026.

Regenerating data needs `pip install pandas pyreadr` and the Lahman tarball
from `codeload.github.com/cdalzell/Lahman/tar.gz/refs/heads/master`, extracted
so the `.RData` files sit in `lah/data/`.

---

## Custom year ranges

The **Custom** tab takes any span from 1920 to 2025 and aggregates it in the
browser out of the season files. Precomputing them was never an option: 1920 to
2025 contains 5,671 distinct ranges.

`loadRange` carries a sequence number. Every tap on a range, a club or the
season toggle starts a load and a club board can fetch thirty files, so two
quick taps finished out of order and the earlier selection's board got
installed under the later selection's label. A load that has been overtaken
throws its result away.

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
- **Loading checks the shape.** `"null"` and `"{}"` both parse and neither is
  iterable; the first thing to trip over that would be `finish()` — after the
  game, before the record is written. A non-array loads as empty.

**Past games open in place on the Records screen.** `#hist-list` used to render
each game as an inert `<div>` — it looked tappable and did nothing, and the
per-game detail existed only inside one person's profile. That is also the one
place it cannot be complete: a profile is one person by definition, so it can
never show what the other drafters picked in the same game. Tapping a row now
shows every drafter, their picks sorted by rank, and their misses.

`histPicks` handles the three record shapes people actually have, and reports
which one it is rather than rendering an empty game: picks with names, an older
record carrying only `ranks`, and one written before the miss list existed —
the same rule the breakdowns follow.

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

**A random era is drawn by kind first** (`rollEra`): the manifest is 106
seasons, 11 decades and 7 spans, so a uniform draw over ranges is a single
season five times in six and a random series reads as "1943 again". Kind is
chosen uniformly, then a range within the kind. The suite asserts all three
kinds come up and that spans and decades are not rare.

**The opening pick rotates** through the seats from game to game inside any
series (`S.G.first`, consumed by `order`). In a multi-round snake it is merely
fair; in a one-pick game it is essential, because the second picker knows the
number to beat.

**The World Series** is a preset over this machinery, not a mode of its own:
`S.fmt.ws` sets best of seven with both re-rolls on, and `S.SR.ws` makes every
game one round (`maxRounds` 1, whatever the rounds setting says). Whoever names
the deeper player takes the game. It starts through `seriesNextGame` so game
one is rolled like the rest rather than using whatever the setup screen had
selected, and the setup screen hides the era, club, category and rounds cards
while it is chosen because none of them apply. A club filter is cleared for it
— a club that did not exist in the rolled era would end the series early —
while an ordinary random-era series keeps its clubs, since "the Giants, random
decade" is a fair game.

It has its own end rule because one-pick games draw often (both strike, or the
same rank): four wins ends it, or seven games with an outright leader on wins;
level after seven is sudden death until somebody leads outright, capped at 99
like first-to-N-wins. A shared title was the alternative and is not a World
Series. Records carry `sws: true`; the series history labels them.

**A drawn game advances nobody.** The record's own `win` flag marks every top
scorer, which is right for career stats — but crediting both in a series let a
best-of-three finish 2–2 after two draws. Points still accumulate. First-to-N-wins
is capped at 99 games so a series of nothing but draws cannot run forever.

---

## Solo practice

One drafter. **No new engine** — the same board, the same snake order over a
seat of one, the same scoring, the same three strikes. `order`, `seat`,
`advance` and `alive` all already handled a single player; the floor was a UI
one, and the only real work was stopping the records from lying about it.

- **Nothing is won.** `win` is false for every solo game and the record carries
  `solo: true`. Marking the lone player a winner would have made the win column
  meaningless the moment anybody practised; leaving `win` false with nothing to
  explain it reads as a long losing streak. So `careerStats` and `profileFor`
  both count `solo`, and the records list and profile show it next to the wins.
- **A series needs somebody to be ahead of.** Choosing one drafter hides the
  format card and forces `S.fmt.on` off. A best-of-three against nobody would
  never resolve, and first-to-N-wins would run to its 99-game cap.
- **`soloPriorBest` is the point of practising.** It reports the best previous
  solo score on this *exact* board — same category, same range, same postseason
  flag — because a different board is a different problem, the same reason
  streaks do not carry between games. Null on a first attempt, so the screen
  says the score rather than comparing against zero. It is read at the top of
  `finish` because the new record is pushed a few lines later and would
  otherwise be its own best.
- Rarity already returned null with one drafter and still does; there is nobody
  to measure against.

"Until everyone's out" reads "Until you are out" when solo, which is the mode
worth playing — how far you get before three strikes.

## The icon

Replaced 2026-07-29. It was a gold **OB** — Off the Board, the name dropped on
the 28th — and was the last thing still carrying the old brand. Now a gold
`100` on the Monster green.

Four things about it that look like fussiness and are not:

- **The numerals are shapes, not text.** An app icon is rasterised by the OS,
  which never loads a webfont and does not agree with the next OS about what
  "Helvetica" is. The old icon asked for Helvetica and got whatever was nearest.
- **Everything sits inside the middle 80%.** The manifest declares the icon
  `maskable`, so Android crops it to a circle. The old 16px border sat squarely
  in that crop zone and was being clipped.
- **iOS needs the PNG.** It does not read the manifest for a home-screen tile
  and will not accept an SVG for `apple-touch-icon`. Without
  `apple-touch-icon.png` an iPhone puts a screenshot of the page on the home
  screen. Regenerate it from the SVG with
  `qlmanage -t -s 180 -o <dir> icon.svg` — no build step, macOS ships it. It
  must stay fully opaque; iOS composites transparency onto black.
- **It is deliberately not in the service worker's `FILES`.** That list goes
  through `addAll`, which rejects as a whole if any one file 404s, and a failed
  install costs offline play. A cosmetic file is not worth that risk; the
  network-first shell handler caches it on first fetch anyway.

`short_name` is `Game 100` — the only name a home screen ever shows, and the
reason `name` can stay the full **A Game of Numbers**. iOS truncates a label at
roughly twelve characters. Naming the collection after its flagship game is a
known trade: 162-0 is not in the icon.

**A phone caches the tile from the moment the app was added.** Changing the icon
does nothing to an already-installed home-screen app until it is removed and
re-added.

## Service worker

Fixed 2026-07-28. `sw.js` was cache-first for every same-origin GET, which
pinned installed browsers to the `app.js` they first saw. The shell is now
network-first with a cache fallback; `/data/` stays cache-first because those
files are immutable and offline play depends on it. `SHELL` was bumped to
`otb-shell-v2` to evict the stale entries; `DATA` stayed `v1` so nobody lost
their offline eras.

Keep the split. If you ever go back to cache-first for the shell, bump `SHELL`
on every single deploy or changes will not reach installed phones.

**Only good responses are cached** (2026-07-29). `Cache.put` stores a 404 as
happily as a 200, and under cache-first that entry is then served for ever — one
bad moment during a deploy and that file is broken on that device permanently,
with nothing on screen to say so. `keep()` writes only when `res.ok`, and the
data branch also checks `hit.ok` on the way *in*, so a cache poisoned before this
landed steps over the bad entry and replaces it. That read-side check is why
`DATA` did not need a version bump to fix it — bumping would have cost everyone
their offline eras.

**A stale worker cannot be fixed from the server.** The 2026-07-28 fix only
takes effect once the new `sw.js` installs; an installed home-screen app that is
never fully terminated may never re-check, and stays pinned to the old worker
indefinitely. That happened: on 2026-07-28 a phone still running the pre-19:34
`app.js` wrote four games' records in the old shape — no `picked[].i`, no
`y0`/`y1`, no `misses` — hours after the fix was live. Nothing deployable
reaches such a device; the caches have to be cleared on it. Clearing website
data also clears `localStorage`, so **export the records first** or they are
gone.

`tests/run-sw.js` covers all of this against a stub `CacheStorage`. It was
written after the fact and checked the honest way: run against the previous
`sw.js` it fails six of its assertions, all of them the real defects.

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
- **Run all four suites before every commit** — `node tests/run.js`,
  `node tests/run1620.js`, `node tests/run-shell.js`, `node tests/run-sw.js`.
  570 assertions, no
  dependencies, about fifteen seconds. It loads `app.js` into a `vm` with a stub DOM
  rather than requiring any test scaffolding inside `app.js` — keep it that way,
  and the same for `sw.js` against a stub `CacheStorage`.
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

Three things fixed on 2026-07-29 after a review, each with a test that fails
on the old code:

- **The snake was wrong with more than one drafter.** `nextTurn` wrote the seat
  it had mapped to back into the position counter, so every backward round was
  one pick long and the last seat drew twice as often as anyone — 6 of 12 picks
  with three drafters. `G.pos` is the position in the round and `G.turn` the
  seat it maps to, and they stay apart.
- **A drafted player is gone for everyone.** The spin rebuilds its cards from
  the season files each time, so `taken()` has to strip every man already on a
  roster, or one player could be drafted twice — by two seats or into two slots.
- **A paid respin lands somewhere else.** The candidate list now excludes the
  club-and-window showing; for a club with a single window the respin widens to
  any club rather than costing a respin for nothing.

Abandoning a draft sets `G.done`, so `isDirty()` stops asking about a draft
the player already threw away.

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


---

## Breakdowns

`data/played.json` holds, per player id, the seasons he appeared in and the
clubs he appeared for with a season count each. `profileFor` uses it to answer
two questions the old profile could not: which seasons somebody knows, and
which clubs.

**Everything splits, nothing double-counts.** A pick is shared evenly across the
seasons that player was active *inside the era the game was played*, and across
his clubs weighted by how long he was at each — Ruth's single Braves year is not
half his career. The charts therefore reconcile with the points actually scored,
and the test suite asserts that they do. Counting a player whole in every bucket
would have been easier and would have produced a chart that silently disagrees
with the score, which in a project this fussy reads as a bug.

Two edges worth keeping:

- **If none of a player's seasons land inside the era**, his points fall back to
  his whole career rather than vanishing. If he has no season data at all they
  go to `P.unplaced`, which the note on screen reports. Points never disappear.
- **Eras and categories are graded on points per game, not average rank.** A
  shallow list caps how deep anyone can go, so rank flatters the eras nobody
  knows well.

Records also carry `y0`/`y1` now. Records written before that fall back to
parsing the range id, which works for every shape the game has produced —
`1998`, `1970-1979`, `SFG_1994-2025`.

**An empty chart has three causes and they must not read alike.** Picks are
placed by the player id in `picked[].i`, which only games from 2026-07-28 19:34
onward carry — before that a record has `picked` but no ids, and nothing about
those games can ever be placed. Add the season index failing to load and there
are three quite different reasons for a blank chart, all of which used to print
"No successful picks yet" at someone who had plenty. `PX.ok` marks whether
`played.json` really loaded (a bad status has to be caught explicitly, since
`/data/` is cache-first in the service worker and a 404 cached once would be
served for good), and `P.idless`/`P.idlessPts` count what predates the ids. The
reconciliation note excludes what it could not place rather than claiming a
total it did not chart.


---

## The four derived stats

All four live in `profileFor` and `careerStats`, and both have to carry them —
the records list sorts on `careerStats`, and an early version accumulated them
only in the profile, so the list was quietly sorting on `undefined`. The suite
now asserts every row is finite and every comparator returns a number.

**Rarity.** A pick counts for its rank times the share of *the other drafters*
who have never named that player. Measuring against other people rather than
against all picks is what the question actually asked, and it stops anyone being
rewarded for their own repeats. With one drafter there is nobody to compare
against, so it returns `null` and the screen says so rather than showing a zero
that looks like a score.

**First guess.** `S.G.tries` counts attempts inside a turn. A re-prompt — already
taken, already missed, ambiguous, empty — costs an attempt but does not end the
turn, so it must not count against a first guess either. A turn-ending outcome
records whether it was the opening attempt. Shown per era, because knowing an
era is partly knowing it instantly.

**Streaks** are the longest run of successful picks inside a *single* game, from
a per-player `seq` string of `p`/`f`/`s`. They deliberately do not carry across
games: a new board is a new problem.

**Head-to-head season chart** runs the same season split for both people over the
games they shared and draws them back to back from a shared centre. It answers
where two people's knowledge diverges, which the win-loss line cannot.

Records written before any of this lack `turns`, `firstOk` and `seq`; every
consumer treats a missing value as zero or `null` rather than assuming.
