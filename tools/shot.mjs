// Drives the real turn-based game in Chromium at iPhone dimensions and
// captures each stage, so the interface can actually be looked at.
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const OUT = process.env.SHOT_DIR || '/tmp/shots';
// Three of these stages are the images the README shows, so they are also
// written as JPEGs into the repository.
const DOCS = process.env.DOC_SHOT_DIR || 'docs/shots';
const URL = process.env.GAME_URL || 'http://localhost:8080/';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent,
});
const page = await ctx.newPage();
const doc = (name) => page.screenshot({ path: `${DOCS}/${name}.jpg`, type: 'jpeg', quality: 80 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/t1-briefing.png` });
await doc('briefing');

await page.click('#btnStart');
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/t2-turn1.png` });

// Select an infantry unit: the reachable tiles should light up.
const sel = await page.evaluate(() => {
  const g = window.game;
  const u = g.world.unitsOf(0).find((x) => x.defId === 'rifle_squad');
  g.select([u], false);
  g.camera.centerOn(u.x, u.y);
  g.camera.zoom = 1.0;
  return { id: u.id, overlay: g.renderer.moveOverlay ? g.renderer.moveOverlay.size : 0, ap: u.ap };
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/t3-move-overlay.png` });

// Move it, then look at the spent action points.
await page.evaluate(() => {
  const g = window.game;
  const u = g.world.entityById([...g.selection][0]);
  const W = g.world.grid.w;
  let far = null, best = -1;
  for (const [idx, n] of g.renderer.moveOverlay) if (n.ap > best) { best = n.ap; far = idx; }
  g.world.moveUnit(u, far % W, (far / W) | 0);
  for (const x of g.world.units) if (x.moving) x.finishMove(g.world);
  g._refreshOverlays();
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/t4-after-move.png` });

// A firefight: put a Guard squad next to ours and shoot it.
await page.evaluate(() => {
  const g = window.game, w = g.world, T = (t) => t * 32 + 16;
  const u = w.unitsOf(0).find((x) => x.defId === 'rifle_squad');
  const tx = Math.floor(u.x / 32) + 3, ty = Math.floor(u.y / 32);
  w.spawnUnit('militia', 1, T(tx), T(ty), Math.PI);
  w.spawnUnit('asad_mbt', 1, T(tx + 2), T(ty + 2), Math.PI);
  u.ap = u.apMax;
  g.select([u], false);
  g.camera.centerOn(u.x + 40, u.y);
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/t5-targets.png` });
await page.evaluate(() => {
  const g = window.game;
  const u = g.world.entityById([...g.selection][0]);
  const t = g.world.attackableTargets(u)[0];
  if (t) g.world.attack(u, t);
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/t6-attack.png` });
await doc('battle');

// The works tab, with a placement ghost.
await page.evaluate(() => {
  const g = window.game, w = g.world;
  w.human.res = { fuel: 900, water: 900, oil: 900 };
  w.placeBuilding('command_post', 0, 15, 45);
  g.camera.centerOn(17 * 32, 47 * 32);
  g.camera.zoom = 0.9;
  for (const b of document.querySelectorAll('#tabs button')) {
    if (b.dataset.tab === 'structure') b.click();
  }
});
await page.waitForTimeout(500);
await page.evaluate(() => window.game.paletteClick('building', 'gun_tower'));
await page.mouse.move(380, 200);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/t7-build.png` });
await doc('base');

// Air: a helicopter and a jet over the map.
await page.evaluate(() => {
  const g = window.game, w = g.world, T = (t) => t * 32 + 16;
  g.cancelPlacement();
  const h = w.spawnUnit('helicopter', 0, T(20), T(46));
  w.spawnUnit('jet', 0, T(24), T(44));
  w.spawnUnit('aa_vehicle', 0, T(18), T(48));
  w.spawnUnit('mortar_team', 0, T(17), T(44));
  g.select([h], false);
  g.camera.centerOn(T(21), T(46));
  g.camera.zoom = 1.0;
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/t8-air.png` });

// Commander sheet.
await page.evaluate(() => {
  window.game.commander.award(900, 'screenshot');
  window.game.showCommander();
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/t9-commander.png` });
await page.evaluate(() => window.game.closeOverlay());

// End the turn and let the Guard move.
await page.click('#btnEndTurn');
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/t10-guard-turn.png` });
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/t11-back-to-player.png` });

const stats = await page.evaluate(() => {
  const g = window.game;
  return {
    turn: g.turns.turn, playerTurn: g.turns.isPlayerTurn, busy: g.busy,
    units: g.world.units.length, fps: g._lastFps,
    res: g.world.human.res, overlay: sel => 0,
    commanderRank: g.commander.rankName, points: g.commander.availablePoints,
  };
});
console.log('move overlay tiles on select:', sel.overlay, '| unit AP:', sel.ap);
console.log(JSON.stringify(stats, null, 2));
console.log(errors.length ? '\nERRORS:\n' + errors.slice(0, 6).join('\n') : '\nNo console errors.');
await browser.close();
process.exit(errors.length ? 1 : 0);
