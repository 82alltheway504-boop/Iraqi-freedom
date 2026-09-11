import { clamp } from './math.js';

/**
 * World camera. Holds the centre point in world units plus a zoom factor, and
 * converts between world and CSS-pixel screen space. Panning has momentum so
 * a flick on a touch screen keeps gliding, which is what makes a mobile RTS
 * feel good rather than sticky.
 */
export class Camera {
  constructor(worldW, worldH) {
    this.x = worldW / 2;
    this.y = worldH / 2;
    this.zoom = 1;
    this.minZoom = 0.42;
    this.maxZoom = 1.45;
    this.worldW = worldW;
    this.worldH = worldH;
    this.vw = 800; this.vh = 600;
    this.vx = 0; this.vy = 0;         // pan velocity, world units/second
    this.shakeX = 0; this.shakeY = 0;
    this.follow = null;
  }

  resize(vw, vh) {
    this.vw = vw; this.vh = vh;
    // Never let the viewport show more than the map plus a small margin.
    this.minZoom = Math.max(0.3, Math.min(vw / (this.worldW + 160), vh / (this.worldH + 160)));
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.clampToWorld();
  }

  clampToWorld() {
    const halfW = this.vw / (2 * this.zoom);
    const halfH = this.vh / (2 * this.zoom);
    if (halfW * 2 >= this.worldW) this.x = this.worldW / 2;
    else this.x = clamp(this.x, halfW, this.worldW - halfW);
    if (halfH * 2 >= this.worldH) this.y = this.worldH / 2;
    else this.y = clamp(this.y, halfH, this.worldH - halfH);
  }

  panBy(dxScreen, dyScreen) {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.follow = null;
    this.clampToWorld();
  }

  flick(vxScreen, vyScreen) {
    this.vx = -vxScreen / this.zoom;
    this.vy = -vyScreen / this.zoom;
  }

  /** Zoom about a fixed screen point so pinch-zoom tracks the fingers. */
  zoomAt(factor, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToWorld();
  }

  centerOn(x, y) { this.x = x; this.y = y; this.vx = this.vy = 0; this.clampToWorld(); }

  glideTo(x, y) { this.follow = { x, y }; this.vx = this.vy = 0; }

  update(dt, shake = 0) {
    if (this.follow) {
      const k = 1 - Math.pow(0.0015, dt);
      this.x += (this.follow.x - this.x) * k;
      this.y += (this.follow.y - this.y) * k;
      if (Math.hypot(this.follow.x - this.x, this.follow.y - this.y) < 3) this.follow = null;
      this.clampToWorld();
    } else if (this.vx || this.vy) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const damp = Math.pow(0.0022, dt);
      this.vx *= damp; this.vy *= damp;
      if (Math.abs(this.vx) < 2 && Math.abs(this.vy) < 2) this.vx = this.vy = 0;
      this.clampToWorld();
    }
    if (shake > 0.05) {
      this.shakeX = (Math.random() * 2 - 1) * shake;
      this.shakeY = (Math.random() * 2 - 1) * shake;
    } else { this.shakeX = this.shakeY = 0; }
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x + this.shakeX) * this.zoom + this.vw / 2,
      y: (wy - this.y + this.shakeY) * this.zoom + this.vh / 2,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.vw / 2) / this.zoom + this.x - this.shakeX,
      y: (sy - this.vh / 2) / this.zoom + this.y - this.shakeY,
    };
  }

  /** Visible world rectangle, with a margin for sprites hanging off-screen. */
  viewRect(margin = 80) {
    const halfW = this.vw / (2 * this.zoom) + margin;
    const halfH = this.vh / (2 * this.zoom) + margin;
    return { x0: this.x - halfW, y0: this.y - halfH, x1: this.x + halfW, y1: this.y + halfH };
  }
}
