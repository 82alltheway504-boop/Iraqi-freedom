import { clamp, dist, dist2, turnToward, TAU, angleDelta } from '../core/math.js';
import { TILE, FOOT } from '../world/terrain.js';
import { defOf } from './defs.js';
import { computeDamage, rankFor, VET_RANKS, Armor } from './rules.js';

let NEXT_ID = 1;
export const resetIds = () => { NEXT_ID = 1; };

export const Order = {
  IDLE: 'idle', MOVE: 'move', ATTACK_MOVE: 'attackMove', ATTACK: 'attack',
  HARVEST: 'harvest', CAPTURE: 'capture', REPAIR: 'repair',
  GARRISON: 'garrison', ENTER: 'enter', HOLD: 'hold', UNLOAD: 'unload',
};

export class Entity {
  constructor(defId, owner, x, y) {
    this.id = NEXT_ID++;
    this.def = defOf(defId);
    this.defId = defId;
    this.owner = owner;               // player index
    this.x = x; this.y = y;
    this.maxHp = this.def.hp;
    this.hp = this.def.hp;
    this.dead = false;
    this.xp = 0;
    this.rank = 0;
    this.lastHitBy = 0;
    this.lastHitAt = -99;
    this.flashUntil = 0;
  }

  get faction() { return this.def.faction; }
  get alive() { return !this.dead && this.hp > 0; }
  get hpFrac() { return clamp(this.hp / this.maxHp, 0, 1); }

  addXp(points) {
    this.xp += points;
    const r = rankFor(this.xp);
    if (r !== this.rank) {
      this.rank = r;
      return true;                    // caller plays the promotion cue
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// UNIT
// ---------------------------------------------------------------------------
export class Unit extends Entity {
  constructor(defId, owner, x, y, angle = 0) {
    super(defId, owner, x, y);
    const d = this.def;
    this.kind = 'unit';
    this.angle = angle;
    this.turretAngle = angle;
    this.radius = d.radius;
    this.loco = d.loco;
    this.speed = d.speed;
    this.vision = d.vision;
    this.order = { type: Order.IDLE };
    this.path = null;
    this.pathIdx = 0;
    this.repathAt = 0;
    this.stuckFor = 0;
    this.lastX = x; this.lastY = y;
    this.weapons = [d.weapon, d.weapon2].filter(Boolean);
    this.cd = [0, 0];
    this.lastWeapon = 0;
    this.target = 0;                 // entity id
    this.moving = false;
    this.garrisonedIn = 0;
    this.cargo = [];
    this.transport = 0;
    this.carrying = 0;               // supply trucks
    this.harvestTimer = 0;
    this.homeDepot = 0;
    this.cacheTarget = 0;
    this.captureProgress = 0;
    this.muzzle = 0;                 // frames of muzzle flash left
    this.recoil = 0;
    this.trackPhase = 0;
    this.veterancyFlash = 0;
    this.aggro = true;               // return fire / auto-acquire
  }

  get visionRange() { return this.vision * VET_RANKS[this.rank].vision; }

  isIdle() { return this.order.type === Order.IDLE || this.order.type === Order.HOLD; }

  stop(world) {
    this.order = { type: Order.IDLE };
    this.path = null;
    this.target = 0;
    this.moving = false;
  }

  // --- orders -------------------------------------------------------------
  orderMove(world, x, y, attackMove = false) {
    if (this.garrisonedIn) world.ejectFromGarrison(this);
    if (this.transport) world.unloadOne(this);
    this.order = { type: attackMove ? Order.ATTACK_MOVE : Order.MOVE, x, y };
    this.target = 0;
    this._repath(world, x, y);
  }

  orderAttack(world, targetId) {
    if (this.transport) world.unloadOne(this);
    this.order = { type: Order.ATTACK, targetId };
    this.target = targetId;
    this.path = null;
  }

  orderHarvest(world, cacheId) {
    this.order = { type: Order.HARVEST };
    this.cacheTarget = cacheId || 0;
    this.path = null;
  }

  orderCapture(world, targetId) {
    this.order = { type: Order.CAPTURE, targetId };
    this.captureProgress = 0;
    this.path = null;
  }

  orderRepair(world, targetId) {
    this.order = { type: Order.REPAIR, targetId };
    this.path = null;
  }

  orderGarrison(world, buildingId) {
    this.order = { type: Order.GARRISON, targetId: buildingId };
    this.path = null;
  }

  orderEnter(world, transportId) {
    this.order = { type: Order.ENTER, targetId: transportId };
    this.path = null;
  }

  orderHold() {
    this.order = { type: Order.HOLD };
    this.path = null;
    this.moving = false;
  }

  _repath(world, x, y) {
    const g = world.grid;
    const sx = Math.floor(this.x / TILE), sy = Math.floor(this.y / TILE);
    const gx = clamp(Math.floor(x / TILE), 0, g.w - 1);
    const gy = clamp(Math.floor(y / TILE), 0, g.h - 1);
    const pts = world.pathfinder.find(sx, sy, gx, gy, this.loco);
    if (pts && pts.length) {
      // Replace the final waypoint with the exact requested point so squads
      // spread into their formation slots instead of stacking on tile centres.
      if (g.passable(gx, gy, this.loco)) { pts[pts.length - 1] = { x, y }; }
      this.path = pts;
      this.pathIdx = 0;
      this.moving = true;
    } else {
      this.path = null;
      this.moving = false;
    }
    this.repathAt = world.time + 0.9;
    this.stuckFor = 0;
  }

  // --- per-tick -----------------------------------------------------------
  update(world, dt) {
    if (!this.alive) return;
    for (let i = 0; i < this.cd.length; i++) this.cd[i] = Math.max(0, this.cd[i] - dt);
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.veterancyFlash = Math.max(0, this.veterancyFlash - dt);

    const vet = VET_RANKS[this.rank];
    if (vet.regen > 0 && this.hp < this.maxHp && world.time - this.lastHitAt > 6) {
      this.hp = Math.min(this.maxHp, this.hp + vet.regen * dt);
    }

    if (this.garrisonedIn) { this._updateGarrisoned(world, dt); return; }
    if (this.transport) return;       // riding: the transport moves us

    switch (this.order.type) {
      case Order.HARVEST:     this._updateHarvest(world, dt); break;
      case Order.CAPTURE:     this._updateCapture(world, dt); break;
      case Order.REPAIR:      this._updateRepair(world, dt); break;
      case Order.GARRISON:    this._updateGarrisonOrder(world, dt); break;
      case Order.ENTER:       this._updateEnter(world, dt); break;
      case Order.ATTACK:      this._updateAttack(world, dt); break;
      case Order.ATTACK_MOVE: this._updateAttackMove(world, dt); break;
      case Order.MOVE:        this._updateMove(world, dt); break;
      case Order.UNLOAD:      world.unloadAll(this); this.order = { type: Order.IDLE }; break;
      default:                this._updateIdle(world, dt); break;
    }

    this._advance(world, dt);
  }

  _updateIdle(world, dt) {
    this.moving = false;
    if (!this.weapons.length || !this.aggro) return;
    const t = world.acquireTarget(this, this.weaponRange() + 40);
    if (t) { this.target = t.id; this._engage(world, t, dt, false); }
    else this.target = 0;
  }

  _updateMove(world, dt) {
    // A plain move order still returns fire without chasing.
    if (this.weapons.length && this.aggro) {
      const t = world.entityById(this.target);
      const valid = t && t.alive && world.isHostile(this, t) &&
        dist(this.x, this.y, t.x, t.y) <= this.weaponRange();
      if (valid) this._shootAt(world, t, dt);
      else {
        const nt = world.acquireTarget(this, this.weaponRange());
        this.target = nt ? nt.id : 0;
        if (nt) this._shootAt(world, nt, dt);
      }
    }
    if (!this.path) { this.order = { type: Order.IDLE }; this.moving = false; }
  }

  _updateAttackMove(world, dt) {
    const t = world.entityById(this.target);
    const range = this.weaponRange();
    const stillGood = t && t.alive && world.isHostile(this, t) &&
      dist(this.x, this.y, t.x, t.y) <= range + 60;
    const found = stillGood ? t : world.acquireTarget(this, range + 60);
    if (found) {
      this.target = found.id;
      if (!this.order.engaging) {
        // First contact: drop the march path and close on the target.
        this.order.engaging = true;
        this.path = null;
        this.repathAt = 0;
      }
      this._engage(world, found, dt, true);
      this.order.resume = true;
      return;
    }
    this.target = 0;
    this.order.engaging = false;
    if (this.order.resume) {
      this.order.resume = false;
      this._repath(world, this.order.x, this.order.y);
    }
    if (!this.path) { this.order = { type: Order.IDLE }; this.moving = false; }
  }

  _updateAttack(world, dt) {
    const t = world.entityById(this.order.targetId);
    if (!t || !t.alive) {
      // Target down: hold position and look for the next one nearby.
      this.order = { type: Order.IDLE };
      this.path = null;
      return;
    }
    this.target = t.id;
    this._engage(world, t, dt, true);
  }

  /** Close to weapon range if needed, then fire. */
  _engage(world, t, dt, chase) {
    const range = this.weaponRangeFor(t);
    const d = t.kind === 'building'
      ? t.edgeDistance(this.x, this.y)
      : dist(this.x, this.y, t.x, t.y);
    const minR = this.weapons.length ? this.weapons[this.pickWeapon(t)].minRange : 0;

    if (!this.weapons.length) { this.order = { type: Order.IDLE }; return; }

    if (d > range * 0.95) {
      if (!chase) return;
      this.moving = true;
      if (world.time >= this.repathAt || !this.path) this._repath(world, t.x, t.y);
      return;
    }
    if (minR > 0 && d < minR * 0.8) {
      // Back off from a target that has closed inside the missile arming range.
      const a = Math.atan2(this.y - t.y, this.x - t.x);
      this.moving = true;
      this.path = [{ x: this.x + Math.cos(a) * minR, y: this.y + Math.sin(a) * minR }];
      this.pathIdx = 0;
      return;
    }
    this.path = null;
    this.moving = false;
    this._shootAt(world, t, dt);
  }

  /** Longest reach across all mounted weapons — used for target acquisition. */
  weaponRange() {
    if (!this.weapons.length) return 0;
    let r = 0;
    for (const w of this.weapons) r = Math.max(r, w.range);
    return this.garrisonedIn ? r * 1.2 : r;
  }

  /**
   * Choose the mount that actually hurts this target, by damage per second
   * against its armour class. This is what stops a tank trying to kill a rifle
   * squad with sabot rounds while its coaxial gun sits idle.
   */
  pickWeapon(target) {
    if (this.weapons.length === 1) return 0;
    let best = 0, bestScore = -1;
    for (let i = 0; i < this.weapons.length; i++) {
      const w = this.weapons[i];
      const dps = computeDamage(w.damage * (w.shots || 1), w.type, target.def.armor) / w.cooldown;
      if (dps > bestScore) { bestScore = dps; best = i; }
    }
    return best;
  }

  /** Effective range against a specific target, i.e. of the weapon we'd use. */
  weaponRangeFor(target) {
    if (!this.weapons.length) return 0;
    const w = this.weapons[this.pickWeapon(target)];
    return this.garrisonedIn ? w.range * 1.2 : w.range;
  }

  _shootAt(world, t, dt) {
    if (!this.weapons.length) return;
    const wi = this.pickWeapon(t);
    const w = this.weapons[wi];
    const aim = Math.atan2(t.y - this.y, t.x - this.x);
    const turretRate = this.def.turret ? 3.4 : this.def.turnRate;
    this.turretAngle = turnToward(this.turretAngle, aim, turretRate * dt);
    if (!this.def.turret) this.angle = this.turretAngle;
    if (Math.abs(angleDelta(this.turretAngle, aim)) > 0.18) return;
    if (this.cd[wi] > 0) return;
    const reach = t.kind === 'building'
      ? t.edgeDistance(this.x, this.y)
      : dist(this.x, this.y, t.x, t.y);
    if (reach > w.range) return;
    world.fireWeapon(this, t, w);
    this.cd[wi] = w.cooldown;
    this.lastWeapon = wi;
    this.muzzle = w.type === 0 ? 0.05 : 0.09;
    this.recoil = w.type === 0 ? 0.35 : 1;
  }

  _updateGarrisoned(world, dt) {
    const b = world.entityById(this.garrisonedIn);
    if (!b || !b.alive) { this.garrisonedIn = 0; return; }
    this.x = b.cx; this.y = b.cy;
    if (!this.weapons.length) return;
    const t = world.acquireTarget(this, this.weaponRange());
    if (t) { this.target = t.id; this._shootAt(world, t, dt); }
    else this.target = 0;
  }

  _updateGarrisonOrder(world, dt) {
    const b = world.entityById(this.order.targetId);
    if (!b || !b.alive || !world.canGarrison(this, b)) { this.order = { type: Order.IDLE }; return; }
    if (b.edgeDistance(this.x, this.y) < 26) {
      world.enterGarrison(this, b);
      this.order = { type: Order.IDLE };
      this.path = null;
      this.moving = false;
    } else if (world.time >= this.repathAt || !this.path) {
      this._repath(world, b.cx, b.cy);
    }
  }

  _updateEnter(world, dt) {
    const t = world.entityById(this.order.targetId);
    if (!t || !t.alive || t.cargo.length >= (t.def.cargoSpace || 0)) {
      this.order = { type: Order.IDLE }; return;
    }
    if (dist(this.x, this.y, t.x, t.y) < t.radius + this.radius + 12) {
      world.loadCargo(t, this);
      this.order = { type: Order.IDLE };
    } else if (world.time >= this.repathAt || !this.path) {
      this._repath(world, t.x, t.y);
    }
  }

  _updateCapture(world, dt) {
    const t = world.entityById(this.order.targetId);
    if (!t || !t.alive || !world.canCapture(this, t)) { this.order = { type: Order.IDLE }; return; }
    if (t.edgeDistance(this.x, this.y) < 26) {
      this.moving = false; this.path = null;
      this.captureProgress += dt / 4.0;                // four seconds on the door
      t.beingCaptured = world.time;
      t.captureFrac = this.captureProgress;
      if (this.captureProgress >= 1) {
        world.captureBuilding(t, this.owner);
        world.killUnit(this, false);                   // the engineer is consumed
      }
    } else {
      this.captureProgress = 0;
      if (world.time >= this.repathAt || !this.path) this._repath(world, t.cx, t.cy);
    }
  }

  _updateRepair(world, dt) {
    const t = world.entityById(this.order.targetId);
    if (!t || !t.alive || t.hp >= t.maxHp || t.owner !== this.owner) {
      this.order = { type: Order.IDLE }; return;
    }
    const reach = t.kind === 'building'
      ? t.edgeDistance(this.x, this.y)
      : dist(this.x, this.y, t.x, t.y) - t.radius;
    if (reach < 26) {
      this.moving = false; this.path = null;
      const rate = t.maxHp * 0.06;                     // ~17 s from scrap to full
      const cost = rate * dt * 0.18;
      const player = world.players[this.owner];
      if (player.supply >= cost) {
        player.supply -= cost;
        t.hp = Math.min(t.maxHp, t.hp + rate * dt);
        t.repairPulse = world.time;
      }
    } else if (world.time >= this.repathAt || !this.path) {
      this._repath(world, t.cx ?? t.x, t.cy ?? t.y);
    }
  }

  // Supply run: drive to cache -> load -> drive to depot -> unload -> repeat.
  _updateHarvest(world, dt) {
    const player = world.players[this.owner];
    if (this.carrying >= this.def.carry) {
      const depot = world.nearestDropoff(this);
      if (!depot) { this.moving = false; return; }
      this.homeDepot = depot.id;
      if (depot.edgeDistance(this.x, this.y) < 30) {
        this.moving = false; this.path = null;
        world.deliverSupply(this, this.carrying);
        this.carrying = 0;
        this.cacheTarget = 0;
      } else if (world.time >= this.repathAt || !this.path) {
        this._repath(world, depot.cx, depot.cy);
      }
      return;
    }

    let cache = world.cacheById(this.cacheTarget);
    if (!cache || cache.amount <= 0) {
      cache = world.nearestCache(this);
      this.cacheTarget = cache ? cache.id : 0;
      this.path = null;
    }
    if (!cache) { this.moving = false; return; }

    if (dist(this.x, this.y, cache.x, cache.y) < 30) {
      this.moving = false; this.path = null;
      this.harvestTimer += dt;
      const rate = 55;                                 // supply per second loaded
      const take = Math.min(rate * dt, cache.amount, this.def.carry - this.carrying);
      cache.amount -= take;
      this.carrying += take;
      if (take > 0) cache.workedAt = world.time;
    } else if (world.time >= this.repathAt || !this.path) {
      this._repath(world, cache.x, cache.y);
    }
  }

  // --- movement integration ----------------------------------------------
  _advance(world, dt) {
    if (!this.path || this.pathIdx >= this.path.length) {
      this.moving = false;
      return;
    }
    const wp = this.path[this.pathIdx];
    const dx = wp.x - this.x, dy = wp.y - this.y;
    const d = Math.hypot(dx, dy);
    const arrive = this.pathIdx === this.path.length - 1 ? 6 : TILE * 0.55;
    if (d < arrive) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) {
        this.path = null;
        this.moving = false;
        if (this.order.type === Order.MOVE) this.order = { type: Order.IDLE };
      }
      return;
    }

    const desired = Math.atan2(dy, dx);
    this.angle = turnToward(this.angle, desired, this.def.turnRate * dt);
    if (!this.def.turret) this.turretAngle = this.angle;

    // Tracked vehicles slow down while slewing; infantry does not care.
    const misalign = Math.abs(angleDelta(this.angle, desired));
    const throttle = this.loco === FOOT ? 1 : clamp(1 - misalign * 0.9, 0.15, 1);
    const terrainMult = world.speedMultiplier(this.x, this.y, this.loco);
    const step = this.speed * throttle * terrainMult * dt;

    const nx = this.x + Math.cos(this.angle) * step;
    const ny = this.y + Math.sin(this.angle) * step;

    if (world.canOccupy(this, nx, ny)) {
      this.x = nx; this.y = ny;
      this.moving = true;
      this.trackPhase += step;
    } else {
      // Slide along the obstacle rather than grinding into it.
      if (world.canOccupy(this, nx, this.y)) { this.x = nx; this.trackPhase += step; }
      else if (world.canOccupy(this, this.x, ny)) { this.y = ny; this.trackPhase += step; }
      this.stuckFor += dt;
      if (this.stuckFor > 0.7) {
        this.stuckFor = 0;
        const goal = this.path[this.path.length - 1];
        this._repath(world, goal.x, goal.y);
      }
    }
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
    this.constructing = 0;             // 0..1 while being built
    this.built = true;
    this.queue = [];
    this.produceTimer = 0;
    this.rally = null;
    this.garrison = [];
    this.cooldown = 0;
    this.turretAngle = 0;
    this.target = 0;
    this.powered = true;
    this.captureFrac = 0;
    this.beingCaptured = -99;
    this.repairPulse = -99;
    this.smokeTimer = 0;
    this.muzzle = 0;
    this.trickleAcc = 0;
  }

  get visionRange() { return this.vision; }
  get garrisonSlots() { return this.def.garrisonSlots || (this.def.civilian ? 2 : 0); }

  startConstruction() { this.constructing = 0; this.built = false; this.hp = Math.max(1, this.maxHp * 0.12); }

  update(world, dt) {
    if (!this.alive) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.muzzle = Math.max(0, this.muzzle - dt);
    if (world.time - this.beingCaptured > 0.4) this.captureFrac = 0;

    if (!this.built) {
      const speed = world.buildSpeed(this.owner);
      this.constructing = Math.min(1, this.constructing + (dt / this.def.buildTime) * speed);
      this.hp = Math.max(this.hp, this.maxHp * (0.12 + 0.88 * this.constructing));
      if (this.constructing >= 1) {
        this.built = true;
        this.hp = this.maxHp;
        world.onBuildingComplete(this);
      }
      return;
    }

    if (this.def.trickle && this.owner >= 0) {
      this.trickleAcc += this.def.trickle * dt;
      if (this.trickleAcc >= 1) {
        const n = Math.floor(this.trickleAcc);
        this.trickleAcc -= n;
        world.players[this.owner].supply += n;
        world.players[this.owner].earned += n;
      }
    }

    if (this.def.defensive && this.def.weapon) this._updateDefense(world, dt);
    this._updateProduction(world, dt);
  }

  _updateDefense(world, dt) {
    const w = this.def.weapon;
    const t0 = world.entityById(this.target);
    const good = t0 && t0.alive && world.isHostile(this, t0) &&
      dist(this.cx, this.cy, t0.x, t0.y) <= w.range;
    const t = good ? t0 : world.acquireTarget(this, w.range);
    if (!t) { this.target = 0; return; }
    this.target = t.id;
    const aim = Math.atan2(t.y - this.cy, t.x - this.cx);
    this.turretAngle = turnToward(this.turretAngle, aim, 3.0 * dt);
    if (Math.abs(angleDelta(this.turretAngle, aim)) > 0.2) return;
    if (this.cooldown > 0) return;
    world.fireWeapon(this, t, w);
    this.cooldown = w.cooldown * world.defenseRateMultiplier(this.owner);
    this.muzzle = 0.09;
  }

  _updateProduction(world, dt) {
    if (!this.queue.length) return;
    const job = this.queue[0];
    const speed = world.buildSpeed(this.owner);
    job.progress += (dt / job.buildTime) * speed;
    if (job.progress >= 1) {
      this.queue.shift();
      world.spawnFromBuilding(this, job.defId);
    }
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
