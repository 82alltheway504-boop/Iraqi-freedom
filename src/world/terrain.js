// Terrain table. Movement cost is per locomotion class; `Infinity` means
// impassable. Cover is a fractional damage reduction granted to units
// standing on the tile, which is what makes the palm groves and rubble
// fields around Highway 8 worth fighting over instead of driving past.

export const FOOT = 0, WHEEL = 1, TRACK = 2;

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

// [foot, wheel, track]
export const TERRAIN = [
  { id: T.SAND,   name: 'sand',   cost: [1.00, 1.15, 1.00], cover: 0.00, blocksSight: false },
  { id: T.ROAD,   name: 'road',   cost: [0.90, 0.70, 0.80], cover: 0.00, blocksSight: false },
  { id: T.SCRUB,  name: 'scrub',  cost: [1.10, 1.40, 1.10], cover: 0.10, blocksSight: false },
  { id: T.PALM,   name: 'palm',   cost: [1.30,    I, 1.70], cover: 0.25, blocksSight: true  },
  { id: T.RUBBLE, name: 'rubble', cost: [1.45,    I, 1.60], cover: 0.30, blocksSight: false },
  { id: T.BERM,   name: 'berm',   cost: [   I,    I,    I], cover: 0.00, blocksSight: true  },
  { id: T.WATER,  name: 'water',  cost: [   I,    I,    I], cover: 0.00, blocksSight: false },
  { id: T.CANAL,  name: 'canal',  cost: [2.20,    I,    I], cover: 0.15, blocksSight: false },
];

export const TILE = 32;              // world units per tile
export const tileOf = (w) => Math.floor(w / TILE);
export const centreOf = (t) => t * TILE + TILE / 2;
