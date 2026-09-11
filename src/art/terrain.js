import { PAL } from './palette.js';
import { makeCanvas, rr, dot } from './draw.js';
import { T, TILE } from '../world/terrain.js';
import { TAU } from '../core/math.js';

// ---------------------------------------------------------------------------
// The ground is painted per tile into 16x16-tile chunks which are cached and
// reused. Detail is therefore effectively free at runtime: a chunk costs one
// drawImage per frame no matter how much work went into it. Chunks are
// repainted only when the terrain actually changes (a structure collapsing
// into rubble, say).
// ---------------------------------------------------------------------------

const CHUNK = 16;                       // tiles per chunk edge
const CHUNK_PX = CHUNK * TILE;          // 512
const MAX_CACHED = 40;

/** Cheap deterministic hash so every tile looks the same on every run. */
function h2(x, y, salt = 0) {
  let n = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const hRange = (x, y, s, lo, hi) => lo + h2(x, y, s) * (hi - lo);

/** Smooth-interpolated value noise — continuous across chunk boundaries. */
function vnoise(x, y, salt) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, salt), b = h2(xi + 1, yi, salt);
  const c = h2(xi, yi + 1, salt), d = h2(xi + 1, yi + 1, salt);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Two octaves of dune shaping, in tile units. */
function dune(tx, ty) {
  return vnoise(tx / 9, ty / 7, 1) * 0.62 +
         vnoise(tx / 3.3, ty / 2.7, 2) * 0.28 +
         vnoise(tx / 1.4, ty / 1.6, 3) * 0.10;
}

export class TerrainPainter {
  constructor(grid) {
    this.grid = grid;
    this.cache = new Map();
    this.order = [];
  }

  invalidateTile(tx, ty) {
    // A tile change can bleed into neighbouring chunks through props, so drop
    // the 3x3 block around it.
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - 1; x <= cx + 1; x++) this._drop(x, y);
  }

  invalidateAll() { this.cache.clear(); this.order.length = 0; }

  _drop(cx, cy) {
    const k = cy * 4096 + cx;
    if (this.cache.delete(k)) {
      const i = this.order.indexOf(k);
      if (i >= 0) this.order.splice(i, 1);
    }
  }

  getChunk(cx, cy) {
    const k = cy * 4096 + cx;
    let c = this.cache.get(k);
    if (c) return c;
    c = makeCanvas(CHUNK_PX, CHUNK_PX);
    this._paint(c.getContext('2d'), cx, cy);
    this.cache.set(k, c);
    this.order.push(k);
    while (this.order.length > MAX_CACHED) {
      const old = this.order.shift();
      this.cache.delete(old);
    }
    return c;
  }

  /** Draw every chunk overlapping the given world rectangle. */
  drawView(g, x0, y0, x1, y1) {
    const cx0 = Math.floor(x0 / CHUNK_PX), cx1 = Math.floor(x1 / CHUNK_PX);
    const cy0 = Math.floor(y0 / CHUNK_PX), cy1 = Math.floor(y1 / CHUNK_PX);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cy < 0) continue;
        if (cx * CHUNK >= this.grid.w || cy * CHUNK >= this.grid.h) continue;
        g.drawImage(this.getChunk(cx, cy), cx * CHUNK_PX, cy * CHUNK_PX);
      }
    }
  }

  _paint(g, cx, cy) {
    const grid = this.grid;
    const ox = cx * CHUNK, oy = cy * CHUNK;

    // Base pass: one flat tile fill per cell.
    for (let ty = oy - 1; ty <= oy + CHUNK; ty++) {
      for (let tx = ox - 1; tx <= ox + CHUNK; tx++) {
        const px = (tx - ox) * TILE, py = (ty - oy) * TILE;
        const t = grid.inBounds(tx, ty) ? grid.get(tx, ty) : T.SAND;
        this._base(g, px, py, tx, ty, t);
      }
    }
    // Dune pass: a single smoothly-interpolated light/shade layer over the
    // whole chunk. This is what turns flat tiles into rolling ground, and it
    // costs one upscaled 19x19 image per chunk.
    this._dunes(g, ox, oy);

    // Edge pass: water foam, berm shading, road markings need neighbours.
    for (let ty = oy - 1; ty <= oy + CHUNK; ty++) {
      for (let tx = ox - 1; tx <= ox + CHUNK; tx++) {
        const px = (tx - ox) * TILE, py = (ty - oy) * TILE;
        const t = grid.inBounds(tx, ty) ? grid.get(tx, ty) : T.SAND;
        this._edges(g, px, py, tx, ty, t);
      }
    }
    // Prop pass: palms and rubble overhang their tile, so they come last and
    // are drawn from one tile outside the chunk to avoid seams.
    for (let ty = oy - 1; ty <= oy + CHUNK; ty++) {
      for (let tx = ox - 1; tx <= ox + CHUNK; tx++) {
        const px = (tx - ox) * TILE, py = (ty - oy) * TILE;
        const t = grid.inBounds(tx, ty) ? grid.get(tx, ty) : T.SAND;
        this._props(g, px, py, tx, ty, t);
      }
    }
  }

  /** Smooth large-scale light and shade, sampled once per tile and upscaled. */
  _dunes(g, ox, oy) {
    const grid = this.grid;
    const N = CHUNK + 3;                        // one sample per tile, plus margin
    const c = makeCanvas(N, N);
    const cx2 = c.getContext('2d');
    const img = cx2.createImageData(N, N);
    const d = img.data;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const tx = ox - 1 + i, ty = oy - 1 + j;
        // Water and roads are flat surfaces — keep the dune shading off them.
        const t = grid.inBounds(tx, ty) ? grid.get(tx, ty) : T.SAND;
        const flat = (t === T.WATER || t === T.CANAL);
        const v = dune(tx, ty) - 0.5;
        const amp = flat ? 0 : t === T.ROAD ? 30 : 78;
        const a = Math.min(255, Math.abs(v) * 2 * amp);
        const o = (j * N + i) * 4;
        const lit = v > 0;
        d[o] = lit ? 255 : 42;
        d[o + 1] = lit ? 246 : 34;
        d[o + 2] = lit ? 214 : 22;
        d[o + 3] = a;
      }
    }
    cx2.putImageData(img, 0, 0);
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(c, -TILE * 1.5, -TILE * 1.5, N * TILE, N * TILE);
    g.restore();
  }

  _base(g, px, py, tx, ty, t) {
    switch (t) {
      case T.WATER: {
        g.fillStyle = PAL.water0;
        g.fillRect(px, py, TILE, TILE);
        g.fillStyle = 'rgba(79,129,137,0.55)';
        for (let i = 0; i < 3; i++) {
          const y = py + hRange(tx, ty, i, 3, TILE - 3);
          g.fillRect(px + hRange(tx, ty, i + 9, 0, TILE * 0.5), y, hRange(tx, ty, i + 3, 6, 18), 1.6);
        }
        break;
      }
      case T.CANAL: {
        g.fillStyle = PAL.canal0;
        g.fillRect(px, py, TILE, TILE);
        g.fillStyle = 'rgba(87,133,126,0.6)';
        g.fillRect(px, py + TILE * 0.3, TILE, TILE * 0.4);
        break;
      }
      case T.ROAD: {
        this._sand(g, px, py, tx, ty, 0.55);
        break;
      }
      default:
        this._sand(g, px, py, tx, ty, 1);
    }
  }

  _sand(g, px, py, tx, ty, detail) {
    // A single flat base. Large-scale tone comes from the dune layer, which is
    // smoothly interpolated across tiles — per-tile colour variation is what
    // makes a desert read as a checkerboard, so there is none here.
    g.fillStyle = PAL.sand1;
    g.fillRect(px, py, TILE, TILE);

    // Wind-blown ripples running roughly north-east.
    g.strokeStyle = 'rgba(255,244,214,0.10)';
    g.lineWidth = 1;
    const n = 2 + ((h2(tx, ty, 2) * 3) | 0);
    for (let i = 0; i < n * detail; i++) {
      const sy = py + hRange(tx, ty, 10 + i, 2, TILE - 2);
      const sx = px + hRange(tx, ty, 20 + i, 0, TILE - 12);
      g.beginPath();
      g.moveTo(sx, sy);
      g.quadraticCurveTo(sx + 6, sy - 2.5, sx + 12, sy);
      g.stroke();
    }
    g.fillStyle = 'rgba(120,96,58,0.13)';
    for (let i = 0; i < 2 * detail; i++) {
      g.fillRect(px + hRange(tx, ty, 30 + i, 1, TILE - 3),
                 py + hRange(tx, ty, 40 + i, 1, TILE - 3),
                 hRange(tx, ty, 50 + i, 1, 2.6), hRange(tx, ty, 60 + i, 1, 2.2));
    }
    // Occasional pebble with a contact shadow.
    if (h2(tx, ty, 3) > 0.86 && detail > 0.8) {
      const rx = px + hRange(tx, ty, 4, 6, TILE - 6);
      const ry = py + hRange(tx, ty, 5, 6, TILE - 6);
      const rr2 = hRange(tx, ty, 6, 1.6, 3.2);
      dot(g, rx + 0.8, ry + 1, rr2, 'rgba(90,72,44,0.30)');
      dot(g, rx, ry, rr2, PAL.sandDark);
      dot(g, rx - rr2 * 0.3, ry - rr2 * 0.3, rr2 * 0.55, '#d8bd88');
    }
  }

  _edges(g, px, py, tx, ty, t) {
    const grid = this.grid;
    const at = (dx, dy) => (grid.inBounds(tx + dx, ty + dy) ? grid.get(tx + dx, ty + dy) : T.SAND);

    if (t === T.ROAD) {
      // Asphalt is laid as a rounded ribbon whose shape follows its neighbours,
      // so junctions and ends look deliberate instead of blocky.
      const nN = at(0, -1) === T.ROAD, nS = at(0, 1) === T.ROAD;
      const nE = at(1, 0) === T.ROAD, nW = at(-1, 0) === T.ROAD;
      const inset = 3;
      // Half a pixel of overlap on connected sides so adjacent tiles leave no
      // hairline seam once the ribbon is drawn.
      const x0 = nW ? px - 0.5 : px + inset, x1 = nE ? px + TILE + 0.5 : px + TILE - inset;
      const y0 = nN ? py - 0.5 : py + inset, y1 = nS ? py + TILE + 0.5 : py + TILE - inset;
      rr(g, x0, y0, x1 - x0, y1 - y0, 5);
      g.fillStyle = PAL.road0;
      g.fill();
      g.save(); rr(g, x0, y0, x1 - x0, y1 - y0, 5); g.clip();
      // Cracks and patches.
      g.strokeStyle = 'rgba(30,30,26,0.30)'; g.lineWidth = 0.9;
      for (let i = 0; i < 2; i++) {
        const sx = px + hRange(tx, ty, 70 + i, 2, TILE - 2);
        const sy = py + hRange(tx, ty, 80 + i, 2, TILE - 2);
        g.beginPath(); g.moveTo(sx, sy);
        g.lineTo(sx + hRange(tx, ty, 90 + i, -9, 9), sy + hRange(tx, ty, 100 + i, -9, 9));
        g.stroke();
      }
      // Worn wheel tracks: two slightly paler bands along the direction of travel.
      g.fillStyle = 'rgba(196,186,166,0.055)';
      if (nE || nW) {
        g.fillRect(px - 1, py + TILE * 0.20, TILE + 2, TILE * 0.14);
        g.fillRect(px - 1, py + TILE * 0.64, TILE + 2, TILE * 0.14);
      } else {
        g.fillRect(px + TILE * 0.20, py - 1, TILE * 0.14, TILE + 2);
        g.fillRect(px + TILE * 0.64, py - 1, TILE * 0.14, TILE + 2);
      }
      // Centre line: dashes along whichever axis the road runs.
      const horiz = (nE || nW) && !(nN || nS);
      const vert = (nN || nS) && !(nE || nW);
      if (horiz || vert) {
        g.strokeStyle = 'rgba(205,182,107,0.55)';
        g.lineWidth = 1.8;
        g.setLineDash([9, 8]);
        g.beginPath();
        if (horiz) { g.moveTo(px, py + TILE / 2); g.lineTo(px + TILE, py + TILE / 2); }
        else { g.moveTo(px + TILE / 2, py); g.lineTo(px + TILE / 2, py + TILE); }
        g.stroke();
        g.setLineDash([]);
      }
      g.restore();
      // Sand drifts creeping over the shoulder.
      g.fillStyle = 'rgba(200,171,114,0.5)';
      for (let i = 0; i < 3; i++) {
        if (h2(tx, ty, 110 + i) < 0.55) continue;
        const ex = px + hRange(tx, ty, 120 + i, 2, TILE - 6);
        g.beginPath();
        g.ellipse(ex, py + (h2(tx, ty, 130 + i) < 0.5 ? 2 : TILE - 2),
          hRange(tx, ty, 140 + i, 4, 10), hRange(tx, ty, 150 + i, 2, 4), 0, 0, TAU);
        g.fill();
      }
    }

    if (t === T.WATER || t === T.CANAL) {
      // Foam and a wet sand fringe wherever water meets land.
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const n = at(dx, dy);
        if (n === T.WATER || n === T.CANAL) continue;
        g.save();
        g.globalAlpha = 0.5;
        g.fillStyle = PAL.foam;
        const fx = px + (dx === 1 ? TILE - 4 : 0), fy = py + (dy === 1 ? TILE - 4 : 0);
        g.fillRect(dx !== 0 ? fx : px, dy !== 0 ? fy : py,
                   dx !== 0 ? 4 : TILE, dy !== 0 ? 4 : TILE);
        g.restore();
      }
      g.fillStyle = 'rgba(20,40,44,0.25)';
      g.fillRect(px, py, TILE, 3);
    }

    if (t === T.BERM) {
      // A raised earth bank: lit crest, dark lee side.
      g.fillStyle = PAL.berm0;
      g.fillRect(px, py, TILE, TILE);
      g.fillStyle = PAL.berm1;
      g.beginPath();
      g.moveTo(px, py + TILE); g.lineTo(px, py); g.lineTo(px + TILE, py);
      g.lineTo(px + TILE - 7, py + 7); g.lineTo(px + 7, py + 7);
      g.lineTo(px + 7, py + TILE - 7); g.closePath();
      g.fill();
      g.fillStyle = PAL.bermShadow;
      g.beginPath();
      g.moveTo(px + TILE, py); g.lineTo(px + TILE, py + TILE); g.lineTo(px, py + TILE);
      g.lineTo(px + 7, py + TILE - 7); g.lineTo(px + TILE - 7, py + TILE - 7);
      g.lineTo(px + TILE - 7, py + 7); g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(70,54,30,0.30)'; g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
      // Sandbag revetment along the crest.
      for (let i = 0; i < 3; i++) {
        const bx = px + 5 + i * 8, by = py + hRange(tx, ty, 160 + i, 8, TILE - 12);
        rr(g, bx, by, 7, 4.5, 2);
        g.fillStyle = i % 2 ? '#b8a273' : '#a89264'; g.fill();
        g.strokeStyle = 'rgba(60,48,28,0.35)'; g.lineWidth = 0.6; g.stroke();
      }
    }

    if (t === T.SCRUB) {
      // A soft irregular patch, so a scrub field has a ragged edge rather than
      // a tile-shaped one.
      g.save();
      g.fillStyle = 'rgba(142,133,81,0.26)';
      g.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU;
        const r = TILE * hRange(tx, ty, 400 + k, 0.44, 0.76);
        const x = px + TILE / 2 + Math.cos(a) * r;
        const y = py + TILE / 2 + Math.sin(a) * r;
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  _props(g, px, py, tx, ty, t) {
    if (t === T.SCRUB) {
      const n = 3 + ((h2(tx, ty, 11) * 3) | 0);
      for (let i = 0; i < n; i++) {
        const sx = px + hRange(tx, ty, 170 + i, 3, TILE - 3);
        const sy = py + hRange(tx, ty, 180 + i, 3, TILE - 3);
        g.strokeStyle = i % 2 ? PAL.scrub0 : PAL.scrub1;
        g.lineWidth = 1.1;
        for (let k = 0; k < 4; k++) {
          const a = -Math.PI / 2 + (k - 1.5) * 0.45;
          const len = hRange(tx, ty, 190 + i * 4 + k, 3, 6.5);
          g.beginPath(); g.moveTo(sx, sy);
          g.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
          g.stroke();
        }
      }
    }

    if (t === T.RUBBLE) {
      g.save();
      g.fillStyle = 'rgba(120,110,96,0.38)';
      g.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        const r = TILE * hRange(tx, ty, 420 + k, 0.48, 0.78);
        const x = px + TILE / 2 + Math.cos(a) * r;
        const y = py + TILE / 2 + Math.sin(a) * r;
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill();
      g.restore();
      const n = 6 + ((h2(tx, ty, 12) * 5) | 0);
      for (let i = 0; i < n; i++) {
        const sx = px + hRange(tx, ty, 200 + i, 2, TILE - 4);
        const sy = py + hRange(tx, ty, 220 + i, 2, TILE - 4);
        const w = hRange(tx, ty, 240 + i, 3, 9), hh = hRange(tx, ty, 260 + i, 2.5, 6);
        g.save();
        g.translate(sx, sy);
        g.rotate(hRange(tx, ty, 280 + i, 0, TAU));
        g.fillStyle = 'rgba(50,44,36,0.35)';
        g.fillRect(-w / 2 + 1, -hh / 2 + 1.2, w, hh);
        g.fillStyle = i % 3 === 0 ? PAL.rubble0 : i % 3 === 1 ? PAL.rubble1 : PAL.rubbleDark;
        g.fillRect(-w / 2, -hh / 2, w, hh);
        g.fillStyle = 'rgba(255,250,235,0.16)';
        g.fillRect(-w / 2, -hh / 2, w, 1.2);
        g.restore();
      }
      // Twisted reinforcing bar.
      g.strokeStyle = 'rgba(90,62,44,0.6)'; g.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        const sx = px + hRange(tx, ty, 300 + i, 4, TILE - 8);
        const sy = py + hRange(tx, ty, 310 + i, 4, TILE - 8);
        g.beginPath(); g.moveTo(sx, sy);
        g.quadraticCurveTo(sx + 5, sy - 6, sx + 11, sy - 1);
        g.stroke();
      }
    }

    if (t === T.PALM) {
      // Date palm from above: a shadow, a trunk stub and a fan of fronds.
      const cxp = px + TILE / 2 + hRange(tx, ty, 13, -5, 5);
      const cyp = py + TILE / 2 + hRange(tx, ty, 14, -5, 5);
      const scale = hRange(tx, ty, 15, 0.82, 1.2);
      g.save();
      g.translate(cxp, cyp);
      g.scale(scale, scale);
      g.rotate(hRange(tx, ty, 16, 0, TAU));
      g.fillStyle = 'rgba(40,44,26,0.32)';
      g.beginPath(); g.ellipse(4, 5, 17, 15, 0, 0, TAU); g.fill();
      const fronds = 9;
      for (let i = 0; i < fronds; i++) {
        const a = (i / fronds) * TAU + hRange(tx, ty, 17, 0, 0.6);
        const len = 13 + h2(tx, ty, 18 + i) * 7;
        g.strokeStyle = i % 2 ? PAL.palmFrond0 : PAL.palmFrond1;
        g.lineWidth = 3.4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(Math.cos(a) * len * 0.55 - Math.sin(a) * 3,
                           Math.sin(a) * len * 0.55 + Math.cos(a) * 3,
                           Math.cos(a) * len, Math.sin(a) * len);
        g.stroke();
        g.strokeStyle = 'rgba(150,180,110,0.30)';
        g.lineWidth = 1.1;
        g.stroke();
      }
      dot(g, 0, 0, 4.2, PAL.palmTrunk);
      dot(g, -1, -1, 2.6, '#83693f');
      g.restore();
    }
  }
}

export { CHUNK, CHUNK_PX };
