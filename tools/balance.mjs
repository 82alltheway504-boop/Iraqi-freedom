// Prints the live balance tables straight out of the definitions, so the
// design document can never drift from what the game actually does.
// Run: node tools/balance.mjs
import { UNITS, BUILDINGS, FACTION_INFO, POWERS } from '../src/sim/defs.js';
import { DAMAGE_TABLE, DAMAGE_NAMES, ARMOR_NAMES, VET_RANKS, GARRISON_MULT,
         GARRISON_BLEED, ROE, COVER_SCALE } from '../src/sim/rules.js';
import { TERRAIN } from '../src/world/terrain.js';

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const LOCO = ['foot', 'wheel', 'track'];

console.log('## Damage type vs armour class\n');
console.log('| Damage type | ' + ARMOR_NAMES.join(' | ') + ' |');
console.log('|---|' + ARMOR_NAMES.map(() => '---:').join('|') + '|');
DAMAGE_TABLE.forEach((row, i) => {
  console.log(`| ${DAMAGE_NAMES[i]} | ` + row.map((v) => v.toFixed(2)).join(' | ') + ' |');
});

console.log('\n## Units\n');
for (const f of ['CTF', 'RG']) {
  console.log(`### ${FACTION_INFO[f].name}\n`);
  console.log('| Unit | Cost | Build | HP | Armour | Move | Speed | Vision | Weapon | Damage | RoF | Range | DPS |');
  console.log('|---|---:|---:|---:|---|---|---:|---:|---|---:|---:|---:|---:|');
  for (const d of Object.values(UNITS)) {
    if (d.faction !== f) continue;
    const mounts = [d.weapon, d.weapon2].filter(Boolean);
    const rows = mounts.length ? mounts : [null];
    rows.forEach((w, i) => {
      const head = i === 0
        ? `| ${d.name} | ${d.cost} | ${d.buildTime}s | ${d.hp} | ${ARMOR_NAMES[d.armor]} | ${LOCO[d.loco]} | ${d.speed} | ${d.vision} |`
        : '| ↳ | | | | | | | |';
      if (!w) { console.log(head + ' — | — | — | — | — |'); return; }
      const dps = (w.damage * (w.shots || 1)) / w.cooldown;
      console.log(head + ` ${DAMAGE_NAMES[w.type]} | ${w.damage}${w.shots > 1 ? `×${w.shots}` : ''} | ${w.cooldown}s | ${w.range} | ${dps.toFixed(0)} |`);
    });
  }
  console.log('');
}

console.log('## Structures\n');
console.log('| Structure | Faction | Cost | Build | HP | Size | Power | Notes |');
console.log('|---|---|---:|---:|---:|---|---:|---|');
for (const d of Object.values(BUILDINGS)) {
  const notes = [];
  if (d.isHQ) notes.push(`build radius ${d.buildRadius}`);
  if (d.produces) notes.push('trains ' + d.produces.length);
  if (d.requires) notes.push('needs ' + d.requires.join(', '));
  if (d.defensive) notes.push('defensive');
  if (d.dropoff) notes.push('supply drop-off');
  if (d.capturable) notes.push('capturable');
  if (d.civilian) notes.push('civilian');
  if (d.explodes) notes.push(`detonates ${d.explodes}`);
  if (d.trickle) notes.push(`+${d.trickle}/s`);
  if (d.grants) notes.push('unlocks ' + d.grants.join(', '));
  console.log(`| ${d.name} | ${FACTION_INFO[d.faction].short} | ${d.cost || '—'} | ${d.buildTime || '—'}s | ${d.hp} | ${d.size[0]}×${d.size[1]} | ${d.power} | ${notes.join(', ') || '—'} |`);
}

console.log('\n## Terrain\n');
console.log('| Terrain | Foot | Wheel | Track | Cover | Blocks sight |');
console.log('|---|---|---|---|---:|---|');
for (const t of TERRAIN) {
  const c = t.cost.map((v) => (v === Infinity ? '—' : v.toFixed(2)));
  console.log(`| ${t.name} | ${c[0]} | ${c[1]} | ${c[2]} | ${(t.cover * 100).toFixed(0)}% | ${t.blocksSight ? 'yes' : 'no'} |`);
}

console.log('\n## Veterancy\n');
console.log('| Rank | XP | Damage | Damage taken | Vision | Regen |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const v of VET_RANKS) {
  console.log(`| ${v.name} | ${v.xp} | ×${v.dmg.toFixed(2)} | ×${v.resist.toFixed(2)} | ×${v.vision.toFixed(2)} | ${v.regen}/s |`);
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
console.log('| Support | Tier | Supply | Enemy irregulars | Support power cooldown |');
console.log('|---|---|---:|---:|---:|');
for (const t of ROE.tiers) {
  console.log(`| ≥ ${t.min}% | ${t.name} | ×${t.incomeMult.toFixed(2)} | ×${t.enemyReinforceMult.toFixed(1)} | ×${t.strikeCdMult.toFixed(2)} |`);
}

console.log('\n## Support powers\n');
console.log('| Power | Cooldown | Effect |');
console.log('|---|---:|---|');
for (const p of Object.values(POWERS)) {
  console.log(`| ${p.name} | ${p.cooldown}s | ${p.desc} |`);
}
