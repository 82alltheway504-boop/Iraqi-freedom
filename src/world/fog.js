import { TILE } from './terrain.js';

/**
 * Two-layer fog, C&C style: `explored` is permanent (terrain you have seen
 * stays drawn but dimmed) and `visible` is live (only lit tiles show units).
 * Recomputed on a fixed 8 Hz cadence rather than every frame — the cost is
 * O(viewers x r^2) and nobody can perceive the 125 ms latency.
 */
export class Fog {
  constructor(grid) {
    this.grid = grid;
    const n = grid.w * grid.h;
    this.explored = new Uint8Array(n);
    this.visible = new Uint8Array(n);
    this.dirty = true;
    this.enabled = true;
  }

  revealAll() {
    this.explored.fill(1);
    this.visible.fill(1);
    this.enabled = false;
  }

  isVisible(tx, ty) {
    if (!this.enabled) return true;
    if (!this.grid.inBounds(tx, ty)) return false;
    return this.visible[ty * this.grid.w + tx] === 1;
  }

  isExplored(tx, ty) {
    if (!this.enabled) return true;
    if (!this.grid.inBounds(tx, ty)) return false;
    return this.explored[ty * this.grid.w + tx] === 1;
  }

  isVisibleWorld(x, y) {
    return this.isVisible(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  /** @param viewers iterable of {x, y, vision} in world units. */
  update(viewers) {
    if (!this.enabled) return;
    this.visible.fill(0);
    const grid = this.grid, W = grid.w, H = grid.h;
    for (const v of viewers) {
      const cx = Math.floor(v.x / TILE);
      const cy = Math.floor(v.y / TILE);
      const r = Math.max(1, Math.round(v.vision));
      const r2 = r * r;
      const x0 = Math.max(0, cx - r), x1 = Math.min(W - 1, cx + r);
      const y0 = Math.max(0, cy - r), y1 = Math.min(H - 1, cy + r);
      for (let ty = y0; ty <= y1; ty++) {
        const dy = ty - cy;
        for (let tx = x0; tx <= x1; tx++) {
          const dx = tx - cx;
          if (dx * dx + dy * dy > r2) continue;
          const i = ty * W + tx;
          if (this.visible[i]) continue;
          // Close tiles are always lit; further ones need a clear line so
          // palm groves and buildings actually cast shadows.
          if (dx * dx + dy * dy <= 4 || grid.lineOfSight(cx, cy, tx, ty)) {
            this.visible[i] = 1;
            this.explored[i] = 1;
          }
        }
      }
    }
    this.dirty = true;
  }
}
