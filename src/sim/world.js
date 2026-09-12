import { clamp, dist, dist2, makeRng, TAU } from '../core/math.js';
import { Grid } from '../world/grid.js';
import { Pathfinder } from '../world/pathfinder.js';
import { Fog } from '../world/fog.js';
import { TILE, TERRAIN, AIR } from '../world/terrain.js';
import { Unit, Building, resetIds } from './entity.js';
import { defOf, weaponsOf, FACTION } from './defs.js';
import {
  computeDamage, Armor, Damage, Category, Res, ENTRENCH, VET_RANKS,
} from './rules.js';
import { Fx } from './fx.js';

// Rules of Engagement, unchanged in spirit: collateral damage to civilian
// property costs Local Support, which feeds income and enemy reinforcement.
export const ROE = {
  START: 100,
  LOSS_PER_100_DAMAGE: 2.2,
  LOSS_PER_DESTROYED: 12,
  REGEN_PER_TURN: 1.5,
  tiers: [
    { min: 80, name: 'Cooperative', incomeMult: 1.10, blurb: 'Locals share cache locations. +10% income.' },
    { min: 50, name: 'Wary',        incomeMult: 1.00, blurb: 'No effect.' },
    { min: 25, name: 'Hostile',     incomeMult: 0.92, blurb: 'Irregulars reinforce the enemy. -8% income.' },
    { min: 0,  name: 'Insurgent',   incomeMult: 0.85, blurb: 'Heavy irregular reinforcement. -15% income.' },
  ],
};
export const roeTier = (s) => ROE.tiers.find((t) => s >= t.min) || ROE.tiers[ROE.tiers.length - 1];

export class Player {
  constructor(index, faction, isHuman, name) {
    this.index = index;
    this.faction = faction;
    this.isHuman = isHuman;
    this.name = name;
    this.res = { fuel: 0, water: 0, oil: 0 };
    this.deficits = {};
    this.lastIncome = { fuel: 0, water: 0, oil: 0 };
    this.lastUpkeep = { fuel: 0, water: 0, oil: 0 };
    this.support = ROE.START;
    this.allies = new Set([index]);
    this.perks = null;              // filled from the Commander
    this.killed = 0;
    this.lost = 0;
    this.freeBuilds = {};
  }
}

export class World {
  constructor(opts = {}) {
    resetIds();
    this.rng = makeRng(opts.seed ?? 20030320);
    this.grid = new Grid(opts.width || 96, opts.height || 72);
    this.pathfinder = new Pathfinder(this.grid);
    this.fog = new Fog(this.grid);
    this.fx = new Fx(this.rng);
    this.time = 0;
    this.entities = new Map();
    this.units = [];
    this.buildings = [];
    this.projectiles = [];
    this.players = [];
    this.events = [];
    this.notices = [];
    this.humanIndex = 0;
    this.gameOver = null;
    this.commander = null;
    this.turns = null;               // set by the mission
    this._fogTimer = 0;
  }

  // --- setup ----------------------------------------------------------------
  addPlayer(faction, isHuman, name) {
    const p = new Player(this.players.length, faction, isHuman, name);
    this.players.push(p);
    if (isHuman) this.humanIndex = p.index;
    return p;
  }
  get human() { return this.players[this.humanIndex]; }

  spawnUnit(defId, owner, x, y, angle = 0) {
    const u = new Unit(defId, owner, x, y, angle);
    this.entities.set(u.id, u);
    this.units.push(u);
    return u;
  }

  placeBuilding(defId, owner, tx, ty, { constructing = false } = {}) {
    const d = defOf(defId);
    const b = new Building(defId, owner, tx, ty);
    if (constructing) b.startConstruction();
    this.entities.set(b.id, b);
    this.buildings.push(b);
    // Wire is not a wall: it belongs on its own layer so tracked vehicles can
    // drive over and crush it, which is the whole point of laying it.
    if (d.obstacle) this.grid.setWire(tx, ty, b.tw, b.th, true);
    else this.grid.occupy(tx, ty, b.tw, b.th, true);
    if (!constructing) this.onBuildingComplete(b);
    return b;
  }

  entityById(id) {
    const e = this.entities.get(id);
    return e && e.alive ? e : null;
  }

  isHostile(a, b) {
    if (!a || !b) return false;
    const ao = a.owner ?? a.index;
    if (ao === b.owner) return false;
    if (b.owner < 0) return false;
    return !this.players[ao]?.allies.has(b.owner);
  }

  // --- economy --------------------------------------------------------------
  costOf(owner, defId) {
    const d = defOf(defId);
    const p = this.players[owner];
    if (p?.freeBuilds?.[defId] > 0) return 0;
    let c = d.cost;
    if (d.category === Category.STRUCTURE && p?.perks) c = Math.round(c * p.perks.worksCostMult);
    return c;
  }

  canAfford(owner, defId) {
    const d = defOf(defId);
    return this.players[owner].res[d.res] >= this.costOf(owner, defId);
  }

  pay(owner, defId) {
    const d = defOf(defId);
    const p = this.players[owner];
    const c = this.costOf(owner, defId);
    if (p.res[d.res] < c) return false;
    if (c === 0 && p.freeBuilds?.[defId] > 0) p.freeBuilds[defId]--;
    p.res[d.res] -= c;
    return true;
  }

  // --- movement -------------------------------------------------------------
  /** Tiles this unit can reach with its remaining action points. */
  reachable(unit) {
    if (!unit.canAct) return new Map();
    return this.pathfinder.reachable(
      Math.floor(unit.x / TILE), Math.floor(unit.y / TILE), unit.loco, unit.ap);
  }

  /**
   * Move a unit to a tile, paying action points per step. Ground units stop
   * when they run out; the move is committed the instant it is ordered and the
   * animation merely catches up.
   */
  moveUnit(unit, tx, ty) {
    if (!unit.canAct) return { ok: false, reason: 'no action points' };
    if (unit.garrisonedIn) this.exitGarrison(unit);
    const W = this.grid.w;
    const map = this.reachable(unit);
    const goal = ty * W + tx;
    if (!map.has(goal)) return { ok: false, reason: 'out of range' };
    if (this.occupantAt(tx, ty, unit)) return { ok: false, reason: 'tile occupied' };

    const tiles = Pathfinder.traceBack(map, goal, W);
    const cost = map.get(goal).ap;
    unit.spendAp(cost);
    unit.movedThisTurn = true;
    unit.breakEntrenchment();
    const steps = tiles.slice(1).map((t) => ({ x: t.tx * TILE + TILE / 2, y: t.ty * TILE + TILE / 2 }));
    unit.path = steps.length ? steps : null;
    unit.pathIdx = 0;
    unit.moving = !!unit.path;
    if (!unit.moving) this.onMoveFinished(unit);
    this.events.push({ type: 'move', owner: unit.owner, defId: unit.defId });
    return { ok: true, cost, tiles };
  }

  /** A ground unit already standing on a tile blocks it. Air stacks freely. */
  occupantAt(tx, ty, ignore) {
    for (const u of this.units) {
      if (!u.alive || u === ignore || u.garrisonedIn || u.transport) continue;
      if (u.isAir !== (ignore ? ignore.isAir : false)) continue;   // air and ground share tiles
      if (Math.floor(u.x / TILE) === tx && Math.floor(u.y / TILE) === ty) return u;
    }
    return null;
  }

  /** Resolved once the animation lands: wire, defensive fire, crushing. */
  onMoveFinished(unit) {
    if (!unit.alive) return;
    this._crushUnderTracks(unit);
    this._defensiveFire(unit);
    this._updateFog();
  }

  _crushUnderTracks(unit) {
    if (!unit.def.crusher) return;
    const tx = Math.floor(unit.x / TILE), ty = Math.floor(unit.y / TILE);
    for (const b of [...this.buildings]) {
      if (!b.alive || !b.def.obstacle || !this.isHostile(unit, b)) continue;
      if (b.containsTile(tx, ty)) {
        this.fx.explosion(b.cx, b.cy, 18, false);
        this.destroyBuilding(b, false);
        this.notices.push({ text: `${unit.def.name} crushed the wire`, kind: 'good' });
      }
    }
  }

  /** Enemy fixed defences shoot at whatever finishes a move inside their arc. */
  _defensiveFire(unit) {
    for (const b of this.buildings) {
      if (!b.alive || !b.built || !b.def.defensive || b.firedThisTurn) continue;
      if (!this.isHostile(b, unit)) continue;
      const w = b.weapons[0];
      if (!w) continue;
      if (unit.isAir && !w.targetsAir) continue;
      if (!unit.isAir && !w.targetsGround) continue;
      if (b.edgeDistance(unit.x, unit.y) > w.range) continue;
      b.firedThisTurn = true;
      b.turretAngle = Math.atan2(unit.y - b.cy, unit.x - b.cx);
      b.muzzle = 0.12;
      this._resolveShot(b, unit, w);
      this.notices.push({ text: `${b.def.name} opened fire`, kind: b.owner === this.humanIndex ? 'good' : 'bad' });
    }
  }

  // --- combat ---------------------------------------------------------------
  canAttack(unit, target) {
    if (!unit.alive || !target || !target.alive) return { ok: false, reason: 'no target' };
    if (!this.isHostile(unit, target)) return { ok: false, reason: 'friendly' };
    const ws = unit.weapons;
    if (!ws.length) return { ok: false, reason: 'unarmed' };
    if (unit.def.needsSetup && unit.movedThisTurn) {
      return { ok: false, reason: 'must set up — cannot move and fire in the same turn' };
    }
    if (unit.def.sorties && unit.sorties <= 0) {
      return { ok: false, reason: 'out of ordnance — return to the airfield' };
    }

    const wi = unit.pickWeapon(target, computeDamage);
    const w = ws[wi];
    if (target.isAir && !w.targetsAir) return { ok: false, reason: 'cannot engage aircraft' };
    if (!target.isAir && !w.targetsGround) return { ok: false, reason: 'cannot engage ground' };
    if (unit.ap < w.attackAp) return { ok: false, reason: `needs ${w.attackAp} action points` };

    const d = target.kind === 'building'
      ? target.edgeDistance(unit.x, unit.y)
      : dist(unit.x, unit.y, target.x, target.y);
    if (d > w.range) return { ok: false, reason: 'out of range' };
    if (w.minRange && d < w.minRange) return { ok: false, reason: 'too close' };

    // Direct-fire weapons need line of sight; mortars arc over everything.
    if (!w.indirect && !unit.isAir) {
      const a = { x: Math.floor(unit.x / TILE), y: Math.floor(unit.y / TILE) };
      const b = { x: Math.floor((target.cx ?? target.x) / TILE), y: Math.floor((target.cy ?? target.y) / TILE) };
      if (!this.grid.lineOfSight(a.x, a.y, b.x, b.y)) return { ok: false, reason: 'no line of sight' };
    }
    return { ok: true, weapon: w, weaponIndex: wi, distance: d };
  }

  attack(unit, target) {
    const check = this.canAttack(unit, target);
    if (!check.ok) return check;
    const w = check.weapon;
    unit.spendAp(w.attackAp);
    unit.attackedThisTurn = true;
    unit.breakEntrenchment();
    if (unit.def.sorties) unit.sorties--;
    unit.turretAngle = Math.atan2((target.cy ?? target.y) - unit.y, (target.cx ?? target.x) - unit.x);
    if (!unit.def.turret) unit.angle = unit.turretAngle;
    unit.muzzle = 0.12;
    unit.recoil = 1;
    const dmg = this._resolveShot(unit, target, w);
    return { ok: true, damage: dmg, weapon: w };
  }

  _resolveShot(shooter, target, w) {
    const sx = shooter.kind === 'building' ? shooter.cx : shooter.x;
    const sy = shooter.kind === 'building' ? shooter.cy : shooter.y;
    const tx = target.kind === 'building' ? target.cx : target.x;
    const ty = target.kind === 'building' ? target.cy : target.y;

    this.fx.muzzleFlash(sx + Math.cos(shooter.turretAngle) * 14,
      sy + Math.sin(shooter.turretAngle) * 14, shooter.turretAngle,
      w.type === Damage.AP || w.type === Damage.BOMB ? 2 : 1);
    this.events.push({ type: 'shot', weapon: w, x: sx, y: sy, defId: shooter.defId });

    const shots = w.shots || 1;
    for (let i = 0; i < shots; i++) {
      this.fx.tracer(sx, sy, tx + this.rng.range(-6, 6), ty + this.rng.range(-6, 6),
        w.projectile === 'tracer' ? '#ffcf6a' : '#ffe9b0', 0.12, w.projectile === 'shell' ? 2.4 : 1.3);
    }

    let total = this.applyDamage(target, w.damage * shots, w.type, shooter);
    if (w.splash > 0) {
      this.fx.explosion(tx, ty, w.splash, w.type === Damage.BOMB);
      this.events.push({ type: 'explosion', x: tx, y: ty, big: w.type === Damage.BOMB });
      this.splashDamage(tx, ty, w.splash, w.damage * 0.55, Damage.HE, shooter, target.id);
    } else {
      this.fx.impactDust(tx, ty, 1.2);
      this.events.push({ type: 'impact', x: tx, y: ty });
    }
    return total;
  }

  applyDamage(target, base, damageType, attacker) {
    if (!target || !target.alive) return 0;
    const aPlayer = attacker ? this.players[attacker.owner] : null;
    const dPlayer = this.players[target.owner];
    const cover = target.kind === 'unit'
      ? TERRAIN[this.grid.terrain[
          clamp(Math.floor(target.y / TILE), 0, this.grid.h - 1) * this.grid.w +
          clamp(Math.floor(target.x / TILE), 0, this.grid.w - 1)]].cover
      : 0;

    const dmg = computeDamage(base, damageType, target.def.armor, {
      cover,
      garrisoned: !!target.garrisonedIn,
      entrench: target.entrench || 0,
      attackerRank: attacker ? attacker.rank || 0 : 0,
      defenderRank: target.rank || 0,
      attackerPerks: aPlayer?.perks || null,
      defenderPerks: dPlayer?.perks || null,
      attackerCategory: attacker?.def?.category || null,
      starved: !!attacker?.starved,
    });
    if (dmg <= 0) return 0;

    if (target.def.civilian && aPlayer?.isHuman) {
      const before = aPlayer.support;
      aPlayer.support = clamp(aPlayer.support - (dmg / 100) * ROE.LOSS_PER_100_DAMAGE, 0, 100);
      if (Math.floor(before / 10) !== Math.floor(aPlayer.support / 10)) {
        this.notices.push({ text: `Local Support falling — ${Math.round(aPlayer.support)}%`, kind: 'bad' });
      }
    }

    target.hp -= dmg;
    target.lastHitAt = this.time;
    target.flashUntil = this.time + 0.12;
    if (target.kind === 'building' && target.garrison.length) {
      this._damageGarrison(target, base, damageType, attacker);
    }
    if (target.hp <= 0) this._onKilled(target, attacker);
    return dmg;
  }

  _damageGarrison(b, base, damageType, attacker) {
    for (const id of [...b.garrison]) {
      const u = this.entities.get(id);
      if (!u || !u.alive) continue;
      const d = computeDamage(base * 0.2, damageType, Armor.INFANTRY, {
        garrisoned: true,
        attackerRank: attacker ? attacker.rank || 0 : 0,
        defenderRank: u.rank || 0,
      });
      if (d <= 0.01) continue;
      u.hp -= d;
      u.flashUntil = this.time + 0.12;
      if (u.hp <= 0) this._onKilled(u, attacker);
    }
  }

  splashDamage(x, y, radius, base, damageType, attacker, exceptId = 0) {
    for (const e of [...this.units, ...this.buildings]) {
      if (!e.alive || e.id === exceptId) continue;
      const ex = e.kind === 'building' ? e.cx : e.x;
      const ey = e.kind === 'building' ? e.cy : e.y;
      const d = Math.max(0, dist(x, y, ex, ey) - (e.kind === 'building' ? e.boundRadius * 0.6 : 0));
      if (d > radius) continue;
      this.applyDamage(e, base * (1 - (d / radius) * 0.7), damageType, attacker);
    }
  }

  _onKilled(target, attacker) {
    if (attacker && attacker.alive && this.isHostile(attacker, target)) {
      const worth = Math.max(1, (target.def.cost || 60) / 60);
      if (attacker.addXp && attacker.addXp(worth)) {
        attacker.veterancyFlash = 1.2;
        this.fx.text(attacker.x, attacker.y - 20, VET_RANKS[attacker.rank].name.toUpperCase(), '#ffd76a', 1.4);
        this.events.push({ type: 'promote', x: attacker.x, y: attacker.y, owner: attacker.owner });
      }
      const ap = this.players[attacker.owner];
      if (ap) ap.killed++;
      if (ap?.isHuman && this.commander) {
        const promo = this.commander.awardKill(target.def.cost || 60, target.def.name);
        if (promo) this.events.push({ type: 'commanderPromotion', rank: promo.name });
      }
    }
    if (target.kind === 'unit') this.killUnit(target, true);
    else this.destroyBuilding(target, true);
  }

  killUnit(unit, explode = true) {
    if (unit.dead) return;
    unit.dead = true;
    unit.hp = 0;
    if (unit.garrisonedIn) {
      const b = this.entities.get(unit.garrisonedIn);
      if (b) b.garrison = b.garrison.filter((id) => id !== unit.id);
    }
    if (unit.transport) {
      const t = this.entities.get(unit.transport);
      if (t) t.cargo = t.cargo.filter((id) => id !== unit.id);
    }
    for (const id of [...unit.cargo]) {
      const c = this.entities.get(id);
      if (c) { c.transport = 0; this.killUnit(c, false); }
    }
    if (explode) {
      if (unit.def.category === Category.INFANTRY) {
        this.fx.impactDust(unit.x, unit.y, 1.6);
        this.events.push({ type: 'infantryDown', x: unit.x, y: unit.y });
      } else {
        const big = unit.def.armor === Armor.HEAVY || unit.isAir;
        this.fx.explosion(unit.x, unit.y, big ? 44 : 30, big);
        this.fx.debris(unit.x, unit.y, big ? 14 : 8);
        this.events.push({ type: 'explosion', x: unit.x, y: unit.y, big });
      }
    }
    const p = this.players[unit.owner];
    if (p) p.lost++;
  }

  destroyBuilding(b, explode = true) {
    if (b.dead) return;
    b.dead = true;
    b.hp = 0;
    if (b.def.obstacle) this.grid.setWire(b.tx, b.ty, b.tw, b.th, false);
    else this.grid.occupy(b.tx, b.ty, b.tw, b.th, false);
    for (const id of [...b.garrison]) {
      const u = this.entities.get(id);
      if (!u) continue;
      u.garrisonedIn = 0;
      u.hp = Math.max(1, u.hp * 0.35);
      this._placeNear(u, b.cx, b.cy, b.boundRadius + 20);
    }
    b.garrison.length = 0;
    if (explode) {
      this.fx.explosion(b.cx, b.cy, Math.max(b.halfW, b.halfH) * 1.1, true);
      this.fx.debris(b.cx, b.cy, 16);
      this.events.push({ type: 'explosion', x: b.cx, y: b.cy, big: true });
      if (b.def.explodes) {
        this.splashDamage(b.cx, b.cy, Math.max(b.halfW, b.halfH) + 60, b.def.explodes, Damage.HE, null);
      }
      if (b.def.civilian) {
        const h = this.human;
        h.support = clamp(h.support - ROE.LOSS_PER_DESTROYED, 0, 100);
        this.notices.push({ text: `Civilian structure destroyed — Local Support ${Math.round(h.support)}%`, kind: 'bad' });
      }
      for (let y = b.ty; y < b.ty + b.th; y++)
        for (let x = b.tx; x < b.tx + b.tw; x++)
          if (this.rng.chance(0.7)) this.grid.set(x, y, 4);
    }
    const p = this.players[b.owner];
    if (p) p.lost++;
  }

  _placeNear(unit, x, y, r) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r;
      const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
      if (this.grid.passable(tx, ty, unit.loco) && !this.occupantAt(tx, ty, unit)) {
        unit.x = tx * TILE + TILE / 2; unit.y = ty * TILE + TILE / 2; return;
      }
    }
    unit.x = x; unit.y = y;
  }

  // --- unit actions ---------------------------------------------------------
  capture(unit, b) {
    if (!unit.canAct) return { ok: false, reason: 'no action points' };
    if (!unit.def.abilities?.includes('capture')) return { ok: false, reason: 'cannot capture' };
    if (!b || !b.alive || b.kind !== 'building') return { ok: false, reason: 'no target' };
    if (b.owner === unit.owner) return { ok: false, reason: 'already yours' };
    if (!b.def.capturable && !(b.owner >= 0 && this.isHostile(unit, b) && b.hpFrac < 0.5)) {
      return { ok: false, reason: b.def.capturable === undefined ? 'not capturable' : 'soften it below 50% first' };
    }
    if (b.edgeDistance(unit.x, unit.y) > TILE * 1.6) return { ok: false, reason: 'must be adjacent' };
    if (unit.ap < 3) return { ok: false, reason: 'needs 3 action points' };

    unit.spendAp(3);
    unit.breakEntrenchment();
    b.owner = unit.owner;
    b.queue.length = 0;
    this.notices.push({ text: `${b.def.name} captured`, kind: 'good' });
    this.events.push({ type: 'capture', x: b.cx, y: b.cy, owner: unit.owner });
    if (this.players[unit.owner].isHuman && this.commander) {
      const promo = this.commander.awardCapture(b.def.name);
      if (promo) this.events.push({ type: 'commanderPromotion', rank: promo.name });
    }
    this._updateFog();
    return { ok: true };
  }

  /** Engineers dig fortifications and wire in the field, away from the HQ. */
  fortify(unit, defId, tx, ty) {
    if (!unit.canAct) return { ok: false, reason: 'no action points' };
    if (!unit.def.abilities?.includes('fortify')) return { ok: false, reason: 'not an engineer' };
    const d = defOf(defId);
    if (!d?.fieldBuild) return { ok: false, reason: 'engineers cannot build that' };
    if (unit.ap < 3) return { ok: false, reason: 'needs 3 action points' };
    const near = dist(unit.x, unit.y, (tx + d.size[0] / 2) * TILE, (ty + d.size[1] / 2) * TILE);
    if (near > TILE * 3) return { ok: false, reason: 'too far — move closer' };
    const place = this.canPlace(unit.owner, defId, tx, ty, { ignoreRadius: true });
    if (!place.ok) return place;
    if (!this.canAfford(unit.owner, defId)) return { ok: false, reason: 'not enough oil' };

    this.pay(unit.owner, defId);
    unit.spendAp(3);
    unit.breakEntrenchment();
    const instant = this.players[unit.owner].perks?.instantWorks;
    const b = this.placeBuilding(defId, unit.owner, tx, ty, { constructing: !instant });
    this.events.push({ type: 'fortify', x: b.cx, y: b.cy, owner: unit.owner });
    return { ok: true, building: b };
  }

  repair(unit, b) {
    if (!unit.canAct) return { ok: false, reason: 'no action points' };
    if (!unit.def.abilities?.includes('repair')) return { ok: false, reason: 'cannot repair' };
    if (!b || b.kind !== 'building' || b.owner !== unit.owner) return { ok: false, reason: 'not your structure' };
    if (b.hp >= b.maxHp) return { ok: false, reason: 'undamaged' };
    if (b.edgeDistance(unit.x, unit.y) > TILE * 1.6) return { ok: false, reason: 'must be adjacent' };
    if (unit.ap < 2) return { ok: false, reason: 'needs 2 action points' };
    const cost = Math.ceil(b.maxHp * 0.25 * 0.05);
    if (this.players[unit.owner].res[Res.OIL] < cost) return { ok: false, reason: 'not enough oil' };
    this.players[unit.owner].res[Res.OIL] -= cost;
    unit.spendAp(2);
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.25);
    b.repairPulse = this.time;
    return { ok: true };
  }

  canGarrison(unit, b) {
    if (!unit.def.canGarrison || !b?.alive) return false;
    if (b.garrisonSlots <= 0 || b.garrison.length >= b.garrisonSlots) return false;
    if (b.owner >= 0 && this.isHostile(unit, b)) return false;
    if (b.garrisonHolder != null && b.garrisonHolder !== unit.owner) return false;
    return true;
  }

  garrisonInto(unit, b) {
    if (!unit.canAct) return { ok: false, reason: 'no action points' };
    if (!this.canGarrison(unit, b)) return { ok: false, reason: 'cannot garrison there' };
    if (b.edgeDistance(unit.x, unit.y) > TILE * 1.6) return { ok: false, reason: 'must be adjacent' };
    if (unit.ap < 2) return { ok: false, reason: 'needs 2 action points' };
    unit.spendAp(2);
    b.garrison.push(unit.id);
    unit.garrisonedIn = b.id;
    unit.x = b.cx; unit.y = b.cy;
    unit.breakEntrenchment();
    if (b.owner < 0) b.garrisonHolder = unit.owner;
    this.events.push({ type: 'garrison', x: b.cx, y: b.cy, owner: unit.owner });
    this._updateFog();
    return { ok: true };
  }

  exitGarrison(unit) {
    const b = this.entities.get(unit.garrisonedIn);
    unit.garrisonedIn = 0;
    if (!b) return;
    b.garrison = b.garrison.filter((id) => id !== unit.id);
    if (!b.garrison.length) b.garrisonHolder = undefined;
    this._placeNear(unit, b.cx, b.cy, b.boundRadius + TILE);
  }

  loadInto(transport, unit) {
    if (!unit.canAct) return { ok: false, reason: 'no action points' };
    const space = transport.def.cargoSpace || 0;
    if (!space) return { ok: false, reason: 'not a transport' };
    if (transport.cargo.length >= space) return { ok: false, reason: 'full' };
    if (transport.def.liftsOnly && unit.defId !== transport.def.liftsOnly) {
      return { ok: false, reason: `only lifts ${defOf(transport.def.liftsOnly).name}` };
    }
    if (dist(unit.x, unit.y, transport.x, transport.y) > TILE * 2) return { ok: false, reason: 'must be adjacent' };
    if (unit.ap < 2) return { ok: false, reason: 'needs 2 action points' };
    unit.spendAp(unit.ap);
    transport.cargo.push(unit.id);
    unit.transport = transport.id;
    unit.breakEntrenchment();
    return { ok: true };
  }

  unloadAt(transport, tx, ty) {
    if (!transport.cargo.length) return { ok: false, reason: 'empty' };
    if (transport.ap < 2) return { ok: false, reason: 'needs 2 action points' };
    const out = [];
    transport.spendAp(2);
    for (const id of [...transport.cargo]) {
      const u = this.entities.get(id);
      if (!u) continue;
      u.transport = 0;
      this._placeNear(u, tx * TILE + TILE / 2, ty * TILE + TILE / 2, TILE);
      // Air assault troops step off ready to fight.
      u.ap = u.def.liftable ? Math.max(2, Math.floor(u.apMax / 2)) : 0;
      out.push(u);
    }
    transport.cargo.length = 0;
    this._updateFog();
    return { ok: true, units: out };
  }

  resupply(truck, unit) {
    if (!truck.def.resupply) return { ok: false, reason: 'not a logistics truck' };
    if (truck.ap < truck.def.resupplyAp) return { ok: false, reason: 'needs action points' };
    if (unit.owner !== truck.owner || unit === truck) return { ok: false, reason: 'invalid target' };
    if (dist(truck.x, truck.y, unit.x, unit.y) > truck.def.resupplyRange) return { ok: false, reason: 'out of range' };
    if (unit.ap >= unit.apMax) return { ok: false, reason: 'already fresh' };
    truck.spendAp(truck.def.resupplyAp);
    unit.ap = unit.apMax;
    if (unit.def.sorties) unit.sorties = unit.def.sorties;
    this.events.push({ type: 'resupply', x: unit.x, y: unit.y, owner: unit.owner });
    this.fx.text(unit.x, unit.y - 18, 'RESUPPLIED', '#bfe08a', 1.2);
    return { ok: true };
  }

  /** Airborne infantry drops once, onto any explored tile. */
  paradrop(unit, tx, ty) {
    if (!unit.def.paradrop) return { ok: false, reason: 'cannot paradrop' };
    if (unit.hasParadropped) return { ok: false, reason: 'already dropped' };
    if (!unit.canAct) return { ok: false, reason: 'no action points' };
    if (!this.grid.passable(tx, ty, unit.loco)) return { ok: false, reason: 'cannot land there' };
    if (!this.fog.isExplored(tx, ty)) return { ok: false, reason: 'must be scouted first' };
    if (this.occupantAt(tx, ty, unit)) return { ok: false, reason: 'tile occupied' };
    unit.x = tx * TILE + TILE / 2;
    unit.y = ty * TILE + TILE / 2;
    unit.hasParadropped = true;
    unit.spendAp(Math.max(0, unit.ap - 2));     // lands with a little left
    unit.breakEntrenchment();
    this.fx.explosion(unit.x, unit.y, 16, false);
    this.events.push({ type: 'paradrop', x: unit.x, y: unit.y, owner: unit.owner });
    this._updateFog();
    return { ok: true };
  }

  // --- production and construction ------------------------------------------
  hasBuilding(owner, defId) {
    return this.buildings.some((b) => b.alive && b.built && b.owner === owner && b.defId === defId);
  }

  canProduce(owner, defId) {
    const d = defOf(defId);
    if (!d) return false;
    const src = this.buildings.find(
      (b) => b.alive && b.built && b.owner === owner && b.def.produces?.includes(defId));
    if (!src) return false;
    if (d.requires) for (const r of d.requires) if (!this.hasBuilding(owner, r)) return false;
    return true;
  }

  queueUnit(owner, defId) {
    const d = defOf(defId);
    if (!this.canProduce(owner, defId)) return { ok: false, reason: 'no production building' };
    if (!this.canAfford(owner, defId)) return { ok: false, reason: `not enough ${d.res}` };
    const src = this.buildings
      .filter((b) => b.alive && b.built && b.owner === owner && b.def.produces?.includes(defId))
      .sort((a, b) => a.queue.length - b.queue.length)[0];
    this.pay(owner, defId);
    src.queue.push({ defId, turnsLeft: d.buildTurns, total: d.buildTurns });
    return { ok: true, turns: d.buildTurns };
  }

  cancelQueued(owner, defId) {
    for (const b of this.buildings) {
      if (b.owner !== owner) continue;
      const i = b.queue.findIndex((j) => j.defId === defId);
      if (i >= 0) {
        this.players[owner].res[defOf(defId).res] += this.costOf(owner, defId);
        b.queue.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  canPlace(owner, defId, tx, ty, { ignoreRadius = false } = {}) {
    const d = defOf(defId);
    if (!d || d.kind !== 'building') return { ok: false, reason: 'invalid' };
    const g = this.grid;
    for (let y = ty; y < ty + d.size[1]; y++) {
      for (let x = tx; x < tx + d.size[0]; x++) {
        if (!g.inBounds(x, y)) return { ok: false, reason: 'off map' };
        if (g.blocked[y * g.w + x]) return { ok: false, reason: 'blocked' };
        if (g.wire[y * g.w + x]) return { ok: false, reason: 'wire in the way' };
        if (TERRAIN[g.terrain[y * g.w + x]].cost[0] === Infinity) return { ok: false, reason: 'impassable ground' };
      }
    }
    const cx = (tx + d.size[0] / 2) * TILE, cy = (ty + d.size[1] / 2) * TILE;
    if (!d.isHQ && !ignoreRadius) {
      const near = this.buildings.some((b) =>
        b.alive && b.built && b.owner === owner && b.def.buildRadius &&
        dist(cx, cy, b.cx, b.cy) <= b.def.buildRadius * TILE);
      if (!near) return { ok: false, reason: 'outside build radius' };
    }
    for (const u of this.units) {
      if (!u.alive || u.isAir || u.garrisonedIn || u.transport) continue;
      if (Math.abs(u.x - cx) < (d.size[0] * TILE) / 2 + u.radius &&
          Math.abs(u.y - cy) < (d.size[1] * TILE) / 2 + u.radius) {
        return { ok: false, reason: 'units in the way' };
      }
    }
    return { ok: true };
  }

  startStructure(owner, defId, tx, ty) {
    const check = this.canPlace(owner, defId, tx, ty);
    if (!check.ok) return check;
    if (!this.canAfford(owner, defId)) return { ok: false, reason: 'not enough oil' };
    this.pay(owner, defId);
    const instant = this.players[owner].perks?.instantWorks && defOf(defId).fieldBuild;
    const b = this.placeBuilding(defId, owner, tx, ty, { constructing: !instant });
    if (this.players[owner].isHuman && this.commander) this.commander.awardBuild(defOf(defId).name);
    return { ok: true, building: b };
  }

  spawnFromBuilding(b, defId) {
    const d = defOf(defId);
    for (let r = 1; r <= 6; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * TAU;
        const tx = Math.round(b.tx + b.tw / 2 + Math.cos(ang) * (Math.max(b.tw, b.th) / 2 + r));
        const ty = Math.round(b.ty + b.th / 2 + Math.sin(ang) * (Math.max(b.tw, b.th) / 2 + r));
        if (!this.grid.passable(tx, ty, d.loco)) continue;
        if (this.occupantAt(tx, ty, { isAir: d.loco === AIR })) continue;
        const u = this.spawnUnit(defId, b.owner, tx * TILE + TILE / 2, ty * TILE + TILE / 2,
          this.rng.range(0, TAU));
        this.events.push({ type: 'unitReady', owner: b.owner, defId, x: u.x, y: u.y });
        return u;
      }
    }
    return null;
  }

  onBuildingComplete(b) {
    if (b.owner >= 0) this.events.push({ type: 'buildComplete', owner: b.owner, defId: b.defId, x: b.cx, y: b.cy });
    this._updateFog();
  }

  sellBuilding(b) {
    if (!b.alive || b.def.isHQ) return false;
    this.players[b.owner].res[Res.OIL] += Math.round(b.def.cost * 0.5 * b.hpFrac);
    this.destroyBuilding(b, false);
    return true;
  }

  // --- queries --------------------------------------------------------------
  unitsOf(owner) { return this.units.filter((u) => u.alive && u.owner === owner); }
  buildingsOf(owner) { return this.buildings.filter((b) => b.alive && b.owner === owner); }

  /** Everything this unit could legally shoot right now. */
  attackableTargets(unit) {
    const out = [];
    for (const e of [...this.units, ...this.buildings]) {
      if (!e.alive || e.garrisonedIn || e.transport) continue;
      if (!this.isHostile(unit, e)) continue;
      if (e.kind === 'unit' && !this.fog.isVisibleWorld(e.x, e.y)) continue;
      if (this.canAttack(unit, e).ok) out.push(e);
    }
    return out;
  }

  selectableAt(x, y, pad = 10) {
    let unit = null, ud = Infinity, building = null;
    for (const u of this.units) {
      if (!u.alive || u.garrisonedIn || u.transport) continue;
      const r = u.radius + pad;
      const d = dist2(x, y, u.x, u.y);
      if (d < r * r && d < ud) { ud = d; unit = u; }
    }
    if (unit) return unit;
    for (const b of this.buildings) {
      if (!b.alive) continue;
      if (Math.abs(x - b.cx) <= b.halfW && Math.abs(y - b.cy) <= b.halfH) building = b;
    }
    return building;
  }

  // --- per-frame (animation only) -------------------------------------------
  tick(dt) {
    this.time += dt;
    for (const u of this.units) u.update(this, dt);
    for (const b of this.buildings) b.update(this, dt);
    this.fx.update(dt);
    this._fogTimer -= dt;
    if (this._fogTimer <= 0) { this._fogTimer = 0.2; this._updateFog(); }
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    if (this.buildings.some((b) => b.dead)) this.buildings = this.buildings.filter((b) => !b.dead);
  }

  /** True while any unit is still visually moving. */
  get animating() { return this.units.some((u) => u.alive && u.moving); }

  _updateFog() {
    const viewers = [];
    const me = this.humanIndex;
    for (const u of this.units) {
      if (!u.alive || u.owner !== me || u.transport) continue;
      viewers.push({ x: u.x, y: u.y, vision: u.visionRange });
    }
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== me) continue;
      viewers.push({ x: b.cx, y: b.cy, vision: b.vision });
    }
    this.fog.update(viewers);
  }
}
