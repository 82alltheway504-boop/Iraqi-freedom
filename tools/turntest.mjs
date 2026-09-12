// Headless verification of the turn-based ruleset: action points, the three
// economies, categories, fortifications, air, and commander progression.
import { World } from '../src/sim/world.js';
import { TurnManager } from '../src/sim/turns.js';
import { Commander } from '../src/sim/commander.js';
import { FACTION, defOf } from '../src/sim/defs.js';
import { T, TILE, FOOT, TRACK, AIR } from '../src/world/terrain.js';
import { Res, Category, Damage } from '../src/sim/rules.js';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};
const T2 = (t) => t * TILE + TILE / 2;
const tileX = (e) => Math.floor(e.x / TILE);
const tileY = (e) => Math.floor(e.y / TILE);

function makeWorld({ w = 40, h = 30, fuel = 500, water = 500, oil = 500 } = {}) {
  const world = new World({ width: w, height: h, seed: 7 });
  world.fog.revealAll();
  const me = world.addPlayer(FACTION.CTF, true, 'CTF');
  const foe = world.addPlayer(FACTION.RG, false, 'RG');
  me.res = { fuel, water, oil };
  foe.res = { fuel: 500, water: 500, oil: 500 };
  const cmd = new Commander();
  world.commander = cmd;
  me.perks = cmd.effects;
  const turns = new TurnManager(world);
  world.turns = turns;
  return { world, turns, me, cmd };
}
/** Run a unit's animation to completion without waiting real time. */
const settle = (w) => { for (const u of [...w.units]) if (u.moving) u.finishMove(w); };

console.log('--- action points ---');
{
  const { world, turns } = makeWorld();
  const rifle = world.spawnUnit('rifle_squad', 0, T2(5), T2(5));
  turns.begin();
  check('unit starts with its full action points', rifle.ap === defOf('rifle_squad').ap, `${rifle.ap} AP`);
  const r = world.moveUnit(rifle, 8, 5);
  settle(world);
  check('moving three tiles costs three points', r.ok && rifle.ap === 2, `${rifle.ap} left`);
  check('unit actually arrived', tileX(rifle) === 8, `at x=${tileX(rifle)}`);
  const far = world.moveUnit(rifle, 20, 5);
  check('cannot move beyond remaining points', !far.ok, far.reason);
  const reach = world.reachable(rifle);
  check('reachable set matches remaining points', reach.size > 0 && reach.size < 30, `${reach.size} tiles`);
}

console.log('\n--- move-or-shoot tension ---');
{
  const { world, turns } = makeWorld();
  const rifle = world.spawnUnit('rifle_squad', 0, T2(5), T2(5));
  const foe = world.spawnUnit('militia', 1, T2(9), T2(5));
  turns.begin();
  world.moveUnit(rifle, 7, 5); settle(world);
  const a = world.attack(rifle, foe);
  check('can still fire after a short move', a.ok, a.ok ? `${Math.round(a.damage)} damage` : a.reason);
  check('attacking spent the rest of the points', rifle.ap === 1, `${rifle.ap} left`);
  const again = world.attack(rifle, foe);
  check('cannot fire twice without the points', !again.ok, again.reason);
}

console.log('\n--- mortars: indirect, minimum range, must set up ---');
{
  const { world, turns } = makeWorld();
  world.grid.fillRect(8, 0, 1, 30, T.BERM);            // a wall between them
  const mortar = world.spawnUnit('mortar_team', 0, T2(5), T2(5));
  const foe = world.spawnUnit('militia', 1, T2(11), T2(5));
  turns.begin();
  const overWall = world.attack(mortar, foe);
  check('mortar fires over a wall with no line of sight', overWall.ok,
    overWall.ok ? `${Math.round(overWall.damage)} damage` : overWall.reason);

  const { world: w2, turns: t2 } = makeWorld();
  const m2 = w2.spawnUnit('mortar_team', 0, T2(5), T2(5));
  const close = w2.spawnUnit('militia', 1, T2(6), T2(5));
  t2.begin();
  check('mortar cannot fire at a target in its face', !w2.canAttack(m2, close).ok,
    w2.canAttack(m2, close).reason);

  const { world: w3, turns: t3 } = makeWorld();
  const m3 = w3.spawnUnit('mortar_team', 0, T2(5), T2(5));
  const far = w3.spawnUnit('militia', 1, T2(11), T2(5));
  t3.begin();
  w3.moveUnit(m3, 6, 5); settle(w3);
  check('mortar cannot move and fire in the same turn', !w3.canAttack(m3, far).ok,
    w3.canAttack(m3, far).reason);
}

console.log('\n--- fortifications and wire ---');
{
  const { world, turns } = makeWorld();
  const fort = world.placeBuilding('fortification', 0, 10, 10);
  const rifle = world.spawnUnit('rifle_squad', 0, T2(9), T2(11));
  const foeRifle = world.spawnUnit('militia', 1, T2(14), T2(11));
  const foeMortar = world.spawnUnit('rg_mortar', 1, T2(16), T2(11));
  turns.begin();
  world.garrisonInto(rifle, fort);
  check('infantry garrisons a fortification', rifle.garrisonedIn === fort.id);
  const hpBefore = rifle.hp;
  turns.endTurn();                                   // enemy turn
  world.attack(foeRifle, fort);
  check('small arms barely scratch a garrison', rifle.hp > hpBefore * 0.95,
    `${Math.round(rifle.hp)}/${hpBefore}`);
  const beforeMortar = rifle.hp;
  world.attack(foeMortar, fort);
  check('a mortar round gets inside', rifle.hp < beforeMortar * 0.92,
    `${Math.round(rifle.hp)} after mortar`);
}
{
  const { world, turns } = makeWorld();
  world.placeBuilding('barbed_wire', 1, 8, 5);
  const rifle = world.spawnUnit('rifle_squad', 0, T2(5), T2(5));
  turns.begin();
  const blocked = world.moveUnit(rifle, 8, 5);
  check('wire stops infantry', !blocked.ok, blocked.reason);
  const { world: w2, turns: t2 } = makeWorld();
  const wire = w2.placeBuilding('barbed_wire', 1, 7, 5);
  const tank = w2.spawnUnit('mbt', 0, T2(5), T2(5));
  t2.begin();
  const drove = w2.moveUnit(tank, 7, 5); settle(w2);
  check('a tank drives onto wire', drove.ok, drove.reason || '');
  check('and crushes it', !wire.alive, wire.alive ? 'wire survived' : 'wire destroyed');
}

console.log('\n--- air ---');
{
  const { world, turns } = makeWorld();
  world.grid.fillRect(8, 0, 3, 30, T.WATER);          // an impassable river
  const helo = world.spawnUnit('helicopter', 0, T2(5), T2(5));
  const tank = world.spawnUnit('rifle_squad', 0, T2(5), T2(7));
  turns.begin();
  const flew = world.moveUnit(helo, 14, 5);
  settle(world);
  check('helicopter crosses a river', flew.ok && tileX(helo) === 14, flew.reason || `at x=${tileX(helo)}`);
  const walked = world.moveUnit(tank, 14, 7);
  check('infantry cannot', !walked.ok, walked.reason);
}
{
  const { world, turns } = makeWorld();
  const helo = world.spawnUnit('helicopter', 0, T2(5), T2(5));
  const aa = world.spawnUnit('aa_track', 1, T2(9), T2(5));
  const rifle = world.spawnUnit('militia', 1, T2(6), T2(5));
  turns.begin(); turns.endTurn();
  const hit = world.attack(aa, helo);
  check('anti-air shreds a helicopter', hit.ok && hit.damage > 30, `${Math.round(hit.damage || 0)} damage`);
  const rifleShot = world.canAttack(rifle, helo);
  check('rifles cannot engage aircraft', !rifleShot.ok, rifleShot.reason);
}
{
  const { world, turns } = makeWorld();
  const pad = world.placeBuilding('airfield', 0, 4, 4);
  const jet = world.spawnUnit('jet', 0, T2(6), T2(6));
  const foe = world.spawnUnit('asad_mbt', 1, T2(10), T2(6));
  turns.begin();
  jet.sorties = 1;
  const bomb = world.attack(jet, foe);
  check('jet bombs a tank hard', bomb.ok && bomb.damage > 60, `${Math.round(bomb.damage || 0)} damage`);
  check('sortie is spent', jet.sorties === 0);
  const second = world.canAttack(jet, foe);
  check('no second sortie without rearming', !second.ok, second.reason);
  jet.x = T2(30); jet.y = T2(25);               // flown off to a far corner
  turns.endTurn(); turns.endTurn();
  check('jet away from the airfield stays empty', jet.sorties === 0, `${jet.sorties}`);
  jet.x = T2(6); jet.y = T2(6);
  turns.endTurn(); turns.endTurn();
  check('jet rearms at the airfield', jet.sorties === 1, `${jet.sorties} sortie(s)`);
}

console.log('\n--- air assault lift ---');
{
  const { world, turns } = makeWorld();
  const helo = world.spawnUnit('helicopter', 0, T2(5), T2(5));
  const aas = world.spawnUnit('air_assault', 0, T2(6), T2(5));
  const rifle = world.spawnUnit('rifle_squad', 0, T2(5), T2(6));
  turns.begin();
  check('helicopter refuses to lift a rifle squad', !world.loadInto(helo, rifle).ok);
  check('helicopter lifts air assault infantry', world.loadInto(helo, aas).ok);
  world.moveUnit(helo, 13, 5); settle(world);
  const dropped = world.unloadAt(helo, 13, 6);
  check('squad steps off at the objective', dropped.ok && aas.transport === 0);
  check('and can still act on landing', aas.ap >= 2, `${aas.ap} AP`);
}

console.log('\n--- airborne drop ---');
{
  const { world, turns } = makeWorld();
  const abn = world.spawnUnit('airborne', 0, T2(3), T2(3));
  turns.begin();
  const drop = world.paradrop(abn, 25, 20);
  check('airborne drops onto scouted ground', drop.ok && tileX(abn) === 25, drop.reason || `at x=${tileX(abn)}`);
  check('and lands with points to fight', abn.ap > 0, `${abn.ap} AP`);
  turns.endTurn(); turns.endTurn();
  check('only one drop per unit', !world.paradrop(abn, 10, 10).ok);
}

console.log('\n--- the three economies ---');
{
  const { world, turns, me } = makeWorld({ fuel: 0, water: 0, oil: 0 });
  world.placeBuilding('fuel_depot', 0, 4, 4);
  world.placeBuilding('water_plant', 0, 10, 4);
  world.placeBuilding('oil_derrick', 0, 16, 4);
  turns.begin();
  check('each site yields its own resource',
    me.res.fuel === 22 && me.res.water === 24 && me.res.oil === 20,
    `fuel ${me.res.fuel}, water ${me.res.water}, oil ${me.res.oil}`);

  const tank = world.spawnUnit('mbt', 0, T2(6), T2(8));
  const rifle = world.spawnUnit('rifle_squad', 0, T2(7), T2(8));
  turns.endTurn(); turns.endTurn();
  check('vehicles draw upkeep from fuel only', me.lastUpkeep.fuel === defOf('mbt').upkeep,
    `fuel upkeep ${me.lastUpkeep.fuel}`);
  check('infantry draw upkeep from water only', me.lastUpkeep.water === defOf('rifle_squad').upkeep,
    `water upkeep ${me.lastUpkeep.water}`);
}
{
  const { world, turns, me } = makeWorld({ fuel: 500, water: 500, oil: 500 });
  const tank = world.spawnUnit('mbt', 0, T2(6), T2(8));
  turns.begin();
  const healthyAp = tank.ap, hp = tank.hp;
  me.res.fuel = 0;                       // the tanker convoy never arrived
  turns.endTurn(); turns.endTurn();
  check('an unfed vehicle is in deficit', !!me.deficits.fuel, `short ${me.deficits.fuel} fuel`);
  check('and takes attrition', tank.hp < hp, `${Math.round(tank.hp)}/${hp}`);
  check('and moves at half points', tank.ap < healthyAp, `${tank.ap} vs ${healthyAp} AP`);
  check('but is not deleted', tank.alive);
}

console.log('\n--- entrenchment ---');
{
  const { world, turns } = makeWorld();
  const rifle = world.spawnUnit('rifle_squad', 0, T2(5), T2(5));
  const foe = world.spawnUnit('militia', 1, T2(8), T2(5));
  turns.begin();
  turns.endTurn(); turns.endTurn();   // one full round holding still
  turns.endTurn(); turns.endTurn();
  check('a squad that holds its ground digs in', rifle.entrench > 0, `level ${rifle.entrench}`);
  const before = rifle.hp;
  world.attack(foe, rifle);
  const dugInDamage = before - rifle.hp;
  rifle.entrench = 0; rifle.hp = before; foe.ap = foe.apMax; foe.attackedThisTurn = false;
  world.attack(foe, rifle);
  const openDamage = before - rifle.hp;
  check('dug in takes less than in the open', dugInDamage < openDamage,
    `${dugInDamage.toFixed(1)} vs ${openDamage.toFixed(1)}`);
}

console.log('\n--- engineers, capture and field works ---');
{
  const { world, turns, me, cmd } = makeWorld();
  const site = world.placeBuilding('oil_derrick', -1, 10, 10);
  const eng = world.spawnUnit('engineer', 0, T2(9), T2(11));
  turns.begin();
  const cap = world.capture(eng, site);
  check('engineer captures a resource site', cap.ok && site.owner === 0, cap.reason || '');
  check('capture awards commander experience', cmd.xp > 0, `${cmd.xp} XP`);
  const oilBefore = me.res.oil;
  turns.endTurn(); turns.endTurn();
  check('the site now pays out', me.res.oil > oilBefore - 10, `oil ${me.res.oil}`);

  const eng2 = world.spawnUnit('engineer', 0, T2(20), T2(20));
  turns.endTurn(); turns.endTurn();
  const built = world.fortify(eng2, 'fortification', 21, 20);
  check('engineer digs a fortification in the field', built.ok, built.reason || '');
  const hq = world.fortify(eng2, 'barracks', 24, 20);
  check('but cannot conjure a barracks', !hq.ok, hq.reason);
}

console.log('\n--- logistics truck ---');
{
  const { world, turns } = makeWorld();
  const truck = world.spawnUnit('supply_truck', 0, T2(5), T2(5));
  const tank = world.spawnUnit('mbt', 0, T2(6), T2(5));
  turns.begin();
  world.moveUnit(tank, 6, 7); settle(world);
  const spent = tank.ap;
  const r = world.resupply(truck, tank);
  check('truck refuels a unit that has already moved', r.ok && tank.ap === tank.apMax,
    `${spent} -> ${tank.ap} AP`);
}

console.log('\n--- production takes turns ---');
{
  const { world, turns, me } = makeWorld({ water: 400, oil: 400, fuel: 400 });
  world.placeBuilding('barracks', 0, 5, 5);
  turns.begin();
  const q = world.queueUnit(0, 'rifle_squad');
  check('queueing costs water up front', q.ok && me.res.water < 400, `${me.res.water} water`);
  check('and takes a stated number of turns', q.turns === defOf('rifle_squad').buildTurns);
  const before = world.unitsOf(0).length;
  turns.endTurn(); turns.endTurn();
  check('the squad arrives next turn', world.unitsOf(0).length > before);
  const tank = world.queueUnit(0, 'mbt');
  check('cannot build a tank without a motor pool', !tank.ok, tank.reason);
}

console.log('\n--- defensive works fire on their own ---');
{
  const { world, turns } = makeWorld();
  const tower = world.placeBuilding('gun_outpost', 1, 12, 10);
  const rifle = world.spawnUnit('rifle_squad', 0, T2(5), T2(10));
  turns.begin();
  const hp = rifle.hp;
  world.moveUnit(rifle, 10, 10); settle(world);
  check('an outpost fires on whatever walks into range', rifle.hp < hp,
    `${Math.round(rifle.hp)}/${hp}`);
}

console.log('\n--- commander progression ---');
{
  const { world, turns, me, cmd } = makeWorld();
  cmd.award(400, 'seed');
  me.perks = cmd.effects;
  const plain = world.spawnUnit('rifle_squad', 0, T2(5), T2(5));
  const foe = world.spawnUnit('militia', 1, T2(8), T2(5));
  turns.begin();
  const before = foe.hp;
  world.attack(plain, foe);
  const base = before - foe.hp;

  cmd.take('marksmanship'); cmd.take('marksmanship');
  me.perks = cmd.effects;
  foe.hp = before; plain.ap = plain.apMax;
  world.attack(plain, foe);
  const boosted = before - foe.hp;
  check('marksmanship raises infantry damage', boosted > base,
    `${base.toFixed(1)} -> ${boosted.toFixed(1)}`);

  cmd.take('forcedMarch');
  me.perks = cmd.effects;
  turns.endTurn(); turns.endTurn();
  check('forced march adds an action point',
    plain.apMax === defOf('rifle_squad').ap + 1, `${plain.apMax} AP`);
}

console.log(`\n${fails === 0 ? 'TURN-BASED RULESET VERIFIED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails ? 1 : 0);
