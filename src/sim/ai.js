import { dist, dist2 } from '../core/math.js';
import { TILE } from '../world/terrain.js';
import { Pathfinder } from '../world/pathfinder.js';
import { defOf } from './defs.js';
import { Category, Res, computeDamage } from './rules.js';

/**
 * Opposing-force commander, turn-based.
 *
 * It plays its whole turn in one call: every unit picks the single best action
 * available to it, in a deliberate order — shoot what you can already kill,
 * capture what is undefended, then close on the objective. It does not cheat
 * with vision; it reacts to what its own units can see.
 */
export class AiCommander {
  constructor(world, owner, opts = {}) {
    this.w = world;
    this.owner = owner;
    this.difficulty = opts.difficulty ?? 1;
    this.homePoint = opts.homePoint || null;
    this.objectives = opts.objectives || [];
    this.composition = opts.composition || {
      militia: 3, rpg_team: 2.5, rg_mortar: 1, technical: 1.2,
      saqr_ifv: 1.2, asad_mbt: 1.4, aa_track: 0.8,
    };
    this.maxArmy = opts.maxArmy ?? 18;
    this.aggression = opts.aggression ?? 0.6;   // 0 = turtle, 1 = all-in
    this.income = opts.income || { fuel: 40, water: 40, oil: 30 };
    this.enabled = true;
    this.lastReport = [];
  }

  get player() { return this.w.players[this.owner]; }

  /** Play the entire turn. Returns a short report for the interface. */
  takeTurn() {
    if (!this.enabled) return [];
    const report = [];
    const p = this.player;

    // Off-map logistics stand in for the Guard running its own supply lines.
    for (const r of Object.values(Res)) {
      p.res[r] += Math.round((this.income[r] || 0) * this.difficulty);
    }

    this._produce(report);

    // Act with the heaviest units first: they set the shape of the turn and
    // the light stuff should react to where the armour ended up.
    const units = this.w.unitsOf(this.owner)
      .filter((u) => u.canAct && !u.garrisonedIn)
      .sort((a, b) => (b.def.cost || 0) - (a.def.cost || 0));

    for (const u of units) this._actWith(u, report);
    this.lastReport = report;
    return report;
  }

  _produce(report) {
    const p = this.player;
    const army = this.w.unitsOf(this.owner).filter((u) => u.weapons.length);
    if (army.length >= this.maxArmy) return;

    const counts = {};
    for (const u of army) counts[u.defId] = (counts[u.defId] || 0) + 1;
    const totalW = Object.values(this.composition).reduce((a, b) => a + b, 0);

    // Build whatever the force is furthest short of, among things we can pay for.
    let want = null, worst = -Infinity;
    for (const [id, weight] of Object.entries(this.composition)) {
      if (!this.w.canProduce(this.owner, id)) continue;
      if (!this.w.canAfford(this.owner, id)) continue;
      const target = (weight / totalW) * Math.max(army.length + 1, 6);
      const deficit = target - (counts[id] || 0);
      if (deficit > worst) { worst = deficit; want = id; }
    }
    if (want && this.w.queueUnit(this.owner, want).ok) {
      report.push({ kind: 'queued', defId: want });
    }
  }

  _actWith(u, report) {
    // 1. Engineers and capturers take anything undefended next to them.
    if (u.def.abilities?.includes('capture') && this._tryCapture(u, report)) return;

    // 2. Shoot from where we stand if there is a worthwhile target.
    const standing = this._bestTarget(u);
    if (standing && standing.score >= 1.0) {
      this._fire(u, standing.target, report);
      if (!u.canAct) return;
    }

    // 3. Otherwise reposition, then shoot if the move opened a shot.
    const moved = this._reposition(u, report);
    if (moved && u.canAct) {
      const after = this._bestTarget(u);
      if (after) this._fire(u, after.target, report);
    } else if (!standing) {
      // Nothing to do and nowhere useful to go: dig in.
      u.heldPosition = true;
    }
  }

  _fire(u, target, report) {
    const r = this.w.attack(u, target);
    if (r.ok) {
      report.push({ kind: 'attack', defId: u.defId, target: target.def.name, damage: Math.round(r.damage) });
    }
  }

  /** Score every legal shot by expected damage against what the target is worth. */
  _bestTarget(u) {
    const options = this.w.attackableTargets(u);
    let best = null, bestScore = 0;
    for (const t of options) {
      const wi = u.pickWeapon(t, computeDamage);
      const w = u.weapons[wi];
      const expected = computeDamage(w.damage * (w.shots || 1), w.type, t.def.armor, {
        entrench: t.entrench || 0,
        garrisoned: !!t.garrisonedIn,
        attackerRank: u.rank, defenderRank: t.rank || 0,
      });
      if (expected <= 0.5) continue;
      const value = (t.def.cost || 60) / 60;
      // Finishing a wounded unit is worth much more than chipping a fresh one.
      const lethal = expected >= t.hp ? 2.5 : 1;
      const threat = t.weapons?.length ? 1.3 : 0.8;
      const score = (expected / Math.max(1, t.maxHp)) * value * lethal * threat * 10;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best ? { target: best, score: bestScore } : null;
  }

  /**
   * Move toward the most useful place: a target we could shoot next turn, or
   * the objective. Picks the reachable tile that best trades distance-to-goal
   * against the cover it offers.
   */
  _reposition(u, report) {
    const goal = this._goalFor(u);
    if (!goal) return false;

    const map = this.w.reachable(u);
    if (map.size <= 1) return false;
    const W = this.w.grid.w;

    let bestTile = -1, bestScore = -Infinity;
    for (const [idx, node] of map) {
      const tx = idx % W, ty = (idx / W) | 0;
      if (this.w.occupantAt(tx, ty, u)) continue;
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      const d = Math.hypot(cx - goal.x, cy - goal.y) / TILE;

      // Closing is good; cover is good; spending every point is not, because a
      // unit with nothing left cannot shoot when it arrives.
      const cover = this.w.grid.cover(tx, ty);
      const apLeft = u.ap - node.ap;
      const canStillFire = apLeft >= (u.weapons[0]?.attackAp ?? 99) ? 1.5 : 0;
      const score = -d * 1.0 + cover * 4 + canStillFire * 2;
      if (score > bestScore) { bestScore = score; bestTile = idx; }
    }
    if (bestTile < 0) return false;
    const tx = bestTile % W, ty = (bestTile / W) | 0;
    if (Math.floor(u.x / TILE) === tx && Math.floor(u.y / TILE) === ty) return false;

    const r = this.w.moveUnit(u, tx, ty);
    if (r.ok) {
      u.finishMove(this.w);          // the AI resolves instantly; no animation wait
      report.push({ kind: 'move', defId: u.defId });
      return true;
    }
    return false;
  }

  _goalFor(u) {
    // Defend the base if something hostile is inside the perimeter.
    if (this.homePoint) {
      const R = TILE * 16;
      let threat = null, bd = Infinity;
      for (const e of this.w.units) {
        if (!e.alive || !this.w.isHostile(u, e)) continue;
        const d = dist2(e.x, e.y, this.homePoint.x, this.homePoint.y);
        if (d < R * R && d < bd) { bd = d; threat = e; }
      }
      if (threat) return { x: threat.x, y: threat.y };
    }

    // Otherwise close on the nearest thing of the player's we can actually hurt.
    let best = null, bd = Infinity;
    for (const e of [...this.w.units, ...this.w.buildings]) {
      if (!e.alive || !this.w.isHostile(u, e)) continue;
      if (e.kind === 'building' && e.def.civilian) continue;
      const ex = e.cx ?? e.x, ey = e.cy ?? e.y;
      const d = dist2(u.x, u.y, ex, ey) * (e.kind === 'building' ? 1.6 : 1);
      if (d < bd) { bd = d; best = { x: ex, y: ey }; }
    }
    if (best && this.aggression > 0.25) return best;
    return this.objectives.length ? this.objectives[0] : best;
  }

  _tryCapture(u, report) {
    for (const b of this.w.buildings) {
      if (!b.alive || b.owner === this.owner) continue;
      if (!b.def.capturable) continue;
      if (b.edgeDistance(u.x, u.y) > TILE * 1.6) continue;
      if (this.w.capture(u, b).ok) {
        report.push({ kind: 'capture', name: b.def.name });
        return true;
      }
    }
    return false;
  }

  /** Mission scripting hook: drop a formation onto the map. */
  spawnWave(spec, tx, ty) {
    const spawned = [];
    let i = 0;
    for (const [defId, count] of Object.entries(spec)) {
      for (let k = 0; k < count; k++) {
        const d = defOf(defId);
        let placed = null;
        for (let r = 0; r < 8 && !placed; r++) {
          for (let a = 0; a < 12 && !placed; a++) {
            const ang = (a / 12) * Math.PI * 2;
            const px = Math.round(tx + Math.cos(ang) * r);
            const py = Math.round(ty + Math.sin(ang) * r);
            if (!this.w.grid.passable(px, py, d.loco)) continue;
            if (this.w.occupantAt(px, py, { isAir: d.category === Category.AIR })) continue;
            placed = { px, py };
          }
        }
        if (!placed) continue;
        const u = this.w.spawnUnit(defId, this.owner,
          placed.px * TILE + TILE / 2, placed.py * TILE + TILE / 2, Math.PI);
        u.ap = 0;                     // arrives having used its turn
        spawned.push(u);
        i++;
      }
    }
    return spawned;
  }
}
