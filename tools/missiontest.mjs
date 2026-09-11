// Drives mission 01 through every phase headlessly with a scripted player,
// proving the objective chain, the wave scheduler and the win/lose conditions
// all fire without a browser in sight.
import { createMission01, MAP01 } from '../src/missions/m01.js';
import { TILE } from '../src/world/terrain.js';
import { Damage } from '../src/sim/rules.js';

const DT = 1 / 30;
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
};
const T = (t) => t * TILE + TILE / 2;

const { world: w, ai, mission } = createMission01();
w.fog.revealAll();                     // the scripted player is allowed to cheat

const run = (seconds, each) => {
  for (let i = 0; i < seconds / DT; i++) {
    w.tick(DT); ai.update(DT); mission.update(DT);
    if (each && i % 30 === 0) each(i / 30);
  }
};
const until = (pred, limit, each) => {
  for (let i = 0; i < limit / DT; i++) {
    w.tick(DT); ai.update(DT); mission.update(DT);
    if (each && i % 15 === 0) each();
    if (pred()) return i * DT;
  }
  return null;
};
const mine = () => w.unitsOf(0);
const objState = (id) => mission.obj(id).state;

console.log('--- phase 1: recon ---');
w.issueMove(mine(), T(MAP01.overwatch.tx), T(MAP01.overwatch.ty));
let t = until(() => objState('recon') === 'done', 90);
check('recon objective completes on arrival', t !== null, t ? `${t.toFixed(0)} s` : 'timed out');
check('observation-post objective revealed', objState('ops') === 'active');
check('engineer reinforcements arrived', mine().some((u) => u.defId === 'engineer'));

console.log('\n--- phase 2: suppress the observation posts ---');
// Exactly the lesson the level is meant to teach: send the AT team.
for (const op of ['opAlpha', 'opBravo']) {
  const target = mission.refs[op];
  const dt = until(() => target.dead, 200, () => {
    // Anti-tank teams crack the bunker; everyone else deals with its escort.
    for (const u of mine()) {
      if (!u.alive || !u.weapons.length) continue;
      if (u.defId === 'at_team') {
        if (u.order.type !== 'attack' || u.order.targetId !== target.id) u.orderAttack(w, target.id);
      } else if (u.isIdle()) {
        u.orderMove(w, target.cx - 220, target.cy + 180, true);
      }
    }
  });
  check(`${op} destroyed`, target.dead, dt ? `${dt.toFixed(0)} s` : 'timed out');
}
check('observation-post objective complete', objState('ops') === 'done');
check('seize objective revealed', objState('seize') === 'active');

console.log('\n--- phase 3: seize the depot ---');
const eng = mine().find((u) => u.defId === 'engineer');
check('engineer survived the approach', !!eng);
if (eng) {
  eng.orderCapture(w, mission.refs.abandoned.id);
  t = until(() => objState('seize') === 'done', 120);
  check('depot captured and back in service', t !== null, t ? `${t.toFixed(0)} s` : 'timed out');
}
check('captured depot shipped a supply truck', mine().some((u) => u.def.harvester));
check('deploy objective revealed', objState('deploy') === 'active');

console.log('\n--- phase 4: deploy the command post ---');
check('command post is free the first time', w.structureCost(0, 'command_post') === 0);
const place = w.startStructure(0, 'command_post', MAP01.staging.tx, MAP01.staging.ty);
check('command post placed in the staging area', place.ok, place.reason || '');
check('an HQ does not need an existing build radius',
  w.canPlace(0, 'command_post', MAP01.playerStart.tx, MAP01.playerStart.ty).ok);
check('ordinary structures still need one',
  !w.canPlace(0, 'barracks', MAP01.playerStart.tx, MAP01.playerStart.ty).ok);
check('a second command post costs full price', w.structureCost(0, 'command_post') === 2000);
t = until(() => objState('deploy') === 'done', 90);
check('command post finished construction', t !== null, t ? `${t.toFixed(0)} s` : 'timed out');
check('hold objective revealed', objState('hold') === 'active');
check('assault objective revealed', objState('assault') === 'active');
check('enemy commander activated', ai.enabled);

// The scripted player has no tactics, so garrison the bridgehead for it —
// what follows is a test of the wave scheduler, not of bot micromanagement.
for (let i = 0; i < 5; i++) {
  w.spawnUnit('mbt', 0, T(MAP01.staging.tx + 4), T(MAP01.staging.ty - 2 + i)).orderHold();
  w.spawnUnit('at_team', 0, T(MAP01.staging.tx + 6), T(MAP01.staging.ty - 2 + i)).orderHold();
  w.spawnUnit('ifv', 0, T(MAP01.staging.tx + 2), T(MAP01.staging.ty - 2 + i)).orderHold();
}
w.placeBuilding('at_gun', 0, MAP01.staging.tx + 8, MAP01.staging.ty);
w.placeBuilding('mg_nest', 0, MAP01.staging.tx + 8, MAP01.staging.ty + 4);

console.log('\n--- economy under a real base ---');
const s0 = w.human.supply;
run(60);
check('supply is accumulating from the captured depot', w.human.supply > s0,
  `${Math.round(s0)} -> ${Math.round(w.human.supply)}`);
check('base can now build a barracks', w.canBuildStructure(0, 'barracks'));
check('motor pool still gated behind a barracks', !w.canBuildStructure(0, 'motor_pool'));

console.log('\n--- phase 5: counterattacks ---');
const before = w.unitsOf(1).length;
run(140);
check('first counterattack was sent', mission.wavesSent >= 1, `${mission.wavesSent} wave(s)`);
check('Guard force grew', w.unitsOf(1).length > before, `${before} -> ${w.unitsOf(1).length}`);
run(260);
check('mission still live after the counterattacks', mission.result === null,
  mission.defeatReason || mission.result || 'in progress');
check('all three counterattacks scheduled', mission.wavesSent === 3, `${mission.wavesSent}`);
check('at least one counterattack was broken', mission.wavesCleared >= 1,
  `${mission.wavesCleared} / 3 cleared`);

console.log('\n--- rules of engagement ---');
{
  const civ = w.buildings.find((b) => b.alive && b.def.civilian);
  const s = w.human.support;
  const attacker = mine().find((u) => u.weapons.length);
  for (let i = 0; i < 40; i++) w.applyDamage(civ, 60, Damage.HE, attacker);
  check('collateral damage costs Local Support', w.human.support < s,
    `${Math.round(s)}% -> ${Math.round(w.human.support)}%`);
  check('optional ROE objective fails below 50%',
    w.human.support >= 50 || (mission.update(DT), objState('roe') === 'failed'),
    `support ${Math.round(w.human.support)}%`);
}

console.log('\n--- victory ---');
{
  const { world: w3, ai: ai3, mission: m3 } = createMission01();
  w3.fog.revealAll();
  for (let i = 0; i < 60; i++) { w3.tick(DT); ai3.update(DT); m3.update(DT); }
  const hq = m3.refs.rgHq;
  const shooter = w3.unitsOf(0)[0];
  while (hq.alive) w3.applyDamage(hq, 500, Damage.AP, shooter);
  m3.update(DT);
  check('destroying the Guard command post wins the mission', m3.result === 'victory');
  const sum = m3.summary();
  check('summary reports sensible figures', sum.killed >= 0 && sum.time > 0,
    `${Math.round(sum.time)} s, ${sum.killed} kills, ${sum.lost} lost, support floor ${sum.supportFloor}%`);
}

console.log('\n--- defeat path ---');
{
  const { world: w2, ai: ai2, mission: m2 } = createMission01();
  w2.fog.revealAll();
  for (const u of w2.unitsOf(0)) w2.killUnit(u, false);
  for (let i = 0; i < 30; i++) { w2.tick(DT); ai2.update(DT); m2.update(DT); }
  check('losing the whole force ends the mission', m2.result === 'defeat');
}

console.log(`\n${failures === 0 ? 'MISSION 01 PLAYS THROUGH CLEANLY' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures ? 1 : 0);
