// Headless smoke test for the simulation. Runs the real tick loop with no DOM,
// so regressions in economy, production, pathing or combat show up instantly.
import { World } from '../src/sim/world.js';
import { FACTION } from '../src/sim/defs.js';
import { T, TILE } from '../src/world/terrain.js';
import { Order } from '../src/sim/entity.js';

const DT = 1 / 30;
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
};
const run = (w, seconds) => { for (let i = 0; i < seconds / DT; i++) w.tick(DT); };
const tc = (t) => t * TILE + TILE / 2;

// --- scenario --------------------------------------------------------------
const w = new World({ width: 64, height: 48, seed: 1234 });
w.fog.revealAll();                       // fog is tested separately
const ctf = w.addPlayer(FACTION.CTF, true, 'Task Force');
const rg = w.addPlayer(FACTION.RG, false, 'Guard');
ctf.supply = 5000;

w.grid.fillRect(20, 10, 6, 14, T.PALM);  // obstacle to path around

const hq = w.placeBuilding('command_post', 0, 4, 20);
const dep = w.placeBuilding('supply_depot', 0, 9, 20);
w.placeBuilding('barracks', 0, 4, 26);
w.addCache(tc(14), tc(22), 4000);

console.log('--- economy ---');
const supply0 = ctf.supply;
const trucks = w.unitsOf(0).filter((u) => u.def.harvester);
check('depot ships a free supply truck', trucks.length === 1);
run(w, 45);
check('supply income is flowing', ctf.supply > supply0, `+${Math.round(ctf.supply - supply0)} in 45 s`);
check('cache is being drained', w.caches[0].amount < 4000, `${Math.round(w.caches[0].amount)} left`);

console.log('\n--- power ---');
check('command post generates power', ctf.powerGen === 30, `gen ${ctf.powerGen} use ${ctf.powerUse}`);
check('brown-out detected', ctf.lowPower === (ctf.powerGen < ctf.powerUse),
  `lowPower=${ctf.lowPower}`);

console.log('\n--- production ---');
check('can queue a rifle squad', w.queueUnit(0, 'rifle_squad'));
check('cannot queue a tank without a motor pool', !w.queueUnit(0, 'mbt'));
const before = w.unitsOf(0).length;
run(w, 12);
check('rifle squad rolled off the line', w.unitsOf(0).length > before);

console.log('\n--- construction ---');
const place = w.startStructure(0, 'motor_pool', 10, 25);
check('motor pool placed inside build radius', place.ok, place.reason || '');
check('placement rejected outside build radius', !w.startStructure(0, 'generator', 58, 4).ok);
run(w, 30);
check('motor pool finished', w.hasBuilding(0, 'motor_pool'));
check('tank now queueable', w.canProduce(0, 'mbt'));

console.log('\n--- pathing around an obstacle ---');
const scout = w.spawnUnit('humvee', 0, tc(6), tc(4));
scout.orderMove(w, tc(40), tc(16));
run(w, 30);
const arrived = Math.hypot(scout.x - tc(40), scout.y - tc(16));
check('scout drove around the palm grove', arrived < 90, `${Math.round(arrived)} px from the objective`);
check('scout did not end up inside the grove',
  w.grid.get((scout.x / TILE) | 0, (scout.y / TILE) | 0) !== T.PALM);

console.log('\n--- counter matrix in practice ---');
{
  const t = new World({ width: 40, height: 30, seed: 7 });
  t.fog.revealAll();
  t.addPlayer(FACTION.CTF, true, 'a'); t.addPlayer(FACTION.RG, false, 'b');
  const rifles = [0, 1, 2, 3].map((i) => t.spawnUnit('rifle_squad', 0, tc(10), tc(10 + i)));
  const tank = t.spawnUnit('asad_mbt', 1, tc(16), tc(11));
  rifles.forEach((r) => r.orderAttack(t, tank.id));
  tank.orderAttack(t, rifles[0].id);
  run(t, 40);
  check('4 rifle squads lose to 1 tank', tank.alive && t.unitsOf(0).length < 4,
    `tank hp ${Math.round(tank.hp)}, squads left ${t.unitsOf(0).length}`);
}
{
  const t = new World({ width: 40, height: 30, seed: 7 });
  t.fog.revealAll();
  t.addPlayer(FACTION.CTF, true, 'a'); t.addPlayer(FACTION.RG, false, 'b');
  const at = [0, 1].map((i) => t.spawnUnit('at_team', 0, tc(10), tc(10 + i)));
  const tank = t.spawnUnit('asad_mbt', 1, tc(17), tc(11));
  at.forEach((r) => r.orderAttack(t, tank.id));
  tank.orderAttack(t, at[0].id);
  run(t, 40);
  check('2 AT teams beat 1 tank (equal-ish cost)', !tank.alive,
    `AT left ${t.unitsOf(0).length}`);
}
{
  const t = new World({ width: 40, height: 30, seed: 9 });
  t.fog.revealAll();
  t.addPlayer(FACTION.CTF, true, 'a'); t.addPlayer(FACTION.RG, false, 'b');
  const b = t.placeBuilding('civil_block', -1, 14, 10);
  const mil = t.spawnUnit('militia', 1, tc(14), tc(14));
  mil.orderGarrison(t, b.id);
  run(t, 10);
  check('militia garrisoned the block', mil.garrisonedIn === b.id);
  const rif = t.spawnUnit('rifle_squad', 0, tc(9), tc(11));
  rif.orderAttack(t, b.id);
  run(t, 30);
  check('rifles barely scratch a garrison', mil.alive && mil.hpFrac > 0.6,
    `occupant hp ${Math.round(mil.hpFrac * 100)}%`);
}

console.log('\n--- rules of engagement ---');
{
  const t = new World({ width: 40, height: 30, seed: 11 });
  t.fog.revealAll();
  const p = t.addPlayer(FACTION.CTF, true, 'a'); t.addPlayer(FACTION.RG, false, 'b');
  const civ = t.placeBuilding('civil_hall', -1, 14, 10);
  const tank = t.spawnUnit('mbt', 0, tc(10), tc(11));
  tank.orderAttack(t, civ.id);
  const s0 = p.support;
  run(t, 40);
  check('shelling a civilian building costs Local Support', p.support < s0 - 10,
    `${Math.round(s0)}% -> ${Math.round(p.support)}%`);
  check('tank will not auto-target civilians',
    (() => { const t2 = t.acquireTarget(tank, 400); return !t2 || !t2.def?.civilian; })());
}

console.log('\n--- veterancy ---');
{
  const t = new World({ width: 40, height: 30, seed: 3 });
  t.fog.revealAll();
  t.addPlayer(FACTION.CTF, true, 'a'); t.addPlayer(FACTION.RG, false, 'b');
  const tank = t.spawnUnit('mbt', 0, tc(10), tc(10));
  for (let i = 0; i < 6; i++) {
    const v = t.spawnUnit('technical', 1, tc(15), tc(8 + i));
    v.orderAttack(t, tank.id);
  }
  tank.aggro = true;
  run(t, 60);
  check('tank earned a promotion', tank.rank > 0, `rank ${tank.rank}, xp ${tank.xp.toFixed(1)}`);
}

console.log('\n--- capture ---');
{
  const t = new World({ width: 40, height: 30, seed: 5 });
  t.fog.revealAll();
  t.addPlayer(FACTION.CTF, true, 'a'); t.addPlayer(FACTION.RG, false, 'b');
  const fuel = t.placeBuilding('fuel_depot', -1, 16, 12);
  const eng = t.spawnUnit('engineer', 0, tc(10), tc(13));
  eng.orderCapture(t, fuel.id);
  run(t, 30);
  const owned = t.buildings.find((b) => b.defId === 'fuel_depot');
  check('engineer captured the fuel depot', owned && owned.owner === 0);
  const s0 = t.players[0].supply;
  run(t, 10);
  check('captured depot trickles supply', t.players[0].supply > s0,
    `+${Math.round(t.players[0].supply - s0)} in 10 s`);
}

console.log('\n--- fog ---');
{
  const t = new World({ width: 40, height: 30, seed: 5 });
  t.addPlayer(FACTION.CTF, true, 'a'); t.addPlayer(FACTION.RG, false, 'b');
  t.spawnUnit('humvee', 0, tc(10), tc(10));
  run(t, 1);
  check('own position is lit', t.fog.isVisible(10, 10));
  check('far side of the map is dark', !t.fog.isVisible(35, 25));
}

console.log('\n--- performance ---');
{
  const t = new World({ width: 96, height: 72, seed: 42 });
  t.addPlayer(FACTION.CTF, true, 'a'); t.addPlayer(FACTION.RG, false, 'b');
  for (let i = 0; i < 60; i++) {
    const a = t.spawnUnit(i % 3 === 0 ? 'mbt' : i % 3 === 1 ? 'rifle_squad' : 'ifv', 0,
      tc(6 + (i % 10)), tc(6 + ((i / 10) | 0) * 2));
    a.orderMove(t, tc(80), tc(60), true);
  }
  for (let i = 0; i < 60; i++) {
    const b = t.spawnUnit(i % 3 === 0 ? 'asad_mbt' : i % 3 === 1 ? 'militia' : 'technical', 1,
      tc(80 - (i % 10)), tc(62 - ((i / 10) | 0) * 2));
    b.orderMove(t, tc(10), tc(10), true);
  }
  const t0 = performance.now();
  run(t, 30);
  const ms = performance.now() - t0;
  const perTick = ms / (30 / DT);
  check('120-unit battle stays inside the frame budget', perTick < 6,
    `${perTick.toFixed(2)} ms/tick (16.7 ms budget)`);
  console.log(`      survivors: CTF ${t.unitsOf(0).length}, RG ${t.unitsOf(1).length}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures ? 1 : 0);
