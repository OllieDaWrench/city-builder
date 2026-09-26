# 🏙️ City Builder

An **isometric city-building game** that runs in your browser — inspired by *Cities: Skylines*.
Zone districts, lay roads, keep the lights on, and grow a lonely outpost into a bustling metropolis.

Built with **Next.js** (just as a thin shell) around a **framework-free Canvas game engine** — no game libraries, no image assets, every building is drawn procedurally.

---

## ✨ Features

- 🗺️ **Procedural islands** — every seed generates a new coastline with beaches and forests
- 🛣️ **Roads with auto-connecting lanes** — every building needs road access
- 🏠🏬🏭 **RCI zoning** — residential / commercial / industrial zones grow buildings *themselves* when demand is high
- ⚡ **Power grid** — plants inject capacity, roads carry the lines; overbuild and the edge of town browns out
- 😊 **Happiness, land value & pollution** — parks and waterfronts are premium; industry and coal are filthy
- 🏆 **Milestones** — Outpost → Hamlet → Village → Town → City → Metropolis, each with a cash grant
- 📈 **Monthly budget simulation** — taxes in, upkeep out, adjustable tax rate
- 🚗 **Cosmetic traffic** — cars drive your street network
- 💾 **Save / load / autosave** in the browser, plus **export/import** saves as files
- ⏩ Pause / normal / fast-forward time; overlays for power, pollution, happiness and land value
- 🧪 **Headless simulation** — the sim core has no DOM dependencies and is covered by `npm run test:sim`

## 🎮 How to play

1. **Lay roads.** Everything must touch a road — and roads double as power lines.
2. **Build a coal plant** (⚡ big capacity, pollutes) or wind turbines (🌀 clean, smaller) connected to the grid.
3. **Paint zones** next to the roads. Watch the R/C/I demand bars in the HUD — buildings only grow when there's demand.
4. **Balance the city.** Keep industry away from homes, sprinkle parks 🌳 to raise land value (homes level up to L3 near parks + water), keep taxes ≤ 9%, and don't spend more than you earn.

| Input | Action |
| --- | --- |
| Left-drag | Build with the selected tool |
| Right-drag / 🖐️ tool / WASD / arrows | Pan |
| Scroll wheel / pinch | Zoom |
| `1`–`8` | Select tools |
| `Space` | Pause |
| `H` | Help |
| `Esc` | Close dialogs |

## 🚀 Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Run the simulation smoke test (no browser needed):

```bash
npm run test:sim
```

## ▲ Deploy to Vercel

The app prerenders to a fully static page, so it's free-tier friendly.

**Option A — from GitHub (recommended):**

1. Push this repo to GitHub (see below).
2. Go to [vercel.com/new](https://vercel.com/new) → **Import** the repo.
3. Vercel auto-detects Next.js. Click **Deploy**. Done.

**Option B — straight from your machine:**

```bash
npm i -g vercel
vercel          # follow the prompts; `vercel --prod` to ship to production
```

**Pushing this project to GitHub** (after creating an empty repo named `city-builder` on github.com):

```bash
cd city-builder
git remote add origin https://github.com/<your-username>/city-builder.git
git push -u origin main
```

## 💾 Which storage system should you use?

The short answer: **you already have the right one for now — the browser.** This game saves cities through `localStorage` (with an in-memory fallback and file export/import). A whole city serializes to ~60 KB of JSON, so 5 MB of `localStorage` holds ~80 cities.

| Need | Use | Why |
| --- | --- | --- |
| Game saves (current) | **`localStorage`** ✅ *already wired up* | Zero backend, zero cost, instant, works on Vercel's free tier |
| Bigger/multiple local saves, replays | **IndexedDB** | Async + hundreds of MB, still client-side |
| User accounts + cloud saves | **Vercel Postgres** (powered by Neon) | Serverless SQL; store a whole city as one `JSONB` row |
| Leaderboards ("largest population") | **Vercel KV** (Upstash Redis) | Sorted sets are *made* for high-score boards; µs latency |
| Screenshots / replays as files | **Vercel Blob** | Object storage, signed URLs |

**Recommended path when you outgrow the browser:**

1. Add **Vercel Postgres** + Auth.js/Clerk. The save format here is versioned JSON (`{ v: 1, ... }`), so cloud saves are a copy-paste into one column:

   ```sql
   create table cities (
     user_id    text not null,
     name       text not null,
     data       jsonb not null,          -- the exact serialize() output
     updated_at timestamptz default now(),
     primary key (user_id, name)
   );
   ```

2. Add **Vercel KV** for a global leaderboard: `ZADD leaderboard <population> "<player>"`.

Because the game is a client-side engine, all of this plugs in through a couple of Next.js API routes without touching the game code.

## 🧱 Architecture

```
app/
  layout.jsx            # Next.js shell + metadata
  page.jsx              # renders <GameCanvas/>
  globals.css           # all game UI styles
components/
  GameCanvas.jsx        # thin React wrapper ('use client') — mounts the engine
lib/game/
  engine.js             # the whole game (framework-free):
                        #   config · noise/terrain · simulation tick ·
                        #   power BFS · RCI growth · Canvas iso renderer ·
                        #   input · DOM UI · save/load
test/
  sim-test.mjs          # headless simulation test (npm run test:sim)
```

- **Headless core**: `newCity()`, `tick()`, `applyAt()`, `serialize()`, `deserialize()` never touch the DOM — you can simulate cities in Node, which is exactly what the test does.
- **Renderer**: isometric diamond grid (64×32 tiles), painter's-ordered rows, culling by camera bounds; buildings are procedurally extruded prisms with per-tile hash variation (no image assets at all).
- **Simulation cadence**: 1 tick = 1 in-game month (2 s at normal speed). Each tick recomputes power (capacity-limited BFS along roads), pollution, land value, happiness, RCI demand, then runs the growth pass and the budget.
- **Save format**: `{ v: 1, seed, money, tax, tick, month, year, rank, tiles[][] }` — plain JSON, future-proof for cloud saves.

## 🔭 Roadmap ideas

- 💧 Water pipes & sewage, fire/police services, schools & healthcare
- 🚦 Real traffic simulation feeding into road upgrades
- 🗳️ Districts & policies (like C:S)
- ☁️ Cloud saves (Postgres + auth) and a population leaderboard (Vercel KV)
- 🌙 Day/night cycle

## 📄 License

[MIT](./LICENSE) — build on it, remix it, ship it.
