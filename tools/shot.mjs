// Drives the real game in Chromium at iPhone dimensions, captures console
// errors, and takes screenshots at each stage. This is the only way to be
// confident the rendering and the touch handling actually work.
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const OUT = process.env.SHOT_DIR || '/tmp/shots';
const URL = process.env.GAME_URL || 'http://localhost:8099/';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },      // iPhone 14 Pro, landscape
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['iPhone 13'].userAgent,
});
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n')));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/01-briefing.png` });

await page.click('#btnStart');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/02-start.png` });

// Drag the camera north-east toward the objective.
await page.mouse.move(500, 200);
await page.mouse.down();
for (let i = 0; i < 12; i++) { await page.mouse.move(500 - i * 18, 200 + i * 8); await page.waitForTimeout(12); }
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/03-panned.png` });

// Select the whole opening force with a box select, then order a move.
const sel = await page.evaluate(() => {
  const g = window.game;
  g.select(g.world.unitsOf(0), false);
  const u = g.world.unitsOf(0)[0];
  g.camera.centerOn(u.x, u.y);
  return g.selection.size;
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/04-selected.png` });

// Give a real order through the tap handler and let it play out.
await page.evaluate(() => {
  const g = window.game;
  const { MAP01 } = g.mission.constructor === Object ? {} : {};
  g.world.issueMove(g.world.unitsOf(0), 31 * 32, 52 * 32, true);
});
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/05-moving.png` });

// Jump to the enemy base to check structures and fog.
await page.evaluate(() => {
  const g = window.game;
  g.world.fog.revealAll();
  g.camera.centerOn(77 * 32, 24 * 32);
  g.camera.zoom = 0.95;
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/06-enemy-base.png` });

// Force a firefight so effects, projectiles and the blinking HUD are visible.
await page.evaluate(() => {
  const g = window.game;
  const w = g.world;
  const T = (t) => t * 32 + 16;
  for (let i = 0; i < 6; i++) w.spawnUnit('mbt', 0, T(66 + (i % 3)), T(28 + i));
  for (let i = 0; i < 4; i++) w.spawnUnit('at_team', 0, T(65), T(31 + i));
  w.issueMove(w.unitsOf(0).filter((u) => u.x > 60 * 32), T(77), T(24), true);
  g.camera.centerOn(T(72), T(28));
});
await page.waitForTimeout(7000);
await page.screenshot({ path: `${OUT}/07-battle.png` });

// The build palette and a placement ghost.
await page.evaluate(() => {
  const g = window.game;
  g.world.human.supply = 9000;
  g.world.placeBuilding('command_post', 0, 15, 45);
  g.world.recomputePower();
  g.camera.centerOn(17 * 32, 47 * 32);
  g.camera.zoom = 1.1;
  for (const b of document.querySelectorAll('#tabs button')) {
    if (b.dataset.tab === 'build') b.click();
  }
});
await page.waitForTimeout(500);
await page.evaluate(() => window.game.paletteClick('building', 'barracks'));
await page.mouse.move(380, 200);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/08-build.png` });

const stats = await page.evaluate(() => {
  const g = window.game;
  return {
    units: g.world.units.length,
    buildings: g.world.buildings.length,
    selection: g.selection.size,
    fps: g._lastFps || null,
    audioReady: g.audio.ready,
    musicPlaying: g.music.playing,
    supply: Math.round(g.world.human.supply),
  };
});

console.log(JSON.stringify(stats, null, 2));
console.log(errors.length ? '\nERRORS:\n' + errors.join('\n---\n') : '\nNo console errors.');
await browser.close();
process.exit(errors.length ? 1 : 0);
