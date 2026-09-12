import { clamp, turnToward, angleDelta, dist } from '../core/math.js';
import { TILE } from '../world/terrain.js';
import { defOf, weaponsOf } from './defs.js';
import { rankFor, VET_RANKS, Category } from './rules.js';

let NEXT_ID = 1;
export const resetIds = () => { NEXT_ID = 1; };

export class Entity {
  constructor(defId, owner, x, y) {
    this.id = NEXT_ID++;
    this.def = defOf(defId);
    this.defId = defId;
    this.owner = owner;
    this.x = x; this.y = y;
    this.maxHp = this.def.hp;
    this.hp = this.def.hp;
    this.dead = false;
    this.xp = 0;
    this.rank = 0;
    this.lastHitAt = -99;
    this.flashUntil = 0;
  }

  get faction() { return this.def.faction; }
  get category() { return this.def.category; }
  get alive() { return !this.dead && this.hp > 0; }
  get hpFrac() { return clamp(this.hp / this.maxHp, 0, 1); }

  addXp(points) {
    this.xp += points;
    const r = rankFor(this.xp);
    if (r !== this.rank) { this.rank = r; return true; }
    return false;
  }
}

// ---------------------------------------------------------------------------
// UNIT
// ---------------------------------------------------------------------------
// In a turn-based game the unit is mostly a data record: orders resolve
// immediately in world.js, and everything here exists to animate the result.
export class Unit extends Entity {
  constructor(defId, owner, x, y, angle = 0) {
    super(defId, owner, x, y);
    const d = this.def;
    this.kind = 'unit';
    this.angle = angle;
    this.turretAngle = angle;
    this.radius = d.radius;
    this.loco = d.loco;
    this.speed = 150;                  // animation speed only, not a game rule
    this.vision = d.vision;

    // --- turn state ---
    this.apMax = d.ap;
    this.ap = d.ap;
    this.movedThisTurn = false;
    this.attackedThisTurn = false;
    this.heldPosition = true;
    this.entrench = 0;
    this.starved = false;
    this.sorties = d.sorties || 0;
    this.needsRearm = false;
    this.hasParadropped = false;

    // --- animation / presentation ---
    this.path = null;
    this.pathIdx = 0;
    this.moving = false;
    this.muzzle = 0;
    this.recoil = 0;
    this.trackPhase = 0;
    this.veterancyFlash = 0;
    this.target = 0;

    // --- carried state ---
    this.garrisonedIn = 0;
    this.cargo = [];
    this.transport = 0;
  }

  get weapons() { return weaponsOf(this.def); }
  get visionRange() { return this.vision * VET_RANKS[this.rank].vision; }
  get isAir() { return this.def.category === Category.AIR; }
  get canAct() { return this.alive && this.ap > 0 && !this.transport; }

  /** Longest reach across all mounts, for range display and acquisition. */
  weaponRange() {
    let r = 0;
    for (const w of this.weapons) r = Math.max(r, w.range);
    return this.garrisonedIn ? r * 1.2 : r;
  }

  /** The mount that best hurts this target, by damage per action point. */
  pickWeapon(target, computeDamage) {
    const ws = this.weapons;
    if (ws.length <= 1) return 0;
    let best = 0, bestScore = -1;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (target.isAir && !w.targetsAir) continue;
      if (!target.isAir && !w.targetsGround) continue;
      const dps = computeDamage(w.damage * (w.shots || 1), w.type, target.def.armor) / w.attackAp;
      if (dps > bestScore) { bestScore = dps; best = i; }
    }
    return best;
  }

  spendAp(n) {
    this.ap = Math.max(0, this.ap - n);
    this.hasActed = true;
    return this.ap;
  }

  /** Called whenever the unit does something that breaks its dug-in posture. */
  breakEntrenchment() {
    this.heldPosition = false;
    this.entrench = 0;
  }

  /** Pure animation: walk the rendered position along the committed path. */
  update(world, dt) {
    if (!this.alive) return;
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.veterancyFlash = Math.max(0, this.veterancyFlash - dt);

    if (this.garrisonedIn) {
      const b = world.entityById(this.garrisonedIn);
      if (b) { this.x = b.cx; this.y = b.cy; }
      return;
    }
    if (this.transport) {
      const t = world.entityById(this.transport);
      if (t) { this.x = t.x; this.y = t.y; }
      return;
    }
    if (!this.path || this.pathIdx >= this.path.length) {
      this.moving = false;
      this.path = null;
      return;
    }

    const wp = this.path[this.pathIdx];
    const dx = wp.x - this.x, dy = wp.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) {
        this.x = wp.x; this.y = wp.y;
        this.path = null;
        this.moving = false;
        world.onMoveFinished(this);
      }
      return;
    }
    const desired = Math.atan2(dy, dx);
    this.angle = turnToward(this.angle, desired, 12 * dt);
    if (!this.def.turret) this.turretAngle = this.angle;
    const step = Math.min(d, this.speed * dt);
    this.x += Math.cos(desired) * step;
    this.y += Math.sin(desired) * step;
    this.trackPhase += step;
    this.moving = true;
  }

  /** Snap straight to the end of the animation — used when resolving fast. */
  finishMove(world) {
    // A zero-length move (ordered onto the tile already occupied) leaves an
    // empty path, which is not the same as having no path.
    if (!this.path || !this.path.length) { this.path = null; this.moving = false; return; }
    const last = this.path[this.path.length - 1];
    this.x = last.x; this.y = last.y;
    this.path = null;
    this.moving = false;
    world.onMoveFinished(this);
  }
}

// ---------------------------------------------------------------------------
// BUILDING
// ---------------------------------------------------------------------------
export class Building extends Entity {
  constructor(defId, owner, tx, ty) {
    const d = defOf(defId);
    super(defId, owner, tx * TILE + (d.size[0] * TILE) / 2, ty * TILE + (d.size[1] * TILE) / 2);
    this.kind = 'building';
    this.tx = tx; this.ty = ty;
    this.tw = d.size[0]; this.th = d.size[1];
    this.cx = this.x; this.cy = this.y;
    this.boundRadius = Math.min(this.tw, this.th) * TILE * 0.5;
    this.halfW = (this.tw * TILE) / 2;
    this.halfH = (this.th * TILE) / 2;
    this.vision = d.vision;

    this.built = true;
    this.turnsLeft = 0;
    this.constructing = 1;
    this.queue = [];
    this.rally = null;
    this.garrison = [];
    this.garrisonHolder = undefined;
    this.turretAngle = 0;
    this.target = 0;
    this.muzzle = 0;
    this.firedThisTurn = false;
    this.repairPulse = -99;
    this.smokeTimer = 0;
  }

  get weapons() { return weaponsOf(this.def); }
  get visionRange() { return this.vision; }
  get isAir() { return false; }
  get garrisonSlots() { return this.def.garrisonSlots || 0; }

  startConstruction() {
    this.built = false;
    this.turnsLeft = this.def.buildTurns || 1;
    this.constructing = 0;
    this.hp = Math.max(1, this.maxHp * 0.2);
  }

  update(world, dt) {
    this.muzzle = Math.max(0, this.muzzle - dt);
  }

  /** Distance from a point to the nearest edge of the footprint (0 inside). */
  edgeDistance(x, y) {
    const dx = Math.max(0, Math.abs(x - this.cx) - this.halfW);
    const dy = Math.max(0, Math.abs(y - this.cy) - this.halfH);
    return Math.hypot(dx, dy);
  }

  containsTile(tx, ty) {
    return tx >= this.tx && ty >= this.ty && tx < this.tx + this.tw && ty < this.ty + this.th;
  }
}
