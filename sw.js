// Offline cache. The whole game is a few hundred kilobytes of text — no
// binary assets at all — so it caches in one go and then runs with no network.
const CACHE = 'oif-talon-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-512.png',
  './icon-maskable.png',
  './src/art/draw.js',
  './src/art/palette.js',
  './src/art/radial.js',
  './src/art/sprites.js',
  './src/art/terrain.js',
  './src/audio/audio.js',
  './src/audio/music.js',
  './src/core/camera.js',
  './src/core/input.js',
  './src/core/math.js',
  './src/game.js',
  './src/main.js',
  './src/missions/m01.js',
  './src/missions/map01.js',
  './src/render/renderer.js',
  './src/sim/ai.js',
  './src/sim/commander.js',
  './src/sim/defs.js',
  './src/sim/entity.js',
  './src/sim/fx.js',
  './src/sim/rules.js',
  './src/sim/turns.js',
  './src/sim/world.js',
  './src/ui/hud.js',
  './src/ui/minimap.js',
  './src/ui/overlays.js',
  './src/world/fog.js',
  './src/world/grid.js',
  './src/world/pathfinder.js',
  './src/world/terrain.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {/* a missing optional asset must not block installation */})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    // Cache first: gameplay must never stall on a flaky mobile connection.
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
