import { Res, UPKEEP_RESOURCE, STARVATION, ENTRENCH, Category, VET_RANKS } from './rules.js';
import { defOf } from './defs.js';
import { TILE } from '../world/terrain.js';
import { dist } from '../core/math.js';

/**
 * Turn sequencer.
 *
 * The order of the turn start matters and is fixed: income lands before
 * upkeep is charged, so a resource site captured last turn can pay for the
 * army it was captured to support. Starvation degrades rather than deletes —
 * an army you cannot feed fights at half action points and bleeds, which is
 * recoverable if you go and take a water plant.
 */
export class TurnManager {
  constructor(world) {
    this.w = world;
    this.turn = 1;
    this.activeIndex = 0;
    this.phase = 'idle';            // 'idle' | 'active' | 'resolving'
    this.log = [];                  // per-turn report for the interface
    this.onEvent = null;
  }

  get active() { return this.w.players[this.activeIndex]; }
  get isPlayerTurn() { return this.activeIndex === this.w.humanIndex; }

  _emit(type, data) {
    if (this.onEvent) this.onEvent({ type, ...data });
  }

  /** Open the first turn of the mission. */
  begin() {
    this.turn = 1;
    this.activeIndex = this.w.humanIndex;
    this.startTurn();
  }

  // --- turn start -----------------------------------------------------------
  startTurn() {
    const p = this.active;
    this.log = [];
    p.deficits = {};

    this._income(p);
    this._upkeep(p);
    this._starvation(p);
    this._resetActionPoints(p);
    this._advanceProduction(p);
    this._advanceConstruction(p);
    this._entrench(p);
    this._rearm(p);

    this.phase = 'active';
    this._emit('turnStart', { player: p.index, turn: this.turn, log: this.log });
  }

  _income(p) {
    const mult = p.perks ? p.perks.incomeMult : 1;
    const gained = { fuel: 0, water: 0, oil: 0 };
    for (const b of this.w.buildings) {
      if (!b.alive || !b.built || b.owner !== p.index) continue;
      const y = b.def.yields;
      if (!y) continue;
      gained[y] += b.def.yieldAmount;
    }
    for (const r of Object.values(Res)) {
      const amount = Math.round(gained[r] * mult);
      if (amount > 0) {
        p.res[r] += amount;
        this.log.push({ kind: 'income', res: r, amount });
      }
    }
    p.lastIncome = gained;
  }

  _upkeep(p) {
    const mult = p.perks ? p.perks.upkeepMult : 1;
    const owed = { fuel: 0, water: 0, oil: 0 };

    for (const u of this.w.units) {
      if (!u.alive || u.owner !== p.index) continue;
      owed[UPKEEP_RESOURCE[u.def.category]] += u.def.upkeep || 0;
    }
    for (const b of this.w.buildings) {
      if (!b.alive || b.owner !== p.index) continue;
      owed[Res.OIL] += b.def.upkeep || 0;
    }

    for (const r of Object.values(Res)) {
      const bill = Math.round(owed[r] * mult);
      if (bill <= 0) continue;
      if (p.res[r] >= bill) {
        p.res[r] -= bill;
        this.log.push({ kind: 'upkeep', res: r, amount: bill });
      } else {
        const short = bill - p.res[r];
        p.res[r] = 0;
        p.deficits[r] = short;
        this.log.push({ kind: 'deficit', res: r, amount: short });
      }
    }
    p.lastUpkeep = owed;
  }

  /** Units whose resource is in deficit take attrition and fight sluggishly. */
  _starvation(p) {
    if (!Object.keys(p.deficits).length) return;
    let hurt = 0;
    for (const u of this.w.units) {
      if (!u.alive || u.owner !== p.index) continue;
      const r = UPKEEP_RESOURCE[u.def.category];
      if (!p.deficits[r]) continue;
      u.starved = true;
      const dmg = u.maxHp * STARVATION.attrition;
      u.hp -= dmg;
      hurt++;
      if (u.hp <= 0) this.w.killUnit(u, false);
    }
    if (hurt) this.log.push({ kind: 'attrition', amount: hurt });
  }

  _resetActionPoints(p) {
    const perks = p.perks;
    for (const u of this.w.units) {
      if (!u.alive || u.owner !== p.index) continue;
      const r = UPKEEP_RESOURCE[u.def.category];
      u.starved = !!p.deficits[r];

      let ap = u.def.ap + VET_RANKS[u.rank].ap;
      if (perks) {
        if (u.def.category === Category.INFANTRY) ap += perks.infantryAp;
        else if (u.def.category === Category.VEHICLE) ap += perks.vehicleAp;
      }
      if (u.starved) ap = Math.max(1, Math.floor(ap * STARVATION.apMultiplier));

      u.apMax = ap;
      u.ap = ap;
      u.movedThisTurn = false;
      u.attackedThisTurn = false;
      u.hasActed = false;
    }
  }

  _advanceProduction(p) {
    for (const b of this.w.buildings) {
      if (!b.alive || !b.built || b.owner !== p.index || !b.queue.length) continue;
      const job = b.queue[0];
      job.turnsLeft--;
      if (job.turnsLeft <= 0) {
        b.queue.shift();
        const u = this.w.spawnFromBuilding(b, job.defId);
        if (u) {
          // Fresh units have not had a turn start; give them their points now.
          u.apMax = u.def.ap;
          u.ap = 0;                      // but they arrive having used the turn
          this.log.push({ kind: 'ready', defId: job.defId });
        }
      }
    }
  }

  _advanceConstruction(p) {
    for (const b of this.w.buildings) {
      if (!b.alive || b.built || b.owner !== p.index) continue;
      b.turnsLeft--;
      b.constructing = 1 - b.turnsLeft / Math.max(1, b.def.buildTurns);
      if (b.turnsLeft <= 0) {
        b.built = true;
        b.constructing = 1;
        b.hp = b.maxHp;
        this.w.onBuildingComplete(b);
        this.log.push({ kind: 'built', defId: b.defId });
      }
    }
  }

  /** Infantry that stayed put and did not shoot digs in. */
  _entrench(p) {
    for (const u of this.w.units) {
      if (!u.alive || u.owner !== p.index || !u.def.entrenches) continue;
      if (u.garrisonedIn || u.transport) { u.entrench = 0; continue; }
      if (u.heldPosition) {
        u.entrench = Math.min(ENTRENCH.max, u.entrench + ENTRENCH.perTurn);
      }
      u.heldPosition = true;          // cleared the moment it moves or fires
    }
  }

  /** Jets sitting on an airfield get their sortie back. */
  _rearm(p) {
    const pads = this.w.buildings.filter(
      (b) => b.alive && b.built && b.owner === p.index && b.def.rearms);
    for (const u of this.w.units) {
      if (!u.alive || u.owner !== p.index || !u.def.sorties) continue;
      const home = pads.some((b) => b.edgeDistance(u.x, u.y) < TILE * 2.5);
      if (home) {
        if (u.sorties < u.def.sorties + (p.perks ? p.perks.extraSorties : 0)) {
          u.sorties = u.def.sorties + (p.perks ? p.perks.extraSorties : 0);
          this.log.push({ kind: 'rearmed', defId: u.defId });
        }
        u.needsRearm = false;
      } else if (u.sorties <= 0) {
        u.needsRearm = true;
      }
    }
  }

  // --- turn end -------------------------------------------------------------
  /** @returns the index of the side whose turn it now is. */
  endTurn() {
    this.phase = 'resolving';
    this._emit('turnEnd', { player: this.activeIndex, turn: this.turn });

    // Anything that did not move or fire this turn counts as holding.
    for (const u of this.w.units) {
      if (!u.alive || u.owner !== this.activeIndex) continue;
      if (u.movedThisTurn || u.attackedThisTurn) u.heldPosition = false;
    }

    const n = this.w.players.length;
    const wasHuman = this.isPlayerTurn;
    this.activeIndex = (this.activeIndex + 1) % n;
    if (this.activeIndex === this.w.humanIndex) this.turn++;
    if (wasHuman && this.w.commander) this.w.commander.awardTurn();

    this.startTurn();
    return this.activeIndex;
  }

  /** Units on the active side that still have points to spend. */
  unitsWithActions() {
    return this.w.units.filter(
      (u) => u.alive && u.owner === this.activeIndex && !u.garrisonedIn && u.ap > 0);
  }

  allDone() { return this.unitsWithActions().length === 0; }
}
