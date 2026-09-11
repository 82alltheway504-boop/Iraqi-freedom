// Cross-checks the things a single screenshot run cannot: several viewports,
// the portrait nudge, and that the service worker really does make the game
// playable with the network switched off.
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const URL = process.env.GAME_URL || 'http://localhost:8099/';
let fails = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

const VIEWPORTS = [
  { name: 'iPhone SE landscape', width: 667, height: 375, dpr: 2, touch: true },
  { name: 'iPhone 14 Pro landscape', width: 844, height: 390, dpr: 3, touch: true },
  { name: 'iPhone 14 Pro Max landscape', width: 932, height: 430, dpr: 3, touch: true },
  { name: 'iPad landscape', width: 1180, height: 820, dpr: 2, touch: true },
  { name: 'desktop', width: 1440, height: 900, dpr: 1, touch: false },
];

for (const v of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.dpr, isMobile: v.touch, hasTouch: v.touch,
    userAgent: v.touch ? devices['iPhone 13'].userAgent : undefined,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('#btnStart');
  await page.waitForTimeout(1800);
  const r = await page.evaluate(() => {
    const g = window.game;
    const rail = document.getElementById('rail').getBoundingClientRect();
    const bottom = document.getElementById('bottom').getBoundingClientRect();
    return {
      fps: g._lastFps,
      running: g.running,
      canvasW: g.canvas.width,
      // The order bar must never end up underneath the production rail.
      overlap: bottom.right > rail.left + 1,
      offscreen: rail.right > window.innerWidth + 1 || bottom.bottom > window.innerHeight + 1,
      hudVisible: !document.getElementById('hud').hidden,
      scrolled: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check(`${v.name}: runs`, r.running && r.hudVisible && !errs.length, errs[0] || `${r.fps} fps`);
  check(`${v.name}: layout fits`, !r.overlap && !r.offscreen && !r.scrolled,
    r.overlap ? 'order bar under the rail' : r.offscreen ? 'panel off screen' : r.scrolled ? 'page scrolls' : '');
  await ctx.close();
}

// Portrait: the game needs width, so it should ask for the device to be turned.
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  const shown = await page.evaluate(() =>
    getComputedStyle(document.getElementById('rotate')).display !== 'none');
  check('portrait shows the rotate nudge', shown);
  await ctx.close();
}

// Offline: load once to prime the service worker, then cut the network.
{
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);
  await ctx.setOffline(true);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const ok = await page.evaluate(() => !!document.getElementById('btnStart'));
  check('plays with the network switched off', ok && !errs.length, errs[0] || 'served from cache');
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL PLATFORM CHECKS PASSED');
process.exit(fails ? 1 : 0);
