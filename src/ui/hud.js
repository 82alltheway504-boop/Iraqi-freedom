import { UNITS, BUILDINGS, ROSTER, defOf, weaponsOf } from '../sim/defs.js';
import {
  ARMOR_NAMES, DAMAGE_NAMES, VET_RANKS, Category, CATEGORY_INFO,
  Res, RESOURCE_INFO, UPKEEP_RESOURCE,
} from '../sim/rules.js';
import { roeTier } from '../sim/world.js';
import { TILE } from '../world/terrain.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// The contextual order bar. `when` decides whether a button is offered at all.
const COMMANDS = [
  { id: 'attack', icon: 'attack', key: 'A', label: 'Attack',
    when: (s, g) => s.units.some((u) => u.weapons.length && u.canAct) },
  { id: 'capture', icon: 'capture', key: 'C', label: 'Capture',
    when: (s) => s.units.some((u) => u.def.abilities?.includes('capture')) },
  { id: 'fortify', icon: 'repair', key: 'F', label: 'Dig works',
    when: (s) => s.units.some((u) => u.def.abilities?.includes('fortify')) },
  { id: 'garrison', icon: 'garrison', key: 'G', label: 'Garrison',
    when: (s) => s.units.some((u) => u.def.canGarrison) },
  { id: 'load', icon: 'unload', key: 'L', label: 'Board transport',
    when: (s) => s.units.some((u) => u.def.liftable || u.def.canGarrison) },
  { id: 'unload', icon: 'unload', key: 'U', label: 'Unload',
    when: (s) => s.units.some((u) => u.cargo.length) },
  { id: 'resupply', icon: 'repair', key: 'R', label: 'Resupply',
    when: (s) => s.units.some((u) => u.def.resupply) },
  { id: 'paradrop', icon: 'air', key: 'P', label: 'Paradrop',
    when: (s) => s.units.some((u) => u.def.paradrop && !u.hasParadropped) },
  { id: 'dig', icon: 'hold', key: 'H', label: 'Dig in / hold',
    when: (s) => s.units.some((u) => u.def.entrenches && u.canAct) },
  { id: 'done', icon: 'stop', key: 'S', label: 'Done with this unit',
    when: (s) => s.units.some((u) => u.canAct) },
  { id: 'sell', icon: 'sell', key: 'K', label: 'Demolish',
    when: (s) => s.buildings.some((b) => !b.def.isHQ && b.owner === 0) },
];

export class Hud {
  constructor(game) {
    this.game = game;
    this.tab = 'infantry';
    this.cards = new Map();
    this.cmdButtons = new Map();
    this.notices = [];
    this.noticeQueue = [];
    this.lastObjSig = '';
    this.lastPaletteSig = '';
    this.hintTimer = 0;
    this.alert = { attackUntil: 0, lastPing: 0, attackAnnounced: 0, freshUntil: 0 };
    this._build();
  }

  get world() { return this.game.world; }
  get turns() { return this.game.turns; }

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
    // The objectives panel swallows taps on the ground beneath it, so on any
    // phone-sized screen it starts folded to one line. The list is a tap away
    // on its header, and also sits on the pause sheet.
    if (window.innerWidth < 900 || window.innerHeight < 520) {
      $('objectives').classList.add('collapsed');
    }

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
      $('btnSound').classList.toggle('off', this.game.toggleSound());
    });
    $('btnCommander').addEventListener('click', () => this.game.showCommander());
    $('btnEndTurn').addEventListener('click', () => this.game.endTurn());

    const bar = $('cmdbar');
    for (const c of COMMANDS) {
      const b = el('button', 'cmd');
      b.appendChild(this._iconCanvas(c.icon));
      b.title = `${c.label} (${c.key})`;
      b.setAttribute('aria-label', c.label);
      b.appendChild(el('span', 'kb', c.key));
      b.addEventListener('click', () => { this.game.command(c.id); this.game.audio.uiTap(); });
      b.hidden = true;
      bar.appendChild(b);
      this.cmdButtons.set(c.id, b);
    }

    const mm = $('minimap');
    const nav = (e) => {
      const w = this.game.minimap.toWorld(e.clientX, e.clientY);
      this.game.camera.centerOn(w.x, w.y);
    };
    mm.addEventListener('pointerdown', (e) => {
      e.preventDefault(); mm.setPointerCapture?.(e.pointerId); this._mmDrag = true; nav(e);
    });
    mm.addEventListener('pointermove', (e) => { if (this._mmDrag) { e.preventDefault(); nav(e); } });
    mm.addEventListener('pointerup', () => { this._mmDrag = false; });
    mm.addEventListener('pointercancel', () => { this._mmDrag = false; });

    // The turn banner lives above the canvas but outside the HUD grid.
    this.banner = el('div', '');
    this.banner.id = 'turnBanner';
    $('hud').appendChild(this.banner);
  }

  announceTurn(text, mine) {
    this.banner.textContent = text;
    this.banner.className = mine ? 'mine show' : 'enemy show';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.remove('show'), 1500);
  }

  // --- palette --------------------------------------------------------------
  _paletteItems() {
    const w = this.world;
    const me = w.humanIndex;
    const list = ROSTER[this.tab] || [];
    return list.map((id) => {
      const d = defOf(id);
      const cost = w.costOf(me, id);
      const isStruct = d.category === Category.STRUCTURE;
      const can = isStruct ? this._canBuild(id) : w.canProduce(me, id);
      const afford = w.players[me].res[d.res] >= cost;
      const queued = isStruct ? 0 : w.buildings.reduce(
        (n, b) => n + (b.owner === me ? b.queue.filter((j) => j.defId === id).length : 0), 0);
      const job = isStruct ? null : w.buildings.flatMap((b) => (b.owner === me ? b.queue : []))
        .find((j) => j.defId === id);
      return {
        key: id, id, icon: id, cost, res: d.res, name: d.name,
        enabled: can && afford, dim: !can, queued,
        progress: job ? 1 - job.turnsLeft / job.total : 0,
        turns: d.buildTurns, kind: isStruct ? 'building' : 'unit',
        selected: this.game.placing === id,
      };
    });
  }

  _canBuild(id) {
    const w = this.world;
    const d = defOf(id);
    if (d.fieldBuild && this.game.fortifyMode) return true;
    if (!d.isHQ && !w.buildings.some((b) => b.alive && b.built && b.owner === 0 && b.def.isHQ)) return false;
    if (d.requires) for (const r of d.requires) if (!w.hasBuilding(0, r)) return false;
    return true;
  }

  _syncPalette() {
    const items = this._paletteItems();
    const sig = items.map((i) =>
      `${i.key}|${i.enabled}|${i.dim}|${i.queued}|${i.progress.toFixed(2)}|${i.selected}|${i.cost}`
    ).join(',') + '|' + this.tab;
    if (sig === this.lastPaletteSig) return;
    this.lastPaletteSig = sig;

    const pal = $('palette');
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
        const d = defOf(it.id);
        card.title = `${it.name} — ${it.cost} ${RESOURCE_INFO[it.res].name}, ${it.turns} turn${it.turns > 1 ? 's' : ''}\n${d.desc || ''}`;
        card.addEventListener('click', () => this.game.paletteClick(it.kind, it.id));
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (it.kind === 'unit') this.game.cancelQueued(it.id);
        });
        pal.appendChild(card);
        this.cards.set(it.key, { card, cost, qty, prog });
      }
    }
    for (const it of items) {
      const c = this.cards.get(it.key);
      if (!c) continue;
      c.card.classList.toggle('disabled', !it.enabled);
      c.card.classList.toggle('selected', !!it.selected);
      c.cost.textContent = it.cost === 0 ? 'FREE' : it.cost;
      c.cost.style.color = RESOURCE_INFO[it.res].color;
      c.qty.hidden = it.queued < 1;
      c.qty.textContent = it.queued;
      c.prog.style.width = `${(it.progress || 0) * 100}%`;
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
    for (const o of list) {
      const urgent = o.id === 'hold' && o.state === 'active' && (mission.nextWaveIn?.() ?? 99) <= 1;
      const li = el('li', `${o.state}${o.optional ? ' opt' : ''}${urgent ? ' urgent' : ''}`);
      li.appendChild(el('span', 'mk',
        o.state === 'done' ? '✓' : o.state === 'failed' ? '✕' : '▸'));
      li.appendChild(el('span', 'tx', o.text));
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
      btn.hidden = !(ents.length && this.turns.isPlayerTurn && c.when({ units, buildings }, this.game));
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
      nm.appendChild(el('span', `cat ${d.category}`, CATEGORY_INFO[d.category].short));
      box.appendChild(nm);
      box.appendChild(el('div', 'sub', d.desc || ''));

      if (e.kind === 'unit') {
        const ap = el('div', 'ap');
        for (let i = 0; i < Math.min(e.apMax, 14); i++) {
          ap.appendChild(el('i', i < e.ap ? '' : 'spent'));
        }
        ap.appendChild(el('span', 'txt', `${e.ap}/${e.apMax} AP`));
        box.appendChild(ap);
      }

      const bars = el('div', 'bars');
      bars.appendChild(el('span', 'chip', `${Math.round(e.hp)}/${e.maxHp} HP`));
      bars.appendChild(el('span', 'chip', ARMOR_NAMES[d.armor]));
      if (e.kind === 'unit') {
        bars.appendChild(el('span', 'chip',
          `${d.upkeep} ${RESOURCE_INFO[UPKEEP_RESOURCE[d.category]].short}/turn`));
      }
      for (const wp of weaponsOf(d)) {
        const r = Math.round(wp.range / TILE);
        bars.appendChild(el('span', 'chip hot',
          `${DAMAGE_NAMES[wp.type]} ${wp.damage * (wp.shots || 1)} · ${r}t · ${wp.attackAp}AP`));
      }
      if (e.entrench > 0) bars.appendChild(el('span', 'chip', `Dug in ${e.entrench.toFixed(1)}`));
      if (e.starved) bars.appendChild(el('span', 'chip', 'STARVED'));
      if (d.sorties) bars.appendChild(el('span', 'chip', `${e.sorties} sortie(s)`));
      if (d.cargoSpace) bars.appendChild(el('span', 'chip', `Cargo ${e.cargo.length}/${d.cargoSpace}`));
      if (e.kind === 'building' && e.garrisonSlots) {
        bars.appendChild(el('span', 'chip', `Garrison ${e.garrison.length}/${e.garrisonSlots}`));
      }
      if (e.kind === 'building' && !e.built) {
        bars.appendChild(el('span', 'chip hot', `${e.turnsLeft} turn(s) to build`));
      }
      if (e.kind === 'building' && e.def.yields) {
        bars.appendChild(el('span', 'chip hot',
          `+${e.def.yieldAmount} ${RESOURCE_INFO[e.def.yields].short}/turn`));
      }
      box.appendChild(bars);
    } else {
      const counts = {};
      let ready = 0;
      for (const e of ents) {
        counts[e.def.name] = (counts[e.def.name] || 0) + 1;
        if (e.kind === 'unit' && e.canAct) ready++;
      }
      box.appendChild(el('div', 'nm', `${ents.length} selected · ${ready} can still act`));
      const bars = el('div', 'bars');
      for (const [name, n] of Object.entries(counts).slice(0, 6)) {
        bars.appendChild(el('span', 'chip', `${n} × ${name}`));
      }
      box.appendChild(bars);
    }
  }

  // --- notices --------------------------------------------------------------
  pushNotice(text, kind = 'info') {
    this.noticeQueue.push({ text, kind });
    if (kind === 'bad' && this.notices.length) this._clearNotices();
    if (this.noticeQueue.length > 6) this.noticeQueue.splice(0, this.noticeQueue.length - 6);
    this._pumpNotices();
  }
  _clearNotices() { for (const n of this.notices) n.node.remove(); this.notices.length = 0; }
  _pumpNotices() {
    if (this.notices.length || !this.noticeQueue.length) return;
    const { text, kind } = this.noticeQueue.shift();
    const n = el('div', `notice ${kind}`, text);
    $('notices').appendChild(n);
    this.notices.push({ node: n, life: 2.6 + Math.min(3.6, text.length / 32) });
  }

  flagNewObjective() { this.alert.freshUntil = performance.now() / 1000 + 12; }
  acknowledgeObjectives() {
    this.alert.freshUntil = 0;
    $('objectives').classList.remove('fresh');
  }

  flashResource(res) {
    const n = $(`stat${res[0].toUpperCase()}${res.slice(1)}`);
    if (!n) return;
    n.classList.remove('short');
    void n.offsetWidth;
    n.classList.add('short');
    setTimeout(() => n.classList.remove('short'), 1800);
  }

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
  }

  hint(text, seconds = 2.6) {
    const h = $('hint');
    h.textContent = text;
    h.classList.add('show');
    this.hintTimer = seconds;
  }

  // --- per-frame ------------------------------------------------------------
  sync(dt, mission, sel) {
    const w = this.world;
    const p = w.human;

    for (const r of Object.values(Res)) {
      const cap = r[0].toUpperCase() + r.slice(1);
      $(`${r}Val`).textContent = Math.floor(p.res[r]).toLocaleString();
      const net = (p.lastIncome?.[r] || 0) - (p.lastUpkeep?.[r] || 0);
      const d = $(`${r}Delta`);
      d.textContent = net === 0 ? '' : (net > 0 ? `+${net}` : `${net}`);
      d.className = `delta ${net > 0 ? 'up' : net < 0 ? 'down' : ''}`;
      $(`stat${cap}`).classList.toggle('short', !!p.deficits?.[r]);
    }

    const tier = roeTier(p.support);
    const fill = $('supportFill');
    fill.style.width = `${p.support}%`;
    fill.style.background = p.support >= 80 ? 'var(--good)' : p.support >= 50 ? 'var(--warn)' : 'var(--bad)';
    $('statSupport').title = `Local Support ${Math.round(p.support)}% — ${tier.name}: ${tier.blurb}`;
    $('statSupport').classList.toggle('critical', p.support < 50);

    $('turnVal').textContent = this.turns.turn;

    const cmd = w.commander;
    if (cmd) {
      $('cmdRank').textContent = cmd.rankCode;
      const pip = $('cmdPoints');
      pip.hidden = cmd.availablePoints <= 0;
      pip.textContent = cmd.availablePoints;
    }

    // End-turn button: pulses once every unit has spent its points.
    const btn = $('btnEndTurn');
    const pending = this.turns.isPlayerTurn
      ? w.unitsOf(0).filter((u) => u.canAct && !u.garrisonedIn).length : 0;
    btn.disabled = !this.turns.isPlayerTurn || this.game.busy;
    btn.classList.toggle('ready', this.turns.isPlayerTurn && pending === 0);
    $('endTurnHint').textContent = !this.turns.isPlayerTurn ? 'Guard moving'
      : pending ? `${pending} still to act` : 'all units done';

    const now = performance.now() / 1000;
    const due = mission.nextWaveIn ? mission.nextWaveIn() : null;
    $('statTurn').classList.toggle('warn', due != null && due <= 1);
    this._scanForAttacks(now);
    $('minimapWrap').classList.toggle('attack', now < this.alert.attackUntil);
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

  _scanForAttacks(now) {
    const w = this.world;
    const recent = w.time - 2;
    let hit = null;
    for (const b of w.buildings) if (b.owner === 0 && b.alive && b.lastHitAt > recent) { hit = b; break; }
    if (!hit) for (const u of w.units) if (u.owner === 0 && u.alive && u.lastHitAt > recent) { hit = u; break; }
    if (hit) this.reportAttack(hit.x, hit.y, now);
  }
}

export { $, el };
