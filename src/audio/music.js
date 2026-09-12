import { clamp } from '../core/math.js';

// ---------------------------------------------------------------------------
// An original, generated score. No loops, no sample files: a lookahead
// scheduler writes notes into the Web Audio graph a bar at a time.
//
// The mode is Hijaz on D (D Eb F# G A Bb C) — the augmented second between
// Eb and F# is what gives it its character. Four layers fade in and out with
// how much fighting is going on:
//
//   drone   always present, the tonic and fifth on a bowed pad
//   frame   a doumbek-style hand drum, enters above heat 0.1
//   oud     a plucked melodic line, ambient only, steps aside for combat
//   war     low brass-ish stabs and a war drum, fades in with heat
// ---------------------------------------------------------------------------

const ROOT = 146.83;                                  // D3
const HIJAZ = [0, 1, 4, 5, 7, 8, 10];                 // semitone degrees
const ratio = (semi) => Math.pow(2, semi / 12);

// Two melodic phrases, written as [scale degree, beats]. Degree may exceed the
// scale length; it wraps into the next octave.
const PHRASES = [
  [[0, 1], [1, 0.5], [2, 0.5], [3, 1], [2, 0.5], [1, 0.5], [0, 2]],
  [[4, 1], [3, 0.5], [2, 0.5], [3, 1], [4, 1], [5, 1], [4, 2]],
  [[0, 0.5], [2, 0.5], [3, 1], [4, 0.5], [3, 0.5], [2, 1], [1, 1], [0, 1]],
  [[7, 1], [6, 0.5], [5, 0.5], [4, 1], [3, 1], [2, 1.5], [0, 1.5]],
];

// Frame-drum pattern over 8 eighth-notes: 2 = dum (low), 1 = tek (high), 0 = rest.
const DRUM = [
  [2, 0, 1, 0, 2, 1, 1, 0],
  [2, 0, 1, 1, 2, 0, 1, 0],
  [2, 1, 0, 1, 2, 0, 1, 1],
];

export class Music {
  constructor(audio) {
    this.a = audio;
    this.playing = false;
    this.bpm = 84;
    this.beat = 0;
    this.nextNoteTime = 0;
    this.lookahead = 0.12;          // seconds of audio scheduled ahead
    this.timer = null;
    this.heat = 0;                  // 0 ambient .. 1 full combat
    this.targetHeat = 0;
    this.phrase = 0;
    this.phraseStep = 0;
    this.phraseBeatsLeft = 0;
    this.bar = 0;
  }

  get ctx() { return this.a.ctx; }
  get beatDur() { return 60 / this.bpm; }

  start() {
    if (!this.a.ready || this.playing) return;
    this.playing = true;
    const ctx = this.ctx;

    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(this.a.musicBus);

    // Gentle high shelf so the score never fights the sound effects.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'highshelf';
    this.tone.frequency.value = 2400;
    this.tone.gain.value = -6;
    this.tone.connect(this.bus);

    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.0001;
    this.droneGain.connect(this.tone);
    this.oudGain = ctx.createGain(); this.oudGain.gain.value = 0.0001;
    this.oudGain.connect(this.tone);
    this.drumGain = ctx.createGain(); this.drumGain.gain.value = 0.0001;
    this.drumGain.connect(this.tone);
    this.warGain = ctx.createGain(); this.warGain.gain.value = 0.0001;
    this.warGain.connect(this.tone);

    this._startDrone();
    this.nextNoteTime = ctx.currentTime + 0.08;
    this.beat = 0;
    this.timer = setInterval(() => this._schedule(), 40);
    this.a.musicBus.gain.setTargetAtTime(this.a.musicVol, ctx.currentTime, 1.5);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.a.musicBus.gain.setTargetAtTime(0.0001, t, 0.5);
    for (const o of this.droneOsc || []) { try { o.stop(t + 2.2); } catch { /* stopped */ } }
    this.droneOsc = [];
  }

  setVolume(v) {
    if (this.a.ready) this.a.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }

  /** Drive the arrangement from how much combat is happening on screen. */
  setHeat(h) { this.targetHeat = clamp(h, 0, 1); }

  _startDrone() {
    const ctx = this.ctx, t = ctx.currentTime;
    this.droneOsc = [];
    // Tonic and fifth, each a pair of slightly detuned saws through a lowpass:
    // a bowed, breathing pad rather than a static organ tone.
    for (const [mult, gain] of [[1, 0.5], [1.5, 0.3], [0.5, 0.42]]) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = ROOT * mult;
        o.detune.value = detune;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        lp.Q.value = 0.6;
        // Slow filter drift keeps the pad from sounding frozen.
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.045 + Math.random() * 0.03;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 170;
        lfo.connect(lfoGain).connect(lp.frequency);
        lfo.start(t);
        const g = ctx.createGain();
        g.gain.value = gain * 0.09;
        o.connect(lp).connect(g).connect(this.droneGain);
        o.start(t);
        this.droneOsc.push(o, lfo);
      }
    }
    this.droneGain.gain.setTargetAtTime(0.9, t, 2.0);
  }

  _schedule() {
    if (!this.playing) return;
    const ctx = this.ctx;

    // Ease the layer mix toward the current combat heat.
    this.heat += (this.targetHeat - this.heat) * 0.06;
    const h = this.heat;
    const t = ctx.currentTime;
    this.drumGain.gain.setTargetAtTime(clamp(0.25 + h * 0.75, 0, 1), t, 0.8);
    this.oudGain.gain.setTargetAtTime(clamp(0.95 - h * 0.85, 0, 1), t, 1.2);
    this.warGain.gain.setTargetAtTime(clamp((h - 0.25) / 0.75, 0, 1), t, 0.9);
    this.droneGain.gain.setTargetAtTime(0.75 + h * 0.25, t, 1.0);

    while (this.nextNoteTime < ctx.currentTime + this.lookahead) {
      this._emit(this.beat, this.nextNoteTime);
      this.nextNoteTime += this.beatDur / 2;      // scheduler runs on eighths
      this.beat++;
    }
  }

  _emit(step, when) {
    const eighth = step % 8;
    if (eighth === 0) this.bar++;

    // --- hand drum -------------------------------------------------------
    const pattern = DRUM[this.bar % DRUM.length];
    const hit = pattern[eighth];
    if (hit === 2) this._drum(when, 78, 0.28, 0.22);
    else if (hit === 1) this._drum(when, 210, 0.10, 0.10);
    // Fills at the end of every fourth bar, heavier when the fighting is.
    if (eighth >= 6 && this.bar % 4 === 0 && Math.random() < 0.35 + this.heat * 0.3) {
      this._drum(when + this.beatDur * 0.25, 240, 0.07, 0.08);
    }

    // --- war layer -------------------------------------------------------
    if (this.heat > 0.2) {
      if (eighth === 0) this._warDrum(when, 0.5);
      if (eighth === 4) this._warDrum(when, 0.34);
      if (eighth === 0 && this.bar % 2 === 1) {
        const deg = this.bar % 8 < 4 ? 0 : 3;
        this._brass(when, ROOT * 0.5 * ratio(HIJAZ[deg]), this.beatDur * 2.4);
      }
    }

    // --- oud melody ------------------------------------------------------
    if (this.heat < 0.8 && eighth % 2 === 0) {
      if (this.phraseBeatsLeft <= 0) {
        const ph = PHRASES[this.phrase % PHRASES.length];
        if (this.phraseStep >= ph.length) {
          this.phraseStep = 0;
          this.phrase = (this.phrase + 1 + (Math.random() < 0.4 ? 1 : 0)) % PHRASES.length;
          this.phraseBeatsLeft = 2;                 // breathe between phrases
        } else {
          const [deg, beats] = ph[this.phraseStep++];
          const oct = Math.floor(deg / HIJAZ.length);
          const semi = HIJAZ[deg % HIJAZ.length] + oct * 12;
          this._oud(when, ROOT * 2 * ratio(semi), beats * this.beatDur);
          this.phraseBeatsLeft = beats;
        }
      }
      this.phraseBeatsLeft -= 0.5;
    }
  }

  /** Membrane hit: pitch-dropping sine plus a noise slap. */
  _drum(when, freq, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2.2, when);
    o.frequency.exponentialRampToValueAtTime(freq, when + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(this.drumGain);
    o.start(when); o.stop(when + dur + 0.05);

    const n = ctx.createBufferSource();
    n.buffer = this.a.noise;
    n.loop = true;
    n.playbackRate.value = 1.4;
    n.start(when, Math.random() * 1.5);
    n.stop(when + 0.07);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 6;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, when);
    ng.gain.exponentialRampToValueAtTime(vol * 0.55, when + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    n.connect(bp).connect(ng).connect(this.drumGain);
  }

  _warDrum(when, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);
    o.connect(g).connect(this.warGain);
    o.start(when); o.stop(when + 0.55);
  }

  _brass(when, freq, dur) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, when);
    out.gain.exponentialRampToValueAtTime(0.16, when + 0.08);
    out.gain.setValueAtTime(0.16, when + dur * 0.6);
    out.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, when);
    lp.frequency.linearRampToValueAtTime(1200, when + 0.12);
    lp.frequency.linearRampToValueAtTime(500, when + dur);
    lp.connect(out);
    out.connect(this.warGain);
    for (const [mult, det] of [[1, -8], [1, 9], [2, 4], [3, -5]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq * mult;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = 1 / (mult * 2.2);
      o.connect(g).connect(lp);
      o.start(when); o.stop(when + dur + 0.1);
    }
  }

  /** Plucked string: a bright attack decaying into a filtered body. */
  _oud(when, freq, dur) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.16;
    out.connect(this.oudGain);
    for (const [mult, amp, det] of [[1, 1, 0], [2, 0.36, 5], [3, 0.16, -7], [4.02, 0.07, 3]]) {
      const o = ctx.createOscillator();
      o.type = mult === 1 ? 'triangle' : 'sine';
      o.frequency.value = freq * mult;
      o.detune.value = det;
      const g = ctx.createGain();
      const len = dur * (mult === 1 ? 1 : 0.55);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(amp, when + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      o.connect(g).connect(out);
      o.start(when); o.stop(when + len + 0.05);
    }
    // A courtesy octave doubling gives the line an oud's twin-course shimmer.
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 2;
    o2.detune.value = 11;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, when + 0.012);
    g2.gain.exponentialRampToValueAtTime(0.3, when + 0.022);
    g2.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.6);
    o2.connect(g2).connect(out);
    o2.start(when + 0.012); o2.stop(when + dur * 0.6 + 0.05);
  }
}
