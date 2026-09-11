# Design — Task Force Talon

How the game works and why it works that way. The balance tables at the end are
generated straight from the source (`npm run balance`), so they cannot drift.

---

## 1. The design problem

Command & Conquer's loop is harvest → build → tech → assault, and it is close to
perfect. The failure mode of everything built on it is **mass beats mix**:
whoever can afford the most of the single best unit wins, and the map is
scenery. Three systems here exist specifically to prevent that.

| System | What it punishes | What it rewards |
|---|---|---|
| Armour vs damage type | Massing one unit | Combined arms |
| Cover and garrison | Fighting in the open | Reading the ground |
| Veterancy | Trading units evenly | Withdrawing damaged squads |

A fourth — **Local Support** — exists because of the setting, and is discussed
in §7.

---

## 2. The counter matrix

Every point of damage in the game goes through one function
(`computeDamage` in `src/sim/rules.js`). Nothing bypasses it.

```
damage = base
       × DAMAGE_TABLE[damageType][armourClass]
       × attacker veterancy
       × defender veterancy
       × (garrison multiplier | 1 − terrain cover × armour's cover scaling)
```

The table is the design. A rifle squad does **4%** of its damage to a main
battle tank — not "reduced", effectively nothing. A tank's sabot round does
**22%** to infantry. Neither unit can solve the other, and that is the point.

Two consequences worth stating plainly:

**Tanks carry a coaxial machine gun.** Once sabot was made near-useless against
infantry, four rifle squads versus one tank of equal cost became a two-minute
stalemate, which felt terrible. Real tanks have a coax, so the tanks got one,
and units now pick whichever mount actually hurts what they are shooting at
(`Unit.pickWeapon`, scored by damage-per-second against the target's armour).
A tank now shreds infantry in the open while still losing to AT teams in cover.

**Projectiles have travel time and lead their target.** A tank shell is a real
object moving at 520 px/s that aims where the target *will be*. A technical at
112 px/s can genuinely dodge one. Bullets are hitscan with a visual tracer,
because sixty simulated bullets per second is a waste of a phone's battery.

### Verified in tests

`tools/simtest.mjs` asserts the intended outcomes rather than the numbers, so a
rebalance that breaks the design fails the build:

- 4 rifle squads (1,000 supply) versus 1 tank (1,000 supply) → **the tank wins
  untouched**. Infantry in the open is food for armour.
- 2 AT teams (800 supply) versus 1 tank (1,000 supply) → **the AT teams win**
  with one survivor. The counter is real and it is cost-efficient.
- 1 rifle squad firing at a garrisoned militia for 30 seconds → occupant at
  **77% health**. Bullets do not clear buildings.

---

## 3. Cover and garrison

Terrain grants a flat damage reduction to whatever is standing on it, scaled by
armour class: infantry gets the full value, vehicles 40%, structures none. A
rubble field is 30% cover — an AT team sitting in the ruins of a building is
effectively a third tougher, and rubble is created by destroying buildings, so
a firefight physically produces new defensive terrain as it goes.

**Garrison** is the sharper version of the same idea. Infantry can occupy any
civilian building. Occupants fire out at +20% range and cannot be reached
directly: damage only bleeds in through the structure, at 20% of the hit,
re-weighted by how suitable the weapon is.

| Weapon against a garrison | Effect |
|---|---|
| Small arms | ×0.12 — walls beat bullets |
| Armour-piercing | ×0.25 — punches through, hits one man |
| Rocket | ×2.20 — the correct answer |
| High explosive | ×2.60 — the correct answer |
| Air ordnance | ×3.00 — the very correct answer |

So a garrisoned RPG team trades evenly with a main battle tank, and the only
ways to shift it are explosives, air support, or levelling the building — which
in a village costs Local Support. Every option has a price.

When a garrisoned building is destroyed, occupants are ejected at 35% health
rather than killed. Killing them outright is the genre standard and it is a
rage-quit moment; ejecting them is punishing without being a disaster.

---

## 4. Veterancy

Units earn one XP point per 100 supply of value destroyed.

| Rank | XP | Damage | Damage taken | Vision | Regen |
|---|---:|---:|---:|---:|---:|
| Regular | 0 | ×1.00 | ×1.00 | ×1.00 | — |
| Veteran | 2 | ×1.15 | ×0.90 | ×1.05 | 1.5/s |
| Hardened | 6 | ×1.30 | ×0.80 | ×1.10 | 3.0/s |
| Elite | 14 | ×1.50 | ×0.70 | ×1.20 | 5.0/s |

An elite tank is worth roughly two regulars, which changes how you fight: a
damaged veteran pulled out of contact heals itself and comes back better, so
there is a real, continuous incentive to micromanage rather than to trade.

---

## 5. Economy and power

Supply trucks run between caches and a depot. A depot ships with one truck free
and each cache is finite, so map control is economic control rather than an
abstraction. A captured **fuel depot** adds a flat 9 supply/second with no
logistics — worth an engineer and an escort.

Power is deliberately *not* a hard switch. A brown-out (`powerUse > powerGen`)
slows production to 45% and halves the rate of fire of defensive structures.
A generator raid cripples a base without switching it off, which leaves the
defender something to play for. Generators also detonate for 55 HE damage when
destroyed, so lining them up next to the ammunition is your own problem.

---

## 6. Pathing, and why it never stalls

A* over the tile grid, per locomotion class (foot, wheel, track), with a binary
heap and a stamp-based closed set so no arrays are cleared between searches.

Two decisions matter more than the algorithm:

**The search is budgeted.** 6,000 node expansions, then it returns the best node
found. A unit ordered somewhere unreachable walks as far as it can — which is
what a player expects — instead of freezing or spiking the frame.

**Paths are string-pulled.** Raw A* output is a staircase; every waypoint that
can be walked straight past is dropped, so units move in straight lines and
formations do not crab sideways.

Repaths are rate-limited to 0.9 s per unit. An early version cleared the path
every tick during attack-move, which meant one A* search per unit per frame;
engagement is now latched so contact triggers exactly one repath.

Units do not block each other — they push apart with soft separation, which
avoids the deadlocks that hard unit collision produces in a crowd. Tracked
crushers roll over enemy infantry.

---

## 7. Rules of Engagement

The mechanic the setting demanded.

Mission 01's short route to the bridge runs through an inhabited village.
Damaging civilian structures costs **Local Support**: 2.2 points per 100 damage,
12 points for levelling one outright. Support recovers at 1.5 points per minute
once you stop.

| Support | Tier | Supply | Enemy irregulars | Air support cooldown |
|---|---|---:|---:|---:|
| ≥ 80% | Cooperative | ×1.10 | — | ×1.00 |
| ≥ 50% | Wary | ×1.00 | — | ×1.00 |
| ≥ 25% | Hostile | ×0.92 | ×1.0 | ×1.25 |
| < 25% | Insurgent | ×0.85 | ×2.0 | ×1.60 |

Below 50%, irregulars spawn from the village and attack your base on a timer.
Below 25% they come twice as often and your air support arrives 60% later.

Two design rules keep it honest:

1. **Nothing auto-targets a civilian structure.** Collateral damage is either
   splash, or a deliberate force-fire order through the command bar. The
   interface warns you at the moment you give it.
2. **It is never only a penalty.** High support pays an income bonus, so the
   restrained route is a *strategy*, not a tax.

---

## 8. Mission 01 — "Highway 8: Bridgehead"

A 96×72 map of the Euphrates valley. The river runs north to south with a
single road bridge; Highway 8 crosses the map diagonally. The bridge being the
only crossing is asserted by a test that seals it and confirms no route exists
for any locomotion class.

The mission is the classic campaign-opener arc, tuned so each beat teaches one
system and then immediately asks you to use it under pressure.

| Beat | Teaches | Pressure |
|---|---|---|
| 1. Recon | Movement, scouting, fog | None — this is the tutorial breath |
| 2. Suppress | The counter matrix | Two dug-in posts with escorts |
| 3. Seize | Capture, economy | Your engineer is unarmed |
| 4. Deploy | Base building | The enemy commander wakes up |
| 5. Hold | Defensive positioning | Three timed counterattacks |
| 6. Assault | Everything at once | AT guns covering the bridge |

The second beat is the one the whole mission turns on. Rifle squads do 10% of
their damage to a structure; AT teams do 85% and outrange the bunker. Players
who bring the right tool clear it in 25 seconds. Players who do not, cannot —
and the radio call tells them so before they try.

**Objectives are evaluated independently every tick**, not run as a strict state
machine. A player who captures the depot before clearing the observation posts
gets credit the moment they do it. The briefing suggests an order; it does not
enforce one.

Two optional objectives (keep Local Support above 50%, capture the fuel depot)
feed the end-of-mission rating, which weighs finishing, your kill-to-loss ratio,
and the *lowest* Local Support you ever reached — you cannot shell the village
and then wait for the meter to recover.

### The opposing commander

The Guard does not cheat with vision; it reacts to what its own units and
structures can actually see. What it has instead is discipline:

- Maintains a target force mix by weight and builds whatever it is shortest of.
- Garrisons the village buildings overlooking the approaches, one squad at a
  time.
- Throws a reserve at anything hostile inside its perimeter.
- Rebuilds destroyed production when it can afford to.
- **Assembles a strike group at a staging point and only commits it once it is
  worth committing**, with the threshold rising after each wave.

While the three scripted counterattacks are running it holds a large reserve
(threshold 13), so pressure arrives in waves rather than as one continuous
grind. Once they are broken it drops to 6 and commits everything.

An earlier tuning pass gave it 24 supply/second against the player's ~15. It
won every time, including against a competent defence. It now runs at 16, which
still out-produces the player — it should, it is defending — without making the
mission unwinnable.

---

## 9. Assets

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

## 10. Built for a phone

- **DOM HUD, not canvas.** Crisp text at any pixel ratio, real hit targets,
  safe-area insets around the notch, and no font rasterisation in the hot loop.
- **One tap does the obvious thing.** No mode switching for ordinary play.
- **Fixed 30 Hz simulation**, rendered as fast as the device allows, capped at
  four catch-up steps so a backgrounded tab cannot spiral.
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

Generated from source with `npm run balance`.

## Damage type vs armour class

| Damage type | Infantry | Light Armour | Heavy Armour | Structure | Air |
|---|---:|---:|---:|---:|---:|
| Small Arms | 1.00 | 0.30 | 0.04 | 0.10 | 0.15 |
| Autocannon | 0.85 | 0.90 | 0.25 | 0.35 | 0.60 |
| Armour-Piercing | 0.22 | 1.00 | 1.00 | 0.55 | 0.00 |
| Rocket | 0.55 | 1.05 | 0.95 | 0.85 | 0.10 |
| High Explosive | 1.00 | 0.75 | 0.40 | 1.00 | 0.00 |
| Anti-Air | 0.30 | 0.25 | 0.05 | 0.10 | 1.00 |
| Ordnance | 1.00 | 1.00 | 0.80 | 0.90 | 0.00 |

## Units

### Coalition Task Force

| Unit | Cost | Build | HP | Armour | Move | Speed | Vision | Weapon | Damage | RoF | Range | DPS |
|---|---:|---:|---:|---|---|---:|---:|---|---:|---:|---:|---:|
| Rifle Squad | 250 | 6s | 160 | Infantry | foot | 42 | 7 | Small Arms | 11×3 | 0.85s | 150 | 39 |
| AT Team | 400 | 9s | 130 | Infantry | foot | 38 | 8 | Rocket | 72 | 3.2s | 230 | 23 |
| Combat Engineer | 350 | 8s | 110 | Infantry | foot | 40 | 6 | — | — | — | — | — |
| Scout Humvee | 450 | 8s | 260 | Light Armour | wheel | 96 | 11 | Small Arms | 10 | 0.32s | 170 | 31 |
| M2 Dragoon IFV | 800 | 14s | 520 | Light Armour | track | 72 | 9 | Autocannon | 22×2 | 0.7s | 210 | 63 |
| M1 Anvil MBT | 1200 | 20s | 1000 | Heavy Armour | track | 58 | 9 | Armour-Piercing | 115 | 3s | 235 | 38 |
| ↳ | | | | | | | | Small Arms | 9×2 | 0.22s | 175 | 82 |
| Supply Truck | 500 | 11s | 300 | Light Armour | wheel | 80 | 7 | — | — | — | — | — |

### Republican Guard

| Unit | Cost | Build | HP | Armour | Move | Speed | Vision | Weapon | Damage | RoF | Range | DPS |
|---|---:|---:|---:|---|---|---:|---:|---|---:|---:|---:|---:|
| Militia Squad | 150 | 4s | 120 | Infantry | foot | 40 | 6 | Small Arms | 9×3 | 0.95s | 145 | 28 |
| RPG Team | 300 | 7s | 120 | Infantry | foot | 38 | 7 | Rocket | 58 | 3.4s | 195 | 17 |
| Technical | 350 | 6s | 200 | Light Armour | wheel | 112 | 9 | Small Arms | 9 | 0.28s | 160 | 32 |
| Saqr IFV | 700 | 13s | 420 | Light Armour | track | 70 | 8 | Autocannon | 18×2 | 0.8s | 195 | 45 |
| Asad MBT | 1000 | 18s | 820 | Heavy Armour | track | 54 | 8 | Armour-Piercing | 95 | 3.4s | 215 | 28 |
| ↳ | | | | | | | | Small Arms | 8×2 | 0.26s | 165 | 62 |
| Flak Track | 650 | 12s | 340 | Light Armour | wheel | 62 | 9 | Anti-Air | 13 | 0.16s | 205 | 81 |

## Structures

| Structure | Faction | Cost | Build | HP | Size | Power | Notes |
|---|---|---:|---:|---:|---|---:|---|
| Command Post | CTF | 2000 | 30s | 3000 | 4×4 | 30 | build radius 15 |
| Field Generator | CTF | 400 | 9s | 700 | 2×2 | 28 | detonates 55 |
| Supply Depot | CTF | 900 | 16s | 1400 | 3×3 | -6 | trains 1, supply drop-off |
| Barracks | CTF | 600 | 14s | 1200 | 3×3 | -10 | trains 3 |
| Motor Pool | CTF | 1400 | 24s | 1800 | 4×3 | -25 | trains 3, needs barracks |
| Comms Centre | CTF | 1200 | 22s | 1000 | 3×3 | -30 | needs motor_pool, unlocks air_strike, recon_sweep |
| MG Position | CTF | 350 | 8s | 700 | 2×2 | -5 | defensive |
| AT Emplacement | CTF | 600 | 12s | 850 | 2×2 | -12 | needs motor_pool, defensive |
| Barrier | CTF | 70 | 2s | 500 | 1×1 | 0 | — |
| Guard Command Post | RG | 2000 | 30s | 2600 | 4×4 | 30 | build radius 14 |
| Guard Barracks | RG | 500 | 12s | 1100 | 3×3 | -8 | trains 2 |
| Guard Motor Pool | RG | 1300 | 22s | 1700 | 4×3 | -22 | trains 4 |
| Guard Generator | RG | 400 | 9s | 650 | 2×2 | 28 | detonates 55 |
| Guard Bunker | RG | 400 | 9s | 950 | 2×2 | -5 | defensive |
| Guard AT Gun | RG | 550 | 12s | 750 | 2×2 | -10 | defensive |
| Residential Block | CIV | — | —s | 900 | 2×2 | 0 | civilian |
| Municipal Hall | CIV | — | —s | 1300 | 3×3 | 0 | civilian |
| Fuel Depot | CIV | — | —s | 800 | 3×2 | 0 | capturable, detonates 90, +9/s |
| Abandoned Depot | CIV | — | —s | 1200 | 3×3 | 0 | capturable |

## Terrain

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

## Veterancy

| Rank | XP | Damage | Damage taken | Vision | Regen |
|---|---:|---:|---:|---:|---:|
| Regular | 0 | ×1.00 | ×1.00 | ×1.00 | 0/s |
| Veteran | 2 | ×1.15 | ×0.90 | ×1.05 | 1.5/s |
| Hardened | 6 | ×1.30 | ×0.80 | ×1.10 | 3/s |
| Elite | 14 | ×1.50 | ×0.70 | ×1.20 | 5/s |

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

## Cover effectiveness by armour class

| Armour | Fraction of terrain cover applied |
|---|---:|
| Infantry | 100% |
| Light Armour | 40% |
| Heavy Armour | 35% |
| Structure | 0% |
| Air | 0% |

## Local Support tiers

| Support | Tier | Supply | Enemy irregulars | Support power cooldown |
|---|---|---:|---:|---:|
| ≥ 80% | Cooperative | ×1.10 | ×0.0 | ×1.00 |
| ≥ 50% | Wary | ×1.00 | ×0.0 | ×1.00 |
| ≥ 25% | Hostile | ×0.92 | ×1.0 | ×1.25 |
| ≥ 0% | Insurgent | ×0.85 | ×2.0 | ×1.60 |

## Support powers

| Power | Cooldown | Effect |
|---|---:|---|
| Strafing Run | 110s | A single gun pass along a line you draw. Devastating on soft targets in the open. Flak tracks will engage it. |
| Recon Sweep | 65s | Reveals an area for 22 seconds, garrisons included. |
