# Multi-game shell — scope

Status: proposed, not built. Written 2026-07-28.

A Game of Numbers is becoming a collection. This describes the container that
holds Game 100, 162-0, and whatever comes next, and what it costs to get there.
It deliberately says nothing about 162-0's rules — the shell must not care.

---

## What exists now

`index.html` holds six `<section id="screen-*">` blocks. `show(name)` in
`app.js` toggles `.hidden` on each. `app.js` is a single 660-line file holding
state, data loading, the game engine, records and rendering, and it reaches the
DOM through `const $ = id => document.getElementById(id)` — roughly fifty
lookups against globally-unique IDs.

That last detail is the whole problem. Two games in one page means two sets of
element IDs, and `getElementById` is document-wide.

---

## Target layout

```
index.html            shell only: masthead, switcher, <main id="stage">
styles.css            shared tokens + shell chrome
shell.js              registry, switcher, hash routing, records namespacing
games/game100.js      today's app.js, wrapped
games/g1620.js        new
data/                 Game 100 leaderboards (unchanged)
data-1620/            162-0's data, whatever shape it needs
tests/run.js          extended to load the shell and each game
```

`app.js` disappears as a filename. Keep the file history by `git mv`-ing it to
`games/game100.js` rather than creating a new file.

## Game interface

Each game file registers one object. The shell never imports game internals and
a game never touches the masthead.

```js
Shell.register({
  id: 'game100',
  title: 'Game 100',
  tagline: 'Leaderboard snake draft',
  nav: [{id: 'setup', label: 'New game'},
        {id: 'records', label: 'Records'},
        {id: 'rules', label: 'Rules'}],
  async mount(stage, ctx){ /* build DOM into stage, wire, return */ },
  unmount(){ /* clear timers and listeners; the shell empties the stage */ },
  show(screenId){ /* the shell routes nav clicks here */ },
});
```

`ctx` carries `{records, route}` — see below.

## Scoped DOM lookups

The one invasive change. Inside each game, `$` resolves against that game's
root rather than the document:

```js
let root = null;
const $ = id => root.querySelector('#' + CSS.escape(id));
```

`mount(stage)` sets `root = stage`. Every existing `$('guess')` call then keeps
working unchanged, and two games can both have a `#guess` without colliding.
`document.querySelectorAll('#kind-set .pill')` — there are four of those in
`wire()` — becomes `root.querySelectorAll(...)`.

This is mechanical and fully covered by the existing test suite, which already
drives `app.js` through a stub DOM.

## Routing

Hash-based, no library:

```
#/game100          -> game's default screen
#/game100/records
#/1620/season
```

`hashchange` picks the game, unmounts the previous one, mounts the next. An
unknown or empty hash lands on the first registered game. The shell writes the
document title as `<game title> · A Game of Numbers`.

Deep links matter more than they look: it is how you send someone straight to a
game, and how the PWA remembers where it was.

## The switcher

Top right of the masthead, which is already `position:relative`, so it drops in
without touching the existing layout:

```
┌────────────────────────────────────────────┐
│ A GAME OF NUMBERS              [ Games ▾ ] │
│ Game 100                                   │
│ LEADERBOARD SNAKE DRAFT                    │
│ [New game] [Records] [Rules]               │
└────────────────────────────────────────────┘
```

A `<button aria-expanded>` toggling a `<ul role="menu">` of registered games,
current one marked `aria-current`. Closes on Escape, outside click, and
selection. Roving focus with arrow keys. At two games a segmented toggle would
be tempting, but a menu does not need redesigning at game five.

**Guard:** if a game is mid-play, switching must confirm first. Game 100 in
particular writes its record only in `finish()`, so navigating away mid-draft
silently loses the game. The shell asks `game.isDirty?.()` before unmounting.

## Records namespacing

Game 100 keeps `offtheboard:records` — changing it orphans every saved game on
every device, and that constraint outlives the rename. New games use
`agon:<id>:records`. The shell hands each game a small accessor:

```js
ctx.records = {load(), save(list), export(), import(file)}
```

with the legacy key hardcoded as Game 100's alias. Export filenames stay
per-game. Import still merges by `ts` and must keep doing so.

Worth deciding early: whether the Records screen stays per-game or becomes a
shell-level screen that aggregates across games. Per-game is much simpler and
is assumed here.

## Service worker

One change beyond adding the new files to `FILES`: the data test is currently

```js
url.pathname.includes('/data/')
```

which will not match `data-1620/`. It becomes

```js
/\/data[^/]*\//.test(url.pathname)
```

so every game's immutable data folder stays cache-first while all shell and
game code stays network-first. Bump `SHELL` when this ships; leave `DATA` alone.

## Tests

`tests/run.js` currently loads `app.js` whole and reads its top-level bindings
back out of the vm. That approach survives: it loads `shell.js` plus each
registered game the same way. Add:

- mount → unmount → mount leaves no stray timers or listeners
- two games mounted in sequence do not collide on element IDs
- routing: unknown hash falls back, deep link lands on the right screen
- the dirty-game guard fires before an unmount that would lose a record
- records: Game 100 still reads and writes the legacy key

## Cost and order

| Step | Notes |
|---|---|
| 1. Scope `$` to a root, `git mv app.js games/game100.js` | Mechanical, existing 104 assertions cover it |
| 2. `shell.js` — registry, mount/unmount, hash routing | The real work |
| 3. Switcher UI + keyboard and dirty-game guard | Small, fiddly to get accessible |
| 4. Records namespacing with the legacy alias | Small, but easy to break saved data |
| 5. Service worker glob + `SHELL` bump | Trivial, easy to forget |
| 6. Extend the suite | |

Steps 1–6 are worth doing **before** 162-0 exists, not alongside it. Building
the second game inside today's single-game structure and refactoring afterwards
means doing step 1 twice, on twice as much code.

Nothing here needs a build step, a framework, or a dependency.
