/* ============================================================================
   CITY BUILDER — isometric city-building game engine
   ----------------------------------------------------------------------------
   Framework-free simulation + Canvas renderer, mounted by <GameCanvas/>.
   The simulation core is headless-testable: newCity / tick / applyAt /
   serialize / deserialize never touch the DOM (see test/sim-test.mjs).

   Map ....... a procedural island of 72x72 tiles (grass / sand / water / trees)
   Roads ..... buildings must touch a road; roads also carry the power grid
   Zones ..... paint residential / commercial / industrial; buildings grow
               on zoned land when there is demand (RCI) + power + road access
   Power ..... plants inject capacity, BFS spreads it along roads, buildings
               consume it. Over capacity = brownouts at the edge of town.
   Economy ... monthly taxes on population & jobs, upkeep on infrastructure
   Happiness . parks, pollution, taxes and power drive growth & level-ups
   ============================================================================ */

/* ------------------------------- CONFIG ------------------------------- */

export const CFG = {
  W: 72,
  H: 72,
  TILE_W: 64,
  TILE_H: 32,
  START_MONEY: 25000,
  TAX_DEFAULT: 9,
  ZOOM_MIN: 0.45,
  ZOOM_MAX: 2.6,
  TICK_SECONDS: 2.0, // real seconds per in-game month at 1x speed
  AUTOSAVE_MONTHS: 12,
  SAVE_KEY: 'citybuilder.save.v1',

  COST: {
    road: 15,
    zone: 4,
    bulldoze: 2,
    park: 150,
    coal: 3000,
    wind: 1400,
  },
  UPKEEP: { road: 0.08, park: 2, coal: 60, wind: 15 }, // $ per month
  POWER_CAP: { coal: 140, wind: 30 },
  POWER_USE: { res: [2, 4, 8], com: [3, 6, 12], ind: [5, 12, 22], park: 0 },
  POP_CAP: [0, 8, 22, 48],            // residents per residential level
  JOB_CAP: { com: [0, 8, 18, 34], ind: [0, 12, 26, 45] },
  DATE0: { m: 3, y: 2026 },
  MILESTONES: [
    { pop: 100, name: 'Hamlet', grant: 2000 },
    { pop: 500, name: 'Village', grant: 3000 },
    { pop: 1500, name: 'Town', grant: 5000 },
    { pop: 5000, name: 'City', grant: 10000 },
    { pop: 15000, name: 'Metropolis', grant: 25000 },
  ],
};

export const TOOLS = [
  { id: 'pan', name: 'Pan', icon: '🖐️', cost: 0, key: 'q', hint: 'Drag to move around the map. Scroll to zoom. Pick a tool to start building!' },
  { id: 'road', name: 'Road', icon: '🛣️', cost: CFG.COST.road, key: '1', hint: 'Drag to lay roads. Every building needs a road next to it — and roads carry power lines.' },
  { id: 'res', name: 'Homes', icon: '🏠', cost: CFG.COST.zone, key: '2', hint: 'Zone residential land. Houses grow when housing demand (green bar) is high.' },
  { id: 'com', name: 'Shops', icon: '🏬', cost: CFG.COST.zone, key: '3', hint: 'Zone commercial land. Shops hire workers and serve your population.' },
  { id: 'ind', name: 'Industry', icon: '🏭', cost: CFG.COST.zone, key: '4', hint: 'Zone industrial land. Lots of jobs — but pollution hurts nearby homes.' },
  { id: 'park', name: 'Park', icon: '🌳', cost: CFG.COST.park, key: '5', hint: 'Parks raise land value and happiness nearby. Homes need high land value to level up.' },
  { id: 'coal', name: 'Coal plant', icon: '⚡', cost: CFG.COST.coal, key: '6', hint: 'Produces 140 units of power through the road grid. Cheap, but pollutes the area.' },
  { id: 'wind', name: 'Wind turbine', icon: '🌀', cost: CFG.COST.wind, key: '7', hint: 'Clean power: 30 units. Place several for a green grid.' },
  { id: 'bulldoze', name: 'Bulldoze', icon: '💥', cost: CFG.COST.bulldoze, key: '8', hint: 'Demolish buildings, roads and zones.' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TERRAIN_NAME = ['Water', 'Sand', 'Grass'];
const ZONE_NAME = [null, 'Residential', 'Commercial', 'Industrial'];
const BUILD_NAME = { res: 'Residents', com: 'Shops', ind: 'Industry', park: 'Park', coal: 'Coal plant', wind: 'Wind turbine' };
const CAR_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#ecf0f1', '#9b59b6', '#2ecc71', '#e67e22'];
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* ------------------------------- UTILS -------------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;

function makeNoise(rng) {
  const size = 256;
  const perm = new Uint8Array(size * 2);
  const vals = new Float32Array(size);
  for (let i = 0; i < size; i++) { perm[i] = i; vals[i] = rng(); }
  for (let i = size - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < size; i++) perm[size + i] = perm[i];
  const val = (ix, iy) => vals[perm[(ix & 255) + perm[iy & 255]]];
  const smooth = (t) => t * t * (3 - 2 * t);
  return function fbm(x, y, oct) {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const a = val(ix, iy), b = val(ix + 1, iy), c = val(ix, iy + 1), d = val(ix + 1, iy + 1);
      const u = smooth(fx), v = smooth(fy);
      s += lerp(lerp(a, b, u), lerp(c, d, u), v) * amp;
      norm += amp; amp *= 0.5; f *= 2;
      x *= 2; y *= 2;
    }
    return s / norm;
  };
}

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-US');

/* ------------------------------- STATE -------------------------------- */

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
      let tt = 0; // water
      if (h >= 0.40) tt = 2; // grass
      else if (h >= 0.355) tt = 1; // sand
      const t = { x, y, i, t: tt, z: 0, road: false, tree: false, b: null, pw: false, pol: 0, lv: 0.3, hap: 0, npw: 0 };
      if (tt === 2) {
        const f2 = fbm(x / 8 + 41.2, y / 8 + 17.9, 3);
        if (f2 > 0.56 && hash2(x + 31, y - 17) < 0.72) t.tree = true;
      }
      tiles[i] = t;
    }
  }

  const s = {
    seed,
    tiles,
    money: CFG.START_MONEY,
    tax: CFG.TAX_DEFAULT,
    tick: 0,
    month: CFG.DATE0.m,
    year: CFG.DATE0.y,
    rank: -1,
    pop: 0, jobsC: 0, jobsI: 0,
    dR: 0.55, dC: 0.35, dI: 0.35,
    happy: 0.65,
    income: 0, upkeep: 0,
    powerCap: 0, powerUsed: 0,
    roads: [],
    cars: [],
    onAutosave: null,
    toastPush: null,
  };
  recomputeAll(s);
  return s;
}

const inb = (x, y) => x >= 0 && y >= 0 && x < CFG.W && y < CFG.H;
const tileAt = (s, x, y) => (inb(x, y) ? s.tiles[y * CFG.W + x] : null);

function roadAdj(s, t) {
  return DIRS4.some(([dx, dy]) => { const n = tileAt(s, t.x + dx, t.y + dy); return n && n.road; });
}

/* True when the power grid (powered road or powered building) reaches an
   adjacent tile — used when deciding whether construction can start. */
function powerNear(s, t) {
  return DIRS4.some(([dx, dy]) => {
    const n = tileAt(s, t.x + dx, t.y + dy);
    return n && n.pw && (n.road || n.b);
  });
}

function roadNeighbors(s, t) {
  const out = [];
  for (const [dx, dy] of DIRS4) { const n = tileAt(s, t.x + dx, t.y + dy); if (n && n.road) out.push(n); }
  return out;
}

function powerUse(b) {
  if (b.site) return 1;
  if (b.k === 'park') return CFG.POWER_USE.park;
  if (b.k === 'res') return CFG.POWER_USE.res[b.lvl - 1];
  if (b.k === 'com') return CFG.POWER_USE.com[b.lvl - 1];
  if (b.k === 'ind') return CFG.POWER_USE.ind[b.lvl - 1];
  return 0; // plants produce
}

function recomputeAll(s) {
  computePower(s);
  computePollution(s);
  computeLand(s);
  computeTotals(s);
  computeDemand(s);
  computeHappiness(s);
  s.roads = s.tiles.filter((t) => t.road);
}

/* --------------------------- SIM SUBSYSTEMS ---------------------------- */

/* Power: plants inject capacity -> BFS spreads along roads -> buildings
   adjacent to the grid consume units. When capacity runs out the far edge
   of town goes dark (brownout). */
export function computePower(s) {
  const W = CFG.W;
  for (const t of s.tiles) t.pw = false;
  let cap = 0, used = 0;
  const queue = [];
  const seen = new Uint8Array(CFG.W * CFG.H);

  for (const t of s.tiles) {
    if (t.b && !t.b.site && (t.b.k === 'coal' || t.b.k === 'wind')) {
      cap += CFG.POWER_CAP[t.b.k];
      t.pw = true; seen[t.i] = 1; queue.push(t);
    }
  }

  let qi = 0;
  while (qi < queue.length) {
    const t = queue[qi++];
    for (const [dx, dy] of DIRS4) {
      const n = tileAt(s, t.x + dx, t.y + dy);
      if (!n || seen[n.i]) continue;
      seen[n.i] = 1;
      if (n.road) { n.pw = true; queue.push(n); }
      else if (n.b && !n.pw) {
        const u = powerUse(n.b);
        if (used + u <= cap) { used += u; n.pw = true; if (n.b) queue.push(n); }
      }
    }
  }
  s.powerCap = cap; s.powerUsed = used;
}

function computePollution(s) {
  for (const t of s.tiles) t.pol = 0;
  const sources = [];
  for (const t of s.tiles) {
    if (!t.b || t.b.site) continue;
    if (t.b.k === 'ind') sources.push([t, 2, 26]);
    else if (t.b.k === 'coal') sources.push([t, 3, 34]);
  }
  for (const [t, r, amt] of sources) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > r) continue;
        const n = tileAt(s, t.x + dx, t.y + dy);
        if (!n) continue;
        n.pol = Math.min(100, n.pol + amt * (1 - d / (r + 1)));
      }
    }
  }
}

function computeLand(s) {
  for (const t of s.tiles) {
    let v = 0.32;
    for (const [dx, dy] of DIRS4) {
      const n = tileAt(s, t.x + dx, t.y + dy);
      if (n && n.t === 0) { v += 0.16; break; } // water view
    }
    if (t.tree) v += 0.06;
    v -= (t.pol / 100) * 0.5;
    t.lv = v;
  }
  for (const t of s.tiles) {
    if (!(t.b && t.b.k === 'park' && !t.b.site)) continue;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > 3) continue;
        const n = tileAt(s, t.x + dx, t.y + dy);
        if (n) n.lv += 0.12 * (1 - d / 4);
      }
    }
  }
  for (const t of s.tiles) t.lv = clamp01(t.lv);
}

function computeTotals(s) {
  let pop = 0, jc = 0, ji = 0;
  for (const t of s.tiles) {
    const b = t.b;
    if (!b || b.site || b.ab) continue;
    if (b.k === 'res') pop += b.pop;
    else if (b.k === 'com') jc += b.jobs;
    else if (b.k === 'ind') ji += b.jobs;
  }
  s.pop = Math.round(pop); s.jobsC = Math.round(jc); s.jobsI = Math.round(ji);
}

function computeDemand(s) {
  const jobs = s.jobsC + s.jobsI;
  s.dR = clamp01((jobs * 1.15 + 120 - s.pop) / 220);
  s.dC = clamp01((s.pop * 0.32 + 20 - s.jobsC * 1.08) / 60);
  s.dI = clamp01((s.pop * 0.42 + 30 - s.jobsI * 1.08) / 85);
}

function computeHappiness(s) {
  let sum = 0, n = 0;
  for (const t of s.tiles) {
    if (!(t.b && t.b.k === 'res' && !t.b.site)) continue;
    let h = 62;
    if (!t.pw) h -= 30;
    let pk = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const m = tileAt(s, t.x + dx, t.y + dy);
        if (m && m.b && m.b.k === 'park' && !m.b.site) pk++;
      }
    }
    h += Math.min(21, pk * 7);
    h -= Math.max(0, s.tax - 9) * 3.5;
    h -= t.pol * 0.35;
    if (t.b.ab) h -= 25;
    h += (hash2(t.x, t.y) - 0.5) * 6;
    t.hap = clamp(h, 5, 100);
    sum += t.hap; n++;
  }
  s.happy = n ? sum / n / 100 : 0.65;
}

/* Monthly growth pass: construction starts, sites finish, buildings fill
   up toward capacity, level up on high land value, and abandon when
   starved of power or happiness. */
function growPass(s) {
  for (const t of s.tiles) {
    if (t.z === 0 || t.road) continue;
    const zk = t.z === 1 ? 'res' : t.z === 2 ? 'com' : 'ind';
    const dem = zk === 'res' ? s.dR : zk === 'com' ? s.dC : s.dI;

    if (!t.b) {
      if (dem < 0.22 || !roadAdj(s, t) || !powerNear(s, t)) continue;
      if (Math.random() < dem * 0.45) {
        t.b = { k: zk, lvl: 1, age: 0, pop: 0, jobs: 0, site: true, siteT: 2 + ((Math.random() * 3) | 0), ab: false, npw: 0 };
      }
      continue;
    }

    const b = t.b;
    b.age++;

    if (b.site) {
      if (--b.siteT <= 0) {
        b.site = false;
        if (b.k === 'res') b.pop = Math.round(CFG.POP_CAP[1] * 0.35);
        else if (b.k === 'com') b.jobs = Math.round(CFG.JOB_CAP.com[1] * 0.35);
        else b.jobs = Math.round(CFG.JOB_CAP.ind[1] * 0.35);
      }
      continue;
    }

    if (b.k !== 'park' && !t.pw) {
      b.npw = (b.npw || 0) + 1;
      if (b.npw >= 2 && Math.random() < 0.22) b.ab = true;
      continue;
    }
    b.npw = 0;

    if (b.ab) {
      if (t.pw && Math.random() < 0.25) b.ab = false;
      continue;
    }

    const hapF = (b.k === 'res' ? t.hap : 40 + s.happy * 60) / 100;
    if (b.k === 'res') {
      const cap = CFG.POP_CAP[b.lvl];
      if (b.pop < cap) b.pop = Math.min(cap, b.pop + (1.5 + Math.random() * 2.5) * Math.max(0.25, dem) * hapF);
      if (b.lvl < 3 && dem > 0.4 && t.hap > 58 && t.lv > (b.lvl === 1 ? 0.55 : 0.75) && b.age > 10 && b.pop >= cap * 0.92 && Math.random() < 0.05) b.lvl++;
      if (t.hap < 30 && Math.random() < 0.04) b.ab = true;
    } else {
      const cap = CFG.JOB_CAP[b.k][b.lvl];
      if (b.jobs < cap) b.jobs = Math.min(cap, b.jobs + (1.5 + Math.random() * 3) * Math.max(0.25, dem) * hapF);
      if (b.lvl < 3 && dem > 0.4 && s.happy > 0.55 && b.age > 10 && b.jobs >= cap * 0.92 && Math.random() < 0.05) b.lvl++;
    }
  }
}

function budget(s) {
  const tf = s.tax / 9;
  const income = (s.pop * 0.9 + s.jobsC * 1.4 + s.jobsI * 1.1) * tf;
  let up = 0;
  for (const t of s.tiles) {
    if (t.road) up += CFG.UPKEEP.road;
    if (t.b && !t.b.site) { const u = CFG.UPKEEP[t.b.k]; if (u) up += u; }
  }
  s.income = income;
  s.upkeep = up;
  s.money += income - up;
}

function milestones(s) {
  while (s.rank + 1 < CFG.MILESTONES.length && s.pop >= CFG.MILESTONES[s.rank + 1].pop) {
    s.rank++;
    const ms = CFG.MILESTONES[s.rank];
    s.money += ms.grant;
    if (s.toastPush) s.toastPush(`🏆 ${s.cityName || 'Your town'} grew into a ${ms.name}! Bonus ${fmt$(ms.grant)}`);
  }
}

/* ------------------------------ THE TICK ------------------------------- */

export function tick(s) {
  s.tick++;
  s.month++;
  if (s.month > 12) { s.month = 1; s.year++; }
  computePower(s);
  computePollution(s);
  computeLand(s);
  computeTotals(s);
  computeDemand(s);
  computeHappiness(s);
  growPass(s);
  budget(s);
  milestones(s);
  s.roads = s.tiles.filter((t) => t.road);
  if (s.tick % CFG.AUTOSAVE_MONTHS === 0 && s.onAutosave) s.onAutosave();
}

/* --------------------------- TOOL APPLICATION -------------------------- */
/* Pure headless logic shared by the UI and the simulation test.
   Returns { ok, spent, msg? }. */

export function applyAt(s, tool, t) {
  if (!t || t.t === 0) return { ok: false, spent: 0, msg: tool === 'road' || tool === 'bulldoze' ? null : "Can't build on water" };
  if (tool === 'pan') return { ok: false, spent: 0 };

  if (tool === 'road') {
    if (t.road) return { ok: false, spent: 0 };
    if (t.b) return { ok: false, spent: 0, msg: 'Demolish the building first' };
    if (s.money < CFG.COST.road) return { ok: false, spent: 0, msg: 'Not enough money for roads' };
    t.tree = false; t.z = 0; t.road = true;
    s.money -= CFG.COST.road;
    return { ok: true, spent: CFG.COST.road };
  }

  if (tool === 'res' || tool === 'com' || tool === 'ind') {
    if (t.road || t.b) return { ok: false, spent: 0 };
    const zid = tool === 'res' ? 1 : tool === 'com' ? 2 : 3;
    if (t.z === zid) return { ok: false, spent: 0 };
    if (s.money < CFG.COST.zone) return { ok: false, spent: 0, msg: 'Not enough money' };
    t.tree = false; t.z = zid;
    s.money -= CFG.COST.zone;
    return { ok: true, spent: CFG.COST.zone };
  }

  if (tool === 'park' || tool === 'coal' || tool === 'wind') {
    if (t.road || t.b) return { ok: false, spent: 0 };
    const c = CFG.COST[tool];
    if (s.money < c) return { ok: false, spent: 0, msg: `Not enough money for ${BUILD_NAME[tool].toLowerCase()}` };
    t.tree = false; t.z = 0;
    t.b = { k: tool, lvl: 1, age: 0, pop: 0, jobs: 0, site: false, siteT: 0, ab: false, npw: 0 };
    s.money -= c;
    return { ok: true, spent: c };
  }

  if (tool === 'bulldoze') {
    if (!t.road && !t.b && !t.z && !t.tree) return { ok: false, spent: 0 };
    if (s.money < CFG.COST.bulldoze) return { ok: false, spent: 0, msg: 'Not enough money' };
    t.road = false; t.b = null; t.z = 0; t.tree = false;
    s.money -= CFG.COST.bulldoze;
    return { ok: true, spent: CFG.COST.bulldoze };
  }

  return { ok: false, spent: 0 };
}

/* --------------------------- SAVE / SERIALIZE -------------------------- */

export function serialize(s) {
  return {
    v: 1,
    seed: s.seed,
    money: Math.round(s.money),
    tax: s.tax,
    tick: s.tick,
    month: s.month,
    year: s.year,
    rank: s.rank,
    tiles: s.tiles.map((t) => [
      t.t, t.z, t.road ? 1 : 0, t.tree ? 1 : 0,
      t.b ? [t.b.k, t.b.lvl, t.b.age, Math.round(t.b.pop), Math.round(t.b.jobs), t.b.site ? 1 : 0, t.b.siteT || 0, t.b.ab ? 1 : 0] : 0,
    ]),
  };
}

export function deserialize(d) {
  if (!d || d.v !== 1 || !Array.isArray(d.tiles) || d.tiles.length !== CFG.W * CFG.H) {
    throw new Error('Incompatible save file');
  }
  const s = newCity(d.seed);
  s.money = d.money; s.tax = d.tax ?? CFG.TAX_DEFAULT;
  s.tick = d.tick || 0; s.month = clamp(d.month || 1, 1, 12); s.year = d.year || CFG.DATE0.y;
  s.rank = typeof d.rank === 'number' ? d.rank : -1;
  for (let i = 0; i < d.tiles.length; i++) {
    const [tt, z, rd, tr, b] = d.tiles[i];
    const t = s.tiles[i];
    t.t = tt; t.z = z; t.road = !!rd; t.tree = !!tr;
    if (b) t.b = { k: b[0], lvl: b[1], age: b[2], pop: b[3], jobs: b[4], site: !!b[5], siteT: b[6] || 0, ab: !!b[7], npw: 0 };
  }
  recomputeAll(s);
  return s;
}

/* ============================================================================
   GAME CLIENT — everything below runs inside createGame() and owns the DOM.
   ============================================================================ */

export function createGame(canvas, root) {
  const ctx = canvas.getContext('2d');
  canvas.className = 'cb-canvas';

  /* ------------------------- client-side state ------------------------- */
  let s = null;
  let tool = 'pan';
  let overlay = null;
  let paused = false;
  let speed = 1;

  let cam = { x: 0, y: 0, z: 1.05 };
  let camInit = false;
  let vw = 0, vh = 0, DPR = 1;

  let hoverTile = null;
  let mouse = { x: -1, y: -1, inside: false };
  let painting = false, panning = false, panLast = null, lastPaint = null;
  let pinch = null;
  const pts = new Map();
  const keys = {};
  const warned = {};

  let acc = 0;
  let lastT = performance.now();
  let raf = 0;
  const disposers = [];

  /* ------------------------------ storage ------------------------------ */
  let memSave = null;
  function store() { try { return window.localStorage; } catch (e) { return null; } }

  function saveLocal(auto) {
    const data = JSON.stringify(serialize(s));
    const ls = store();
    if (!ls) { memSave = data; if (!auto) toast('Storage is blocked in this preview — use Export to keep a copy ⬇️', 'warn'); return false; }
    try { ls.setItem(CFG.SAVE_KEY, data); if (!auto) toast('City saved 💾'); return true; }
    catch (e) { memSave = data; if (!auto) toast('Save failed (storage full?) — try Export instead', 'warn'); return false; }
  }

  function loadLocal() {
    const ls = store();
    const raw = ls ? ls.getItem(CFG.SAVE_KEY) : memSave;
    if (!raw) return null;
    try { return deserialize(JSON.parse(raw)); } catch (e) { return null; }
  }

  function exportSave() {
    try {
      const blob = new Blob([JSON.stringify(serialize(s))], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `city-builder-save-${s.year}-${String(s.month).padStart(2, '0')}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Save exported ⬇️');
    } catch (e) { toast('Export blocked in this preview', 'warn'); }
  }

  function importSave(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const ns = deserialize(JSON.parse(String(rd.result)));
        s = ns; wireState(); updateHUD();
        toast('City loaded 📂');
      } catch (e) { toast('That file is not a valid save', 'warn'); }
    };
    rd.readAsText(file);
  }

  /* ------------------------------ camera ------------------------------- */
  const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); disposers.push(() => el.removeEventListener(ev, fn, opt)); };

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    vw = root.clientWidth || window.innerWidth;
    vh = root.clientHeight || window.innerHeight;
    canvas.width = Math.round(vw * DPR);
    canvas.height = Math.round(vh * DPR);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    if (!camInit && vw > 0) {
      camInit = true;
      const cx = CFG.W / 2, cy = CFG.H / 2;
      cam.x = vw / 2 - (cx - cy) * 32 * cam.z;
      cam.y = vh / 2 - (cx + cy) * 16 * cam.z;
    }
  }

  function screenToWorldF(sx, sy) {
    const a = (sx - cam.x) / (32 * cam.z);
    const b = (sy - cam.y) / (16 * cam.z);
    return { wx: (a + b) / 2, wy: (b - a) / 2 };
  }

  function tileFromScreen(sx, sy) {
    const { wx, wy } = screenToWorldF(sx, sy);
    const x = Math.round(wx), y = Math.round(wy);
    return inb(x, y) ? s.tiles[y * CFG.W + x] : null;
  }

  function zoomAt(mx, my, f) {
    const w0 = screenToWorldF(mx, my);
    cam.z = clamp(cam.z * f, CFG.ZOOM_MIN, CFG.ZOOM_MAX);
    cam.x = mx - (w0.wx - w0.wy) * 32 * cam.z;
    cam.y = my - (w0.wx + w0.wy) * 16 * cam.z;
  }

  /* ------------------------------ painting ----------------------------- */
  function warnOnce(key, msg) {
    if (!msg || warned[key]) return;
    warned[key] = true;
    toast(msg, 'warn');
    setTimeout(() => { delete warned[key]; }, 2500);
  }

  function applyToolAt(t) {
    const r = applyAt(s, tool, t);
    if (r.msg) warnOnce(tool + r.msg, r.msg);
    return r;
  }

  function lineTiles(a, b, fn) { // Bresenham
    let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      const t = tileAt(s, x0, y0);
      if (t) fn(t);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function paintTo(t) {
    if (!lastPaint) { applyToolAt(t); lastPaint = t; return; }
    if (t === lastPaint) return;
    lineTiles(lastPaint, t, (tt) => applyToolAt(tt));
    lastPaint = t;
  }

  function finishStroke() {
    if (tool !== 'pan') { computePower(s); computePollution(s); computeLand(s); computeHappiness(s); }
    updateHUD();
  }

  /* ------------------------------ cars --------------------------------- */
  function stepCars(dt) {
    const roads = s.roads;
    const target = Math.min(46, Math.floor(roads.length / 5));
    if (roads.length > 3 && s.cars.length < target && Math.random() < dt * 2.5) {
      const t = roads[(Math.random() * roads.length) | 0];
      const nbs = roadNeighbors(s, t);
      if (nbs.length) {
        const n = nbs[(Math.random() * nbs.length) | 0];
        s.cars.push({ x: t.x, y: t.y, nx: n.x, ny: n.y, t: 0, sp: 1.1 + Math.random() * 1.2, col: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0], life: 50 + Math.random() * 120 });
      }
    }
    for (let i = s.cars.length - 1; i >= 0; i--) {
      const c = s.cars[i];
      c.life -= dt;
      const here = tileAt(s, c.x, c.y), next = tileAt(s, c.nx, c.ny);
      if (!here || !next || !here.road || !next.road || c.life <= 0) { s.cars.splice(i, 1); continue; }
      c.t += dt * c.sp;
      if (c.t >= 1) {
        const px = c.x, py = c.y;
        c.x = c.nx; c.y = c.ny; c.t = 0;
        const nbs = roadNeighbors(s, tileAt(s, c.x, c.y));
        if (!nbs.length) { s.cars.splice(i, 1); continue; }
        const dx = c.x - px, dy = c.y - py;
        const straight = tileAt(s, c.x + dx, c.y + dy);
        const pick = straight && straight.road && Math.random() < 0.65 ? straight : nbs[(Math.random() * nbs.length) | 0];
        c.nx = pick.x; c.ny = pick.y;
      }
    }
  }

  /* ---------------------------- render helpers -------------------------- */
  function diamond(sx, sy, TW2, TH2) {
    ctx.beginPath();
    ctx.moveTo(sx, sy - TH2);
    ctx.lineTo(sx + TW2, sy);
    ctx.lineTo(sx, sy + TH2);
    ctx.lineTo(sx - TW2, sy);
    ctx.closePath();
  }

  function diamondFill(sx, sy, TW2, TH2, color) {
    diamond(sx, sy, TW2, TH2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function tileFill(t, now) {
    const v = hash2(t.x, t.y);
    if (t.t === 0) {
      const ph = Math.sin(now * 0.0011 + t.x * 0.7 + t.y * 1.1);
      return `hsl(203 60% ${37 + ph * 5 + v * 3}%)`;
    }
    if (t.t === 1) return `hsl(47 40% ${66 + v * 9}%)`;
    return `hsl(${96 + v * 16} ${38 + v * 10}% ${30 + v * 8}%)`;
  }

  function drawTree(sx, sy, z, v, small) {
    const hgt = (small ? 13 : 19) * z * (0.8 + v * 0.4);
    const w = hgt * 0.38;
    ctx.fillStyle = '#6b4b2a';
    ctx.fillRect(sx - z, sy - hgt * 0.25, 2 * z, hgt * 0.3);
    ctx.fillStyle = v > 0.5 ? '#2f7d3a' : '#37904a';
    ctx.beginPath();
    ctx.moveTo(sx - w, sy - hgt * 0.2);
    ctx.lineTo(sx, sy - hgt);
    ctx.lineTo(sx + w, sy - hgt * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(sx - w * 0.5, sy - hgt * 0.45);
    ctx.lineTo(sx, sy - hgt);
    ctx.lineTo(sx + w * 0.35, sy - hgt * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  function drawRoad(t, sx, sy, z, TW2, TH2) {
    diamond(sx, sy, TW2 * 0.97, TH2 * 0.97);
    ctx.fillStyle = '#41474f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = Math.max(0.5, z);
    ctx.stroke();
    const dirs = {
      N: [tileAt(s, t.x, t.y - 1), TW2 / 2, -TH2 / 2],
      E: [tileAt(s, t.x + 1, t.y), TW2 / 2, TH2 / 2],
      S: [tileAt(s, t.x, t.y + 1), -TW2 / 2, TH2 / 2],
      W: [tileAt(s, t.x - 1, t.y), -TW2 / 2, -TH2 / 2],
    };
    ctx.strokeStyle = '#e8d44f';
    ctx.lineWidth = Math.max(1, 1.3 * z);
    ctx.setLineDash([4.5 * z, 4.5 * z]);
    ctx.beginPath();
    for (const k in dirs) {
      const [n, ox, oy] = dirs[k];
      if (!n || !n.road) continue;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + ox, sy + oy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function prism(sx, sy, TW2, TH2, inset, h, wallL, wallR, roof) {
    const w = TW2 * inset, hh = TH2 * inset;
    // SW face
    ctx.fillStyle = wallL;
    ctx.beginPath();
    ctx.moveTo(sx - w, sy); ctx.lineTo(sx, sy + hh); ctx.lineTo(sx, sy + hh - h); ctx.lineTo(sx - w, sy - h);
    ctx.closePath(); ctx.fill();
    // SE face
    ctx.fillStyle = wallR;
    ctx.beginPath();
    ctx.moveTo(sx + w, sy); ctx.lineTo(sx, sy + hh); ctx.lineTo(sx, sy + hh - h); ctx.lineTo(sx + w, sy - h);
    ctx.closePath(); ctx.fill();
    // roof
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(sx, sy + hh - h); ctx.lineTo(sx + w, sy - h); ctx.lineTo(sx, sy - hh - h); ctx.lineTo(sx - w, sy - h);
    ctx.closePath(); ctx.fill();
    return { w, hh };
  }

  function windows(sx, sy, TW2, TH2, inset, h, rows, litProb, seedKey, z) {
    const w = TW2 * inset, hh = TH2 * inset;
    const faces = [
      [[sx - w, sy], [sx, sy + hh]],
      [[sx, sy + hh], [sx + w, sy]],
    ];
    for (let f = 0; f < 2; f++) {
      const [A, B] = faces[f];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 2; c++) {
          const u = 0.22 + (c + 0.5) * 0.28;
          const v = 0.16 + (r + 0.5) / rows * 0.72;
          const x = A[0] + (B[0] - A[0]) * u;
          const yEdge = A[1] + (B[1] - A[1]) * u;
          const y = yEdge - h * v;
          const lit = hash2(seedKey + r * 7 + f * 131, c * 13 + f) < litProb;
          ctx.fillStyle = lit ? '#ffd97a' : '#1c2531';
          ctx.fillRect(x - 1.6 * z, y - 2.6 * z, 3.2 * z, 2.9 * z);
        }
      }
    }
  }

  /* --------------------------- building art ---------------------------- */
  const RES_STYLE = [
    { h: 14, wallL: '#d9b38c', wallR: '#c69f78', roof: '#a8563f' },
    { h: 26, wallL: '#e2cfae', wallR: '#d0b992', roof: '#8f6f52' },
    { h: 42, wallL: '#d3dade', wallR: '#c2cbd3', roof: '#5f6b76' },
  ];
  const COM_STYLE = [
    { h: 16, wallL: '#9fc7ea', wallR: '#84b1dc', roof: '#39628f' },
    { h: 30, wallL: '#a9d0f0', wallR: '#8dbbe4', roof: '#2f5580' },
    { h: 50, wallL: '#b4daf5', wallR: '#98c6ec', roof: '#274a72' },
  ];
  const IND_STYLE = [
    { h: 11, wallL: '#d8c56a', wallR: '#c9b455', roof: '#8a7d3f' },
    { h: 15, wallL: '#d0bd60', wallR: '#c1ac50', roof: '#7d7139' },
    { h: 19, wallL: '#c8b558', wallR: '#b9a448', roof: '#716533' },
  ];

  function drawBuilding(t, sx, sy, z, TW2, TH2, now) {
    const b = t.b;
    const lit = t.pw ? 0.7 : 0.06;

    if (b.k === 'park') {
      diamondFill(sx, sy, TW2 * 0.92, TH2 * 0.92, '#3f9449');
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, 1.5 * z);
      ctx.beginPath();
      ctx.moveTo(sx - TW2 * 0.5, sy - TH2 * 0.25); ctx.lineTo(sx, sy + TH2 * 0.25); ctx.lineTo(sx + TW2 * 0.5, sy - TH2 * 0.25);
      ctx.stroke();
      const v1 = hash2(t.x * 3, t.y);
      drawTree(sx - TW2 * 0.28, sy - TH2 * 0.1, z * 0.8, v1, true);
      drawTree(sx + TW2 * 0.3, sy + TH2 * 0.15, z * 0.8, 1 - v1, true);
      ctx.fillStyle = '#ffe08a';
      ctx.fillRect(sx - 1.5 * z, sy + TH2 * 0.3, 3 * z, 1.6 * z);
      return;
    }

    if (b.k === 'coal') {
      prism(sx, sy, TW2, TH2, 0.8, 16 * z, '#6b7280', '#5b636e', '#444b55');
      for (const ox of [-TW2 * 0.3, TW2 * 0.3]) {
        prism(sx + ox, sy - TH2 * 0.15, TW2 * 0.16, TH2 * 0.16, 1, 34 * z, '#8a8f98', '#767b85', '#565b64');
        const topX = sx + ox, topY = sy - TH2 * 0.15 - 34 * z - TH2 * 0.16;
        for (let k = 0; k < 3; k++) {
          const p = ((now / 1100) + k * 0.33 + hash2(t.x, t.y)) % 1;
          ctx.fillStyle = `rgba(190,196,205,${(1 - p) * 0.4})`;
          ctx.beginPath();
          ctx.arc(topX + p * 16 * z, topY - p * 22 * z, (2 + p * 5) * z, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if ((now / 600) % 2 < 1) {
        ctx.fillStyle = '#ff5a5a';
        ctx.fillRect(sx - 1.2 * z, sy - TH2 * 0.15 - 36 * z, 2.4 * z, 2.4 * z);
      }
      return;
    }

    if (b.k === 'wind') {
      ctx.fillStyle = '#c8ccd2';
      diamondFill(sx, sy, TW2 * 0.3, TH2 * 0.3, '#c8ccd2');
      ctx.fillStyle = '#e8ecef';
      ctx.fillRect(sx - 1.6 * z, sy - 46 * z, 3.2 * z, 46 * z);
      const hubY = sy - 46 * z;
      const a = now * 0.004 * (0.7 + hash2(t.x, t.y) * 0.7);
      ctx.strokeStyle = '#f4f7f9';
      ctx.lineWidth = 2.2 * z;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const ang = a + (k * Math.PI * 2) / 3;
        ctx.moveTo(sx, hubY);
        ctx.lineTo(sx + Math.cos(ang) * 13 * z, hubY + Math.sin(ang) * 13 * z);
      }
      ctx.stroke();
      ctx.fillStyle = '#aab3bc';
      ctx.beginPath(); ctx.arc(sx, hubY, 2.2 * z, 0, Math.PI * 2); ctx.fill();
      return;
    }

    if (b.site) { // under construction
      diamondFill(sx, sy, TW2 * 0.85, TH2 * 0.85, '#8a6f4d');
      ctx.strokeStyle = '#e5a33b';
      ctx.lineWidth = 2 * z;
      ctx.beginPath();
      ctx.moveTo(sx - TW2 * 0.4, sy); ctx.lineTo(sx - TW2 * 0.4, sy - 26 * z);
      ctx.lineTo(sx + TW2 * 0.25, sy - 26 * z);
      ctx.stroke();
      const hookLen = (12 + Math.sin(now * 0.0012 + t.x) * 4) * z;
      ctx.lineWidth = z;
      ctx.beginPath();
      ctx.moveTo(sx + TW2 * 0.25, sy - 26 * z); ctx.lineTo(sx + TW2 * 0.25, sy - 26 * z + hookLen);
      ctx.stroke();
      ctx.fillStyle = '#e5a33b';
      ctx.fillRect(sx + TW2 * 0.25 - 1.5 * z, sy - 26 * z + hookLen, 3 * z, 2.5 * z);
      ctx.fillStyle = '#b0936a';
      ctx.beginPath(); ctx.arc(sx + TW2 * 0.3, sy + TH2 * 0.25, 4 * z, Math.PI, 0); ctx.fill();
      return;
    }

    let st, rows;
    if (b.k === 'res') { st = RES_STYLE[b.lvl - 1]; rows = b.lvl + 1; }
    else if (b.k === 'com') { st = COM_STYLE[b.lvl - 1]; rows = b.lvl + 1; }
    else { st = IND_STYLE[b.lvl - 1]; rows = 1; }

    const h = st.h * z;
    const inset = b.k === 'ind' ? 0.74 : 0.6;
    prism(sx, sy, TW2, TH2, inset, h, st.wallL, st.wallR, st.roof);
    windows(sx, sy, TW2, TH2, inset, h, rows, lit, t.x * 1000 + t.y, z);

    if (b.k === 'ind' && b.lvl >= 2) {
      prism(sx + TW2 * 0.34, sy + TH2 * 0.18, TW2 * 0.14, TH2 * 0.14, 1, (12 + b.lvl * 3) * z, '#9aa1a9', '#868d95', '#6b727a');
      const p = (now / 1300 + hash2(t.x, t.y * 3)) % 1;
      ctx.fillStyle = `rgba(200,205,212,${(1 - p) * 0.3})`;
      ctx.beginPath();
      ctx.arc(sx + TW2 * 0.34 + p * 12 * z, sy + TH2 * 0.18 - (12 + b.lvl * 3) * z - p * 16 * z, (1.5 + p * 3.5) * z, 0, Math.PI * 2);
      ctx.fill();
    }

    if (b.ab) {
      diamondFill(sx, sy, TW2 * 0.4, TH2 * 0.4, 'rgba(40,36,32,0.45)');
    }

    if (b.k !== 'park' && !t.pw) {
      ctx.globalAlpha = 0.7 + Math.sin(now * 0.006) * 0.3;
      ctx.font = `${Math.round(11 * z + 3)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('⚡', sx, sy - st.h * z - 6 * z);
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------ draw tile ----------------------------- */
  function drawTile(t, sx, sy, z, TW2, TH2, now) {
    diamond(sx, sy, TW2, TH2);
    ctx.fillStyle = tileFill(t, now);
    ctx.fill();

    if (t.t === 0) {
      let land = false;
      for (const [dx, dy] of DIRS4) { const n = tileAt(s, t.x + dx, t.y + dy); if (n && n.t !== 0) { land = true; break; } }
      if (land) {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = Math.max(0.5, z);
        ctx.stroke();
      }
    } else if (!t.road && !t.b) {
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (t.tree && !t.road && !t.b && t.z === 0) drawTree(sx, sy - 2 * z, z, hash2(t.x, t.y * 7), false);
    if (t.road) drawRoad(t, sx, sy, z, TW2, TH2);
    else if (t.z && !t.b) {
      const col = t.z === 1 ? 'rgba(74,222,128,0.20)' : t.z === 2 ? 'rgba(96,165,250,0.22)' : 'rgba(250,204,21,0.22)';
      diamondFill(sx, sy, TW2 * 0.88, TH2 * 0.88, col);
      ctx.strokeStyle = t.z === 1 ? 'rgba(74,222,128,0.75)' : t.z === 2 ? 'rgba(96,165,250,0.8)' : 'rgba(250,204,21,0.8)';
      ctx.lineWidth = Math.max(1, 1.4 * z);
      ctx.setLineDash([4 * z, 3 * z]);
      diamond(sx, sy, TW2 * 0.88, TH2 * 0.88);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (t.b) drawBuilding(t, sx, sy, z, TW2, TH2, now);

    if (overlay === 'power') {
      if (t.pw && (t.road || t.b)) diamondFill(sx, sy, TW2, TH2, 'rgba(0,225,255,0.22)');
      else if (t.b && t.b.k !== 'park') diamondFill(sx, sy, TW2, TH2, 'rgba(255,70,70,0.30)');
    } else if (overlay === 'pollution' && t.pol > 1) {
      diamondFill(sx, sy, TW2, TH2, `rgba(110,200,40,${Math.min(0.5, (t.pol / 100) * 0.55)})`);
    } else if (overlay === 'happy' && t.b && t.b.k === 'res' && !t.b.site) {
      const h = t.hap / 100;
      diamondFill(sx, sy, TW2, TH2, `hsla(${h * 120}, 80%, 45%, 0.4)`);
    } else if (overlay === 'land' && t.t !== 0) {
      diamondFill(sx, sy, TW2, TH2, `hsla(${30 + t.lv * 40}, 85%, 55%, ${0.15 + t.lv * 0.3})`);
    }
  }

  function drawCars(z, TW2, TH2) {
    for (const c of s.cars) {
      const wx = lerp(c.x, c.nx, c.t), wy = lerp(c.y, c.ny, c.t);
      const sx = (wx - wy) * TW2 + cam.x, sy = (wx + wy) * TH2 + cam.y;
      if (sx < -20 || sx > vw + 20 || sy < -20 || sy > vh + 20) continue;
      const ang = Math.atan2((c.nx + c.ny) - (c.x + c.y), (c.nx - c.ny) - (c.x - c.y));
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang * 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-3.4 * z, -1.4 * z + 1.2 * z, 6.8 * z, 3 * z);
      ctx.fillStyle = c.col;
      ctx.fillRect(-3.4 * z, -1.8 * z, 6.8 * z, 3 * z);
      ctx.fillStyle = 'rgba(20,30,40,0.55)';
      ctx.fillRect(-0.8 * z, -1.3 * z, 2.2 * z, 2.6 * z);
      ctx.restore();
    }
  }

  /* ------------------------------- render ------------------------------- */
  function render(now) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, '#87c5e8');
    g.addColorStop(1, '#b7e2f2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    const z = cam.z, TW2 = 32 * z, TH2 = 16 * z;
    const c0 = screenToWorldF(0, 0), c1 = screenToWorldF(vw, 0), c2 = screenToWorldF(0, vh), c3 = screenToWorldF(vw, vh);
    const minx = clamp(Math.floor(Math.min(c0.wx, c1.wx, c2.wx, c3.wx)) - 2, 0, CFG.W - 1);
    const maxx = clamp(Math.ceil(Math.max(c0.wx, c1.wx, c2.wx, c3.wx)) + 2, 0, CFG.W - 1);
    const miny = clamp(Math.floor(Math.min(c0.wy, c1.wy, c2.wy, c3.wy)) - 2, 0, CFG.H - 1);
    const maxy = clamp(Math.ceil(Math.max(c0.wy, c1.wy, c2.wy, c3.wy)) + 2, 0, CFG.H - 1);

    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const t = s.tiles[y * CFG.W + x];
        const sx = (x - y) * TW2 + cam.x, sy = (x + y) * TH2 + cam.y;
        if (sx < -80 || sx > vw + 80 || sy < -100 || sy > vh + 100) continue;
        drawTile(t, sx, sy, z, TW2, TH2, now);
      }
    }

    drawCars(z, TW2, TH2);

    if (hoverTile && tool !== 'pan') {
      const sx = (hoverTile.x - hoverTile.y) * TW2 + cam.x, sy = (hoverTile.x + hoverTile.y) * TH2 + cam.y;
      ctx.strokeStyle = painting ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 2;
      diamond(sx, sy, TW2, TH2);
      ctx.stroke();
    }
  }

  /* ------------------------------ tooltip ------------------------------- */
  let tipTile = null;
  function tileInfo(t) {
    const rows = [`<b>${TERRAIN_NAME[t.t]}</b>${t.t !== 0 ? ` · tile ${t.x},${t.y}` : ''}`];
    if (t.road) rows.push('🛣️ Road' + (t.pw ? ' · ⚡ grid' : ''));
    if (t.z) rows.push(`🗺️ ${ZONE_NAME[t.z]} zone`);
    if (t.b) {
      const b = t.b;
      let line = `🏗️ ${BUILD_NAME[b.k]}${b.k === 'res' || b.k === 'com' || b.k === 'ind' ? ` · level ${b.lvl}` : ''}`;
      if (b.site) line += ' · under construction';
      if (b.ab) line += ' · abandoned';
      rows.push(line);
      if (b.k === 'res' && !b.site) rows.push(`👥 ${Math.round(b.pop)}/${CFG.POP_CAP[b.lvl]} residents · 😊 ${Math.round(t.hap)}%`);
      if (b.k === 'com' && !b.site) rows.push(`💼 ${Math.round(b.jobs)}/${CFG.JOB_CAP.com[b.lvl]} jobs`);
      if (b.k === 'ind' && !b.site) rows.push(`💼 ${Math.round(b.jobs)}/${CFG.JOB_CAP.ind[b.lvl]} jobs`);
      if (b.k === 'coal') rows.push(`⚡ 140 units produced`);
      if (b.k === 'wind') rows.push(`⚡ 30 units produced`);
    }
    if (t.t !== 0) {
      if (t.pol > 2) rows.push(`☣️ pollution ${Math.round(t.pol)}%`);
      rows.push(`💎 land value ${Math.round(t.lv * 100)}%`);
      if (t.t === 0) rows.push('🚫 cannot build here');
    }
    return rows.join('<br>');
  }

  /* -------------------------------- UI ---------------------------------- */
  const ui = {};
  function buildUI() {
    const el = document.createElement('div');
    el.className = 'cb-ui';
    el.innerHTML = `
      <div class="cb-hud">
        <span class="cb-stat" title="Treasury">💰 <b id="cb-money"></b></span>
        <span class="cb-stat" title="Population">👥 <b id="cb-pop"></b></span>
        <span class="cb-stat" title="Average happiness of residents">😊 <b id="cb-happy"></b></span>
        <span class="cb-stat" title="Monthly balance (income − upkeep)">📈 <b id="cb-bal"></b></span>
        <span class="cb-stat" title="Date — one month per tick">📅 <b id="cb-date"></b></span>
        <span class="cb-demand" title="Demand — R: housing · C: shops · I: industry">
          <i>R</i><span class="cb-dbar"><span class="cb-dfill" id="cb-dr" style="background:#4ade80"></span></span>
          <i>C</i><span class="cb-dbar"><span class="cb-dfill" id="cb-dc" style="background:#60a5fa"></span></span>
          <i>I</i><span class="cb-dbar"><span class="cb-dfill" id="cb-di" style="background:#facc15"></span></span>
        </span>
        <span class="cb-speed">
          <button id="cb-pause" title="Pause (Space)">⏸</button>
          <button id="cb-play" title="Normal speed">▶️</button>
          <button id="cb-fast" title="Fast forward">⏩</button>
        </span>
        <b class="cb-rank" id="cb-rank" title="Your settlement title"></b>
      </div>

      <div class="cb-side">
        <div class="cb-side-group" id="cb-overlays">
          <button data-ov="power" title="Power grid overlay">⚡</button>
          <button data-ov="pollution" title="Pollution overlay">☣️</button>
          <button data-ov="happy" title="Happiness overlay">😊</button>
          <button data-ov="land" title="Land value overlay">💎</button>
        </div>
        <div class="cb-side-group">
          <button id="cb-save" title="Save to this browser">💾</button>
          <button id="cb-load" title="Load saved city">📂</button>
          <button id="cb-export" title="Export save as a file">⬇️</button>
          <button id="cb-import" title="Import a save file">⬆️</button>
          <button id="cb-new" title="New city">🗺️</button>
          <button id="cb-settings" title="Settings (taxes)">⚙️</button>
          <button id="cb-help" title="How to play (H)">❓</button>
        </div>
      </div>

      <div class="cb-toolbar" id="cb-toolbar"></div>
      <div class="cb-hint" id="cb-hint"></div>
      <div class="cb-tooltip hidden" id="cb-tooltip"></div>
      <div class="cb-toasts" id="cb-toasts"></div>
      <div class="cb-backdrop hidden" id="cb-modal"></div>
      <input type="file" id="cb-file" accept="application/json,.json" style="display:none">
    `;
    root.appendChild(el);
    for (const id of ['cb-money', 'cb-pop', 'cb-happy', 'cb-bal', 'cb-date', 'cb-dr', 'cb-dc', 'cb-di', 'cb-rank', 'cb-toolbar', 'cb-hint', 'cb-tooltip', 'cb-toasts', 'cb-modal', 'cb-pause', 'cb-play', 'cb-fast', 'cb-file']) {
      ui[id] = el.querySelector('#' + id);
    }

    // toolbar
    let tb = '';
    for (const t of TOOLS) {
      tb += `<button class="cb-tool" data-tool="${t.id}" title="${t.name} (${t.key.toUpperCase()})">
        <span class="ico">${t.icon}</span><span class="lbl">${t.name}</span>
        <span class="cost">${t.cost ? fmt$(t.cost) : 'free'}</span></button>`;
    }
    ui['cb-toolbar'].innerHTML = tb;

    // wire buttons
    const $ = (sel) => el.querySelector(sel);
    on($('cb-toolbar'), 'click', (e) => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
    on($('cb-overlays'), 'click', (e) => { const b = e.target.closest('[data-ov]'); if (b) setOverlay(b.dataset.ov); });
    on($('cb-pause'), 'click', () => setPaused(true));
    on($('cb-play'), 'click', () => { setPaused(false); speed = 1; syncSpeed(); });
    on($('cb-fast'), 'click', () => { setPaused(false); speed = 3; syncSpeed(); });
    on($('cb-save'), 'click', () => saveLocal(false));
    on($('cb-load'), 'click', openLoadModal);
    on($('cb-export'), 'click', exportSave);
    on($('cb-import'), 'click', () => ui['cb-file'].click());
    on(ui['cb-file'], 'change', (e) => { if (e.target.files[0]) importSave(e.target.files[0]); e.target.value = ''; });
    on($('cb-new'), 'click', openNewModal);
    on($('cb-settings'), 'click', openSettings);
    on($('cb-help'), 'click', openHelp);
  }

  function setTool(id) {
    tool = id;
    painting = false;
    canvas.style.cursor = id === 'pan' ? 'grab' : 'crosshair';
    for (const b of ui['cb-toolbar'].querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === id);
    const t = TOOLS.find((x) => x.id === id);
    ui['cb-hint'].textContent = t ? t.hint : '';
    ui['cb-hint'].style.display = t && id !== 'pan' ? '' : 'none';
  }

  function setOverlay(id) {
    overlay = overlay === id ? null : id;
    for (const b of root.querySelectorAll('#cb-overlays [data-ov]')) b.classList.toggle('active', b.dataset.ov === overlay);
  }

  function setPaused(p) { paused = p; syncSpeed(); }
  function syncSpeed() {
    ui['cb-pause'].classList.toggle('active', paused);
    ui['cb-play'].classList.toggle('active', !paused && speed === 1);
    ui['cb-fast'].classList.toggle('active', !paused && speed === 3);
  }

  function updateHUD() {
    ui['cb-money'].textContent = fmt$(s.money);
    ui['cb-money'].style.color = s.money < 0 ? '#ff7b7b' : '#ffd97a';
    ui['cb-pop'].textContent = s.pop.toLocaleString('en-US');
    ui['cb-happy'].textContent = Math.round(s.happy * 100) + '%';
    const bal = s.income - s.upkeep;
    ui['cb-bal'].textContent = (bal >= 0 ? '+' : '−') + fmt$(Math.abs(bal)).slice(1 - 1);
    ui['cb-bal'].style.color = bal >= 0 ? '#86efac' : '#ff7b7b';
    ui['cb-date'].textContent = `${MONTHS[s.month - 1]} ${s.year}`;
    ui['cb-dr'].style.width = Math.round(s.dR * 100) + '%';
    ui['cb-dc'].style.width = Math.round(s.dC * 100) + '%';
    ui['cb-di'].style.width = Math.round(s.dI * 100) + '%';
    ui['cb-rank'].textContent = s.rank >= 0 ? CFG.MILESTONES[s.rank].name : 'Outpost';
  }

  function toast(msg, kind) {
    const d = document.createElement('div');
    d.className = 'cb-toast' + (kind === 'warn' ? ' warn' : '');
    d.textContent = msg;
    ui['cb-toasts'].appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, 3200);
    while (ui['cb-toasts'].children.length > 4) ui['cb-toasts'].firstChild.remove();
  }

  /* ------------------------------- modals -------------------------------- */
  function openModal(html) {
    const m = ui['cb-modal'];
    m.innerHTML = `<div class="cb-modal">${html}<button class="cb-x" data-close>✕</button></div>`;
    m.classList.remove('hidden');
    on(m, 'click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
  }
  function closeModal() { ui['cb-modal'].classList.add('hidden'); ui['cb-modal'].innerHTML = ''; }

  function openHelp() {
    openModal(`
      <h2>🏛️ How to play</h2>
      <ol class="cb-steps">
        <li><b>Lay roads.</b> Every building needs to touch a road — and roads double as power lines.</li>
        <li><b>Build a coal plant</b> (or wind turbines) and keep it connected to your road grid.</li>
        <li><b>Paint zones</b> next to the roads: 🏠 homes, 🏬 shops, 🏭 industry. Buildings construct themselves when demand (R/C/I bars) is high.</li>
        <li><b>Balance the city.</b> Industry pollutes — keep homes away and add parks 🌳 to raise land value so buildings level up. Watch the budget: taxes pay for upkeep.</li>
      </ol>
      <h3>Controls</h3>
      <table class="cb-keys">
        <tr><td>Drag</td><td>build with the selected tool</td></tr>
        <tr><td>Right-drag / 🖐️ tool / WASD / arrows</td><td>pan the camera</td></tr>
        <tr><td>Scroll / pinch</td><td>zoom</td></tr>
        <tr><td><b>1–8</b></td><td>select tools</td></tr>
        <tr><td><b>Space</b></td><td>pause · <b>H</b> help · <b>Esc</b> close</td></tr>
      </table>
      <h3>Saving</h3>
      <p class="cb-dim">Your city autosaves to this browser every game year (💾). Use ⬇️ Export to keep a file copy that works on any device.</p>
      <button class="cb-btn" data-close>Let's build 🏗️</button>
    `);
  }

  function openSettings() {
    openModal(`
      <h2>⚙️ Budget & taxes</h2>
      <p>Monthly income ${fmt$(s.income)} · upkeep ${fmt$(s.upkeep)}</p>
      <label class="cb-row">Tax rate <b id="cb-taxv">${s.tax}%</b>
        <input type="range" id="cb-tax" min="0" max="20" step="1" value="${s.tax}">
      </label>
      <p class="cb-dim">Low taxes make residents happy but earn less. Above 9% happiness starts to drop.</p>
      <div style="margin-top:10px">
        <button class="cb-btn" data-close>Done</button>
      </div>
    `);
    const tax = root.querySelector('#cb-tax'), taxv = root.querySelector('#cb-taxv');
    on(tax, 'input', () => { s.tax = +tax.value; taxv.textContent = s.tax + '%'; computeHappiness(s); updateHUD(); });
  }

  function openNewModal() {
    openModal(`
      <h2>🗺️ New city</h2>
      <p>This abandons <b>${s.cityName || 'your current city'}</b> and generates a fresh island.</p>
      <label class="cb-row">Map seed (optional)
        <input type="text" id="cb-seed" placeholder="leave empty for random" maxlength="12">
      </label>
      <p class="cb-dim">Tip: the same seed always makes the same map.</p>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="cb-btn danger" id="cb-gonew">Generate new island</button>
        <button class="cb-btn" data-close>Cancel</button>
      </div>
    `);
    const btn = root.querySelector('#cb-gonew'), seedIn = root.querySelector('#cb-seed');
    setTimeout(() => seedIn.focus(), 50);
    on(btn, 'click', () => {
      const raw = seedIn.value.trim();
      let seed = 0;
      if (raw) { for (let i = 0; i < raw.length; i++) seed = (seed * 31 + raw.charCodeAt(i)) >>> 0; if (/^\d+$/.test(raw)) seed = +raw % 1e9; }
      s = newCity(seed || undefined);
      wireState(); updateHUD();
      closeModal();
      toast('A new island rises from the sea 🌊');
    });
  }

  function openLoadModal() {
    const raw = (() => { const ls = store(); return ls ? ls.getItem(CFG.SAVE_KEY) : memSave; })();
    if (!raw) { toast('No saved city found in this browser', 'warn'); return; }
    let meta = '';
    try {
      const d = JSON.parse(raw);
      meta = `<p class="cb-dim">Saved city: <b>${MONTHS[(d.month || 1) - 1]} ${d.year}</b> · 👥 ${(d.pop || 0).toLocaleString()} · ${fmt$(d.money || 0)} · ${d.tiles ? d.tiles.length.toLocaleString() : '?'} tiles</p>`;
    } catch (e) { /* fall through */ }
    openModal(`
      <h2>📂 Load city</h2>
      ${meta}
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="cb-btn" id="cb-goload">Load it</button>
        <button class="cb-btn" data-close>Cancel</button>
      </div>
    `);
    on(root.querySelector('#cb-goload'), 'click', () => {
      const ns = loadLocal();
      if (ns) { s = ns; wireState(); updateHUD(); closeModal(); toast('City loaded 📂'); }
      else toast('Could not read that save', 'warn');
    });
  }

  function wireState() {
    s.onAutosave = () => saveLocal(true);
    acc = 0;
  }

  /* ------------------------------- input --------------------------------- */
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e) {
    const p = canvasPos(e);
    pts.set(e.pointerId, p);
    if (pts.size === 2) {
      painting = false; panning = false;
      const [a, b] = [...pts.values()];
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        z0: cam.z,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        world: screenToWorldF((a.x + b.x) / 2, (a.y + b.y) / 2),
      };
      return;
    }
    canvas.setPointerCapture?.(e.pointerId);
    if (e.button === 2 || e.button === 1 || tool === 'pan') {
      panning = true; panLast = p;
      canvas.style.cursor = 'grabbing';
    } else {
      painting = true;
      lastPaint = null;
      const t = tileFromScreen(p.x, p.y);
      if (t) { applyToolAt(t); lastPaint = t; updateHUD(); }
    }
  }

  function onPointerMove(e) {
    const p = canvasPos(e);
    mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
    if (pts.has(e.pointerId)) pts.set(e.pointerId, p);

    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      cam.z = clamp(pinch.z0 * (dist / pinch.dist), CFG.ZOOM_MIN, CFG.ZOOM_MAX);
      cam.x = mid.x - (pinch.world.wx - pinch.world.wy) * 32 * cam.z;
      cam.y = mid.y - (pinch.world.wx + pinch.world.wy) * 16 * cam.z;
      return;
    }

    hoverTile = tileFromScreen(p.x, p.y);

    if (panning && panLast) {
      cam.x += p.x - panLast.x;
      cam.y += p.y - panLast.y;
      panLast = p;
    } else if (painting) {
      if (hoverTile && hoverTile !== lastPaint) paintTo(hoverTile);
      updateHUD();
    }
  }

  function onPointerUp(e) {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      const wasPainting = painting;
      painting = false; panning = false; panLast = null;
      canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
      if (wasPainting) finishStroke();
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const p = canvasPos(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0013));
  }

  function onKeyDown(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown') e.preventDefault();
    if (k === ' ') { e.preventDefault(); setPaused(!paused); return; }
    if (k === 'h') { openHelp(); return; }
    if (k === 'escape') { closeModal(); setTool('pan'); return; }
    const t = TOOLS.find((x) => x.key === k);
    if (t) setTool(t.id);
  }
  function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }

  function stepKeys(dt) {
    const v = (430 / cam.z) * dt;
    if (keys.a || keys.arrowleft) cam.x += v;
    if (keys.d || keys.arrowright) cam.x -= v;
    if (keys.w || keys.arrowup) cam.y += v;
    if (keys.s || keys.arrowdown) cam.y -= v;
  }

  /* ----------------------------- main loop -------------------------------- */
  function updateTooltip() {
    const tip = ui['cb-tooltip'];
    if (!mouse.inside || !hoverTile || painting || panning || pts.size > 0) { tip.classList.add('hidden'); tipTile = null; return; }
    if (hoverTile !== tipTile) {
      tipTile = hoverTile;
      tip.innerHTML = tileInfo(hoverTile);
    }
    tip.classList.remove('hidden');
    const tx = Math.min(mouse.x + 16, vw - 250);
    const ty = Math.min(mouse.y + 18, vh - 140);
    tip.style.transform = `translate(${tx}px, ${ty}px)`;
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;

    stepKeys(dt);
    if (!paused) {
      acc += dt * speed;
      let guard = 0;
      while (acc >= CFG.TICK_SECONDS && guard++ < 4) {
        acc -= CFG.TICK_SECONDS;
        tick(s);
        updateHUD();
      }
    }
    stepCars(dt);
    render(now);
    updateTooltip();
  }

  /* ------------------------------ bootstrap ------------------------------- */
  s = loadLocal() || newCity();
  wireState();

  buildUI();
  setTool('pan');
  syncSpeed();
  updateHUD();
  resize();
  on(window, 'resize', resize);
  on(canvas, 'pointerdown', onPointerDown);
  on(canvas, 'pointermove', onPointerMove);
  on(window, 'pointerup', onPointerUp);
  on(window, 'pointercancel', onPointerUp);
  on(canvas, 'wheel', onWheel, { passive: false });
  on(canvas, 'contextmenu', (e) => e.preventDefault());
  on(canvas, 'pointerleave', () => { mouse.inside = false; });
  on(window, 'keydown', onKeyDown);
  on(window, 'keyup', onKeyUp);

  raf = requestAnimationFrame(loop);

  if (!loadLocal() && s.tick === 0) setTimeout(openHelp, 500);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      for (const d of disposers) { try { d(); } catch (e) { /* noop */ } }
      disposers.length = 0;
      root.querySelectorAll('.cb-ui').forEach((n) => n.remove());
    },
    getState: () => s,
    setSpeed: (v) => { speed = v; },
  };
}
