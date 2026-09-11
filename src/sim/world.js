import { clamp, dist, dist2, makeRng, formationSlots, TAU } from '../core/math.js';
import { Grid } from '../world/grid.js';
import { Pathfinder } from '../world/pathfinder.js';
import { Fog } from '../world/fog.js';
import { TILE, TERRAIN, FOOT, WHEEL, TRACK } from '../world/terrain.js';
import { Unit, Building, Order, resetIds } from './entity.js';
import { UNITS, BUILDINGS, POWERS, defOf, FACTION } from './defs.js';
import {
  computeDamage, Armor, Damage, ROE, roeTier, VET_RANKS,
  LOW_POWER_PRODUCTION, LOW_POWER_DEFENSE, GARRISON_BLEED,
} from './rules.js';
import { Fx } from './fx.js';

export class Player {
  constructor(index, faction, isHuman, name) {
    this.index = index;
    this.faction = faction;
    this.isHuman = isHuman;
    this.name = name;
    this.supply = 0;
    this.earned = 0;
    this.spent = 0;
    this.powerGen = 0;
    this.powerUse = 0;
    this.support = ROE.START;     // Local Support, human player only
    this.allies = new Set([index]);
    this.powerCooldowns = {};
    this.unlocked = new Set();
    this.lost = 0;
    this.killed = 0;
    this.defeated = false;
  }
  get powerBalance() { return this.powerGen - this.powerUse; }
  get lowPower() { return this.powerGen < this.powerUse; }
}

export class SupplyCache {
  constructor(id, x, y, amount) {
    this.id = id;
    this.x = x; this.y = y;
    this.amount = amount;
    this.initial = amount;
    this.workedAt = -99;
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
    this.caches = [];
    this.projectiles = [];
    this.strikes = [];
    this.reveals = [];              // temporary recon reveals
    this.players = [];
    this.events = [];               // drained by the audio layer each frame
    this.notices = [];              // drained by the HUD
    this.humanIndex = 0;
    this.gameOver = null;
    this._hash = new Map();
    this._hashCell = 96;
    this._fogTimer = 0;
    this._nextCacheId = 1;
    this._powerDirty = true;
    this.paused = false;
  }

  // --- setup --------------------------------------------------------------
  addPlayer(faction, isHuman, name) {
    const p = new Player(this.players.length, faction, isHuman, name);
    this.players.push(p);
    if (isHuman) this.humanIndex = p.index;
    return p;
  }

  get human() { return this.players[this.humanIndex]; }

  addCache(x, y, amount) {
    const c = new SupplyCache(this._nextCacheId++, x, y, amount);
    this.caches.push(c);
    return c;
  }

  spawnUnit(defId, owner, x, y, angle = 0) {
    const u = new Unit(defId, owner, x, y, angle);
    this.entities.set(u.id, u);
    this.units.push(u);
    return u;
  }

  placeBuilding(defId, owner, tx, ty, { constructing = false } = {}) {
    const b = new Building(defId, owner, tx, ty);
    if (constructing) b.startConstruction();
    this.entities.set(b.id, b);
    this.buildings.push(b);
    this.grid.occupy(tx, ty, b.tw, b.th, true);
    this._powerDirty = true;
    if (!constructing) this.onBuildingComplete(b);
    return b;
  }

  entityById(id) {
    const e = this.entities.get(id);
    return e && e.alive ? e : null;
  }

  cacheById(id) {
    const c = this.caches.find((c) => c.id === id);
    return c && c.amount > 0 ? c : null;
  }

  // --- relations ----------------------------------------------------------
  isHostile(a, b) {
    if (a.owner === b.owner) return false;
    if (b.owner < 0) return false;                   // neutral / civilian
    const pa = this.players[a.owner];
    return !pa.allies.has(b.owner);
  }

  isFriendly(a, b) { return a.owner === b.owner || this.players[a.owner]?.allies.has(b.owner); }

  // --- spatial index ------------------------------------------------------
  _rebuildHash() {
    this._hash.clear();
    const cs = this._hashCell;
    const add = (e) => {
      if (!e.alive || e.garrisonedIn || e.transport) return;
      const key = ((e.y / cs) | 0) * 4096 + ((e.x / cs) | 0);
      let arr = this._hash.get(key);
      if (!arr) { arr = []; this._hash.set(key, arr); }
      arr.push(e);
    };
    for (const u of this.units) add(u);
    for (const b of this.buildings) if (b.alive) {
      // Buildings straddle cells; register every cell they touch.
      const cs2 = this._hashCell;
      for (let gy = ((b.cy - b.halfH) / cs2) | 0; gy <= ((b.cy + b.halfH) / cs2) | 0; gy++)
        for (let gx = ((b.cx - b.halfW) / cs2) | 0; gx <= ((b.cx + b.halfW) / cs2) | 0; gx++) {
          const key = gy * 4096 + gx;
          let arr = this._hash.get(key);
          if (!arr) { arr = []; this._hash.set(key, arr); }
          arr.push(b);
        }
    }
  }

  /** Visit every entity whose cell overlaps the query circle. */
  queryRadius(x, y, r, fn) {
    const cs = this._hashCell;
    const x0 = ((x - r) / cs) | 0, x1 = ((x + r) / cs) | 0;
    const y0 = ((y - r) / cs) | 0, y1 = ((y + r) / cs) | 0;
    const seen = new Set();
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const arr = this._hash.get(gy * 4096 + gx);
        if (!arr) continue;
        for (const e of arr) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          fn(e);
        }
      }
    }
  }

  /**
   * Pick the best hostile target in range. Score weighs how much damage this
   * weapon actually does to that armour class against how far away it is, so
   * rifle squads naturally ignore tanks and AT teams naturally seek them.
   */
  acquireTarget(ent, range) {
    const mounts = ent.kind === 'unit' ? ent.weapons : (ent.def.weapon ? [ent.def.weapon] : []);
    if (!mounts.length) return null;
    const ox = ent.kind === 'building' ? ent.cx : ent.x;
    const oy = ent.kind === 'building' ? ent.cy : ent.y;
    let best = null, bestScore = -1;
    const r2 = range * range;
    this.queryRadius(ox, oy, range, (e) => {
      if (!e.alive || !this.isHostile(ent, e)) return;
      if (e.kind === 'building' && e.def.civilian) return;       // never auto-target civilians
      const d2 = dist2(ox, oy, e.x, e.y);
      const reach = e.kind === 'building' ? range + e.boundRadius : range;
      if (d2 > reach * reach) return;
      // Score against the best mount we carry for that armour class.
      let mult = 0;
      for (const m of mounts) mult = Math.max(mult, computeDamage(1, m.type, e.def.armor));
      if (mult <= 0.02) return;                                   // cannot meaningfully hurt it
      // Prefer things that shoot back, and things we counter.
      const threat = e.def.weapon ? 1.35 : 1.0;
      const structPenalty = e.kind === 'building' ? 0.45 : 1.0;
      const score = (mult * threat * structPenalty) / (1 + Math.sqrt(d2) / range);
      if (score > bestScore) { bestScore = score; best = e; }
    });
    return best;
  }

  // --- terrain helpers ----------------------------------------------------
  speedMultiplier(x, y, loco) {
    const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
    if (!this.grid.inBounds(tx, ty)) return 1;
    const c = TERRAIN[this.grid.terrain[ty * this.grid.w + tx]].cost[loco];
    return c === Infinity ? 0.25 : 1 / c;
  }

  coverAt(x, y) {
    return this.grid.cover((x / TILE) | 0, (y / TILE) | 0);
  }

  /** Terrain + structure collision for a unit centre. Units do not block. */
  canOccupy(unit, x, y) {
    const g = this.grid;
    const r = unit.radius * 0.7;
    for (const [ox, oy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const tx = ((x + ox) / TILE) | 0, ty = ((y + oy) / TILE) | 0;
      if (!g.inBounds(tx, ty)) return false;
      if (!g.passable(tx, ty, unit.loco)) return false;
    }
    return true;
  }

  // --- power & production -------------------------------------------------
  recomputePower() {
    for (const p of this.players) { p.powerGen = 0; p.powerUse = 0; }
    for (const b of this.buildings) {
      if (!b.alive || b.owner < 0 || !b.built) continue;
      const p = this.players[b.owner];
      if (!p) continue;
      if (b.def.power >= 0) p.powerGen += b.def.power;
      else p.powerUse += -b.def.power;
    }
    this._powerDirty = false;
  }

  buildSpeed(owner) {
    const p = this.players[owner];
    if (!p) return 1;
    return p.lowPower ? LOW_POWER_PRODUCTION : 1;
  }

  defenseRateMultiplier(owner) {
    const p = this.players[owner];
    if (!p) return 1;
    return p.lowPower ? 1 / LOW_POWER_DEFENSE : 1;   // longer cooldown = slower fire
  }

  /** Which structures a player currently has, by def id. */
  hasBuilding(owner, defId) {
    return this.buildings.some((b) => b.alive && b.built && b.owner === owner && b.defId === defId);
  }

  canProduce(owner, defId) {
    const d = defOf(defId);
    if (!d) return false;
    const source = this.buildings.find(
      (b) => b.alive && b.built && b.owner === owner && b.def.produces?.includes(defId));
    if (!source) return false;
    if (d.requires) for (const r of d.requires) if (!this.hasBuilding(owner, r)) return false;
    return true;
  }

  canBuildStructure(owner, defId) {
    const d = defOf(defId);
    if (!d) return false;
    if (!this.buildings.some((b) => b.alive && b.built && b.owner === owner && b.def.isHQ)) return false;
    if (d.requires) for (const r of d.requires) if (!this.hasBuilding(owner, r)) return false;
    return true;
  }

  queueUnit(owner, defId) {
    const d = defOf(defId);
    const p = this.players[owner];
    if (!d || !p || p.supply < d.cost) return false;
    const source = this.buildings
      .filter((b) => b.alive && b.built && b.owner === owner && b.def.produces?.includes(defId))
      .sort((a, b) => a.queue.length - b.queue.length)[0];
    if (!source) return false;
    p.supply -= d.cost;
    p.spent += d.cost;
    source.queue.push({ defId, buildTime: d.buildTime, progress: 0, cost: d.cost });
    return true;
  }

  cancelQueued(owner, defId) {
    for (const b of this.buildings) {
      if (b.owner !== owner || !b.queue.length) continue;
      for (let i = b.queue.length - 1; i >= 0; i--) {
        if (b.queue[i].defId === defId) {
          this.players[owner].supply += b.queue[i].cost;
          b.queue.splice(i, 1);
          return true;
        }
      }
    }
    return false;
  }

  /** Where a finished unit appears — just outside the producing structure. */
  spawnFromBuilding(b, defId) {
    const d = defOf(defId);
    const loco = d.loco;
    let spot = null;
    for (let r = 1; r <= 6 && !spot; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * TAU;
        const tx = Math.round(b.tx + b.tw / 2 + Math.cos(ang) * (Math.max(b.tw, b.th) / 2 + r));
        const ty = Math.round(b.ty + b.th / 2 + Math.sin(ang) * (Math.max(b.tw, b.th) / 2 + r));
        if (this.grid.passable(tx, ty, loco)) { spot = { tx, ty }; break; }
      }
    }
    if (!spot) spot = { tx: b.tx, ty: b.ty + b.th };
    const u = this.spawnUnit(defId, b.owner, spot.tx * TILE + TILE / 2, spot.ty * TILE + TILE / 2,
      this.rng.range(0, TAU));
    if (d.harvester) u.orderHarvest(this);
    else if (b.rally) u.orderMove(this, b.rally.x, b.rally.y);
    this.events.push({ type: 'unitReady', owner: b.owner, defId, x: u.x, y: u.y });
    return u;
  }

  onBuildingComplete(b) {
    this._powerDirty = true;
    if (b.owner >= 0) {
      this.events.push({ type: 'buildComplete', owner: b.owner, x: b.cx, y: b.cy, defId: b.defId });
      if (b.def.grants) for (const g of b.def.grants) this.players[b.owner].unlocked.add(g);
      if (b.def.freeUnit) this.spawnFromBuilding(b, b.def.freeUnit);
    }
  }

  // --- construction placement --------------------------------------------
  /** @returns {{ok:boolean, reason?:string}} */
  canPlace(owner, defId, tx, ty) {
    const d = defOf(defId);
    if (!d || d.kind !== 'building') return { ok: false, reason: 'invalid' };
    const g = this.grid;
    for (let y = ty; y < ty + d.size[1]; y++) {
      for (let x = tx; x < tx + d.size[0]; x++) {
        if (!g.inBounds(x, y)) return { ok: false, reason: 'off map' };
        if (g.blocked[y * g.w + x]) return { ok: false, reason: 'blocked' };
        const cost = TERRAIN[g.terrain[y * g.w + x]].cost[FOOT];
        if (cost === Infinity) return { ok: false, reason: 'impassable ground' };
      }
    }
    // Must sit inside the build radius of an HQ.
    const cx = (tx + d.size[0] / 2) * TILE, cy = (ty + d.size[1] / 2) * TILE;
    const near = this.buildings.some((b) =>
      b.alive && b.built && b.owner === owner && b.def.buildRadius &&
      dist(cx, cy, b.cx, b.cy) <= b.def.buildRadius * TILE);
    if (!near) return { ok: false, reason: 'outside build radius' };
    // Don't allow building on top of units.
    let clear = true;
    this.queryRadius(cx, cy, Math.max(d.size[0], d.size[1]) * TILE * 0.6, (e) => {
      if (e.kind === 'unit' && e.alive) {
        const hw = (d.size[0] * TILE) / 2 + e.radius, hh = (d.size[1] * TILE) / 2 + e.radius;
        if (Math.abs(e.x - cx) < hw && Math.abs(e.y - cy) < hh) clear = false;
      }
    });
    if (!clear) return { ok: false, reason: 'units in the way' };
    return { ok: true };
  }

  startStructure(owner, defId, tx, ty) {
    const d = defOf(defId);
    const p = this.players[owner];
    const check = this.canPlace(owner, defId, tx, ty);
    if (!check.ok) return { ok: false, reason: check.reason };
    if (p.supply < d.cost) return { ok: false, reason: 'insufficient supply' };
    p.supply -= d.cost;
    p.spent += d.cost;
    this.placeBuilding(defId, owner, tx, ty, { constructing: true });
    return { ok: true };
  }

  sellBuilding(b) {
    if (!b.alive || b.def.isHQ) return false;
    this.players[b.owner].supply += Math.round(b.def.cost * 0.5 * b.hpFrac);
    this.destroyBuilding(b, false);
    return true;
  }

  // --- garrison & transport ----------------------------------------------
  canGarrison(unit, b) {
    if (!unit.def.canGarrison || !b.alive) return false;
    if (b.garrisonSlots <= 0) return false;
    if (b.garrison.length >= b.garrisonSlots) return false;
    if (b.owner >= 0 && this.isHostile(unit, b)) return false;   // must clear it first
    // A building held by the other side has to be cleared before you move in.
    if (b.garrisonHolder != null && b.garrisonHolder !== unit.owner &&
        !this.players[unit.owner].allies.has(b.garrisonHolder)) return false;
    return true;
  }

  enterGarrison(unit, b) {
    if (!this.canGarrison(unit, b)) return false;
    b.garrison.push(unit.id);
    unit.garrisonedIn = b.id;
    unit.path = null;
    unit.moving = false;
    unit.x = b.cx; unit.y = b.cy;
    if (b.owner < 0) b.garrisonHolder = unit.owner;
    this.events.push({ type: 'garrison', x: b.cx, y: b.cy, owner: unit.owner });
    return true;
  }

  ejectFromGarrison(unit) {
    const b = this.entities.get(unit.garrisonedIn);
    unit.garrisonedIn = 0;
    if (!b) return;
    b.garrison = b.garrison.filter((id) => id !== unit.id);
    if (!b.garrison.length) b.garrisonHolder = undefined;
    const a = this.rng.range(0, TAU);
    const r = b.boundRadius + 18;
    const nx = b.cx + Math.cos(a) * r, ny = b.cy + Math.sin(a) * r;
    if (this.canOccupy(unit, nx, ny)) { unit.x = nx; unit.y = ny; }
    else { unit.x = b.cx; unit.y = b.cy + b.halfH + 14; }
  }

  loadCargo(transport, unit) {
    if (transport.cargo.length >= (transport.def.cargoSpace || 0)) return false;
    transport.cargo.push(unit.id);
    unit.transport = transport.id;
    unit.path = null;
    unit.moving = false;
    this.events.push({ type: 'load', x: transport.x, y: transport.y, owner: transport.owner });
    return true;
  }

  unloadOne(unit) {
    const t = this.entities.get(unit.transport);
    unit.transport = 0;
    if (!t) return;
    t.cargo = t.cargo.filter((id) => id !== unit.id);
    this._placeNear(unit, t.x, t.y, t.radius + 16);
  }

  unloadAll(transport) {
    for (const id of [...transport.cargo]) {
      const u = this.entities.get(id);
      if (u) this.unloadOne(u);
    }
  }

  _placeNear(unit, x, y, r) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r;
      if (this.canOccupy(unit, nx, ny)) { unit.x = nx; unit.y = ny; return; }
    }
    unit.x = x; unit.y = y;
  }

  // --- capture ------------------------------------------------------------
  canCapture(unit, b) {
    if (!unit.def.abilities?.includes('capture')) return false;
    if (!b.alive || b.kind !== 'building') return false;
    if (b.owner === unit.owner) return false;
    if (b.def.capturable) return true;
    // Enemy structures can be taken once softened up.
    return b.owner >= 0 && this.isHostile(unit, b) && b.hpFrac < 0.55;
  }

  captureBuilding(b, owner) {
    if (b.def.becomes) {
      // An abandoned depot comes back into service as a working one.
      const tx = b.tx, ty = b.ty;
      this.destroyBuilding(b, false, true);
      const nb = this.placeBuilding(b.def.becomes, owner, tx, ty);
      nb.hp = nb.maxHp * 0.7;
      this.notices.push({ text: `${nb.def.name} captured and back in service`, kind: 'good' });
    } else {
      b.owner = owner;
      b.queue.length = 0;
      b.captureFrac = 0;
      this.notices.push({ text: `${b.def.name} captured`, kind: 'good' });
    }
    this._powerDirty = true;
    this.events.push({ type: 'capture', x: b.cx, y: b.cy, owner });
  }

  // --- economy ------------------------------------------------------------
  nearestDropoff(unit) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (!b.alive || !b.built || b.owner !== unit.owner || !b.def.dropoff) continue;
      const d = dist2(unit.x, unit.y, b.cx, b.cy);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  nearestCache(unit) {
    let best = null, bd = Infinity;
    for (const c of this.caches) {
      if (c.amount <= 0) continue;
      const d = dist2(unit.x, unit.y, c.x, c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  deliverSupply(unit, amount) {
    const p = this.players[unit.owner];
    const tier = p.isHuman ? roeTier(p.support) : roeTier(100);
    const got = Math.round(amount * tier.incomeMult);
    p.supply += got;
    p.earned += got;
    this.events.push({ type: 'deliver', x: unit.x, y: unit.y, owner: unit.owner });
    if (p.isHuman) this.fx.text(unit.x, unit.y - 16, `+${got}`, '#bfe08a', 1.0);
  }

  // --- combat -------------------------------------------------------------
  fireWeapon(shooter, target, w) {
    const sx = shooter.kind === 'building' ? shooter.cx : shooter.x;
    const sy = shooter.kind === 'building' ? shooter.cy : shooter.y;
    const ang = shooter.turretAngle;
    const muzzleLen = shooter.kind === 'building' ? shooter.boundRadius * 0.8 : shooter.radius + 4;
    const mx = sx + Math.cos(ang) * muzzleLen;
    const my = sy + Math.sin(ang) * muzzleLen;

    this.fx.muzzleFlash(mx, my, ang, w.type === Damage.AP ? 2.0 : 1);
    this.events.push({ type: 'shot', weapon: w, x: sx, y: sy, defId: shooter.defId });

    if (w.projectile === 'bullet' || w.projectile === 'tracer') {
      // Hitscan with a visible tracer. Spread only affects the visuals so the
      // counter matrix stays the single source of truth for balance.
      const shots = w.shots || 1;
      for (let i = 0; i < shots; i++) {
        const jitter = this.rng.range(-w.spread, w.spread);
        const tx = target.x + Math.cos(ang + jitter + Math.PI / 2) * this.rng.range(-6, 6);
        const ty = target.y + Math.sin(ang + jitter + Math.PI / 2) * this.rng.range(-6, 6);
        this.fx.tracer(mx, my, tx, ty,
          w.projectile === 'tracer' ? '#ffcf6a' : '#ffe9b0',
          0.06, w.projectile === 'tracer' ? 2.0 : 1.2);
      }
      this.fx.impactDust(target.x, target.y, 0.8);
      this.applyDamage(target, w.damage * (w.shots || 1), w.type, shooter);
    } else {
      // Real projectile with travel time: lead the target so fast movers can
      // genuinely dodge a tank round.
      const speed = w.projectile === 'rocket' ? 260 : w.projectile === 'flak' ? 620 : 520;
      const d = dist(sx, sy, target.x, target.y);
      const t = d / speed;
      const lead = target.kind === 'unit' && target.moving ? t : 0;
      const px = target.x + Math.cos(target.angle || 0) * (target.speed || 0) * lead;
      const py = target.y + Math.sin(target.angle || 0) * (target.speed || 0) * lead;
      const a = Math.atan2(py - my, px - mx) + this.rng.range(-w.spread, w.spread);
      this.projectiles.push({
        x: mx, y: my, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        damage: w.damage, type: w.type, splash: w.splash || 0,
        owner: shooter.owner, shooter: shooter.id, target: target.id,
        kind: w.projectile, life: 4, trail: 0, rank: shooter.rank || 0,
      });
    }
  }

  applyDamage(target, base, damageType, attacker) {
    if (!target || !target.alive) return 0;
    const garrisoned = !!target.garrisonedIn;
    const cover = target.kind === 'unit' ? this.coverAt(target.x, target.y) : 0;
    const dmg = computeDamage(base, damageType, target.def.armor, {
      cover, garrisoned,
      attackerRank: attacker ? attacker.rank || 0 : 0,
      defenderRank: target.rank || 0,
    });
    if (dmg <= 0) return 0;

    // Rules of engagement: hurting civilian property costs Local Support.
    if (target.def.civilian && attacker && this.players[attacker.owner]?.isHuman) {
      const p = this.players[attacker.owner];
      const before = p.support;
      p.support = clamp(p.support - (dmg / 100) * ROE.LOSS_PER_100_DAMAGE, 0, 100);
      if (Math.floor(before / 10) !== Math.floor(p.support / 10)) {
        this.notices.push({ text: `Local Support falling — ${Math.round(p.support)}%`, kind: 'bad' });
      }
    }

    target.hp -= dmg;
    target.lastHitAt = this.time;
    target.lastHitBy = attacker ? attacker.id : 0;
    target.flashUntil = this.time + 0.08;

    // Return fire: an idle unit that gets shot will shoot back.
    if (target.kind === 'unit' && attacker && target.isIdle() && target.weapons.length && target.aggro
        && !target.target && this.isHostile(target, attacker)) {
      target.target = attacker.id;
    }

    if (target.kind === 'building' && target.garrison.length) {
      this._damageGarrison(target, base, damageType, attacker);
    }

    if (target.hp <= 0) this._onKilled(target, attacker);
    return dmg;
  }

  /** Share of a structure hit that reaches the men inside it. */
  _damageGarrison(b, base, damageType, attacker) {
    for (const id of [...b.garrison]) {
      const u = this.entities.get(id);
      if (!u || !u.alive) continue;
      const d = computeDamage(base * GARRISON_BLEED, damageType, Armor.INFANTRY, {
        garrisoned: true,
        attackerRank: attacker ? attacker.rank || 0 : 0,
        defenderRank: u.rank || 0,
      });
      if (d <= 0.01) continue;
      u.hp -= d;
      u.lastHitAt = this.time;
      u.flashUntil = this.time + 0.08;
      if (u.hp <= 0) this._onKilled(u, attacker);
    }
  }

  splashDamage(x, y, radius, base, damageType, attacker, exceptId = 0) {
    this.queryRadius(x, y, radius + 24, (e) => {
      if (!e.alive || e.id === exceptId) return;
      const ex = e.kind === 'building' ? e.cx : e.x;
      const ey = e.kind === 'building' ? e.cy : e.y;
      const d = Math.max(0, dist(x, y, ex, ey) - (e.kind === 'building' ? e.boundRadius * 0.6 : 0));
      if (d > radius) return;
      const falloff = 1 - (d / radius) * 0.75;
      this.applyDamage(e, base * falloff, damageType, attacker);
    });
  }

  _onKilled(target, attacker) {
    if (attacker && attacker.alive && this.isHostile(attacker, target)) {
      const worth = Math.max(1, (target.def.cost || 400) / 100);
      if (attacker.addXp(worth)) {
        attacker.veterancyFlash = 1.2;
        this.fx.text(attacker.x, attacker.y - 20, VET_RANKS[attacker.rank].name.toUpperCase(), '#ffd76a', 1.4);
        this.events.push({ type: 'promote', x: attacker.x, y: attacker.y, owner: attacker.owner });
      }
      const ap = this.players[attacker.owner];
      if (ap) ap.killed++;
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
      if (c) { c.transport = 0; this.killUnit(c, false); }   // cargo dies with the carrier
    }
    if (explode) {
      const big = unit.def.armor === Armor.HEAVY;
      if (unit.def.armor === Armor.INFANTRY) {
        this.fx.impactDust(unit.x, unit.y, 1.6);
        this.fx.debris(unit.x, unit.y, 4);
        this.events.push({ type: 'infantryDown', x: unit.x, y: unit.y });
      } else {
        this.fx.explosion(unit.x, unit.y, big ? 44 : 30, big);
        this.fx.debris(unit.x, unit.y, big ? 14 : 8);
        this.events.push({ type: 'explosion', x: unit.x, y: unit.y, big });
      }
    }
    const p = this.players[unit.owner];
    if (p) p.lost++;
  }

  destroyBuilding(b, explode = true, silent = false) {
    if (b.dead) return;
    b.dead = true;
    b.hp = 0;
    this.grid.occupy(b.tx, b.ty, b.tw, b.th, false);
    this._powerDirty = true;

    // Garrison bails out badly wounded rather than dying outright — punishing
    // without being a rage-quit moment.
    for (const id of [...b.garrison]) {
      const u = this.entities.get(id);
      if (!u) continue;
      u.garrisonedIn = 0;
      u.hp = Math.max(1, u.hp * 0.35);
      this._placeNear(u, b.cx, b.cy, b.boundRadius + 20);
    }
    b.garrison.length = 0;

    if (explode && !silent) {
      const chain = b.def.explodes || 0;
      this.fx.explosion(b.cx, b.cy, Math.max(b.halfW, b.halfH) * 1.1, true);
      this.fx.debris(b.cx, b.cy, 18);
      this.events.push({ type: 'explosion', x: b.cx, y: b.cy, big: true, structure: true });
      if (chain > 0) {
        this.splashDamage(b.cx, b.cy, Math.max(b.halfW, b.halfH) + 60, chain, Damage.HE, null);
        this.fx.explosion(b.cx, b.cy, Math.max(b.halfW, b.halfH) * 1.6, true);
      }
      if (b.def.civilian) {
        const human = this.human;
        human.support = clamp(human.support - ROE.LOSS_PER_DESTROYED, 0, 100);
        this.notices.push({ text: `Civilian structure destroyed — Local Support ${Math.round(human.support)}%`, kind: 'bad' });
      }
      // Leave rubble the infantry can use as cover.
      for (let y = b.ty; y < b.ty + b.th; y++)
        for (let x = b.tx; x < b.tx + b.tw; x++)
          if (this.rng.chance(0.7)) this.grid.set(x, y, 4 /* RUBBLE */);
    }
    const p = this.players[b.owner];
    if (p) p.lost++;
  }

  // --- support powers -----------------------------------------------------
  powerReady(owner, id) {
    const p = this.players[owner];
    if (!p || !p.unlocked.has(id)) return false;
    return (p.powerCooldowns[id] || 0) <= this.time;
  }

  powerCooldownFrac(owner, id) {
    const p = this.players[owner];
    const def = POWERS[id];
    const end = p.powerCooldowns[id] || 0;
    if (end <= this.time) return 1;
    return clamp(1 - (end - this.time) / (def.cooldown * this._strikeCdMult(p)), 0, 1);
  }

  _strikeCdMult(p) { return p.isHuman ? roeTier(p.support).strikeCdMult : 1; }

  useAirStrike(owner, x0, y0, x1, y1) {
    if (!this.powerReady(owner, 'air_strike')) return false;
    const p = this.players[owner];
    const def = POWERS.air_strike;
    p.powerCooldowns.air_strike = this.time + def.cooldown * this._strikeCdMult(p);
    const a = Math.atan2(y1 - y0, x1 - x0);
    this.strikes.push({
      x: x0 - Math.cos(a) * 260, y: y0 - Math.sin(a) * 260,
      angle: a, travelled: 0, total: 260 + def.passes * def.spacing + 200,
      owner, nextShotAt: 260, shots: 0, def, speed: 420,
    });
    this.notices.push({ text: 'Strafing run inbound', kind: 'good' });
    this.events.push({ type: 'airInbound', x: x0, y: y0 });
    return true;
  }

  useReconSweep(owner, x, y) {
    if (!this.powerReady(owner, 'recon_sweep')) return false;
    const p = this.players[owner];
    const def = POWERS.recon_sweep;
    p.powerCooldowns.recon_sweep = this.time + def.cooldown * this._strikeCdMult(p);
    this.reveals.push({ x, y, vision: def.radius, until: this.time + def.duration, owner });
    this.notices.push({ text: 'Recon sweep active', kind: 'good' });
    this.events.push({ type: 'recon', x, y });
    return true;
  }

  _updateStrikes(dt) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      const step = s.speed * dt;
      s.travelled += step;
      s.x += Math.cos(s.angle) * step;
      s.y += Math.sin(s.angle) * step;
      this.fx.spawn(s.x, s.y, {
        vx: 0, vy: 0, life: 0.9, r0: 4, r1: 16,
        c0: 'rgba(220,220,220,0.28)', c1: 'rgba(220,220,220,0)',
      });
      while (s.shots < s.def.passes && s.travelled >= s.nextShotAt) {
        const px = s.x + this.rng.range(-9, 9);
        const py = s.y + this.rng.range(-9, 9);
        this.fx.explosion(px, py, 18, false);
        this.splashDamage(px, py, s.def.splash, s.def.damage, s.def.damageType, null);
        this.events.push({ type: 'strafe', x: px, y: py });
        s.shots++;
        s.nextShotAt += s.def.spacing;
      }
      if (s.travelled >= s.total) this.strikes.splice(i, 1);
    }
    for (let i = this.reveals.length - 1; i >= 0; i--)
      if (this.reveals[i].until <= this.time) this.reveals.splice(i, 1);
  }

  // --- projectiles --------------------------------------------------------
  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      p.life -= dt;

      if (p.kind === 'rocket') {
        // Mild guidance so missiles feel like missiles, not thrown rocks.
        const t = this.entityById(p.target);
        if (t) {
          const want = Math.atan2(t.y - p.y, t.x - p.x);
          const cur = Math.atan2(p.vy, p.vx);
          const sp = Math.hypot(p.vx, p.vy);
          let d = want - cur;
          while (d > Math.PI) d -= TAU;
          while (d < -Math.PI) d += TAU;
          const turn = clamp(d, -2.6 * dt, 2.6 * dt);
          p.vx = Math.cos(cur + turn) * sp;
          p.vy = Math.sin(cur + turn) * sp;
        }
        p.trail -= dt;
        if (p.trail <= 0) {
          p.trail = 0.02;
          this.fx.spawn(p.x, p.y, {
            vx: this.rng.range(-6, 6), vy: this.rng.range(-6, 6),
            life: 0.5, r0: 2.4, r1: 7,
            c0: 'rgba(235,230,220,0.55)', c1: 'rgba(200,195,185,0)',
          });
        }
      }

      let hit = null;
      this.queryRadius(nx, ny, 22, (e) => {
        if (hit || !e.alive || e.owner === p.owner) return;
        if (e.garrisonedIn || e.transport) return;
        if (e.kind === 'building') {
          if (Math.abs(nx - e.cx) <= e.halfW && Math.abs(ny - e.cy) <= e.halfH) hit = e;
        } else if (dist2(nx, ny, e.x, e.y) < (e.radius + 4) * (e.radius + 4)) hit = e;
      });

      const tx = (nx / TILE) | 0, ty = (ny / TILE) | 0;
      const offMap = !this.grid.inBounds(tx, ty);

      if (hit || offMap || p.life <= 0) {
        const ix = hit ? (hit.kind === 'building' ? nx : hit.x) : nx;
        const iy = hit ? (hit.kind === 'building' ? ny : hit.y) : ny;
        const shooter = this.entities.get(p.shooter);
        if (hit) this.applyDamage(hit, p.damage, p.type, shooter);
        if (p.splash > 0) {
          // The direct hit already paid full price; splash is for everyone else.
          this.splashDamage(ix, iy, p.splash, p.damage * 0.6, Damage.HE, shooter, hit ? hit.id : 0);
          this.fx.explosion(ix, iy, p.splash * 0.9, false);
          this.events.push({ type: 'explosion', x: ix, y: iy, big: false });
        } else {
          this.fx.impactDust(ix, iy, 1.2);
          if (!hit) this.events.push({ type: 'impact', x: ix, y: iy });
        }
        this.projectiles.splice(i, 1);
        continue;
      }
      p.x = nx; p.y = ny;
    }
  }

  // --- unit separation ----------------------------------------------------
  /** Soft body separation so squads spread out instead of stacking. */
  _separate(dt) {
    const cs = this._hashCell;
    for (const u of this.units) {
      if (!u.alive || u.garrisonedIn || u.transport) continue;
      let px = 0, py = 0, n = 0;
      this.queryRadius(u.x, u.y, u.radius * 2.4, (e) => {
        if (e === u || e.kind !== 'unit' || !e.alive) return;
        if (e.garrisonedIn || e.transport) return;
        const minD = u.radius + e.radius;
        const dx = u.x - e.x, dy = u.y - e.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 < 0.0001) return;
        // Tracked crushers roll over infantry rather than being pushed by it.
        if (u.def.crusher && e.def.crushable && u.moving &&
            e.owner !== u.owner && d2 < (u.radius * 0.75) ** 2) {
          this.applyDamage(e, 9999, Damage.HE, u);
          this.events.push({ type: 'crush', x: e.x, y: e.y });
          return;
        }
        const d = Math.sqrt(d2);
        const push = (minD - d) / minD;
        px += (dx / d) * push;
        py += (dy / d) * push;
        n++;
      });
      if (!n) continue;
      const strength = (u.moving ? 42 : 26) * dt;
      const nx = u.x + px * strength, ny = u.y + py * strength;
      if (this.canOccupy(u, nx, ny)) { u.x = nx; u.y = ny; }
    }
  }

  // --- orders from the player --------------------------------------------
  issueMove(units, x, y, attackMove = false) {
    const movers = units.filter((u) => u.alive && u.def.speed > 0);
    if (!movers.length) return;
    const spacing = movers.length > 1
      ? Math.max(22, movers.reduce((a, u) => a + u.radius, 0) / movers.length * 2.6) : 0;
    const slots = formationSlots(x, y, movers.length, spacing);
    // Assign the nearest slot to the nearest unit so formations do not cross.
    const order = movers.map((u, i) => ({ u, i, d: dist2(u.x, u.y, x, y) }))
      .sort((a, b) => a.d - b.d);
    order.forEach((o, k) => {
      const s = slots[k] || { x, y };
      o.u.orderMove(this, s.x, s.y, attackMove);
    });
  }

  // --- main tick ----------------------------------------------------------
  tick(dt) {
    if (this.paused || this.gameOver) { this.fx.update(dt); return; }
    this.time += dt;
    if (this._powerDirty) this.recomputePower();

    this._rebuildHash();

    for (const u of this.units) u.update(this, dt);
    for (const b of this.buildings) b.update(this, dt);

    this._separate(dt);
    this._updateProjectiles(dt);
    this._updateStrikes(dt);
    this.fx.update(dt);

    // Local Support slowly recovers when you stop breaking things.
    const h = this.human;
    if (h && h.support < 100) h.support = clamp(h.support + (ROE.REGEN_PER_MIN / 60) * dt, 0, 100);

    // Burning structures smoke.
    for (const b of this.buildings) {
      if (!b.alive || b.hpFrac > 0.55) continue;
      b.smokeTimer -= dt;
      if (b.smokeTimer <= 0) {
        b.smokeTimer = 0.12 + b.hpFrac * 0.5;
        this.fx.smoke(b.cx + this.rng.range(-b.halfW, b.halfW), b.cy + this.rng.range(-b.halfH, b.halfH), 1.4);
      }
    }

    this._fogTimer -= dt;
    if (this._fogTimer <= 0) {
      this._fogTimer = 0.125;
      this._updateFog();
    }

    this._reap();
  }

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
    for (const r of this.reveals) if (r.owner === me) viewers.push(r);
    this.fog.update(viewers);
  }

  _reap() {
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    if (this.buildings.some((b) => b.dead)) this.buildings = this.buildings.filter((b) => !b.dead);
    // Entity map keeps dead ids briefly so in-flight references resolve to null
    // via entityById(); prune occasionally to stop it growing forever.
    if (this.entities.size > 600) {
      for (const [id, e] of this.entities) if (e.dead) this.entities.delete(id);
    }
  }

  // --- queries used by UI / missions --------------------------------------
  unitsOf(owner) { return this.units.filter((u) => u.alive && u.owner === owner); }
  buildingsOf(owner) { return this.buildings.filter((b) => b.alive && b.owner === owner); }

  selectableAt(x, y, owner, pad = 8) {
    let unit = null, ud = Infinity, building = null;
    this.queryRadius(x, y, 56, (e) => {
      if (!e.alive) return;
      if (e.kind === 'unit') {
        if (e.garrisonedIn || e.transport) return;
        const r = e.radius + pad;
        const d = dist2(x, y, e.x, e.y);
        if (d < r * r && d < ud) { ud = d; unit = e; }
      } else if (Math.abs(x - e.cx) <= e.halfW && Math.abs(y - e.cy) <= e.halfH) {
        building = e;
      }
    });
    return unit || building;
  }

  unitsInBox(x0, y0, x1, y1, owner) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1);
    const ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    return this.units.filter((u) =>
      u.alive && u.owner === owner && !u.garrisonedIn && !u.transport &&
      u.x >= lx && u.x <= hx && u.y >= ly && u.y <= hy);
  }
}
