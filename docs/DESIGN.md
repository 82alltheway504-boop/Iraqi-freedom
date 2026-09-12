# Design — Task Force Talon

How the game works and why it works that way. The balance tables at the end are
generated straight from the source (`npm run balance`), so they cannot drift.

---

## 1. The design problem

Command & Conquer's loop is harvest → build → tech → assault, and it is close to
perfect. The failure mode of everything built on it is **mass beats mix**:
whoever can afford the most of the single best unit wins, and the map is
scenery. On a phone it has a second failure mode — real-time micromanagement
through a thumb is miserable.

So this is **turn-based**, and four systems exist specifically to stop mass from
beating mix.

| System | What it punishes | What it rewards |
|---|---|---|
| Action points | Moving and shooting with everything, every turn | Choosing what each unit is for this turn |
| Armour vs damage type | Massing one unit | Combined arms |
| Three separate economies | Building whatever you can afford | Taking and holding ground |
| Cover, entrenchment, garrison | Fighting in the open | Reading the ground |

A fifth — **Local Support** — exists because of the setting, and is discussed
in §7.

---

## 2. The turn

One turn is one decision per unit, not one action per unit. Every unit has a
pool of **action points** that pays for both movement and fire:

- A tile of movement costs its terrain cost — 1 on road, 1.6 in sand, 2.4 in a
  palm grove.
- A shot costs that weapon's `attackAp` — 2 for a machine gun, 3 for a tank's
  main gun, 6 for a jet's ordnance.

A rifle squad has 5 points. It can walk five tiles of road, or walk one tile and
fire twice, or stand still and fire twice while digging in. That is the whole
tension: **the turn is the resource**, and every unit spends it on exactly one
plan.

The turn start resolves in a fixed order, and the order is load-bearing:

```
income → upkeep → starvation → action points → production → construction → entrench → rearm
```

Income lands *before* upkeep is charged, so a water plant captured last turn
pays for the infantry it was captured to feed. Entrenchment is applied after
action points are restored, so a unit that sat still is already dug in when its
turn opens.

Anything that neither moved nor fired counts as holding position, which is what
feeds entrenchment — there is no "fortify" button to remember.

---

## 3. The counter matrix

Every point of damage in the game goes through one function
(`computeDamage` in `src/sim/rules.js`). Nothing bypasses it.

```
damage = base
       × DAMAGE_TABLE[damageType][armourClass]
       × attacker veterancy × defender veterancy
       × commander perks
       × (garrison multiplier | 1 − (terrain cover + entrenchment) × armour's cover scaling)
       × starvation penalty
```

The table is the design. A rifle squad does **4%** of its damage to a main
battle tank — not "reduced", effectively nothing. A tank's sabot round does
**22%** to infantry. Neither unit can solve the other, and that is the point.

Three consequences worth stating plainly:

**Tanks carry a coaxial machine gun.** Once sabot was made near-useless against
infantry, four rifle squads versus one tank of equal cost became a stalemate,
which felt terrible. Real tanks have a coax, so the tanks got one, and units
pick whichever mount actually hurts what they are shooting at
(`Unit.pickWeapon`, scored by damage per action point against the target's
armour).

**The AT team's missile is worth a whole turn.** It has 4 points and the launcher
costs 3, so an AT team fires once per turn and does nothing else. The warhead is
sized for that: two teams working together kill a main battle tank in about six
turns and expect to lose one of their own doing it. A weaker warhead made armour
unanswerable by infantry, which is the exact failure this table exists to
prevent.

**Mortars break works, not tanks.** Mortar fire is the only indirect weapon:
it arcs over walls, needs no line of sight, has a 3-tile *minimum* range, and
cannot move and fire in the same turn. Against a fortification it is ×1.25;
against heavy armour ×0.25. It is the answer to a dug-in position and useless
against the tank parked behind it.

### Verified in tests

`tools/simtest.mjs` plays the fights out turn by turn and asserts the intended
outcome rather than the numbers, so a rebalance that breaks the design fails
the build:

- 4 rifle squads versus 1 tank → **the tank wins**, barely scratched.
- 2 AT teams versus 1 tank of comparable cost → **the AT teams win**.
- A rifle squad firing at a garrisoned militia for five turns → occupant
  **untouched**. Bullets do not clear buildings.

---

## 4. Three economies

One resource pool lets you buy your way out of any mistake. Three pools, each
tied to a category, mean your army has a shape you have to maintain.

| Resource | Buys and feeds | Comes from |
|---|---|---|
| **Water** | Infantry and mortar teams | Water plants |
| **Fuel** | Vehicles and aircraft | Fuel depots |
| **Oil** | Every structure and fortification | Oil derricks |

Everything costs its resource twice: once to build, then again **every turn** as
upkeep. Sites are on the map and capturable, so the army you can keep is a
direct statement about how much ground you hold.

Running dry does **not** delete anything. A side that cannot pay is *starving*:

- action points are halved,
- damage drops to ×0.75,
- every unpaid unit loses 6% of its health per turn.

It is a slow, visible, recoverable disaster — go and take a water plant and the
army comes back. Deleting units for an accounting failure is the version of this
rule that makes people stop playing.

---

## 5. Ground: cover, entrenchment, garrison

Terrain grants a flat damage reduction to whatever stands on it, scaled by
armour class: infantry gets the full value, vehicles 40%, structures none.
Rubble is 30% cover and is *created* by destroying buildings, so a firefight
physically produces new defensive terrain as it goes.

**Entrenchment** rewards patience. A unit that spends a whole turn neither
moving nor firing digs in half a level, to a maximum of two, each level worth
18% damage reduction. Moving or firing gives all of it back immediately. A line
that holds for two turns is 36% tougher than the same line that shuffled.

**Garrison** is the sharper version of the same idea. Infantry can occupy any
civilian building. Occupants cannot be reached directly: damage only bleeds in
through the structure, at 20% of the hit, re-weighted by how suitable the weapon
is.

| Weapon against a garrison | Effect |
|---|---|
| Small arms | ×0.12 — walls beat bullets |
| Armour-piercing | ×0.25 — punches through, hits one man |
| Rocket | ×2.20 — the correct answer |
| High explosive | ×2.60 — the correct answer |
| Mortar | ×2.80 — the correct answer, from out of sight |
| Air ordnance | ×3.00 — the very correct answer |

So a garrisoned RPG team trades evenly with a main battle tank, and the only
ways to shift it are explosives, mortars, air, or levelling the building — which
in a village costs Local Support. Every option has a price.

When a garrisoned building is destroyed, occupants are ejected at 35% health
rather than killed. Killing them outright is the genre standard and it is a
rage-quit moment.

**Field works** are the player's own version. An engineer can lay them, and
they behave as their name suggests: a *fortification* is a garrisonable bunker,
a *gun outpost* and *gun tower* shoot back on the enemy's turn, and *barbed
wire* sits on its own grid layer — impassable to foot and wheels, and crushed
flat by anything tracked. Wire does not stop a tank; it decides where the tank
has to go.

---

## 6. Air

Aircraft are a third category, not fast tanks.

- They ignore terrain entirely and stack over ground units.
- They carry the largest action-point pools on the map (a jet has 20) and spend
  them crossing it.
- A jet has a **sortie count**. When its ordnance is gone it must return to an
  airfield to rearm — air power is a scheduled event, not a permanent presence.
- Anti-air does ×1.00 to aircraft and ×0.05 to heavy armour. An AA vehicle
  parked over a position is a no-fly sign and nothing else.
- A gunship can **lift** one air-assault squad and put it down anywhere;
  airborne infantry can **drop** onto any visible tile.

The counter to air is not "bring your own air", it is "bring AA and make the
sortie expensive".

---

## 7. Rules of Engagement

The mechanic the setting demanded.

Mission 01's short route to the bridge runs through an inhabited village.
Damaging civilian structures costs **Local Support**: 2.2 points per 100 damage,
12 points for levelling one outright. Support recovers 1.5 points a turn once
you stop.

| Support | Tier | Income |
|---|---|---:|
| ≥ 80% | Cooperative | ×1.10 |
| ≥ 50% | Wary | ×1.00 |
| ≥ 25% | Hostile | ×0.92 |
| < 25% | Insurgent | ×0.85 |

Two design rules keep it honest:

1. **A civilian building is never a legal target.** It cannot be selected as
   one, by you or by the Guard. Every point of collateral damage in the game is
   splash from something you chose to fire near it. This is asserted by a test.
2. **It is never only a penalty.** High support pays an income bonus, so the
   restrained route is a *strategy*, not a tax.

---

## 8. Progression

Two separate ladders, because they reward different things.

**Units earn veterancy** by killing things — one XP per 100 supply of value
destroyed. Four ranks, up to ×1.50 damage and ×0.70 damage taken, and the top
two ranks grant a permanent extra action point. A damaged veteran pulled out of
contact is worth more than a fresh replacement, so there is a continuous
incentive to withdraw rather than trade.

**You earn rank** for the things a commander decides: 3 XP a turn survived, 8×
the value of each kill, 40 for a capture, 90 for an objective. Rank from
Lieutenant to Major General pays out **skill points**, spent in a small,
opinionated tree with prerequisites:

| Branch | Perks |
|---|---|
| **Support** | Logistics Corps (+15% income/rank) → Field Engineering (works cost −20%/rank, and instant at rank 2); Strict Rationing (−12% upkeep/rank) |
| **Firepower** | Marksmanship (+10% infantry damage/rank); Gunnery Training (+10% vehicle damage/rank) → Close Air Support (+15% air damage and an extra sortie per rank) |
| **Manoeuvre** | Forced March (+1 infantry AP/rank) → Hardened Troops (−6% damage taken/rank); Motor Pool Discipline (+1 vehicle AP/rank) |

Every perk changes a number the player can already see on the HUD, so the
effect of a choice is legible rather than a hidden modifier. Progress persists
to `localStorage` between sessions, and can be respecced.

---

## 9. Mission 01 — "Highway 8: Bridgehead"

A 96×72 map of the Euphrates valley. The river runs north to south with a
single road bridge; Highway 8 crosses the map diagonally. The bridge being the
only crossing is asserted by a test that seals it and confirms no route exists
for any locomotion class.

The mission is the classic campaign-opener arc, with each beat teaching one
system and then immediately asking you to use it under pressure.

| Beat | Teaches | Pressure |
|---|---|---|
| 1. Supply | The three economies | Your infantry drink 19 water a turn and you hold 400 |
| 2. Recon | Movement, action points, fog | None — this is the tutorial breath |
| 3. Suppress | The counter matrix | Two dug-in posts with escorts |
| 4. Deploy | Base building, upkeep | The Guard commander wakes up |
| 5. Hold | Entrenchment and field works | Counterattacks on turns +4, +10, +17 |
| 6. Assault | Everything at once | AT guns covering the bridge |

The **first** beat is new to the turn-based version and it exists because the
first build of this mission was quietly unwinnable in a way that only showed up
in a full playthrough: the objectives told you to clear two fortifications
first, and eight infantry drinking 19 water a turn against a 200-water stock
starved before they could reach the water plant. The supply objective is now
active from turn one, the stock is 400, and the opening radio call states the
arithmetic out loud.

The third beat is the one the fighting turns on. Rifle squads do 10% of their
damage to a structure; mortars do 125% to a fortification and can fire from
behind cover. Players who bring the right tool clear it in two turns. Players
who do not, cannot — and the radio call tells them so before they try.

**Objectives are evaluated independently every turn**, not run as a strict state
machine. A player who captures the depot before clearing the observation posts
gets credit the moment they do it. The briefing suggests an order; it does not
enforce one.

Two optional objectives (keep Local Support above 50%, capture the fuel depot)
feed the end-of-mission rating, which weighs finishing, your kill-to-loss ratio,
and the *lowest* Local Support you ever reached — you cannot shell the village
and then wait for the meter to recover.

### The opposing commander

The Guard plays its whole turn in one call, and does not cheat with vision — it
reacts to what its own units and structures can see. Each unit picks the single
best action available to it, heaviest units first, in a deliberate order:

- Shoot anything it can already kill this turn.
- Capture anything undefended within reach.
- Otherwise close on the objective, preferring a tile that puts the target
  inside its own weapon range and outside the target's.

It maintains a target force mix by weight and builds whatever it is shortest of,
garrisons the village buildings overlooking the approaches, and holds a reserve
while the scripted counterattacks are still running so that pressure arrives in
waves rather than as one continuous grind.

---
## 10. Assets

No files. All of it is generated at load.

**Sprites** are drawn with Canvas2D into offscreen canvases at 2× supersample.
Vehicles render hull and turret separately so turrets track independently;
infantry get two walk frames. Structures are built from a shared vocabulary of
lit plates, seams, sandbag rings, roof clutter and hardstanding.

**Terrain** is painted per tile into 16×16-tile chunks, cached with an LRU.
Detail is therefore free at runtime: a chunk is one `drawImage` per frame no
matter how much work went into it, and chunks are only repainted when the
terrain actually changes — such as a destroyed building collapsing into rubble.

The first version varied sand colour per tile and read as a checkerboard. The
fix was to make the base flat and add a separate **dune layer**: two octaves of
smooth interpolated value noise sampled once per tile and upscaled bilinearly,
continuous across chunk boundaries. Roads got the same treatment, plus
distance-to-segment painting so diagonals have clean edges instead of a
staircase of blocks.

**Sound** is synthesised. Gunfire is a filtered noise transient over a sub-thump
so it has weight on a phone speaker; cannon fire is a pitch-swept sine under a
noise burst through a closing low-pass; explosions layer both with a
convolution reverb whose impulse response is itself generated noise. Everything
is placed in stereo and attenuated by distance from the camera, and throttled
per cue type so a big battle cannot produce 200 simultaneous voices.

**The score** is generated, not looped. A lookahead scheduler writes notes a bar
at a time in Hijaz mode on D — the augmented second between E♭ and F♯ is what
gives it its character. Four layers cross-fade against how much combat is on
screen: a bowed drone always present, a doumbek-style hand drum, a plucked oud
line for quiet stretches, and low brass stabs with a war drum that fade in as
the fighting escalates.

---

## 11. Built for a phone

- **DOM HUD, not canvas.** Crisp text at any pixel ratio, real hit targets,
  safe-area insets around the notch, and no font rasterisation in the hot loop.
- **One tap does the obvious thing.** Tap a unit to select it and light every
  tile it can still reach; tap a lit tile to go there; tap a bracketed enemy to
  shoot it. No mode switching for ordinary play.
- **Turns forgive a thumb.** Nothing is lost to a mis-tap under time pressure,
  which is the failure mode of real-time strategy on a touchscreen.
- **The simulation does no work between turns.** Resolution is instant on the
  tap; the frame loop only animates what already happened, so a slow device
  plays identically to a fast one.
- **Device pixel ratio capped at 2.** A 3× backing buffer on a phone is 2532×1170
  and the cost is entirely fill rate.
- **Adaptive effect quality.** If the measured frame rate drops below 42 for two
  consecutive seconds, particle density falls. A weaker device loses smoke
  rather than responsiveness.
- **No backdrop blur.** Blurring a panel over a continuously repainting canvas
  forces a recomposite every frame; it was one of the most expensive things on
  screen for no visual gain.

### What the optimisation pass actually found

Profiling the render passes showed all of them together taking under 2 ms while
frames took 44 ms. The time was not in JavaScript at all — it was raw fill rate
in the rasteriser, dominated by large soft additive particles. The fixes that
mattered:

| Change | Effect |
|---|---|
| Bake radial gradients into sprites once | 13 → 60 fps at rest |
| Batch particle passes by composite mode | fewer state changes per frame |
| Rebuild the fog raster only when fog changes; blit only the visible region | — |
| Cap device pixel ratio at 2 | roughly halves fill cost |
| Adaptive particle density | 25 → 30 fps floor under load |

Building a `createRadialGradient` per particle per frame is the single most
expensive thing a Canvas2D game can do. It was a 4.5× frame-rate difference.

---

## Appendix — balance tables


## Categories

| Category | Upkeep paid in | Notes |
|---|---|---|
| Infantry | Water | Dismounted troops and mortar teams. Drink water. |
| Vehicles | Fuel | Wheeled and tracked. Burn fuel. |
| Air | Fuel | Jets and helicopters. Burn fuel hard. |
| Works | Oil | Buildings and fortifications. Consume oil. |

## Damage type vs armour class

| Damage type | Infantry | Light Armour | Heavy Armour | Structure | Air | Fortification |
|---|---:|---:|---:|---:|---:|---:|
| Small Arms | 1.00 | 0.30 | 0.04 | 0.10 | 0.15 | 0.08 |
| Autocannon | 0.85 | 0.90 | 0.25 | 0.35 | 0.60 | 0.30 |
| Armour-Piercing | 0.22 | 1.00 | 1.00 | 0.55 | 0.00 | 0.45 |
| Rocket | 0.55 | 1.05 | 0.95 | 0.85 | 0.10 | 0.80 |
| High Explosive | 1.00 | 0.75 | 0.40 | 1.00 | 0.00 | 0.70 |
| Anti-Air | 0.30 | 0.25 | 0.05 | 0.10 | 1.00 | 0.10 |
| Ordnance | 1.00 | 1.00 | 0.80 | 0.90 | 0.00 | 1.10 |
| Mortar | 1.10 | 0.55 | 0.25 | 0.85 | 0.00 | 1.25 |

## Units

Damage per turn assumes the unit stands still and spends every point firing.

### Coalition Task Force

| Unit | Category | Cost | Upkeep | Build | HP | Armour | Move | AP | Vision | Weapon | Damage | Range | Shot cost | Per turn |
|---|---|---:|---:|---:|---:|---|---|---:|---:|---|---:|---:|---:|---:|
| Light Infantry | Infantry | 40 WTR | 2 | 1t | 110 | Infantry | foot | 6 | 8 | Small Arms | 10×2 | 4 | 2 | 60 |
| Rifle Squad | Infantry | 60 WTR | 3 | 1t | 165 | Infantry | foot | 5 | 7 | Small Arms | 13×3 | 5 | 2 | 78 |
| AT Team | Infantry | 80 WTR | 4 | 1t | 130 | Infantry | foot | 4 | 8 | Rocket | 105 | 2–7 | 3 | 105 |
| Mortar Team | Infantry | 85 WTR | 4 | 1t | 120 | Infantry | foot | 4 | 6 | Mortar | 62 | 3–9 | 3 | 62 |
| Airborne Infantry | Infantry | 90 WTR | 4 | 2t | 150 | Infantry | foot | 5 | 8 | Small Arms | 15×3 | 5 | 2 | 90 |
| Air Assault Infantry | Infantry | 95 WTR | 4 | 2t | 155 | Infantry | foot | 6 | 7 | Small Arms | 17×3 | 5 | 2 | 153 |
| Combat Engineer | Infantry | 70 WTR | 3 | 1t | 115 | Infantry | foot | 5 | 6 | — | — | — | — | — |
| Scout Humvee | Vehicles | 70 FUE | 4 | 1t | 260 | Light Armour | wheel | 10 | 11 | Small Arms | 12×2 | 5 | 2 | 120 |
| M2 Dragoon IFV | Vehicles | 130 FUE | 7 | 2t | 520 | Light Armour | track | 8 | 9 | Autocannon | 26×2 | 6 | 2 | 208 |
| M1 Anvil MBT | Vehicles | 200 FUE | 10 | 3t | 1000 | Heavy Armour | track | 6 | 9 | Armour-Piercing | 125 | 7 | 3 | 250 |
| ↳ | | | | | | | | | | coaxial | 10×2 | 5 | 2 | 60 |
| Avenger AA | Vehicles | 120 FUE | 6 | 2t | 320 | Light Armour | wheel | 7 | 9 | Anti-Air | 46 | 7 | 2 | 138 |
| Logistics Truck | Vehicles | 90 FUE | 4 | 1t | 300 | Light Armour | wheel | 9 | 7 | — | — | — | — | — |
| Gunship Helicopter | Air | 220 FUE | 14 | 3t | 340 | Air | air | 12 | 12 | Rocket | 58 | 6 | 3 | 232 |
| Strike Jet | Air | 300 FUE | 20 | 3t | 240 | Air | air | 20 | 13 | Ordnance | 115 | 5 | 6 | 345 |

### Republican Guard

| Unit | Category | Cost | Upkeep | Build | HP | Armour | Move | AP | Vision | Weapon | Damage | Range | Shot cost | Per turn |
|---|---|---:|---:|---:|---:|---|---|---:|---:|---|---:|---:|---:|---:|
| Militia Squad | Infantry | 35 WTR | 2 | 1t | 120 | Infantry | foot | 5 | 6 | Small Arms | 10×3 | 4 | 2 | 60 |
| RPG Team | Infantry | 65 WTR | 3 | 1t | 120 | Infantry | foot | 4 | 7 | Rocket | 62 | 1–6 | 3 | 62 |
| Guard Mortar | Infantry | 80 WTR | 4 | 1t | 115 | Infantry | foot | 4 | 6 | Mortar | 55 | 3–8 | 3 | 55 |
| Technical | Vehicles | 60 FUE | 3 | 1t | 200 | Light Armour | wheel | 11 | 9 | Small Arms | 11×2 | 5 | 2 | 110 |
| Saqr IFV | Vehicles | 115 FUE | 6 | 2t | 420 | Light Armour | track | 8 | 8 | Autocannon | 21×2 | 6 | 2 | 168 |
| Asad MBT | Vehicles | 175 FUE | 9 | 3t | 830 | Heavy Armour | track | 6 | 8 | Armour-Piercing | 105 | 6 | 3 | 210 |
| ↳ | | | | | | | | | | coaxial | 9×2 | 5 | 2 | 54 |
| Flak Track | Vehicles | 110 FUE | 6 | 2t | 340 | Light Armour | wheel | 7 | 9 | Anti-Air | 42 | 7 | 2 | 126 |
| Guard Gunship | Air | 200 FUE | 13 | 3t | 310 | Air | air | 11 | 11 | Rocket | 52 | 6 | 3 | 156 |

## Structures

| Structure | Faction | Cost | Upkeep | Build | HP | Size | Notes |
|---|---|---:|---:|---:|---:|---|---|
| Command Post | CTF | 400 OIL | 0 | 2t | 3000 | 4×4 | build radius 16 |
| Barracks | CTF | 120 OIL | 4 | 1t | 1200 | 3×3 | trains 5 |
| Motor Pool | CTF | 200 OIL | 7 | 2t | 1800 | 4×3 | trains 5, needs barracks |
| Airfield | CTF | 280 OIL | 10 | 2t | 1500 | 5×4 | trains 4, needs motor_pool |
| Fortification | CTF | 60 OIL | 1 | 1t | 900 | 2×2 | garrison 2 |
| Gun Outpost | CTF | 90 OIL | 3 | 1t | 750 | 2×2 | shoots back |
| Gun Tower | CTF | 150 OIL | 5 | 1t | 900 | 2×2 | needs barracks, shoots back |
| Barbed Wire | CTF | 25 OIL | 0 | 1t | 260 | 1×1 | obstacle |
| Guard Command Post | RG | 400 OIL | 0 | 2t | 2600 | 4×4 | build radius 14 |
| Guard Barracks | RG | 110 OIL | 4 | 1t | 1100 | 3×3 | trains 3 |
| Guard Motor Pool | RG | 190 OIL | 7 | 2t | 1700 | 4×3 | trains 4 |
| Guard Airstrip | RG | 260 OIL | 10 | 2t | 1400 | 5×4 | trains 1 |
| Guard Bunker | RG | 90 OIL | 3 | 1t | 900 | 2×2 | shoots back |
| Guard Gun Tower | RG | 150 OIL | 5 | 1t | 850 | 2×2 | shoots back |
| Guard Wire | RG | 25 OIL | 0 | 1t | 260 | 1×1 | obstacle |
| Fuel Depot | CIV | — | 0 | 1t | 800 | 3×2 | capturable, +22 FUE/turn |
| Water Plant | CIV | — | 0 | 1t | 950 | 3×3 | capturable, +24 WTR/turn |
| Oil Derrick | CIV | — | 0 | 1t | 850 | 2×2 | capturable, +20 OIL/turn |
| Residential Block | CIV | — | 0 | 1t | 900 | 2×2 | garrison 2, civilian |
| Municipal Hall | CIV | — | 0 | 1t | 1300 | 3×3 | garrison 3, civilian |

## Terrain

Movement costs are action points per tile. Air ignores the table entirely.

| Terrain | Foot | Wheel | Track | Cover | Blocks sight |
|---|---|---|---|---:|---|
| sand | 1.00 | 1.15 | 1.00 | 0% | no |
| road | 0.90 | 0.70 | 0.80 | 0% | no |
| scrub | 1.10 | 1.40 | 1.10 | 10% | no |
| palm | 1.30 | — | 1.70 | 25% | yes |
| rubble | 1.45 | — | 1.60 | 30% | no |
| berm | — | — | — | 0% | yes |
| water | — | — | — | 0% | no |
| canal | 2.20 | — | — | 15% | no |

## Supply

| Resource | Pays for | Running out |
|---|---|---|
| Fuel | undefined | see below |
| Water | undefined | see below |
| Oil | undefined | see below |

A side that cannot pay its upkeep is starving: action points are halved (×0.5), damage drops to ×0.75, and every unpaid unit loses 6% of its health each turn. Nothing is deleted — take a supply site back and the army recovers.

## Digging in

A unit that neither moves nor fires entrenches 0.5 levels per turn to a maximum of 2, worth 18% damage reduction per level. Moving or firing gives all of it back.

## Veterancy

| Rank | XP | Damage | Damage taken | Vision | Bonus AP |
|---|---:|---:|---:|---:|---:|
| Regular | 0 | ×1.00 | ×1.00 | ×1.00 | 0 |
| Veteran | 2 | ×1.15 | ×0.90 | ×1.05 | 0 |
| Hardened | 6 | ×1.30 | ×0.80 | ×1.10 | 1 |
| Elite | 14 | ×1.50 | ×0.70 | ×1.20 | 1 |

## Commander ranks

Experience comes in at 3/turn plus 8× the value of each kill, 40 a capture and 90 an objective.

| Rank | XP | Skill points |
|---|---:|---:|
| Lieutenant | 0 | 1 |
| Captain | 120 | 1 |
| Major | 320 | 1 |
| Lieutenant Colonel | 640 | 2 |
| Colonel | 1100 | 2 |
| Brigadier General | 1750 | 2 |
| Major General | 2600 | 3 |

## Perks

| Perk | Branch | Ranks | Needs | Effect |
|---|---|---:|---|---|
| Logistics Corps | Support | 3 | — | Every resource site yields +15% per rank. |
| Strict Rationing | Support | 2 | — | Upkeep costs fall 12% per rank. |
| Field Engineering | Support | 2 | Logistics Corps 1 | Fortifications and structures cost 20% less oil per rank, and build in one turn. |
| Marksmanship | Firepower | 3 | — | Infantry damage +10% per rank. |
| Gunnery Training | Firepower | 3 | — | Vehicle damage +10% per rank. |
| Close Air Support | Firepower | 2 | Gunnery Training 1 | Aircraft damage +15% per rank and one extra sortie. |
| Forced March | Manoeuvre | 2 | — | All infantry gain +1 action point per rank. |
| Motor Pool Discipline | Manoeuvre | 2 | — | All vehicles gain +1 action point per rank. |
| Hardened Troops | Manoeuvre | 3 | Forced March 1 | All units take 6% less damage per rank. |

## Garrison

Damage bleeding into occupants: 20% of the hit on the structure, then:

| Damage type | Multiplier vs occupants |
|---|---:|
| Small Arms | ×0.12 |
| Autocannon | ×0.40 |
| Armour-Piercing | ×0.25 |
| Rocket | ×2.20 |
| High Explosive | ×2.60 |
| Anti-Air | ×0.35 |
| Ordnance | ×3.00 |
| Mortar | ×2.80 |

## Cover effectiveness by armour class

| Armour | Fraction of terrain cover applied |
|---|---:|
| Infantry | 100% |
| Light Armour | 40% |
| Heavy Armour | 35% |
| Structure | 0% |
| Air | 0% |
| Fortification | 0% |

## Local Support tiers

Starts at 100%, falls 2.2 per 100 points of damage dealt to civilian property and 12 for levelling a civilian building, and recovers 1.5 a turn when you leave them alone.

| Support | Tier | Income | Effect |
|---|---|---:|---|
| ≥ 80% | Cooperative | ×1.10 | Locals point out Guard positions. +10% income. |
| ≥ 50% | Wary | ×1.00 | No effect. |
| ≥ 25% | Hostile | ×0.92 | Irregulars reinforce the enemy. -8% income. |
| ≥ 0% | Insurgent | ×0.85 | Heavy irregular reinforcement. -15% income. |

## Roster by tab

- **Infantry** — Light Infantry, Rifle Squad, AT Team, Mortar Team, Combat Engineer, Airborne Infantry, Air Assault Infantry
- **Vehicles** — Scout Humvee, Logistics Truck, M2 Dragoon IFV, Avenger AA, M1 Anvil MBT
- **Air** — Gunship Helicopter, Strike Jet
- **Works** — Command Post, Barracks, Motor Pool, Airfield, Fortification, Gun Outpost, Gun Tower, Barbed Wire
