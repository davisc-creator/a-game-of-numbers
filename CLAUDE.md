# A Game of Numbers — project brief

*Named "Off the Board" until 2026-07-28. The localStorage key is still
`offtheboard:records` and must stay that way — changing it orphans every saved
game on every device.*

A baseball leaderboard snake-draft game. Pick an era and a stat, players take
turns naming ballplayers, you score their rank on that leaderboard. Deep cuts
pay more than obvious ones.

Pure static site — HTML, CSS, one JS file, and a folder of JSON. No server, no
build step, no framework, no dependencies. It must stay that way.

---

## Immediate task

Get this deployed to GitHub Pages. Still not pushed as of 2026-07-28.

**Done already:** the stray `~/.git` is gone. The repo exists at
`~/Projects/off-the-board` on branch `main` with `.nojekyll` committed (247
data files; Jekyll must not process them). Tests pass.

**Two working copies exist** — `~/Desktop/app` is where edits happen and
`~/Projects/off-the-board` is the git repo. They are byte-identical apart from
`.git`. Verify which tree you are in before running any git command:

```bash
pwd && ls index.html app.js sw.js data/manifest.json tests/run.js
```

Consolidating to one folder is still open.

**Remaining:** push and enable Pages (Settings → Pages → Deploy from a branch → `main` /
root). Target URL: `https://<user>.github.io/off-the-board/`.

**Do not run `gh auth login`, enter GitHub credentials, or create a personal
access token.** Authentication is the user's to perform. Prepare everything up
to that point, then hand back.

After it is live, verify by fetching `<url>/data/manifest.json` — it should
return JSON with 124 entries under `ranges`. A 404 there is the usual
first-deploy failure and means `.nojekyll` is missing or Pages is pointed at
the wrong branch.

---

## Layout

```
index.html            markup for all six screens, no logic
styles.css            all styling; CSS custom properties at :root
app.js                everything — state, data loading, game engine, records
sw.js                 service worker, offline caching
manifest.webmanifest  PWA metadata
icon.svg
build_lists.py        regenerates data/ from the Lahman database
tests/run.js          node test suite, no dependencies, not shipped to the page
data/manifest.json    index of all ranges
data/<range>.json     e.g. 2024.json, 1970-1979.json, 2000-2025.json
data/<range>-post.json  postseason equivalents
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

Full tables ship deliberately — the game tells you a struck-out guess's real
value and rank, which needs every player, not just the ranked ones.

---

## Rules the code implements

- Snake draft, 2–4 players, pass-and-play on one device.
- A correct pick scores that player's rank. Rank 137 is worth 137 points.
- Drafted players leave the shared pool for everyone.
- **Ties share a rank.** Two players with equal totals score the same.
- **Foul ball:** naming one of the ten players just past the cut costs a strike
  if you have fewer than two, and is free at two strikes. Either way the turn
  ends. Each of the ten only works once.
- **A strike still reports the truth** — the player's actual value and rank, or
  that he had none in this era, or that he did not play in it.
- Three strikes ends that person's drafting; everyone else continues.
- Already-drafted names and ambiguous last names cost nothing and re-prompt.
- Near misses get one "did you mean?" confirmation before a strike lands.

Name matching (`norm`, `resolve` in app.js) strips accents, punctuation and
Jr./Sr., resolves bare last names when only one board player matches, handles
"first-initial lastname", and falls back to Levenshtein distance.

---

## Data caveats — do not silently "fix" these

- **Depth varies by list.** 1920 had 116 players with a home run; 2024 had 453.
  Lists run 500 deep only where that is meaningful. Never hardcode 100 or 500.
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
  must not be merged. `resolve` awards the better rank when the full names are
  identical and leaves the namesake on the board.
- **Data ends at 2025.** Lahman has no 2026.

Regenerating data needs `pip install pandas pyreadr` and the Lahman tarball
from `codeload.github.com/cdalzell/Lahman/tar.gz/refs/heads/master`, extracted
so the `.RData` files sit in `lah/data/`.

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

Records are per-device. There is no sync and no backend, by design.

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
- **Run `node tests/run.js` before every commit.** 104 assertions, no
  dependencies, about six seconds. It loads `app.js` into a `vm` with a stub DOM
  rather than requiring any test scaffolding inside `app.js` — keep it that way.
  The last third of the suite walks all 247 data files and builds all 7,331
  category boards, so it catches data regressions as well as logic ones.
- Comments explain *why* a thing is unusual, not what the line does. Match that.
