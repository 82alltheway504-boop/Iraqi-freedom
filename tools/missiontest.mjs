// Plays mission 01 through its objective chain with a scripted commander,
// turn by turn, in the order the briefing actually asks for: economy first,
// then the fortifications, then the bridgehead.
import { createMission01, MAP01 } from '../src/missions/m01.js';
import { TILE } from '../src/world/terrain.js';
import { Damage } from '../src/sim/rules.js';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

const { world: w, turns, ai, mission, commander } = createMission01();
w.fog.revealAll();
const settle = () => { for (const u of [...w.units]) if (u.moving) u.finishMove(w); };
const mine = () => w.unitsOf(0);
const st = (id) => mission.obj(id).state;
const G = w.grid.w;

/** Step toward a tile, optionally keeping `reserve` action points in hand. */
function advance(u, gx, gy, reserve = 0) {
  const map = w.reachable(u);
  let best = -1, bd = Infinity;
  for (const [idx, node] of map) {
    if (u.ap - node.ap < reserve) continue;
    const tx = idx % G, ty = (idx / G) | 0;
    if (w.occupantAt(tx, ty, u)) continue;
    const d = Math.hypot(tx - gx, ty - gy);
    if (d < bd) { bd = d; best = idx; }
  }
  if (best < 0) return false;
  const tx = best % G, ty = (best / G) | 0;
  if (Math.floor(u.x / TILE) === tx && Math.floor(u.y / TILE) === ty) return false;
  const r = w.moveUnit(u, tx, ty);
  if (r.ok) u.finishMove(w);
  return r.ok;
}

/** One complete round: scripted player acts, then the AI plays its turn. */
function round(playerAction) {
  if (playerAction) playerAction();
  settle();
  turns.endTurn();
  ai.takeTurn();
  settle();
  turns.endTurn();
  mission.onTurnStart();
}

turns.begin();
mission.onTurnStart();

console.log('--- opening ---');
check('force has infantry and vehicles',
  mine().some(u => u.category === 'infantry') && mine().some(u => u.category === 'vehicle'),
  `${mine().length} units`);
check('turn 1 on the clock', turns.turn === 1);
check('every unit has action points', mine().every(u => u.ap > 0));
check('all three resources stocked',
  w.human.res.fuel > 0 && w.human.res.water > 0 && w.human.res.oil > 0,
  `fuel ${w.human.res.fuel} water ${w.human.res.water} oil ${w.human.res.oil}`);
check('the economy objective is live from turn one', st('supply') === 'active');

console.log('\n--- the economy, before anything else ---');
for (const key of ['water', 'oil']) {
  const site = mission.refs[key];
  for (let i = 0; i < 22 && site.owner !== 0; i++) {
    round(() => {
      // Any engineer with points left will do; sites are taken one at a time.
      const eng = mine().find(u => u.def.abilities?.includes('capture') && u.canAct);
      if (!eng) return;
      if (w.capture(eng, site).ok) return;
      // Arrive with the three points a capture costs, or the trip is wasted.
      if (!advance(eng, site.tx + 1, site.ty + 1, 3)) advance(eng, site.tx + 1, site.ty + 1, 0);
      w.capture(eng, site);
    });
  }
  check(`${key} site captured`, site.owner === 0, `turn ${turns.turn}`);
}
check('supply objective complete', st('supply') === 'done');
check('deploy objective revealed', st('deploy') === 'active');
check('the force did not starve getting there',
  w.human.res.water > 0 && mine().length >= 7,
  `water ${w.human.res.water}, ${mine().length} units alive`);
const beforeIncome = w.human.res.water;
round();
check('captured sites pay income every turn', w.human.res.water !== beforeIncome,
  `water ${beforeIncome} -> ${w.human.res.water}`);

console.log('\n--- recon ---');
for (let i = 0; i < 12 && st('recon') !== 'done'; i++) {
  round(() => {
    for (const u of mine()) {
      if (u.canAct && u.category === 'vehicle') advance(u, MAP01.overwatch.tx, MAP01.overwatch.ty);
    }
  });
}
check('recon objective completes', st('recon') === 'done', `turn ${turns.turn}`);
check('observation-post objective revealed', st('ops') === 'active');
check('engineer detachment arrived', mine().filter(u => u.defId === 'engineer').length >= 3);

console.log('\n--- cracking the fortifications ---');
for (const op of ['opAlpha', 'opBravo']) {
  const target = mission.refs[op];
  for (let i = 0; i < 20 && !target.dead; i++) {
    round(() => {
      for (const u of mine()) {
        if (!u.canAct || !u.weapons.length) continue;
        if (w.canAttack(u, target).ok) { w.attack(u, target); continue; }
        advance(u, target.tx + 1, target.ty + 1, u.def.needsSetup ? 99 : 0);
      }
    });
  }
  check(`${op} destroyed`, target.dead, `turn ${turns.turn}`);
}
check('observation-post objective complete', st('ops') === 'done');

console.log('\n--- deploy ---');
check('the first command post is free', w.costOf(0, 'command_post') === 0);
const place = w.startStructure(0, 'command_post', MAP01.staging.tx, MAP01.staging.ty);
check('command post placed', place.ok, place.reason || '');
check('a second one costs oil', w.costOf(0, 'command_post') === 400);
for (let i = 0; i < 4 && st('deploy') !== 'done'; i++) round();
check('command post finished building', st('deploy') === 'done', `turn ${turns.turn}`);
check('hold and assault objectives revealed', st('hold') === 'active' && st('assault') === 'active');
check('the Guard commander woke up', ai.enabled);

console.log('\n--- production across the three economies ---');
w.human.res = { fuel: 900, water: 900, oil: 900 };
check('barracks can be built', w.startStructure(0, 'barracks', MAP01.staging.tx + 6, MAP01.staging.ty).ok);
for (let i = 0; i < 2; i++) round();
check('barracks online', w.hasBuilding(0, 'barracks'));
check('infantry cost water', w.queueUnit(0, 'mortar_team').ok);
check('no jets without an airfield', !w.queueUnit(0, 'jet').ok);
check('no tanks without a motor pool', !w.queueUnit(0, 'mbt').ok);
round();
check('upkeep charged across the resources',
  w.human.lastUpkeep.water > 0 || w.human.lastUpkeep.oil > 0,
  `water ${w.human.lastUpkeep.water}, oil ${w.human.lastUpkeep.oil}, fuel ${w.human.lastUpkeep.fuel}`);

console.log('\n--- counterattacks and the enemy commander ---');
const guardBefore = w.unitsOf(1).length;
for (let i = 0; i < 7; i++) round();
check('first counterattack was sent', mission.wavesSent >= 1, `${mission.wavesSent} wave(s)`);
check('Guard force on the map grew', w.unitsOf(1).length > guardBefore,
  `${guardBefore} -> ${w.unitsOf(1).length}`);
check('the AI actually takes actions', ai.lastReport.length > 0,
  `${ai.lastReport.length} actions last turn`);

console.log('\n--- commander progression ---');
check('commander earned experience', commander.xp > 0, `${commander.xp} XP, ${commander.rankName}`);
check('and has points to spend', commander.availablePoints > 0, `${commander.availablePoints} point(s)`);
check('a perk can be taken', commander.take('logistics') && commander.effects.incomeMult > 1,
  `income x${commander.effects.incomeMult.toFixed(2)}`);

console.log('\n--- victory ---');
{
  const { world: w3, turns: t3, mission: m3 } = createMission01();
  w3.fog.revealAll();
  t3.begin(); m3.onTurnStart();
  const hq = m3.refs.rgHq;
  while (hq.alive) w3.applyDamage(hq, 500, Damage.AP, w3.unitsOf(0)[0]);
  m3.onTurnStart();
  check('destroying the Guard command post wins', m3.result === 'victory');
  const s = m3.summary();
  check('summary is sane', s.turns > 0 && !!s.commander, `${s.turns} turns, ${s.killed} kills`);
}

console.log('\n--- defeat ---');
{
  const { world: w4, turns: t4, mission: m4 } = createMission01();
  w4.fog.revealAll();
  t4.begin();
  for (const u of w4.unitsOf(0)) w4.killUnit(u, false);
  m4.onTurnStart();
  check('losing the whole force ends the mission', m4.result === 'defeat', m4.defeatReason || '');
}

console.log(`\n${fails === 0 ? 'MISSION 01 PLAYS THROUGH CLEANLY' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails ? 1 : 0);
