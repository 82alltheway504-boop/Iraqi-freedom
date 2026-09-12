import { makeCanvas } from '../art/draw.js';
import { factionTeamColor } from '../art/palette.js';
import { TILE } from '../world/terrain.js';
import { RESOURCE_INFO } from '../sim/rules.js';
import { clamp } from '../core/math.js';

// Terrain colours at minimap scale — chosen so the river, the road and the
// green belt all read instantly at 110 px wide.
const TERRAIN_COLOR = [
  [176, 148, 96],   // sand
  [92, 88, 80],     // road
  [150, 138, 88],   // scrub
  [78, 96, 56],     // palm
  [124, 114, 98],   // rubble
  [150, 124, 78],   // berm
  [58, 96, 104],    // water
  [66, 104, 98],    // canal
];

/**
 * Minimap. The terrain is rasterised once at one pixel per tile; only the fog
 * and the unit dots are redrawn, and only a few times a second.
 */
export class Minimap {
  constructor(canvas, world, camera) {
    this.canvas = canvas;
    this.world = world;
    this.camera = camera;
    this.g = canvas.getContext('2d');
    this.gw = world.grid.w;
    this.gh = world.grid.h;
    this.base = makeCanvas(this.gw, this.gh);
    this.baseCtx = this.base.getContext('2d');
    this.scale = 4;
    this.dirty = true;
    this.paintBase();
    this.resize();
  }

  resize() {
    const cssW = this.canvas.clientWidth || 112;
    const scale = Math.max(1, Math.round((cssW / this.gw) * (window.devicePixelRatio || 1)));
    this.scale = scale;
    this.canvas.width = this.gw * scale;
    this.canvas.height = this.gh * scale;
    this.g.imageSmoothingEnabled = false;
  }

  /** Repaint the terrain layer — only needed when the map itself changes. */
  paintBase() {
    const grid = this.world.grid;
    const img = this.baseCtx.createImageData(this.gw, this.gh);
    const d = img.data;
    for (let i = 0; i < this.gw * this.gh; i++) {
      const c = TERRAIN_COLOR[grid.terrain[i]] || TERRAIN_COLOR[0];
      // A per-tile jitter stops large flats looking like a solid block.
      const j = ((i * 2654435761) % 17) - 8;
      const o = i * 4;
      d[o] = clamp(c[0] + j, 0, 255);
      d[o + 1] = clamp(c[1] + j, 0, 255);
      d[o + 2] = clamp(c[2] + j, 0, 255);
      d[o + 3] = 255;
    }
    this.baseCtx.putImageData(img, 0, 0);
    this.dirty = true;
  }

  draw() {
    const g = this.g;
    const s = this.scale;
    const w = this.world;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.base, 0, 0, this.gw * s, this.gh * s);

    // Fog: unexplored is solid, explored-but-unseen is dimmed.
    if (w.fog.enabled) {
      const fog = w.fog;
      for (let ty = 0; ty < this.gh; ty++) {
        for (let tx = 0; tx < this.gw; tx++) {
          const i = ty * this.gw + tx;
          if (fog.visible[i]) continue;
          g.fillStyle = fog.explored[i] ? 'rgba(8,10,6,0.48)' : 'rgba(8,10,6,0.95)';
          g.fillRect(tx * s, ty * s, s, s);
        }
      }
    }

    // Resource sites are marked in their own resource colour, captured or not,
    // because knowing where the economy is matters more than owning it yet.
    for (const b of w.buildings) {
      if (!b.alive || !b.def.yields) continue;
      if (!w.fog.isExplored(b.tx, b.ty)) continue;
      g.fillStyle = RESOURCE_INFO[b.def.yields].color;
      g.fillRect(b.tx * s - s, b.ty * s - s, (b.tw + 2) * s, (b.th + 2) * s);
    }

    // Structures, then units on top.
    for (const b of w.buildings) {
      if (!b.alive || b.owner < 0) continue;
      if (!w.fog.isExplored(b.tx, b.ty)) continue;
      g.fillStyle = b.owner === w.humanIndex ? factionTeamColor(0) : factionTeamColor(b.owner);
      g.fillRect(b.tx * s, b.ty * s, b.tw * s, b.th * s);
      g.fillStyle = 'rgba(8,10,6,0.5)';
      g.fillRect(b.tx * s, b.ty * s, b.tw * s, 1);
    }
    for (const u of w.units) {
      if (!u.alive || u.garrisonedIn || u.transport) continue;
      const tx = (u.x / TILE) | 0, ty = (u.y / TILE) | 0;
      if (u.owner !== w.humanIndex && !w.fog.isVisible(tx, ty)) continue;
      g.fillStyle = factionTeamColor(u.owner);
      const r = u.def.armor === 2 ? s * 2.2 : s * 1.6;
      g.fillRect(tx * s - r / 2 + s / 2, ty * s - r / 2 + s / 2, r, r);
    }

    // Viewport outline.
    const cam = this.camera;
    const halfW = cam.vw / (2 * cam.zoom) / TILE;
    const halfH = cam.vh / (2 * cam.zoom) / TILE;
    const cx = cam.x / TILE, cy = cam.y / TILE;
    g.strokeStyle = 'rgba(231,229,205,0.9)';
    g.lineWidth = Math.max(1, s * 0.5);
    g.strokeRect((cx - halfW) * s, (cy - halfH) * s, halfW * 2 * s, halfH * 2 * s);
  }

  /** Convert a click on the minimap element into world coordinates. */
  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const fx = clamp((clientX - r.left) / r.width, 0, 1);
    const fy = clamp((clientY - r.top) / r.height, 0, 1);
    return { x: fx * this.gw * TILE, y: fy * this.gh * TILE };
  }
}
