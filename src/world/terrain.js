// Terrain table. Movement cost is per locomotion class; `Infinity` means
// impassable. `ap` is the whole action points a single tile step costs, kept
// as small integers so a player can count a move without doing arithmetic.
// Cover is a fractional damage reduction for whatever stands on the tile.

export const FOOT = 0, WHEEL = 1, TRACK = 2, AIR = 3;
export const LOCO_NAMES = ['Foot', 'Wheeled', 'Tracked', 'Air'];

export const T = {
  SAND: 0,
  ROAD: 1,
  SCRUB: 2,
  PALM: 3,
  RUBBLE: 4,
  BERM: 5,
  WATER: 6,
  CANAL: 7,
};

const I = Infinity;

// cost / ap indexed by [foot, wheel, track, air]
export const TERRAIN = [
  { id: T.SAND,   name: 'sand',   cost: [1.00, 1.15, 1.00, 1], ap: [1, 1, 1, 1], cover: 0.00, blocksSight: false },
  { id: T.ROAD,   name: 'road',   cost: [0.90, 0.70, 0.80, 1], ap: [1, 1, 1, 1], cover: 0.00, blocksSight: false },
  { id: T.SCRUB,  name: 'scrub',  cost: [1.10, 1.40, 1.10, 1], ap: [1, 2, 1, 1], cover: 0.10, blocksSight: false },
  { id: T.PALM,   name: 'palm',   cost: [1.30,    I, 1.70, 1], ap: [2, I, 2, 1], cover: 0.25, blocksSight: true  },
  { id: T.RUBBLE, name: 'rubble', cost: [1.45,    I, 1.60, 1], ap: [2, I, 2, 1], cover: 0.30, blocksSight: false },
  { id: T.BERM,   name: 'berm',   cost: [   I,    I,    I, 1], ap: [I, I, I, 1], cover: 0.00, blocksSight: true  },
  { id: T.WATER,  name: 'water',  cost: [   I,    I,    I, 1], ap: [I, I, I, 1], cover: 0.00, blocksSight: false },
  { id: T.CANAL,  name: 'canal',  cost: [2.20,    I,    I, 1], ap: [3, I, I, 1], cover: 0.15, blocksSight: false },
];

export const TILE = 32;              // world units per tile
export const tileOf = (w) => Math.floor(w / TILE);
export const centreOf = (t) => t * TILE + TILE / 2;

/** Aircraft ignore the ground entirely. */
export const isAir = (loco) => loco === AIR;
