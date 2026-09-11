import { Game } from './game.js';
import { showBriefing } from './ui/overlays.js';

// Entry point. The briefing screen doubles as the gesture that unlocks audio,
// which iOS requires before any sound can be produced.
function boot() {
  const game = new Game();
  window.game = game;                     // handy from a console, harmless
  showBriefing(game, () => game.begin());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// Register the offline cache so the game works as an installed app with no
// network at all. Failure here is never fatal — it just means no offline mode.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
