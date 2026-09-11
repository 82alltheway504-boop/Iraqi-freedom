import { UNITS, BUILDINGS, POWERS } from '../sim/defs.js';
import { ARMOR_NAMES, DAMAGE_NAMES, VET_RANKS, roeTier } from '../sim/rules.js';
import { TILE } from '../world/terrain.js';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// What the player can build, in the order it should appear.
const BUILD_ORDER = ['command_post', 'generator', 'supply_depot', 'barracks',
  'motor_pool', 'comm_center', 'mg_nest', 'at_gun', 'barrier'];
const TRAIN_ORDER = ['rifle_squad', 'at_team', 'engineer', 'supply_truck',
  'humvee', 'ifv', 'mbt'];

// The contextual order bar. `when` decides whether a button is offered at all.
const COMMANDS = [
  { id: 'amove',    icon: 'attack',   key: 'A', label: 'Attack-move',
    when: (s) => s.units.some((u) => u.weapons.length) },
  { id: 'attack',   icon: 'move',     key: 'F', label: 'Force fire',
    when: (s) => s.units.some((u) => u.weapons.length) },
  { id: 'garrison', icon: 'garrison', key: 'G', label: 'Garrison building',
    when: (s) => s.units.some((u) => u.def.canGarrison) },
  { id: 'capture',  icon: 'capture',  key: 'C', label: 'Capture structure',
    when: (s) => s.units.some((u) => u.def.abilities?.includes('capture')) },
  { id: 'repair',   icon: 'repair',   key: 'R', label: 'Repair structure',
    when: (s) => s.units.some((u) => u.def.abilities?.includes('repair')) },
  { id: 'unload',   icon: 'unload',   key: 'U', label: 'Unload passengers',
    when: (s) => s.units.some((u) => u.cargo.length) },
  { id: 'hold',     icon: 'hold',     key: 'H', label: 'Hold position',
    when: (s) => s.units.length > 0 },
  { id: 'stop',     icon: 'stop',     key: 'S', label: 'Stop',
    when: (s) => s.units.length > 0 || s.buildings.length > 0 },
  { id: 'sell',     icon: 'sell',     key: 'K', label: 'Sell structure',
    when: (s) => s.buildings.some((b) => !b.def.isHQ && b.owner === 0) },
];

export class Hud {
  constructor(game) {
    this.game = game;
    this.tab = 'units';
    this.cards = new Map();
    this.cmdButtons = new Map();
    this.notices = [];
    this.noticeQueue = [];
    this.lastObjSig = '';
    this.lastPaletteSig = '';
    this.hintTimer = 0;
    // Alert state driving the blinking HUD elements.
    this.alert = { attackUntil: 0, lastPing: 0, attackAnnounced: 0, freshUntil: 0 };
    this._readyPowers = new Set();
    this._lastQueueCount = 0;
    this._build();
  }

  get world() { return this.game.world; }

  _iconCanvas(name, size = 46) {
    const src = this.game.art.icons[name];
    const c = document.createElement('canvas');
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = '100%'; c.style.height = '100%';
    const g = c.getContext('2d');
    if (src) g.drawImage(src.canvas, 0, 0, c.width, c.height);
    return c;
  }

  _build() {
    $('hud').hidden = false;

    // Objectives panel collapses on tap — screen space is scarce on a phone.
    $('objHeader').addEventListener('click', () => {
      $('objectives').classList.toggle('collapsed');
      this.acknowledgeObjectives();
      this.game.audio.uiTap();
    });

    for (const b of $('tabs').querySelectorAll('button')) {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        for (const o of $('tabs').querySelectorAll('button')) o.classList.toggle('on', o === b);
        this.lastPaletteSig = '';
        this.game.cancelPlacement();
        this.game.audio.uiTap();
      });
    }

    $('btnMenu').addEventListener('click', () => this.game.togglePause());
    $('btnSound').addEventListener('click', () => {
      const muted = this.game.toggleSound();
      $('btnSound').classList.toggle('off', muted);
    });

    // Command bar.
    const bar = $('cmdbar');
    for (const c of COMMANDS) {
      const b = el('button', 'cmd');
      b.appendChild(this._iconCanvas(c.icon));
      b.title = `${c.label} (${c.key})`;
      b.setAttribute('aria-label', c.label);
      const kb = el('span', 'kb', c.key);
      b.appendChild(kb);
      b.addEventListener('click', () => { this.game.command(c.id); this.game.audio.uiTap(); });
      b.hidden = true;
      bar.appendChild(b);
      this.cmdButtons.set(c.id, b);
    }

    // Minimap navigation.
    const mm = $('minimap');
    const nav = (e) => {
      const p = e.touches ? e.touches[0] : e;
      const w = this.game.minimap.toWorld(p.clientX, p.clientY);
      this.game.camera.centerOn(w.x, w.y);
    };
    mm.addEventListener('pointerdown', (e) => {
      e.preventDefault(); mm.setPointerCapture(e.pointerId); this._mmDrag = true; nav(e);
    });
    mm.addEventListener('pointermove', (e) => { if (this._mmDrag) { e.preventDefault(); nav(e); } });
    mm.addEventListener('pointerup', () => { this._mmDrag = false; });
    mm.addEventListener('pointercancel', () => { this._mmDrag = false; });
  }

  // --- palette --------------------------------------------------------------
  _paletteItems() {
    const w = this.world;
    const me = w.humanIndex;
    if (this.tab === 'units') {
      return TRAIN_ORDER.filter((id) => UNITS[id]).map((id) => {
        const d = UNITS[id];
        const can = w.canProduce(me, id);
        const queued = w.buildings.reduce((n, b) =>
          n + (b.owner === me ? b.queue.filter((j) => j.defId === id).length : 0), 0);
        const job = w.buildings.flatMap((b) => (b.owner === me ? b.queue : []))
          .find((j) => j.defId === id);
        return {
          key: `u:${id}`, id, icon: id, cost: d.cost, name: d.name,
          enabled: can && w.human.supply >= d.cost,
          dim: !can, queued, progress: job ? job.progress : 0, kind: 'unit',
        };
      });
    }
    if (this.tab === 'build') {
      return BUILD_ORDER.filter((id) => BUILDINGS[id]).map((id) => {
        const d = BUILDINGS[id];
        const cost = w.structureCost(me, id);
        const can = w.canBuildStructure(me, id);
        return {
          key: `b:${id}`, id, icon: id, cost, name: d.name,
          enabled: can && w.human.supply >= cost,
          dim: !can, queued: 0, progress: 0, kind: 'building',
          selected: this.game.placing === id,
        };
      });
    }
    return Object.values(POWERS).map((p) => {
      const unlocked = w.human.unlocked.has(p.id);
      const ready = w.powerReady(me, p.id);
      const frac = unlocked ? w.powerCooldownFrac(me, p.id) : 0;
      const end = w.human.powerCooldowns[p.id] || 0;
      return {
        key: `p:${p.id}`, id: p.id, icon: p.icon, cost: null, name: p.name,
        enabled: unlocked && ready, dim: !unlocked, queued: 0, progress: 0,
        kind: 'power', cooldown: ready ? 0 : Math.max(0, end - w.time), frac,
        selected: this.game.targeting === p.id,
      };
    });
  }

  _syncPalette() {
    const items = this._paletteItems();
    const sig = items.map((i) =>
      `${i.key}|${i.enabled}|${i.dim}|${i.queued}|${i.progress.toFixed(2)}|${i.selected}|${(i.cooldown || 0) | 0}|${i.cost}`
    ).join(',') + '|' + this.tab;
    if (sig === this.lastPaletteSig) return;
    this.lastPaletteSig = sig;

    const pal = $('palette');
    // Rebuild only when the set of cards changes; otherwise patch in place.
    const keys = items.map((i) => i.key).join(',');
    if (this._cardKeys !== keys) {
      this._cardKeys = keys;
      pal.textContent = '';
      this.cards.clear();
      for (const it of items) {
        const card = el('button', 'card tappable');
        card.appendChild(this._iconCanvas(it.icon, 60));
        const cost = el('div', 'cost');
        card.appendChild(cost);
        const qty = el('div', 'qty'); qty.hidden = true; card.appendChild(qty);
        const prog = el('div', 'prog'); card.appendChild(prog);
        const cd = el('div', 'cd'); cd.hidden = true; card.appendChild(cd);
        card.title = it.name;
        card.addEventListener('click', () => this.game.paletteClick(it.kind, it.id));
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (it.kind === 'unit') this.game.cancelQueued(it.id);
        });
        pal.appendChild(card);
        this.cards.set(it.key, { card, cost, qty, prog, cd });
      }
    }
    for (const it of items) {
      const c = this.cards.get(it.key);
      if (!c) continue;
      c.card.classList.toggle('disabled', !it.enabled);
      c.card.classList.toggle('selected', !!it.selected);
      c.cost.textContent = it.cost == null ? it.name.split(' ')[0].toUpperCase()
        : it.cost === 0 ? 'FREE' : it.cost;
      c.qty.hidden = it.queued <= 1;
      c.qty.textContent = it.queued;
      c.prog.style.width = `${(it.progress || 0) * 100}%`;
      const cooling = (it.cooldown || 0) > 0;
      c.cd.hidden = !cooling;
      if (cooling) c.cd.textContent = Math.ceil(it.cooldown);
      // A support power that has just become available pulses until used.
      c.card.classList.toggle('ready',
        it.kind === 'power' && it.enabled && !it.selected);
    }
  }

  // --- objectives -----------------------------------------------------------
  _syncObjectives(mission) {
    const list = mission.objectives.filter((o) => o.state !== 'hidden');
    const sig = list.map((o) => `${o.id}${o.state}${o.progress || ''}`).join('|');
    if (sig === this.lastObjSig) return;
    this.lastObjSig = sig;
    const ul = $('objList');
    ul.textContent = '';
    const now = this.game.mission.time;
    for (const o of list) {
      const fresh = o.state === 'done' && now - (o.doneAt ?? -99) < 3;
      const urgent = o.state === 'active' && o.id === 'hold' &&
        (this.game.mission.nextWaveIn?.() ?? 99) < 15;
      const li = el('li',
        `${o.state}${o.optional ? ' opt' : ''}${fresh ? ' justdone' : ''}${urgent ? ' urgent' : ''}`);
      li.appendChild(el('span', 'mk',
        o.state === 'done' ? '✓' : o.state === 'failed' ? '✕' : '▸'));
      const tx = el('span', 'tx', o.text);
      li.appendChild(tx);
      if (o.progress && o.state === 'active') li.appendChild(el('span', 'pg', o.progress));
      ul.appendChild(li);
    }
    const done = list.filter((o) => o.state === 'done' && !o.optional).length;
    const total = mission.objectives.filter((o) => !o.optional).length;
    $('objCount').textContent = `${done}/${total}`;
  }

  // --- selection ------------------------------------------------------------
  _syncSelection(sel) {
    const w = this.world;
    const ents = [...sel].map((id) => w.entityById(id)).filter(Boolean);
    const units = ents.filter((e) => e.kind === 'unit');
    const buildings = ents.filter((e) => e.kind === 'building');
    const box = $('selection');

    for (const [id, btn] of this.cmdButtons) {
      const c = COMMANDS.find((x) => x.id === id);
      const show = ents.length > 0 && c.when({ units, buildings });
      btn.hidden = !show;
      btn.classList.toggle('on', this.game.pendingCommand === id);
    }

    if (!ents.length) { box.textContent = ''; return; }
    box.textContent = '';

    if (ents.length === 1) {
      const e = ents[0];
      const d = e.def;
      const nm = el('div', 'nm');
      nm.appendChild(document.createTextNode(d.name));
      if (e.kind === 'unit' && e.rank > 0) {
        nm.appendChild(el('span', 'rank', VET_RANKS[e.rank].name.toUpperCase()));
      }
      box.appendChild(nm);
      box.appendChild(el('div', 'sub', d.desc || ''));
      const bars = el('div', 'bars');
      bars.appendChild(el('span', 'chip', `${Math.round(e.hp)}/${e.maxHp} HP`));
      bars.appendChild(el('span', 'chip', ARMOR_NAMES[d.armor]));
      const weapons = e.kind === 'unit' ? e.weapons : (d.weapon ? [d.weapon] : []);
      for (const wp of weapons) {
        bars.appendChild(el('span', 'chip hot',
          `${DAMAGE_NAMES[wp.type]} ${Math.round(wp.damage * (wp.shots || 1) / wp.cooldown)}/s`));
      }
      if (e.kind === 'unit' && e.def.carry) {
        bars.appendChild(el('span', 'chip', `Carrying ${Math.round(e.carrying)}/${e.def.carry}`));
      }
      if (e.kind === 'unit' && e.def.cargoSpace) {
        bars.appendChild(el('span', 'chip', `Cargo ${e.cargo.length}/${e.def.cargoSpace}`));
      }
      if (e.kind === 'building' && d.power) {
        bars.appendChild(el('span', 'chip', `${d.power > 0 ? '+' : ''}${d.power} power`));
      }
      if (e.kind === 'building' && e.garrisonSlots) {
        bars.appendChild(el('span', 'chip', `Garrison ${e.garrison.length}/${e.garrisonSlots}`));
      }
      box.appendChild(bars);
    } else {
      const counts = {};
      for (const e of ents) counts[e.def.name] = (counts[e.def.name] || 0) + 1;
      box.appendChild(el('div', 'nm', `${ents.length} units selected`));
      const bars = el('div', 'bars');
      for (const [name, n] of Object.entries(counts).slice(0, 6)) {
        bars.appendChild(el('span', 'chip', `${n} × ${name}`));
      }
      box.appendChild(bars);
    }
  }

  // --- notices --------------------------------------------------------------
  /**
   * Radio traffic is shown one line at a time from a queue. Stacking four of
   * them covered the middle of a phone screen, which is exactly where the
   * player is trying to look.
   */
  pushNotice(text, kind = 'info') {
    this.noticeQueue.push({ text, kind });
    // Urgent traffic jumps the queue and clears what is on screen.
    if (kind === 'bad' && this.notices.length) this._clearNotices();
    if (this.noticeQueue.length > 6) this.noticeQueue.splice(0, this.noticeQueue.length - 6);
    this._pumpNotices();
  }

  _clearNotices() {
    for (const n of this.notices) n.node.remove();
    this.notices.length = 0;
  }

  _pumpNotices() {
    if (this.notices.length || !this.noticeQueue.length) return;
    const { text, kind } = this.noticeQueue.shift();
    const n = el('div', `notice ${kind}`, text);
    $('notices').appendChild(n);
    // Long radio calls stay up a little longer so they can be read.
    const life = 2.6 + Math.min(3.4, text.length / 34);
    this.notices.push({ node: n, life });
  }

  /** A new objective blinks the panel until the player looks at it. */
  flagNewObjective() { this.alert.freshUntil = performance.now() / 1000 + 12; }
  acknowledgeObjectives() {
    this.alert.freshUntil = 0;
    $('objectives').classList.remove('fresh');
  }

  /** Restart the "not enough supply" flash on the resource read-out. */
  flashSupply() {
    const n = $('statSupply');
    n.classList.remove('short');
    void n.offsetWidth;            // force the animation to restart
    n.classList.add('short');
    setTimeout(() => n.classList.remove('short'), 1600);
  }

  /** Something of ours is being shot at — blink the minimap and ping it. */
  reportAttack(x, y, now) {
    this.alert.attackUntil = now + 4;
    if (now - this.alert.lastPing < 1.1) return;
    this.alert.lastPing = now;
    const wrap = $('minimapWrap');
    const ping = el('div', 'ping');
    ping.style.left = `${(x / (this.world.grid.w * TILE)) * 100}%`;
    ping.style.top = `${(y / (this.world.grid.h * TILE)) * 100}%`;
    wrap.appendChild(ping);
    setTimeout(() => ping.remove(), 1200);
    if (now - this.alert.attackAnnounced > 12) {
      this.alert.attackAnnounced = now;
      this.game.audio.alert();
      this.pushNotice('Base under attack.', 'bad');
    }
  }

  hint(text, seconds = 2.4) {
    const h = $('hint');
    h.textContent = text;
    h.classList.add('show');
    this.hintTimer = seconds;
  }

  /** Look for friendly entities that have been hit in the last two seconds. */
  _scanForAttacks(now) {
    const w = this.world;
    const me = w.humanIndex;
    const recent = w.time - 2;
    let hit = null;
    for (const b of w.buildings) {
      if (b.owner === me && b.alive && b.lastHitAt > recent) { hit = b; break; }
    }
    if (!hit) {
      for (const u of w.units) {
        if (u.owner === me && u.alive && u.lastHitAt > recent) { hit = u; break; }
      }
    }
    if (hit) this.reportAttack(hit.x, hit.y, now);
  }

  // --- per-frame ------------------------------------------------------------
  sync(dt, mission, sel) {
    const w = this.world;
    const p = w.human;

    $('supplyVal').textContent = Math.floor(p.supply).toLocaleString();
    const bal = p.powerBalance;
    $('powerVal').textContent = `${p.powerGen}/${p.powerUse}`;
    $('statPower').classList.toggle('low', bal < 0);

    const tier = roeTier(p.support);
    const fill = $('supportFill');
    fill.style.width = `${p.support}%`;
    fill.style.background = p.support >= 80 ? 'var(--good)'
      : p.support >= 50 ? 'var(--warn)' : 'var(--bad)';
    $('supportVal').textContent = `${Math.round(p.support)}%`;
    $('statSupport').title = `Local Support — ${tier.name}: ${tier.blurb}`;

    $('clockVal').textContent = mmss(mission.time);

    // --- blinking alerts -------------------------------------------------
    const now = performance.now() / 1000;
    // Local Support in the danger band.
    $('statSupport').classList.toggle('critical', p.support < 50);
    // A counterattack about to land turns the clock into a warning.
    const due = mission.nextWaveIn ? mission.nextWaveIn() : null;
    $('statClock').classList.toggle('warn', due != null && due < 15);
    // Anything of ours taking fire pings the minimap.
    this._scanForAttacks(now);
    $('minimapWrap').classList.toggle('attack', now < this.alert.attackUntil);
    // A new objective keeps the panel lit until it is acknowledged.
    $('objectives').classList.toggle('fresh', now < this.alert.freshUntil);

    this._syncObjectives(mission);
    this._syncPalette();
    this._syncSelection(sel);

    for (let i = this.notices.length - 1; i >= 0; i--) {
      const n = this.notices[i];
      n.life -= dt;
      if (n.life < 0.6) n.node.classList.add('fade');
      if (n.life <= 0) { n.node.remove(); this.notices.splice(i, 1); }
    }
    this._pumpNotices();
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) $('hint').classList.remove('show');
    }
  }
}

export { $, el, mmss };
