import { T, TILE } from '../world/terrain.js';
import { clamp } from '../core/math.js';

// ---------------------------------------------------------------------------
// "Highway 8" — the area of operations for mission 01.
//
// A 96x72 stretch of the Euphrates valley. The river splits the map roughly
// north-to-south with a single road bridge; everything west of it is the
// player's to take, everything east is the Guard's. Highway 8 runs diagonally
// across the whole map and is the fast route, which is exactly why the Guard
// has an observation post covering each bend of it.
//
// The map is painted deterministically from a seeded RNG, so it is the same
// battlefield every time while still looking weathered rather than tiled.
// ---------------------------------------------------------------------------

export const MAP01 = {
  width: 96,
  height: 72,
  // Key locations, in tiles.
  playerStart: { tx: 9, ty: 60 },
  overwatch: { tx: 31, ty: 52 },
  staging: { tx: 15, ty: 45 },
  depot: { tx: 15, ty: 41 },          // abandoned depot (3x3)
  fuel: { tx: 27, ty: 59 },           // neutral fuel depot (3x2)
  reinforceEdge: { tx: 2, ty: 57 },
  opAlpha: { tx: 33, ty: 48 },        // Guard observation post 1 (2x2)
  opBravo: { tx: 43, ty: 37 },        // Guard observation post 2 (2x2)
  bridgeWest: { tx: 58, ty: 36 },
  bridgeEast: { tx: 70, ty: 36 },
  rgBase: { tx: 77, ty: 22 },
  rgStaging: { tx: 72, ty: 33 },
  caches: [
    { tx: 20, ty: 51, amount: 5200 },
    { tx: 23, ty: 43, amount: 4600 },
    { tx: 11, ty: 36, amount: 4200 },
    { tx: 36, ty: 60, amount: 3400 },
  ],
  village: [                          // civilian structures west of the bridge
    { id: 'civil_block', tx: 46, ty: 30 }, { id: 'civil_block', tx: 50, ty: 29 },
    { id: 'civil_block', tx: 47, ty: 34 }, { id: 'civil_block', tx: 51, ty: 33 },
    { id: 'civil_hall',  tx: 49, ty: 40 },
    { id: 'civil_block', tx: 45, ty: 41 }, { id: 'civil_block', tx: 53, ty: 38 },
    { id: 'civil_block', tx: 54, ty: 43 }, { id: 'civil_block', tx: 44, ty: 45 },
  ],
};

/** Trace a road of the given half-width along a polyline of tile waypoints. */
function paintPath(grid, pts, half, tile, over = null) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.round(x0 + (x1 - x0) * t);
      const cy = Math.round(y0 + (y1 - y0) * t);
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          if (dx * dx + dy * dy > half * half + half) continue;
          const tx = cx + dx, ty = cy + dy;
          if (!grid.inBounds(tx, ty)) continue;
          if (over !== null && grid.get(tx, ty) !== over) continue;
          grid.set(tx, ty, tile);
        }
      }
    }
  }
}

function blob(grid, cx, cy, rx, ry, tile, rng, density = 1) {
  for (let ty = cy - ry; ty <= cy + ry; ty++) {
    for (let tx = cx - rx; tx <= cx + rx; tx++) {
      if (!grid.inBounds(tx, ty)) continue;
      const nx = (tx - cx) / rx, ny = (ty - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      if (rng() > density * (1.15 - d * 0.55)) continue;
      grid.set(tx, ty, tile);
    }
  }
}

function clearArea(grid, cx, cy, rx, ry, tile = T.SAND) {
  for (let ty = cy - ry; ty <= cy + ry; ty++)
    for (let tx = cx - rx; tx <= cx + rx; tx++)
      if (grid.inBounds(tx, ty)) grid.set(tx, ty, tile);
}

export function paintMap01(grid, rng) {
  const M = MAP01;
  grid.fillRect(0, 0, grid.w, grid.h, T.SAND);

  // Scrub and gravel patches to break up the open desert.
  for (let i = 0; i < 46; i++) {
    blob(grid, rng.int(2, grid.w - 3), rng.int(2, grid.h - 3),
      rng.int(3, 9), rng.int(2, 6), T.SCRUB, rng, 0.75);
  }

  // --- the Euphrates ------------------------------------------------------
  // A meandering channel from the north edge to the south, six tiles wide.
  const river = [];
  for (let ty = -2; ty <= grid.h + 2; ty++) {
    const t = ty / grid.h;
    const cx = 66 - t * 9 + Math.sin(t * 5.1) * 4.2 + Math.sin(t * 12.3) * 1.4;
    river.push([Math.round(cx), ty]);
  }
  for (const [cx, ty] of river) {
    const halfW = 3 + (Math.sin(ty * 0.21) > 0.7 ? 1 : 0);
    for (let dx = -halfW; dx <= halfW; dx++) {
      const tx = cx + dx;
      if (grid.inBounds(tx, ty)) grid.set(tx, ty, T.WATER);
    }
    // Irrigated green belt either side of the river.
    for (const side of [-1, 1]) {
      for (let k = halfW + 1; k <= halfW + 4; k++) {
        const tx = cx + side * k;
        if (!grid.inBounds(tx, ty)) continue;
        if (rng() < 0.42) grid.set(tx, ty, T.PALM);
        else if (rng() < 0.5) grid.set(tx, ty, T.SCRUB);
      }
    }
  }

  // Irrigation canals running off the river into the farmland.
  paintPath(grid, [[52, 12], [44, 16], [36, 17]], 0, T.CANAL);
  paintPath(grid, [[56, 54], [46, 58], [34, 61]], 0, T.CANAL);

  // --- date palm groves ---------------------------------------------------
  blob(grid, 26, 48, 6, 5, T.PALM, rng, 0.85);
  blob(grid, 39, 55, 7, 4, T.PALM, rng, 0.8);
  blob(grid, 47, 22, 6, 6, T.PALM, rng, 0.8);
  blob(grid, 20, 26, 8, 5, T.PALM, rng, 0.75);
  blob(grid, 62, 58, 6, 5, T.PALM, rng, 0.8);

  // --- Highway 8 ----------------------------------------------------------
  // The main supply route. Two lanes of asphalt, laid over whatever it crosses.
  const highway = [
    [0, 63], [12, 61], [24, 56], [33, 51], [42, 44],
    [50, 39], [M.bridgeWest.tx, 36], [M.bridgeEast.tx, 36],
    [78, 31], [88, 26], [95, 24],
  ];
  paintPath(grid, highway, 1, T.ROAD);

  // The bridge itself: the only crossing on the map.
  for (let tx = M.bridgeWest.tx - 1; tx <= M.bridgeEast.tx + 1; tx++) {
    for (let ty = 35; ty <= 37; ty++) grid.set(tx, ty, T.ROAD);
  }

  // Secondary roads: one to the village, one into the Guard base.
  paintPath(grid, [[42, 44], [46, 38], [49, 32], [52, 27]], 0, T.ROAD);
  paintPath(grid, [[78, 31], [78, 26], [M.rgBase.tx + 2, M.rgBase.ty + 4]], 0, T.ROAD);
  paintPath(grid, [[24, 56], [19, 50], [16, 44], [14, 38]], 0, T.ROAD);

  // --- defensive earthworks ----------------------------------------------
  // Guard berms screening the eastern bridgehead and the base perimeter.
  paintPath(grid, [[73, 30], [76, 33], [76, 41], [72, 45]], 0, T.BERM);
  paintPath(grid, [[72, 18], [80, 16], [88, 19]], 0, T.BERM);
  for (let i = 0; i < 5; i++) {
    blob(grid, 71 + rng.int(-1, 2), 39 + i * 2, 1, 1, T.BERM, rng, 1);
  }

  // Rubble from earlier fighting around the village and the road junction.
  blob(grid, 50, 36, 4, 3, T.RUBBLE, rng, 0.4);
  blob(grid, 43, 45, 3, 2, T.RUBBLE, rng, 0.45);

  // --- keep the important ground clear -----------------------------------
  clearArea(grid, M.playerStart.tx, M.playerStart.ty, 6, 5);
  clearArea(grid, M.staging.tx + 1, M.staging.ty + 1, 9, 8);
  clearArea(grid, M.depot.tx + 1, M.depot.ty + 1, 3, 3);
  clearArea(grid, M.fuel.tx + 1, M.fuel.ty, 3, 3);
  clearArea(grid, M.rgBase.tx + 2, M.rgBase.ty + 2, 9, 8);
  clearArea(grid, M.opAlpha.tx, M.opAlpha.ty, 3, 3);
  clearArea(grid, M.opBravo.tx, M.opBravo.ty, 3, 3);
  for (const v of MAP01.village) clearArea(grid, v.tx + 1, v.ty + 1, 3, 3);
  // Re-lay the highway over anything the clears removed.
  paintPath(grid, highway, 1, T.ROAD);
  for (let tx = M.bridgeWest.tx - 1; tx <= M.bridgeEast.tx + 1; tx++)
    for (let ty = 35; ty <= 37; ty++) grid.set(tx, ty, T.ROAD);

  // Map border: impassable berm so nothing walks off the edge.
  for (let tx = 0; tx < grid.w; tx++) { grid.set(tx, 0, T.BERM); grid.set(tx, grid.h - 1, T.BERM); }
  for (let ty = 0; ty < grid.h; ty++) { grid.set(0, ty, T.BERM); grid.set(grid.w - 1, ty, T.BERM); }
  // ...except the western road, which is where reinforcements drive in.
  for (let ty = 56; ty <= 59; ty++) grid.set(0, ty, T.ROAD);
}
