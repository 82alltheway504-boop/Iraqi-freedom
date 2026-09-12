import { createMission01, MAP01 } from './missions/m01.js';
import { Commander } from './sim/commander.js';
import { Camera } from './core/camera.js';
import { Input } from './core/input.js';
import { Renderer } from './render/renderer.js';
import { Minimap } from './ui/minimap.js';
import { Hud, $ } from './ui/hud.js';
import { Audio } from './audio/audio.js';
import { Music } from './audio/music.js';
import { buildArt } from './art/sprites.js';
import { TILE } from './world/terrain.js';
import { defOf } from './sim/defs.js';
import { Category, RESOURCE_INFO } from './sim/rules.js';
import { clamp } from './core/math.js';
import { showBriefing, showPause, showResults, showCommander } from './ui/overlays.js';

export class Game {
  constructor() {
    this.commander = Commander.restore();
    const built = createMission01(this.commander);
    this.world = built.world;
    this.turns = built.turns;
    this.ai = built.ai;
    this.mission = built.mission;

    this.art = buildArt();
    this.canvas = $('view');
    this.camera = new Camera(this.world.grid.pixelWidth, this.world.grid.pixelHeight);
    this.renderer = new Renderer(this.canvas, this.world, this.art);
    this.audio = new Audio();
    this.music = new Music(this.audio);

    this.selection = new Set();
    this.placing = null;
    this.fortifyMode = false;
    this.pendingCommand = null;
    this.busy = false;               // true while the Guard is moving
    this.paused = false;
    this.running = false;
    this.last = 0;

    this.hud = new Hud(this);
    this.minimap = new Minimap($('minimap'), this.world, this.camera);
    this.input = new Input(this.canvas, this._handlers());

    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.running && !this.paused) this.togglePause();
    });

    const s = MAP01.playerStart;
    this.camera.centerOn(s.tx * TILE, s.ty * TILE);
    this.camera.zoom = window.innerWidth < 640 ? 0.62 : 0.8;
    this._minimapTimer = 0;
    this._fpsAccum = 0; this._fpsFrames = 0; this._lastFps = 0; this._slowSamples = 0;
  }

  // --- lifecycle ------------------------------------------------------------
  async begin() {
    await this.audio.unlock();
    this.music.start();
    this.running = true;
    this.last = performance.now();
    this.turns.begin();
    this.mission.onTurnStart();
    this.hud.announceTurn('YOUR TURN', true);
    this.hud.pushNotice(this.mission.openingCall, 'bad');
    this.hud.hint('Tap a unit, then tap a lit tile to move', 5);
    requestAnimationFrame((t) => this._frame(t));
  }

  _resize() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    this.camera.resize(window.innerWidth, window.innerHeight);
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
    this.minimap.resize();
  }

  _frame(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this._frame(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.4) dt = 1 / 60;

    this._fpsAccum += dt; this._fpsFrames++;
    if (this._fpsAccum >= 1) {
      this._lastFps = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsAccum = 0; this._fpsFrames = 0;
      this._adaptQuality(this._lastFps);
    }

    if (!this.paused) {
      this.world.tick(dt);
      this._drainEvents();
      this._pruneSelection();
    }

    this.camera.update(dt, this.world.fx.shake);
    this.renderer.updateMarkers(dt);
    this.audio.setListener(this.camera.x, this.camera.y, this.camera.zoom);
    this.audio.update(dt);
    this.music.setHeat(clamp(this.audio.combatHeat, 0, 1));

    this.renderer.draw(this.camera, this.selection, this.world.time);
    this._drawSelectionBox();

    this._minimapTimer -= dt;
    if (this._minimapTimer <= 0) { this._minimapTimer = 0.12; this.minimap.draw(); }
    this.hud.sync(dt, this.mission, this.selection);

    if (this.mission.result && !this._resultShown) {
      this._resultShown = true;
      this.commander.persist();
      setTimeout(() => showResults(this, this.mission.summary()), 1300);
    }
  }

  _adaptQuality(fps) {
    const fx = this.world.fx;
    if (fps > 0 && fps < 42) {
      if (++this._slowSamples >= 2 && fx.quality > 0.4) {
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

  _drawSelectionBox() {
    const b = this.input.box;
    if (!b || b.pending) return;
    const g = this.renderer.g;
    g.save();
    g.scale(this.renderer.dpr, this.renderer.dpr);
    const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
    const w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
    g.fillStyle = 'rgba(227,194,106,0.12)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(227,194,106,0.9)';
    g.lineWidth = 1.5; g.setLineDash([6, 4]);
    g.strokeRect(x + 0.5, y + 0.5, w, h);
    g.setLineDash([]);
    g.restore();
  }

  _pruneSelection() {
    for (const id of [...this.selection]) if (!this.world.entityById(id)) this.selection.delete(id);
    if (!this.selection.size) this._clearOverlays();
  }

  // --- turn flow ------------------------------------------------------------
  endTurn() {
    if (this.busy || !this.turns.isPlayerTurn) return;
    this.selection.clear();
    this._clearOverlays();
    this.busy = true;
    this.audio.confirm();
    this.turns.endTurn();                       // -> Guard
    this.hud.announceTurn('GUARD TURN', false);

    // Let the banner land before the Guard moves, so the player can follow it.
    setTimeout(() => {
      const report = this.ai.takeTurn();
      this._drainEvents();
      // Show the player where it happened rather than leaving them to hunt.
      const focus = this.world.units.find((u) => u.owner === 1 && u.alive &&
        this.world.fog.isVisibleWorld(u.x, u.y));
      if (focus) this.camera.glideTo(focus.x, focus.y);
      setTimeout(() => {
        this.turns.endTurn();                   // -> player
        this.mission.onTurnStart();
        this._drainEvents();
        this.busy = false;
        this.hud.announceTurn('YOUR TURN', true);
        this.audio.objective();
      }, 1100);
    }, 700);
  }

  // --- events ---------------------------------------------------------------
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
          this.audio.combatHeat = Math.min(1, this.audio.combatHeat + 0.05);
          break;
        }
        case 'explosion': this.audio.explosion(ev.x, ev.y, ev.big); break;
        case 'impact': case 'infantryDown': this.audio.impact(ev.x, ev.y); break;
        case 'promote': if (ev.owner === 0) this.audio.promote(); break;
        case 'capture': if (ev.owner === 0) this.audio.confirm(); break;
        case 'resupply': if (ev.owner === 0) this.audio.confirm(); break;
        case 'paradrop': this.audio.objective(); break;
        case 'unitReady':
          if (ev.owner === 0) {
            this.audio.unitReady();
            this.hud.pushNotice(`${defOf(ev.defId).name} ready`, 'good');
          }
          break;
        case 'buildComplete':
          if (ev.owner === 0) {
            this.audio.buildDone();
            this.hud.pushNotice(`${defOf(ev.defId).name} complete`, 'good');
          }
          break;
        case 'commanderPromotion':
          this.audio.victory();
          this.hud.pushNotice(`Promoted to ${ev.rank}. A skill point is available.`, 'good');
          break;
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
      else if (e.type === 'victory') this.audio.victory();
      else if (e.type === 'defeat') this.audio.defeat();
    }
    this.mission.events.length = 0;
  }

  // --- selection and overlays ----------------------------------------------
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
    this._refreshOverlays();
  }

  _clearOverlays() {
    this.renderer.moveOverlay = null;
    this.renderer.targetOverlay = null;
  }

  /** Recompute where the selection can go and what it can shoot. */
  _refreshOverlays() {
    const units = this.selectedUnits.filter((u) => u.owner === 0);
    if (units.length !== 1 || !this.turns.isPlayerTurn) { this._clearOverlays(); return; }
    const u = units[0];
    if (!u.canAct) { this._clearOverlays(); return; }
    const map = this.world.reachable(u);
    for (const node of map.values()) node.max = u.ap;
    this.renderer.moveOverlay = map;
    this.renderer.targetOverlay = new Set(this.world.attackableTargets(u).map((t) => t.id));
  }

  // --- input ----------------------------------------------------------------
  _handlers() {
    return {
      onPan: (dx, dy) => { if (!this.placing) this.camera.panBy(dx, dy); },
      onFlick: (vx, vy) => { if (!this.placing) this.camera.flick(vx, vy); },
      onZoom: (f, x, y) => this.camera.zoomAt(f, x, y),
      onDown: (x, y) => { if (this.placing) this._updateGhost(x, y); },
      onHover: (x, y) => { if (this.placing) this._updateGhost(x, y); },
      onDrag: (x, y) => { if (this.placing) this._updateGhost(x, y); },
      onTap: (x, y, mod) => this._onTap(x, y, mod),
      onDoubleTap: (x, y) => this._onTap(x, y, {}),
      onLongPress: (x, y) => this._onLongPress(x, y),
      onBoxSelect: (b, mod) => this._onBox(b, mod),
      onCommand: (x, y, mod) => this._onTap(x, y, mod),
      onKey: (e) => this._onKey(e),
    };
  }

  _updateGhost(sx, sy) {
    const p = this.camera.screenToWorld(sx, sy);
    const d = defOf(this.placing);
    const tx = Math.round(p.x / TILE - d.size[0] / 2);
    const ty = Math.round(p.y / TILE - d.size[1] / 2);
    const eng = this.fortifyMode
      ? this.selectedUnits.find((u) => u.def.abilities?.includes('fortify')) : null;
    const check = this.world.canPlace(0, this.placing, tx, ty, { ignoreRadius: this.fortifyMode });
    const near = !this.fortifyMode || (eng &&
      Math.hypot(eng.x - (tx + d.size[0] / 2) * TILE, eng.y - (ty + d.size[1] / 2) * TILE) <= TILE * 3);
    this.renderer.placement = {
      defId: this.placing, tx, ty,
      ok: check.ok && this.world.canAfford(0, this.placing) && !!near,
      reason: !near ? 'too far from the engineer' : check.reason,
    };
  }

  _onTap(sx, sy, mod = {}) {
    if (this.busy || !this.turns.isPlayerTurn) { this.hud.hint('The Guard is moving'); return; }

    if (this.placing) { this._commitPlacement(sx, sy); return; }

    const p = this.camera.screenToWorld(sx, sy);
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    const hit = this.world.selectableAt(p.x, p.y);

    if (this.pendingCommand) { this._applyPending(hit, tx, ty); return; }

    // Something of ours: select it.
    if (hit && hit.owner === 0) { this.select([hit], mod.shift); return; }

    const units = this.selectedUnits.filter((u) => u.owner === 0);
    if (units.length === 1) {
      const u = units[0];
      // A legal target under the finger: shoot it.
      if (hit && this.renderer.targetOverlay?.has(hit.id)) {
        const r = this.world.attack(u, hit);
        if (r.ok) {
          this.renderer.ping(hit.cx ?? hit.x, hit.cy ?? hit.y, 'attack');
          this.audio.confirm();
        } else { this.audio.deny(); this.hud.hint(r.reason); }
        this._refreshOverlays();
        return;
      }
      // A lit tile: move there.
      const idx = ty * this.world.grid.w + tx;
      if (this.renderer.moveOverlay?.has(idx)) {
        const r = this.world.moveUnit(u, tx, ty);
        if (r.ok) {
          this.renderer.ping(p.x, p.y, 'move');
          this.audio.confirm();
          this._clearOverlays();
          setTimeout(() => this._refreshOverlays(), 120);
        } else { this.audio.deny(); this.hud.hint(r.reason); }
        return;
      }
      if (hit) { this.select([hit], false); return; }
      this.hud.hint('Out of range this turn');
      return;
    }

    if (hit) this.select([hit], mod.shift);
    else if (!mod.shift) { this.selection.clear(); this._clearOverlays(); }
  }

  _onLongPress(sx, sy) {
    const p = this.camera.screenToWorld(sx, sy);
    const hit = this.world.selectableAt(p.x, p.y);
    if (hit) {
      this.select([hit], false);
      this.hud.hint(hit.def.name);
    }
  }

  _onBox(b, mod) {
    const a = this.camera.screenToWorld(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
    const c = this.camera.screenToWorld(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    const found = this.world.units.filter((u) =>
      u.alive && u.owner === 0 && !u.garrisonedIn && !u.transport &&
      u.x >= a.x && u.x <= c.x && u.y >= a.y && u.y <= c.y);
    if (found.length) this.select(found, mod.shift);
    else if (!mod.shift) { this.selection.clear(); this._clearOverlays(); }
  }

  // --- commands -------------------------------------------------------------
  command(id) {
    const units = this.selectedUnits;
    const w = this.world;
    switch (id) {
      case 'done':
        for (const u of units) u.spendAp(u.ap);
        this._clearOverlays();
        this.hud.hint('Unit stood down');
        break;
      case 'dig':
        for (const u of units) { u.spendAp(u.ap); u.heldPosition = true; }
        this._clearOverlays();
        this.hud.hint('Holding position — they will dig in');
        break;
      case 'unload': {
        const t = units.find((u) => u.cargo.length);
        if (!t) break;
        const r = w.unloadAt(t, Math.floor(t.x / TILE), Math.floor(t.y / TILE) + 1);
        if (r.ok) this.audio.confirm(); else { this.audio.deny(); this.hud.hint(r.reason); }
        this._refreshOverlays();
        break;
      }
      case 'fortify':
        this.fortifyMode = true;
        this.hud.tab = 'structure';
        for (const b of $('tabs').querySelectorAll('button')) {
          b.classList.toggle('on', b.dataset.tab === 'structure');
        }
        this.hud.lastPaletteSig = '';
        this.hud.hint('Pick a work to dig, then place it beside the engineer');
        break;
      case 'sell':
        for (const b of this.selectedBuildings) if (w.sellBuilding(b)) this.audio.confirm();
        this.selection.clear();
        break;
      default:
        this.pendingCommand = this.pendingCommand === id ? null : id;
        if (this.pendingCommand) this.hud.hint(`Choose a target`);
        break;
    }
  }

  _applyPending(hit, tx, ty) {
    const w = this.world;
    const units = this.selectedUnits;
    const cmd = this.pendingCommand;
    this.pendingCommand = null;
    let res = { ok: false, reason: 'nothing to do' };

    for (const u of units) {
      if (cmd === 'attack' && hit) res = w.attack(u, hit);
      else if (cmd === 'capture' && hit) res = w.capture(u, hit);
      else if (cmd === 'garrison' && hit) res = w.garrisonInto(u, hit);
      else if (cmd === 'load' && hit) res = w.loadInto(hit, u);
      else if (cmd === 'resupply' && hit) res = w.resupply(u, hit);
      else if (cmd === 'paradrop') res = w.paradrop(u, tx, ty);
      if (res.ok) break;
    }
    if (res.ok) { this.audio.confirm(); this._refreshOverlays(); }
    else { this.audio.deny(); this.hud.hint(res.reason); }
  }

  // --- palette --------------------------------------------------------------
  paletteClick(kind, id) {
    const w = this.world;
    const d = defOf(id);
    if (kind === 'unit') {
      const r = w.queueUnit(0, id);
      if (r.ok) { this.audio.uiTap(); this.hud.hint(`${d.name} — ${r.turns} turn(s)`); }
      else {
        this.audio.deny();
        this.hud.hint(r.reason);
        if (r.reason?.startsWith('not enough')) this.hud.flashResource(d.res);
      }
      return;
    }
    if (this.placing === id) { this.cancelPlacement(); return; }
    if (!w.canAfford(0, id)) {
      this.audio.deny(); this.hud.flashResource(d.res);
      this.hud.hint(`Not enough ${RESOURCE_INFO[d.res].name.toLowerCase()}`);
      return;
    }
    this.placing = id;
    this.input.setMode('place');
    this._updateGhost(this.camera.vw / 2, this.camera.vh / 2);
    this.hud.hint(this.fortifyMode ? 'Place it beside the engineer' : 'Drag to position, release to build');
    this.audio.uiTap();
  }

  _commitPlacement(sx, sy) {
    this._updateGhost(sx, sy);
    const g = this.renderer.placement;
    const w = this.world;
    let r;
    if (this.fortifyMode) {
      const eng = this.selectedUnits.find((u) => u.def.abilities?.includes('fortify'));
      r = eng ? w.fortify(eng, this.placing, g.tx, g.ty) : { ok: false, reason: 'no engineer selected' };
    } else {
      r = w.startStructure(0, this.placing, g.tx, g.ty);
    }
    if (r.ok) {
      this.audio.confirm();
      this.hud.pushNotice(`${defOf(this.placing).name} under construction`, 'good');
      this.cancelPlacement();
      this._refreshOverlays();
    } else {
      this.audio.deny();
      this.hud.hint(r.reason);
    }
  }

  cancelQueued(id) { if (this.world.cancelQueued(0, id)) this.audio.uiTap(); }

  cancelPlacement() {
    this.placing = null;
    this.fortifyMode = false;
    this.renderer.placement = null;
    this.input.setMode('command');
  }

  // --- keyboard -------------------------------------------------------------
  _onKey(e) {
    const k = e.key.toLowerCase();
    const map = { a: 'attack', c: 'capture', f: 'fortify', g: 'garrison',
      l: 'load', u: 'unload', r: 'resupply', p: 'paradrop', h: 'dig', s: 'done', k: 'sell' };
    if (k === 'escape') { this.cancelPlacement(); this.pendingCommand = null; this.selection.clear(); this._clearOverlays(); return; }
    if (k === 'enter') { e.preventDefault(); this.endTurn(); return; }
    if (k === ' ') { e.preventDefault(); this._selectNextIdle(); return; }
    if (k === 'tab') { e.preventDefault(); this.renderer.showRanges = !this.renderer.showRanges; return; }
    if (map[k]) { e.preventDefault(); this.command(map[k]); }
  }

  /** Cycle to the next unit that still has points — the turn-based workhorse. */
  _selectNextIdle() {
    const ready = this.world.unitsOf(0).filter((u) => u.canAct && !u.garrisonedIn);
    if (!ready.length) { this.hud.hint('Every unit has acted'); return; }
    const cur = [...this.selection][0];
    const i = ready.findIndex((u) => u.id === cur);
    const next = ready[(i + 1) % ready.length];
    this.select([next], false);
    this.camera.glideTo(next.x, next.y);
  }

  // --- overlays -------------------------------------------------------------
  showCommander() { this.paused = true; showCommander(this); }
  closeOverlay() {
    $('overlay').classList.remove('show');
    $('overlay').innerHTML = '';
    this.paused = false;
    this.last = performance.now();
    this.commander.persist();
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) showPause(this);
    else this.closeOverlay();
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
