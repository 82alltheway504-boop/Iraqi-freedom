import { createMission01, MAP01 } from './missions/m01.js';
import { Camera } from './core/camera.js';
import { Input } from './core/input.js';
import { Renderer } from './render/renderer.js';
import { Minimap } from './ui/minimap.js';
import { Hud, $, el } from './ui/hud.js';
import { Audio } from './audio/audio.js';
import { Music } from './audio/music.js';
import { buildArt } from './art/sprites.js';
import { TILE } from './world/terrain.js';
import { defOf } from './sim/defs.js';
import { clamp } from './core/math.js';
import { showBriefing, showPause, showResults } from './ui/overlays.js';

const STEP = 1 / 30;          // simulation runs at a fixed 30 Hz
const MAX_STEPS = 4;

export class Game {
  constructor() {
    const built = createMission01();
    this.world = built.world;
    this.ai = built.ai;
    this.mission = built.mission;

    this.art = buildArt();
    this.canvas = $('view');
    this.camera = new Camera(this.world.grid.pixelWidth, this.world.grid.pixelHeight);
    this.renderer = new Renderer(this.canvas, this.world, this.art);
    this.audio = new Audio();
    this.music = new Music(this.audio);

    this.selection = new Set();
    this.controlGroups = new Map();
    this.placing = null;          // structure id being positioned
    this.targeting = null;        // support power awaiting a target
    this.strikeLine = null;
    this.pendingCommand = null;   // order awaiting a target tap
    this.paused = false;
    this.running = false;
    this.accum = 0;
    this.last = 0;
    this.speed = 1;

    this.hud = new Hud(this);
    this.minimap = new Minimap($('minimap'), this.world, this.camera);
    this.input = new Input(this.canvas, this._handlers());

    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.running && !this.paused) this.togglePause();
    });

    const start = MAP01.playerStart;
    this.camera.centerOn(start.tx * TILE, start.ty * TILE);
    // A narrow (portrait) viewport needs to start further out to show any
    // useful amount of ground.
    this.camera.zoom = window.innerWidth < 640 ? 0.62 : 0.82;
    this._minimapTimer = 0;
    this._heat = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._lastFps = 0;
    this._slowSamples = 0;
  }

  // --- lifecycle -----------------------------------------------------------
  async begin() {
    await this.audio.unlock();
    this.music.start();
    this.running = true;
    this.paused = false;
    this.last = performance.now();
    requestAnimationFrame((t) => this._frame(t));
    this.hud.pushNotice('Tap to select. Tap again to give an order.', 'info');
    this.hud.hint('Drag to look around · pinch to zoom', 4);
  }

  _resize() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.resize(w, h);
    this.renderer.resize(w, h, dpr);
    this.minimap.resize();
  }

  _frame(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this._frame(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.5) dt = STEP;               // returning from a background tab

    if (!this.paused) {
      this.accum += dt * this.speed;
      let steps = 0;
      while (this.accum >= STEP && steps < MAX_STEPS) {
        this.world.tick(STEP);
        this.ai.update(STEP);
        this.mission.update(STEP);
        this.accum -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) this.accum = 0;   // give up on catching up
      this._drainEvents();
      this._pruneSelection();
    }

    // Rolling frame rate, sampled once a second.
    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 1) {
      this._lastFps = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsAccum = 0;
      this._fpsFrames = 0;
      this._adaptQuality(this._lastFps);
    }

    this.camera.update(dt, this.world.fx.shake);
    this.renderer.updateMarkers(dt);
    this.audio.setListener(this.camera.x, this.camera.y, this.camera.zoom);
    this.audio.update(dt);
    this.music.setHeat(clamp(this.audio.combatHeat, 0, 1));

    this.renderer.draw(this.camera, this.selection, this.world.time);
    this._drawSelectionBox();

    this._minimapTimer -= dt;
    if (this._minimapTimer <= 0) { this._minimapTimer = 0.1; this.minimap.draw(); }
    this.hud.sync(dt, this.mission, this.selection);

    if (this.mission.result && !this._resultShown) {
      this._resultShown = true;
      setTimeout(() => showResults(this, this.mission.summary()), 1400);
    }
  }

  /**
   * Effect density follows the measured frame rate. A phone that cannot keep
   * up gets fewer, smaller particles rather than a stuttering frame — the
   * game stays responsive, which matters far more than the smoke does.
   */
  _adaptQuality(fps) {
    const fx = this.world.fx;
    if (fps > 0 && fps < 42) {
      this._slowSamples++;
      if (this._slowSamples >= 2 && fx.quality > 0.4) {
        fx.quality = Math.max(0.4, fx.quality - 0.22);
        fx.maxParts = Math.max(220, Math.round(fx.maxParts * 0.7));
        this._slowSamples = 0;
      }
    } else {
      this._slowSamples = 0;
      if (fps > 55 && fx.quality < 1) {
        fx.quality = Math.min(1, fx.quality + 0.08);
        fx.maxParts = Math.min(620, Math.round(fx.maxParts * 1.1) + 10);
      }
    }
  }

  /** The selection box lives in screen space, so it is drawn after the world. */
  _drawSelectionBox() {
    const b = this.input.box;
    if (!b || b.pending) return;
    const g = this.renderer.g;
    const dpr = this.renderer.dpr;
    g.save();
    g.scale(dpr, dpr);
    const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
    const w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
    g.fillStyle = 'rgba(227,194,106,0.12)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(227,194,106,0.9)';
    g.lineWidth = 1.5;
    g.setLineDash([6, 4]);
    g.strokeRect(x + 0.5, y + 0.5, w, h);
    g.setLineDash([]);
    g.restore();
  }

  _pruneSelection() {
    for (const id of [...this.selection]) {
      if (!this.world.entityById(id)) this.selection.delete(id);
    }
  }

  // --- world events to sound and interface ---------------------------------
  _drainEvents() {
    const w = this.world;
    for (const ev of w.events) {
      switch (ev.type) {
        case 'shot': {
          const wp = ev.weapon;
          if (wp.projectile === 'shell') this.audio.cannon(ev.x, ev.y);
          else if (wp.projectile === 'rocket') this.audio.rocket(ev.x, ev.y);
          else if (wp.projectile === 'flak' || wp.projectile === 'tracer') this.audio.autocannon(ev.x, ev.y);
          else this.audio.rifle(ev.x, ev.y, wp.damage > 12);
          this.audio.combatHeat = Math.min(1, this.audio.combatHeat + 0.012);
          break;
        }
        case 'explosion': this.audio.explosion(ev.x, ev.y, ev.big); break;
        case 'strafe': this.audio.explosion(ev.x, ev.y, false); break;
        case 'impact': case 'crush': this.audio.impact(ev.x, ev.y); break;
        case 'infantryDown': this.audio.impact(ev.x, ev.y); break;
        case 'promote': if (ev.owner === w.humanIndex) this.audio.promote(); break;
        case 'capture': if (ev.owner === w.humanIndex) this.audio.confirm(); break;
        case 'unitReady':
          if (ev.owner === w.humanIndex) {
            this.audio.unitReady();
            this.hud.pushNotice(`${defOf(ev.defId).name} ready`, 'good');
          }
          break;
        case 'buildComplete':
          if (ev.owner === w.humanIndex) {
            this.audio.buildDone();
            this.hud.pushNotice(`${defOf(ev.defId).name} online`, 'good');
          }
          break;
        case 'airInbound': this.audio.objective(); break;
        default: break;
      }
    }
    w.events.length = 0;

    for (const n of w.notices) this.hud.pushNotice(n.text, n.kind);
    w.notices.length = 0;

    for (const e of this.mission.events) {
      if (e.type === 'objective') this.audio.objective();
      else if (e.type === 'objectiveNew') { this.audio.objective(); this.hud.flagNewObjective(); }
      else if (e.type === 'alert') this.audio.alert();
      else if (e.type === 'victory') { this.music.setHeat(0); this.audio.victory(); }
      else if (e.type === 'defeat') { this.music.setHeat(0); this.audio.defeat(); }
    }
    this.mission.events.length = 0;
  }

  // --- selection helpers ----------------------------------------------------
  get selectedUnits() {
    return [...this.selection].map((id) => this.world.entityById(id))
      .filter((e) => e && e.kind === 'unit');
  }
  get selectedBuildings() {
    return [...this.selection].map((id) => this.world.entityById(id))
      .filter((e) => e && e.kind === 'building');
  }

  select(entities, additive = false) {
    if (!additive) this.selection.clear();
    for (const e of entities) if (e && e.alive) this.selection.add(e.id);
    if (this.selection.size) this.audio.select();
  }

  // --- input ---------------------------------------------------------------
  _handlers() {
    return {
      onPan: (dx, dy) => {
        if (this.placing || this.strikeLine) return;
        this.camera.panBy(dx, dy);
      },
      onFlick: (vx, vy) => { if (!this.placing) this.camera.flick(vx, vy); },
      onZoom: (f, x, y) => this.camera.zoomAt(f, x, y),
      onDown: (x, y, rec) => this._onDown(x, y, rec),
      onHover: (x, y) => { if (this.placing) this._updateGhost(x, y); },
      onDrag: (x, y) => {
        if (this.placing) { this._updateGhost(x, y); return; }
        if (this.strikeLine) {
          const p = this.camera.screenToWorld(x, y);
          this.strikeLine.x1 = p.x;
          this.strikeLine.y1 = p.y;
        }
      },
      onTap: (x, y, mod) => this._onTap(x, y, mod),
      onDoubleTap: (x, y) => this._onDoubleTap(x, y),
      onLongPress: (x, y) => this._onLongPress(x, y),
      onBoxSelect: (b, mod) => this._onBox(b, mod),
      onCommand: (x, y, mod) => this._issueContext(x, y, mod),   // desktop right-click
      onKey: (e) => this._onKey(e),
    };
  }

  _onDown(sx, sy, rec) {
    if (this.placing) { this._updateGhost(sx, sy); return; }
    if (this.targeting === 'air_strike') {
      const p = this.camera.screenToWorld(sx, sy);
      this.strikeLine = { x0: p.x, y0: p.y, x1: p.x + 1, y1: p.y };
      this.renderer.targetingLine = this.strikeLine;
    }
  }

  _updateGhost(sx, sy) {
    const p = this.camera.screenToWorld(sx, sy);
    const d = defOf(this.placing);
    const tx = Math.round(p.x / TILE - d.size[0] / 2);
    const ty = Math.round(p.y / TILE - d.size[1] / 2);
    const check = this.world.canPlace(0, this.placing, tx, ty);
    const cost = this.world.structureCost(0, this.placing);
    this.renderer.placement = {
      defId: this.placing, tx, ty,
      ok: check.ok && this.world.human.supply >= cost,
      reason: check.reason,
    };
  }

  _onTap(sx, sy, mod) {
    // Placing a structure: the tap is the commit.
    if (this.placing) {
      this._updateGhost(sx, sy);
      const g = this.renderer.placement;
      const res = this.world.startStructure(0, this.placing, g.tx, g.ty);
      if (res.ok) {
        this.audio.confirm();
        this.hud.pushNotice(`${defOf(this.placing).name} under construction`, 'good');
        if (!this.input.shift) this.cancelPlacement();
        else this._updateGhost(sx, sy);
      } else {
        this.audio.deny();
        this.hud.hint(res.reason === 'insufficient supply' ? 'Not enough supply' : res.reason);
        if (res.reason === 'insufficient supply') this.hud.flashSupply();
      }
      return;
    }

    // Support powers.
    if (this.targeting) {
      const p = this.camera.screenToWorld(sx, sy);
      this._firePower(p);
      return;
    }

    // A queued order from the command bar takes the next tap as its target.
    if (this.pendingCommand) {
      this._applyPending(sx, sy);
      return;
    }

    this._issueContext(sx, sy, mod);
  }

  /**
   * The heart of the touch control scheme: one tap does the obvious thing.
   * Tap your own unit to select it; with something selected, tap an enemy to
   * attack, tap a building you can enter to garrison it, tap ground to move.
   */
  _issueContext(sx, sy, mod = {}) {
    const w = this.world;
    const p = this.camera.screenToWorld(sx, sy);
    const hit = w.selectableAt(p.x, p.y, 0);
    const units = this.selectedUnits;
    const visible = w.fog.isVisibleWorld(p.x, p.y) || w.fog.isExplored((p.x / TILE) | 0, (p.y / TILE) | 0);

    // Tapping something of ours selects it.
    if (hit && hit.owner === 0) {
      if (units.length && hit.kind === 'building' && hit.hpFrac < 1 &&
          units.some((u) => u.def.abilities?.includes('repair'))) {
        for (const u of units) {
          if (u.def.abilities?.includes('repair')) u.orderRepair(w, hit.id);
        }
        this.renderer.ping(hit.cx, hit.cy, 'attack');
        this.audio.confirm();
        return;
      }
      if (units.length && hit.kind === 'unit' && hit.def.cargoSpace &&
          units.some((u) => u.def.canGarrison && u !== hit)) {
        for (const u of units) if (u.def.canGarrison && u !== hit) u.orderEnter(w, hit.id);
        this.audio.confirm();
        return;
      }
      if (units.length && hit.kind === 'building' && w.canGarrison(units[0], hit)) {
        for (const u of units) if (u.def.canGarrison) u.orderGarrison(w, hit.id);
        this.audio.confirm();
        return;
      }
      this.select([hit], mod.shift);
      return;
    }

    if (!units.length) {
      // Nothing selected: a tap on an enemy or a neutral just inspects it.
      if (hit) this.select([hit], false);
      else if (!mod.shift) this.selection.clear();
      return;
    }

    // Enemy under the finger: attack it.
    if (hit && w.isHostile(units[0], hit) && w.fog.isVisibleWorld(hit.x, hit.y)) {
      for (const u of units) if (u.weapons.length) u.orderAttack(w, hit.id);
      this.renderer.ping(hit.x, hit.y, 'attack');
      this.audio.confirm();
      return;
    }

    // Neutral structure: capture it if we brought an engineer, garrison if not.
    if (hit && hit.kind === 'building' && hit.owner < 0) {
      const eng = units.filter((u) => w.canCapture(u, hit));
      if (eng.length) {
        for (const u of eng) u.orderCapture(w, hit.id);
        this.renderer.ping(hit.cx, hit.cy, 'attackMove');
        this.audio.confirm();
        return;
      }
      const inf = units.filter((u) => w.canGarrison(u, hit));
      if (inf.length) {
        for (const u of inf) u.orderGarrison(w, hit.id);
        this.audio.confirm();
        return;
      }
    }

    // Otherwise: move there.
    if (!visible && !w.grid.inBounds((p.x / TILE) | 0, (p.y / TILE) | 0)) return;
    w.issueMove(units, p.x, p.y, false);
    this.renderer.ping(p.x, p.y, 'move');
    this.audio.confirm();
  }

  _onLongPress(sx, sy) {
    const units = this.selectedUnits.filter((u) => u.weapons.length);
    if (!units.length) return;
    const p = this.camera.screenToWorld(sx, sy);
    this.world.issueMove(units, p.x, p.y, true);
    this.renderer.ping(p.x, p.y, 'attackMove');
    this.audio.confirm();
    this.hud.hint('Attack-move ordered');
  }

  _onDoubleTap(sx, sy) {
    const p = this.camera.screenToWorld(sx, sy);
    const hit = this.world.selectableAt(p.x, p.y, 0);
    if (!hit || hit.owner !== 0 || hit.kind !== 'unit') { this._onTap(sx, sy, {}); return; }
    // Select every unit of that type currently on screen.
    const v = this.camera.viewRect(0);
    const same = this.world.units.filter((u) =>
      u.alive && u.owner === 0 && u.defId === hit.defId && !u.garrisonedIn && !u.transport &&
      u.x > v.x0 && u.x < v.x1 && u.y > v.y0 && u.y < v.y1);
    this.select(same, false);
    this.hud.hint(`${same.length} × ${hit.def.name} selected`);
  }

  _onBox(b, mod) {
    const a = this.camera.screenToWorld(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
    const c = this.camera.screenToWorld(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    const found = this.world.unitsInBox(a.x, a.y, c.x, c.y, 0);
    if (found.length) this.select(found, mod.shift);
    else if (!mod.shift) this.selection.clear();
  }

  // --- command bar ----------------------------------------------------------
  command(id) {
    const w = this.world;
    const units = this.selectedUnits;
    switch (id) {
      case 'stop':
        for (const u of units) u.stop(w);
        for (const b of this.selectedBuildings) b.rally = null;
        this.pendingCommand = null;
        break;
      case 'hold':
        for (const u of units) u.orderHold();
        this.hud.hint('Holding position');
        break;
      case 'unload':
        for (const u of units) if (u.cargo.length) w.unloadAll(u);
        break;
      case 'sell':
        for (const b of this.selectedBuildings) {
          if (w.sellBuilding(b)) this.hud.pushNotice(`${b.def.name} sold`, 'info');
        }
        this.selection.clear();
        break;
      default:
        // Everything else waits for a target tap.
        this.pendingCommand = this.pendingCommand === id ? null : id;
        if (this.pendingCommand) this.hud.hint(`Select a target for ${id}`);
        break;
    }
  }

  _applyPending(sx, sy) {
    const w = this.world;
    const p = this.camera.screenToWorld(sx, sy);
    const hit = w.selectableAt(p.x, p.y, 0);
    const units = this.selectedUnits;
    const cmd = this.pendingCommand;
    this.pendingCommand = null;
    let ok = false;

    if (cmd === 'amove') {
      const shooters = units.filter((u) => u.weapons.length);
      if (shooters.length) {
        w.issueMove(shooters, p.x, p.y, true);
        this.renderer.ping(p.x, p.y, 'attackMove');
        ok = true;
      }
    } else if (cmd === 'attack' && hit) {
      // Force fire: this is how you deliberately level a civilian structure,
      // and the only way to do it. It costs Local Support and it should.
      for (const u of units) if (u.weapons.length) u.orderAttack(w, hit.id);
      this.renderer.ping(hit.x ?? hit.cx, hit.y ?? hit.cy, 'attack');
      if (hit.def.civilian) this.hud.hint('Firing on a civilian structure — Local Support will fall');
      ok = true;
    } else if (cmd === 'garrison' && hit && hit.kind === 'building') {
      for (const u of units) if (w.canGarrison(u, hit)) { u.orderGarrison(w, hit.id); ok = true; }
    } else if (cmd === 'capture' && hit && hit.kind === 'building') {
      for (const u of units) if (w.canCapture(u, hit)) { u.orderCapture(w, hit.id); ok = true; }
    } else if (cmd === 'repair' && hit && hit.kind === 'building' && hit.owner === 0) {
      for (const u of units) if (u.def.abilities?.includes('repair')) { u.orderRepair(w, hit.id); ok = true; }
    }
    if (ok) this.audio.confirm(); else this.audio.deny();
  }

  // --- palette --------------------------------------------------------------
  paletteClick(kind, id) {
    const w = this.world;
    if (kind === 'unit') {
      if (!w.canProduce(0, id)) {
        this.audio.deny();
        const d = defOf(id);
        this.hud.hint(d.requires ? `Requires ${defOf(d.requires[0]).name}`
          : `Requires ${defOf(d.from) ? defOf(d.from).name : 'a production structure'}`);
        return;
      }
      if (w.human.supply < defOf(id).cost) {
        this.audio.deny(); this.hud.flashSupply(); this.hud.hint('Not enough supply');
        return;
      }
      if (w.queueUnit(0, id)) this.audio.uiTap();
      return;
    }
    if (kind === 'building') {
      if (!w.canBuildStructure(0, id)) {
        this.audio.deny();
        const d = defOf(id);
        this.hud.hint(d.requires ? `Requires ${defOf(d.requires[0]).name}` : 'Requires a Command Post');
        return;
      }
      if (w.human.supply < w.structureCost(0, id)) {
        this.audio.deny(); this.hud.flashSupply(); this.hud.hint('Not enough supply');
        return;
      }
      if (this.placing === id) { this.cancelPlacement(); return; }
      this.placing = id;
      this.targeting = null;
      this.renderer.targetingLine = null;
      this.input.setMode('place');
      const c = this.camera;
      this._updateGhost(c.vw / 2, c.vh / 2);
      this.hud.hint('Drag to position, release to build');
      this.audio.uiTap();
      return;
    }
    // Support power.
    if (!w.powerReady(0, id)) { this.audio.deny(); this.hud.hint('Not available yet'); return; }
    if (this.targeting === id) { this.targeting = null; this.renderer.targetingLine = null; return; }
    this.targeting = id;
    this.placing = null;
    this.renderer.placement = null;
    this.input.setMode('target');
    this.hud.hint(id === 'air_strike' ? 'Drag to set the gun run' : 'Tap an area to sweep');
    this.audio.uiTap();
  }

  cancelQueued(id) {
    if (this.world.cancelQueued(0, id)) this.audio.uiTap();
  }

  cancelPlacement() {
    this.placing = null;
    this.renderer.placement = null;
    this.targeting = null;
    this.renderer.targetingLine = null;
    this.strikeLine = null;
    this.input.setMode('command');
  }

  _firePower(p) {
    const w = this.world;
    if (this.targeting === 'recon_sweep') {
      if (w.useReconSweep(0, p.x, p.y)) this.audio.confirm(); else this.audio.deny();
    } else if (this.targeting === 'air_strike') {
      const l = this.strikeLine;
      let x0 = p.x, y0 = p.y, x1 = p.x + 200, y1 = p.y;
      if (l && Math.hypot(l.x1 - l.x0, l.y1 - l.y0) > 40) {
        x0 = l.x0; y0 = l.y0; x1 = l.x1; y1 = l.y1;
      }
      if (w.useAirStrike(0, x0, y0, x1, y1)) this.audio.confirm(); else this.audio.deny();
    }
    this.cancelPlacement();
  }

  // --- keyboard (desktop convenience) --------------------------------------
  _onKey(e) {
    const k = e.key.toLowerCase();
    const map = { a: 'amove', f: 'attack', g: 'garrison', c: 'capture', r: 'repair', u: 'unload', h: 'hold', s: 'stop', k: 'sell' };
    if (k === 'escape') { this.cancelPlacement(); this.pendingCommand = null; this.selection.clear(); return; }
    if (k === ' ') { e.preventDefault(); this.togglePause(); return; }
    if (k === 'tab') { e.preventDefault(); this.renderer.showRanges = !this.renderer.showRanges; return; }
    if (map[k]) { e.preventDefault(); this.command(map[k]); return; }
    if (k >= '0' && k <= '9') {
      if (e.ctrlKey || e.metaKey) this.controlGroups.set(k, new Set(this.selection));
      else {
        const g = this.controlGroups.get(k);
        if (g) {
          this.selection = new Set([...g].filter((id) => this.world.entityById(id)));
          const first = this.world.entityById([...this.selection][0]);
          if (first) this.camera.glideTo(first.x, first.y);
        }
      }
    }
  }

  // --- pause / sound --------------------------------------------------------
  togglePause() {
    this.paused = !this.paused;
    if (this.paused) showPause(this);
    else { $('overlay').classList.remove('show'); this.last = performance.now(); }
  }

  toggleSound() {
    const muted = this.audio.enabled;
    this.audio.setMuted(muted);
    if (!muted && !this.music.playing) this.music.start();
    return muted;
  }

  restart() { window.location.reload(); }
}

export { showBriefing };
