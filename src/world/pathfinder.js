import { TILE } from './terrain.js';

/**
 * A* over the tile grid with a binary heap and a "stamp" closed-set so we
 * never pay to clear arrays between searches. Searches are budgeted: a unit
 * ordered somewhere unreachable burns a bounded number of nodes and then
 * falls back to the closest node it found, which is what a player expects
 * (the unit walks as far as it can) and keeps the frame time flat.
 */
export class Pathfinder {
  constructor(grid) {
    this.grid = grid;
    const n = grid.w * grid.h;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.state = new Uint8Array(n);     // 1 = open, 2 = closed
    this.run = 0;
    this.heap = new Int32Array(n + 1);
    this.heapLen = 0;
    this.budget = 6000;
  }

  _push(i) {
    const heap = this.heap, f = this.f;
    let c = ++this.heapLen;
    heap[c] = i;
    while (c > 1) {
      const p = c >> 1;
      if (f[heap[p]] <= f[heap[c]]) break;
      const t = heap[p]; heap[p] = heap[c]; heap[c] = t;
      c = p;
    }
  }

  _pop() {
    const heap = this.heap, f = this.f;
    const top = heap[1];
    heap[1] = heap[this.heapLen--];
    let p = 1;
    for (;;) {
      const l = p << 1, r = l + 1;
      let s = p;
      if (l <= this.heapLen && f[heap[l]] < f[heap[s]]) s = l;
      if (r <= this.heapLen && f[heap[r]] < f[heap[s]]) s = r;
      if (s === p) break;
      const t = heap[s]; heap[s] = heap[p]; heap[p] = t;
      p = s;
    }
    return top;
  }

  /** Octile distance — the admissible heuristic for 8-way movement. */
  static h(ax, ay, bx, by) {
    const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  }

  /**
   * @returns {Array<{x:number,y:number}>|null} world-space waypoints, already
   * string-pulled, or null when no progress at all is possible.
   */
  find(sx, sy, gx, gy, loco) {
    const grid = this.grid;
    if (!grid.inBounds(sx, sy)) return null;
    if (!grid.passable(gx, gy, loco)) {
      const alt = grid.nearestPassable(gx, gy, loco, 10);
      if (!alt) return null;
      gx = alt.tx; gy = alt.ty;
    }
    if (sx === gx && sy === gy) return [];

    const run = ++this.run;
    this.heapLen = 0;
    const { g, f, parent, stamp, state } = this;
    const W = grid.w;
    const start = sy * W + sx, goal = gy * W + gx;

    stamp[start] = run; g[start] = 0;
    f[start] = Pathfinder.h(sx, sy, gx, gy);
    state[start] = 1;
    this._push(start);

    let best = start, bestH = f[start], expanded = 0;

    while (this.heapLen > 0 && expanded < this.budget) {
      const cur = this._pop();
      if (state[cur] === 2) continue;
      state[cur] = 2;
      expanded++;
      if (cur === goal) { best = goal; break; }

      const cx = cur % W, cy = (cur / W) | 0;
      const hc = Pathfinder.h(cx, cy, gx, gy);
      if (hc < bestH) { bestH = hc; best = cur; }

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx, ny = cy + dy;
          const step = grid.cost(nx, ny, loco);
          if (step === Infinity) continue;
          // No cutting corners between two blockers.
          if (dx !== 0 && dy !== 0) {
            if (!grid.passable(cx + dx, cy, loco) || !grid.passable(cx, cy + dy, loco)) continue;
          }
          const ni = ny * W + nx;
          if (stamp[ni] === run && state[ni] === 2) continue;
          const move = (dx !== 0 && dy !== 0) ? step * Math.SQRT2 : step;
          const ng = g[cur] + move;
          if (stamp[ni] !== run || ng < g[ni]) {
            stamp[ni] = run;
            g[ni] = ng;
            f[ni] = ng + Pathfinder.h(nx, ny, gx, gy) * 1.02; // mild weight: fewer nodes, near-optimal
            parent[ni] = cur;
            state[ni] = 1;
            this._push(ni);
          }
        }
      }
    }

    if (best === start) return null;

    // Walk parents back to the start.
    const tiles = [];
    let cur = best;
    while (cur !== start) {
      tiles.push(cur);
      cur = parent[cur];
      if (tiles.length > 8192) break;
    }
    tiles.reverse();

    return this._smooth(sx, sy, tiles, loco);
  }

  /** Drop waypoints we can walk straight past — removes the A* staircase. */
  _smooth(sx, sy, tiles, loco) {
    const grid = this.grid, W = grid.w;
    const pts = [];
    let ax = sx, ay = sy, i = 0;
    while (i < tiles.length) {
      let j = tiles.length - 1;
      // Find the furthest tile reachable in a straight walkable line.
      while (j > i) {
        const tx = tiles[j] % W, ty = (tiles[j] / W) | 0;
        if (this._walkable(ax, ay, tx, ty, loco)) break;
        j--;
      }
      const tx = tiles[j] % W, ty = (tiles[j] / W) | 0;
      pts.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
      ax = tx; ay = ty;
      i = j + 1;
    }
    return pts;
  }

  _walkable(x0, y0, x1, y1, loco) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const steps = Math.max(dx, dy);
    if (steps === 0) return true;
    let prevX = x0, prevY = y0;
    for (let s = 1; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      if (!this.grid.passable(x, y, loco)) return false;
      // Diagonal step must not squeeze between two blockers.
      if (x !== prevX && y !== prevY) {
        if (!this.grid.passable(prevX, y, loco) || !this.grid.passable(x, prevY, loco)) return false;
      }
      prevX = x; prevY = y;
    }
    return true;
  }
}
