// Measures real in-browser frame rate at iPhone dimensions under a heavy load,
// which is the only number that matters for "playable on a phone".
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const URL = process.env.GAME_URL || 'http://localhost:8099/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('#btnStart');
await page.waitForTimeout(1500);

const sample = async (label, seconds = 6) => {
  await page.waitForTimeout(seconds * 1000);
  const r = await page.evaluate(() => ({
    fps: window.game._lastFps,
    units: window.game.world.units.length,
    projectiles: window.game.world.projectiles.length,
    particles: window.game.world.fx.parts.filter((p) => p.life > 0).length,
  }));
  console.log(`${label.padEnd(34)} ${String(r.fps).padStart(3)} fps   ` +
    `${String(r.units).padStart(3)} units  ${String(r.projectiles).padStart(3)} shells  ` +
    `${String(r.particles).padStart(4)} particles`);
  return r;
};

const results = [];
results.push(await sample('opening force, quiet', 4));

// Heavy load: two large forces meeting head-on in the middle of the map, with
// every unit of the player's side spending its whole turn at once.
const marchOrders = () => {
  const g = window.game, w = g.world, T = (t) => t * 32 + 16;
  const goal = { x: T(44), y: T(42) };
  for (const u of w.unitsOf(0)) {
    for (const foe of w.attackableTargets(u)) { if (!w.attack(u, foe).ok) break; }
    if (!u.canAct) continue;
    const W = w.grid.w;
    let pick = null, bd = Infinity;
    for (const [idx] of w.reachable(u)) {
      const tx = idx % W, ty = (idx / W) | 0;
      if (w.occupantAt(tx, ty, u)) continue;
      const d = Math.hypot(T(tx) - goal.x, T(ty) - goal.y);
      if (d < bd) { bd = d; pick = [tx, ty]; }
    }
    if (pick) w.moveUnit(u, pick[0], pick[1]);
  }
};

await page.evaluate(() => {
  const g = window.game, w = g.world;
  const T = (t) => t * 32 + 16;
  w.fog.revealAll();
  for (let i = 0; i < 45; i++) {
    w.spawnUnit(['mbt', 'ifv', 'rifle_squad', 'at_team', 'humvee'][i % 5], 0,
      T(34 + (i % 7)), T(40 + ((i / 7) | 0)));
  }
  for (let i = 0; i < 45; i++) {
    w.spawnUnit(['asad_mbt', 'saqr_ifv', 'militia', 'rpg_team', 'technical'][i % 5], 1,
      T(50 + (i % 7)), T(40 + ((i / 7) | 0)));
  }
  for (const u of w.units) u.ap = u.apMax;
  g.ai.enabled = true;            // the mission holds it back until you deploy
  g.camera.centerOn(T(44), T(42));
  g.camera.zoom = 0.8;
});

// How long a whole side's turn takes to resolve is the number a turn-based
// game lives or dies by: it is the pause after the player taps END TURN.
const turnMs = await page.evaluate((fn) => {
  const march = new Function('return ' + fn)();
  const t0 = performance.now();
  march();
  const mine = performance.now() - t0;
  const t1 = performance.now();
  window.game.ai.takeTurn();
  return { mine: +mine.toFixed(1), guard: +(performance.now() - t1).toFixed(1) };
}, marchOrders.toString());
console.log(`90-unit side turn resolves in ${turnMs.mine} ms (player) / ` +
  `${turnMs.guard} ms (Guard)`);

results.push(await sample('~90-unit battle, zoom 0.8', 8));

await page.evaluate(() => { window.game.camera.zoom = 0.42; });
results.push(await sample('same battle, zoomed right out', 6));

await page.evaluate(() => { window.game.camera.zoom = 1.4; });
results.push(await sample('same battle, zoomed right in', 5));

const worst = Math.min(...results.map((r) => r.fps));
console.log(`\nworst sample: ${worst} fps`);
console.log('Note: headless Chromium rasterises Canvas2D in software (SwiftShader).');
console.log('A real phone composites the canvas on the GPU and runs far faster;');
console.log('treat these figures as a pessimistic floor, not a prediction.');
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
await browser.close();
process.exit(worst >= 25 && !errors.length ? 0 : 1);
