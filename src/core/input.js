// ---------------------------------------------------------------------------
// Unified pointer input for touch and mouse, turning raw events into the small
// set of high-level gestures an RTS needs. Designed phone-first:
//
//   tap                  context command (select / move / attack / garrison)
//   drag one finger      pan the camera, with a momentum flick on release
//   long press + drag    box select (also the desktop left-drag)
//   long press, no drag  attack-move marker at that point
//   two fingers          pinch zoom and pan together
//   double tap a unit    select every unit of that type on screen
//
// The caller supplies callbacks rather than listening for DOM events, so the
// game logic never touches the event model directly.
// ---------------------------------------------------------------------------

const TAP_MS = 260;
const TAP_SLOP = 14;          // px of movement still counted as a tap
const LONG_MS = 380;
const DOUBLE_MS = 300;

export class Input {
  constructor(el, handlers) {
    this.el = el;
    this.h = handlers;
    this.pointers = new Map();
    this.mode = 'command';          // 'command' | 'select' | 'place' | 'target'
    this.box = null;                // active selection box in screen space
    this.pinch = null;
    this.longTimer = null;
    this.lastTapAt = 0;
    this.lastTapPos = { x: 0, y: 0 };
    this.suppressTap = false;
    this.hover = { x: 0, y: 0 };
    this.keys = new Set();
    this._bind();
  }

  _local(e) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _bind() {
    const el = this.el;
    const opts = { passive: false };
    el.addEventListener('pointerdown', (e) => this._down(e), opts);
    el.addEventListener('pointermove', (e) => this._move(e), opts);
    el.addEventListener('pointerup', (e) => this._up(e), opts);
    el.addEventListener('pointercancel', (e) => this._up(e, true), opts);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this._local(e);
      this.h.onZoom?.(Math.pow(0.9985, e.deltaY), p.x, p.y);
    }, opts);
    // Block the browser's own pinch-zoom and double-tap-to-zoom on iOS.
    el.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, opts);
    el.addEventListener('gesturestart', (e) => e.preventDefault());
    el.addEventListener('gesturechange', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.target !== document.body && e.target.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      this.h.onKey?.(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  get shift() { return this.keys.has('shift'); }

  _down(e) {
    // Pointer capture is a nicety — it keeps a drag alive if the finger leaves
    // the canvas. It can throw (the pointer may already be gone), and letting
    // that abort the handler would wedge input entirely, so it is never fatal.
    try { this.el.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
    const p = this._local(e);
    const rec = {
      id: e.pointerId, x: p.x, y: p.y, x0: p.x, y0: p.y,
      t0: performance.now(), moved: 0, lastX: p.x, lastY: p.y,
      lastT: performance.now(), vx: 0, vy: 0,
      button: e.button, touch: e.pointerType !== 'mouse',
    };
    this.pointers.set(e.pointerId, rec);
    this.hover = p;

    if (this.pointers.size === 2) {
      // Second finger down: abandon whatever the first was doing and pinch.
      this._clearLong();
      this.box = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      };
      this.suppressTap = true;
      return;
    }
    if (this.pointers.size > 2) return;

    this.h.onDown?.(p.x, p.y, rec);

    // Desktop right button is the command button; left drag boxes.
    if (!rec.touch && e.button === 2) {
      this.suppressTap = true;
      this.h.onCommand?.(p.x, p.y, { shift: this.shift });
      return;
    }
    if (!rec.touch && e.button === 0 && this.mode === 'command') {
      this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, pending: true };
    }

    if (this.mode === 'select') {
      this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, pending: false };
      return;
    }

    if (rec.touch) {
      this._clearLong();
      this.longTimer = setTimeout(() => {
        const r = this.pointers.get(e.pointerId);
        if (!r || r.moved > TAP_SLOP) return;
        this.suppressTap = true;
        this.h.onLongPress?.(r.x, r.y);
        // From here a drag draws a selection box.
        this.box = { x0: r.x, y0: r.y, x1: r.x, y1: r.y, pending: false, fromLong: true };
      }, LONG_MS);
    }
  }

  _move(e) {
    const rec = this.pointers.get(e.pointerId);
    const p = this._local(e);
    this.hover = p;
    if (!rec) { this.h.onHover?.(p.x, p.y); return; }

    const now = performance.now();
    const dt = Math.max(1, now - rec.lastT);
    rec.vx = (p.x - rec.lastX) / dt * 1000;
    rec.vy = (p.y - rec.lastY) / dt * 1000;
    const dx = p.x - rec.x, dy = p.y - rec.y;
    rec.moved += Math.hypot(dx, dy);
    rec.lastX = p.x; rec.lastY = p.y; rec.lastT = now;
    rec.x = p.x; rec.y = p.y;

    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (this.pinch.dist > 4) this.h.onZoom?.(d / this.pinch.dist, cx, cy);
      this.h.onPan?.(cx - this.pinch.cx, cy - this.pinch.cy);
      this.pinch = { dist: d, cx, cy };
      return;
    }

    if (rec.moved > TAP_SLOP) this._clearLong();

    if (this.box && !this.box.pending) {
      this.box.x1 = p.x; this.box.y1 = p.y;
      this.h.onBoxChange?.(this.box);
      return;
    }
    if (this.box && this.box.pending) {
      if (rec.moved > TAP_SLOP) { this.box.pending = false; this.box.x1 = p.x; this.box.y1 = p.y; }
      return;
    }

    // Placing a structure or aiming a support power: the drag positions the
    // thing being placed rather than moving the camera.
    if (this.mode === 'place' || this.mode === 'target') {
      this.h.onDrag?.(p.x, p.y, rec);
      return;
    }

    if (rec.touch && rec.moved > TAP_SLOP && this.mode !== 'select') {
      this.suppressTap = true;
      this.h.onPan?.(dx, dy);
    } else if (!rec.touch && rec.button === 1) {
      this.h.onPan?.(dx, dy);
    }
  }

  _up(e, cancelled = false) {
    const rec = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this._clearLong();
    if (this.pointers.size < 2) this.pinch = null;
    if (!rec) return;
    try { this.el.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }

    const dur = performance.now() - rec.t0;

    // In placement and targeting modes the release is always the commit, however
    // far the finger travelled getting there.
    if ((this.mode === 'place' || this.mode === 'target') && !cancelled && this.pointers.size === 0) {
      this.box = null;
      this.h.onTap?.(rec.x, rec.y, { shift: this.shift });
      this.suppressTap = false;
      return;
    }

    if (this.box) {
      const b = this.box;
      this.box = null;
      const w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
      if (!b.pending && (w > TAP_SLOP || h > TAP_SLOP)) {
        this.h.onBoxSelect?.(b, { shift: this.shift });
        this.suppressTap = true;
        if (this.pointers.size === 0) this.suppressTap = false;
        return;
      }
      // A box that never grew is just a click; fall through to tap handling.
    }

    if (this.pointers.size === 0 && !cancelled && !this.suppressTap &&
        dur < TAP_MS && rec.moved <= TAP_SLOP) {
      const now = performance.now();
      const isDouble = now - this.lastTapAt < DOUBLE_MS &&
        Math.hypot(rec.x - this.lastTapPos.x, rec.y - this.lastTapPos.y) < 28;
      this.lastTapAt = now;
      this.lastTapPos = { x: rec.x, y: rec.y };
      if (isDouble) this.h.onDoubleTap?.(rec.x, rec.y);
      else this.h.onTap?.(rec.x, rec.y, { shift: this.shift });
    } else if (this.pointers.size === 0 && rec.touch && rec.moved > TAP_SLOP &&
               this.mode !== 'select' && !this.box) {
      // Flick: hand the camera the release velocity.
      if (Math.hypot(rec.vx, rec.vy) > 120) this.h.onFlick?.(rec.vx, rec.vy);
    }

    if (this.pointers.size === 0) this.suppressTap = false;
  }

  _clearLong() {
    if (this.longTimer) { clearTimeout(this.longTimer); this.longTimer = null; }
  }

  setMode(m) { this.mode = m; this.box = null; }
}
