import { Armor, Damage } from './rules.js';
import { FOOT, WHEEL, TRACK } from '../world/terrain.js';

// ---------------------------------------------------------------------------
// ROSTER
// ---------------------------------------------------------------------------
// Two orders of battle. The Coalition Task Force is expensive, tough and
// slow to field; the Republican Guard is cheap, numerous and fights best from
// prepared positions. Neither wins by massing one unit - the damage matrix in
// rules.js guarantees a counter exists for everything.
//
// Units: `speed` is world pixels/second (32 px = 1 tile), `range` is world
// pixels, `cooldown` is seconds between shots. A unit may carry a `weapon2`
// (a tank's coaxial machine gun); it picks whichever weapon actually hurts
// the target it is shooting at.

export const FACTION = { CTF: 'CTF', RG: 'RG', CIV: 'CIV' };

export const FACTION_INFO = {
  CTF: { name: 'Coalition Task Force', short: 'CTF', color: '#6f8f5a', accent: '#c8d6a0', trim: '#3d4d31' },
  RG:  { name: 'Republican Guard',     short: 'RG',  color: '#7a6a4e', accent: '#c2a878', trim: '#4a3f2c' },
  CIV: { name: 'Civilian',             short: 'CIV', color: '#9a8f7c', accent: '#cbbfa6', trim: '#5d5445' },
};

const W = (damage, type, cooldown, range, extra = {}) => ({
  damage, type, cooldown, range, minRange: 0, projectile: 'bullet',
  splash: 0, shots: 1, burstDelay: 0.08, spread: 0.03, ...extra,
});

export const UNITS = {
  // --- Coalition Task Force ------------------------------------------------
  rifle_squad: {
    id: 'rifle_squad', name: 'Rifle Squad', short: 'RIF', faction: FACTION.CTF, kind: 'unit',
    cost: 250, buildTime: 6, hp: 160, armor: Armor.INFANTRY, loco: FOOT,
    speed: 42, turnRate: 9, vision: 7, radius: 7, from: 'barracks', tier: 0,
    weapon: W(11, Damage.SMALL_ARMS, 0.85, 150, { shots: 3, spread: 0.10 }),
    canGarrison: true, crushable: true,
    desc: 'Dismounted infantry. Cheap, holds ground, garrisons buildings. Helpless against armour.',
  },
  at_team: {
    id: 'at_team', name: 'AT Team', short: 'AT', faction: FACTION.CTF, kind: 'unit',
    cost: 400, buildTime: 9, hp: 130, armor: Armor.INFANTRY, loco: FOOT,
    speed: 38, turnRate: 7, vision: 8, radius: 7, from: 'barracks', tier: 0,
    weapon: W(72, Damage.ROCKET, 3.2, 230, { minRange: 55, projectile: 'rocket', spread: 0.01 }),
    canGarrison: true, crushable: true,
    desc: 'Guided anti-tank missiles. Deadly to vehicles, slow to reload, must not be caught in the open.',
  },
  engineer: {
    id: 'engineer', name: 'Combat Engineer', short: 'ENG', faction: FACTION.CTF, kind: 'unit',
    cost: 350, buildTime: 8, hp: 110, armor: Armor.INFANTRY, loco: FOOT,
    speed: 40, turnRate: 8, vision: 6, radius: 7, from: 'barracks', tier: 0,
    weapon: null, canGarrison: true, crushable: true,
    abilities: ['capture', 'repair'],
    desc: 'Captures neutral and enemy structures and repairs friendly ones. Unarmed - escort it.',
  },
  humvee: {
    id: 'humvee', name: 'Scout Humvee', short: 'SCT', faction: FACTION.CTF, kind: 'unit',
    cost: 450, buildTime: 8, hp: 260, armor: Armor.LIGHT, loco: WHEEL,
    speed: 96, turnRate: 5, vision: 11, radius: 11, from: 'motor_pool', tier: 0,
    weapon: W(10, Damage.SMALL_ARMS, 0.32, 170),
    desc: 'Fast eyes. Best vision in the force. Shreds infantry in the open, dies to anything heavier.',
  },
  ifv: {
    id: 'ifv', name: 'M2 Dragoon IFV', short: 'IFV', faction: FACTION.CTF, kind: 'unit',
    cost: 800, buildTime: 14, hp: 520, armor: Armor.LIGHT, loco: TRACK,
    speed: 72, turnRate: 3.2, vision: 9, radius: 13, from: 'motor_pool', tier: 1,
    weapon: W(22, Damage.AUTOCANNON, 0.70, 210, { shots: 2, projectile: 'tracer' }),
    cargoSpace: 2, turret: true,
    desc: 'Chain gun mounts a genuine all-rounder. Carries two infantry squads into contact.',
  },
  mbt: {
    id: 'mbt', name: 'M1 Anvil MBT', short: 'MBT', faction: FACTION.CTF, kind: 'unit',
    cost: 1200, buildTime: 20, hp: 1000, armor: Armor.HEAVY, loco: TRACK,
    speed: 58, turnRate: 2.2, vision: 9, radius: 15, from: 'motor_pool', tier: 2,
    weapon: W(115, Damage.AP, 3.0, 235, { projectile: 'shell', splash: 14, spread: 0.012 }),
    weapon2: W(9, Damage.SMALL_ARMS, 0.22, 175, { shots: 2, name: 'coaxial' }),
    turret: true, crusher: true,
    desc: 'The hammer. Nothing the Guard fields survives a frontal engagement. Watch for RPG teams in cover.',
  },
  supply_truck: {
    id: 'supply_truck', name: 'Supply Truck', short: 'SUP', faction: FACTION.CTF, kind: 'unit',
    cost: 500, buildTime: 11, hp: 300, armor: Armor.LIGHT, loco: WHEEL,
    speed: 80, turnRate: 4, vision: 7, radius: 12, from: 'supply_depot', tier: 0,
    weapon: null, carry: 200, harvester: true,
    desc: 'Runs supply from caches back to the depot. Your entire economy. Defend the routes.',
  },

  // --- Republican Guard ----------------------------------------------------
  militia: {
    id: 'militia', name: 'Militia Squad', short: 'MIL', faction: FACTION.RG, kind: 'unit',
    cost: 150, buildTime: 4, hp: 120, armor: Armor.INFANTRY, loco: FOOT,
    speed: 40, turnRate: 9, vision: 6, radius: 7, from: 'rg_barracks', tier: 0,
    weapon: W(9, Damage.SMALL_ARMS, 0.95, 145, { shots: 3, spread: 0.13 }),
    canGarrison: true, crushable: true,
    desc: 'Numerous and expendable. Dangerous only in numbers or behind walls.',
  },
  rpg_team: {
    id: 'rpg_team', name: 'RPG Team', short: 'RPG', faction: FACTION.RG, kind: 'unit',
    cost: 300, buildTime: 7, hp: 120, armor: Armor.INFANTRY, loco: FOOT,
    speed: 38, turnRate: 7, vision: 7, radius: 7, from: 'rg_barracks', tier: 0,
    weapon: W(58, Damage.ROCKET, 3.4, 195, { minRange: 40, projectile: 'rocket', spread: 0.05 }),
    canGarrison: true, crushable: true,
    desc: 'Short-ranged but cheap. In a garrison it trades evenly with a main battle tank.',
  },
  technical: {
    id: 'technical', name: 'Technical', short: 'TEC', faction: FACTION.RG, kind: 'unit',
    cost: 350, buildTime: 6, hp: 200, armor: Armor.LIGHT, loco: WHEEL,
    speed: 112, turnRate: 5.5, vision: 9, radius: 11, from: 'rg_motor_pool', tier: 0,
    weapon: W(9, Damage.SMALL_ARMS, 0.28, 160),
    desc: 'Pickup with a heavy machine gun. The fastest thing on the map. Raids supply lines.',
  },
  saqr_ifv: {
    id: 'saqr_ifv', name: 'Saqr IFV', short: 'SQR', faction: FACTION.RG, kind: 'unit',
    cost: 700, buildTime: 13, hp: 420, armor: Armor.LIGHT, loco: TRACK,
    speed: 70, turnRate: 3.0, vision: 8, radius: 13, from: 'rg_motor_pool', tier: 1,
    weapon: W(18, Damage.AUTOCANNON, 0.80, 195, { shots: 2, projectile: 'tracer' }),
    cargoSpace: 2, turret: true,
    desc: 'Guard mechanised infantry carrier. Thin armour, respectable gun.',
  },
  asad_mbt: {
    id: 'asad_mbt', name: 'Asad MBT', short: 'ASD', faction: FACTION.RG, kind: 'unit',
    cost: 1000, buildTime: 18, hp: 820, armor: Armor.HEAVY, loco: TRACK,
    speed: 54, turnRate: 2.0, vision: 8, radius: 15, from: 'rg_motor_pool', tier: 2,
    weapon: W(95, Damage.AP, 3.4, 215, { projectile: 'shell', splash: 12, spread: 0.03 }),
    weapon2: W(8, Damage.SMALL_ARMS, 0.26, 165, { shots: 2, name: 'coaxial' }),
    turret: true, crusher: true,
    desc: 'Outgunned by the Anvil head-on. The Guard uses them in pairs, from defilade.',
  },
  aa_track: {
    id: 'aa_track', name: 'Flak Track', short: 'AAA', faction: FACTION.RG, kind: 'unit',
    cost: 650, buildTime: 12, hp: 340, armor: Armor.LIGHT, loco: WHEEL,
    speed: 62, turnRate: 4, vision: 9, radius: 12, from: 'rg_motor_pool', tier: 1,
    weapon: W(13, Damage.AA, 0.16, 205, { projectile: 'flak' }),
    intercepts: true, turret: true,
    desc: 'Quad autocannon. Suppresses your air support and makes a mess of infantry.',
  },
};

export const BUILDINGS = {
  // --- Coalition -----------------------------------------------------------
  command_post: {
    id: 'command_post', name: 'Command Post', short: 'HQ', faction: FACTION.CTF, kind: 'building',
    cost: 2000, buildTime: 30, hp: 3000, armor: Armor.STRUCTURE, size: [4, 4],
    power: 30, vision: 10, buildRadius: 15, isHQ: true, tier: 0,
    desc: 'Mission command. Defines where you may build and feeds the base 30 power. Losing it ends the operation.',
  },
  generator: {
    id: 'generator', name: 'Field Generator', short: 'PWR', faction: FACTION.CTF, kind: 'building',
    cost: 400, buildTime: 9, hp: 700, armor: Armor.STRUCTURE, size: [2, 2],
    power: 28, vision: 4, tier: 0, explodes: 55,
    desc: 'Adds 28 power. Detonates when destroyed - do not line them up next to the ammunition.',
  },
  supply_depot: {
    id: 'supply_depot', name: 'Supply Depot', short: 'DEP', faction: FACTION.CTF, kind: 'building',
    cost: 900, buildTime: 16, hp: 1400, armor: Armor.STRUCTURE, size: [3, 3],
    power: -6, vision: 6, dropoff: true, freeUnit: 'supply_truck', produces: ['supply_truck'], tier: 0,
    desc: 'Supply drop-off point. Ships with one truck. Build a second depot before you build a second army.',
  },
  barracks: {
    id: 'barracks', name: 'Barracks', short: 'BRK', faction: FACTION.CTF, kind: 'building',
    cost: 600, buildTime: 14, hp: 1200, armor: Armor.STRUCTURE, size: [3, 3],
    power: -10, vision: 5, produces: ['rifle_squad', 'at_team', 'engineer'], tier: 0,
    desc: 'Trains infantry.',
  },
  motor_pool: {
    id: 'motor_pool', name: 'Motor Pool', short: 'MTR', faction: FACTION.CTF, kind: 'building',
    cost: 1400, buildTime: 24, hp: 1800, armor: Armor.STRUCTURE, size: [4, 3],
    power: -25, vision: 5, produces: ['humvee', 'ifv', 'mbt'], requires: ['barracks'], tier: 1,
    desc: 'Fields vehicles. Requires a barracks.',
  },
  comm_center: {
    id: 'comm_center', name: 'Comms Centre', short: 'COM', faction: FACTION.CTF, kind: 'building',
    cost: 1200, buildTime: 22, hp: 1000, armor: Armor.STRUCTURE, size: [3, 3],
    power: -30, vision: 8, requires: ['motor_pool'], tier: 2,
    grants: ['air_strike', 'recon_sweep'],
    desc: 'Radio link to the wing. Unlocks the strafing run and the recon sweep, and maps the whole area of operations.',
  },
  mg_nest: {
    id: 'mg_nest', name: 'MG Position', short: 'MG', faction: FACTION.CTF, kind: 'building',
    cost: 350, buildTime: 8, hp: 700, armor: Armor.STRUCTURE, size: [2, 2],
    power: -5, vision: 8, defensive: true, tier: 0,
    weapon: W(13, Damage.SMALL_ARMS, 0.24, 205),
    desc: 'Cheap anti-infantry emplacement. Will not stop a vehicle.',
  },
  at_gun: {
    id: 'at_gun', name: 'AT Emplacement', short: 'ATG', faction: FACTION.CTF, kind: 'building',
    cost: 600, buildTime: 12, hp: 850, armor: Armor.STRUCTURE, size: [2, 2],
    power: -12, vision: 9, defensive: true, requires: ['motor_pool'], tier: 1,
    weapon: W(88, Damage.AP, 2.6, 265, { projectile: 'shell', spread: 0.015 }),
    desc: 'Long-barrelled anti-tank gun. Outranges every tank on the map.',
  },
  barrier: {
    id: 'barrier', name: 'Barrier', short: 'BAR', faction: FACTION.CTF, kind: 'building',
    cost: 70, buildTime: 2, hp: 500, armor: Armor.STRUCTURE, size: [1, 1],
    power: 0, vision: 2, tier: 0, noBuildRadius: false,
    desc: 'Concrete barrier. Channels enemy armour into your fields of fire.',
  },

  // --- Republican Guard ----------------------------------------------------
  rg_command: {
    id: 'rg_command', name: 'Guard Command Post', short: 'HQ', faction: FACTION.RG, kind: 'building',
    cost: 2000, buildTime: 30, hp: 2600, armor: Armor.STRUCTURE, size: [4, 4],
    power: 30, vision: 9, buildRadius: 14, isHQ: true, tier: 0,
    desc: 'Guard divisional headquarters.',
  },
  rg_barracks: {
    id: 'rg_barracks', name: 'Guard Barracks', short: 'BRK', faction: FACTION.RG, kind: 'building',
    cost: 500, buildTime: 12, hp: 1100, armor: Armor.STRUCTURE, size: [3, 3],
    power: -8, vision: 5, produces: ['militia', 'rpg_team'], tier: 0,
    desc: 'Trains Guard infantry and militia.',
  },
  rg_motor_pool: {
    id: 'rg_motor_pool', name: 'Guard Motor Pool', short: 'MTR', faction: FACTION.RG, kind: 'building',
    cost: 1300, buildTime: 22, hp: 1700, armor: Armor.STRUCTURE, size: [4, 3],
    power: -22, vision: 5, produces: ['technical', 'saqr_ifv', 'asad_mbt', 'aa_track'], tier: 1,
    desc: 'Guard vehicle park.',
  },
  rg_generator: {
    id: 'rg_generator', name: 'Guard Generator', short: 'PWR', faction: FACTION.RG, kind: 'building',
    cost: 400, buildTime: 9, hp: 650, armor: Armor.STRUCTURE, size: [2, 2],
    power: 28, vision: 4, tier: 0, explodes: 55,
    desc: 'Powers the Guard position.',
  },
  bunker: {
    id: 'bunker', name: 'Guard Bunker', short: 'BNK', faction: FACTION.RG, kind: 'building',
    cost: 400, buildTime: 9, hp: 950, armor: Armor.STRUCTURE, size: [2, 2],
    power: -5, vision: 8, defensive: true, tier: 0,
    weapon: W(14, Damage.SMALL_ARMS, 0.25, 200),
    desc: 'Reinforced machine-gun bunker covering the approaches.',
  },
  rg_at_gun: {
    id: 'rg_at_gun', name: 'Guard AT Gun', short: 'ATG', faction: FACTION.RG, kind: 'building',
    cost: 550, buildTime: 12, hp: 750, armor: Armor.STRUCTURE, size: [2, 2],
    power: -10, vision: 9, defensive: true, tier: 1,
    weapon: W(80, Damage.AP, 2.8, 255, { projectile: 'shell', spread: 0.02 }),
    desc: 'Dug-in anti-tank gun. Covers the bridge approaches.',
  },

  // --- Neutral -------------------------------------------------------------
  civil_block: {
    id: 'civil_block', name: 'Residential Block', short: 'CIV', faction: FACTION.CIV, kind: 'building',
    cost: 0, buildTime: 0, hp: 900, armor: Armor.STRUCTURE, size: [2, 2],
    power: 0, vision: 0, civilian: true, garrisonSlots: 2, tier: 0,
    desc: 'Occupied civilian housing. Garrisonable by either side. Destroying it costs Local Support.',
  },
  civil_hall: {
    id: 'civil_hall', name: 'Municipal Hall', short: 'CIV', faction: FACTION.CIV, kind: 'building',
    cost: 0, buildTime: 0, hp: 1300, armor: Armor.STRUCTURE, size: [3, 3],
    power: 0, vision: 0, civilian: true, garrisonSlots: 3, tier: 0,
    desc: 'Local government building. Heavy Local Support penalty if levelled.',
  },
  fuel_depot: {
    id: 'fuel_depot', name: 'Fuel Depot', short: 'FUEL', faction: FACTION.CIV, kind: 'building',
    cost: 0, buildTime: 0, hp: 800, armor: Armor.STRUCTURE, size: [3, 2],
    power: 0, vision: 5, capturable: true, trickle: 9, explodes: 90, tier: 0,
    desc: 'Capture with an engineer for a steady 9 supply/sec. Highly flammable.',
  },
  abandoned_depot: {
    id: 'abandoned_depot', name: 'Abandoned Depot', short: 'DEP', faction: FACTION.CIV, kind: 'building',
    cost: 0, buildTime: 0, hp: 1200, armor: Armor.STRUCTURE, size: [3, 3],
    power: 0, vision: 5, capturable: true, becomes: 'supply_depot', tier: 0,
    desc: 'Intact supply depot. Capture it with an engineer to put it back in service.',
  },
};

export const ALL_DEFS = { ...UNITS, ...BUILDINGS };
export const defOf = (id) => ALL_DEFS[id];

// Off-map support powers, unlocked by the Comms Centre.
export const POWERS = {
  air_strike: {
    id: 'air_strike', name: 'Strafing Run', short: 'AIR', cooldown: 110, icon: 'air',
    damage: 46, damageType: Damage.BOMB, splash: 40, passes: 14, spacing: 34,
    desc: 'A single gun pass along a line you draw. Devastating on soft targets in the open. Flak tracks will engage it.',
  },
  recon_sweep: {
    id: 'recon_sweep', name: 'Recon Sweep', short: 'EYE', cooldown: 65, icon: 'eye',
    radius: 13, duration: 22,
    desc: 'Reveals an area for 22 seconds, garrisons included.',
  },
};
