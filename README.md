# A Game of Numbers

A collection of baseball games built on the Lahman database. Everything runs in
the browser — no server, no accounts, no build step.

| Game | What it is |
| --- | --- |
| **Game 100** | Leaderboard snake draft. Pick an era and a stat, take turns naming players. The top 100 score their rank, 101–110 is a foul, 111 and beyond is a strike. Deep cuts pay more than obvious ones. |
| **162-0** | Spin a club and a ten-year window, take one of their players, repeat until you have a 21-man roster. Then it plays a season. |

Switch between them from the **Games** menu, top right.

## Play it locally

The app fetches JSON, so `file://` will not work. Serve the folder:

    cd a-game-of-numbers
    python3 -m http.server 8000

Then open <http://localhost:8000>.

## Put it online

**GitHub Pages** — push this folder to a repo, then Settings → Pages → deploy
from `main` / root. Live in about a minute at
`https://<you>.github.io/<repo>/`.

**Netlify Drop** — drag the folder onto <https://app.netlify.com/drop>.

Once it is on https, open it on your phone and use *Add to Home Screen*. The
service worker caches the app and every era you have opened, so it keeps
working with no signal.

## Records

Stored in `localStorage`, per device and per browser. There is no account and no
server, so nothing you play is sent anywhere — which also means records do not
follow you between devices on their own. To move them: **Export records** on one,
AirDrop or email yourself the file, **Import records** on the other. Merging is
by game timestamp, so importing twice is harmless and neither side loses
anything.

## Teams

Play all of baseball, or narrow it to one club or several. Two modes, because
they answer different questions: **what they did there** is the club's own
record book, where only what a player did in that shirt counts; **anyone who
played there** takes everyone who passed through and uses their whole line for
the era. Randy Johnson is 86 strikeouts to the Giants under the first and 3,749
under the second.

## Series

Play a single game or a series: best of N, first to N wins, first to N points,
or a fixed number of games. The era and the category can be re-rolled between
games. Series show up in Records with their format, length and result.

## The data

`data/` holds 124 ready-made ranges: every season 1920–2025, every decade, and
seven spans, each with a regular-season and a postseason file. Up to 36
categories per range.

Any other span — 1963–1977, say — is built in the browser from the season
files, because 1920–2025 contains 5,671 possible ranges and precomputing them
is not sensible. The aggregation mirrors `build_lists.py` exactly; the test
suite rebuilds every shipped decade and span through it and compares them cell
for cell.

Built from the Lahman database with `build_lists.py`:

    pip install pandas pyreadr
    curl -L -o lahman.tar.gz \
      https://codeload.github.com/cdalzell/Lahman/tar.gz/refs/heads/master
    mkdir -p lah && tar xzf lahman.tar.gz -C lah --strip-components=1
    python3 build_lists.py

Notes on the numbers:

- **Ties share a rank.** Two players with identical totals are worth the same,
  rather than one arbitrarily outranking the other.
- **Depth adapts.** Lists are *ranked* 500 deep where that is meaningful and
  stop early where it is not — 1920 only had 116 players who hit a home run all
  year. That depth is not the scoring cut: only the top 100 ever score. It
  exists so a strike can still tell you the man you named ranked 153rd.
- **Four categories are era-gated** because the data is not there before a
  certain point: GIDP from 1940, Caught Stealing from 1951, Intentional Walks
  from 1955. All-Star selections start in 1933, Cy Youngs 1956, Gold Gloves
  1957, Silver Sluggers 1980.
- **ERA−** is league-relative with no park adjustment, so it will not match
  FanGraphs exactly. 100 is average and lower is better.
- **Names are plain ASCII** — "Jose Ramirez", not "José Ramírez". Typing either
  works; accents are stripped when matching.
- Lahman ends at **2025**, so there is no 2026.
