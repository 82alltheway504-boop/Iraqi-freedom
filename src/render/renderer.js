import { PAL, factionTeamColor } from '../art/palette.js';
import { TerrainPainter } from '../art/terrain.js';
import { makeCanvas, rr, dot } from '../art/draw.js';
import { RadialCache } from '../art/radial.js';
import { TILE } from '../world/terrain.js';
import { clamp, TAU } from '../core/math.js';
export class Renderer {
  constructor(canvas, world, art) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.art = art;
    this.terrain = new TerrainPainter(world.grid);
    this.dpr = 1;
    this.fogCanvas = makeCanvas(world.grid.w, world.grid.h);
    this.fogCtx = this.fogCanvas.getContext('2d');
    this.fogImage = this.fogCtx.createImageData(world.grid.w, world.grid.h);
    // Creating a radial gradient per particle per frame is the single most
    // expensive thing a Canvas2D game can do. Bake them once instead.
    this.puffs = new RadialCache();
    this.showRanges = false;
    this.placement = null;          // { defId, tx, ty, ok }
    this.markers = [];              // transient move / attack pings
    this.moveOverlay = null;        // Map<tileIndex, {ap,max}> — where the selection may go
    this.targetOverlay = null;      // Set<entityId> — what it may shoot
  }

  resize(cssW, cssH, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
  }

  ping(x, y, kind) {
    this.markers.push({ x, y, kind, life: 0.7, max: 0.7 });
  }

  updateMarkers(dt) {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      this.markers[i].life -= dt;
      if (this.markers[i].life <= 0) this.markers.splice(i, 1);
    }
  }

  draw(cam, sel, time) {
    const g = this.g;
    const w = this.world;
    g.save();
    g.scale(this.dpr, this.dpr);
    g.fillStyle = PAL.shroud;
    g.fillRect(0, 0, cam.vw, cam.vh);

    g.save();
    g.translate(cam.vw / 2, cam.vh / 2);
    g.scale(cam.zoom, cam.zoom);
    g.translate(-cam.x - cam.shakeX, -cam.y - cam.shakeY);

    const view = cam.viewRect(TILE * 2);
    const visible = (x, y, pad = 48) =>
      x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;

    // --- ground ---------------------------------------------------------
    this.terrain.drawView(g, view.x0, view.y0, view.x1, view.y1);
    this._drawDecals(g, visible);
    if (this.moveOverlay) this._drawMoveOverlay(g, view);

    // --- structures -----------------------------------------------------
    for (const b of w.buildings) {
      if (!visible(b.cx, b.cy, Math.max(b.halfW, b.halfH) + 40)) continue;
      if (!this._seen(b.cx, b.cy) && b.owner !== w.humanIndex) continue;
      this._drawBuilding(g, b, sel, time);
    }

    // --- rally lines and orders for the selection -----------------------
    this._drawOrders(g, sel, time);

    // --- units ----------------------------------------------------------
    const units = [];
    for (const u of w.units) {
      if (u.garrisonedIn || u.transport) continue;
      if (!visible(u.x, u.y)) continue;
      if (u.owner !== w.humanIndex && !w.fog.isVisibleWorld(u.x, u.y)) continue;
      units.push(u);
    }
    units.sort((a, b) => a.y - b.y);
    for (const u of units) this._drawUnit(g, u, sel, time);

    // --- projectiles, effects -------------------------------------------
    if (this.targetOverlay) this._drawTargets(g, time);
    this._drawProjectiles(g, visible);
    this._drawFx(g, visible);
    this._drawMarkers(g);
    if (this.placement) this._drawPlacement(g, cam);

    // --- fog on top ------------------------------------------------------
    this._drawFog(g, view);

    g.restore();
    g.restore();
  }

  _seen(x, y) {
    return this.world.fog.isExplored(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  // --- layers ---------------------------------------------------------------
  _drawDecals(g, visible) {
    const d = this.world.fx.decals;
    const spr = this.puffs.scorch();
    g.save();
    for (const s of d) {
      if (!visible(s.x, s.y, s.r + 20)) continue;
      g.globalAlpha = s.a;
      g.drawImage(spr, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    }
    g.globalAlpha = 1;
    g.restore();
  }

  /**
   * Tiles the selection can reach this turn. The single most important
   * affordance in a turn-based game: the player must see the consequence of a
   * move before committing, not after.
   */
  _drawMoveOverlay(g, view) {
    const W = this.world.grid.w;
    const inView = (x, y) => x > view.x0 - TILE && x < view.x1 && y > view.y0 - TILE && y < view.y1;
    g.save();
    for (const [idx, node] of this.moveOverlay) {
      const x = (idx % W) * TILE, y = ((idx / W) | 0) * TILE;
      if (!inView(x, y)) continue;
      // Cheaper tiles read brighter, so the cost gradient is visible at a glance.
      const frac = node.max ? node.ap / node.max : 0;
      g.fillStyle = `rgba(127,212,255,${(0.30 - frac * 0.16).toFixed(3)})`;
      g.fillRect(x, y, TILE, TILE);
    }
    g.strokeStyle = 'rgba(150,220,255,0.55)';
    g.lineWidth = 1.6;
    g.beginPath();
    for (const [idx] of this.moveOverlay) {
      const x = (idx % W) * TILE, y = ((idx / W) | 0) * TILE;
      if (!inView(x, y)) continue;
      if (!this.moveOverlay.has(idx - W)) { g.moveTo(x, y); g.lineTo(x + TILE, y); }
      if (!this.moveOverlay.has(idx + W)) { g.moveTo(x, y + TILE); g.lineTo(x + TILE, y + TILE); }
      if (!this.moveOverlay.has(idx - 1)) { g.moveTo(x, y); g.lineTo(x, y + TILE); }
      if (!this.moveOverlay.has(idx + 1)) { g.moveTo(x + TILE, y); g.lineTo(x + TILE, y + TILE); }
    }
    g.stroke();
    g.restore();
  }

  /** Brackets around everything the selection could shoot right now. */
  _drawTargets(g, time) {
    const pulse = 0.55 + 0.35 * Math.sin(time * 5);
    g.save();
    g.strokeStyle = `rgba(224,112,79,${pulse.toFixed(3)})`;
    g.lineWidth = 2.2;
    for (const id of this.targetOverlay) {
      const e = this.world.entityById(id);
      if (!e) continue;
      const x = e.cx ?? e.x, y = e.cy ?? e.y;
      const r = e.kind === 'building' ? Math.max(e.halfW, e.halfH) + 6 : e.radius + 9;
      for (let i = 0; i < 4; i++) {
        const a0 = i * (TAU / 4) + 0.35;
        g.beginPath();
        g.arc(x, y, r, a0, a0 + 0.55);
        g.stroke();
      }
    }
    g.restore();
  }

  _drawBuilding(g, b, sel, time) {
    const art = this.art.buildings[b.defId];
    if (!art) return;
    const dim = !this.world.fog.isVisibleWorld(b.cx, b.cy) && b.owner !== this.world.humanIndex;

    g.save();
    g.translate(b.cx, b.cy);

    // Contact shadow.
    g.fillStyle = 'rgba(35,28,16,0.34)';
    rr(g, -b.halfW + 3, -b.halfH + 4, b.tw * TILE, b.th * TILE, 4);
    g.fill();

    if (!b.built) {
      // Under construction: scaffold grid filling upward.
      g.globalAlpha = 0.35 + b.constructing * 0.6;
      g.drawImage(art.body.canvas, -art.body.ox, -art.body.oy, art.body.w, art.body.h);
      g.globalAlpha = 1;
      g.save();
      rr(g, -b.halfW, -b.halfH, b.tw * TILE, b.th * TILE, 3);
      g.clip();
      const filled = b.th * TILE * b.constructing;
      g.fillStyle = 'rgba(226,194,106,0.10)';
      g.fillRect(-b.halfW, b.halfH - filled, b.tw * TILE, filled);
      g.strokeStyle = 'rgba(226,194,106,0.45)'; g.lineWidth = 1;
      for (let y = -b.halfH; y < b.halfH; y += 8) {
        g.beginPath(); g.moveTo(-b.halfW, y); g.lineTo(b.halfW, y); g.stroke();
      }
      g.restore();
      g.strokeStyle = 'rgba(226,194,106,0.8)';
      g.lineWidth = 1.6;
      g.setLineDash([6, 5]);
      g.strokeRect(-b.halfW, -b.halfH, b.tw * TILE, b.th * TILE);
      g.setLineDash([]);
    } else {
      if (dim) g.globalAlpha = 0.62;
      g.drawImage(art.body.canvas, -art.body.ox, -art.body.oy, art.body.w, art.body.h);
      g.globalAlpha = 1;
      if (art.turret) {
        g.save();
        g.rotate(b.turretAngle);
        g.drawImage(art.turret.canvas, -art.turret.ox, -art.turret.oy, art.turret.w, art.turret.h);
        g.restore();
        if (b.muzzle > 0) this._muzzle(g, b.turretAngle, b.boundRadius * 0.8, 1.3);
      }
    }

    // Battle damage reads as a dark wash plus a hit flash.
    if (b.hpFrac < 0.99) {
      g.save();
      rr(g, -b.halfW, -b.halfH, b.tw * TILE, b.th * TILE, 3);
      g.clip();
      g.fillStyle = `rgba(30,22,14,${(1 - b.hpFrac) * 0.38})`;
      g.fillRect(-b.halfW, -b.halfH, b.tw * TILE, b.th * TILE);
      g.restore();
    }
    if (this.world.time < b.flashUntil) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(255,190,120,0.30)';
      rr(g, -b.halfW, -b.halfH, b.tw * TILE, b.th * TILE, 3);
      g.fill();
      g.restore();
    }

    // Garrison pips along the top edge.
    if (b.garrison.length) {
      const col = factionTeamColor(b.garrisonHolder ?? b.owner);
      for (let i = 0; i < b.garrison.length; i++) {
        dot(g, -b.halfW + 8 + i * 9, -b.halfH + 7, 3.2, col);
        dot(g, -b.halfW + 8 + i * 9, -b.halfH + 7, 1.6, 'rgba(20,24,16,0.8)');
      }
    }

    // Capture progress collar.
    if (b.captureFrac > 0) {
      g.strokeStyle = 'rgba(20,24,16,0.6)'; g.lineWidth = 5;
      g.beginPath(); g.arc(0, 0, b.boundRadius + 6, 0, TAU); g.stroke();
      g.strokeStyle = PAL.hudGold; g.lineWidth = 4;
      g.beginPath(); g.arc(0, 0, b.boundRadius + 6, -Math.PI / 2, -Math.PI / 2 + TAU * b.captureFrac);
      g.stroke();
    }
    if (this.world.time - b.repairPulse < 0.3) {
      g.strokeStyle = 'rgba(168,211,106,0.7)'; g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, b.boundRadius + 10, 0, TAU); g.stroke();
    }

    const selected = sel.has(b.id);
    if (selected) {
      g.strokeStyle = PAL.hudGold;
      g.lineWidth = 2;
      const m = 4;
      const cl = 10;
      const x0 = -b.halfW - m, y0 = -b.halfH - m, x1 = b.halfW + m, y1 = b.halfH + m;
      g.beginPath();
      for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
        g.moveTo(cx, cy + sy * cl); g.lineTo(cx, cy); g.lineTo(cx + sx * cl, cy);
      }
      g.stroke();
      if (b.def.buildRadius) {
        g.strokeStyle = 'rgba(226,194,106,0.22)';
        g.lineWidth = 2;
        g.setLineDash([10, 8]);
        g.beginPath(); g.arc(0, 0, b.def.buildRadius * TILE, 0, TAU); g.stroke();
        g.setLineDash([]);
      }
    }

    if (b.hpFrac < 1 || selected) this._hpBar(g, 0, -b.halfH - 9, Math.min(b.tw * TILE - 6, 52), b.hpFrac, b.owner);

    // Production progress under the structure.
    if (b.queue.length) {
      const jp = b.queue[0].progress;
      const bw = Math.min(b.tw * TILE - 8, 48);
      g.fillStyle = 'rgba(12,16,10,0.7)';
      rr(g, -bw / 2, b.halfH + 3, bw, 4, 2); g.fill();
      g.fillStyle = PAL.hudGold;
      rr(g, -bw / 2, b.halfH + 3, bw * jp, 4, 2); g.fill();
    }
    g.restore();
  }

  _drawUnit(g, u, sel, time) {
    const art = this.art.units[u.defId];
    if (!art) return;
    const selected = sel.has(u.id);
    const teamCol = factionTeamColor(u.owner);

    g.save();
    g.translate(u.x, u.y);

    if (selected) {
      // Selection ring drawn on the ground under the unit.
      g.save();
      g.scale(1, 0.62);
      g.strokeStyle = PAL.hudGold;
      g.lineWidth = 2 / 0.62 * 0.8;
      g.beginPath(); g.arc(0, 4, u.radius + 6, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(226,194,106,0.25)';
      g.lineWidth = 5;
      g.beginPath(); g.arc(0, 4, u.radius + 6, 0, TAU); g.stroke();
      g.restore();
    }

    if (u.isAir) {
      // Aircraft cast a ground shadow, which is how altitude reads from above.
      g.save();
      g.translate(11, 15);
      g.rotate(u.angle);
      g.globalAlpha = 0.22;
      const sp = art.hull;
      g.drawImage(sp.canvas, -sp.ox, -sp.oy, sp.w, sp.h);
      g.restore();
      g.globalAlpha = 1;
    }

    g.rotate(u.angle);
    if (art.infantry) {
      // Alternate the two walk frames from distance travelled. Drawn slightly
      // larger than the collision radius: a lone soldier has to stay readable
      // on a phone at a zoomed-out view.
      const fr = u.moving ? ((u.trackPhase / 9) | 0) % 2 : 0;
      const s = art.frames[fr];
      const k = 1.3;
      g.drawImage(s.canvas, -s.ox * k, -s.oy * k, s.w * k, s.h * k);
    } else {
      const s = art.hull;
      g.save();
      // Recoil kick along the barrel axis.
      if (u.recoil > 0 && !art.turret) g.translate(-u.recoil * 1.6, 0);
      g.drawImage(s.canvas, -s.ox, -s.oy, s.w, s.h);
      g.restore();
    }
    g.restore();

    if (art.turret) {
      g.save();
      g.translate(u.x, u.y);
      g.rotate(u.turretAngle);
      if (art.turretOffset) g.translate(art.turretOffset, 0);
      if (u.recoil > 0) g.translate(-u.recoil * 2.2, 0);
      const s = art.turret;
      g.drawImage(s.canvas, -s.ox, -s.oy, s.w, s.h);
      g.restore();
    }

    if (u.muzzle > 0) {
      g.save();
      g.translate(u.x, u.y);
      this._muzzle(g, u.turretAngle, u.radius + 6, art.turret ? 1.6 : 1);
      g.restore();
    }

    g.save();
    g.translate(u.x, u.y);
    if (this.world.time < u.flashUntil) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      dot(g, 0, 0, u.radius + 4, 'rgba(255,190,130,0.35)');
      g.restore();
    }

    // Veterancy chevrons.
    if (u.rank > 0) {
      g.save();
      g.translate(u.radius + 4, -u.radius - 2);
      g.strokeStyle = u.rank >= 3 ? '#ffd76a' : u.rank >= 2 ? '#e8e3d2' : '#d9b45f';
      g.lineWidth = 1.5;
      for (let i = 0; i < u.rank; i++) {
        g.beginPath();
        g.moveTo(-3, i * 3.4); g.lineTo(0, i * 3.4 - 2.6); g.lineTo(3, i * 3.4);
        g.stroke();
      }
      g.restore();
    }
    if (u.veterancyFlash > 0) {
      g.strokeStyle = `rgba(255,215,106,${u.veterancyFlash / 1.2})`;
      g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, u.radius + 6 + (1.2 - u.veterancyFlash) * 16, 0, TAU); g.stroke();
    }

    // Cargo and supply indicators.
    if (u.cargo.length) {
      for (let i = 0; i < u.cargo.length; i++) dot(g, -u.radius + 3 + i * 6, -u.radius - 5, 2.6, teamCol);
    }
    if (u.def.carry && u.carrying > 0) {
      const f = u.carrying / u.def.carry;
      g.fillStyle = 'rgba(12,16,10,0.7)';
      rr(g, -10, -u.radius - 11, 20, 3.4, 1.6); g.fill();
      g.fillStyle = '#bfe08a';
      rr(g, -10, -u.radius - 11, 20 * f, 3.4, 1.6); g.fill();
    }

    // Action points as pips — the resource the player spends every turn.
    if (u.owner === this.world.humanIndex && u.apMax > 0) {
      const n = Math.min(u.apMax, 12);
      const pipW = 2.6, gap = 1.2;
      const totalW = n * pipW + (n - 1) * gap;
      const py = u.radius + 7;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i < u.ap ? '#7fd4ff' : 'rgba(18,24,18,0.8)';
        g.fillRect(-totalW / 2 + i * (pipW + gap), py, pipW, 3);
      }
    }
    // Dug in: chevrons under the unit, one per level.
    if (u.entrench > 0) {
      g.strokeStyle = `rgba(168,211,106,${(0.45 + 0.25 * u.entrench).toFixed(2)})`;
      g.lineWidth = 1.6;
      for (let i = 0; i < Math.ceil(u.entrench); i++) {
        g.beginPath();
        g.moveTo(-6, u.radius + 13 + i * 3);
        g.lineTo(0, u.radius + 10 + i * 3);
        g.lineTo(6, u.radius + 13 + i * 3);
        g.stroke();
      }
    }
    const showHp = selected || u.hpFrac < 0.995 || this.world.time - u.lastHitAt < 4;
    if (showHp) this._hpBar(g, 0, -u.radius - 6, Math.max(22, u.radius * 2.1), u.hpFrac, u.owner);
    else if (u.owner !== this.world.humanIndex) {
      // Always mark hostiles with a small team pip so they never blend in.
      dot(g, 0, -u.radius - 6, 2.4, teamCol);
    }
    g.restore();
  }

  _muzzle(g, angle, dist, scale) {
    g.save();
    g.rotate(angle);
    g.translate(dist, 0);
    g.globalCompositeOperation = 'lighter';
    const r = 9 * scale;
    g.drawImage(this.puffs.flash(), -r, -r, r * 2, r * 2);
    g.fillStyle = 'rgba(255,238,190,0.85)';
    g.beginPath();
    g.moveTo(0, -2.2 * scale); g.lineTo(9 * scale, 0); g.lineTo(0, 2.2 * scale);
    g.closePath(); g.fill();
    g.restore();
  }

  _hpBar(g, x, y, w, frac, owner) {
    const h = 3.6;
    g.fillStyle = 'rgba(10,14,8,0.75)';
    rr(g, x - w / 2, y, w, h, 1.8); g.fill();
    g.fillStyle = frac > 0.6 ? PAL.hpGood : frac > 0.3 ? PAL.hpMid : PAL.hpBad;
    rr(g, x - w / 2 + 0.6, y + 0.6, (w - 1.2) * frac, h - 1.2, 1.3); g.fill();
    g.fillStyle = factionTeamColor(owner);
    rr(g, x - w / 2 - 3.6, y, 2.6, h, 1.2); g.fill();
  }

  _drawOrders(g, sel, time) {
    const w = this.world;
    g.save();
    g.lineWidth = 1.4;
    for (const id of sel) {
      const e = w.entityById(id);
      if (!e) continue;
      if (e.kind === 'building') {
        if (e.rally) {
          g.strokeStyle = 'rgba(226,194,106,0.5)';
          g.setLineDash([7, 6]);
          g.beginPath(); g.moveTo(e.cx, e.cy); g.lineTo(e.rally.x, e.rally.y); g.stroke();
          g.setLineDash([]);
          this._flag(g, e.rally.x, e.rally.y, PAL.hudGold);
        }
        continue;
      }
      // A unit part-way through its move: show the rest of the walk it paid for.
      const path = e.path;
      if (path && path.length) {
        g.strokeStyle = 'rgba(215,224,194,0.42)';
        g.setLineDash([6, 6]);
        g.beginPath();
        g.moveTo(e.x, e.y);
        for (let i = e.pathIdx; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
        g.stroke();
        g.setLineDash([]);
        const last = path[path.length - 1];
        this._flag(g, last.x, last.y, PAL.hudText);
      }
      if (e.target) {
        const t = w.entityById(e.target);
        if (t) {
          g.strokeStyle = 'rgba(224,112,79,0.45)';
          g.setLineDash([3, 5]);
          g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(t.x, t.y); g.stroke();
          g.setLineDash([]);
        }
      }
      if (this.showRanges && e.weapons?.length) {
        g.strokeStyle = 'rgba(224,112,79,0.16)';
        g.setLineDash([4, 8]);
        g.beginPath(); g.arc(e.x, e.y, e.weaponRange(), 0, TAU); g.stroke();
        g.setLineDash([]);
      }
    }
    g.restore();
  }

  _flag(g, x, y, color) {
    g.save();
    g.translate(x, y);
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -13); g.stroke();
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, -13); g.lineTo(9, -10); g.lineTo(0, -7); g.closePath(); g.fill();
    g.beginPath(); g.arc(0, 0, 2, 0, TAU); g.fill();
    g.restore();
  }

  _drawProjectiles(g, visible) {
    for (const p of this.world.projectiles) {
      if (!visible(p.x, p.y, 20)) continue;
      const a = Math.atan2(p.vy, p.vx);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(a);
      if (p.kind === 'rocket') {
        g.fillStyle = '#4b4636';
        rr(g, -6, -1.8, 12, 3.6, 1.4); g.fill();
        g.fillStyle = '#cf6a34';
        g.beginPath(); g.moveTo(-6, -1.8); g.lineTo(-12, 0); g.lineTo(-6, 1.8); g.closePath(); g.fill();
        g.globalCompositeOperation = 'lighter';
        dot(g, -8, 0, 3.4, 'rgba(255,170,70,0.55)');
      } else if (p.kind === 'flak') {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(255,226,150,0.9)';
        rr(g, -4, -0.9, 8, 1.8, 0.9); g.fill();
      } else {
        g.fillStyle = '#f2e2b4';
        rr(g, -5, -1.3, 10, 2.6, 1.3); g.fill();
        g.globalCompositeOperation = 'lighter';
        dot(g, -4, 0, 2.4, 'rgba(255,210,130,0.5)');
      }
      g.restore();
    }
  }

  _drawFx(g, visible) {
    const fx = this.world.fx;
    g.save();
    // Tracers first, additively — they should glow.
    g.globalCompositeOperation = 'lighter';
    for (const t of fx.tracers) {
      const a = t.life / t.maxLife;
      g.strokeStyle = t.color;
      g.globalAlpha = a;
      g.lineWidth = t.width;
      g.beginPath(); g.moveTo(t.x0, t.y0); g.lineTo(t.x1, t.y1); g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // Two passes so the composite mode is switched once, not per particle.
    for (let pass = 0; pass < 2; pass++) {
      g.globalCompositeOperation = pass === 1 ? 'lighter' : 'source-over';
      for (const p of fx.parts) {
        if (p.life <= 0) continue;
        if ((p.glow ? 1 : 0) !== pass) continue;
        if (!visible(p.x, p.y, 40)) continue;
        const t = p.life / p.maxLife;
        const r = p.r1 + (p.r0 - p.r1) * t;
        if (r <= 0.4) continue;
        const a = clamp(t * 1.25, 0, 1);
        if (a < 0.045) continue;        // invisible, but still costs a blit
        g.globalAlpha = a;
        if (p.spin) {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = p.c0;
          g.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
          g.restore();
          continue;
        }
        const spr = this.puffs.get(p.c0, p.c1);
        g.drawImage(spr, p.x - r, p.y - r, r * 2, r * 2);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    g.font = 'bold 12px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    for (const t of fx.texts) {
      const a = clamp(t.life / t.maxLife, 0, 1);
      g.fillStyle = 'rgba(10,14,8,0.6)';
      g.fillText(t.str, t.x + 1, t.y + 1);
      g.globalAlpha = a;
      g.fillStyle = t.color;
      g.fillText(t.str, t.x, t.y);
      g.globalAlpha = 1;
    }
    g.restore();
  }

  _drawMarkers(g) {
    for (const m of this.markers) {
      const t = 1 - m.life / m.max;
      const r = 6 + t * 20;
      g.save();
      g.globalAlpha = 1 - t;
      g.strokeStyle = m.kind === 'attack' ? PAL.bad : m.kind === 'attackMove' ? '#e0b24f' : PAL.hudText;
      g.lineWidth = 2.4;
      g.beginPath(); g.arc(m.x, m.y, r, 0, TAU); g.stroke();
      if (m.kind !== 'move') {
        g.beginPath();
        g.moveTo(m.x - r - 4, m.y); g.lineTo(m.x - r + 4, m.y);
        g.moveTo(m.x + r - 4, m.y); g.lineTo(m.x + r + 4, m.y);
        g.moveTo(m.x, m.y - r - 4); g.lineTo(m.x, m.y - r + 4);
        g.moveTo(m.x, m.y + r - 4); g.lineTo(m.x, m.y + r + 4);
        g.stroke();
      }
      g.restore();
    }
  }

  _drawPlacement(g, cam) {
    const p = this.placement;
    const d = this.art.buildings[p.defId];
    if (!d) return;
    const x = p.tx * TILE, y = p.ty * TILE;
    const w = d.def.size[0] * TILE, h = d.def.size[1] * TILE;
    g.save();
    g.globalAlpha = 0.55;
    g.drawImage(d.body.canvas, x + w / 2 - d.body.ox, y + h / 2 - d.body.oy, d.body.w, d.body.h);
    g.globalAlpha = 1;
    g.strokeStyle = p.ok ? 'rgba(168,211,106,0.95)' : 'rgba(224,112,79,0.95)';
    g.lineWidth = 2;
    g.setLineDash([8, 6]);
    g.strokeRect(x, y, w, h);
    g.setLineDash([]);
    g.fillStyle = p.ok ? 'rgba(168,211,106,0.14)' : 'rgba(224,112,79,0.18)';
    g.fillRect(x, y, w, h);
    // Grid cells so the player can see exactly what footprint they are placing.
    g.strokeStyle = p.ok ? 'rgba(168,211,106,0.35)' : 'rgba(224,112,79,0.35)';
    g.lineWidth = 1;
    for (let i = 1; i < d.def.size[0]; i++) {
      g.beginPath(); g.moveTo(x + i * TILE, y); g.lineTo(x + i * TILE, y + h); g.stroke();
    }
    for (let i = 1; i < d.def.size[1]; i++) {
      g.beginPath(); g.moveTo(x, y + i * TILE); g.lineTo(x + w, y + i * TILE); g.stroke();
    }
    g.restore();
  }

  /**
   * Fog is rasterised at one pixel per tile then scaled up with smoothing,
   * which gives soft edges for the cost of a 96x72 image.
   */
  _drawFog(g, view) {
    const fog = this.world.fog;
    if (!fog.enabled) return;
    const grid = this.world.grid;

    // The fog raster only changes when the fog itself is recomputed, which is
    // eight times a second — not every frame.
    if (fog.dirty || !this._fogPainted) {
      const img = this.fogImage;
      const d = img.data;
      for (let i = 0, n = grid.w * grid.h; i < n; i++) {
        const a = fog.visible[i] ? 0 : fog.explored[i] ? 128 : 246;
        const o = i * 4;
        d[o] = 10; d[o + 1] = 12; d[o + 2] = 8; d[o + 3] = a;
      }
      this.fogCtx.putImageData(img, 0, 0);
      fog.dirty = false;
      this._fogPainted = true;
    }

    // Blit only the tiles actually on screen. Scaling the whole 96x72 raster
    // across the entire map every frame is pure waste when zoomed in.
    const t0x = clamp(Math.floor(view.x0 / TILE) - 1, 0, grid.w - 1);
    const t0y = clamp(Math.floor(view.y0 / TILE) - 1, 0, grid.h - 1);
    const t1x = clamp(Math.ceil(view.x1 / TILE) + 1, 1, grid.w);
    const t1y = clamp(Math.ceil(view.y1 / TILE) + 1, 1, grid.h);
    const sw = t1x - t0x, sh = t1y - t0y;
    if (sw > 0 && sh > 0) {
      g.save();
      g.imageSmoothingEnabled = true;
      // Half a tile of bleed so the smoothing gradient lands on tile edges.
      g.drawImage(this.fogCanvas, t0x, t0y, sw, sh,
        t0x * TILE - TILE / 2, t0y * TILE - TILE / 2,
        sw * TILE + TILE, sh * TILE + TILE);
      g.restore();
    }

    // Beyond the map edge, full shroud.
    const W = grid.w * TILE, H = grid.h * TILE, m = 3000;
    g.fillStyle = PAL.shroud;
    g.fillRect(-m, -m, W + 2 * m, m);
    g.fillRect(-m, H, W + 2 * m, m);
    g.fillRect(-m, 0, m, H);
    g.fillRect(W, 0, m, H);
  }
}
