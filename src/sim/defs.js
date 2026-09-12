import { Armor, Damage, Category, Res } from './rules.js';
import { FOOT, WHEEL, TRACK, AIR, TILE } from '../world/terrain.js';

// ---------------------------------------------------------------------------
// ORDER OF BATTLE
// ---------------------------------------------------------------------------
// Three fighting categories, three economies:
//
//   Infantry  drink WATER   cheap, hold ground, dig in, die to armour in the open
//   Vehicles  burn FUEL     the hammer; expensive to field and to keep running
//   Air       burn FUEL     reach and shock, but thin and answered by AA
//   Works     consume OIL   fortifications, production, and the guns that hold a line
//
// Every unit has action points. Moving spends them by terrain, attacking spends
// a fixed amount, so "advance or shoot" is a decision on every single turn.

export const FACTION = { CTF: 'CTF', RG: 'RG', CIV: 'CIV' };

export const FACTION_INFO = {
  CTF: { name: 'Coalition Task Force', short: 'CTF', color: '#6f8f5a', accent: '#c8d6a0' },
  RG:  { name: 'Republican Guard',     short: 'RG',  color: '#7a6a4e', accent: '#c2a878' },
  CIV: { name: 'Civilian',             short: 'CIV', color: '#9a8f7c', accent: '#cbbfa6' },
};

const tiles = (n) => n * TILE;

const W = (damage, type, range, extra = {}) => ({
  damage, type, range: tiles(range), minRange: 0, projectile: 'bullet',
  splash: 0, shots: 1, spread: 0.03, attackAp: 2, indirect: false,
  targetsAir: false, targetsGround: true, ...extra,
});

// --- INFANTRY --------------------------------------------------------------
const INFANTRY = {
  light_infantry: {
    id: 'light_infantry', name: 'Light Infantry', short: 'LT', faction: FACTION.CTF,
    kind: 'unit', category: Category.INFANTRY, res: Res.WATER,
    cost: 40, upkeep: 2, buildTurns: 1, hp: 110, armor: Armor.INFANTRY, loco: FOOT,
    ap: 6, vision: 8, radius: 7, from: 'barracks', tier: 0,
    weapon: W(10, Damage.SMALL_ARMS, 4, { shots: 2, spread: 0.11, attackAp: 2 }),
    canGarrison: true, crushable: true, entrenches: true,
    desc: 'Fast, cheap, sees far. Screens the advance and takes ground nobody is defending.',
  },
  rifle_squad: {
    id: 'rifle_squad', name: 'Rifle Squad', short: 'RIF', faction: FACTION.CTF,
    kind: 'unit', category: Category.INFANTRY, res: Res.WATER,
    cost: 60, upkeep: 3, buildTurns: 1, hp: 165, armor: Armor.INFANTRY, loco: FOOT,
    ap: 5, vision: 7, radius: 7, from: 'barracks', tier: 0,
    weapon: W(13, Damage.SMALL_ARMS, 5, { shots: 3, spread: 0.10, attackAp: 2 }),
    canGarrison: true, crushable: true, entrenches: true,
    desc: 'The line. Holds what you take, and digs in if you leave it still for a turn.',
  },
  at_team: {
    id: 'at_team', name: 'AT Team', short: 'AT', faction: FACTION.CTF,
    kind: 'unit', category: Category.INFANTRY, res: Res.WATER,
    cost: 80, upkeep: 4, buildTurns: 1, hp: 130, armor: Armor.INFANTRY, loco: FOOT,
    ap: 4, vision: 8, radius: 7, from: 'barracks', tier: 0,
    // One missile a turn — 3 of its 4 points — so the warhead has to be worth
    // the whole turn. Two teams working together kill a main battle tank in
    // about six turns and will lose one of their own doing it.
    weapon: W(105, Damage.ROCKET, 7, { minRange: tiles(2), projectile: 'rocket', attackAp: 3 }),
    canGarrison: true, crushable: true, entrenches: true,
    desc: 'Guided missiles. Outranges every tank on the map, and cannot fire at what is on top of it.',
  },
  mortar_team: {
    id: 'mortar_team', name: 'Mortar Team', short: 'MTR', faction: FACTION.CTF,
    kind: 'unit', category: Category.INFANTRY, res: Res.WATER,
    cost: 85, upkeep: 4, buildTurns: 1, hp: 120, armor: Armor.INFANTRY, loco: FOOT,
    ap: 4, vision: 6, radius: 7, from: 'barracks', tier: 1,
    weapon: W(62, Damage.MORTAR, 9, {
      minRange: tiles(3), projectile: 'shell', splash: tiles(1.2),
      attackAp: 3, indirect: true, arc: true,
    }),
    canGarrison: false, crushable: true, entrenches: true, needsSetup: true,
    desc: 'Indirect fire over walls and hills. The only infantry answer to fortifications — but it must set up, so it cannot move and fire in the same turn.',
  },
  airborne: {
    id: 'airborne', name: 'Airborne Infantry', short: 'ABN', faction: FACTION.CTF,
    kind: 'unit', category: Category.INFANTRY, res: Res.WATER,
    cost: 90, upkeep: 4, buildTurns: 2, hp: 150, armor: Armor.INFANTRY, loco: FOOT,
    ap: 5, vision: 8, radius: 7, from: 'airfield', tier: 2,
    weapon: W(15, Damage.SMALL_ARMS, 5, { shots: 3, spread: 0.09, attackAp: 2 }),
    canGarrison: true, crushable: true, entrenches: true, paradrop: true,
    desc: 'Drops once, anywhere you have scouted, and lands ready to fight. Use it to take a position nobody can reinforce in time.',
  },
  air_assault: {
    id: 'air_assault', name: 'Air Assault Infantry', short: 'AAS', faction: FACTION.CTF,
    kind: 'unit', category: Category.INFANTRY, res: Res.WATER,
    cost: 95, upkeep: 4, buildTurns: 2, hp: 155, armor: Armor.INFANTRY, loco: FOOT,
    ap: 6, vision: 7, radius: 7, from: 'airfield', tier: 2,
    weapon: W(17, Damage.SMALL_ARMS, 5, { shots: 3, spread: 0.09, attackAp: 2 }),
    canGarrison: true, crushable: true, entrenches: true, liftable: true,
    desc: 'Rides a helicopter into the objective and fights the moment it steps off. Heavier punch than a rifle squad and one more action point.',
  },
  engineer: {
    id: 'engineer', name: 'Combat Engineer', short: 'ENG', faction: FACTION.CTF,
    kind: 'unit', category: Category.INFANTRY, res: Res.WATER,
    cost: 70, upkeep: 3, buildTurns: 1, hp: 115, armor: Armor.INFANTRY, loco: FOOT,
    ap: 5, vision: 6, radius: 7, from: 'barracks', tier: 0,
    weapon: null, canGarrison: true, crushable: true,
    abilities: ['capture', 'repair', 'fortify'],
    desc: 'Captures resource sites, repairs works, and digs fortifications and wire in the field. Unarmed — escort it.',
  },
};

// --- VEHICLES --------------------------------------------------------------
const VEHICLES = {
  humvee: {
    id: 'humvee', name: 'Scout Humvee', short: 'SCT', faction: FACTION.CTF,
    kind: 'unit', category: Category.VEHICLE, res: Res.FUEL,
    cost: 70, upkeep: 4, buildTurns: 1, hp: 260, armor: Armor.LIGHT, loco: WHEEL,
    ap: 10, vision: 11, radius: 11, from: 'motor_pool', tier: 0,
    weapon: W(12, Damage.SMALL_ARMS, 5, { shots: 2, attackAp: 2 }),
    desc: 'Ten action points and the best eyes you have. Finds the enemy so something heavier can kill it.',
  },
  ifv: {
    id: 'ifv', name: 'M2 Dragoon IFV', short: 'IFV', faction: FACTION.CTF,
    kind: 'unit', category: Category.VEHICLE, res: Res.FUEL,
    cost: 130, upkeep: 7, buildTurns: 2, hp: 520, armor: Armor.LIGHT, loco: TRACK,
    ap: 8, vision: 9, radius: 13, from: 'motor_pool', tier: 1,
    weapon: W(26, Damage.AUTOCANNON, 6, { shots: 2, projectile: 'tracer', attackAp: 2 }),
    cargoSpace: 2, turret: true,
    desc: 'Carries two infantry into contact and supports them with a chain gun. The workhorse.',
  },
  mbt: {
    id: 'mbt', name: 'M1 Anvil MBT', short: 'MBT', faction: FACTION.CTF,
    kind: 'unit', category: Category.VEHICLE, res: Res.FUEL,
    cost: 200, upkeep: 10, buildTurns: 3, hp: 1000, armor: Armor.HEAVY, loco: TRACK,
    ap: 6, vision: 9, radius: 15, from: 'motor_pool', tier: 2,
    weapon: W(125, Damage.AP, 7, { projectile: 'shell', splash: tiles(0.5), attackAp: 3 }),
    weapon2: W(10, Damage.SMALL_ARMS, 5, { shots: 2, attackAp: 2, name: 'coaxial' }),
    turret: true, crusher: true,
    desc: 'Nothing the Guard fields survives it head-on. Slow, thirsty, and blind to an AT team in the rocks.',
  },
  aa_vehicle: {
    id: 'aa_vehicle', name: 'Avenger AA', short: 'AA', faction: FACTION.CTF,
    kind: 'unit', category: Category.VEHICLE, res: Res.FUEL,
    cost: 120, upkeep: 6, buildTurns: 2, hp: 320, armor: Armor.LIGHT, loco: WHEEL,
    ap: 7, vision: 9, radius: 12, from: 'motor_pool', tier: 1,
    weapon: W(46, Damage.AA, 7, { projectile: 'flak', attackAp: 2, targetsAir: true, targetsGround: true }),
    turret: true, interceptor: true,
    desc: 'The answer to helicopters and jets. Nearly useless against anything on the ground.',
  },
  supply_truck: {
    id: 'supply_truck', name: 'Logistics Truck', short: 'LOG', faction: FACTION.CTF,
    kind: 'unit', category: Category.VEHICLE, res: Res.FUEL,
    cost: 90, upkeep: 4, buildTurns: 1, hp: 300, armor: Armor.LIGHT, loco: WHEEL,
    ap: 9, vision: 7, radius: 12, from: 'motor_pool', tier: 0,
    weapon: null, resupply: true, resupplyRange: tiles(3), resupplyAp: 3,
    desc: 'Refuels and rearms anything next to it, restoring action points to a unit that has already moved. Keeps a push going one more turn.',
  },
};

// --- AIR -------------------------------------------------------------------
const AIRCRAFT = {
  helicopter: {
    id: 'helicopter', name: 'Gunship Helicopter', short: 'HELO', faction: FACTION.CTF,
    kind: 'unit', category: Category.AIR, res: Res.FUEL,
    cost: 220, upkeep: 14, buildTurns: 3, hp: 340, armor: Armor.AIR, loco: AIR,
    ap: 12, vision: 12, radius: 14, from: 'airfield', tier: 2,
    weapon: W(58, Damage.ROCKET, 6, { projectile: 'rocket', attackAp: 3 }),
    turret: true, cargoSpace: 1, liftsOnly: 'air_assault',
    desc: 'Flies over rivers, berms and traffic. Lifts an air assault squad onto an objective, or kills armour from a flank nobody is watching. Anti-air eats it.',
  },
  jet: {
    id: 'jet', name: 'Strike Jet', short: 'JET', faction: FACTION.CTF,
    kind: 'unit', category: Category.AIR, res: Res.FUEL,
    cost: 300, upkeep: 20, buildTurns: 3, hp: 240, armor: Armor.AIR, loco: AIR,
    ap: 20, vision: 13, radius: 16, from: 'airfield', tier: 3,
    weapon: W(115, Damage.BOMB, 5, { projectile: 'shell', splash: tiles(1.6), attackAp: 6 }),
    turret: false, sorties: 1, mustRearm: true,
    desc: 'Twenty action points and a bomb that flattens whatever it lands on. One sortie per turn, then it must return to the airfield to rearm.',
  },
};

// --- OPPOSING FORCE --------------------------------------------------------
const RG_UNITS = {
  militia: {
    id: 'militia', name: 'Militia Squad', short: 'MIL', faction: FACTION.RG,
    kind: 'unit', category: Category.INFANTRY, res: Res.WATER,
    cost: 35, upkeep: 2, buildTurns: 1, hp: 120, armor: Armor.INFANTRY, loco: FOOT,
    ap: 5, vision: 6, radius: 7, from: 'rg_barracks', tier: 0,
    weapon: W(10, Damage.SMALL_ARMS, 4, { shots: 3, spread: 0.13, attackAp: 2 }),
    canGarrison: true, crushable: true, entrenches: true,
    desc: 'Numerous and expendable. Dangerous behind wire.',
  },
  rpg_team: {
    id: 'rpg_team', name: 'RPG Team', short: 'RPG', faction: FACTION.RG,
    kind: 'unit', category: Category.INFANTRY, res: Res.WATER,
    cost: 65, upkeep: 3, buildTurns: 1, hp: 120, armor: Armor.INFANTRY, loco: FOOT,
    ap: 4, vision: 7, radius: 7, from: 'rg_barracks', tier: 0,
    weapon: W(62, Damage.ROCKET, 6, { minRange: tiles(1), projectile: 'rocket', attackAp: 3 }),
    canGarrison: true, crushable: true, entrenches: true,
    desc: 'Short-ranged but cheap. In a fortification it trades evenly with a tank.',
  },
  rg_mortar: {
    id: 'rg_mortar', name: 'Guard Mortar', short: 'MTR', faction: FACTION.RG,
    kind: 'unit', category: Category.INFANTRY, res: Res.WATER,
    cost: 80, upkeep: 4, buildTurns: 1, hp: 115, armor: Armor.INFANTRY, loco: FOOT,
    ap: 4, vision: 6, radius: 7, from: 'rg_barracks', tier: 1,
    weapon: W(55, Damage.MORTAR, 8, {
      minRange: tiles(3), projectile: 'shell', splash: tiles(1.2),
      attackAp: 3, indirect: true, arc: true,
    }),
    crushable: true, entrenches: true, needsSetup: true,
    desc: 'Drops rounds on your fortifications from behind cover.',
  },
  technical: {
    id: 'technical', name: 'Technical', short: 'TEC', faction: FACTION.RG,
    kind: 'unit', category: Category.VEHICLE, res: Res.FUEL,
    cost: 60, upkeep: 3, buildTurns: 1, hp: 200, armor: Armor.LIGHT, loco: WHEEL,
    ap: 11, vision: 9, radius: 11, from: 'rg_motor_pool', tier: 0,
    weapon: W(11, Damage.SMALL_ARMS, 5, { shots: 2, attackAp: 2 }),
    desc: 'The fastest thing on the map. Raids anything unescorted.',
  },
  saqr_ifv: {
    id: 'saqr_ifv', name: 'Saqr IFV', short: 'SQR', faction: FACTION.RG,
    kind: 'unit', category: Category.VEHICLE, res: Res.FUEL,
    cost: 115, upkeep: 6, buildTurns: 2, hp: 420, armor: Armor.LIGHT, loco: TRACK,
    ap: 8, vision: 8, radius: 13, from: 'rg_motor_pool', tier: 1,
    weapon: W(21, Damage.AUTOCANNON, 6, { shots: 2, projectile: 'tracer', attackAp: 2 }),
    cargoSpace: 2, turret: true,
    desc: 'Guard mechanised infantry carrier. Thin armour, respectable gun.',
  },
  asad_mbt: {
    id: 'asad_mbt', name: 'Asad MBT', short: 'ASD', faction: FACTION.RG,
    kind: 'unit', category: Category.VEHICLE, res: Res.FUEL,
    cost: 175, upkeep: 9, buildTurns: 3, hp: 830, armor: Armor.HEAVY, loco: TRACK,
    ap: 6, vision: 8, radius: 15, from: 'rg_motor_pool', tier: 2,
    weapon: W(105, Damage.AP, 6, { projectile: 'shell', splash: tiles(0.45), attackAp: 3 }),
    weapon2: W(9, Damage.SMALL_ARMS, 5, { shots: 2, attackAp: 2, name: 'coaxial' }),
    turret: true, crusher: true,
    desc: 'Outgunned by the Anvil head-on. The Guard uses them in pairs.',
  },
  aa_track: {
    id: 'aa_track', name: 'Flak Track', short: 'AAA', faction: FACTION.RG,
    kind: 'unit', category: Category.VEHICLE, res: Res.FUEL,
    cost: 110, upkeep: 6, buildTurns: 2, hp: 340, armor: Armor.LIGHT, loco: WHEEL,
    ap: 7, vision: 9, radius: 12, from: 'rg_motor_pool', tier: 1,
    weapon: W(42, Damage.AA, 7, { projectile: 'flak', attackAp: 2, targetsAir: true, targetsGround: true }),
    turret: true, interceptor: true,
    desc: 'Quad autocannon. Denies the airspace over the Guard position.',
  },
  rg_helo: {
    id: 'rg_helo', name: 'Guard Gunship', short: 'HELO', faction: FACTION.RG,
    kind: 'unit', category: Category.AIR, res: Res.FUEL,
    cost: 200, upkeep: 13, buildTurns: 3, hp: 310, armor: Armor.AIR, loco: AIR,
    ap: 11, vision: 11, radius: 14, from: 'rg_airfield', tier: 2,
    weapon: W(52, Damage.ROCKET, 6, { projectile: 'rocket', attackAp: 3 }),
    turret: true,
    desc: 'Guard rotary gunship. Bring anti-air or lose vehicles.',
  },
};

export const UNITS = { ...INFANTRY, ...VEHICLES, ...AIRCRAFT, ...RG_UNITS };

// --- STRUCTURES AND FORTIFICATIONS -----------------------------------------
const S = (o) => ({
  kind: 'building', category: Category.STRUCTURE, res: Res.OIL,
  buildTurns: 1, upkeep: 0, armor: Armor.STRUCTURE, ...o,
});

export const BUILDINGS = {
  command_post: S({
    id: 'command_post', name: 'Command Post', short: 'HQ', faction: FACTION.CTF,
    cost: 400, upkeep: 0, buildTurns: 2, hp: 3000, size: [4, 4],
    vision: 10, buildRadius: 16, isHQ: true, tier: 0,
    desc: 'Mission command. Defines where you may build. Losing it ends the operation.',
  }),
  barracks: S({
    id: 'barracks', name: 'Barracks', short: 'BRK', faction: FACTION.CTF,
    cost: 120, upkeep: 4, buildTurns: 1, hp: 1200, size: [3, 3], vision: 5,
    produces: ['light_infantry', 'rifle_squad', 'at_team', 'mortar_team', 'engineer'], tier: 0,
    desc: 'Trains all foot troops and mortar teams.',
  }),
  motor_pool: S({
    id: 'motor_pool', name: 'Motor Pool', short: 'MTR', faction: FACTION.CTF,
    cost: 200, upkeep: 7, buildTurns: 2, hp: 1800, size: [4, 3], vision: 5,
    produces: ['humvee', 'supply_truck', 'ifv', 'aa_vehicle', 'mbt'],
    requires: ['barracks'], tier: 1,
    desc: 'Fields every wheeled and tracked vehicle. Requires a barracks.',
  }),
  airfield: S({
    id: 'airfield', name: 'Airfield', short: 'AIR', faction: FACTION.CTF,
    cost: 280, upkeep: 10, buildTurns: 2, hp: 1500, size: [5, 4], vision: 8,
    produces: ['airborne', 'air_assault', 'helicopter', 'jet'],
    requires: ['motor_pool'], tier: 2, rearms: true,
    desc: 'Fields airborne and air assault troops, helicopters and jets. Jets must return here to rearm between sorties.',
  }),
  fortification: S({
    id: 'fortification', name: 'Fortification', short: 'FORT', faction: FACTION.CTF,
    cost: 60, upkeep: 1, buildTurns: 1, hp: 900, size: [2, 2], vision: 6,
    armor: Armor.FORTIFIED, garrisonSlots: 2, fieldBuild: true, tier: 0,
    desc: 'A dug-in strongpoint. Two squads inside are nearly immune to small arms — until a mortar finds them.',
  }),
  gun_outpost: S({
    id: 'gun_outpost', name: 'Gun Outpost', short: 'OP', faction: FACTION.CTF,
    cost: 90, upkeep: 3, buildTurns: 1, hp: 750, size: [2, 2], vision: 8,
    armor: Armor.FORTIFIED, defensive: true, fieldBuild: true, tier: 0,
    weapon: W(20, Damage.SMALL_ARMS, 6, { shots: 2, attackAp: 0 }),
    desc: 'A manned machine-gun position. Cheap, quick to dig, stops infantry cold.',
  }),
  gun_tower: S({
    id: 'gun_tower', name: 'Gun Tower', short: 'TWR', faction: FACTION.CTF,
    cost: 150, upkeep: 5, buildTurns: 1, hp: 900, size: [2, 2], vision: 12,
    armor: Armor.FORTIFIED, defensive: true, requires: ['barracks'], tier: 1,
    weapon: W(58, Damage.AUTOCANNON, 8, { projectile: 'tracer', attackAp: 0, targetsAir: true }),
    desc: 'Sees furthest of anything you can build, and is the only fixed work that can engage aircraft.',
  }),
  barbed_wire: S({
    id: 'barbed_wire', name: 'Barbed Wire', short: 'WIRE', faction: FACTION.CTF,
    cost: 25, upkeep: 0, buildTurns: 1, hp: 260, size: [1, 1], vision: 2,
    armor: Armor.FORTIFIED, obstacle: true, fieldBuild: true, tier: 0,
    desc: 'Impassable to infantry, and tracked vehicles must stop to crush it. Channels an attack into your guns.',
  }),

  // --- Guard ---------------------------------------------------------------
  rg_command: S({
    id: 'rg_command', name: 'Guard Command Post', short: 'HQ', faction: FACTION.RG,
    cost: 400, buildTurns: 2, hp: 2600, size: [4, 4], vision: 9, buildRadius: 14,
    isHQ: true, tier: 0, desc: 'Guard divisional headquarters.',
  }),
  rg_barracks: S({
    id: 'rg_barracks', name: 'Guard Barracks', short: 'BRK', faction: FACTION.RG,
    cost: 110, upkeep: 4, hp: 1100, size: [3, 3], vision: 5,
    produces: ['militia', 'rpg_team', 'rg_mortar'], tier: 0,
    desc: 'Trains Guard infantry.',
  }),
  rg_motor_pool: S({
    id: 'rg_motor_pool', name: 'Guard Motor Pool', short: 'MTR', faction: FACTION.RG,
    cost: 190, upkeep: 7, buildTurns: 2, hp: 1700, size: [4, 3], vision: 5,
    produces: ['technical', 'saqr_ifv', 'aa_track', 'asad_mbt'], tier: 1,
    desc: 'Guard vehicle park.',
  }),
  rg_airfield: S({
    id: 'rg_airfield', name: 'Guard Airstrip', short: 'AIR', faction: FACTION.RG,
    cost: 260, upkeep: 10, buildTurns: 2, hp: 1400, size: [5, 4], vision: 8,
    produces: ['rg_helo'], tier: 2, rearms: true,
    desc: 'Guard rotary wing base.',
  }),
  bunker: S({
    id: 'bunker', name: 'Guard Bunker', short: 'BNK', faction: FACTION.RG,
    cost: 90, upkeep: 3, hp: 900, size: [2, 2], vision: 8,
    armor: Armor.FORTIFIED, defensive: true, tier: 0,
    weapon: W(21, Damage.SMALL_ARMS, 6, { shots: 2, attackAp: 0 }),
    desc: 'Reinforced machine-gun bunker covering the approaches.',
  }),
  rg_tower: S({
    id: 'rg_tower', name: 'Guard Gun Tower', short: 'TWR', faction: FACTION.RG,
    cost: 150, upkeep: 5, hp: 850, size: [2, 2], vision: 12,
    armor: Armor.FORTIFIED, defensive: true, tier: 1,
    weapon: W(54, Damage.AUTOCANNON, 8, { projectile: 'tracer', attackAp: 0, targetsAir: true }),
    desc: 'Guard watchtower. Engages air.',
  }),
  rg_wire: S({
    id: 'rg_wire', name: 'Guard Wire', short: 'WIRE', faction: FACTION.RG,
    cost: 25, hp: 260, size: [1, 1], vision: 2,
    armor: Armor.FORTIFIED, obstacle: true, tier: 0,
    desc: 'Belts of wire across the Guard front.',
  }),

  // --- neutral: the three resource sites ------------------------------------
  fuel_depot: S({
    id: 'fuel_depot', name: 'Fuel Depot', short: 'FUEL', faction: FACTION.CIV,
    cost: 0, hp: 800, size: [3, 2], vision: 5,
    capturable: true, yields: Res.FUEL, yieldAmount: 22, explodes: 90, tier: 0,
    desc: 'Capture with an engineer for +22 fuel per turn. Flammable.',
  }),
  water_plant: S({
    id: 'water_plant', name: 'Water Plant', short: 'WATER', faction: FACTION.CIV,
    cost: 0, hp: 950, size: [3, 3], vision: 5,
    capturable: true, yields: Res.WATER, yieldAmount: 24, tier: 0,
    desc: 'Capture with an engineer for +24 water per turn. Without it your infantry go thirsty.',
  }),
  oil_derrick: S({
    id: 'oil_derrick', name: 'Oil Derrick', short: 'OIL', faction: FACTION.CIV,
    cost: 0, hp: 850, size: [2, 2], vision: 4,
    capturable: true, yields: Res.OIL, yieldAmount: 20, explodes: 110, tier: 0,
    desc: 'Capture with an engineer for +20 oil per turn. Everything you build runs on it.',
  }),
  civil_block: S({
    id: 'civil_block', name: 'Residential Block', short: 'CIV', faction: FACTION.CIV,
    cost: 0, hp: 900, size: [2, 2], vision: 0,
    civilian: true, garrisonSlots: 2, tier: 0,
    desc: 'Occupied civilian housing. Garrisonable. Destroying it costs Local Support.',
  }),
  civil_hall: S({
    id: 'civil_hall', name: 'Municipal Hall', short: 'CIV', faction: FACTION.CIV,
    cost: 0, hp: 1300, size: [3, 3], vision: 0,
    civilian: true, garrisonSlots: 3, tier: 0,
    desc: 'Local government building. Heavy Local Support penalty if levelled.',
  }),
};

export const ALL_DEFS = { ...UNITS, ...BUILDINGS };
export const defOf = (id) => ALL_DEFS[id];

/** Units the player can train, grouped for the interface. */
export const ROSTER = {
  infantry: ['light_infantry', 'rifle_squad', 'at_team', 'mortar_team', 'engineer', 'airborne', 'air_assault'],
  vehicle: ['humvee', 'supply_truck', 'ifv', 'aa_vehicle', 'mbt'],
  air: ['helicopter', 'jet'],
  structure: ['command_post', 'barracks', 'motor_pool', 'airfield',
              'fortification', 'gun_outpost', 'gun_tower', 'barbed_wire'],
};

export const weaponsOf = (d) => [d.weapon, d.weapon2].filter(Boolean);
