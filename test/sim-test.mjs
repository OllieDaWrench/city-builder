/* Headless simulation smoke test for the v2 engine — no DOM, no WebGL.
   Run with: npm run test:sim */
import { newCity, tick, applyAt, serialize, tileAt } from '../lib/game/sim.js';
import { CFG } from '../lib/game/config.js';

const s = newCity(20260927);
const at = (x, y) => tileAt(s, x, y);

console.log(`  highway enters at (${s.outside.x},${s.outside.y}), gate at (${s.gate.x},${s.gate.y})`);
if (at(s.gate.x, s.gate.y).road !== 3) throw new Error('no highway stub at gate');

/* ---- find a 17x12 all-land patch reachable over land from the gate (BFS) --- */
const PW = 17, PH = 12;
function patchFits(x, y) {
  for (let dy = 0; dy < PH; dy++) for (let dx = 0; dx < PW; dx++) {
    const t = at(x + dx, y + dy);
    if (!t || t.t !== 2) return false;
  }
  return true;
}
const parent = new Map();
const seen = new Set([`${s.gate.x},${s.gate.y}`]);
const bfsQ = [[s.gate.x, s.gate.y]];
let corner = null, cornerKey = null;
outer:
while (bfsQ.length) {
  const [cx, cy] = bfsQ.shift();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = cx + dx, ny = cy + dy;
    const k = `${nx},${ny}`;
    if (seen.has(k)) continue;
    const t = at(nx, ny);
    if (!t || t.t === 0) continue;
    seen.add(k); parent.set(k, `${cx},${cy}`);
    if (nx >= 1 && ny >= 1 && nx + PW < CFG.W - 1 && ny + PH < CFG.H - 1 && patchFits(nx, ny)) {
      corner = [nx, ny]; cornerKey = k; break outer;
    }
    bfsQ.push([nx, ny]);
  }
}
if (!corner) throw new Error('no reachable land patch for the test town');
const [ox, oy] = corner;
console.log(`  test town patch at (${ox},${oy}), reachable over land ✓`);

/* ---- build a street along the BFS path from the gate to the patch border --- */
const path = [];
{
  let k = cornerKey;
  while (k) {
    const [x, y] = k.split(',').map(Number);
    path.push([x, y]);
    k = parent.get(k);
  }
  path.reverse();
}
let builtPath = 0;
for (const [x, y] of path) {
  const t = at(x, y);
  if (t && !t.road) { const r = applyAt(s, 'road_street', t); if (r.ok) builtPath++; }
}
console.log(`  connector: ${builtPath} street tiles from the highway gate`);

/* ---- the town layout, relative to the patch corner ---- */
const L = [
  ...Array.from({ length: 13 }, (_, i) => ['road_street', 1 + i, 4]),
  ...Array.from({ length: 13 }, (_, i) => ['road_street', 1 + i, 6]),
  ...Array.from({ length: 9 }, (_, i) => ['road_street', 7, i + 1]),
  ['coal', 13, 5],
  ...Array.from({ length: 12 }, (_, i) => (i + 1) === 7 ? null : ['zone_res', 1 + i, 5]),
  ...Array.from({ length: 12 }, (_, i) => (i + 1) === 7 ? null : ['zone_com', 1 + i, 3]),
  ...Array.from({ length: 12 }, (_, i) => (i + 1) === 7 ? null : ['zone_ind', 1 + i, 7]),
  ...Array.from({ length: 12 }, (_, i) => (i + 1) === 7 ? null : ['zone_office', 1 + i, 1]),
  ['school', 5, 2],
  ['park', 10, 0],
  ['police', 12, 2],
].filter(Boolean);

let spent = 0;
for (const [tool, rx, ry] of L) {
  const t = at(ox + rx, oy + ry);
  const before = { road: t.road };
  const r = applyAt(s, tool, t);
  if (!r.ok && r.msg) throw new Error(`${tool} @${ox + rx},${oy + ry}: ${r.msg}`);
  if (!r.ok) {
    if (tool.startsWith('road_') && before.road !== 0) continue; // already built
    throw new Error(`${tool} @${ox + rx},${oy + ry} failed silently`);
  }
  spent += r.spent;
}
console.log(`  built test town, spent ${spent}, connected=${s.connected}`);
if (!s.connected) throw new Error('town did not achieve outside connection');

const MONTHS = 60;
for (let m = 1; m <= MONTHS; m++) {
  tick(s);
  if (m === 24) console.log(`  month 24 : pop=${s.pop} jobs=${s.jobsC}/${s.jobsI}/${s.jobsO} happy=${Math.round(s.happy * 100)}% edu=${Math.round(s.edu * 100)}% money=${Math.round(s.money)}`);
}
console.log(`  month ${MONTHS}: pop=${s.pop} jobs=${s.jobsC}/${s.jobsI}/${s.jobsO} happy=${Math.round(s.happy * 100)}% edu=${Math.round(s.edu * 100)}%`);
console.log(`  demand  : R=${Math.round(s.dR * 100)}% C=${Math.round(s.dC * 100)}% I=${Math.round(s.dI * 100)}% O=${Math.round(s.dO * 100)}%`);
console.log(`  power   : ${s.powerUsed}/${s.powerCap} · congestion=${Math.round(s.congestion * 100)}%`);
console.log(`  finances: income=${Math.round(s.income)}/mo upkeep=${Math.round(s.upkeep)}/mo`);
console.log(`  save    : ${JSON.stringify(serialize(s)).length} bytes`);

const fails = [];
if (!s.connected) fails.push('city never connected');
if (s.pop < 40) fails.push(`population only ${s.pop}`);
if (s.jobsO < 5) fails.push(`offices never grew (${s.jobsO} jobs) — education pipeline broken`);
if (s.jobsC + s.jobsI < 30) fails.push(`only ${s.jobsC + s.jobsI} jobs`);
if (s.money < 0) fails.push(`bankrupt (${Math.round(s.money)})`);
if (fails.length) { console.error('\nFAIL:', fails.join(' · ')); process.exit(1); }
console.log(`\nOK — ${MONTHS} months on seed ${s.seed}: connected, growing, educated, solvent.`);
