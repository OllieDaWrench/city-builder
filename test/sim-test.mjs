/* Headless simulation smoke test — no DOM required.
   Run with: npm run test:sim

   Builds a small city using the exact same `applyAt` tool logic the UI
   uses, simulates 5 game years, and sanity-checks the result. */
import { newCity, tick, applyAt, serialize, CFG } from '../lib/game/engine.js';

const s = newCity(20260927);
const tiles = s.tiles;
const at = (x, y) => tiles[y * CFG.W + x];

/* Find a patch of land that fits the whole 16x11 layout. */
function findOrigin() {
  for (let oy = 2; oy < CFG.H - 12; oy++) {
    for (let ox = 2; ox < CFG.W - 18; ox++) {
      let ok = true;
      for (let dy = 0; dy < 11 && ok; dy++) {
        for (let dx = 0; dx < 16 && ok; dx++) {
          const t = at(ox + dx, oy + dy);
          if (!t || t.t !== 2) ok = false;
        }
      }
      if (ok) return { ox, oy };
    }
  }
  throw new Error('no fitting land patch found');
}

const { ox, oy } = findOrigin();
let spent = 0;

function build(tool, rx, ry) {
  const t = at(ox + rx, oy + ry);
  const before = { road: t.road, z: t.z, b: t.b };
  const r = applyAt(s, tool, t);
  const changed =
    (tool === 'road' && t.road) ||
    ((tool === 'res' || tool === 'com' || tool === 'ind') && t.z !== before.z) ||
    ((tool === 'park' || tool === 'coal' || tool === 'wind') && t.b) ||
    (tool === 'bulldoze' && !t.road && !t.b && !t.z);
  if (!changed) throw new Error(`build ${tool} @${ox + rx},${oy + ry} failed${r.msg ? `: ${r.msg}` : ''}`);
  spent += r.spent;
}

/* Streets: two horizontal + one vertical, all connected. */
for (let x = 0; x <= 12; x++) { build('road', x, 4); build('road', x, 6); }
for (let y = 2; y <= 8; y++) build('road', 6, y);

/* Power plant beside the eastern end of the southern street. */
build('coal', 13, 6);

/* Zones flanking the streets. */
for (let x = 0; x <= 12; x++) {
  if (x !== 6) build('com', x, 3);
  if (x !== 6) build('res', x, 5);
  if (x !== 6) build('ind', x, 7);
}

/* Parks near the homes. */
build('park', 2, 2);
build('park', 9, 2);

console.log(`  built a test town at (${ox},${oy}), spent ${spent}`);

const MONTHS = 60;
for (let m = 1; m <= MONTHS; m++) {
  tick(s);
  if (m === 24) {
    console.log(`  month 24 : pop=${s.pop} jobsC=${s.jobsC} jobsI=${s.jobsI} happy=${Math.round(s.happy * 100)}% money=${Math.round(s.money)}`);
  }
}

console.log(`  month ${MONTHS}: pop=${s.pop} jobsC=${s.jobsC} jobsI=${s.jobsI} happy=${Math.round(s.happy * 100)}% money=${Math.round(s.money)}`);
console.log(`  demand  : R=${Math.round(s.dR * 100)}% C=${Math.round(s.dC * 100)}% I=${Math.round(s.dI * 100)}%`);
console.log(`  power   : ${s.powerUsed}/${s.powerCap} units`);
console.log(`  finances: income=${Math.round(s.income)}/mo upkeep=${Math.round(s.upkeep)}/mo`);
console.log(`  save    : ${JSON.stringify(serialize(s)).length} bytes`);

const failures = [];
if (s.pop < 40) failures.push(`population only ${s.pop} after 5 years`);
if (s.jobsC + s.jobsI < 30) failures.push(`only ${s.jobsC + s.jobsI} jobs`);
if (s.money < 0) failures.push(`treasury went bankrupt (${Math.round(s.money)})`);
if (s.powerUsed === 0) failures.push('nothing is consuming power');

if (failures.length) {
  console.error('\nFAIL:', failures.join(' · '));
  process.exit(1);
}
console.log(`\nOK — simulated ${MONTHS} months on seed ${s.seed}; city is healthy.`);
