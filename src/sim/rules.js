// ---------------------------------------------------------------------------
// RULESET
// ---------------------------------------------------------------------------
// The heart of the game. Three interacting systems decide every fight:
//
//   1. Armour vs damage type  - a hard counter matrix. Rifles cannot hurt a
//      main battle tank; a tank's sabot round is wasted on a rifle squad.
//   2. Cover and garrison     - position multiplies effective health, so the
//      palm grove and the apartment block matter more than unit count.
//   3. Veterancy              - units that survive get meaningfully better,
//      which rewards pulling damaged squads out instead of trading them.
//
// Every value below is tuned so that a mixed-arms force beats a spammed
// single unit type of equal cost, which is the whole point of the genre.

export const Armor = {
  INFANTRY: 0,
  LIGHT: 1,
  HEAVY: 2,
  STRUCTURE: 3,
  AIR: 4,
};

export const Damage = {
  SMALL_ARMS: 0,
  AUTOCANNON: 1,
  AP: 2,
  ROCKET: 3,
  HE: 4,
  AA: 5,
  BOMB: 6,
};

// DAMAGE_TABLE[damageType][armorClass] -> multiplier
export const DAMAGE_TABLE = [
  //  INF    LIGHT  HEAVY  STRUCT  AIR
  [ 1.00,  0.30,  0.04,  0.10,  0.15 ], // SMALL_ARMS
  [ 0.85,  0.90,  0.25,  0.35,  0.60 ], // AUTOCANNON
  [ 0.22,  1.00,  1.00,  0.55,  0.00 ], // AP (sabot / ATGM)
  [ 0.55,  1.05,  0.95,  0.85,  0.10 ], // ROCKET (RPG / Javelin)
  [ 1.00,  0.75,  0.40,  1.00,  0.00 ], // HE (cannon HE, mortar, arty)
  [ 0.30,  0.25,  0.05,  0.10,  1.00 ], // AA
  [ 1.00,  1.00,  0.80,  0.90,  0.00 ], // BOMB / strafing run
];

export const DAMAGE_NAMES = ['Small Arms', 'Autocannon', 'Armour-Piercing', 'Rocket', 'High Explosive', 'Anti-Air', 'Ordnance'];
export const ARMOR_NAMES = ['Infantry', 'Light Armour', 'Heavy Armour', 'Structure', 'Air'];

// --- Veterancy -------------------------------------------------------------
// XP is earned in "points": one point per 100 supply of value destroyed.
export const VET_RANKS = [
  { name: 'Regular',  xp: 0,  dmg: 1.00, resist: 1.00, vision: 1.00, regen: 0.0 },
  { name: 'Veteran',  xp: 2,  dmg: 1.15, resist: 0.90, vision: 1.05, regen: 1.5 },
  { name: 'Hardened', xp: 6,  dmg: 1.30, resist: 0.80, vision: 1.10, regen: 3.0 },
  { name: 'Elite',    xp: 14, dmg: 1.50, resist: 0.70, vision: 1.20, regen: 5.0 },
];

export function rankFor(xp) {
  let r = 0;
  for (let i = VET_RANKS.length - 1; i >= 0; i--) {
    if (xp >= VET_RANKS[i].xp) { r = i; break; }
  }
  return r;
}

// --- Cover -----------------------------------------------------------------
// Infantry gets the full terrain cover value; vehicles are too big to benefit
// as much, and structures do not move so they get none.
export const COVER_SCALE = [1.0, 0.4, 0.35, 0.0, 0.0]; // indexed by Armor

// Garrisoned infantry: very hard to shift with bullets, very soft to explosives.
export const GARRISON_MULT = [
  0.12, // SMALL_ARMS  - walls beat bullets, this is the whole point
  0.40, // AUTOCANNON
  0.25, // AP          - punches through, hits one man
  2.20, // ROCKET      - the correct answer
  2.60, // HE          - the correct answer
  0.35, // AA
  3.00, // BOMB
];

// Fraction of a hit on a garrisoned structure that reaches the men inside,
// before GARRISON_MULT weights it by how suitable the weapon is.
export const GARRISON_BLEED = 0.20;

// --- Power -----------------------------------------------------------------
// A brown-out does not switch your base off, it makes everything sluggish -
// far more interesting to play around than a hard shutdown.
export const LOW_POWER_PRODUCTION = 0.45;   // build speed multiplier
export const LOW_POWER_DEFENSE = 0.50;      // defensive structure rate of fire

// --- Rules of Engagement ---------------------------------------------------
// Collateral damage to civilian structures costs Local Support. This is the
// mechanic that separates this game from a pure tank-rush: the fastest route
// through a built-up area is often the one that loses you the mission.
export const ROE = {
  START: 100,
  // Support lost per 100 points of damage dealt to a civilian structure.
  LOSS_PER_100_DAMAGE: 2.2,
  // Support lost outright for levelling a civilian structure.
  LOSS_PER_DESTROYED: 12,
  REGEN_PER_MIN: 1.5,
  tiers: [
    { min: 80, name: 'Cooperative', incomeMult: 1.10, enemyReinforceMult: 0.0, strikeCdMult: 1.00,
      blurb: 'Locals share cache locations. +10% supply.' },
    { min: 50, name: 'Wary',        incomeMult: 1.00, enemyReinforceMult: 0.0, strikeCdMult: 1.00,
      blurb: 'No effect.' },
    { min: 25, name: 'Hostile',     incomeMult: 0.92, enemyReinforceMult: 1.0, strikeCdMult: 1.25,
      blurb: 'Irregulars reinforce the enemy. -8% supply.' },
    { min: 0,  name: 'Insurgent',   incomeMult: 0.85, enemyReinforceMult: 2.0, strikeCdMult: 1.60,
      blurb: 'Heavy irregular reinforcement. Air support delayed.' },
  ],
};

export function roeTier(support) {
  for (const t of ROE.tiers) if (support >= t.min) return t;
  return ROE.tiers[ROE.tiers.length - 1];
}

/**
 * The single damage funnel. Everything that deals damage in the game routes
 * through here so the counter system can never be bypassed by accident.
 */
export function computeDamage(base, damageType, armorClass, opts = {}) {
  const { cover = 0, garrisoned = false, attackerRank = 0, defenderRank = 0 } = opts;
  let d = base * DAMAGE_TABLE[damageType][armorClass];
  d *= VET_RANKS[attackerRank].dmg;
  d *= VET_RANKS[defenderRank].resist;
  if (garrisoned) {
    d *= GARRISON_MULT[damageType];
  } else if (cover > 0) {
    d *= 1 - cover * COVER_SCALE[armorClass];
  }
  return Math.max(0, d);
}
