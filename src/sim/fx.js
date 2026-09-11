import { TAU } from '../core/math.js';

/**
 * Particle and decal pool. Everything is a flat object in a recycled array —
 * no allocation churn during a firefight, which matters a lot on a phone.
 */
export class Fx {
  constructor(rng) {
    this.rng = rng;
    this.parts = [];
    this.tracers = [];
    this.decals = [];   // craters and scorch marks, drawn once into a layer
    this.texts = [];
    this.shake = 0;
    this.decalDirty = false;
    this.maxParts = 900;
  }

  _p() {
    for (let i = 0; i < this.parts.length; i++) if (this.parts[i].life <= 0) return this.parts[i];
    if (this.parts.length >= this.maxParts) return null;
    const o = { life: 0 };
    this.parts.push(o);
    return o;
  }

  spawn(x, y, opts) {
    const p = this._p();
    if (!p) return;
    p.x = x; p.y = y;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0;
    p.life = p.maxLife = opts.life || 0.5;
    p.r0 = opts.r0 ?? 3; p.r1 = opts.r1 ?? 0;
    p.c0 = opts.c0 || '#ffd9a0'; p.c1 = opts.c1 || 'rgba(60,50,40,0)';
    p.drag = opts.drag ?? 0.92;
    p.grav = opts.grav ?? 0;
    p.glow = opts.glow ?? false;
    p.spin = opts.spin ?? 0;
    p.rot = opts.rot ?? 0;
  }

  tracer(x0, y0, x1, y1, color = '#ffe9b0', life = 0.07, width = 1.4) {
    this.tracers.push({ x0, y0, x1, y1, color, life, maxLife: life, width });
  }

  text(x, y, str, color = '#ffdf9a', life = 1.1) {
    this.texts.push({ x, y, str, color, life, maxLife: life });
  }

  muzzleFlash(x, y, angle, scale = 1) {
    const r = this.rng;
    for (let i = 0; i < 4; i++) {
      const a = angle + r.range(-0.35, 0.35);
      const s = r.range(40, 130) * scale;
      this.spawn(x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: r.range(0.06, 0.16), r0: 3.2 * scale, r1: 0,
        c0: '#fff3c4', c1: 'rgba(255,150,40,0)', glow: true, drag: 0.82,
      });
    }
  }

  impactDust(x, y, scale = 1) {
    const r = this.rng;
    for (let i = 0; i < 5; i++) {
      const a = r.range(0, TAU);
      const s = r.range(12, 55) * scale;
      this.spawn(x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: r.range(0.3, 0.7), r0: r.range(1.5, 3.5) * scale, r1: r.range(4, 8) * scale,
        c0: 'rgba(214,193,156,0.75)', c1: 'rgba(200,180,145,0)', drag: 0.9,
      });
    }
  }

  explosion(x, y, radius = 30, big = false) {
    const r = this.rng;
    const n = big ? 26 : 14;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, TAU);
      const s = r.range(30, 180) * (radius / 30);
      this.spawn(x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: r.range(0.25, 0.6), r0: r.range(3, 8) * (big ? 1.5 : 1), r1: 0,
        c0: i % 3 === 0 ? '#fff0b8' : '#ff9b3c', c1: 'rgba(120,60,20,0)', glow: true, drag: 0.86,
      });
    }
    for (let i = 0; i < n; i++) {
      const a = r.range(0, TAU);
      const s = r.range(10, 70) * (radius / 30);
      this.spawn(x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - r.range(5, 25),
        life: r.range(0.7, 1.8), r0: r.range(4, 10), r1: r.range(14, 30) * (big ? 1.6 : 1),
        c0: 'rgba(80,70,62,0.55)', c1: 'rgba(150,140,125,0)', drag: 0.94,
      });
    }
    this.decals.push({ x, y, r: radius * (big ? 0.9 : 0.55), a: big ? 0.5 : 0.34, kind: 'scorch' });
    this.decalDirty = true;
    this.shake = Math.min(18, this.shake + (big ? 9 : 3.5));
  }

  debris(x, y, count = 8) {
    const r = this.rng;
    for (let i = 0; i < count; i++) {
      const a = r.range(0, TAU);
      const s = r.range(40, 160);
      this.spawn(x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: r.range(0.5, 1.2), r0: r.range(1.2, 2.8), r1: 0.4,
        c0: '#7a6a52', c1: 'rgba(90,78,60,0)', drag: 0.9, grav: 60,
        spin: r.range(-8, 8), rot: r.range(0, TAU),
      });
    }
  }

  smoke(x, y, scale = 1) {
    const r = this.rng;
    this.spawn(x, y + r.range(-4, 4), {
      vx: r.range(-6, 6), vy: -r.range(8, 20),
      life: r.range(1.2, 2.4), r0: r.range(3, 6) * scale, r1: r.range(10, 22) * scale,
      c0: 'rgba(48,44,40,0.5)', c1: 'rgba(130,124,114,0)', drag: 0.98,
    });
  }

  update(dt) {
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.rot += p.spin * dt;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].life -= dt;
      if (this.tracers[i].life <= 0) this.tracers.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt; t.y -= 16 * dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    if (this.decals.length > 220) { this.decals.splice(0, this.decals.length - 220); this.decalDirty = true; }
    this.shake *= Math.pow(0.86, dt * 60);
    if (this.shake < 0.05) this.shake = 0;
  }

  clear() {
    for (const p of this.parts) p.life = 0;
    this.tracers.length = 0;
    this.texts.length = 0;
    this.decals.length = 0;
    this.decalDirty = true;
    this.shake = 0;
  }
}
