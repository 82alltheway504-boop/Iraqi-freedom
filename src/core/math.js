// Small math/geometry helpers shared by the simulation and the renderer.
// Kept free of DOM access so the sim can run headless under Node for tests.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** Shortest signed angular difference from `a` to `b`, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rotate `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from, to, maxStep) {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/** Axis-aligned box overlap test using centre + half-extents. */
export function boxOverlap(ax, ay, ahw, ahh, bx, by, bhw, bhh) {
  return Math.abs(ax - bx) <= ahw + bhw && Math.abs(ay - by) <= ahh + bhh;
}

/** Deterministic 32-bit PRNG (mulberry32) so missions replay identically. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  return rng;
}

/** Evenly spread `n` points around `(cx, cy)` in expanding rings — used to
 *  turn a single move order into per-unit formation slots. */
export function formationSlots(cx, cy, n, spacing) {
  const out = [];
  if (n <= 0) return out;
  out.push({ x: cx, y: cy });
  let ring = 1;
  while (out.length < n) {
    const r = ring * spacing;
    const count = Math.max(6, Math.floor((TAU * r) / spacing));
    for (let i = 0; i < count && out.length < n; i++) {
      const a = (i / count) * TAU + ring * 0.4;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    ring++;
  }
  return out;
}
