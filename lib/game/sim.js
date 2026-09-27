/* ============================================================================
   City Builder v2 — headless simulation core (no DOM, no Three.js).
   Everything the UI renders is derived from this state. Testable in Node.
   ============================================================================ */
import { CFG, DIRS4 } from './config.js';
import { mulberry32, makeNoise, clamp, clamp01, lerp } from './utils.js';

const inb = (x, y) => x >= 0 && y >= 0 && x < CFG.W && y < CFG.H;

/* ------------------------------ new city ------------------------------- */
export function newCity(seed) {
  seed = seed == null ? ((Math.random() * 1e9) >>> 0) : seed >>> 0;
  const rng = mulberry32(seed);
  const fbm = makeNoise(rng);
  const W = CFG.W, H = CFG.H;
  const tiles = new Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      let h = fbm(x / 22 + 11.7, y / 22 + 5.2, 4);
      if (edge < 7) h -= (7 - edge) * 0.032;
      let tt = 0;
      if (h >= 0.40) tt = 2;
      else if (h >= 0.355) tt = 1;
      const t = { x, y, i, t: tt, z: 0, road: 0, tree: false, b: null, rev: 0 };
      if (tt === 2) {
        const f2 = fbm(x / 8 + 41.2, y / 8 + 17.9, 3);
        if (f2 > 0.56 && ((hash2s(x + 31, y - 17)) < 0.72)) t.tree = true;
      }
      tiles[i] = t;
    }
  }

  const s = {
    seed, tiles,
    money: CFG.START_MONEY,
    tax: CFG.TAX_DEFAULT,
    cityName: pickCityName(rng),
    tick: 0, month: CFG.DATE0.m, year: CFG.DATE0.y, rank: -1,
    pop: 0, jobsC: 0, jobsI: 0, jobsO: 0,
    dR: 0.55, dC: 0.3, dI: 0.3, dO: 0.2,
    happy: 0.65, edu: 0, congestion: 0,
    income: 0, upkeep: 0,
    powerCap: 0, powerUsed: 0,
    connected: false,
    onAutosave: null, toastPush: null,
    derived: {},
  };

  /* ---- carve the highway outside connection: a stub from a random edge ---- */
  const side = (rng() * 4) | 0; // 0=N 1=E 2=S 3=W
  const along = 14 + ((rng() * (W - 28)) | 0);
  let gx, gy, dx, dy;
  if (side === 0) { gx = along; gy = 0; dx = 0; dy = 1; }
  else if (side === 1) { gx = W - 1; gy = along; dx = -1; dy = 0; }
  else if (side === 2) { gx = along; gy = H - 1; dx = 0; dy = -1; }
  else { gx = 0; gy = along; dx = 1; dy = 0; }
  for (let k = 0; k < 7; k++) {
    const x = gx + dx * k, y = gy + dy * k;
    if (!inb(x, y)) break;
    const t = s.tiles[y * W + x];
    // make land for the stub and a little shoulder on both sides
    for (const [ox, oy] of [[0, 0], [dy, dx], [-dy, -dx]]) {
      const n = s.tiles[(y + oy) * W + (x + ox)];
      if (n && n.t === 0 && Math.abs(ox) + Math.abs(oy) > 0 && hash2s(x * 7 + ox, y * 7 + oy) < 0.4) continue;
      if (n) { if (n.t === 0) n.t = 2; n.tree = false; n.rev++; }
    }
    t.road = 3; t.tree = false; t.z = 0; t.b = null; t.rev++;
  }
  s.gate = { x: gx + dx * 6, y: gy + dy * 6 };   // innermost stub tile
  s.outside = { x: gx, y: gy, dx, dy, side };    // map-edge end (the "world")

  recomputeAll(s);
  return s;
}

function hash2s(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const NAMES1 = ['Alder', 'Ash', 'Birch', 'Cedar', 'Elm', 'Fern', 'Granite', 'Hazel', 'Ivy', 'Juniper', 'Kauri', 'Larch', 'Maple', 'Nikoau', 'Otama', 'Pohutu', 'Rimu', 'Silver', 'Tawa', 'Willow'];
const NAMES2 = ['Bay', 'Creek', 'Falls', 'Glen', 'Harbour', 'Heights', 'Point', 'Ridge', 'Springs', 'Vale', 'View', 'Wells'];
function pickCityName(rng) {
  return NAMES1[(rng() * NAMES1.length) | 0] + ' ' + NAMES2[(rng() * NAMES2.length) | 0];
}

export const tileAt = (s, x, y) => (inb(x, y) ? s.tiles[y * CFG.W + x] : null);
const touch = (t) => { t.rev++; };

/* ------------------------------ sub-models ------------------------------ */

function roadAdj(s, t, kinds) {
  return DIRS4.some(([dx, dy]) => {
    const n = tileAt(s, t.x + dx, t.y + dy);
    return n && n.road && (!kinds || kinds.includes(n.road));
  });
}

/* Power: plants inject, ALL roads carry, buildings adjacent to grid consume. */
function computePower(s) {
  for (const t of s.tiles) t.pw = false;
  let cap = 0, used = 0;
  const q = [], seen = new Uint8Array(CFG.W * CFG.H);
  for (const t of s.tiles) {
    if (t.b && !t.b.site && CFG.BUILDS[t.b.k] && CFG.BUILDS[t.b.k].cat === 'power') {
      cap += CFG.BUILDS[t.b.k].cap;
      t.pw = true; seen[t.i] = 1; q.push(t);
    }
  }
  let qi = 0;
  while (qi < q.length) {
    const t = q[qi++];
    for (const [dx, dy] of DIRS4) {
      const n = tileAt(s, t.x + dx, t.y + dy);
      if (!n || seen[n.i]) continue;
      seen[n.i] = 1;
      if (n.road) { n.pw = true; q.push(n); }
      else if (n.b && !n.pw) {
        const u = powerUse(n.b);
        if (used + u <= cap) { used += u; n.pw = true; q.push(n); }
      }
    }
  }
  s.powerCap = cap; s.powerUsed = used;
}

function powerUse(b) {
  if (b.site) return 1;
  if (CFG.BUILDS[b.k] && CFG.BUILDS[b.k].cat) return 0; // services/utilities don't consume
  const pu = CFG.POWER_USE[b.k];
  return pu ? pu[b.lvl - 1] : 0;
}

/* Outside connection, Cities: Skylines style: BFS from the highway gate
   marks every road tile that can actually reach the outside world (t.conn).
   Zones only grow next to CONNECTED streets. s.connected = any real net. */
function computeConnection(s) {
  for (const t of s.tiles) t.conn = false;
  const g = tileAt(s, s.gate.x, s.gate.y);
  if (!g || g.road !== 3) { s.connected = false; return; }
  g.conn = true;
  const q = [g];
  let n = 0;
  while (q.length) {
    const t = q.pop();
    n++;
    for (const [dx, dy] of DIRS4) {
      const m = tileAt(s, t.x + dx, t.y + dy);
      if (m && m.road && !m.conn) { m.conn = true; q.push(m); }
    }
  }
  s.connected = n >= 5;
}

/* zoned tile touches a connected street/avenue? (highways can't front zones) */
function roadAdjConn(s, t) {
  return DIRS4.some(([dx, dy]) => {
    const n = tileAt(s, t.x + dx, t.y + dy);
    return n && n.road && n.road !== 3 && n.conn;
  });
}

function computePollution(s) {
  for (const t of s.tiles) t.pol = 0;
  const src = [];
  for (const t of s.tiles) {
    if (!t.b || t.b.site) continue;
    if (t.b.k === 'ind') src.push([t, 3, 26]);
    else if (t.b.k === 'coal') src.push([t, 4, 34]);
  }
  for (const [t, r, amt] of src) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > r) continue;
      const n = tileAt(s, t.x + dx, t.y + dy);
      if (n) n.pol = Math.min(100, n.pol + amt * (1 - d / (r + 1)));
    }
  }
}

/* service coverage via BFS along roads from each service building */
function computeServices(s) {
  for (const t of s.tiles) { t.safety = 0; t.health = 0; t.edu = 0; t.parkF = 0; }
  const W = CFG.W;
  for (const t of s.tiles) {
    if (!t.b || t.b.site) continue;
    const def = CFG.BUILDS[t.b.k];
    if (!def || !def.service) continue;

    if (def.service === 'park') {
      for (let dy = -def.radius; dy <= def.radius; dy++) for (let dx = -def.radius; dx <= def.radius; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > def.radius) continue;
        const n = tileAt(s, t.x + dx, t.y + dy);
        if (n) n.parkF = Math.max(n.parkF, 1 - d / (def.radius + 1)) * (def.name === 'City plaza' ? 1.35 : 1);
      }
      continue;
    }

    // road BFS seeded from any road within 2 tiles of the service building
    const seeds = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const n = tileAt(s, t.x + dx, t.y + dy);
      if (n && n.road) seeds.push(n);
    }
    if (!seeds.length) continue;
    const dist = new Int16Array(W * CFG.H).fill(-1);
    const q = [];
    for (const sd of seeds) { dist[sd.i] = 0; q.push(sd); }
    let qi = 0;
    while (qi < q.length) {
      const cur = q[qi++];
      if (dist[cur.i] >= def.radius) continue;
      for (const [dx, dy] of DIRS4) {
        const n = tileAt(s, cur.x + dx, cur.y + dy);
        if (!n || dist[n.i] >= 0 || !n.road) continue;
        dist[n.i] = dist[cur.i] + 1;
        q.push(n);
      }
    }
    for (const r of q) {
      for (const [dx, dy] of DIRS4) {
        const n = tileAt(s, r.x + dx, r.y + dy);
        if (!n || n.road || (n.b && n.b.site)) continue;
        const cov = 1 - dist[r.i] / (def.radius + 1);
        if (def.service === 'safety') n.safety = Math.max(n.safety, cov);
        else if (def.service === 'health') n.health = Math.max(n.health, cov);
        else if (def.service === 'education') n.edu = Math.max(n.edu, cov);
      }
    }
  }
}

function computeLand(s) {
  for (const t of s.tiles) {
    let v = 0.30;
    for (const [dx, dy] of DIRS4) {
      const n = tileAt(s, t.x + dx, t.y + dy);
      if (n && n.t === 0) { v += 0.16; break; }
    }
    if (t.tree) v += 0.05;
    v -= (t.pol / 100) * 0.5;
    v += (t.parkF || 0) * 0.18;
    v += ((t.safety || 0) + (t.health || 0)) * 0.06;
    t.lv = clamp01(v);
  }
}

function computeTotals(s) {
  let pop = 0, jc = 0, ji = 0, jo = 0, eduSum = 0, eduN = 0, hapSum = 0, hapN = 0;
  for (const t of s.tiles) {
    const b = t.b;
    if (!b || b.site || b.ab || b.k !== 'res') continue;
    pop += b.pop;
    eduSum += (t.edu || 0) * b.pop; eduN += b.pop;
    hapSum += t.hap || 0; hapN++;
  }
  for (const t of s.tiles) {
    const b = t.b;
    if (!b || b.site || b.ab) continue;
    if (b.k === 'com') jc += b.jobs;
    else if (b.k === 'ind') ji += b.jobs;
    else if (b.k === 'office') jo += b.jobs;
  }
  s.pop = Math.round(pop);
  s.jobsC = Math.round(jc); s.jobsI = Math.round(ji); s.jobsO = Math.round(jo);
  s.edu = eduN ? eduSum / eduN : 0;
  s.happy = hapN ? hapSum / hapN / 100 : 0.65;
}

function computeDemand(s) {
  const jobs = s.jobsC + s.jobsI + s.jobsO;
  const imm = s.connected ? 120 : 0;
  s.dR = clamp01((jobs * 1.15 + imm - s.pop) / 220);
  s.dC = clamp01((s.pop * 0.30 + 20 - s.jobsC * 1.08) / 60);
  s.dI = clamp01((s.pop * 0.40 + 30 - s.jobsI * 1.08) / 85);
  s.dO = clamp01((s.pop * 0.22 * (0.35 + s.edu * 0.65) + 8 - s.jobsO * 1.08) / 55);
}

function computeHappiness(s) {
  for (const t of s.tiles) {
    if (!(t.b && t.b.k === 'res' && !t.b.site)) continue;
    let h = 58;
    if (!t.pw) h -= 30;
    h += Math.min(20, (t.parkF || 0) * 20);
    h += (t.safety || 0) * 8 + (t.health || 0) * 10;
    h -= Math.max(0, s.tax - 9) * 3.5;
    h -= t.pol * 0.35;
    h -= s.congestion * 12;
    if (t.b.ab) h -= 25;
    h += (hash2s(t.x, t.y) - 0.5) * 6;
    t.hap = clamp(h, 5, 100);
  }
}

/* traffic pressure: people-jobs load vs road capacity */
function computeTraffic(s) {
  let cap = 0;
  for (const t of s.tiles) if (t.road) cap += CFG.ROAD[t.road].cap;
  const load = s.pop + (s.jobsC + s.jobsI + s.jobsO) * 0.8;
  s.congestion = cap > 0 ? clamp01((load / 42) / (cap / 100)) : 0;
}

/* monthly growth pass */
function growPass(s) {
  for (const t of s.tiles) {
    if (t.z === 0 || t.road) continue;
    const zk = t.z === 1 ? 'res' : t.z === 2 ? 'com' : t.z === 3 ? 'ind' : 'office';
    const dem = zk === 'res' ? s.dR : zk === 'com' ? s.dC : zk === 'ind' ? s.dI : s.dO;

    if (!t.b) {
      if (!s.connected) continue;
      if (dem < 0.22 || !roadAdjConn(s, t) || !powerNear(s, t)) continue;
      if (zk === 'office' && (t.edu || 0) < 0.15) continue;
      if (Math.random() < dem * 0.45) {
        t.b = { k: zk, lvl: 1, age: 0, pop: 0, jobs: 0, site: true, siteT: 2 + ((Math.random() * 3) | 0), ab: false, npw: 0 };
        touch(t);
      }
      continue;
    }

    const b = t.b;
    b.age++;

    if (b.site) {
      if (--b.siteT <= 0) {
        b.site = false;
        if (b.k === 'res') b.pop = Math.round(CFG.POP_CAP[1] * 0.35);
        else b.jobs = Math.round(CFG.JOB_CAP[b.k][1] * 0.35);
        touch(t);
      }
      continue;
    }

    if (b.k !== 'park' && b.k !== 'plaza' && !t.pw) {
      b.npw = (b.npw || 0) + 1;
      if (b.npw >= 2 && Math.random() < 0.22) { b.ab = true; touch(t); }
      continue;
    }
    b.npw = 0;

    if (b.ab) {
      if (t.pw && Math.random() < 0.25) { b.ab = false; touch(t); }
      continue;
    }

    const hapF = (b.k === 'res' ? t.hap : 40 + s.happy * 60) / 100;
    if (b.k === 'res') {
      const cap = CFG.POP_CAP[b.lvl];
      if (b.pop < cap) { b.pop = Math.min(cap, b.pop + (1.5 + Math.random() * 2.5) * Math.max(0.25, dem) * hapF); touch(t); }
      if (b.lvl < 3 && dem > 0.35 && t.hap > 58 && t.lv > (b.lvl === 1 ? 0.55 : 0.72) && b.age > 10 && b.pop >= cap * 0.92 && Math.random() < 0.05) { b.lvl++; touch(t); }
      if (t.hap < 30 && Math.random() < 0.04) { b.ab = true; touch(t); }
    } else {
      const cap = CFG.JOB_CAP[b.k][b.lvl];
      if (b.jobs < cap) { b.jobs = Math.min(cap, b.jobs + (1.5 + Math.random() * 3) * Math.max(0.25, dem) * hapF); touch(t); }
      if (b.lvl < 3 && dem > 0.35 && b.age > 10 && b.jobs >= cap * 0.92 && Math.random() < 0.05) {
        if (b.k !== 'office' || (t.edu || 0) > 0.35) { b.lvl++; touch(t); }
      }
    }
  }
}

function powerNear(s, t) {
  return DIRS4.some(([dx, dy]) => {
    const n = tileAt(s, t.x + dx, t.y + dy);
    return n && n.pw && (n.road || n.b);
  });
}

function budget(s) {
  const tf = s.tax / 9;
  const income = (s.pop * 0.9 + s.jobsC * 1.4 + s.jobsI * 1.1 + s.jobsO * 1.7) * tf;
  let up = 0;
  for (const t of s.tiles) {
    if (t.road) up += CFG.ROAD[t.road].upkeep;
    if (t.b && !t.b.site) { const u = CFG.BUILDS[t.b.k]; if (u && u.upkeep) up += u.upkeep; }
  }
  s.income = income; s.upkeep = up;
  s.money += income - up;
}

function milestones(s) {
  while (s.rank + 1 < CFG.MILESTONES.length && s.pop >= CFG.MILESTONES[s.rank + 1].pop) {
    s.rank++;
    const ms = CFG.MILESTONES[s.rank];
    s.money += ms.grant;
    if (s.toastPush) s.toastPush(`🏆 ${s.cityName} grew into a ${ms.name}! Bonus ${fmt$(ms.grant)}`);
  }
}

import { fmt$ } from './utils.js';

export function recomputeAll(s) {
  computeConnection(s);
  computePower(s);
  computePollution(s);
  computeServices(s);
  computeLand(s);
  computeTotals(s);
  computeDemand(s);
  computeHappiness(s);
  computeTraffic(s);
}

export function tick(s) {
  s.tick++;
  s.month++;
  if (s.month > 12) { s.month = 1; s.year++; }
  recomputeAll(s);
  growPass(s);
  budget(s);
  milestones(s);
  if (s.tick % CFG.AUTOSAVE_MONTHS === 0 && s.onAutosave) s.onAutosave();
}

/* --------------------------- tool application --------------------------- */
/* tools: 'road_street'|'road_avenue'|'road_highway', 'zone_res'...,
   build keys from CFG.BUILDS, 'pan', 'bulldoze' */
export function applyAt(s, tool, t) {
  if (!t || t.t === 0) {
    if (tool !== 'pan' && tool !== 'bulldoze') return { ok: false, spent: 0, msg: "Can't build on water" };
    return { ok: false, spent: 0 };
  }
  if (tool === 'pan') return { ok: false, spent: 0 };

  if (tool.startsWith('road_')) {
    const rt = CFG.ROAD[tool === 'road_street' ? 1 : tool === 'road_avenue' ? 2 : 3];
    if (t.road === rt.id) return { ok: false, spent: 0 };
    if (t.b) return { ok: false, spent: 0, msg: 'Demolish the building first' };
    if (s.money < rt.cost) return { ok: false, spent: 0, msg: 'Not enough money for roads' };
    t.tree = false; t.z = 0; t.road = rt.id; touch(t);
    s.money -= rt.cost;
    computeConnection(s);
    return { ok: true, spent: rt.cost };
  }

  if (tool.startsWith('zone_')) {
    const zk = tool.slice(5);
    const z = CFG.ZONES[zk];
    if (t.road || t.b) return { ok: false, spent: 0 };
    if (t.z === z.id) return { ok: false, spent: 0 };
    if (s.money < z.cost) return { ok: false, spent: 0, msg: 'Not enough money' };
    t.tree = false; t.z = z.id; touch(t);
    s.money -= z.cost;
    return { ok: true, spent: z.cost };
  }

  if (CFG.BUILDS[tool]) {
    if (t.road || t.b) return { ok: false, spent: 0 };
    const def = CFG.BUILDS[tool];
    if (s.money < def.cost) return { ok: false, spent: 0, msg: `Not enough money for ${def.name.toLowerCase()}` };
    t.tree = false; t.z = 0;
    t.b = { k: tool, lvl: 1, age: 0, pop: 0, jobs: 0, site: false, siteT: 0, ab: false, npw: 0 };
    touch(t);
    s.money -= def.cost;
    return { ok: true, spent: def.cost };
  }

  if (tool === 'bulldoze') {
    if (!t.road && !t.b && !t.z && !t.tree) return { ok: false, spent: 0 };
    if (s.money < CFG.COST_BULL) { }
    if (s.money < 2) return { ok: false, spent: 0, msg: 'Not enough money' };
    const wasGate = t.road === 3 && nearGate(s, t);
    t.road = 0; t.b = null; t.z = 0; t.tree = false; touch(t);
    s.money -= 2;
    computeConnection(s);
    if (wasGate && !s.connected && s.toastPush) s.toastPush('⚠️ You bulldozed the highway connection! Nobody can move in or out.', 'warn');
    return { ok: true, spent: 2 };
  }

  return { ok: false, spent: 0 };
}
CFG.COST_BULL = 2;
function nearGate(s, t) {
  return Math.abs(t.x - s.gate.x) + Math.abs(t.y - s.gate.y) <= 8;
}

/* ----------------------------- serialize ------------------------------- */
export function serialize(s) {
  return {
    v: 3,
    seed: s.seed,
    cityName: s.cityName,
    money: Math.round(s.money),
    tax: s.tax,
    tick: s.tick, month: s.month, year: s.year, rank: s.rank,
    tiles: s.tiles.map((t) => [
      t.t, t.z, t.road, t.tree ? 1 : 0,
      t.b ? [t.b.k, t.b.lvl, t.b.age, Math.round(t.b.pop), Math.round(t.b.jobs), t.b.site ? 1 : 0, t.b.siteT || 0, t.b.ab ? 1 : 0] : 0,
    ]),
  };
}

export function deserialize(d) {
  if (!d || d.v !== 3 || !Array.isArray(d.tiles) || d.tiles.length !== CFG.W * CFG.H) {
    throw new Error('Incompatible save file');
  }
  const s = newCity(d.seed);
  s.cityName = d.cityName || s.cityName;
  s.money = d.money; s.tax = d.tax ?? CFG.TAX_DEFAULT;
  s.tick = d.tick || 0; s.month = clamp(d.month || 1, 1, 12); s.year = d.year || CFG.DATE0.y;
  s.rank = typeof d.rank === 'number' ? d.rank : -1;
  for (let i = 0; i < d.tiles.length; i++) {
    const [tt, z, rd, tr, b] = d.tiles[i];
    const t = s.tiles[i];
    t.t = tt; t.z = z; t.road = rd; t.tree = !!tr;
    if (b) t.b = { k: b[0], lvl: b[1], age: b[2], pop: b[3], jobs: b[4], site: !!b[5], siteT: b[6] || 0, ab: !!b[7], npw: 0 };
    t.rev++;
  }
  recomputeAll(s);
  return s;
}
