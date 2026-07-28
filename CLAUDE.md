# Off the Board — project brief

A baseball leaderboard snake-draft game. Pick an era and a stat, players take
turns naming ballplayers, you score their rank on that leaderboard. Deep cuts
pay more than obvious ones.

Pure static site — HTML, CSS, one JS file, and a folder of JSON. No server, no
build step, no framework, no dependencies. It must stay that way.

---

## Immediate task

Get this deployed to GitHub Pages. It is built and working locally; it has
never been pushed.

**Before anything else, clean up a failed attempt.** A `git init` was
accidentally run in `/Users/carsondavis` (the home directory) instead of the
project folder. Verify and clean:

```bash
ls -d ~/.git 2>/dev/null && echo "STILL THERE" || echo "clean"
```

If it is still there, `rm -rf ~/.git`. That removes only git metadata — no user
files are touched. Also confirm with the user that no repo named
`off-the-board` on GitHub contains their home directory contents; if one does,
it must be deleted before anything is pushed.

**Then deploy.** The project should live at `~/Projects/off-the-board`,
unzipped from `~/Downloads/off-the-board-app.zip`. Verify location before
running any git command:

```bash
cd ~/Projects/off-the-board
pwd && ls index.html app.js sw.js data/manifest.json
```

All four must exist. Then:

```bash
touch .nojekyll          # 258 data files; Jekyll must not process them
git init -b main && git add . && git commit -qm "Off the Board"
```

Push and enable Pages (Settings → Pages → Deploy from a branch → `main` /
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
- **Names are plain ASCII.** "Jose Ramirez", not "José Ramírez". That is how
  Lahman ships them. Matching strips accents so typing either works.
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

## Known issue worth fixing early

`sw.js` is **cache-first for the app shell**, so once a browser installs the
service worker, `index.html`, `app.js` and `styles.css` are served from cache
and code changes never appear until the cache name changes.

Either bump `SHELL` (`otb-shell-v1` → `-v2`) on every deploy, or switch the
shell to network-first while leaving `/data/` cache-first — data files are
immutable, so caching those forever is correct and is what makes offline play
work. Network-first for the shell is the better fix.

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
- Comments explain *why* a thing is unusual, not what the line does. Match that.
