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
check('procedural sprites generated', r.sprites === 13, `${r.sprites} unit sprite sets`);
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

// Play a stretch of the mission to be sure the bundling did not break the sim.
await page.evaluate(() => {
  const g = window.game;
  g.world.issueMove(g.world.unitsOf(0), 31 * 32, 52 * 32, true);
});
await page.waitForTimeout(9000);
const prog = await page.evaluate(() => ({
  objective: window.game.mission.obj('recon').state,
  time: Math.round(window.game.mission.time),
  reinforced: window.game.mission.reinforced,
}));
check('mission logic advances', prog.objective === 'done' && prog.reinforced,
  `recon ${prog.objective} at ${prog.time}s`);

check('no errors', errs.length === 0, errs[0] || '');
await browser.close();
console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nSINGLE FILE IS FULLY SELF-CONTAINED');
process.exit(fails ? 1 : 0);
