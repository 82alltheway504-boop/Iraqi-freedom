// Proves the single-file build really is self-contained: it must run from a
// file:// URL with no server, make zero network requests, and accept the same
// touch gestures as the full build.
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const FILE = 'file://' + (process.env.BUNDLE || '/home/user/Iraqi-freedom/dist/task-force-talon.html');
let fails = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent,
});
const page = await ctx.newPage();
const errs = [], external = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('request', (r) => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:')) external.push(r.url()); });

await page.goto(FILE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
check('opens straight from the filesystem', await page.evaluate(() => !!document.getElementById('btnStart')));
check('makes no network requests at all', external.length === 0, external[0] || 'fully offline');

await page.click('#btnStart');
await page.waitForTimeout(2000);
const r = await page.evaluate(() => ({
  running: window.game.running, units: window.game.world.units.length,
  buildings: window.game.world.buildings.length, fps: window.game._lastFps,
  sprites: Object.keys(window.game.art.units).length,
  audio: window.game.audio.ready, music: window.game.music.playing,
}));
check('game boots', r.running && r.units > 0, `${r.units} units, ${r.buildings} buildings, ${r.fps} fps`);
check('procedural sprites generated', r.sprites >= 20, `${r.sprites} unit sprite sets`);
check('audio and score running', r.audio && r.music);

// Same gestures as the served build.
const pos = await page.evaluate(() => {
  const g = window.game;
  const u = g.world.unitsOf(0).find((u) => u.defId === 'humvee');
  g.camera.centerOn(u.x, u.y); g.camera.zoom = 1;
  const s = g.camera.worldToScreen(u.x, u.y);
  return { sx: s.x, sy: s.y, id: u.id };
});
await page.touchscreen.tap(pos.sx, pos.sy);
await page.waitForTimeout(250);
check('tap selects', (await page.evaluate(() => window.game.selection.size)) === 1);
await page.touchscreen.tap(pos.sx + 150, pos.sy + 50);
await page.waitForTimeout(350);
check('tap orders a move',
  await page.evaluate((id) => !!window.game.world.entityById(id).path, pos.id));

// Exercise the turn loop to be sure bundling did not break the simulation.
const prog = await page.evaluate(async () => {
  const g = window.game, w = g.world;
  const u = w.unitsOf(0).find(x => x.category === 'vehicle');
  const apBefore = u.ap;
  const W = w.grid.w;
  let pick = null, best = -1;
  for (const [idx, n] of w.reachable(u)) {
    if (n.ap > best && !w.occupantAt(idx % W, (idx / W) | 0, u)) { best = n.ap; pick = idx; }
  }
  const moved = w.moveUnit(u, pick % W, (pick / W) | 0);
  for (const x of w.units) if (x.moving) x.finishMove(w);
  // Read the spent points before ending the turn: the next turn start refills
  // them, so a later read would always show a full bar.
  const apAfter = u.ap;
  const turnBefore = g.turns.turn;
  document.getElementById('btnEndTurn').click();
  await new Promise(r => setTimeout(r, 3200));
  return {
    moveOk: moved.ok, apBefore, apAfter,
    turnBefore, turnAfter: g.turns.turn, playerTurn: g.turns.isPlayerTurn,
  };
});
check('action points are spent on movement', prog.moveOk && prog.apAfter < prog.apBefore,
  `${prog.apBefore} -> ${prog.apAfter} AP`);
check('the turn cycle completes offline',
  prog.turnAfter === prog.turnBefore + 1 && prog.playerTurn,
  `turn ${prog.turnBefore} -> ${prog.turnAfter}`);

check('no errors', errs.length === 0, errs[0] || '');
await browser.close();
console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nSINGLE FILE IS FULLY SELF-CONTAINED');
process.exit(fails ? 1 : 0);
