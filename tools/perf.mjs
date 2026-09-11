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

// Heavy load: two large forces meeting head-on in the middle of the map.
await page.evaluate(() => {
  const g = window.game, w = g.world;
  const T = (t) => t * 32 + 16;
  g.world.fog.revealAll();
  for (let i = 0; i < 45; i++) {
    w.spawnUnit(['mbt', 'ifv', 'rifle_squad', 'at_team', 'humvee'][i % 5], 0,
      T(34 + (i % 7)), T(40 + ((i / 7) | 0)));
  }
  for (let i = 0; i < 45; i++) {
    w.spawnUnit(['asad_mbt', 'saqr_ifv', 'militia', 'rpg_team', 'technical'][i % 5], 1,
      T(50 + (i % 7)), T(40 + ((i / 7) | 0)));
  }
  w.issueMove(w.unitsOf(0), T(54), T(42), true);
  w.issueMove(w.unitsOf(1), T(32), T(42), true);
  g.camera.centerOn(T(44), T(42));
  g.camera.zoom = 0.8;
});
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
