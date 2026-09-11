import { TERRAIN, TILE, T, FOOT, WHEEL, TRACK } from './terrain.js';
import { clamp } from '../core/math.js';

/**
 * The tile grid: terrain, static blockers (structures, wrecks) and the
 * sight-blocking mask. Everything the pathfinder and the fog need lives here
 * in flat typed arrays so a 96x72 map costs a few tens of kilobytes.
 */
export class Grid {
  constructor(w, h, fill = T.SAND) {
    this.w = w;
    this.h = h;
    this.terrain = new Uint8Array(w * h).fill(fill);
    this.blocked = new Uint8Array(w * h);   // structure / wreck occupancy
    this.sightBlock = new Uint8Array(w * h);
    this.version = 0;                       // bumped whenever passability changes
  }

  idx(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }

  get(tx, ty) { return this.terrain[ty * this.w + tx]; }
  set(tx, ty, t) {
    if (!this.inBounds(tx, ty)) return;
    const i = ty * this.w + tx;
    this.terrain[i] = t;
    this.sightBlock[i] = TERRAIN[t].blocksSight ? 1 : 0;
    this.version++;
  }

  fillRect(x, y, w, h, t) {
    for (let ty = y; ty < y + h; ty++)
      for (let tx = x; tx < x + w; tx++) this.set(tx, ty, t);
  }

  cover(tx, ty) {
    if (!this.inBounds(tx, ty)) return 0;
    return TERRAIN[this.terrain[ty * this.w + tx]].cover;
  }

  /** Movement cost for a locomotion class, Infinity when impassable. */
  cost(tx, ty, loco) {
    if (!this.inBounds(tx, ty)) return Infinity;
    const i = ty * this.w + tx;
    if (this.blocked[i]) return Infinity;
    return TERRAIN[this.terrain[i]].cost[loco];
  }

  passable(tx, ty, loco) { return this.cost(tx, ty, loco) !== Infinity; }

  /** Mark/clear a structure footprint. Also blocks line of sight. */
  occupy(tx, ty, w, h, on) {
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        if (!this.inBounds(x, y)) continue;
        const i = y * this.w + x;
        this.blocked[i] = on ? 1 : 0;
        this.sightBlock[i] = on ? 1 : (TERRAIN[this.terrain[i]].blocksSight ? 1 : 0);
      }
    }
    this.version++;
  }

  /** True when nothing blocks the straight line between two tiles (Bresenham). */
  lineOfSight(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    // Guard against pathological loops on malformed input.
    for (let guard = 0; guard < 4096; guard++) {
      if (x === x1 && y === y1) return true;
      if (!(x === x0 && y === y0) && this.sightBlock[y * this.w + x]) return false;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (!this.inBounds(x, y)) return false;
    }
    return false;
  }

  /** Nearest passable tile to (tx,ty) within `radius`, or null. */
  nearestPassable(tx, ty, loco, radius = 12) {
    if (this.passable(tx, ty, loco)) return { tx, ty };
    for (let r = 1; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (this.passable(x, y, loco)) return { tx: x, ty: y };
        }
      }
    }
    return null;
  }

  clampTile(tx, ty) {
    return { tx: clamp(tx, 0, this.w - 1), ty: clamp(ty, 0, this.h - 1) };
  }

  get pixelWidth() { return this.w * TILE; }
  get pixelHeight() { return this.h * TILE; }
}

export { FOOT, WHEEL, TRACK, TILE, T };
