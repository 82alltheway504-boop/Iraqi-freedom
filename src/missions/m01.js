import { World } from '../sim/world.js';
import { TurnManager } from '../sim/turns.js';
import { AiCommander } from '../sim/ai.js';
import { Commander } from '../sim/commander.js';
import { FACTION } from '../sim/defs.js';
import { TILE } from '../world/terrain.js';
import { makeRng, dist } from '../core/math.js';
import { MAP01, paintMap01 } from './map01.js';

// ---------------------------------------------------------------------------
// MISSION 01 — HIGHWAY 8: BRIDGEHEAD  (turn-based)
//
//   1. RECON     push the scouts forward. Teaches action points and sight.
//   2. SUPPRESS  two dug-in observation posts. Teaches the counter matrix —
//                rifles bounce off a fortification, a mortar does not.
//   3. SUPPLY    take the water plant and the oil derrick, or the army you
//                build next turn starves the turn after.
//   4. DEPLOY    place the command post. Production opens up.
//   5. HOLD      three counterattacks on a turn timer while you build.
//   6. ASSAULT   cross the bridge and take the Guard command post.
// ---------------------------------------------------------------------------

const T = (t) => t * TILE + TILE / 2;
const P = (loc) => ({ x: T(loc.tx), y: T(loc.ty) });

// Counterattacks arrive on these turns, counted from the turn you deploy.
const WAVES = [
  { after: 4,  spec: { militia: 3, technical: 2, rpg_team: 1 },
    warn: 'Movement on Highway 8 — a Guard probe is crossing the bridge.' },
  { after: 10, spec: { militia: 3, rpg_team: 3, saqr_ifv: 2, rg_mortar: 1 },
    warn: 'Second counterattack forming. Mechanised, with mortar support.' },
  { after: 17, spec: { rpg_team: 2, saqr_ifv: 2, asad_mbt: 2, aa_track: 1, rg_helo: 1 },
    warn: 'Guard armour and a gunship committed. This is their main effort.' },
];

export function createMission01(commander = null) {
  const rng = makeRng(20030320);
  const world = new World({ width: MAP01.width, height: MAP01.height, seed: 20030320 });
  paintMap01(world.grid, rng);

  const ctf = world.addPlayer(FACTION.CTF, true, 'Coalition Task Force');
  const rg = world.addPlayer(FACTION.RG, false, 'Republican Guard');

  world.commander = commander || new Commander();
  ctf.perks = world.commander.effects;
  // Enough to get started, not enough to sit still.
  ctf.res = { fuel: 250, water: 400, oil: 300 };
  rg.res = { fuel: 400, water: 400, oil: 400 };
  ctf.freeBuilds.command_post = 1;

  // --- neutral and civilian ------------------------------------------------
  for (const v of MAP01.village) world.placeBuilding(v.id, -1, v.tx, v.ty);
  const water = world.placeBuilding('water_plant', -1, MAP01.water.tx, MAP01.water.ty);
  const oil = world.placeBuilding('oil_derrick', -1, MAP01.oil.tx, MAP01.oil.ty);
  const fuel = world.placeBuilding('fuel_depot', -1, MAP01.fuel.tx, MAP01.fuel.ty);

  // --- Guard forward positions --------------------------------------------
  const opAlpha = world.placeBuilding('bunker', 1, MAP01.opAlpha.tx, MAP01.opAlpha.ty);
  const opBravo = world.placeBuilding('bunker', 1, MAP01.opBravo.tx, MAP01.opBravo.ty);
  for (const op of [opAlpha, opBravo]) { op.maxHp = 620; op.hp = 620; }
  world.spawnUnit('militia', 1, T(MAP01.opAlpha.tx + 2), T(MAP01.opAlpha.ty + 1), Math.PI);
  world.spawnUnit('militia', 1, T(MAP01.opBravo.tx + 1), T(MAP01.opBravo.ty + 2), Math.PI);
  world.spawnUnit('rpg_team', 1, T(MAP01.opBravo.tx - 1), T(MAP01.opBravo.ty + 2), Math.PI);

  // --- Guard main position east of the river -------------------------------
  const B = MAP01.rgBase;
  const rgHq = world.placeBuilding('rg_command', 1, B.tx, B.ty);
  world.placeBuilding('rg_barracks', 1, B.tx - 5, B.ty + 6);
  world.placeBuilding('rg_motor_pool', 1, B.tx + 5, B.ty + 6);
  world.placeBuilding('rg_tower', 1, 71, 34);
  world.placeBuilding('bunker', 1, 71, 39);
  world.placeBuilding('bunker', 1, 68, 31);
  // Wire across the eastern bridgehead: infantry must go around or be carried.
  for (let i = 0; i < 5; i++) world.placeBuilding('rg_wire', 1, 69, 33 + i);

  for (const [id, tx, ty] of [
    ['asad_mbt', 74, 30], ['saqr_ifv', 75, 34], ['technical', 73, 26],
    ['militia', 72, 29], ['militia', 72, 38], ['rpg_team', 70, 37], ['rg_mortar', 74, 36],
  ]) world.spawnUnit(id, 1, T(tx), T(ty), Math.PI);

  // --- the player's opening force ------------------------------------------
  const S = MAP01.playerStart;
  for (const [id, tx, ty] of [
    ['humvee', S.tx, S.ty - 1], ['humvee', S.tx, S.ty + 1],
    ['light_infantry', S.tx - 1, S.ty - 2], ['rifle_squad', S.tx - 2, S.ty - 1],
    ['rifle_squad', S.tx - 2, S.ty + 1], ['at_team', S.tx - 3, S.ty],
    ['mortar_team', S.tx - 4, S.ty], ['engineer', S.tx - 4, S.ty + 2],
  ]) world.spawnUnit(id, 0, T(tx), T(ty), 0);

  const turns = new TurnManager(world);
  world.turns = turns;

  const ai = new AiCommander(world, 1, {
    difficulty: 1,
    homePoint: P(B),
    objectives: [P(MAP01.staging)],
    maxArmy: 16,
    aggression: 0.2,                    // holds its ground until you deploy
    income: { fuel: 45, water: 45, oil: 35 },
  });
  ai.enabled = false;

  const mission = new Mission01(world, turns, ai, { water, oil, fuel, opAlpha, opBravo, rgHq });
  return { world, turns, ai, mission, commander: world.commander };
}

class Mission01 {
  constructor(world, turns, ai, refs) {
    this.w = world;
    this.turns = turns;
    this.ai = ai;
    this.refs = refs;
    this.id = 'm01';
    this.name = 'Highway 8: Bridgehead';
    this.location = 'Euphrates valley — 21 March';
    this.brief = [
      'Task Force Talon has crossed the berm and is moving north along Highway 8. '
      + 'The Republican Guard holds the only bridge in this sector and has dug in on the far bank.',
      'Everything you field runs on something. Infantry drink water, vehicles and aircraft '
      + 'burn fuel, and every structure you raise consumes oil. Take the sites before you take '
      + 'the ground, or you will be feeding an army you cannot move.',
      'There is a village short of the bridge and people are still living in it. Local Support '
      + 'is not a scoreboard — it decides whether the locals point out the Guard\'s caches or '
      + 'point out you.',
    ];
    this.openingCall =
      'Your infantry are drinking 19 water a turn and you are carrying 400. Send an engineer '
      + 'to the water plant south-west of you now — before you go looking for a fight.';
    this.deployTurn = -1;
    this.wavesSent = 0;
    this.wavesCleared = 0;
    this.activeWave = [];
    this.result = null;
    this.events = [];
    this.reinforced = false;
    this.roeFloor = 100;

    this.objectives = [
      { id: 'supply', text: 'Capture the water plant and the oil derrick', state: 'active', progress: '0 / 2' },
      { id: 'recon', text: 'Push the recon element to Overwatch ALPHA', state: 'active' },
      { id: 'ops', text: 'Destroy the two Guard observation posts', state: 'hidden', progress: '0 / 2' },
      { id: 'deploy', text: 'Deploy your Command Post', state: 'hidden' },
      { id: 'hold', text: 'Hold the bridgehead against three counterattacks', state: 'hidden', progress: '0 / 3' },
      { id: 'assault', text: 'Destroy the Republican Guard Command Post', state: 'hidden' },
      { id: 'roe', text: 'Keep Local Support above 50%', state: 'active', optional: true },
      { id: 'fuelsite', text: 'Capture the fuel depot', state: 'active', optional: true },
    ];
  }

  obj(id) { return this.objectives.find((o) => o.id === id); }
  get turn() { return this.turns.turn; }

  nextWaveIn() {
    if (this.deployTurn < 0 || this.wavesSent >= WAVES.length) return null;
    return Math.max(0, (this.deployTurn + WAVES[this.wavesSent].after) - this.turns.turn);
  }

  _complete(id, msg) {
    const o = this.obj(id);
    if (!o || o.state === 'done') return;
    o.state = 'done';
    o.doneAt = this.turns.turn;
    if (msg) this.w.notices.push({ text: msg, kind: 'good' });
    this.events.push({ type: 'objective' });
    if (this.w.commander) {
      const promo = this.w.commander.awardObjective(o.text);
      if (promo) this.events.push({ type: 'commanderPromotion', rank: promo.name });
    }
  }

  _activate(id, msg) {
    const o = this.obj(id);
    if (!o || o.state !== 'hidden') return;
    o.state = 'active';
    this.events.push({ type: 'objectiveNew' });
    if (msg) this.w.notices.push({ text: msg, kind: 'info' });
  }

  _playerNear(pt, tiles) {
    const r = tiles * TILE;
    return this.w.unitsOf(0).some((u) => dist(u.x, u.y, pt.x, pt.y) < r);
  }

  /** Called once at the start of every player turn. */
  onTurnStart() {
    if (this.result) return;
    this.roeFloor = Math.min(this.roeFloor, this.w.human.support);
    const h = this.w.human;
    if (h.support < 100) h.support = Math.min(100, h.support + 1.5);

    this._evaluate();
    this._waves();
    this._checkDefeat();
  }

  _evaluate() {
    const w = this.w;

    if (this.obj('recon').state === 'active' && this._playerNear(P(MAP01.overwatch), 6)) {
      this._complete('recon', 'Overwatch ALPHA occupied. We can see the highway.');
      this._activate('ops',
        'Two Guard observation posts are calling in our movements. Rifles will not dent a '
        + 'fortification — that is what the mortar team is for.');
      this._sendReinforcements();
    }

    const down = (this.refs.opAlpha.dead ? 1 : 0) + (this.refs.opBravo.dead ? 1 : 0);
    this.obj('ops').progress = `${down} / 2`;
    if (down === 2 && this.obj('ops').state !== 'done') {
      this._activate('ops');
      this._complete('ops', 'Both observation posts are off the air.');
    }

    const mine = (b) => b && b.alive && b.owner === 0;
    const sites = (mine(this.refs.water) ? 1 : 0) + (mine(this.refs.oil) ? 1 : 0);
    this.obj('supply').progress = `${sites} / 2`;
    if (sites === 2 && this.obj('supply').state !== 'done') {
      this._complete('supply', 'Water and oil are flowing. Now you can build.');
      this._activate('deploy', 'Command Post is authorised. Put it somewhere you can defend.');
    }

    const hq = w.buildings.find((b) => b.alive && b.built && b.owner === 0 && b.def.isHQ);
    if (hq && this.obj('deploy').state !== 'done') {
      this._activate('deploy');
      this._complete('deploy', 'Command Post operational. You have build authority.');
      this._activate('hold', 'The Guard knows where you are. Three counterattacks, minimum.');
      this._activate('assault', 'When you can take the bridge, take it.');
      this.deployTurn = this.turns.turn;
      this.ai.enabled = true;
      this.ai.aggression = 0.6;
    }

    if (this.obj('fuelsite').state === 'active' && mine(this.refs.fuel)) {
      this._complete('fuelsite', 'Fuel depot secured.');
    }
    const roe = this.obj('roe');
    if (roe.state === 'active' && w.human.support < 50) {
      roe.state = 'failed';
      w.notices.push({ text: 'Local Support has collapsed.', kind: 'bad' });
    }

    if (!this.refs.rgHq.alive && this.obj('assault').state !== 'done') {
      this._activate('assault');
      this._complete('assault', 'Guard command post destroyed.');
      this._victory();
    }
  }

  _sendReinforcements() {
    if (this.reinforced) return;
    this.reinforced = true;
    const e = MAP01.reinforceEdge;
    for (const [id, tx, ty] of [
      ['engineer', e.tx, e.ty], ['engineer', e.tx, e.ty + 1],
      ['rifle_squad', e.tx + 1, e.ty - 1], ['humvee', e.tx + 1, e.ty + 2],
    ]) this.w.spawnUnit(id, 0, T(tx), T(ty), 0);
    this.w.notices.push({ text: 'Engineer detachment has entered from the west.', kind: 'good' });
  }

  _waves() {
    if (this.deployTurn < 0 || this.obj('hold').state === 'done') return;
    const since = this.turns.turn - this.deployTurn;

    if (this.wavesSent < WAVES.length && since >= WAVES[this.wavesSent].after) {
      const wv = WAVES[this.wavesSent];
      this.w.notices.push({ text: wv.warn, kind: 'bad' });
      this.events.push({ type: 'alert' });
      this.activeWave.push(...this.ai.spawnWave(wv.spec, MAP01.bridgeEast.tx, MAP01.bridgeEast.ty));
      this.wavesSent++;
    }

    this.activeWave = this.activeWave.filter((u) => u.alive);
    const cleared = this.wavesSent - (this.activeWave.length > 0 ? 1 : 0);
    if (cleared > this.wavesCleared) {
      this.wavesCleared = cleared;
      this.obj('hold').progress = `${this.wavesCleared} / 3`;
      if (this.wavesCleared < WAVES.length) {
        this.w.notices.push({ text: `Counterattack ${this.wavesCleared} broken.`, kind: 'good' });
      }
    }
    if (this.wavesCleared >= WAVES.length) {
      this._complete('hold', 'All three counterattacks broken.');
      this.w.notices.push({ text: 'They have spent their reserve. Cross the bridge.', kind: 'good' });
      this.ai.aggression = 0.9;
      this.ai.maxArmy = 22;
      this.ai.difficulty = 1.3;
    }
  }

  _checkDefeat() {
    if (this.result) return;
    const units = this.w.unitsOf(0);
    const builds = this.w.buildingsOf(0);
    if (!units.length && !builds.length) return this._defeat('Task Force Talon has been destroyed.');
    if (this.deployTurn >= 0 && !builds.some((b) => b.def.isHQ)) {
      return this._defeat('Command Post lost. The bridgehead cannot be sustained.');
    }
  }

  _victory() {
    this.result = 'victory';
    this.w.gameOver = 'victory';
    this.events.push({ type: 'victory' });
    this.w.notices.push({ text: 'Bridgehead secure. Highway 8 is open.', kind: 'good' });
  }

  _defeat(reason) {
    this.result = 'defeat';
    this.defeatReason = reason;
    this.w.gameOver = 'defeat';
    this.events.push({ type: 'defeat' });
    this.w.notices.push({ text: reason, kind: 'bad' });
  }

  summary() {
    const p = this.w.human;
    const optional = this.objectives.filter((o) => o.optional);
    return {
      result: this.result,
      turns: this.turns.turn,
      killed: p.killed,
      lost: p.lost,
      support: Math.round(p.support),
      supportFloor: Math.round(this.roeFloor),
      wavesCleared: this.wavesCleared,
      commander: this.w.commander,
      bonuses: optional.filter((o) => o.state === 'done').map((o) => o.text),
      missed: optional.filter((o) => o.state !== 'done').map((o) => o.text),
    };
  }
}

export { MAP01 };
