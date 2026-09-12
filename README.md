# Operation Iraqi Freedom — Task Force Talon

**Play it: https://82alltheway504-boop.github.io/Iraqi-freedom/**
(turn your phone sideways, then Share → Add to Home Screen to install it)

A **turn-based** tactical strategy prototype in the Command & Conquer tradition,
set during the 2003 advance up Highway 8. Playable in a browser, built
phone-first for touch.

Every unit spends a pool of action points on movement *and* fire, so a turn is
one plan per unit rather than one action per unit. Three separate economies —
water for infantry, fuel for vehicles and aircraft, oil for everything you
build — mean the army you can keep is a direct statement about how much ground
you hold.

**Everything in it is original and generated at runtime.** There are no image
files, no audio files, no fonts, no libraries. Every tank, soldier and building
is drawn in code with Canvas2D when the page loads; every gunshot, explosion and
note of the score is synthesised with the Web Audio API. The whole game is a few
hundred kilobytes of plain text and it runs offline.

![The bridgehead](docs/shots/battle.jpg)

## Play it

```bash
npm start            # serves on http://localhost:8080
```

Any static file server will do — there is no build step. Open it on a phone,
turn the device sideways, and add it to your home screen to run it fullscreen
as an installed app.

### One self-contained file

```bash
npm run bundle       # -> dist/task-force-talon.html
```

Produces a single 362 KB HTML file with the entire game inside it — all 30
modules, the stylesheet, and the icon as a data URI. It runs from a `file://`
URL with no server, no network and no module loader; `npm run test:bundle`
asserts exactly that, including that the page issues zero network requests.

The bundler validates every import against the exporting module's actual
export list and fails the build on a mismatch. That guard exists because the
first version silently dropped `WHEEL` and `TRACK` from
`export const FOOT = 0, WHEEL = 1, TRACK = 2;` — it captured only the first
declarator — so wheeled and tracked units got `loco === undefined`, terrain
lookup returned `undefined`, and unit positions became `NaN`. Nothing threw;
the vehicles just quietly stopped existing in space.

### Installing it on a phone

The app installs from any HTTPS host. `.github/workflows/pages.yml` deploys it
to GitHub Pages on every push, including a guard that fails the build if an
absolute path ever creeps in — a Pages project site serves from `/<repo>/`, so
a leading-slash path would 404 there while working perfectly in local testing.

The workflow deploys by pushing the built site to a `gh-pages` branch rather
than through the Pages deployment API. The API route requires the Actions token
to be able to create the Pages site, which it is not permitted to do
(`Resource not accessible by integration`) even on a public repository;
pushing a branch needs only `contents: write`. Pushing a `gh-pages` branch to
a public repo also provisions Pages by itself, so this works from a cold start
without anyone touching repository settings.
`npm run test:pwa` verifies the whole install path from a subdirectory: the
manifest the browser actually parsed, the service worker's registered scope,
every icon iOS and Android ask for, and that the game still plays with the
network switched off.

Note that a service worker needs a secure context. Over HTTPS or on
`localhost` you get offline play; over a plain `http://192.168.x.x` LAN address
you still get a home-screen icon and fullscreen, but no offline caching.

## Controls

Designed so that one tap always does the obvious thing.

| Gesture | Action |
|---|---|
| Tap your unit | Select it and light every tile it can still reach |
| Tap a lit tile | Move there, paying the action points it costs |
| Tap a bracketed enemy | Shoot it |
| Tap a garrisonable building | Move infantry inside |
| Drag | Look around, with a momentum flick on release |
| Pinch | Zoom about your fingers |
| Long press | Open the command bar for the selection |
| Long press, then drag | Box-select a group |
| Double tap a unit | Select every unit of that type on screen |
| Minimap | Tap or drag to jump the camera |
| END TURN | Hand over to the Guard, then take the next turn |

The action-point pips under the selection panel are the whole game in one
readout: while a unit has pips it can still do something, and `Space` jumps to
the next unit that does.

Landscape is the better way to play this, and the game says so on a portrait
phone — but it says it as a dismissible card, not a wall. Some browsers and
embedded frames never report landscape, and stranding the player behind an
orientation check is worse than a cramped layout. In portrait the production
rail becomes a side-scrolling strip along the bottom, the minimap floats
top-right, and the objectives list starts folded.

Mouse and keyboard work too: left-drag box-selects, right-click orders, the
wheel zooms, `Enter` ends the turn, `Space` cycles to the next unit with points
left, `A` attack, `C` capture, `F` build a field work, `G` garrison, `L`/`U`
load and unload, `R` resupply, `P` paradrop, `H` dig in, `Tab` shows weapon
ranges, `Ctrl+1..9` sets a control group.

## What is in the prototype

- **Mission 01, "Highway 8: Bridgehead"** — a 96×72 map of the Euphrates valley
  with a single bridge crossing, six objectives, two optional objectives, three
  counterattacks on a turn timer, and a full victory/defeat flow with an
  end-of-mission rating.
- **22 units and 20 structures** across two factions plus neutral civilian and
  capturable buildings, sorted into four tabs: infantry (including mortar,
  airborne and air-assault teams), vehicles, air, and field works.
- **Fortifications you build**: bunkers, gun outposts, gun towers, and barbed
  wire that stops foot and wheels and is crushed flat by anything tracked.
- **A ruleset with real depth**: action points, an armour-versus-damage-type
  counter matrix across 8 damage types and 6 armour classes, three economies
  with per-turn upkeep and recoverable starvation, entrenchment, building
  garrison, four veterancy ranks, and a Rules of Engagement meter.
- **A commander who ranks up**: 7 ranks from Lieutenant to Major General paying
  out skill points across a 9-perk tree in three branches, saved between
  sessions.
- **An opposing commander** that plays its whole turn in one pass, maintains a
  combined-arms force mix, garrisons the village, defends its perimeter, and
  holds a reserve while its scripted counterattacks are still running.

See [docs/DESIGN.md](docs/DESIGN.md) for the full design and the balance tables.

## A note on the setting

This is a military strategy game about a real war. It is built the way the
genre's better entries handle real conflicts: the opposing force is a military
one, every target is a military target, and there is no mechanic anywhere for
attacking people.

The **Local Support** meter is the design's answer to the subject matter rather
than an apology for it. A village sits astride the short route to the bridge.
Shooting your way through it is faster, and it costs you: Local Support falls,
income drops, and irregulars start turning out against you. The fastest path
through a built-up area is often the one that loses you the mission. That is a better strategy game *and*
a more honest one.

## Project layout

```
index.html            page shell        styles.css       interface styling
src/main.js           entry point       src/game.js      controller and loop
src/core/             maths, camera, unified touch/mouse input
src/world/            tile grid, A* pathfinding, fog of war
src/sim/              ruleset, unit definitions, entities, world, AI, effects
src/art/              procedural sprites, terrain painter, palette
src/audio/            synthesised sound effects and the generated score
src/render/           the renderer
src/ui/               HUD, minimap, overlays
src/missions/         mission 01 and its map
tools/                tests, dev server, screenshot and frame-rate harnesses
```

## Tests

The simulation deliberately contains no DOM access, so all of it runs headless.

```bash
npm test             # ruleset + systems + a full mission playthrough
npm run test:turns   # 47 checks on the turn ruleset alone
npm run test:browser # 5 viewports, the portrait nudge, and offline play
npm run test:touch   # real touch gestures: tap, drag, long press, pinch
npm run test:pwa     # installability: manifest, icons, SW scope, offline
npm run test:portrait # portrait and small-frame layout and playability
npm run perf         # measures real frame rate in Chromium at iPhone size
npm run shots        # captures screenshots of the running game
npm run balance      # regenerates the balance tables in docs/DESIGN.md
```

The browser tests need a server running (`npm start`, then point them at it
with `GAME_URL=http://localhost:8080`) and Playwright's Chromium.

`npm run test:turns` covers the ruleset itself: action points, the move-or-shoot
tension, mortar minimum range and set-up, fortifications and wire, air and lift
and paradrop, the three economies and starvation, entrenchment, engineers,
logistics, production over turns, defensive fire, and the commander perk tree.
`npm run test:sim` then turns two sides loose on each other and asserts the
outcomes the design promises — a march across the map around an obstacle, four
rifle squads losing to one tank, two AT teams beating it, a garrison shrugging
off small arms, collateral damage costing Local Support, a civilian building
never being a legal target, veterancy, capture income, and fog — and
`npm run test:mission` plays mission 01 from the opening move through to victory
and defeat.

`npm run test:browser` drives the real game in Chromium across five viewports
from an iPhone SE to a desktop and confirms it still loads and plays with the
network switched off. `npm run test:touch` fires real touches at the canvas to
verify tap-to-select, tap-to-move, tap-to-attack, drag, pinch, the palette and
END TURN. It picks its targets the way a thumb does: mobile browsers hit-test a
touch as a small disc and snap it to any clickable element inside it, so a point
`elementFromPoint` calls clear canvas can still be stolen by a HUD control a
dozen pixels away.

## Performance

Measured in headless Chromium at iPhone 14 Pro dimensions, where Canvas2D is
rasterised in **software** — a deliberately pessimistic floor, since a real
phone composites the canvas on the GPU.

| Scenario | Frame rate |
|---|---:|
| Normal play | 60 fps |
| 105-unit battle | 58–60 fps |
| 105-unit battle, zoomed fully in | 44 fps |

Turn resolution is the number a turn-based game lives or dies by, because it is
the pause after END TURN. With ~90 units on the map, every one of them pathing,
choosing a firing position and shooting, a whole side's turn resolves in **40 ms
for the player's side and 52 ms for the Guard's** — measured in the same
software rasteriser. Nobody waits. Effect density adapts to the measured frame
rate, so a weaker device loses smoke rather than responsiveness.

## Licence

Original work. All art, audio and code in this repository were authored here.
