import { mmss } from './hud.js';
import { roeTier } from '../sim/rules.js';

const $ = (id) => document.getElementById(id);

function sheet(html) {
  const o = $('overlay');
  o.innerHTML = `<div class="sheet">${html}</div>`;
  o.classList.add('show');
  return o;
}

function hide() { $('overlay').classList.remove('show'); $('overlay').innerHTML = ''; }

const CONTROLS = `
  <h2>CONTROLS</h2>
  <div class="controls">
    <div><i>Tap</i><span>Select your unit, or give it an order</span></div>
    <div><i>Drag</i><span>Look around the battlefield</span></div>
    <div><i>Pinch</i><span>Zoom in and out</span></div>
    <div><i>Long press</i><span>Attack-move to that point</span></div>
    <div><i>Long press + drag</i><span>Box-select a group</span></div>
    <div><i>Double tap</i><span>Select every unit of that type on screen</span></div>
    <div><i>Minimap</i><span>Tap or drag to jump the camera</span></div>
    <div><i>Right rail</i><span>Train units, place structures, call support</span></div>
  </div>`;

/** Pre-mission briefing. The button here is also what unlocks audio on iOS. */
export function showBriefing(game, onStart) {
  const m = game.mission;
  const body = m.brief.map((p) => `<p>${p}</p>`).join('');
  sheet(`
    <h1><small>OPERATION IRAQI FREEDOM &middot; MISSION 01</small>${m.name}</h1>
    <div class="loc">${m.location}</div>
    ${body}
    <div class="rule"></div>
    <h2>OBJECTIVES</h2>
    <ul>
      <li>Move the recon element to Overwatch ALPHA</li>
      <li>Destroy the two Guard observation posts on Highway 8</li>
      <li>Capture the abandoned depot and deploy your Command Post</li>
      <li>Hold the bridgehead, then take the Guard Command Post across the river</li>
      <li><em>Optional:</em> keep Local Support above 50% and capture the fuel depot</li>
    </ul>
    <div class="rule"></div>
    ${CONTROLS}
    <div class="btnrow">
      <button class="btn" id="btnStart">BEGIN OPERATION</button>
    </div>`);
  $('btnStart').addEventListener('click', () => { hide(); onStart(); }, { once: true });
}

export function showPause(game) {
  const p = game.world.human;
  const tier = roeTier(p.support);
  sheet(`
    <h1><small>OPERATION PAUSED</small>${game.mission.name}</h1>
    <div class="kv">
      <div><span>ELAPSED</span><b>${mmss(game.mission.time)}</b></div>
      <div><span>SUPPLY</span><b>${Math.floor(p.supply).toLocaleString()}</b></div>
      <div><span>POWER</span><b>${p.powerGen}/${p.powerUse}</b></div>
      <div><span>LOCAL SUPPORT</span><b>${Math.round(p.support)}%</b></div>
    </div>
    <p><strong>${tier.name}.</strong> ${tier.blurb}</p>
    <div class="rule"></div>
    ${CONTROLS}
    <div class="btnrow">
      <button class="btn" id="btnResume">RESUME</button>
      <button class="btn ghost" id="btnRestart">RESTART MISSION</button>
    </div>`);
  $('btnResume').addEventListener('click', () => game.togglePause(), { once: true });
  $('btnRestart').addEventListener('click', () => game.restart(), { once: true });
}

export function showResults(game, s) {
  const win = s.result === 'victory';
  const bonus = s.bonuses.length
    ? `<h2>SECONDARY OBJECTIVES MET</h2><ul>${s.bonuses.map((b) => `<li>${b}</li>`).join('')}</ul>`
    : '';
  const missed = s.missed.length
    ? `<h2>NOT ACHIEVED</h2><ul>${s.missed.map((b) => `<li>${b}</li>`).join('')}</ul>`
    : '';
  // A simple rating, weighted toward the things the mission is actually about:
  // finishing it, keeping your force alive, and not levelling the village.
  const ratio = s.lost > 0 ? s.killed / s.lost : s.killed;
  const score = win
    ? Math.round(40 + Math.min(25, ratio * 6) + (s.supportFloor / 100) * 25 + s.bonuses.length * 5)
    : Math.round(Math.min(35, ratio * 8) + (s.supportFloor / 100) * 10);
  const grade = score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 68 ? 'B' : score >= 55 ? 'C' : win ? 'D' : 'F';

  sheet(`
    <h1><small>MISSION 01 &middot; ${game.mission.name.toUpperCase()}</small>
      <span class="verdict ${win ? 'win' : 'lose'}">${win ? 'OBJECTIVE SECURED' : 'OPERATION FAILED'}</span>
    </h1>
    <div class="kv">
      <div><span>RATING</span><b>${grade}</b></div>
      <div><span>TIME</span><b>${mmss(s.time)}</b></div>
      <div><span>ENEMY LOSSES</span><b>${s.killed}</b></div>
      <div><span>OWN LOSSES</span><b>${s.lost}</b></div>
      <div><span>SUPPLY EARNED</span><b>${Math.round(s.earned).toLocaleString()}</b></div>
      <div><span>SUPPORT (LOWEST)</span><b>${s.supportFloor}%</b></div>
    </div>
    ${bonus}
    ${missed}
    <p>${win
      ? 'Highway 8 is open and the bridgehead is yours. The follow-on force crosses at first light.'
      : 'The bridgehead could not be held. Reset and try a different approach — mixed arms beat mass, and cover beats both.'}</p>
    <div class="btnrow">
      <button class="btn" id="btnAgain">${win ? 'PLAY AGAIN' : 'TRY AGAIN'}</button>
    </div>`);
  $('btnAgain').addEventListener('click', () => game.restart(), { once: true });
}
