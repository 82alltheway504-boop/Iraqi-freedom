import { PAL } from './palette.js';
import { sprite, rr, poly, plate, seam, dot, speckle, teamFlash, outlinePath } from './draw.js';
import { makeRng, TAU } from '../core/math.js';
import { UNITS, BUILDINGS, FACTION } from '../sim/defs.js';
import { TILE } from '../world/terrain.js';

// ---------------------------------------------------------------------------
// Every vehicle, soldier and structure in the game is drawn here, in code, at
// load time. Sprites face +x (east). Vehicles with a turret render the hull
// and turret separately so the turret can track a target independently.
// ---------------------------------------------------------------------------

const hullPal = (f) => f === FACTION.RG
  ? { c0: PAL.rgHull0, c1: PAL.rgHull1, c2: PAL.rgHull2 }
  : { c0: PAL.ctfHull0, c1: PAL.ctfHull1, c2: PAL.ctfHull2 };

// --- shared vehicle furniture ---------------------------------------------
function tracks(g, L, Wd, rng) {
  for (const sy of [-1, 1]) {
    const ty = sy * (Wd / 2 - 3.6);
    plate(g, -L / 2 + 1, ty - 4.4, L - 2, 8.8, '#3b3833', '#4e4a43', '#232120', 1.6);
    g.strokeStyle = 'rgba(14,14,12,0.55)'; g.lineWidth = 0.7;
    for (let x = -L / 2 + 3; x < L / 2 - 2; x += 3.1) {
      g.beginPath(); g.moveTo(x, ty - 4.2); g.lineTo(x, ty + 4.2); g.stroke();
    }
    // Drive sprocket and idler.
    dot(g, -L / 2 + 4.5, ty, 3.1, '#555049');
    dot(g, L / 2 - 4.5, ty, 3.1, '#555049');
    dot(g, -L / 2 + 4.5, ty, 1.2, '#2b2824');
    dot(g, L / 2 - 4.5, ty, 1.2, '#2b2824');
  }
}

function wheels(g, positions, r, wdt) {
  for (const [x, y] of positions) {
    g.save(); g.translate(x, y);
    rr(g, -r, -wdt / 2, r * 2, wdt, 1.6);
    g.fillStyle = PAL.tyre; g.fill();
    g.strokeStyle = 'rgba(10,10,9,0.8)'; g.lineWidth = 0.7; g.stroke();
    g.fillStyle = 'rgba(120,116,108,0.5)';
    g.fillRect(-r * 0.45, -wdt / 2 + 0.8, r * 0.9, wdt - 1.6);
    g.restore();
  }
}

function stowage(g, x, y, w, h, rng) {
  plate(g, x, y, w, h, PAL.canvasTan, '#d9c294', PAL.canvasShade, 1.4);
  g.strokeStyle = 'rgba(40,34,22,0.35)'; g.lineWidth = 0.6;
  for (let i = 1; i < 3; i++) {
    g.beginPath(); g.moveTo(x + (w * i) / 3, y); g.lineTo(x + (w * i) / 3, y + h); g.stroke();
  }
}

function barrel(g, len, thick, muzzleBrake = true) {
  plate(g, 0, -thick / 2, len, thick, PAL.barrel, '#8a7f5f', '#4e472f', thick / 2);
  if (muzzleBrake) {
    plate(g, len - 6, -thick / 2 - 1.1, 5.5, thick + 2.2, '#5e5741', '#7b7257', '#3b3628', 1);
  }
}

// --- vehicles ---------------------------------------------------------------
function mbtHull(g, f, team, rng) {
  const L = 48, Wd = 30;
  const p = hullPal(f);
  tracks(g, L, Wd, rng);
  // Side skirts over the running gear.
  for (const sy of [-1, 1]) {
    plate(g, -L / 2 + 3, sy * (Wd / 2 - 8.5) - 2.4, L - 8, 4.8, p.c2, p.c1, '#5d5335', 1);
  }
  outlinePath(g, [[24, -7.5], [18.5, -11], [-20, -11], [-23.5, -6.5], [-23.5, 6.5], [-20, 11], [18.5, 11], [24, 7.5]], p.c0);
  // Glacis: the lit upper plate.
  outlinePath(g, [[24, -7.5], [18.5, -11], [8, -11], [11, -7.5], [11, 7.5], [8, 11], [18.5, 11], [24, 7.5]], p.c1);
  seam(g, 11, -7.5, 11, 7.5, 0.35);
  seam(g, -8, -10.5, -8, 10.5, 0.25);
  // Engine deck louvres at the rear.
  plate(g, -22, -8.5, 11, 17, p.c2, p.c1, '#4f4730', 1.4);
  g.strokeStyle = 'rgba(12,14,10,0.45)'; g.lineWidth = 0.7;
  for (let x = -20.5; x < -12; x += 2.2) { g.beginPath(); g.moveTo(x, -7.5); g.lineTo(x, 7.5); g.stroke(); }
  stowage(g, -12, -9.5, 7, 6.5, rng);
  stowage(g, -12, 3, 7, 6.5, rng);
  // Headlights and team flash.
  dot(g, 22, -5.5, 1.5, '#e9e3c6'); dot(g, 22, 5.5, 1.5, '#e9e3c6');
  teamFlash(g, -1, -11.6, 8, 2.2, team);
  teamFlash(g, -1, 9.4, 8, 2.2, team);
}

function mbtTurret(g, f, team, rng) {
  const p = hullPal(f);
  g.save();
  g.translate(0, 0);
  barrel(g, 30, 3.4);
  // Mantlet and turret shell.
  plate(g, -2, -5, 6, 10, p.c2, p.c1, '#4e4630', 2);
  outlinePath(g, [[4, -8.5], [1, -10.5], [-13, -10.5], [-15.5, -7], [-15.5, 7], [-13, 10.5], [1, 10.5], [4, 8.5]], p.c1);
  // Bustle rack behind the turret.
  plate(g, -17.5, -8, 5, 16, p.c2, p.c0, '#4a4230', 1.2);
  g.strokeStyle = 'rgba(10,12,8,0.4)'; g.lineWidth = 0.6;
  for (let y = -7; y < 7; y += 2.4) { g.beginPath(); g.moveTo(-17.2, y); g.lineTo(-12.8, y); g.stroke(); }
  // Commander's cupola and the pintle machine gun.
  dot(g, -4, -3.4, 3.6, p.c2); dot(g, -4, -3.4, 2.6, p.c1);
  plate(g, -4.5, 2.4, 9, 2.4, '#4a473f', '#615d53', '#2c2a26', 1);
  dot(g, -6.5, -3.4, 1.1, 'rgba(15,17,12,0.7)');
  teamFlash(g, -11, -10.9, 6, 1.9, team);
  g.restore();
}

function ifvHull(g, f, team, rng) {
  const L = 42, Wd = 27;
  const p = hullPal(f);
  tracks(g, L, Wd, rng);
  outlinePath(g, [[21, -6], [15, -9.5], [-18, -9.5], [-20.5, -5.5], [-20.5, 5.5], [-18, 9.5], [15, 9.5], [21, 6]], p.c0);
  outlinePath(g, [[21, -6], [15, -9.5], [4, -9.5], [7, -6], [7, 6], [4, 9.5], [15, 9.5], [21, 6]], p.c1);
  seam(g, 7, -6, 7, 6, 0.3);
  // Rear ramp for the dismounts.
  plate(g, -20, -7, 6, 14, p.c2, p.c1, '#4e4630', 1.2);
  seam(g, -17, -6.5, -17, 6.5, 0.4);
  // Firing-port vision blocks.
  for (const sy of [-1, 1]) for (let x = -12; x < 2; x += 5) {
    g.fillStyle = PAL.glass; g.fillRect(x, sy * 8.2 - 0.9, 3, 1.8);
  }
  dot(g, 19.5, -4.5, 1.3, '#e9e3c6'); dot(g, 19.5, 4.5, 1.3, '#e9e3c6');
  teamFlash(g, -3, -10.1, 7, 2, team);
  teamFlash(g, -3, 8.1, 7, 2, team);
}

function ifvTurret(g, f, team, rng) {
  const p = hullPal(f);
  barrel(g, 19, 2.2, false);
  plate(g, 16, -1.6, 3, 3.2, '#4e4a3c', '#6b6552', '#2e2b22', 0.8);
  outlinePath(g, [[3, -6], [1, -7.5], [-9, -7.5], [-11, -5], [-11, 5], [-9, 7.5], [1, 7.5], [3, 6]], p.c1);
  // Twin anti-tank missile box on the flank.
  plate(g, -6, -10, 9, 3.4, p.c2, p.c1, '#4a4330', 0.9);
  dot(g, -3, -2, 2.4, p.c2); dot(g, -3, -2, 1.7, p.c0);
  teamFlash(g, -8, -7.9, 5, 1.7, team);
}

function humveeHull(g, f, team, rng) {
  const L = 33, Wd = 21;
  const p = hullPal(f);
  wheels(g, [[11, -Wd / 2 + 1.5], [11, Wd / 2 - 1.5], [-10, -Wd / 2 + 1.5], [-10, Wd / 2 - 1.5]], 4.6, 3.4);
  outlinePath(g, [[16.5, -6], [14, -8], [-15, -8], [-16.5, -5.5], [-16.5, 5.5], [-15, 8], [14, 8], [16.5, 6]], p.c0);
  // Bonnet, then crew compartment.
  plate(g, 5, -7, 11, 14, p.c1, '#cdbc88', p.c2, 1.6);
  g.fillStyle = PAL.glass; g.fillRect(2.5, -6.4, 3.2, 12.8);
  plate(g, -15, -7, 9, 14, p.c2, p.c0, '#5d5335', 1.4);
  stowage(g, -14, -5.5, 6.5, 11, rng);
  // Roof turret ring with a light machine gun.
  dot(g, -2.5, 0, 4.6, p.c2); dot(g, -2.5, 0, 3.5, p.c1);
  plate(g, -2.5, -1.1, 11, 2.2, '#4a473f', '#615d53', '#2c2a26', 0.9);
  dot(g, 16.2, -4.6, 1.2, '#e9e3c6'); dot(g, 16.2, 4.6, 1.2, '#e9e3c6');
  teamFlash(g, -6, -8.6, 6, 1.8, team);
  teamFlash(g, -6, 6.8, 6, 1.8, team);
}

function technicalHull(g, f, team, rng) {
  const L = 32, Wd = 19;
  const p = hullPal(f);
  wheels(g, [[10, -Wd / 2 + 1.4], [10, Wd / 2 - 1.4], [-9, -Wd / 2 + 1.4], [-9, Wd / 2 - 1.4]], 4.2, 3.1);
  outlinePath(g, [[16, -5], [13.5, -7], [-15, -7], [-16, -5], [-16, 5], [-15, 7], [13.5, 7], [16, 5]], '#8e8a63');
  plate(g, 4, -6.2, 10, 12.4, '#a49e72', '#bdb68a', '#736e4c', 1.5);
  g.fillStyle = PAL.glass; g.fillRect(2, -5.6, 2.8, 11.2);
  // Open cargo bed with a heavy machine gun on a post.
  plate(g, -15, -6.4, 17, 12.8, '#6e6a4c', '#857f5d', '#4a4733', 1.2);
  g.strokeStyle = 'rgba(20,20,14,0.4)'; g.lineWidth = 0.6;
  for (let x = -13; x < 0; x += 3) { g.beginPath(); g.moveTo(x, -6); g.lineTo(x, 6); g.stroke(); }
  dot(g, -7, 0, 2.6, '#4a473f');
  plate(g, -7, -1, 12, 2, '#413e37', '#575349', '#26241f', 0.8);
  teamFlash(g, -2, -7.6, 5, 1.7, team);
}

function truckHull(g, f, team, rng) {
  const L = 40, Wd = 22;
  const p = hullPal(f);
  wheels(g, [[13, -Wd / 2 + 1.6], [13, Wd / 2 - 1.6],
             [-7, -Wd / 2 + 1.6], [-7, Wd / 2 - 1.6],
             [-13.5, -Wd / 2 + 1.6], [-13.5, Wd / 2 - 1.6]], 4.4, 3.4);
  outlinePath(g, [[20, -6], [17.5, -8.5], [-18, -8.5], [-19.5, -6], [-19.5, 6], [-18, 8.5], [17.5, 8.5], [20, 6]], p.c0);
  plate(g, 9, -7.6, 11, 15.2, p.c1, '#cdbc88', p.c2, 1.6);
  g.fillStyle = PAL.glass; g.fillRect(7, -6.8, 3, 13.6);
  // Canvas-covered cargo bay with tilt hoops.
  plate(g, -19, -8.4, 26, 16.8, PAL.canvasTan, '#dcc697', PAL.canvasShade, 2.4);
  g.strokeStyle = 'rgba(60,48,28,0.35)'; g.lineWidth = 0.9;
  for (let x = -16; x < 5; x += 4.2) { g.beginPath(); g.moveTo(x, -8); g.lineTo(x, 8); g.stroke(); }
  teamFlash(g, 0, -9.1, 7, 1.9, team);
  teamFlash(g, 0, 7.2, 7, 1.9, team);
}

function aaHull(g, f, team, rng) {
  const L = 36, Wd = 24;
  const p = hullPal(f);
  wheels(g, [[12, -Wd / 2 + 1.6], [12, Wd / 2 - 1.6], [-2, -Wd / 2 + 1.6], [-2, Wd / 2 - 1.6],
             [-12, -Wd / 2 + 1.6], [-12, Wd / 2 - 1.6]], 4.4, 3.6);
  outlinePath(g, [[18, -6.5], [15, -9], [-16, -9], [-18, -6], [-18, 6], [-16, 9], [15, 9], [18, 6.5]], p.c0);
  plate(g, 7, -8, 11, 16, p.c1, '#c6bb88', p.c2, 1.6);
  g.fillStyle = PAL.glass; g.fillRect(5, -7.2, 2.8, 14.4);
  teamFlash(g, -4, -9.6, 6, 1.8, team);
}

function aaTurret(g, f, team, rng) {
  const p = hullPal(f);
  for (const sy of [-1, 1]) {
    g.save(); g.translate(0, sy * 3.1);
    barrel(g, 17, 1.7, false);
    g.restore();
  }
  outlinePath(g, [[2, -6], [0, -7.5], [-8, -7.5], [-9.5, -5], [-9.5, 5], [-8, 7.5], [0, 7.5], [2, 6]], p.c1);
  plate(g, -8, -4.5, 4, 9, '#55503f', '#6d6752', '#33301f', 1);
  dot(g, -3, 0, 2, p.c2);
}

// --- infantry ---------------------------------------------------------------
// Soldiers are drawn from directly above: helmet, shoulders, pack, weapon.
function soldier(g, f, team, kind, frame, rng) {
  const rg = f === FACTION.RG;
  const cloth = rg ? '#87794e' : '#9a8c5c';
  const clothLit = rg ? '#9c8e5f' : '#b3a570';
  const clothDk = rg ? '#645a39' : '#726841';

  // Legs swing between the two frames so a moving squad reads as moving.
  const swing = frame === 0 ? 1 : -1;
  g.save();
  g.fillStyle = 'rgba(45,38,24,0.35)';
  g.beginPath(); g.ellipse(1.6, 2.2, 6.4, 4.4, 0, 0, TAU); g.fill();
  g.restore();

  for (const sy of [-1, 1]) {
    g.save();
    g.translate(-1, sy * 2.2 + swing * sy * 0.9);
    plate(g, -3.4, -1.5, 6, 3, clothDk, cloth, '#3d3722', 1.2, null);
    g.restore();
  }

  // Weapon, held to the right side of the body, pointing forward.
  if (kind !== 'engineer') {
    g.save();
    g.translate(0, 1.8);
    const len = kind === 'at' ? 11 : 8.5;
    plate(g, 1, -0.75, len, 1.5, '#3a382f', '#4e4b40', '#232119', 0.6, null);
    if (kind === 'at') {
      plate(g, 3.5, -1.9, 5, 3.8, '#4a4634', '#5f5a44', '#2c2a1f', 1, null);
    }
    g.restore();
  } else {
    // Engineers carry a toolbox instead of a rifle.
    g.save(); g.translate(2.5, 2.6);
    plate(g, -2, -1.6, 4, 3.2, '#b0662f', '#cf8043', '#7d4519', 0.7, null);
    g.restore();
  }

  // Torso, webbing and pack.
  plate(g, -4.6, -3.6, 8.4, 7.2, cloth, clothLit, clothDk, 2.4);
  plate(g, -5.4, -2.6, 3.2, 5.2, clothDk, cloth, '#35301e', 1.2);   // rucksack
  g.fillStyle = 'rgba(30,28,18,0.45)';
  g.fillRect(-3.4, -0.9, 6.4, 1.3);                                  // chest rig
  teamFlash(g, -1.2, -3.9, 3.4, 1.3, team);

  // Helmet.
  dot(g, 0.6, 0, 3.2, rg ? '#6e6540' : '#7d7449');
  dot(g, 1.2, -0.5, 2.4, rg ? '#877c50' : '#968c5c');
  g.strokeStyle = 'rgba(12,14,10,0.7)'; g.lineWidth = 0.8;
  g.beginPath(); g.arc(0.6, 0, 3.2, 0, TAU); g.stroke();
}

// --- structures -------------------------------------------------------------
function pad(g, w, h, rng, tone = 0) {
  // Concrete hardstanding under every structure.
  const c0 = tone ? PAL.mudbrick2 : PAL.concrete2;
  rr(g, -w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 3);
  g.fillStyle = c0; g.fill();
  g.strokeStyle = 'rgba(12,14,10,0.5)'; g.lineWidth = 1; g.stroke();
  g.save(); rr(g, -w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 3); g.clip();
  speckle(g, -w / 2 - 3, -h / 2 - 3, w + 6, h + 6, rng, (w * h) / 26,
    ['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.10)'], [0.8, 2.2]);
  g.restore();
}

function roofDetail(g, w, h, rng, opts = {}) {
  const { vents = 3, hatch = true, ac = true } = opts;
  g.save();
  for (let i = 0; i < vents; i++) {
    const x = -w / 2 + 6 + rng() * (w - 12);
    const y = -h / 2 + 6 + rng() * (h - 12);
    plate(g, x - 3, y - 2, 6, 4, PAL.metal0, PAL.metal1, PAL.metal2, 0.8);
  }
  if (ac) {
    const x = -w / 2 + 5 + rng() * (w - 16);
    plate(g, x, -h / 2 + 4, 10, 7, PAL.metal2, PAL.metal0, '#3c3c39', 1);
    g.strokeStyle = 'rgba(220,220,214,0.25)'; g.lineWidth = 0.7;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x + k * 2.4, -h / 2 + 4.6); g.lineTo(x + k * 2.4, -h / 2 + 10.4); g.stroke(); }
  }
  if (hatch) {
    plate(g, w / 2 - 11, h / 2 - 10, 7, 7, PAL.metal2, PAL.metal0, '#3a3a37', 1);
  }
  g.restore();
}

function sandbagRing(g, rx, ry, rng, n = 22) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2);
    plate(g, -3.4, -2.1, 6.8, 4.2, '#a89464', i % 2 ? '#c0aa78' : '#b39e6c', '#7c6c48', 1.8);
    g.restore();
  }
}

function antenna(g, x, y, len, rng) {
  g.strokeStyle = 'rgba(28,30,24,0.85)'; g.lineWidth = 1.1;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + len * 0.35, y - len); g.stroke();
  dot(g, x + len * 0.35, y - len, 1.4, '#cf5a3c');
}

const STRUCT = {
  hq(g, w, h, f, team, rng) {
    pad(g, w, h, rng);
    plate(g, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, PAL.concrete0, PAL.concrete1, PAL.concrete2, 3);
    // Operations block with a raised roof.
    plate(g, -w / 2 + 8, -h / 2 + 8, w * 0.48, h - 16, PAL.concrete2, PAL.concrete0, '#75705f', 2.5);
    roofDetail(g, w, h, rng, { vents: 4 });
    // Vehicle apron and helipad circle.
    g.strokeStyle = 'rgba(240,236,220,0.45)'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(w / 4, h / 6, Math.min(w, h) * 0.17, 0, TAU); g.stroke();
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(w / 4 - 5, h / 6 - 5); g.lineTo(w / 4 - 5, h / 6 + 5);
    g.moveTo(w / 4 - 5, h / 6); g.lineTo(w / 4 + 5, h / 6);
    g.moveTo(w / 4 + 5, h / 6 - 5); g.lineTo(w / 4 + 5, h / 6 + 5);
    g.stroke();
    sandbagRing(g, w / 2 - 3, h / 2 - 3, rng, 30);
    antenna(g, -w / 2 + 12, -h / 2 + 12, 18, rng);
    antenna(g, -w / 2 + 20, -h / 2 + 10, 13, rng);
    teamFlash(g, -w / 2 + 6, h / 2 - 9, w * 0.4, 4, team);
  },

  barracks(g, w, h, f, team, rng) {
    pad(g, w, h, rng);
    // Tent-roofed accommodation blocks.
    for (let i = 0; i < 2; i++) {
      const by = -h / 2 + 5 + i * (h - 12) / 1.6;
      plate(g, -w / 2 + 4, by, w - 8, (h - 14) / 2, PAL.canvasTan, '#dcc697', PAL.canvasShade, 3);
      g.strokeStyle = 'rgba(70,56,32,0.35)'; g.lineWidth = 1;
      for (let x = -w / 2 + 8; x < w / 2 - 6; x += 6) {
        g.beginPath(); g.moveTo(x, by + 1); g.lineTo(x, by + (h - 14) / 2 - 1); g.stroke();
      }
      g.fillStyle = 'rgba(255,248,225,0.22)';
      g.fillRect(-w / 2 + 4, by, w - 8, 3);
    }
    // Muster square with crates.
    for (let i = 0; i < 4; i++) {
      plate(g, -w / 2 + 7 + i * 6, h / 2 - 11, 5, 5, '#7d6c47', '#98855a', '#584c33', 0.8);
    }
    teamFlash(g, w / 2 - 10, -h / 2 + 5, 5, h - 10, team);
  },

  motorpool(g, w, h, f, team, rng) {
    pad(g, w, h, rng);
    // Arched maintenance hangar.
    plate(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, PAL.metal0, PAL.metal1, PAL.metal2, 3);
    g.save(); rr(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 3); g.clip();
    g.strokeStyle = 'rgba(20,22,18,0.22)'; g.lineWidth = 1.4;
    for (let x = -w / 2 + 8; x < w / 2; x += 7) { g.beginPath(); g.moveTo(x, -h / 2); g.lineTo(x, h / 2); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, (h - 6) * 0.3);
    g.restore();
    // Roller door and the apron it opens onto.
    plate(g, w / 2 - 12, -h / 2 + 9, 9, h - 18, '#5c5a52', '#787469', '#3a3936', 1.5);
    g.strokeStyle = 'rgba(230,228,220,0.2)'; g.lineWidth = 0.9;
    for (let y = -h / 2 + 12; y < h / 2 - 10; y += 3.4) {
      g.beginPath(); g.moveTo(w / 2 - 11.4, y); g.lineTo(w / 2 - 3.6, y); g.stroke();
    }
    g.strokeStyle = 'rgba(226,194,106,0.5)'; g.lineWidth = 1.6; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(w / 2 - 2, 0); g.lineTo(w / 2 + 2, 0); g.stroke(); g.setLineDash([]);
    roofDetail(g, w, h, rng, { vents: 2, ac: false });
    teamFlash(g, -w / 2 + 7, -h / 2 + 6, w * 0.3, 4, team);
  },

  depot(g, w, h, f, team, rng) {
    pad(g, w, h, rng);
    plate(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, PAL.concrete2, PAL.concrete0, '#726d5d', 2.5);
    // Open-sided supply shed: pallets under a light roof.
    plate(g, -w / 2 + 6, -h / 2 + 6, w - 12, (h - 12) * 0.52, PAL.metal0, PAL.metal1, PAL.metal2, 2);
    const cols = ['#8f7c4f', '#7a6a43', '#a08a58'];
    for (let i = 0; i < 8; i++) {
      const x = -w / 2 + 8 + (i % 4) * ((w - 18) / 4);
      const y = h / 2 - 16 + ((i / 4) | 0) * 8;
      plate(g, x, y, (w - 22) / 4, 6.5, cols[i % 3], '#b9a271', '#5e5232', 0.8);
    }
    // Gantry crane rail.
    g.strokeStyle = 'rgba(40,42,36,0.6)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-w / 2 + 6, 2); g.lineTo(w / 2 - 6, 2); g.stroke();
    plate(g, -4, -1.5, 9, 7, '#b8792c', '#d69542', '#84551a', 1);
    teamFlash(g, -w / 2 + 6, h / 2 - 7, w * 0.35, 3.5, team);
  },

  generator(g, w, h, f, team, rng) {
    pad(g, w, h, rng);
    plate(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, PAL.metal2, PAL.metal0, '#3a3a37', 2.5);
    // Turbine housing with cooling fans.
    for (const sx of [-1, 1]) {
      dot(g, sx * w * 0.2, 0, Math.min(w, h) * 0.19, '#4a4a46');
      dot(g, sx * w * 0.2, 0, Math.min(w, h) * 0.15, '#6d6d67');
      g.strokeStyle = 'rgba(24,24,22,0.75)'; g.lineWidth = 1.3;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        g.beginPath();
        g.moveTo(sx * w * 0.2, 0);
        g.lineTo(sx * w * 0.2 + Math.cos(a) * Math.min(w, h) * 0.15, Math.sin(a) * Math.min(w, h) * 0.15);
        g.stroke();
      }
    }
    // Fuel bowser and warning stripes.
    plate(g, -w / 2 + 5, h / 2 - 11, w - 10, 6, '#9a5c2c', '#bb763d', '#6d3d18', 2);
    g.save(); rr(g, -w / 2 + 5, h / 2 - 11, w - 10, 6, 2); g.clip();
    g.strokeStyle = 'rgba(240,220,140,0.45)'; g.lineWidth = 2.4;
    for (let x = -w / 2; x < w / 2 + 10; x += 6) {
      g.beginPath(); g.moveTo(x, h / 2 - 12); g.lineTo(x - 7, h / 2 - 4); g.stroke();
    }
    g.restore();
    teamFlash(g, -w / 2 + 5, -h / 2 + 5, 4, h - 10, team);
  },

  comms(g, w, h, f, team, rng) {
    pad(g, w, h, rng);
    plate(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, PAL.concrete0, PAL.concrete1, PAL.concrete2, 2.5);
    // Parabolic dish, seen at an angle from above.
    const R = Math.min(w, h) * 0.28;
    g.save(); g.translate(-w * 0.08, 0);
    dot(g, 0, 0, R, '#d5d0c0');
    dot(g, 0, 0, R * 0.96, '#e8e4d6');
    g.strokeStyle = 'rgba(40,42,36,0.45)'; g.lineWidth = 0.9;
    for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(0, 0, R * (k / 4), 0, TAU); g.stroke(); }
    g.strokeStyle = 'rgba(30,32,26,0.8)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(R * 0.75, -R * 0.55); g.stroke();
    dot(g, R * 0.75, -R * 0.55, 2.2, '#6f6a5c');
    g.restore();
    // Mast farm.
    antenna(g, w / 2 - 10, h / 2 - 8, 20, rng);
    antenna(g, w / 2 - 16, h / 2 - 12, 14, rng);
    plate(g, w / 2 - 13, -h / 2 + 7, 9, 10, PAL.metal2, PAL.metal0, '#3a3a37', 1.2);
    teamFlash(g, -w / 2 + 6, h / 2 - 8, w * 0.3, 3.5, team);
  },

  mgnest(g, w, h, f, team, rng) {
    pad(g, w, h, rng, 1);
    sandbagRing(g, w / 2 - 5, h / 2 - 5, rng, 16);
    dot(g, 0, 0, Math.min(w, h) * 0.24, '#6d6248');
    dot(g, 0, 0, Math.min(w, h) * 0.19, '#867a59');
    teamFlash(g, -w / 2 + 5, h / 2 - 6, w - 10, 3, team);
  },

  atgun(g, w, h, f, team, rng) {
    pad(g, w, h, rng, 1);
    // Revetment: an earth berm open to the front.
    g.save();
    g.beginPath();
    g.arc(0, 0, w / 2 - 2, Math.PI * 0.42, Math.PI * 1.58);
    g.lineWidth = 7; g.strokeStyle = PAL.berm0; g.stroke();
    g.lineWidth = 4; g.strokeStyle = PAL.berm1; g.stroke();
    g.restore();
    dot(g, 0, 0, Math.min(w, h) * 0.2, '#5e5740');
    teamFlash(g, -w / 2 + 5, h / 2 - 6, w - 10, 3, team);
  },

  bunker(g, w, h, f, team, rng) {
    pad(g, w, h, rng, 1);
    plate(g, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, '#8d8571', '#a39b85', '#655f4f', 3);
    // Firing slits on all four faces.
    g.fillStyle = 'rgba(14,16,12,0.85)';
    g.fillRect(-w / 2 + 6, -h / 2 + 5, w - 12, 3);
    g.fillRect(-w / 2 + 6, h / 2 - 8, w - 12, 3);
    g.fillRect(-w / 2 + 5, -h / 2 + 6, 3, h - 12);
    g.fillRect(w / 2 - 8, -h / 2 + 6, 3, h - 12);
    plate(g, -w * 0.18, -h * 0.18, w * 0.36, h * 0.36, '#7d7663', '#948d78', '#585344', 2);
    sandbagRing(g, w / 2 - 2, h / 2 - 2, rng, 14);
    teamFlash(g, -w / 2 + 5, h / 2 - 5, w - 10, 3, team);
  },

  barrier(g, w, h, f, team, rng) {
    // Interlocking concrete T-wall section.
    plate(g, -w / 2 + 1, -h / 2 + 4, w - 2, h - 8, PAL.concrete0, PAL.concrete1, PAL.concrete2, 1.5);
    plate(g, -w / 2 + 4, -h / 2 + 1, w - 8, h - 2, PAL.concrete2, PAL.concrete0, '#6f6a5b', 1.5);
    g.strokeStyle = 'rgba(12,14,10,0.35)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-w / 2 + 4, 0); g.lineTo(w / 2 - 4, 0); g.stroke();
  },

  civil(g, w, h, f, team, rng) {
    // Flat-roofed mudbrick housing with a parapet and roof clutter.
    plate(g, -w / 2, -h / 2, w, h, PAL.mudbrick2, PAL.mudbrick0, '#7f6743', 2);
    plate(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, PAL.mudbrick0, PAL.mudbrick1, PAL.mudbrick2, 1.5);
    g.save(); rr(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 1.5); g.clip();
    speckle(g, -w / 2, -h / 2, w, h, rng, (w * h) / 30,
      ['rgba(255,240,210,0.10)', 'rgba(80,60,35,0.12)'], [1, 2.6]);
    g.restore();
    // Stairwell head, water tanks, satellite dish and a washing line.
    plate(g, -w / 2 + 7, -h / 2 + 7, 9, 9, PAL.mudbrick2, PAL.mudbrick0, '#7a6440', 1.2);
    for (let i = 0; i < 2; i++) {
      dot(g, w / 2 - 10 - i * 8, h / 2 - 10, 3.4, '#4e6b74');
      dot(g, w / 2 - 10 - i * 8, h / 2 - 10, 2.6, '#6b8e96');
    }
    g.strokeStyle = 'rgba(60,48,32,0.45)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-w / 2 + 6, h / 2 - 7); g.lineTo(w / 2 - 18, h / 2 - 13); g.stroke();
    for (let i = 0; i < 3; i++) {
      g.fillStyle = ['#b4483c', '#3d6ea0', '#d6c56b'][i];
      g.fillRect(-w / 2 + 10 + i * 7, h / 2 - 8 - i * 1.6, 3.4, 4.4);
    }
  },

  hall(g, w, h, f, team, rng) {
    plate(g, -w / 2, -h / 2, w, h, PAL.mudbrick2, PAL.mudbrick0, '#7a6440', 2.5);
    plate(g, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, PAL.concrete0, PAL.concrete1, PAL.concrete2, 2);
    // Small central dome over a courtyard.
    const R = Math.min(w, h) * 0.21;
    dot(g, 0, 0, R + 3, '#8e8877');
    dot(g, 0, 0, R, '#3f7f86');
    dot(g, -R * 0.25, -R * 0.25, R * 0.62, '#5ea0a6');
    g.strokeStyle = 'rgba(20,40,42,0.35)'; g.lineWidth = 0.9;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * R, Math.sin(a) * R); g.stroke();
    }
    dot(g, 0, 0, 1.8, '#d9c988');
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      plate(g, sx * (w / 2 - 11) - 4, sy * (h / 2 - 11) - 4, 8, 8, PAL.mudbrick0, PAL.mudbrick1, PAL.mudbrick2, 1.2);
    }
  },

  fuel(g, w, h, f, team, rng) {
    pad(g, w, h, rng, 1);
    // Two horizontal storage tanks with a pipe manifold between them.
    for (let i = 0; i < 2; i++) {
      const y = -h / 4 + i * (h / 2) - 1;
      plate(g, -w / 2 + 6, y - h * 0.11, w - 12, h * 0.22, '#9aa09a', '#b6bcb4', '#6f746e', h * 0.11);
      g.strokeStyle = 'rgba(30,34,30,0.4)'; g.lineWidth = 0.9;
      for (let x = -w / 2 + 12; x < w / 2 - 8; x += 7) {
        g.beginPath(); g.moveTo(x, y - h * 0.1); g.lineTo(x, y + h * 0.1); g.stroke();
      }
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(-w / 2 + 7, y - h * 0.1, w - 14, 2);
    }
    g.strokeStyle = '#77716a'; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(-w / 2 + 3, 0); g.lineTo(w / 2 - 3, 0); g.stroke();
    dot(g, 0, 0, 3, '#b0662f');
    // Flammable placard.
    plate(g, w / 2 - 12, -h / 2 + 3, 8, 6, '#c03a28', '#dd5a44', '#83220f', 1);
  },

  ruinedDepot(g, w, h, f, team, rng) {
    STRUCT.depot(g, w, h, f, 'rgba(120,120,110,0.6)', rng);
    // Weathering: collapsed roof panels and scorch.
    g.save(); rr(g, -w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 3); g.clip();
    g.fillStyle = 'rgba(30,26,20,0.30)';
    for (let i = 0; i < 9; i++) {
      const x = -w / 2 + rng() * w, y = -h / 2 + rng() * h;
      g.beginPath(); g.ellipse(x, y, rng.range(3, 9), rng.range(2, 6), rng() * TAU, 0, TAU); g.fill();
    }
    g.fillStyle = 'rgba(90,84,72,0.55)';
    for (let i = 0; i < 14; i++) {
      g.save();
      g.translate(-w / 2 + rng() * w, -h / 2 + rng() * h);
      g.rotate(rng() * TAU);
      g.fillRect(-2.5, -1.2, 5, 2.4);
      g.restore();
    }
    g.restore();
  },
};

const STRUCT_STYLE = {
  command_post: 'hq', rg_command: 'hq',
  barracks: 'barracks', rg_barracks: 'barracks',
  motor_pool: 'motorpool', rg_motor_pool: 'motorpool',
  supply_depot: 'depot',
  generator: 'generator', rg_generator: 'generator',
  comm_center: 'comms',
  mg_nest: 'mgnest', bunker: 'bunker',
  at_gun: 'atgun', rg_at_gun: 'atgun',
  barrier: 'barrier',
  civil_block: 'civil', civil_hall: 'hall',
  fuel_depot: 'fuel', abandoned_depot: 'ruinedDepot',
};

// Defensive emplacements get a rotating weapon mount.
function nestTurret(g, kind, team) {
  if (kind === 'at') {
    barrel(g, 24, 3);
    plate(g, -7, -5, 11, 10, '#6f6852', '#8a8266', '#474231', 2);
    plate(g, -9, -7, 4, 14, '#5c5643', '#767059', '#3a362a', 1.4);
    dot(g, -2, 0, 2.4, '#4c4839');
  } else {
    barrel(g, 15, 2, false);
    plate(g, -6, -4, 9, 8, '#5e5844', '#787159', '#3b3729', 1.8);
    plate(g, -2, -5.5, 5, 2.4, '#4a4636', '#615c48', '#2e2b21', 0.8);
    dot(g, -1.5, 0, 2, '#6f6852');
  }
}

// ---------------------------------------------------------------------------
export function buildUnitArt() {
  const out = {};
  for (const [id, d] of Object.entries(UNITS)) {
    const rng = makeRng(id.split('').reduce((a, c) => a + c.charCodeAt(0), 7));
    const team = PAL.team[d.faction === FACTION.RG ? 1 : 0];
    const rec = { def: d, infantry: false };
    switch (id) {
      case 'mbt': case 'asad_mbt':
        rec.hull = sprite(56, 34, (g) => mbtHull(g, d.faction, team, rng));
        rec.turret = sprite(56, 26, (g) => mbtTurret(g, d.faction, team, rng));
        rec.turretOffset = -2;
        break;
      case 'ifv': case 'saqr_ifv':
        rec.hull = sprite(48, 30, (g) => ifvHull(g, d.faction, team, rng));
        rec.turret = sprite(44, 22, (g) => ifvTurret(g, d.faction, team, rng));
        rec.turretOffset = -1;
        break;
      case 'humvee':
        rec.hull = sprite(38, 24, (g) => humveeHull(g, d.faction, team, rng));
        break;
      case 'technical':
        rec.hull = sprite(36, 22, (g) => technicalHull(g, d.faction, team, rng));
        break;
      case 'supply_truck':
        rec.hull = sprite(44, 26, (g) => truckHull(g, d.faction, team, rng));
        break;
      case 'aa_track':
        rec.hull = sprite(42, 28, (g) => aaHull(g, d.faction, team, rng));
        rec.turret = sprite(40, 20, (g) => aaTurret(g, d.faction, team, rng));
        rec.turretOffset = -1;
        break;
      default: {
        // Infantry: two walk frames.
        const kind = id === 'at_team' || id === 'rpg_team' ? 'at'
          : id === 'engineer' ? 'engineer' : 'rifle';
        rec.infantry = true;
        rec.frames = [0, 1].map((fr) => sprite(22, 18, (g) => soldier(g, d.faction, team, kind, fr, rng)));
        rec.hull = rec.frames[0];
        break;
      }
    }
    out[id] = rec;
  }
  return out;
}

export function buildBuildingArt() {
  const out = {};
  for (const [id, d] of Object.entries(BUILDINGS)) {
    const rng = makeRng(id.split('').reduce((a, c) => a + c.charCodeAt(0) * 7, 31));
    const team = d.faction === FACTION.RG ? PAL.team[1]
      : d.faction === FACTION.CIV ? 'rgba(190,185,170,0.7)' : PAL.team[0];
    const w = d.size[0] * TILE, h = d.size[1] * TILE;
    const style = STRUCT_STYLE[id] || 'civil';
    const rec = {
      def: d, w, h,
      body: sprite(w + 10, h + 10, (g) => STRUCT[style](g, w, h, d.faction, team, rng)),
    };
    if (d.defensive) {
      const kind = d.weapon && d.weapon.damage > 40 ? 'at' : 'mg';
      rec.turret = sprite(56, 24, (g) => nestTurret(g, kind, team));
    }
    out[id] = rec;
  }
  return out;
}

// --- HUD icons --------------------------------------------------------------
// Small, flat, high-contrast glyphs. These have to read at 44 px on a phone.
export function buildIcons() {
  const S = 48;
  const mk = (fn) => sprite(S, S, fn);
  const bg = (g, c0 = '#414d33', c1 = '#232b1a') => {
    rr(g, -S / 2 + 2, -S / 2 + 2, S - 4, S - 4, 5);
    const grd = g.createLinearGradient(0, -S / 2, 0, S / 2);
    grd.addColorStop(0, c0); grd.addColorStop(1, c1);
    g.fillStyle = grd; g.fill();
    // A hairline inner highlight lifts the glyph off the plate.
    rr(g, -S / 2 + 2.5, -S / 2 + 2.5, S - 5, S - 5, 4);
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    g.stroke();
  };
  const icons = {};

  const vehicleGlyph = (g, kind) => {
    g.save(); g.rotate(-Math.PI / 2); g.scale(0.80, 0.80);
    const rng = makeRng(4);
    if (kind === 'mbt') { mbtHull(g, FACTION.CTF, PAL.team[0], rng); mbtTurret(g, FACTION.CTF, PAL.team[0], rng); }
    else if (kind === 'ifv') { ifvHull(g, FACTION.CTF, PAL.team[0], rng); ifvTurret(g, FACTION.CTF, PAL.team[0], rng); }
    else if (kind === 'humvee') humveeHull(g, FACTION.CTF, PAL.team[0], rng);
    else if (kind === 'truck') truckHull(g, FACTION.CTF, PAL.team[0], rng);
    g.restore();
  };

  icons.rifle_squad = mk((g) => { bg(g); g.save(); g.rotate(-Math.PI / 2); g.scale(1.75, 1.75); soldier(g, FACTION.CTF, PAL.team[0], 'rifle', 0, makeRng(2)); g.restore(); });
  icons.at_team = mk((g) => { bg(g); g.save(); g.rotate(-Math.PI / 2); g.scale(1.75, 1.75); soldier(g, FACTION.CTF, PAL.team[0], 'at', 0, makeRng(3)); g.restore(); });
  icons.engineer = mk((g) => { bg(g); g.save(); g.rotate(-Math.PI / 2); g.scale(1.75, 1.75); soldier(g, FACTION.CTF, PAL.team[0], 'engineer', 0, makeRng(4)); g.restore(); });
  icons.humvee = mk((g) => { bg(g); vehicleGlyph(g, 'humvee'); });
  icons.ifv = mk((g) => { bg(g); vehicleGlyph(g, 'ifv'); });
  icons.mbt = mk((g) => { bg(g); vehicleGlyph(g, 'mbt'); });
  icons.supply_truck = mk((g) => { bg(g); vehicleGlyph(g, 'truck'); });

  const structGlyph = (style, w = 34, h = 28) => mk((g) => {
    bg(g, '#44503a', '#242c1c');
    g.save(); g.scale(0.86, 0.86);
    STRUCT[style](g, w, h, FACTION.CTF, PAL.team[0], makeRng(9));
    g.restore();
  });
  icons.command_post = structGlyph('hq', 36, 32);
  icons.generator = structGlyph('generator', 30, 26);
  icons.supply_depot = structGlyph('depot', 34, 30);
  icons.barracks = structGlyph('barracks', 34, 30);
  icons.motor_pool = structGlyph('motorpool', 38, 28);
  icons.comm_center = structGlyph('comms', 34, 30);
  icons.mg_nest = structGlyph('mgnest', 26, 26);
  icons.at_gun = structGlyph('atgun', 28, 28);
  icons.barrier = structGlyph('barrier', 30, 14);

  // Command / ability glyphs.
  const stroke = (g, c = PAL.hudText, w = 3) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; };
  icons.attack = mk((g) => {
    bg(g, '#3a2620', '#231512'); stroke(g, '#f0c4a8', 3);
    g.beginPath(); g.arc(0, 0, 11, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(-16, 0); g.lineTo(-6, 0); g.moveTo(6, 0); g.lineTo(16, 0);
    g.moveTo(0, -16); g.lineTo(0, -6); g.moveTo(0, 6); g.lineTo(0, 16); g.stroke();
    dot(g, 0, 0, 3, '#e0704f');
  });
  icons.move = mk((g) => {
    bg(g); stroke(g, PAL.hudText, 3);
    g.beginPath(); g.moveTo(-12, 10); g.lineTo(2, -10); g.stroke();
    g.beginPath(); g.moveTo(2, -10); g.lineTo(-4, -8); g.lineTo(0, -3); g.closePath();
    g.fillStyle = PAL.hudText; g.fill();
    g.beginPath(); g.arc(8, 8, 4, 0, TAU); g.stroke();
  });
  icons.stop = mk((g) => {
    bg(g); g.fillStyle = '#e0b24f';
    poly(g, [[-6, -13], [6, -13], [13, -6], [13, 6], [6, 13], [-6, 13], [-13, 6], [-13, -6]]);
    g.fill(); g.strokeStyle = '#1a1d14'; g.lineWidth = 2; g.stroke();
  });
  icons.hold = mk((g) => {
    bg(g); stroke(g, PAL.hudText, 3);
    g.beginPath(); g.moveTo(0, -13); g.lineTo(11, -7); g.lineTo(11, 4); g.lineTo(0, 13);
    g.lineTo(-11, 4); g.lineTo(-11, -7); g.closePath();
    g.fillStyle = 'rgba(215,224,194,0.18)'; g.fill(); g.stroke();
  });
  icons.garrison = mk((g) => {
    bg(g); stroke(g, PAL.hudText, 2.6);
    g.strokeRect(-11, -6, 22, 17);
    g.beginPath(); g.moveTo(-14, -6); g.lineTo(0, -15); g.lineTo(14, -6); g.stroke();
    g.fillStyle = PAL.hudGold; g.fillRect(-3, 2, 6, 9);
  });
  icons.air = mk((g) => {
    bg(g, '#22303a', '#141d24'); g.fillStyle = '#a8d0e8';
    poly(g, [[14, 0], [-4, -5], [-10, -14], [-6, -14], [0, -6], [-10, -3], [-14, -7], [-15, -2],
             [-15, 2], [-14, 7], [-10, 3], [0, 6], [-6, 14], [-10, 14], [-4, 5]]);
    g.fill();
    g.strokeStyle = '#16202a'; g.lineWidth = 1.4; g.stroke();
  });
  icons.eye = mk((g) => {
    bg(g, '#22303a', '#141d24'); stroke(g, '#a8d0e8', 2.6);
    g.beginPath(); g.moveTo(-15, 0); g.quadraticCurveTo(0, -12, 15, 0);
    g.quadraticCurveTo(0, 12, -15, 0); g.stroke();
    dot(g, 0, 0, 5, '#a8d0e8'); dot(g, 0, 0, 2.4, '#16202a');
  });
  icons.capture = mk((g) => {
    bg(g); stroke(g, PAL.hudGold, 3);
    g.beginPath(); g.moveTo(-8, 14); g.lineTo(-8, -14); g.stroke();
    g.fillStyle = PAL.hudGold;
    poly(g, [[-8, -14], [12, -9], [-8, -4]]); g.fill();
  });
  icons.repair = mk((g) => {
    bg(g); stroke(g, PAL.good, 3.4);
    g.beginPath(); g.moveTo(-5, -12); g.lineTo(5, -12); g.lineTo(5, -3); g.lineTo(14, -3);
    g.lineTo(14, 6); g.lineTo(5, 6); g.lineTo(5, 14); g.lineTo(-5, 14); g.lineTo(-5, 6);
    g.lineTo(-14, 6); g.lineTo(-14, -3); g.lineTo(-5, -3); g.closePath();
    g.fillStyle = 'rgba(168,211,106,0.25)'; g.fill(); g.stroke();
  });
  icons.sell = mk((g) => {
    bg(g, '#3a3020', '#231c12'); g.fillStyle = PAL.hudGold;
    g.font = 'bold 26px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('$', 0, 1);
  });
  icons.unload = mk((g) => {
    bg(g); stroke(g, PAL.hudText, 3);
    g.beginPath(); g.moveTo(0, -13); g.lineTo(0, 7); g.stroke();
    g.beginPath(); g.moveTo(-7, 0); g.lineTo(0, 8); g.lineTo(7, 0); g.closePath();
    g.fillStyle = PAL.hudText; g.fill();
    g.beginPath(); g.moveTo(-13, 13); g.lineTo(13, 13); g.stroke();
  });
  return icons;
}

export function buildArt() {
  return { units: buildUnitArt(), buildings: buildBuildingArt(), icons: buildIcons() };
}
