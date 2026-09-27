# 🏙️ City Builder

A **3D isometric city-building game** in the browser, inspired by *Cities: Skylines* —
built with **Next.js + Three.js** and zero game-engine dependencies. Every building,
tree and road texture is generated procedurally in code.

**Connect your city to the outside world, keep the lights on, and grow a Hamlet into a Metropolis.**

## ✨ Features

**Roads & transport**
- 🛣️ **Three road types** — Streets ($20), Avenues ($60, 3× capacity) and Highways ($120, huge capacity)
- 🌍 **Outside connection** — a highway stub enters the map at the edge; your road network must actually *connect* to it (BFS-verified, C:S-style) or nobody moves in
- 🚗 Traffic simulation with congestion — check the 🚗 overlay and upgrade bottlenecks

**Zones & growth**
- 🏠 Residential, 🏬 Commercial, 🏭 Industrial and 🏢 **Office** zoning (offices need educated workers!)
- R/C/I/O **demand bars**, 3 building levels, construction sites with animated cranes, abandonment when unhappy
- Buildings only grow next to *connected* streets/avenues with power — highways can't be zoned against

**Services & utilities**
- ⚡ Coal / wind / **solar** power — capacity-limited grid that flows through roads, with brownouts
- 🚓 Police, 🚒 fire, 🏥 hospitals, 🏫 schools — coverage simulated by BFS along the road network
- 🌳 Parks and ⛲ plazas raising land value and happiness

**World & graphics**
- Real **3D** (Three.js): orbit / pan / zoom camera, sun shadows, **day-night cycle** with windows that light up at night
- Procedural islands: value-noise terrain, beaches, lakes, forests, animated water
- Procedural canvas textures: lane markings auto-connect per road tile, facades with per-window lighting
- 🚗 instanced cars that path along your road network and change speed by road type

**Simulation**
- Monthly tick: power → pollution → services → land value → demand → happiness → growth → budget
- Congestion model (road capacity vs. population/jobs), education pipeline, tax slider, milestones with cash grants
- 💾 localStorage autosave (versioned JSON), export/import save files

## 🎮 Controls

| Input | Action |
| --- | --- |
| Left-drag | Build with the selected tool |
| Right-drag | Orbit camera |
| Middle-drag / 🖐️ / WASD | Pan |
| Scroll / pinch | Zoom |
| Click a building | Info card |
| `Q` `1`–`9` `0` `X` | Tools · `Space` pause · `H` help · `Esc` close |

## 🚀 Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Tests:

```bash
npm run test:sim          # headless 5-year simulation (no browser)
node browser-test.mjs     # puppeteer boot + interaction smoke test (needs Chrome deps)
```

## ▲ Deploy to Vercel

Import the repo at [vercel.com/new](https://vercel.com/new) — it's a static-prerendered Next.js app, so defaults just work, no environment variables needed. Or `npx vercel` from the CLI.

> **Site shows a Vercel login wall / SSO redirect?** That's **Deployment Protection**.
> Fix: Vercel Dashboard → your project → **Settings → Deployment Protection** → set *Standard Protection* to **Disabled** → redeploy. Your live domain is shown under Project → **Domains**.

## 💾 Which storage system should you use?

**Right now: the browser — already wired up.** Saves are ~60 KB JSON each; `localStorage` holds ~80 of them, costs nothing, and needs no backend.

| Need | Use |
| --- | --- |
| Game saves (current) | **`localStorage`** ✅ |
| Bigger local saves / replays | **IndexedDB** |
| Accounts + cloud saves | **Vercel Postgres** (Neon) — one `JSONB` row per city |
| Leaderboards | **Vercel KV** (Upstash Redis) — sorted sets |
| Screenshots / shared cities | **Vercel Blob** |

The save format is versioned JSON (`{ v: 3, ... }`), so moving to Postgres later is a copy-paste into one column:

```sql
create table cities (
  user_id text not null,
  name    text not null,
  data    jsonb not null,
  updated_at timestamptz default now(),
  primary key (user_id, name)
);
```

## 🧱 Architecture

```
lib/game/
  config.js   # all tunables: roads, zones, buildings, milestones
  utils.js    # seeded RNG, value noise, Bresenham, formatting
  sim.js      # HEADLESS simulation core (no DOM/Three) — newCity/tick/applyAt/serialize
  world3d.js  # Three.js renderer: terrain, roads, buildings, cars, day/night
  ui.js       # DOM UI: HUD, categorized dock, overlays, panels, modals
  game.js     # controller: input, camera, loop, storage
components/GameCanvas.jsx  # thin React mount
test/sim-test.mjs          # 5-year headless simulation test
browser-test.mjs           # puppeteer boot/interaction smoke test
```

The simulation never touches the DOM or WebGL — the 3D world and the UI are both pure views over `sim.js` state, which is why the whole game can be tested in Node.

## 📄 License

[MIT](./LICENSE)
