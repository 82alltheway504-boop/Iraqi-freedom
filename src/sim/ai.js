import { dist, dist2, TAU } from '../core/math.js';
import { TILE } from '../world/terrain.js';
import { defOf } from './defs.js';
import { Order } from './entity.js';

// ---------------------------------------------------------------------------
// Opposing-force commander.
//
// The Guard does not cheat with vision — it reacts to what its own units and
// structures can actually see. What it does have is discipline: it holds a
// garrison line, keeps a reserve at home, and only commits an assault once it
// has assembled enough of a combined-arms group to be worth committing. That
// produces an opponent that punishes a careless push without the flailing
// unit-trickle most scripted AIs fall into.
// ---------------------------------------------------------------------------

const THINK_INTERVAL = 1.0;

export class AiCommander {
  constructor(world, owner, opts = {}) {
    this.w = world;
    this.owner = owner;
    this.think = 0;
    this.difficulty = opts.difficulty ?? 1;
    // Target force mix, as weights. The Guard leans on cheap infantry with a
    // hard core of armour.
    this.composition = opts.composition || {
      militia: 3, rpg_team: 3, technical: 1.5, saqr_ifv: 1.2, asad_mbt: 1.4, aa_track: 0.6,
    };
    this.maxArmy = opts.maxArmy ?? 26;
    this.attackThreshold = opts.attackThreshold ?? 7;
    this.income = opts.income ?? 26;       // supply per second from off-map logistics
    this.homePoint = opts.homePoint || null;
    this.staging = opts.staging || null;
    this.attackTargets = opts.attackTargets || [];
    this.garrisonPoints = opts.garrisonPoints || [];
    this.strikeGroup = [];
    this.attacking = false;
    this.waveCount = 0;
    this.enabled = true;
    this.supplyAcc = 0;
  }

  get player() { return this.w.players[this.owner]; }

  update(dt) {
    if (!this.enabled) return;
    const p = this.player;
    // Off-map logistics stand in for the Guard running its own supply lines.
    this.supplyAcc += this.income * this.difficulty * dt;
    if (this.supplyAcc >= 1) {
      const n = Math.floor(this.supplyAcc);
      this.supplyAcc -= n;
      p.supply += n;
      p.earned += n;
    }

    this.think -= dt;
    if (this.think > 0) return;
    this.think = THINK_INTERVAL;

    this._produce();
    this._garrison();
    this._defend();
    this._rebuild();
    this._offense();
  }

  _army() {
    return this.w.unitsOf(this.owner).filter((u) => u.weapons.length && !u.def.harvester);
  }

  /** Keep the force mix close to the target weights. */
  _produce() {
    const p = this.player;
    const army = this._army();
    if (army.length >= this.maxArmy) return;

    const counts = {};
    for (const u of army) counts[u.defId] = (counts[u.defId] || 0) + 1;
    const totalW = Object.values(this.composition).reduce((a, b) => a + b, 0);

    // Biggest shortfall against the target ratio wins the next build slot.
    let want = null, worst = -1;
    for (const [id, weight] of Object.entries(this.composition)) {
      if (!this.w.canProduce(this.owner, id)) continue;
      const target = (weight / totalW) * Math.max(army.length + 1, 6);
      const deficit = target - (counts[id] || 0);
      if (deficit > worst) { worst = deficit; want = id; }
    }
    if (!want) return;
    // Keep a reserve so the Guard can always afford to replace a defence.
    if (p.supply < defOf(want).cost + 120) return;
    this.w.queueUnit(this.owner, want);
  }

  /** Put infantry into the buildings that overlook the approaches. */
  _garrison() {
    if (!this.garrisonPoints.length) return;
    const infantry = this.w.unitsOf(this.owner)
      .filter((u) => u.def.canGarrison && !u.garrisonedIn && u.isIdle());
    if (!infantry.length) return;
    for (const gp of this.garrisonPoints) {
      const b = this.w.buildings.find((x) =>
        x.alive && x.garrisonSlots > 0 && x.garrison.length < x.garrisonSlots &&
        dist(x.cx, x.cy, gp.x, gp.y) < TILE * 3);
      if (!b) continue;
      // Send the nearest spare rifleman.
      let best = null, bd = Infinity;
      for (const u of infantry) {
        if (u.order.type === Order.GARRISON) continue;
        const d = dist2(u.x, u.y, b.cx, b.cy);
        if (d < bd) { bd = d; best = u; }
      }
      if (best && bd < (TILE * 26) ** 2) {
        best.orderGarrison(this.w, b.id);
        return;                         // one at a time keeps it unhurried
      }
    }
  }

  /** Anything hostile inside the perimeter gets the reserve thrown at it. */
  _defend() {
    if (!this.homePoint) return;
    const R = TILE * 17;
    let threat = null, bd = Infinity;
    for (const u of this.w.units) {
      if (!u.alive || !this.w.isHostile({ owner: this.owner }, u)) continue;
      if (u.garrisonedIn || u.transport) continue;
      const d = dist2(u.x, u.y, this.homePoint.x, this.homePoint.y);
      if (d < R * R && d < bd) { bd = d; threat = u; }
    }
    if (!threat) return;
    const responders = this._army().filter((u) =>
      !this.strikeGroup.includes(u.id) && !u.garrisonedIn &&
      (u.isIdle() || u.order.type === Order.MOVE) &&
      dist2(u.x, u.y, this.homePoint.x, this.homePoint.y) < (R * 1.8) ** 2);
    for (const u of responders.slice(0, 8)) u.orderAttack(this.w, threat.id);
  }

  /** Replace destroyed production and defensive structures when affordable. */
  _rebuild() {
    const p = this.player;
    if (p.supply < 900) return;
    for (const want of ['rg_barracks', 'rg_motor_pool']) {
      if (this.w.hasBuilding(this.owner, want)) continue;
      const hq = this.w.buildingsOf(this.owner).find((b) => b.def.isHQ);
      if (!hq) return;
      const d = defOf(want);
      for (let r = 4; r < 12; r++) {
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * TAU;
          const tx = Math.round(hq.tx + hq.tw / 2 + Math.cos(ang) * r) - ((d.size[0] / 2) | 0);
          const ty = Math.round(hq.ty + hq.th / 2 + Math.sin(ang) * r) - ((d.size[1] / 2) | 0);
          if (this.w.startStructure(this.owner, want, tx, ty).ok) return;
        }
      }
      return;
    }
  }

  /** Assemble a strike group at the staging point, then commit it. */
  _offense() {
    if (!this.attackTargets.length) return;

    // Prune the group of anything that died.
    this.strikeGroup = this.strikeGroup.filter((id) => {
      const u = this.w.entityById(id);
      return u && u.alive;
    });

    if (this.attacking) {
      if (this.strikeGroup.length === 0) {
        this.attacking = false;
        return;
      }
      // Re-task any member that has gone idle after clearing its objective.
      const target = this._pickTarget();
      for (const id of this.strikeGroup) {
        const u = this.w.entityById(id);
        if (u && u.isIdle()) u.orderMove(this.w, target.x, target.y, true);
      }
      return;
    }

    const free = this._army().filter((u) =>
      !this.strikeGroup.includes(u.id) && !u.garrisonedIn && u.isIdle());
    for (const u of free) {
      this.strikeGroup.push(u.id);
      if (this.staging) u.orderMove(this.w, this.staging.x, this.staging.y);
    }

    const needed = this.attackThreshold + this.waveCount;
    if (this.strikeGroup.length >= needed) this.launchWave();
  }

  _pickTarget() {
    // Prefer a real objective; fall back to whatever of the player's is nearest
    // the staging area so a wave never wanders aimlessly.
    const alive = this.attackTargets.filter((t) => !t.id || this.w.entityById(t.id));
    if (alive.length) return alive[this.waveCount % alive.length];
    const from = this.staging || this.homePoint || { x: 0, y: 0 };
    let best = null, bd = Infinity;
    for (const b of this.w.buildings) {
      if (!b.alive || b.owner === this.owner || b.owner < 0) continue;
      const d = dist2(b.cx, b.cy, from.x, from.y);
      if (d < bd) { bd = d; best = { x: b.cx, y: b.cy }; }
    }
    for (const u of this.w.units) {
      if (!u.alive || u.owner === this.owner) continue;
      const d = dist2(u.x, u.y, from.x, from.y) * 1.6;   // structures preferred
      if (d < bd) { bd = d; best = { x: u.x, y: u.y }; }
    }
    return best || from;
  }

  launchWave(extraUnits = []) {
    for (const u of extraUnits) if (u && u.alive) this.strikeGroup.push(u.id);
    if (!this.strikeGroup.length) return false;
    const target = this._pickTarget();
    const units = this.strikeGroup.map((id) => this.w.entityById(id)).filter(Boolean);
    this.w.issueMove(units, target.x, target.y, true);
    this.attacking = true;
    this.waveCount++;
    return true;
  }

  /** Mission scripting hook: drop a formation on the map and send it in. */
  spawnWave(spec, x, y, target) {
    const spawned = [];
    let i = 0;
    for (const [defId, count] of Object.entries(spec)) {
      for (let k = 0; k < count; k++) {
        const a = (i / 8) * TAU;
        const r = 20 + (i % 5) * 26;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        const tile = this.w.grid.nearestPassable(
          Math.floor(px / TILE), Math.floor(py / TILE), defOf(defId).loco, 8);
        if (!tile) continue;
        const u = this.w.spawnUnit(defId, this.owner,
          tile.tx * TILE + TILE / 2, tile.ty * TILE + TILE / 2, Math.PI);
        spawned.push(u);
        i++;
      }
    }
    if (target) this.w.issueMove(spawned, target.x, target.y, true);
    else { this.strikeGroup.push(...spawned.map((u) => u.id)); }
    return spawned;
  }
}
