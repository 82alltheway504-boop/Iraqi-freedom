// Headless test for the systems around the turn ruleset: multi-turn pathing,
// the counter matrix played out as an actual fight, garrison resistance, the
// rules of engagement, veterancy, capture income, fog, and the cost of a big
// turn. tools/turntest.mjs covers the ruleset itself; this covers what happens
// when two sides are turned loose on each other with no DOM in sight.
import { World } from '../src/sim/world.js';
import { TurnManager } from '../src/sim/turns.js';
import { Commander } from '../src/sim/commander.js';
import { AiCommander } from '../src/sim/ai.js';
import { FACTION } from '../src/sim/defs.js';
import { Damage } from '../src/sim/rules.js';
import { T, TILE } from '../src/world/terrain.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
};
const tc = (t) => t * TILE + TILE / 2;
const tileOf = (e) => [Math.floor(e.x / TILE), Math.floor(e.y / TILE)];

function build({ w = 40, h = 30, seed = 7, res = 4000 } = {}) {
  const world = new World({ width: w, height: h, seed });
  world.fog.revealAll();
  const me = world.addPlayer(FACTION.CTF, true, 'Task Force');
  const foe = world.addPlayer(FACTION.RG, false, 'Guard');
  for (const p of [me, foe]) p.res = { fuel: res, water: res, oil: res };
  world.commander = new Commander();
  me.perks = world.commander.effects;
  const turns = new TurnManager(world);
  world.turns = turns;
  turns.begin();
  return { world, turns, me, foe };
}

/** Movement is committed instantly; only the animation lags. Skip it. */
const settle = (w) => { for (const u of [...w.units]) if (u.moving) u.finishMove(w); };

/** Empty a unit's magazine into the softest thing it can reach. */
function shootAll(w, u) {
  let fired = false;
  for (;;) {
    const targets = w.attackableTargets(u);
    if (!targets.length) break;
    targets.sort((a, b) => a.hp - b.hp);
    if (!w.attack(u, targets[0]).ok) break;
    fired = true;
  }
  return fired;
}

/**
 * Where to stand. A unit that can already shoot from the far edge of its own
 * reach stays there — walking to knife range of something that outguns you is
 * how AT teams lose fights they should win — otherwise it closes.
 */
function bestTile(w, u, goal) {
  const W = w.grid.w;
  const range = u.weaponRange();
  const min = u.weapons[0]?.minRange || 0;
  let pick = null, best = -Infinity;
  for (const [idx] of w.reachable(u)) {
    const tx = idx % W, ty = (idx / W) | 0;
    if (w.occupantAt(tx, ty, u)) continue;
    const d = Math.hypot(tc(tx) - goal.x, tc(ty) - goal.y);
    const score = (d <= range && d >= min) ? 1000 + d : -d;
    if (score > best) { best = score; pick = [tx, ty]; }
  }
  return pick;
}

/** Spend a unit's turn: shoot what it can reach, otherwise take up a firing position. */
function actWith(w, u) {
  if (shootAll(w, u) || !u.canAct) return;
  const foes = w.units.filter((e) => e.alive && w.isHostile(u, e));
  if (!foes.length) return;
  const goal = foes.reduce((best, e) =>
    Math.hypot(e.x - u.x, e.y - u.y) < Math.hypot(best.x - u.x, best.y - u.y) ? e : best);
  const pick = bestTile(w, u, goal);
  if (!pick) return;
  w.moveUnit(u, pick[0], pick[1]);
  settle(w);
  shootAll(w, u);
}

/** Play `rounds` full rounds — both sides get a turn in each. */
function fight(world, turns, rounds) {
  for (let i = 0; i < rounds * 2; i++) {
    for (const u of world.unitsOf(turns.activeIndex)) actWith(world, u);
    turns.endTurn();
  }
}

console.log('--- marching across the map ---');
{
  const { world, turns } = build({ w: 64, h: 48, seed: 1234 });
  world.grid.fillRect(20, 10, 6, 14, T.PALM);      // a grove to route around
  const scout = world.spawnUnit('humvee', 0, tc(6), tc(4));
  const goal = { tx: 40, ty: 16 };
  let turnsTaken = 0;
  for (let i = 0; i < 12; i++) {
    const W = world.grid.w;
    let pick = null, bd = Infinity;
    for (const [idx] of world.reachable(scout)) {
      const tx = idx % W, ty = (idx / W) | 0;
      if (world.occupantAt(tx, ty, scout)) continue;
      const d = Math.hypot(tx - goal.tx, ty - goal.ty);
      if (d < bd) { bd = d; pick = [tx, ty]; }
    }
    if (!pick) break;
    world.moveUnit(scout, pick[0], pick[1]);
    settle(world);
    turnsTaken++;
    if (bd < 1) break;
    turns.endTurn(); turns.endTurn();          // hand the Guard a turn and come back
  }
  const [sx, sy] = tileOf(scout);
  check('scout reached the far objective', Math.hypot(sx - goal.tx, sy - goal.ty) < 2,
    `${turnsTaken} turns, ended at ${sx},${sy}`);
  check('scout never drove through the palm grove', world.grid.get(sx, sy) !== T.PALM);
}

console.log('\n--- counter matrix in practice ---');
{
  const { world, turns } = build({ seed: 7 });
  const rifles = [0, 1, 2, 3].map((i) => world.spawnUnit('rifle_squad', 0, tc(10), tc(10 + i)));
  const tank = world.spawnUnit('asad_mbt', 1, tc(16), tc(11));
  fight(world, turns, 6);
  check('4 rifle squads lose to 1 tank', tank.alive && world.unitsOf(0).length < 4,
    `tank ${Math.round(tank.hpFrac * 100)}%, squads left ${world.unitsOf(0).length}`);
}
{
  const { world, turns } = build({ seed: 7 });
  [0, 1].map((i) => world.spawnUnit('at_team', 0, tc(10), tc(10 + i)));
  const tank = world.spawnUnit('asad_mbt', 1, tc(17), tc(11));
  fight(world, turns, 6);
  check('2 AT teams beat 1 tank (equal-ish cost)', !tank.alive,
    `AT left ${world.unitsOf(0).length}`);
}
{
  const { world, turns } = build({ seed: 9 });
  const block = world.placeBuilding('civil_block', -1, 14, 10);
  const mil = world.spawnUnit('militia', 1, tc(14), tc(13));
  const inside = world.garrisonInto(mil, block);
  check('militia garrisoned the block', inside.ok && mil.garrisonedIn === block.id,
    inside.reason || '');
  const rif = world.spawnUnit('rifle_squad', 0, tc(11), tc(11));
  for (let i = 0; i < 5; i++) {
    while (world.attack(rif, block).ok) { /* empty the magazine */ }
    turns.endTurn(); turns.endTurn();
  }
  check('rifles barely scratch a garrison', mil.alive && mil.hpFrac > 0.6,
    `occupant at ${Math.round(mil.hpFrac * 100)}%`);
}

console.log('\n--- rules of engagement ---');
{
  const { world, turns, me } = build({ seed: 11 });
  world.placeBuilding('civil_hall', -1, 14, 10);
  const mortar = world.spawnUnit('mortar_team', 0, tc(10), tc(14));
  const foe = world.spawnUnit('militia', 1, tc(15), tc(12));
  const s0 = me.support;
  for (let i = 0; i < 4 && foe.alive; i++) {
    while (world.attack(mortar, foe).ok) { /* fire for effect */ }
    turns.endTurn(); turns.endTurn();
  }
  check('shelling next to a civilian building costs Local Support', me.support < s0,
    `${Math.round(s0)}% -> ${Math.round(me.support)}%`);
  const hall = world.buildings.find((b) => b.defId === 'civil_hall');
  check('a civilian building is never a legal target', !world.canAttack(mortar, hall).ok,
    world.canAttack(mortar, hall).reason);
  const ai = new AiCommander(world, 1);
  const aim = ai._objectiveFor ? ai._objectiveFor(foe) : null;
  check('the Guard does not march on civilians',
    !aim || !world.buildings.some((b) => b.def.civilian && b.cx === aim.x && b.cy === aim.y));
}

console.log('\n--- veterancy ---');
{
  const { world, turns } = build({ seed: 3 });
  const tank = world.spawnUnit('mbt', 0, tc(10), tc(10));
  for (let i = 0; i < 6; i++) world.spawnUnit('technical', 1, tc(14), tc(7 + i));
  for (let i = 0; i < 8 && world.unitsOf(1).length; i++) {
    for (const u of world.unitsOf(0)) actWith(world, u);
    turns.endTurn(); turns.endTurn();
  }
  check('tank earned a promotion', tank.rank > 0, `rank ${tank.rank}, xp ${tank.xp.toFixed(1)}`);
}

console.log('\n--- capture pays out ---');
{
  const { world, turns, me } = build({ seed: 5, res: 0 });
  const depot = world.placeBuilding('fuel_depot', -1, 16, 12);
  const eng = world.spawnUnit('engineer', 0, tc(15), tc(13));
  const cap = world.capture(eng, depot);
  check('engineer captured the fuel depot', cap.ok && depot.owner === 0, cap.reason || '');
  const before = me.res.fuel;
  turns.endTurn(); turns.endTurn();
  check('the captured depot pays fuel at the turn start', me.res.fuel > before,
    `+${me.res.fuel - before} fuel`);
}

console.log('\n--- fog ---');
{
  const world = new World({ width: 40, height: 30, seed: 5 });
  world.addPlayer(FACTION.CTF, true, 'a');
  world.addPlayer(FACTION.RG, false, 'b');
  world.spawnUnit('humvee', 0, tc(10), tc(10));
  world.tick(1 / 30);
  check('own position is lit', world.fog.isVisible(10, 10));
  check('far side of the map is dark', !world.fog.isVisible(35, 25));
}

console.log('\n--- cost of a big turn ---');
{
  const { world, turns } = build({ w: 96, h: 72, seed: 42 });
  const ai = new AiCommander(world, 1, { maxArmy: 0 });
  for (let i = 0; i < 60; i++) {
    world.spawnUnit(i % 3 === 0 ? 'mbt' : i % 3 === 1 ? 'rifle_squad' : 'ifv', 0,
      tc(6 + (i % 10)), tc(6 + ((i / 10) | 0) * 2));
    world.spawnUnit(i % 3 === 0 ? 'asad_mbt' : i % 3 === 1 ? 'militia' : 'technical', 1,
      tc(80 - (i % 10)), tc(62 - ((i / 10) | 0) * 2));
  }
  const t0 = performance.now();
  for (let r = 0; r < 3; r++) {
    for (const u of world.unitsOf(0)) actWith(world, u);
    turns.endTurn();
    ai.takeTurn();
    settle(world);
    turns.endTurn();
  }
  const perTurn = (performance.now() - t0) / 6;
  check('a 120-unit turn resolves fast enough to feel instant', perTurn < 400,
    `${perTurn.toFixed(0)} ms per side-turn`);
  console.log(`      survivors: CTF ${world.unitsOf(0).length}, RG ${world.unitsOf(1).length}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures ? 1 : 0);
