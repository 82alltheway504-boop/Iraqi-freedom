// Verifies the app is genuinely installable as a home-screen app, served from
// a subdirectory the way a GitHub Pages project site serves it. Checks the
// manifest the browser actually parsed, the service worker's registered scope,
// the icons iOS and Android need, and that it still runs with no network.
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const URL_BASE = process.env.GAME_URL || 'http://localhost:8123/Iraqi-freedom/';
let fails = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(URL_BASE, { waitUntil: 'networkidle' });

// --- the manifest, as the browser resolved it -----------------------------
const man = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return null;
  const res = await fetch(link.href);
  const j = await res.json();
  return { href: link.href, type: res.headers.get('content-type'), ...j };
});
check('manifest is linked and served', !!man, man ? man.type : 'missing');
check('manifest has a name and short name', !!man?.name && !!man?.short_name, man?.short_name);
check('start_url resolves inside the subpath',
  new URL(man.start_url, man.href).pathname.startsWith('/Iraqi-freedom/'),
  new URL(man.start_url, man.href).pathname);
check('scope resolves to the subpath',
  new URL(man.scope, man.href).pathname === '/Iraqi-freedom/',
  new URL(man.scope, man.href).pathname);
check('display mode is standalone or better',
  ['fullscreen', 'standalone'].includes(man.display), man.display);
check('theme and background colours set', !!man.theme_color && !!man.background_color);

// --- icons actually load ---------------------------------------------------
const icons = await page.evaluate(async (m) => {
  const out = [];
  for (const i of m.icons) {
    const u = new URL(i.src, m.href).href;
    const r = await fetch(u);
    out.push({ src: i.src, sizes: i.sizes, purpose: i.purpose, status: r.status,
               type: r.headers.get('content-type') });
  }
  const apple = document.querySelector('link[rel="apple-touch-icon"]');
  let appleStatus = null;
  if (apple) appleStatus = (await fetch(apple.href)).status;
  return { out, appleStatus, appleHref: apple?.href };
}, man);
for (const i of icons.out) check(`icon ${i.sizes} (${i.purpose}) loads`, i.status === 200, i.type);
check('maskable icon present', man.icons.some((i) => i.purpose === 'maskable'));
check('apple-touch-icon present and loads', icons.appleStatus === 200, icons.appleHref);
check('iOS fullscreen meta present',
  await page.evaluate(() => !!document.querySelector('meta[name="apple-mobile-web-app-capable"]')));

// --- service worker --------------------------------------------------------
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return { scope: reg.scope, active: !!reg.active, state: reg.active?.state };
});
check('service worker is active', sw.active && sw.state === 'activated', sw.state);
check('service worker scope covers the app', sw.scope.endsWith('/Iraqi-freedom/'), sw.scope);

// Give the precache time to finish, then confirm the whole app really cached.
await page.waitForTimeout(2500);
const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  if (!names.length) return { names, count: 0 };
  const c = await caches.open(names[0]);
  const keys = await c.keys();
  return { names, count: keys.length, sample: keys.slice(0, 3).map((r) => new URL(r.url).pathname) };
});
check('every asset precached', cached.count >= 36, `${cached.count} entries in ${cached.names[0]}`);

// --- it runs ---------------------------------------------------------------
await page.click('#btnStart');
await page.waitForTimeout(1800);
const running = await page.evaluate(() => ({
  running: window.game.running, fps: window.game._lastFps,
  units: window.game.world.units.length,
}));
check('game runs from the subpath', running.running && running.units > 0,
  `${running.fps} fps, ${running.units} units`);

// --- offline ---------------------------------------------------------------
await ctx.setOffline(true);
await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const offline = await page.evaluate(() => ({
  hasStart: !!document.getElementById('btnStart'),
  hasCanvas: !!document.getElementById('view'),
}));
check('loads with the network switched off', offline.hasStart && offline.hasCanvas);
await page.click('#btnStart');
await page.waitForTimeout(1500);
const offRun = await page.evaluate(() => ({
  running: window.game.running, units: window.game.world.units.length,
}));
check('plays offline', offRun.running && offRun.units > 0, `${offRun.units} units`);

check('no page errors', errs.length === 0, errs[0] || '');
await browser.close();
console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nINSTALLABLE AS A HOME-SCREEN APP');
process.exit(fails ? 1 : 0);
