// Drives the real touch gestures against the running game: tap to select,
// tap to order, drag to pan, long press to attack-move, pinch to zoom, and
// a tap on the production palette. Synthetic pointer events cannot use
// pointer capture, which is why the input layer must never treat a failed
// setPointerCapture as fatal.
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
let fails = 0;
const check = (n, ok, d='') => { console.log(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); if(!ok) fails++; };
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport:{width:844,height:390}, deviceScaleFactor:2,
  isMobile:true, hasTouch:true, userAgent: devices['iPhone 13'].userAgent });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e=>errs.push(e.message));
await page.goto(process.env.GAME_URL || 'http://localhost:8099/', { waitUntil:'networkidle' });
await page.click('#btnStart');
await page.waitForTimeout(1200);

// Centre the camera on a known unit and work out where it is on screen.
const pos = await page.evaluate(() => {
  const g = window.game;
  const u = g.world.unitsOf(0).find(u => u.defId === 'humvee');
  g.camera.centerOn(u.x, u.y);
  g.camera.zoom = 1.0;
  const s = g.camera.worldToScreen(u.x, u.y);
  return { sx: s.x, sy: s.y, id: u.id };
});

// Tap the unit.
await page.touchscreen.tap(pos.sx, pos.sy);
await page.waitForTimeout(250);
let sel = await page.evaluate(() => [...window.game.selection]);
check('tap selects a unit', sel.length === 1 && sel[0] === pos.id, `selected ${sel.length}`);

// Tap open ground to order a move.
await page.touchscreen.tap(pos.sx + 150, pos.sy + 60);
await page.waitForTimeout(400);
let moved = await page.evaluate((id) => {
  const u = window.game.world.entityById(id);
  return { hasPath: !!u.path, order: u.order.type };
}, pos.id);
check('tap on ground issues a move order', moved.hasPath && moved.order === 'move', moved.order);

// Drag pans the camera and does not order a move.
const camBefore = await page.evaluate(() => ({ x: window.game.camera.x, y: window.game.camera.y }));
await page.touchscreen.tap(1, 1).catch(()=>{});
await page.evaluate(() => { window.game.camera.vx = 0; window.game.camera.vy = 0; });
const dragged = await page.evaluate(async () => {
  const el = document.getElementById('view');
  const send = (type, x, y) => el.dispatchEvent(new PointerEvent(type,
    { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  send('pointerdown', 420, 200);
  for (let i = 1; i <= 10; i++) { send('pointermove', 420 - i * 12, 200 + i * 5); await new Promise(r => setTimeout(r, 16)); }
  send('pointerup', 300, 250);
  await new Promise(r => setTimeout(r, 120));
  return { x: window.game.camera.x, y: window.game.camera.y };
});
check('drag pans the camera', Math.abs(dragged.x - camBefore.x) > 40, `moved ${Math.round(dragged.x - camBefore.x)} px`);

// Long press issues an attack-move.
await page.evaluate(() => { const g = window.game; g.select(g.world.unitsOf(0).slice(0, 3), false); });
const longPressed = await page.evaluate(async () => {
  const el = document.getElementById('view');
  const send = (type, x, y) => el.dispatchEvent(new PointerEvent(type,
    { pointerId: 9, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  send('pointerdown', 500, 220);
  await new Promise(r => setTimeout(r, 520));
  send('pointerup', 500, 220);
  await new Promise(r => setTimeout(r, 150));
  return window.game.world.unitsOf(0).filter(u => u.order.type === 'attackMove').length;
});
check('long press issues attack-move', longPressed >= 1, `${longPressed} units`);

// Pinch zooms.
const zoomed = await page.evaluate(async () => {
  const g = window.game; const before = g.camera.zoom;
  const el = document.getElementById('view');
  const send = (id, type, x, y) => el.dispatchEvent(new PointerEvent(type,
    { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  send(1, 'pointerdown', 380, 190); send(2, 'pointerdown', 460, 200);
  for (let i = 1; i <= 8; i++) {
    send(1, 'pointermove', 380 - i * 8, 190 - i * 3);
    send(2, 'pointermove', 460 + i * 8, 200 + i * 3);
    await new Promise(r => setTimeout(r, 16));
  }
  send(1, 'pointerup', 316, 166); send(2, 'pointerup', 524, 224);
  return { before, after: g.camera.zoom };
});
check('pinch zooms the camera', zoomed.after > zoomed.before * 1.1,
  `${zoomed.before.toFixed(2)} -> ${zoomed.after.toFixed(2)}`);

// The production palette responds to a tap.
const built = await page.evaluate(async () => {
  const g = window.game;
  g.world.human.supply = 5000;
  g.world.placeBuilding('command_post', 0, 15, 45);
  g.world.placeBuilding('barracks', 0, 20, 45);
  g.world.recomputePower();
  for (const b of document.querySelectorAll('#tabs button')) if (b.dataset.tab === 'units') b.click();
  await new Promise(r => setTimeout(r, 260));
  const card = document.querySelector('#palette .card:not(.disabled)');
  if (!card) return { clicked: false };
  card.click();
  await new Promise(r => setTimeout(r, 120));
  const queued = g.world.buildings.reduce((n, b) => n + (b.owner === 0 ? b.queue.length : 0), 0);
  return { clicked: true, queued };
});
check('tapping a palette card queues a unit', built.clicked && built.queued > 0,
  built.clicked ? `${built.queued} queued` : 'no enabled card found');

check('no page errors', errs.length === 0, errs[0] || '');
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL TOUCH INTERACTIONS WORK');
process.exit(fails ? 1 : 0);
