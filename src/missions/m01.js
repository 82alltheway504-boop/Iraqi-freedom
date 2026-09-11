import { World } from '../sim/world.js';
import { AiCommander } from '../sim/ai.js';
import { FACTION } from '../sim/defs.js';
import { TILE } from '../world/terrain.js';
import { makeRng, dist } from '../core/math.js';
import { MAP01, paintMap01 } from './map01.js';

// ---------------------------------------------------------------------------
// MISSION 01 — HIGHWAY 8: BRIDGEHEAD
//
// The shape of the level is the classic campaign-opener arc, tuned so each
// beat teaches one system and then immediately asks you to use it under
// pressure:
//
//   1. RECON      a handful of units, no base. Teaches movement and scouting.
//   2. SUPPRESS   two dug-in observation posts. Teaches the counter matrix -
//                 rifles bounce off a bunker, the AT team does not.
//   3. SEIZE      capture the abandoned depot with the engineer. Economy on.
//   4. DEPLOY     place the command post. Base building unlocked.
//   5. HOLD       three counterattacks on a timer while you build up.
//   6. ASSAULT    cross the bridge and take the Guard command post.
//
// Local Support runs underneath all of it: the fast route to the bridge goes
// straight through a village, and shooting your way through it costs you.
// ---------------------------------------------------------------------------

const T = (t) => t * TILE + TILE / 2;
const P = (loc) => ({ x: T(loc.tx), y: T(loc.ty) });

const WAVES = [
  { at: 55,  spec: { militia: 3, technical: 2, rpg_team: 1 },
    warn: 'Movement on Highway 8 — Guard probe inbound from the east.' },
  { at: 185, spec: { militia: 3, rpg_team: 3, saqr_ifv: 2, technical: 1 },
    warn: 'Second counterattack forming across the bridge. Mechanised.' },
  { at: 330, spec: { rpg_team: 3, saqr_ifv: 2, asad_mbt: 2, aa_track: 1 },
    warn: 'Guard armour committed. This is their main effort — hold the line.' },
];

export function createMission01() {
  const rng = makeRng(20030320);
  const world = new World({ width: MAP01.width, height: MAP01.height, seed: 20030320 });
  paintMap01(world.grid, rng);

  const ctf = world.addPlayer(FACTION.CTF, true, 'Coalition Task Force');
  const rg = world.addPlayer(FACTION.RG, false, 'Republican Guard');
  ctf.supply = 1000;
  rg.supply = 1200;
  // The first command post is issued by higher, not bought.
  ctf.freeBuilds.command_post = 1;

  // --- neutral and civilian structures ------------------------------------
  for (const v of MAP01.village) world.placeBuilding(v.id, -1, v.tx, v.ty);
  const abandoned = world.placeBuilding('abandoned_depot', -1, MAP01.depot.tx, MAP01.depot.ty);
  const fuel = world.placeBuilding('fuel_depot', -1, MAP01.fuel.tx, MAP01.fuel.ty);

  for (const c of MAP01.caches) world.addCache(T(c.tx), T(c.ty), c.amount);

  // --- Guard forward positions --------------------------------------------
  const opAlpha = world.placeBuilding('bunker', 1, MAP01.opAlpha.tx, MAP01.opAlpha.ty);
  const opBravo = world.placeBuilding('bunker', 1, MAP01.opBravo.tx, MAP01.opBravo.ty);
  // These two are hasty field positions rather than the prepared line east of
  // the river, so the opening force can actually crack them.
  for (const op of [opAlpha, opBravo]) { op.maxHp = 620; op.hp = 620; }
  world.spawnUnit('militia', 1, T(MAP01.opAlpha.tx) + 40, T(MAP01.opAlpha.ty) + 30, Math.PI);
  world.spawnUnit('militia', 1, T(MAP01.opBravo.tx) + 30, T(MAP01.opBravo.ty) + 40, Math.PI);
  world.spawnUnit('rpg_team', 1, T(MAP01.opBravo.tx) - 20, T(MAP01.opBravo.ty) + 50, Math.PI);

  // --- Guard main position east of the river ------------------------------
  const B = MAP01.rgBase;
  const rgHq = world.placeBuilding('rg_command', 1, B.tx, B.ty);
  world.placeBuilding('rg_barracks', 1, B.tx - 5, B.ty + 6);
  world.placeBuilding('rg_motor_pool', 1, B.tx + 5, B.ty + 6);
  world.placeBuilding('rg_generator', 1, B.tx + 1, B.ty - 3);
  world.placeBuilding('rg_generator', 1, B.tx + 5, B.ty - 3);
  // Guns covering the bridge approach — crossing head-on is meant to hurt.
  world.placeBuilding('rg_at_gun', 1, 71, 34);
  world.placeBuilding('rg_at_gun', 1, 71, 39);
  world.placeBuilding('bunker', 1, 68, 31);
  world.placeBuilding('bunker', 1, 68, 41);

  const rgGarrison = [
    ['asad_mbt', 74, 30], ['saqr_ifv', 75, 34], ['technical', 73, 26],
    ['militia', 72, 29], ['militia', 72, 38], ['rpg_team', 70, 37], ['rpg_team', 70, 33],
  ];
  for (const [id, tx, ty] of rgGarrison) world.spawnUnit(id, 1, T(tx), T(ty), Math.PI);

  // --- the player's opening force -----------------------------------------
  const S = MAP01.playerStart;
  const startForce = [
    ['humvee', S.tx, S.ty - 1], ['humvee', S.tx, S.ty + 1],
    ['rifle_squad', S.tx - 2, S.ty - 1], ['rifle_squad', S.tx - 2, S.ty + 1],
    ['at_team', S.tx - 3, S.ty - 1], ['at_team', S.tx - 3, S.ty + 1],
  ];
  for (const [id, tx, ty] of startForce) world.spawnUnit(id, 0, T(tx), T(ty), 0);

  world.fog.update([]);

  // --- opposing commander --------------------------------------------------
  const ai = new AiCommander(world, 1, {
    difficulty: 1,
    homePoint: P(B),
    staging: P(MAP01.rgStaging),
    attackTargets: [P(MAP01.staging), P(MAP01.depot)],
    garrisonPoints: MAP01.village.map((v) => ({ x: T(v.tx), y: T(v.ty) })),
    attackThreshold: 13,   // holds a large reserve until the scripted waves are done
    maxArmy: 18,
    income: 16,
  });
  // The Guard sits on its hands until the player has a base worth attacking.
  ai.enabled = false;

  const mission = new Mission01(world, ai, { abandoned, fuel, opAlpha, opBravo, rgHq });
  return { world, ai, mission };
}

class Mission01 {
  constructor(world, ai, refs) {
    this.w = world;
    this.ai = ai;
    this.refs = refs;
    this.id = 'm01';
    this.name = 'Highway 8: Bridgehead';
    this.location = 'Euphrates valley — 21 March';
    this.brief = [
      'Task Force Talon has crossed the berm and is moving north along Highway 8. '
      + 'The Republican Guard holds the only bridge in this sector and has dug in on the far bank.',
      'Push the recon element forward, clear the observation posts covering the highway, and '
      + 'put the abandoned depot back into service so we can build up a bridgehead.',
      'One more thing. There is a village short of the bridge and people are still living in it. '
      + 'Local Support is not a scoreboard — it decides whether the locals point out the Guard\'s '
      + 'caches or point out you. Do not flatten it on your way through.',
    ];
    this.time = 0;
    this.deployedAt = -1;
    this.wavesSent = 0;
    this.wavesCleared = 0;
    this.activeWave = [];
    this.result = null;             // 'victory' | 'defeat'
    this.events = [];               // consumed by the HUD as radio traffic
    this.reinforced = false;
    this.roeFloor = 100;

    this.objectives = [
      { id: 'recon', text: 'Move the recon element to Overwatch ALPHA', state: 'active' },
      { id: 'ops', text: 'Destroy the two Guard observation posts', state: 'hidden', progress: '0 / 2' },
      { id: 'seize', text: 'Capture the abandoned depot with an engineer', state: 'hidden' },
      { id: 'deploy', text: 'Deploy your Command Post', state: 'hidden' },
      { id: 'hold', text: 'Hold the bridgehead against three counterattacks', state: 'hidden', progress: '0 / 3' },
      { id: 'assault', text: 'Destroy the Republican Guard Command Post', state: 'hidden' },
      { id: 'roe', text: 'Keep Local Support above 50%', state: 'active', optional: true },
      { id: 'fuel', text: 'Capture the fuel depot for extra income', state: 'active', optional: true },
    ];
  }

  obj(id) { return this.objectives.find((o) => o.id === id); }

  /** Seconds until the next scripted counterattack, or null if none is due. */
  nextWaveIn() {
    if (this.deployedAt < 0 || this.wavesSent >= WAVES.length) return null;
    return Math.max(0, WAVES[this.wavesSent].at - (this.time - this.deployedAt));
  }

  _complete(id, msg) {
    const o = this.obj(id);
    if (!o || o.state === 'done') return;
    o.state = 'done';
    o.doneAt = this.time;
    if (msg) this.radio(msg, 'good');
    this.events.push({ type: 'objective' });
  }

  _activate(id, msg) {
    const o = this.obj(id);
    if (!o || o.state !== 'hidden') return;
    o.state = 'active';
    o.activatedAt = this.time;
    this.events.push({ type: 'objectiveNew' });
    if (!msg) return;
    this.radio(msg, 'info');
  }

  radio(text, kind = 'info') {
    this.w.notices.push({ text, kind });
  }

  /** Convenience: is any player unit within `tiles` of a point? */
  _playerNear(pt, tiles) {
    const r = tiles * TILE;
    return this.w.unitsOf(0).some((u) => dist(u.x, u.y, pt.x, pt.y) < r);
  }

  update(dt) {
    if (this.result) return;
    this.time += dt;
    const human = this.w.human;
    this.roeFloor = Math.min(this.roeFloor, human.support);

    this._evaluate();
    this._optional();
    this._waves(dt);
    this._irregulars(dt);
    this._checkDefeat();
  }

  /**
   * Objectives are evaluated independently every tick rather than run as a
   * strict state machine. A player who captures the depot before clearing the
   * observation posts still gets credit for it the moment they do it, which is
   * how it should feel — the briefing suggests an order, it does not enforce one.
   */
  _evaluate() {
    const w = this.w;

    // 1. Recon.
    if (this.obj('recon').state === 'active' && this._playerNear(P(MAP01.overwatch), 6)) {
      this._complete('recon', 'Overwatch ALPHA occupied. Good. Now we can see the highway.');
      this._activate('ops',
        'Two Guard observation posts are calling in our movements. Take them both out. '
        + 'Your rifles will not dent a bunker — put the AT teams on it.');
      this._sendReinforcements();
    }

    // 2. Observation posts.
    const down = (this.refs.opAlpha.dead ? 1 : 0) + (this.refs.opBravo.dead ? 1 : 0);
    this.obj('ops').progress = `${down} / 2`;
    if (down === 2 && this.obj('ops').state !== 'done') {
      this._activate('ops');
      this._complete('ops', 'Both observation posts are off the air.');
      this._activate('seize',
        'There is an intact depot at the staging area. Walk an engineer up to it and take it — '
        + 'that is your supply line.');
    }

    // 3. Seize the depot.
    const depot = w.buildings.find((b) => b.alive && b.defId === 'supply_depot' && b.owner === 0);
    if (depot && this.obj('seize').state !== 'done') {
      this._activate('seize');
      this._complete('seize', 'Depot is ours. Supply truck is rolling.');
      this._activate('deploy',
        'Command Post is authorised. Put it somewhere you can defend — the staging area '
        + 'behind the depot is the obvious ground.');
    }

    // 4. Deploy the command post.
    const hq = w.buildings.find((b) => b.alive && b.built && b.owner === 0 && b.def.isHQ);
    if (hq && this.obj('deploy').state !== 'done') {
      this._activate('deploy');
      this._complete('deploy', 'Command Post is operational. You have build authority.');
      this._activate('hold',
        'The Guard knows exactly where you are now. Three counterattacks, minimum. Dig in.');
      this._activate('assault',
        'When you can take the bridge, take it. Their command post is the objective.');
      this.deployedAt = this.time;
      this.ai.enabled = true;
    }

    // 6. Assault. Winning early by racing the bridge is allowed — and hard.
    if (!this.refs.rgHq.alive && this.obj('assault').state !== 'done') {
      this._activate('assault');
      this._complete('assault', 'Guard command post destroyed.');
      this._victory();
    }
  }

  _optional() {
    const human = this.w.human;
    const roe = this.obj('roe');
    if (roe.state === 'active' && human.support < 50) {
      roe.state = 'failed';
      this.radio('Local Support has collapsed. The Guard is drawing irregular reinforcements.', 'bad');
    }
    const fuelObj = this.obj('fuel');
    if (fuelObj.state === 'active') {
      const f = this.w.buildings.find((b) => b.alive && b.defId === 'fuel_depot');
      if (f && f.owner === 0) this._complete('fuel', 'Fuel depot secured. Supply trickle established.');
      else if (!f) { fuelObj.state = 'failed'; this.radio('The fuel depot has been destroyed.', 'bad'); }
    }
  }

  /** The three scripted counterattacks, on a timer that starts at deployment. */
  _waves(dt) {
    if (this.deployedAt < 0 || this.obj('hold').state === 'done') return;
    const since = this.time - this.deployedAt;

    if (this.wavesSent < WAVES.length && since >= WAVES[this.wavesSent].at) {
      const wv = WAVES[this.wavesSent];
      this.radio(wv.warn, 'bad');
      this.events.push({ type: 'alert' });
      const from = P(MAP01.bridgeEast);
      const target = P(MAP01.staging);
      this.activeWave.push(...this.ai.spawnWave(wv.spec, from.x, from.y, target));
      this.wavesSent++;
    }

    this.activeWave = this.activeWave.filter((u) => u.alive);
    const cleared = this.wavesSent - (this.activeWave.length > 0 ? 1 : 0);
    if (cleared > this.wavesCleared) {
      this.wavesCleared = cleared;
      this.obj('hold').progress = `${this.wavesCleared} / 3`;
      if (this.wavesCleared < WAVES.length) this.radio(`Counterattack ${this.wavesCleared} broken.`, 'good');
    }

    if (this.wavesCleared >= WAVES.length) {
      this._complete('hold', 'All three counterattacks broken. The bridgehead is holding.');
      this.radio('They have spent their reserve. Cross the bridge and finish it.', 'good');
      // With its reserve gone the Guard stops husbanding units and commits.
      this.ai.attackThreshold = 6;
      this.ai.maxArmy = 28;
      this.ai.difficulty = 1.35;
    }
  }

  /** The engineer detachment and its escort drive in along the western road. */
  _sendReinforcements() {
    if (this.reinforced) return;
    this.reinforced = true;
    const e = MAP01.reinforceEdge;
    const arrivals = [
      ['engineer', e.tx, e.ty], ['engineer', e.tx, e.ty + 1],
      ['rifle_squad', e.tx + 1, e.ty - 1], ['humvee', e.tx + 1, e.ty + 2],
    ];
    const units = arrivals.map(([id, tx, ty]) => this.w.spawnUnit(id, 0, T(tx), T(ty), 0));
    const rally = P(MAP01.overwatch);
    this.w.issueMove(units, rally.x, rally.y);
    this.radio('Engineer detachment is on the road behind you, entering from the west.', 'good');
  }

  /** Low Local Support hands the Guard free irregulars from the village. */
  _irregulars(dt) {
    const tierMult = this.w.human.support < 25 ? 2 : this.w.human.support < 50 ? 1 : 0;
    if (!tierMult || this.deployedAt < 0) { this._irrTimer = 45; return; }
    this._irrTimer = (this._irrTimer ?? 45) - dt * tierMult;
    if (this._irrTimer > 0) return;
    this._irrTimer = 50;
    const v = MAP01.village[(Math.random() * MAP01.village.length) | 0];
    const target = P(MAP01.staging);
    this.ai.spawnWave({ militia: 2, rpg_team: 1 }, T(v.tx), T(v.ty), target);
    this.radio('Irregulars are turning out against you in the village.', 'bad');
  }

  _checkDefeat() {
    if (this.result) return;
    const units = this.w.unitsOf(0);
    const builds = this.w.buildingsOf(0);
    if (units.length === 0 && builds.length === 0) {
      this._defeat('Task Force Talon has been destroyed.');
      return;
    }
    // Losing the command post after deploying ends the operation.
    if (this.deployedAt >= 0 && !builds.some((b) => b.def.isHQ)) {
      this._defeat('Command Post lost. The bridgehead cannot be sustained.');
    }
  }

  _victory() {
    this.result = 'victory';
    this.w.gameOver = 'victory';
    this.events.push({ type: 'victory' });
    this.radio('Bridgehead secure. Highway 8 is open.', 'good');
  }

  _defeat(reason) {
    this.result = 'defeat';
    this.defeatReason = reason;
    this.w.gameOver = 'defeat';
    this.events.push({ type: 'defeat' });
    this.radio(reason, 'bad');
  }

  /** End-of-mission summary shown on the results card. */
  summary() {
    const p = this.w.human;
    const optional = this.objectives.filter((o) => o.optional);
    return {
      result: this.result,
      time: this.time,
      killed: p.killed,
      lost: p.lost,
      earned: p.earned,
      support: Math.round(p.support),
      supportFloor: Math.round(this.roeFloor),
      wavesCleared: this.wavesCleared,
      bonuses: optional.filter((o) => o.state === 'done').map((o) => o.text),
      missed: optional.filter((o) => o.state !== 'done').map((o) => o.text),
    };
  }
}

export { MAP01 };
