import {
  COMMANDER_RANKS, COMMANDER_XP, commanderRankFor, pointsAtRank,
  PERKS, perkEffects, perkAvailable,
} from './rules.js';

const STORE_KEY = 'talon.commander.v1';

/**
 * The player's own progression, separate from unit veterancy. Units you build
 * are replaceable; the commander is the thing that carries forward, so the
 * perks deliberately change numbers the player already reads off the HUD
 * rather than hidden multipliers.
 */
export class Commander {
  constructor(saved = null) {
    this.xp = 0;
    this.perks = {};
    this.spent = 0;
    this.history = [];         // recent awards, for the after-action report
    if (saved) this.load(saved);
    this._recompute();
  }

  get rankIndex() { return commanderRankFor(this.xp); }
  get rank() { return COMMANDER_RANKS[this.rankIndex]; }
  get rankName() { return this.rank.name; }
  get totalPoints() { return pointsAtRank(this.rankIndex); }
  get availablePoints() { return this.totalPoints - this.spent; }

  /** Progress toward the next rank, 0..1, and the XP still needed. */
  get progress() {
    const next = COMMANDER_RANKS[this.rankIndex + 1];
    if (!next) return { frac: 1, need: 0, next: null };
    const base = this.rank.xp;
    return {
      frac: (this.xp - base) / (next.xp - base),
      need: next.xp - this.xp,
      next: next.name,
    };
  }

  award(amount, reason) {
    if (amount <= 0) return null;
    const before = this.rankIndex;
    this.xp += Math.round(amount);
    this.history.push({ amount: Math.round(amount), reason });
    if (this.history.length > 30) this.history.shift();
    const after = this.rankIndex;
    return after > before ? COMMANDER_RANKS[after] : null;   // promotion, or null
  }

  /** Convenience wrappers so callers do not hand-roll the XP values. */
  awardKill(costOfTarget, name) {
    return this.award(COMMANDER_XP.perKill * Math.max(1, costOfTarget / 60), `Destroyed ${name}`);
  }
  awardCapture(name) { return this.award(COMMANDER_XP.perCapture, `Captured ${name}`); }
  awardObjective(text) { return this.award(COMMANDER_XP.perObjective, text); }
  awardBuild(name) { return this.award(COMMANDER_XP.perStructureBuilt, `Built ${name}`); }
  awardTurn() { return this.award(COMMANDER_XP.perTurnSurvived, 'Turn completed'); }

  canTake(id) {
    return this.availablePoints > 0 && perkAvailable(this.perks, id);
  }

  take(id) {
    if (!this.canTake(id)) return false;
    this.perks[id] = (this.perks[id] || 0) + 1;
    this.spent++;
    this._recompute();
    return true;
  }

  /** Refund everything so the player can rebuild their character. */
  respec() {
    this.perks = {};
    this.spent = 0;
    this._recompute();
  }

  _recompute() { this.effects = perkEffects(this.perks); }

  /** Perk list shaped for the interface, grouped by branch. */
  tree() {
    const branches = {};
    for (const p of Object.values(PERKS)) {
      (branches[p.branch] ||= []).push({
        ...p,
        level: this.perks[p.id] || 0,
        available: this.canTake(p.id),
        locked: !perkAvailable(this.perks, p.id) && (this.perks[p.id] || 0) < p.max,
        requiresText: Object.entries(p.requires || {})
          .map(([r, n]) => `${PERKS[r].name} ${n}`).join(', '),
      });
    }
    return branches;
  }

  save() {
    return { xp: this.xp, perks: this.perks, spent: this.spent };
  }

  load(d) {
    this.xp = d.xp || 0;
    this.perks = { ...(d.perks || {}) };
    this.spent = d.spent || 0;
  }

  /** Persistence is best-effort: private windows and blocked storage must not
   *  break the game, so every access is guarded. */
  persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.save())); } catch { /* unavailable */ }
  }

  static restore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return new Commander(raw ? JSON.parse(raw) : null);
    } catch { return new Commander(); }
  }

  static clear() {
    try { localStorage.removeItem(STORE_KEY); } catch { /* unavailable */ }
  }
}
