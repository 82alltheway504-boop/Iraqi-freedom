// Prints the live balance tables straight out of the definitions, so the
// design document can never drift from what the game actually does.
// Run: node tools/balance.mjs > (paste into docs/DESIGN.md)
import { UNITS, BUILDINGS, FACTION_INFO, ROSTER, weaponsOf } from '../src/sim/defs.js';
import { DAMAGE_TABLE, DAMAGE_NAMES, ARMOR_NAMES, VET_RANKS, GARRISON_MULT,
         GARRISON_BLEED, COVER_SCALE, ENTRENCH, STARVATION, RESOURCE_INFO,
         CATEGORY_INFO, UPKEEP_RESOURCE, COMMANDER_RANKS, COMMANDER_XP,
         PERKS } from '../src/sim/rules.js';
import { ROE } from '../src/sim/world.js';
import { TERRAIN, TILE } from '../src/world/terrain.js';

const LOCO = ['foot', 'wheel', 'track', 'air'];
const tiles = (px) => (px / TILE).toFixed(px % TILE ? 1 : 0);

console.log('## Categories\n');
console.log('| Category | Upkeep paid in | Notes |');
console.log('|---|---|---|');
for (const [id, info] of Object.entries(CATEGORY_INFO)) {
  console.log(`| ${info.name} | ${RESOURCE_INFO[UPKEEP_RESOURCE[id]].name} | ${info.blurb || '—'} |`);
}

console.log('\n## Damage type vs armour class\n');
console.log('| Damage type | ' + ARMOR_NAMES.join(' | ') + ' |');
console.log('|---|' + ARMOR_NAMES.map(() => '---:').join('|') + '|');
DAMAGE_TABLE.forEach((row, i) => {
  console.log(`| ${DAMAGE_NAMES[i]} | ` + row.map((v) => v.toFixed(2)).join(' | ') + ' |');
});

console.log('\n## Units\n');
console.log('Damage per turn assumes the unit stands still and spends every point firing.\n');
for (const f of ['CTF', 'RG']) {
  console.log(`### ${FACTION_INFO[f].name}\n`);
  console.log('| Unit | Category | Cost | Upkeep | Build | HP | Armour | Move | AP | Vision | Weapon | Damage | Range | Shot cost | Per turn |');
  console.log('|---|---|---:|---:|---:|---:|---|---|---:|---:|---|---:|---:|---:|---:|');
  for (const d of Object.values(UNITS)) {
    if (d.faction !== f) continue;
    const mounts = weaponsOf(d);
    const rows = mounts.length ? mounts : [null];
    rows.forEach((w, i) => {
      const head = i === 0
        ? `| ${d.name} | ${CATEGORY_INFO[d.category].name} | ${d.cost} ${RESOURCE_INFO[d.res].short} | ${d.upkeep} | ${d.buildTurns}t | ${d.hp} | ${ARMOR_NAMES[d.armor]} | ${LOCO[d.loco]} | ${d.ap} | ${d.vision} |`
        : '| ↳ | | | | | | | | | |';
      if (!w) { console.log(head + ' — | — | — | — | — |'); return; }
      const perShot = w.damage * (w.shots || 1);
      const shots = Math.floor(d.ap / w.attackAp);
      const rng = w.minRange ? `${tiles(w.minRange)}–${tiles(w.range)}` : tiles(w.range);
      console.log(head + ` ${w.name || DAMAGE_NAMES[w.type]} | ${w.damage}${w.shots > 1 ? `×${w.shots}` : ''} | ${rng} | ${w.attackAp} | ${perShot * shots} |`);
    });
  }
  console.log('');
}

console.log('## Structures\n');
console.log('| Structure | Faction | Cost | Upkeep | Build | HP | Size | Notes |');
console.log('|---|---|---:|---:|---:|---:|---|---|');
for (const d of Object.values(BUILDINGS)) {
  const notes = [];
  if (d.isHQ) notes.push(`build radius ${d.buildRadius}`);
  if (d.produces) notes.push('trains ' + d.produces.length);
  if (d.requires) notes.push('needs ' + d.requires.join(', '));
  if (d.weapon) notes.push('shoots back');
  if (d.garrisonSlots) notes.push(`garrison ${d.garrisonSlots}`);
  if (d.obstacle) notes.push('obstacle');
  if (d.capturable) notes.push('capturable');
  if (d.civilian) notes.push('civilian');
  if (d.yields) notes.push(`+${d.yieldAmount} ${RESOURCE_INFO[d.yields].short}/turn`);
  if (d.repairs) notes.push('repairs');
  const cost = d.cost ? `${d.cost} ${RESOURCE_INFO[d.res].short}` : '—';
  console.log(`| ${d.name} | ${FACTION_INFO[d.faction].short} | ${cost} | ${d.upkeep || 0} | ${d.buildTurns || '—'}t | ${d.hp} | ${d.size[0]}×${d.size[1]} | ${notes.join(', ') || '—'} |`);
}

console.log('\n## Terrain\n');
console.log('Movement costs are action points per tile. Air ignores the table entirely.\n');
console.log('| Terrain | Foot | Wheel | Track | Cover | Blocks sight |');
console.log('|---|---|---|---|---:|---|');
for (const t of TERRAIN) {
  const c = t.cost.map((v) => (v === Infinity ? '—' : v.toFixed(2)));
  console.log(`| ${t.name} | ${c[0]} | ${c[1]} | ${c[2]} | ${(t.cover * 100).toFixed(0)}% | ${t.blocksSight ? 'yes' : 'no'} |`);
}

console.log('\n## Supply\n');
console.log('| Resource | Pays for | Running out |');
console.log('|---|---|---|');
for (const [id, info] of Object.entries(RESOURCE_INFO)) {
  console.log(`| ${info.name} | ${info.blurb} | see below |`);
}
console.log(`\nA side that cannot pay its upkeep is starving: action points are halved `
  + `(×${STARVATION.apMultiplier}), damage drops to ×${STARVATION.damageMultiplier}, and every `
  + `unpaid unit loses ${(STARVATION.attrition * 100).toFixed(0)}% of its health each turn. `
  + `Nothing is deleted — take a supply site back and the army recovers.`);

console.log('\n## Digging in\n');
console.log(`A unit that neither moves nor fires entrenches ${ENTRENCH.perTurn} levels per turn `
  + `to a maximum of ${ENTRENCH.max}, worth ${(ENTRENCH.coverPerLevel * 100).toFixed(0)}% damage `
  + `reduction per level. Moving or firing gives all of it back.`);

console.log('\n## Veterancy\n');
console.log('| Rank | XP | Damage | Damage taken | Vision | Bonus AP |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const v of VET_RANKS) {
  console.log(`| ${v.name} | ${v.xp} | ×${v.dmg.toFixed(2)} | ×${v.resist.toFixed(2)} | ×${v.vision.toFixed(2)} | ${v.ap} |`);
}

console.log('\n## Commander ranks\n');
console.log(`Experience comes in at ${COMMANDER_XP.perTurnSurvived}/turn plus `
  + `${COMMANDER_XP.perKill}× the value of each kill, ${COMMANDER_XP.perCapture} a capture and `
  + `${COMMANDER_XP.perObjective} an objective.\n`);
console.log('| Rank | XP | Skill points |');
console.log('|---|---:|---:|');
for (const r of COMMANDER_RANKS) console.log(`| ${r.name} | ${r.xp} | ${r.points} |`);

console.log('\n## Perks\n');
console.log('| Perk | Branch | Ranks | Needs | Effect |');
console.log('|---|---|---:|---|---|');
for (const p of Object.values(PERKS)) {
  const needs = Object.entries(p.requires || {})
    .map(([id, n]) => `${PERKS[id].name} ${n}`).join(', ') || '—';
  console.log(`| ${p.name} | ${p.branch} | ${p.max} | ${needs} | ${p.desc} |`);
}

console.log('\n## Garrison\n');
console.log(`Damage bleeding into occupants: ${(GARRISON_BLEED * 100).toFixed(0)}% of the hit on the structure, then:\n`);
console.log('| Damage type | Multiplier vs occupants |');
console.log('|---|---:|');
GARRISON_MULT.forEach((m, i) => console.log(`| ${DAMAGE_NAMES[i]} | ×${m.toFixed(2)} |`));

console.log('\n## Cover effectiveness by armour class\n');
console.log('| Armour | Fraction of terrain cover applied |');
console.log('|---|---:|');
COVER_SCALE.forEach((c, i) => console.log(`| ${ARMOR_NAMES[i]} | ${(c * 100).toFixed(0)}% |`));

console.log('\n## Local Support tiers\n');
console.log(`Starts at ${ROE.START}%, falls ${ROE.LOSS_PER_100_DAMAGE} per 100 points of damage `
  + `dealt to civilian property and ${ROE.LOSS_PER_DESTROYED} for levelling a civilian building, `
  + `and recovers ${ROE.REGEN_PER_TURN} a turn when you leave them alone.\n`);
console.log('| Support | Tier | Income | Effect |');
console.log('|---|---|---:|---|');
for (const t of ROE.tiers) {
  console.log(`| ≥ ${t.min}% | ${t.name} | ×${t.incomeMult.toFixed(2)} | ${t.blurb} |`);
}

console.log('\n## Roster by tab\n');
for (const [tab, ids] of Object.entries(ROSTER)) {
  console.log(`- **${CATEGORY_INFO[tab]?.name || tab}** — ${ids.map((i) => UNITS[i]?.name || BUILDINGS[i]?.name || i).join(', ')}`);
}
