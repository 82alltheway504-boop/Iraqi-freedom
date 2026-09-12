import { clamp } from '../core/math.js';

// ---------------------------------------------------------------------------
// All sound in this game is synthesised at runtime with the Web Audio API.
// There are no sample files: gunfire is filtered noise, cannon fire is a
// pitch-swept sine under a noise transient, and the score is generated from a
// Hijaz scale over a drone. That keeps the download tiny (which matters on a
// phone) and keeps every asset original.
// ---------------------------------------------------------------------------

const NOISE_SECONDS = 2;

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.masterVol = 0.85;
    this.sfxVol = 0.9;
    this.musicVol = 0.5;
    this._lastAt = new Map();     // per-cue throttling
    this._voices = 0;
    this.maxVoices = 22;
    this.listener = { x: 0, y: 0, scale: 1 };
    this.combatHeat = 0;
  }

  /** Must be called from inside a user gesture — iOS will not start audio otherwise. */
  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ready;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.masterVol;
    // A gentle limiter stops a dozen simultaneous explosions from clipping.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 9;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;
    this.master.connect(this.limiter).connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);

    // A short convolution gives the desert a little air without a sample file.
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(1.6, 2.6);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain).connect(this.master);

    this.noise = this._noiseBuffer();
    if (ctx.state === 'suspended') await ctx.resume();
    this.ready = true;
    return true;
  }

  _noiseBuffer() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * NOISE_SECONDS;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      // Mildly brown-tinted noise sits better under gunfire than pure white.
      last = (last + 0.02 * white) / 1.02;
      d[i] = white * 0.7 + last * 3.2;
    }
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  // --- graph helpers ------------------------------------------------------
  _now() { return this.ctx.currentTime; }

  _env(node, t, peak, attack, decay, sustain = 0) {
    const g = node.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + attack + decay);
  }

  /** Stereo placement and distance rolloff relative to the camera. */
  _place(x, y, maxDist = 1400) {
    const out = this.ctx.createGain();
    const dx = x - this.listener.x, dy = y - this.listener.y;
    const d = Math.hypot(dx, dy);
    if (d > maxDist) return null;
    const atten = clamp(1 - d / maxDist, 0, 1);
    out.gain.value = atten * atten;
    const panner = this.ctx.createStereoPanner
      ? this.ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = clamp(dx / (maxDist * 0.55), -0.85, 0.85);
      out.connect(panner);
      panner.connect(this.sfxBus);
      const send = this.ctx.createGain();
      send.gain.value = 0.35;
      panner.connect(send).connect(this.verb);
    } else {
      out.connect(this.sfxBus);
    }
    return out;
  }

  _throttle(key, ms) {
    const now = performance.now();
    const last = this._lastAt.get(key) || 0;
    if (now - last < ms) return false;
    this._lastAt.set(key, now);
    return true;
  }

  _noiseSource(t, dur, playbackRate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = playbackRate;
    s.loop = true;
    s.start(t, Math.random() * (NOISE_SECONDS - dur - 0.05));
    s.stop(t + dur + 0.05);
    return s;
  }

  // --- cues ---------------------------------------------------------------
  /** Small-arms crack: a filtered noise transient with a short body. */
  rifle(x, y, heavy = false) {
    if (!this._can('rifle', heavy ? 28 : 22)) return;
    const out = this._place(x, y, 1250);
    if (!out) return;
    const ctx = this.ctx, t = this._now();
    const dur = heavy ? 0.10 : 0.07;
    const n = this._noiseSource(t, dur, heavy ? 0.85 : 1.15);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = heavy ? 1500 : 2300;
    bp.Q.value = 0.8;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 320;
    const g = ctx.createGain();
    this._env(g, t, heavy ? 0.55 : 0.38, 0.001, dur);
    n.connect(bp).connect(hp).connect(g).connect(out);
    // Sub-thump so it has weight on a phone speaker.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(heavy ? 160 : 220, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.06);
    const og = ctx.createGain();
    this._env(og, t, heavy ? 0.30 : 0.16, 0.001, 0.07);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.12);
    this._cleanup(out, t + dur + 0.2);
  }

  /** Tank main gun / anti-tank gun: a real bang. */
  cannon(x, y) {
    if (!this._can('cannon', 55)) return;
    const out = this._place(x, y, 2000);
    if (!out) return;
    const ctx = this.ctx, t = this._now();
    const n = this._noiseSource(t, 0.5, 0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3600, t);
    lp.frequency.exponentialRampToValueAtTime(320, t + 0.4);
    const g = ctx.createGain();
    this._env(g, t, 1.0, 0.002, 0.45);
    n.connect(lp).connect(g).connect(out);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.35);
    const og = ctx.createGain();
    this._env(og, t, 0.95, 0.003, 0.4);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.5);
    this._cleanup(out, t + 0.8);
  }

  /** Rocket motor: rising whoosh. */
  rocket(x, y) {
    if (!this._can('rocket', 60)) return;
    const out = this._place(x, y, 1500);
    if (!out) return;
    const ctx = this.ctx, t = this._now();
    const n = this._noiseSource(t, 0.55, 1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + 0.45);
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    this._env(g, t, 0.5, 0.03, 0.5);
    n.connect(bp).connect(g).connect(out);
    this._cleanup(out, t + 0.8);
  }

  /** Flak / autocannon burst. */
  autocannon(x, y) {
    if (!this._can('auto', 26)) return;
    const out = this._place(x, y, 1400);
    if (!out) return;
    const ctx = this.ctx, t = this._now();
    const n = this._noiseSource(t, 0.12, 0.9);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.1;
    const g = ctx.createGain();
    this._env(g, t, 0.55, 0.001, 0.11);
    n.connect(bp).connect(g).connect(out);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.1);
    const og = ctx.createGain();
    this._env(og, t, 0.22, 0.001, 0.1);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.14);
    this._cleanup(out, t + 0.3);
  }

  explosion(x, y, big = false) {
    if (!this._can(big ? 'boom' : 'pop', big ? 70 : 45)) return;
    const out = this._place(x, y, big ? 2400 : 1700);
    if (!out) return;
    const ctx = this.ctx, t = this._now();
    const dur = big ? 1.5 : 0.8;
    const n = this._noiseSource(t, dur, big ? 0.42 : 0.7);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(big ? 2600 : 3400, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + dur * 0.8);
    const g = ctx.createGain();
    this._env(g, t, big ? 1.25 : 0.8, 0.004, dur);
    n.connect(lp).connect(g).connect(out);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 110 : 170, t);
    o.frequency.exponentialRampToValueAtTime(big ? 24 : 40, t + dur * 0.65);
    const og = ctx.createGain();
    this._env(og, t, big ? 1.1 : 0.6, 0.004, dur * 0.7);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + dur);

    const send = ctx.createGain();
    send.gain.value = big ? 0.7 : 0.35;
    g.connect(send).connect(this.verb);
    this._cleanup(out, t + dur + 0.6);
    this.combatHeat = Math.min(1, this.combatHeat + (big ? 0.28 : 0.14));
  }

  impact(x, y) {
    if (!this._can('impact', 35)) return;
    const out = this._place(x, y, 1100);
    if (!out) return;
    const ctx = this.ctx, t = this._now();
    const n = this._noiseSource(t, 0.2, 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain();
    this._env(g, t, 0.34, 0.003, 0.2);
    n.connect(lp).connect(g).connect(out);
    this._cleanup(out, t + 0.4);
  }

  // --- interface cues ------------------------------------------------------
  _blip(freqs, dur, type = 'triangle', vol = 0.22, stagger = 0.055) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now();
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.sfxBus);
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      this._env(g, t + i * stagger, vol, 0.006, dur);
      o.connect(g).connect(out);
      o.start(t + i * stagger);
      o.stop(t + i * stagger + dur + 0.05);
    });
    this._cleanup(out, t + freqs.length * stagger + dur + 0.2);
  }

  uiTap()      { this._blip([740], 0.05, 'square', 0.12); }
  select()     { this._blip([520, 780], 0.07, 'triangle', 0.16, 0.035); }
  confirm()    { this._blip([440, 660], 0.09, 'triangle', 0.18, 0.045); }
  deny()       { this._blip([200, 150], 0.12, 'sawtooth', 0.14, 0.06); }
  unitReady()  { this._blip([587, 784], 0.12, 'triangle', 0.2, 0.07); }
  buildDone()  { this._blip([392, 523, 659], 0.14, 'triangle', 0.2, 0.075); }
  promote()    { this._blip([659, 880, 1175], 0.11, 'triangle', 0.18, 0.06); }
  objective()  { this._blip([523, 659, 784, 1046], 0.16, 'triangle', 0.22, 0.1); }
  alert()      { this._blip([880, 660, 880, 660], 0.1, 'square', 0.16, 0.11); }
  victory()    { this._blip([523, 659, 784, 1046, 1318], 0.3, 'triangle', 0.24, 0.16); }
  defeat()     { this._blip([392, 330, 262, 196], 0.42, 'sine', 0.24, 0.2); }

  _can(key, ms) {
    if (!this.ready || !this.enabled) return false;
    if (this._voices > this.maxVoices) return false;
    return this._throttle(key, ms);
  }

  _cleanup(node, when) {
    this._voices++;
    const delay = Math.max(0, (when - this._now()) * 1000) + 60;
    setTimeout(() => {
      this._voices--;
      try { node.disconnect(); } catch { /* already gone */ }
    }, delay);
  }

  setListener(x, y, scale) { this.listener.x = x; this.listener.y = y; this.listener.scale = scale; }

  update(dt) {
    this.combatHeat = Math.max(0, this.combatHeat - dt * 0.22);
  }

  setVolumes({ master, sfx, music }) {
    if (master != null) this.masterVol = master;
    if (sfx != null) this.sfxVol = sfx;
    if (music != null) this.musicVol = music;
    if (!this.ready) return;
    this.master.gain.value = this.masterVol;
    this.sfxBus.gain.value = this.sfxVol;
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.ready) this.master.gain.value = m ? 0 : this.masterVol;
  }
}
