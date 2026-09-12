// Low-level drawing primitives shared by every sprite generator.
// Everything here is plain Canvas2D so the art has no external dependencies
// and no binary assets: the whole game draws itself at load time.

export const SS = 2;                    // sprite supersample factor

export function makeCanvas(w, h) {
  const c = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(Math.max(1, w), Math.max(1, h))
    : Object.assign(document.createElement('canvas'), { width: Math.max(1, w), height: Math.max(1, h) });
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return c;
}

/**
 * Render a sprite at SS times scale with the origin at its centre.
 * @returns {{canvas:*, w:number, h:number, ox:number, oy:number}}
 */
export function sprite(w, h, fn) {
  const c = makeCanvas(Math.ceil(w * SS), Math.ceil(h * SS));
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.save();
  g.scale(SS, SS);
  g.translate(w / 2, h / 2);
  fn(g);
  g.restore();
  return { canvas: c, w, h, ox: w / 2, oy: h / 2 };
}

export function rr(g, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.lineTo(x + w - rad, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rad);
  g.lineTo(x + w, y + h - rad);
  g.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  g.lineTo(x + rad, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rad);
  g.lineTo(x, y + rad);
  g.quadraticCurveTo(x, y, x + rad, y);
  g.closePath();
}

export function poly(g, pts, close = true) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
}

/** A lit metal plate: fill, top-left highlight, bottom-right shade, ink outline. */
export function plate(g, x, y, w, h, base, light, dark, r = 2, outline = 'rgba(12,14,10,0.75)') {
  rr(g, x, y, w, h, r);
  g.fillStyle = base; g.fill();
  g.save();
  rr(g, x, y, w, h, r); g.clip();
  g.fillStyle = light;
  g.fillRect(x, y, w, Math.max(1, h * 0.22));
  g.fillStyle = dark;
  g.fillRect(x, y + h - Math.max(1, h * 0.26), w, Math.max(1, h * 0.26));
  g.restore();
  if (outline) { rr(g, x, y, w, h, r); g.strokeStyle = outline; g.lineWidth = 0.9; g.stroke(); }
}

/** Thin panel seam. */
export function seam(g, x0, y0, x1, y1, alpha = 0.28, width = 0.8) {
  g.strokeStyle = `rgba(10,12,8,${alpha})`;
  g.lineWidth = width;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}

export function dot(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

/** Speckle for sand, concrete and rust. Deterministic via the supplied rng. */
export function speckle(g, x, y, w, h, rng, count, colors, size = [0.5, 1.4]) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(rng() * colors.length) | 0];
    const r = rng.range(size[0], size[1]);
    g.fillRect(x + rng() * w, y + rng() * h, r, r);
  }
}

/** Soft contact shadow under a vehicle or structure. */
export function groundShadow(g, w, h, alpha = 0.30, dx = 2.5, dy = 3) {
  g.save();
  g.translate(dx, dy);
  g.fillStyle = `rgba(40,32,20,${alpha})`;
  g.beginPath();
  g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Team colour flash: a short bar the eye can pick out at any zoom. */
export function teamFlash(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(x, y, w, Math.max(0.6, h * 0.35));
}

export function outlinePath(g, pts, fill, r = 2.5) {
  poly(g, pts);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = 'rgba(12,14,10,0.8)';
  g.lineWidth = 0.9;
  g.stroke();
}
