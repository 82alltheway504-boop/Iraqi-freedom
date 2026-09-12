import { Game } from './game.js';
import { showBriefing } from './ui/overlays.js';

// Entry point. The briefing screen doubles as the gesture that unlocks audio,
// which iOS requires before any sound can be produced.
function boot() {
  const game = new Game();
  window.game = game;                     // handy from a console, harmless

  // The orientation nudge is advice, not a gate: some browsers and embedded
  // frames never report landscape, and stranding the player there is worse
  // than a cramped layout.
  const dismiss = document.getElementById('btnPortrait');
  if (dismiss) {
    dismiss.addEventListener('click', () => {
      document.body.classList.add('portrait-ok');
      game.audio.uiTap();
      // The viewport just changed size in effect; re-fit everything.
      window.dispatchEvent(new Event('resize'));
    });
  }

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
