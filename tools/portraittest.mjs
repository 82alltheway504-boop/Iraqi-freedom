// Portrait and small-frame playability. The orientation nudge must be
// dismissible, and once dismissed the game has to be genuinely operable —
// nothing off screen, nothing overlapping, taps still issuing orders.
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const URL = process.env.GAME_URL || 'http://localhost:8080/';
let fails = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

const CASES = [
  { name: 'iPhone 14 Pro portrait', w: 393, h: 852, dpr: 3 },
  { name: 'iPhone SE portrait', w: 375, h: 667, dpr: 2 },
  { name: 'small embedded frame', w: 420, h: 620, dpr: 2 },
];

for (const c of CASES) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr,
    isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // The nudge should be up, and it must be dismissible.
  const shown = await page.evaluate(() =>
    getComputedStyle(document.getElementById('rotate')).display !== 'none');
  check(`${c.name}: nudge appears`, shown);
  await page.click('#btnPortrait');
  await page.waitForTimeout(300);
  const gone = await page.evaluate(() =>
    getComputedStyle(document.getElementById('rotate')).display === 'none');
  check(`${c.name}: nudge dismisses`, gone);

  await page.click('#btnStart');
  await page.waitForTimeout(1600);

  const r = await page.evaluate(() => {
    const g = window.game;
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    const rail = box('rail'), bottom = box('bottom'), mm = box('minimapWrap'), obj = box('objectives');
    const W = window.innerWidth, H = window.innerHeight;
    const inside = (b) => b.left >= -1 && b.top >= -1 && b.right <= W + 1 && b.bottom <= H + 1;
    const overlaps = (a, b) =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    return {
      running: g.running, units: g.world.units.length, fps: g._lastFps,
      zoom: +g.camera.zoom.toFixed(2),
      visibleTiles: Math.round(W / g.camera.zoom / 32),
      railInside: inside(rail), bottomInside: inside(bottom),
      mmInside: inside(mm), objInside: inside(obj),
      objOverMinimap: overlaps(obj, mm),
      bottomOverRail: overlaps(bottom, rail),
      scrolls: document.documentElement.scrollWidth > W + 1 ||
               document.documentElement.scrollHeight > H + 1,
      paletteCards: document.querySelectorAll('#palette .card').length,
      menuInside: inside(box('btnMenu')),
      soundInside: inside(box('btnSound')),
      topbarOverflows: document.getElementById('topbar').scrollWidth >
                       document.getElementById('topbar').clientWidth + 1,
      objCollapsed: document.getElementById('objectives').classList.contains('collapsed'),
      objHeight: Math.round(obj.height),
    };
  });
  check(`${c.name}: game runs`, r.running && r.units > 0, `${r.fps} fps, zoom ${r.zoom}, ~${r.visibleTiles} tiles wide`);
  check(`${c.name}: all panels on screen`,
    r.railInside && r.bottomInside && r.mmInside && r.objInside,
    `rail:${r.railInside} bottom:${r.bottomInside} minimap:${r.mmInside} obj:${r.objInside}`);
  check(`${c.name}: nothing overlaps`, !r.objOverMinimap && !r.bottomOverRail,
    r.objOverMinimap ? 'objectives over minimap' : r.bottomOverRail ? 'order bar over rail' : '');
  check(`${c.name}: page does not scroll`, !r.scrolls);
  check(`${c.name}: palette usable`, r.paletteCards > 0, `${r.paletteCards} cards`);
  check(`${c.name}: top bar fits`, r.menuInside && r.soundInside && !r.topbarOverflows,
    `menu:${r.menuInside} sound:${r.soundInside} overflow:${r.topbarOverflows}`);
  check(`${c.name}: objectives start folded`, r.objCollapsed && r.objHeight < 60,
    `${r.objHeight}px tall`);

  // A tap must still give an order.
  const pos = await page.evaluate(() => {
    const g = window.game;
    const u = g.world.unitsOf(0).find((x) => x.defId === 'humvee');
    g.camera.centerOn(u.x, u.y);
    const s = g.camera.worldToScreen(u.x, u.y);
    return { sx: s.x, sy: s.y, id: u.id };
  });
  await page.touchscreen.tap(pos.sx, pos.sy);
  await page.waitForTimeout(250);
  const selected = await page.evaluate(() => window.game.selection.size);
  await page.touchscreen.tap(pos.sx, pos.sy - 90);
  await page.waitForTimeout(350);
  const ordered = await page.evaluate((id) => {
    const u = window.game.world.entityById(id);
    return !!u && !!u.path;
  }, pos.id);
  check(`${c.name}: tap selects and orders`, selected === 1 && ordered,
    `selected ${selected}, ordered ${ordered}`);
  check(`${c.name}: no errors`, errs.length === 0, errs[0] || '');
  await ctx.close();
  console.log('');
}

await browser.close();
console.log(fails ? `${fails} CHECK(S) FAILED` : 'PORTRAIT AND SMALL FRAMES ARE PLAYABLE');
process.exit(fails ? 1 : 0);
