// ---------------------------------------------------------------------------
// RULESET — turn-based
// ---------------------------------------------------------------------------
// Five interacting systems decide every engagement:
//
//   1. Action points     - moving and shooting draw on the same pool, so
//                          "advance or fire" is a decision every single turn.
//   2. Armour vs damage  - a hard counter matrix. Nothing is good at everything.
//   3. Cover and works   - entrenchments multiply effective health, and only
//                          indirect fire and air ordnance dig them out.
//   4. Three economies   - fuel, water and oil are not interchangeable, and
//                          each has an upkeep, so overbuilding starves you.
//   5. Commander ranks   - you improve across the campaign, not just your units.

export const Category = {
  INFANTRY: 'infantry',
  VEHICLE: 'vehicle',
  AIR: 'air',
  STRUCTURE: 'structure',
};

export const CATEGORY_INFO = {
  infantry: { name: 'Infantry', short: 'INF', blurb: 'Dismounted troops and mortar teams. Drink water.' },
  vehicle:  { name: 'Vehicles', short: 'VEH', blurb: 'Wheeled and tracked. Burn fuel.' },
  air:      { name: 'Air',      short: 'AIR', blurb: 'Jets and helicopters. Burn fuel hard.' },
  structure:{ name: 'Works',    short: 'WRK', blurb: 'Buildings and fortifications. Consume oil.' },
};

// --- resources -------------------------------------------------------------
export const Res = { FUEL: 'fuel', WATER: 'water', OIL: 'oil' };

export const RESOURCE_INFO = {
  fuel:  { name: 'Fuel',  short: 'FUE', color: '#e0a24f', feeds: 'Vehicles and aircraft' },
  water: { name: 'Water', short: 'WTR', color: '#6ab4d4', feeds: 'Infantry' },
  oil:   { name: 'Oil',   short: 'OIL', color: '#b58ad4', feeds: 'Structures and fortifications' },
};

/** Which resource a category draws its upkeep from. */
export const UPKEEP_RESOURCE = {
  infantry: Res.WATER,
  vehicle: Res.FUEL,
  air: Res.FUEL,
  structure: Res.OIL,
};

// Running dry does not delete your army — it degrades it, which is far more
// interesting to play around than units vanishing.
export const STARVATION = {
  // Per turn in deficit, as a fraction of max health.
  attrition: 0.06,
  // Action points are halved while the relevant resource is in deficit.
  apMultiplier: 0.5,
  damageMultiplier: 0.75,
};

export const Armor = {
  INFANTRY: 0,
  LIGHT: 1,
  HEAVY: 2,
  STRUCTURE: 3,
  AIR: 4,
  FORTIFIED: 5,
};

export const Damage = {
  SMALL_ARMS: 0,
  AUTOCANNON: 1,
  AP: 2,
  ROCKET: 3,
  HE: 4,
  AA: 5,
  BOMB: 6,
  MORTAR: 7,
};

// DAMAGE_TABLE[damageType][armorClass] -> multiplier
export const DAMAGE_TABLE = [
  //  INF    LIGHT  HEAVY  STRUCT  AIR   FORT
  [ 1.00,  0.30,  0.04,  0.10,  0.15,  0.08 ], // SMALL_ARMS
  [ 0.85,  0.90,  0.25,  0.35,  0.60,  0.30 ], // AUTOCANNON
  [ 0.22,  1.00,  1.00,  0.55,  0.00,  0.45 ], // AP (sabot / ATGM)
  [ 0.55,  1.05,  0.95,  0.85,  0.10,  0.80 ], // ROCKET
  [ 1.00,  0.75,  0.40,  1.00,  0.00,  0.70 ], // HE
  [ 0.30,  0.25,  0.05,  0.10,  1.00,  0.10 ], // AA
  [ 1.00,  1.00,  0.80,  0.90,  0.00,  1.10 ], // BOMB / strafing run
  [ 1.10,  0.55,  0.25,  0.85,  0.00,  1.25 ], // MORTAR — the works-breaker
];

export const DAMAGE_NAMES = ['Small Arms', 'Autocannon', 'Armour-Piercing', 'Rocket',
  'High Explosive', 'Anti-Air', 'Ordnance', 'Mortar'];
export const ARMOR_NAMES = ['Infantry', 'Light Armour', 'Heavy Armour', 'Structure',
  'Air', 'Fortification'];

// --- veterancy (per unit) --------------------------------------------------
export const VET_RANKS = [
  { name: 'Regular',  xp: 0,  dmg: 1.00, resist: 1.00, vision: 1.00, ap: 0 },
  { name: 'Veteran',  xp: 2,  dmg: 1.15, resist: 0.90, vision: 1.05, ap: 0 },
  { name: 'Hardened', xp: 6,  dmg: 1.30, resist: 0.80, vision: 1.10, ap: 1 },
  { name: 'Elite',    xp: 14, dmg: 1.50, resist: 0.70, vision: 1.20, ap: 1 },
];

export function rankFor(xp) {
  let r = 0;
  for (let i = VET_RANKS.length - 1; i >= 0; i--) {
    if (xp >= VET_RANKS[i].xp) { r = i; break; }
  }
  return r;
}

// --- commander progression (the player) ------------------------------------
// You rank up across the campaign and spend points on a small, opinionated
// perk tree. Every perk changes a number the player can already see, so the
// effect of a choice is legible rather than a hidden modifier.
export const COMMANDER_RANKS = [
  { name: 'Lieutenant',        xp: 0,    points: 1 },
  { name: 'Captain',           xp: 120,  points: 1 },
  { name: 'Major',             xp: 320,  points: 1 },
  { name: 'Lieutenant Colonel',xp: 640,  points: 2 },
  { name: 'Colonel',           xp: 1100, points: 2 },
  { name: 'Brigadier General', xp: 1750, points: 2 },
  { name: 'Major General',     xp: 2600, points: 3 },
];

export function commanderRankFor(xp) {
  let r = 0;
  for (let i = COMMANDER_RANKS.length - 1; i >= 0; i--) {
    if (xp >= COMMANDER_RANKS[i].xp) { r = i; break; }
  }
  return r;
}

/** Total skill points earned by the given rank index. */
export function pointsAtRank(rankIndex) {
  let n = 0;
  for (let i = 0; i <= rankIndex; i++) n += COMMANDER_RANKS[i].points;
  return n;
}

// Commander experience is awarded for things the player chose to do.
export const COMMANDER_XP = {
  perKill: 8,            // scaled by the target's build cost
  perCapture: 40,
  perObjective: 90,
  perStructureBuilt: 6,
  perTurnSurvived: 3,
};

export const PERKS = {
  logistics: {
    id: 'logistics', name: 'Logistics Corps', branch: 'Support', max: 3,
    desc: 'Every resource site yields +15% per rank.',
    effect: (n) => ({ incomeMult: 1 + 0.15 * n }),
  },
  rationing: {
    id: 'rationing', name: 'Strict Rationing', branch: 'Support', max: 2,
    desc: 'Upkeep costs fall 12% per rank.',
    effect: (n) => ({ upkeepMult: 1 - 0.12 * n }),
  },
  engineering: {
    id: 'engineering', name: 'Field Engineering', branch: 'Support', max: 2,
    requires: { logistics: 1 },
    desc: 'Fortifications and structures cost 20% less oil per rank, and build in one turn.',
    effect: (n) => ({ worksCostMult: 1 - 0.2 * n, instantWorks: n >= 2 }),
  },
  marksmanship: {
    id: 'marksmanship', name: 'Marksmanship', branch: 'Firepower', max: 3,
    desc: 'Infantry damage +10% per rank.',
    effect: (n) => ({ infantryDamage: 1 + 0.1 * n }),
  },
  gunnery: {
    id: 'gunnery', name: 'Gunnery Training', branch: 'Firepower', max: 3,
    desc: 'Vehicle damage +10% per rank.',
    effect: (n) => ({ vehicleDamage: 1 + 0.1 * n }),
  },
  closeAir: {
    id: 'closeAir', name: 'Close Air Support', branch: 'Firepower', max: 2,
    requires: { gunnery: 1 },
    desc: 'Aircraft damage +15% per rank and one extra sortie.',
    effect: (n) => ({ airDamage: 1 + 0.15 * n, extraSorties: n }),
  },
  forcedMarch: {
    id: 'forcedMarch', name: 'Forced March', branch: 'Manoeuvre', max: 2,
    desc: 'All infantry gain +1 action point per rank.',
    effect: (n) => ({ infantryAp: n }),
  },
  motorPool: {
    id: 'motorPool', name: 'Motor Pool Discipline', branch: 'Manoeuvre', max: 2,
    desc: 'All vehicles gain +1 action point per rank.',
    effect: (n) => ({ vehicleAp: n }),
  },
  hardened: {
    id: 'hardened', name: 'Hardened Troops', branch: 'Manoeuvre', max: 3,
    requires: { forcedMarch: 1 },
    desc: 'All units take 6% less damage per rank.',
    effect: (n) => ({ resist: 1 - 0.06 * n }),
  },
};

/** Fold the player's chosen perks into one modifier object. */
export function perkEffects(chosen) {
  const out = {
    incomeMult: 1, upkeepMult: 1, worksCostMult: 1, instantWorks: false,
    infantryDamage: 1, vehicleDamage: 1, airDamage: 1, extraSorties: 0,
    infantryAp: 0, vehicleAp: 0, resist: 1,
  };
  for (const [id, n] of Object.entries(chosen || {})) {
    const p = PERKS[id];
    if (!p || !n) continue;
    Object.assign(out, { ...out, ...p.effect(Math.min(n, p.max)) });
  }
  return out;
}

export function perkAvailable(chosen, id) {
  const p = PERKS[id];
  if (!p) return false;
  if ((chosen[id] || 0) >= p.max) return false;
  for (const [req, lvl] of Object.entries(p.requires || {})) {
    if ((chosen[req] || 0) < lvl) return false;
  }
  return true;
}

// --- cover -----------------------------------------------------------------
// Indexed by Armor. Infantry benefits most; a fortification IS cover, so it
// does not also get terrain cover on top.
export const COVER_SCALE = [1.0, 0.4, 0.35, 0.0, 0.0, 0.0];

// --- entrenchment ----------------------------------------------------------
// Infantry that spends a turn without moving digs in.
export const ENTRENCH = {
  perTurn: 0.5,        // levels gained per stationary turn
  max: 2,              // caps at 2 levels
  coverPerLevel: 0.18, // extra damage reduction per level
};

// --- garrison --------------------------------------------------------------
export const GARRISON_MULT = [
  0.12, // SMALL_ARMS
  0.40, // AUTOCANNON
  0.25, // AP
  2.20, // ROCKET
  2.60, // HE
  0.35, // AA
  3.00, // BOMB
  2.80, // MORTAR
];
export const GARRISON_BLEED = 0.20;

/** The single damage funnel. Nothing bypasses it. */
export function computeDamage(base, damageType, armorClass, opts = {}) {
  const {
    cover = 0, garrisoned = false, entrench = 0,
    attackerRank = 0, defenderRank = 0,
    attackerPerks = null, defenderPerks = null, attackerCategory = null,
    starved = false,
  } = opts;

  let d = base * DAMAGE_TABLE[damageType][armorClass];
  d *= VET_RANKS[attackerRank].dmg;
  d *= VET_RANKS[defenderRank].resist;

  if (attackerPerks) {
    if (attackerCategory === Category.INFANTRY) d *= attackerPerks.infantryDamage;
    else if (attackerCategory === Category.VEHICLE) d *= attackerPerks.vehicleDamage;
    else if (attackerCategory === Category.AIR) d *= attackerPerks.airDamage;
  }
  if (defenderPerks) d *= defenderPerks.resist;
  if (starved) d *= STARVATION.damageMultiplier;

  if (garrisoned) {
    d *= GARRISON_MULT[damageType];
  } else {
    const total = Math.min(0.85, cover * COVER_SCALE[armorClass] + entrench * ENTRENCH.coverPerLevel);
    d *= 1 - total;
  }
  return Math.max(0, d);
}
