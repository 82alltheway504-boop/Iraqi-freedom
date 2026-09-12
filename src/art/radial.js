import { makeCanvas } from './draw.js';
import { TAU } from '../core/math.js';

/**
 * Cache of pre-rendered radial sprites.
 *
 * Canvas2D charges heavily for `createRadialGradient` — building one per
 * particle per frame is what turns a smooth battle into a slideshow. The
 * colours used by the effects system come from a small fixed set, so each
 * gradient is baked into a 64 px sprite once and then blitted.
 */
export class RadialCache {
  constructor(size = 64) {
    this.size = size;
    this.map = new Map();
    this._scorch = null;
    this._flash = null;
  }

  get(c0, c1) {
    const key = c0 + '|' + c1;
    let c = this.map.get(key);
    if (c) return c;
    const S = this.size;
    c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, c0);
    grd.addColorStop(1, c1);
    g.fillStyle = grd;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, TAU); g.fill();
    this.map.set(key, c);
    // The palette is fixed and small; this cap only guards against a typo
    // upstream turning into unbounded memory growth.
    if (this.map.size > 64) this.map.delete(this.map.keys().next().value);
    return c;
  }

  /** Burn mark left on the ground by an explosion. */
  scorch() {
    if (this._scorch) return this._scorch;
    const S = 128;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(38,30,20,1)');
    grd.addColorStop(0.6, 'rgba(52,42,28,0.55)');
    grd.addColorStop(1, 'rgba(60,50,34,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, TAU); g.fill();
    this._scorch = c;
    return c;
  }

  /** Muzzle flash bloom, drawn additively. */
  flash() {
    if (this._flash) return this._flash;
    const S = 64;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,246,214,0.95)');
    grd.addColorStop(0.4, 'rgba(255,180,70,0.6)');
    grd.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, TAU); g.fill();
    this._flash = c;
    return c;
  }
}
