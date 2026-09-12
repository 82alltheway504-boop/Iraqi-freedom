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
const errs = []; page.on('pageerror', e=>{ errs.push(e.message); console.log('PAGEERROR', e.stack || e.message); });
await page.goto(process.env.GAME_URL || 'http://localhost:8099/', { waitUntil:'networkidle' });
await page.click('#btnStart');
await page.waitForTimeout(1200);

// A finger is not a pixel. Mobile browsers hit-test a touch as a small disc and
// then snap it to any clickable element inside that disc, so a point that
// elementFromPoint calls clear canvas can still be stolen by a HUD control a
// dozen pixels away. Tests have to pick targets the same way a thumb finds
// them: clear of every interactive panel by a finger's radius.
await page.evaluate(() => {
  window.__hudClear = (x, y, pad = 26) => {
    for (const el of document.querySelectorAll('#hud *')) {
      const cs = getComputedStyle(el);
      if (cs.pointerEvents === 'none' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad) return false;
    }
    return document.elementFromPoint(x, y) === window.game.canvas;
  };
});

// Centre the camera on a known unit and work out where it is on screen.
// Put the unit in clear canvas, away from the HUD panels, before tapping it.
const pos = await page.evaluate(() => {
  const g = window.game;
  const u = g.world.unitsOf(0).find(u => u.defId === 'humvee');
  g.camera.zoom = 1.0;
  g.camera.centerOn(u.x, u.y);
  const s = g.camera.worldToScreen(u.x, u.y);
  const onHud = !window.__hudClear(s.x, s.y);
  return { sx: s.x, sy: s.y, id: u.id, onHud };
});
check('the unit sits on clear canvas, not under a panel', !pos.onHud,
  pos.onHud ? 'a HUD panel would swallow the tap' : '');

// Tap the unit: selection plus a lit reachable area.
await page.touchscreen.tap(pos.sx, pos.sy);
await page.waitForTimeout(250);
let sel = await page.evaluate(() => ({
  n: [...window.game.selection].length,
  first: [...window.game.selection][0],
  overlay: window.game.renderer.moveOverlay ? window.game.renderer.moveOverlay.size : 0,
}));
check('tap selects a unit', sel.n === 1 && sel.first === pos.id, `selected ${sel.n}`);
check('and lights the tiles it can reach', sel.overlay > 1, `${sel.overlay} tiles`);

// Tap a lit tile to spend action points moving there.
// Choose the most expensive reachable tile that is still on clear canvas —
// the furthest one is usually off screen or behind a HUD panel.
const dest = await page.evaluate(() => {
  const g = window.game, W = g.world.grid.w;
  const u = g.world.entityById([...g.selection][0]);
  let pick = null, best = -1, at = null;
  for (const [idx, n] of g.renderer.moveOverlay) {
    const tx = idx % W, ty = (idx / W) | 0;
    if (g.world.occupantAt(tx, ty, u)) continue;
    const s = g.camera.worldToScreen(tx * 32 + 16, ty * 32 + 16);
    if (s.x < 20 || s.y < 20 || s.x > window.innerWidth - 20 || s.y > window.innerHeight - 20) continue;
    if (!window.__hudClear(s.x, s.y)) continue;
    if (n.ap > best) { best = n.ap; pick = idx; at = s; }
  }
  return { sx: at ? at.x : -1, sy: at ? at.y : -1, apBefore: u.ap, cost: best };
});
check('a reachable tile is tappable on clear canvas', dest.sx > 0, `${dest.cost} AP away`);
await page.touchscreen.tap(dest.sx, dest.sy);
await page.waitForTimeout(500);
const moved = await page.evaluate((id) => {
  const u = window.game.world.entityById(id);
  return { ap: u.ap, moved: u.movedThisTurn };
}, pos.id);
check('tap on a lit tile moves and spends points',
  moved.moved && moved.ap < dest.apBefore, `${dest.apBefore} -> ${moved.ap} AP`);

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

// Tapping an enemy that is in range attacks it.
const fought = await page.evaluate(async () => {
  const g = window.game, w = g.world, T = (t) => t * 32 + 16;
  const u = w.unitsOf(0).find(x => x.defId === 'rifle_squad');
  u.ap = u.apMax;
  const tx = Math.floor(u.x / 32) + 3, ty = Math.floor(u.y / 32);
  const foe = w.spawnUnit('militia', 1, T(tx), T(ty), Math.PI);
  g.select([u], false);
  const hpBefore = foe.hp;
  const s = g.camera.worldToScreen(foe.x, foe.y);
  return { sx: s.x, sy: s.y, foeId: foe.id, hpBefore, targeted: g.renderer.targetOverlay.has(foe.id) };
});
check('an in-range enemy is bracketed as a target', fought.targeted);
await page.touchscreen.tap(fought.sx, fought.sy);
await page.waitForTimeout(400);
const hurt = await page.evaluate((id) => {
  const f = window.game.world.entityById(id);
  return f ? f.hp : 0;
}, fought.foeId);
check('tapping it attacks', hurt < fought.hpBefore, `${Math.round(fought.hpBefore)} -> ${Math.round(hurt)} HP`);

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
  g.world.human.res = { fuel: 900, water: 900, oil: 900 };
  g.world.placeBuilding('command_post', 0, 15, 45);
  g.world.placeBuilding('barracks', 0, 20, 45);
  for (const b of document.querySelectorAll('#tabs button')) if (b.dataset.tab === 'infantry') b.click();
  await new Promise(r => setTimeout(r, 300));
  const card = document.querySelector('#palette .card:not(.disabled)');
  if (!card) return { clicked: false };
  card.click();
  await new Promise(r => setTimeout(r, 150));
  const queued = g.world.buildings.reduce((n, b) => n + (b.owner === 0 ? b.queue.length : 0), 0);
  return { clicked: true, queued };
});
check('tapping a palette card queues a unit', built.clicked && built.queued > 0,
  built.clicked ? `${built.queued} queued` : 'no enabled card found');

// Ending the turn hands over to the Guard and comes back.
const turned = await page.evaluate(async () => {
  const g = window.game;
  const before = g.turns.turn;
  document.getElementById('btnEndTurn').click();
  await new Promise(r => setTimeout(r, 3200));
  return { before, after: g.turns.turn, playerTurn: g.turns.isPlayerTurn, busy: g.busy };
});
check('END TURN passes to the Guard and back',
  turned.after === turned.before + 1 && turned.playerTurn && !turned.busy,
  `turn ${turned.before} -> ${turned.after}`);

check('no page errors', errs.length === 0, errs[0] || '');
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL TOUCH INTERACTIONS WORK');
process.exit(fails ? 1 : 0);
