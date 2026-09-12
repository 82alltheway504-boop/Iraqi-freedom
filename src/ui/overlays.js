import { roeTier } from '../sim/world.js';
import { RESOURCE_INFO, Res, CATEGORY_INFO } from '../sim/rules.js';

const $ = (id) => document.getElementById(id);

function sheet(html) {
  const o = $('overlay');
  o.innerHTML = `<div class="sheet">${html}</div>`;
  o.classList.add('show');
  return o;
}
const hide = () => { $('overlay').classList.remove('show'); $('overlay').innerHTML = ''; };

const CONTROLS = `
  <h2>HOW A TURN WORKS</h2>
  <div class="controls">
    <div><i>Tap a unit</i><span>Selects it and lights every tile it can reach</span></div>
    <div><i>Tap a lit tile</i><span>Moves there. Distance costs action points</span></div>
    <div><i>Tap a bracketed enemy</i><span>Attacks it. Firing costs points too</span></div>
    <div><i>END TURN</i><span>Hands over to the Guard</span></div>
    <div><i>Space</i><span>Jump to the next unit that has not acted</span></div>
    <div><i>Drag / pinch</i><span>Look around and zoom</span></div>
    <div><i>Right rail</i><span>Train infantry, vehicles, air, and build works</span></div>
    <div><i>Rank badge</i><span>Spend commander points on perks</span></div>
  </div>`;

const ECONOMY = `
  <h2>THE THREE ECONOMIES</h2>
  <ul>
    <li><strong>Water</strong> feeds infantry. Every squad drinks every turn.</li>
    <li><strong>Fuel</strong> runs vehicles and aircraft, and aircraft are thirsty.</li>
    <li><strong>Oil</strong> pays for every structure and fortification you raise.</li>
  </ul>
  <p>Capture the water plant, the oil derrick and the fuel depot with an engineer.
  Run a resource dry and everything it feeds loses half its action points, takes
  damage every turn, and hits softer &mdash; recoverable, but only by taking a site.</p>`;

export function showBriefing(game, onStart) {
  const m = game.mission;
  sheet(`
    <h1><small>OPERATION IRAQI FREEDOM &middot; MISSION 01</small>${m.name}</h1>
    <div class="loc">${m.location} &middot; turn-based</div>
    ${m.brief.map((p) => `<p>${p}</p>`).join('')}
    <div class="rule"></div>
    ${ECONOMY}
    <div class="rule"></div>
    ${CONTROLS}
    <div class="btnrow"><button class="btn" id="btnStart">BEGIN OPERATION</button></div>`);
  $('btnStart').addEventListener('click', () => { hide(); onStart(); }, { once: true });
}

export function showPause(game) {
  const p = game.world.human;
  const tier = roeTier(p.support);
  const res = Object.values(Res).map((r) => `
    <div><span>${RESOURCE_INFO[r].name.toUpperCase()}</span><b>${Math.floor(p.res[r])}</b></div>`).join('');
  sheet(`
    <h1><small>OPERATION PAUSED &middot; TURN ${game.turns.turn}</small>${game.mission.name}</h1>
    <div class="kv">
      ${res}
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

/** The commander sheet: rank, progress, and the perk tree. */
export function showCommander(game) {
  const c = game.commander;
  const render = () => {
    const pr = c.progress;
    const branches = c.tree();
    const body = Object.entries(branches).map(([name, perks]) => `
      <div class="branch">
        <h3>${name.toUpperCase()}</h3>
        ${perks.map((p) => `
          <div class="perk ${p.level ? 'taken' : ''} ${p.locked && !p.level ? 'locked' : ''}">
            <div class="nm">${p.name}</div>
            <div class="lv">${p.level} / ${p.max}</div>
            <button data-perk="${p.id}" ${p.available ? '' : 'disabled'}>
              ${p.level >= p.max ? 'MAXED' : p.available ? 'TAKE' : 'LOCKED'}
            </button>
            <div class="ds">${p.desc}${p.locked && !p.level && p.requiresText
              ? ` <em>Requires ${p.requiresText}.</em>` : ''}</div>
          </div>`).join('')}
      </div>`).join('');

    sheet(`
      <h1><small>COMMANDER</small>${c.rankName}</h1>
      <div class="kv">
        <div><span>EXPERIENCE</span><b>${c.xp}</b></div>
        <div><span>POINTS TO SPEND</span><b>${c.availablePoints}</b></div>
        <div><span>NEXT RANK</span><b>${pr.next ? pr.need + ' XP' : 'MAX'}</b></div>
      </div>
      <div class="xpbar"><i style="width:${Math.round(pr.frac * 100)}%"></i></div>
      <p>${pr.next
        ? `${pr.need} more experience to make ${pr.next}. Experience comes from kills, captures and objectives.`
        : 'You have reached the highest rank.'}</p>
      <div class="rule"></div>
      ${body}
      <div class="btnrow">
        <button class="btn" id="btnCloseCmd">BACK TO THE BATTLE</button>
        <button class="btn ghost" id="btnRespec">REFUND ALL POINTS</button>
      </div>`);

    for (const b of document.querySelectorAll('.perk button[data-perk]')) {
      b.addEventListener('click', () => {
        if (c.take(b.dataset.perk)) {
          game.world.human.perks = c.effects;
          game.audio.promote();
          render();                       // redraw so prerequisites unlock live
        } else game.audio.deny();
      });
    }
    $('btnCloseCmd').addEventListener('click', () => game.closeOverlay(), { once: true });
    $('btnRespec').addEventListener('click', () => {
      c.respec();
      game.world.human.perks = c.effects;
      game.audio.uiTap();
      render();
    }, { once: true });
  };
  render();
}

export function showResults(game, s) {
  const win = s.result === 'victory';
  const c = s.commander;
  const bonus = s.bonuses.length
    ? `<h2>SECONDARY OBJECTIVES MET</h2><ul>${s.bonuses.map((b) => `<li>${b}</li>`).join('')}</ul>` : '';
  const missed = s.missed.length
    ? `<h2>NOT ACHIEVED</h2><ul>${s.missed.map((b) => `<li>${b}</li>`).join('')}</ul>` : '';
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
      <div><span>TURNS</span><b>${s.turns}</b></div>
      <div><span>ENEMY LOSSES</span><b>${s.killed}</b></div>
      <div><span>OWN LOSSES</span><b>${s.lost}</b></div>
      <div><span>SUPPORT (LOWEST)</span><b>${s.supportFloor}%</b></div>
      <div><span>COMMANDER</span><b>${c ? c.rankName : '—'}</b></div>
    </div>
    ${bonus}${missed}
    <p>${win
      ? 'Highway 8 is open and the bridgehead is yours. Your rank and perks carry forward.'
      : 'The bridgehead could not be held. Your commander experience is kept — spend it and try again.'}</p>
    <div class="btnrow">
      <button class="btn" id="btnAgain">${win ? 'PLAY AGAIN' : 'TRY AGAIN'}</button>
      <button class="btn ghost" id="btnCmd2">COMMANDER</button>
    </div>`);
  $('btnAgain').addEventListener('click', () => game.restart(), { once: true });
  $('btnCmd2').addEventListener('click', () => showCommander(game), { once: true });
}
