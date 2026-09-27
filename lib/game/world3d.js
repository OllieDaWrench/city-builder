/* ============================================================================
   City Builder v2 — Three.js world renderer.
   Flat-tile 3D world: canvas-textured ground, per-tile road meshes, procedural
   buildings with lit windows, instanced trees/cars, sun + shadows, day/night.
   ============================================================================ */
import * as THREE from 'three';
import { CFG } from './config.js';
import { hash2, clamp, clamp01, lerp } from './utils.js';

const PX = 8; // canvas pixels per tile for the ground texture

/* -------------------------- ground / zone canvases -------------------------- */
function paintGround(s) {
  const c = document.createElement('canvas');
  c.width = CFG.W * PX; c.height = CFG.H * PX;
  const g = c.getContext('2d');
  for (const t of s.tiles) {
    const v = hash2(t.x, t.y);
    let col;
    if (t.t === 0) col = `hsl(204 55% ${22 + v * 6}%)`;
    else if (t.t === 1) col = `hsl(46 42% ${62 + v * 10}%)`;
    else col = `hsl(${98 + v * 16} ${36 + v * 10}% ${27 + v * 8}%)`;
    g.fillStyle = col;
    g.fillRect(t.x * PX, t.y * PX, PX, PX);
    if (t.t === 2 && v > 0.75) { // subtle grass texture
      g.fillStyle = 'rgba(255,255,255,0.04)';
      g.fillRect(t.x * PX + 1, t.y * PX + 2, 2, 1);
    }
  }
  return c;
}

function paintZones(s) {
  const c = document.createElement('canvas');
  c.width = CFG.W * PX; c.height = CFG.H * PX;
  const g = c.getContext('2d');
  const colors = { 1: 'rgba(74,222,128,0.42)', 2: 'rgba(96,165,250,0.42)', 3: 'rgba(250,204,21,0.4)', 4: 'rgba(34,211,238,0.42)' };
  for (const t of s.tiles) {
    if (!t.z) continue;
    const cx = (t.x + 0.5) * PX, cy = (t.y + 0.5) * PX, r = PX * 0.52;
    g.fillStyle = colors[t.z];
    g.beginPath();
    g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy);
    g.closePath(); g.fill();
  }
  return c;
}

/* ------------------------------ road textures ------------------------------ */
const roadTexCache = new Map();
function roadTexture(type, mask) {
  const key = type + ':' + mask;
  if (roadTexCache.has(key)) return roadTexCache.get(key);
  const S = 96;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  const base = type === 1 ? '#4a505a' : type === 2 ? '#414752' : '#33383f';
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  // noise
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.03})`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  const cx = S / 2;
  const dirs = { N: mask & 1, E: mask & 2, S: mask & 4, W: mask & 8 };
  const any = dirs.N || dirs.E || dirs.S || dirs.W;
  const count = (dirs.N ? 1 : 0) + (dirs.E ? 1 : 0) + (dirs.S ? 1 : 0) + (dirs.W ? 1 : 0);

  // curbs
  g.strokeStyle = 'rgba(20,24,30,0.8)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, S - 3, S - 3);
  // reconnect open edges (erase curb where connected)
  g.fillStyle = base;
  if (dirs.N) g.fillRect(cx - 8, 0, 16, 5);
  if (dirs.S) g.fillRect(cx - 8, S - 5, 16, 5);
  if (dirs.W) g.fillRect(0, cx - 8, 5, 16);
  if (dirs.E) g.fillRect(S - 5, cx - 8, 5, 16);

  const drawTo = (dirX, dirY, fn) => {
    g.beginPath(); g.moveTo(cx, cx);
    g.lineTo(cx + dirX * cx, cx + dirY * cx);
    fn();
  };
  const centerOnly = count >= 3;
  if (!centerOnly && any) {
    if (type === 1) {
      g.strokeStyle = '#e8d44f'; g.lineWidth = 2; g.setLineDash([7, 7]);
      for (const k in dirs) {
        if (!dirs[k]) continue;
        const [dx, dy] = k === 'N' ? [0, -1] : k === 'S' ? [0, 1] : k === 'W' ? [-1, 0] : [1, 0];
        drawTo(dx, dy, () => g.stroke());
      }
      g.setLineDash([]);
    } else if (type === 2) {
      g.strokeStyle = '#e8c93f'; g.lineWidth = 2;
      for (const k in dirs) {
        if (!dirs[k]) continue;
        const [dx, dy] = k === 'N' ? [0, -1] : k === 'S' ? [0, 1] : k === 'W' ? [-1, 0] : [1, 0];
        const ox = dy * 3, oy = dx * 3;
        g.beginPath(); g.moveTo(cx + ox, cx + oy); g.lineTo(cx + dx * cx + ox, cx + dy * cx + oy); g.stroke();
        g.beginPath(); g.moveTo(cx - ox, cx - oy); g.lineTo(cx + dx * cx - ox, cx + dy * cx - oy); g.stroke();
      }
    } else {
      // highway: solid white edge lines + wide dashed yellow centre
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2;
      for (const k in dirs) {
        if (!dirs[k]) continue;
        const [dx, dy] = k === 'N' ? [0, -1] : k === 'S' ? [0, 1] : k === 'W' ? [-1, 0] : [1, 0];
        const ox = dy * 9, oy = dx * 9;
        g.beginPath(); g.moveTo(cx + ox, cx + oy); g.lineTo(cx + dx * cx + ox, cx + dy * cx + oy); g.stroke();
        g.beginPath(); g.moveTo(cx - ox, cx - oy); g.lineTo(cx + dx * cx - ox, cx + dy * cx - oy); g.stroke();
      }
      g.strokeStyle = '#e8b53f'; g.lineWidth = 3; g.setLineDash([10, 8]);
      for (const k in dirs) {
        if (!dirs[k]) continue;
        const [dx, dy] = k === 'N' ? [0, -1] : k === 'S' ? [0, 1] : k === 'W' ? [-1, 0] : [1, 0];
        drawTo(dx, dy, () => g.stroke());
      }
      g.setLineDash([]);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  roadTexCache.set(key, tex);
  return tex;
}

/* ------------------------------ facade textures ---------------------------- */
const facadeCache = new Map();
const WALLS = {
  res: [['#d9b38c', '#a8563f'], ['#e2cfae', '#8f6f52'], ['#d3dade', '#5f6b76']],
  com: [['#9fc7ea', '#39628f'], ['#a9d0f0', '#2f5580'], ['#b4daf5', '#274a72']],
  ind: [['#cbb964', '#8a7d3f'], ['#c4b155', '#7d7139'], ['#bca94c', '#716533']],
  office: [['#7e97ad', '#39434d'], ['#6f89a3', '#333c45'], ['#5f7d9c', '#2b333c']],
};
function facade(kind, lvl, seedI) {
  const key = kind + lvl + ':' + seedI;
  if (facadeCache.has(key)) return facadeCache.get(key);
  const w = 96, h = 128;
  const wall = document.createElement('canvas'); wall.width = w; wall.height = h;
  const emit = document.createElement('canvas'); emit.width = w; emit.height = h;
  const wg = wall.getContext('2d'), eg = emit.getContext('2d');
  const [base, trim] = WALLS[kind][lvl - 1];
  wg.fillStyle = base; wg.fillRect(0, 0, w, h);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, w, h);

  const rows = kind === 'ind' ? 2 : kind === 'office' ? 6 + lvl * 3 : 2 + lvl * 2;
  const cols = kind === 'ind' ? 3 : 5;
  for (let r = 0; r < rows; r++) {
    for (let cI = 0; cI < cols; cI++) {
      const wx = 8 + cI * ((w - 16) / cols), wy = 10 + r * ((h - 20) / rows);
      const ww = (w - 16) / cols - 5, wh = (h - 20) / rows - 6;
      const lit = hash2(seedI * 31 + r * 7 + cI * 3, seedI + r) < (kind === 'office' ? 0.55 : 0.42);
      wg.fillStyle = kind === 'office' ? 'rgba(30,42,55,0.9)' : 'rgba(25,32,44,0.95)';
      wg.fillRect(wx, wy, ww, wh);
      if (lit) { eg.fillStyle = kind === 'office' ? '#bcd8ff' : '#ffd97a'; eg.fillRect(wx, wy, ww, wh); }
    }
  }
  wg.fillStyle = trim; wg.fillRect(0, h - 6, w, 6);
  const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const out = { map: mk(wall), emissive: mk(emit) };
  facadeCache.set(key, out);
  return out;
}

/* ================================ WORLD ==================================== */
export function createWorld(container, s0) {
  let s = s0;
  const W = CFG.W, H = CFG.H;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;display:block';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#87c5e8');
  scene.fog = new THREE.Fog('#87c5e8', 120, 420);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 900);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x40502f, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);
  sun.target.position.set(W / 2, 0, H / 2);

  /* ------------------------------ ground ------------------------------ */
  const groundCanvas = paintGround(s);
  const groundTex = new THREE.CanvasTexture(groundCanvas);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.magFilter = THREE.NearestFilter;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2 - 0.5, 0, H / 2 - 0.5);
  ground.receiveShadow = true;
  scene.add(ground);

  const zoneCanvas = paintZones(s);
  const zoneTex = new THREE.CanvasTexture(zoneCanvas);
  zoneTex.colorSpace = THREE.SRGBColorSpace;
  const zones = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ map: zoneTex, transparent: true, depthWrite: false })
  );
  zones.rotation.x = -Math.PI / 2;
  zones.position.set(W / 2 - 0.5, 0.02, H / 2 - 0.5);
  scene.add(zones);

  /* ------------------------------- water ------------------------------- */
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 60, H + 60),
    new THREE.MeshStandardMaterial({ color: 0x1d6f9e, transparent: true, opacity: 0.88, roughness: 0.25, metalness: 0.1 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(W / 2 - 0.5, -0.18, H / 2 - 0.5);
  scene.add(water);

  /* --------------------------- outside marker --------------------------- */
  const marker = new THREE.Group();
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 2.2, 4),
    new THREE.MeshStandardMaterial({ color: 0x38d96b, emissive: 0x1c7a3a, roughness: 0.4 })
  );
  arrow.rotation.z = -Math.PI / 2;
  arrow.position.y = 3.4;
  marker.add(arrow);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.7, 32),
    new THREE.MeshBasicMaterial({ color: 0x38d96b, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
  marker.add(ring);
  scene.add(marker);
  function placeMarker() {
    const o = s.outside;
    marker.position.set(o.x + o.dx * 1.2, 0, o.y + o.dy * 1.2);
    marker.rotation.y = Math.atan2(-o.dx, -o.dy);
  }
  placeMarker();

  /* ------------------------------ highlight ----------------------------- */
  const hl = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.55, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  hl.rotation.x = -Math.PI / 2; hl.rotation.z = Math.PI / 4;
  hl.position.y = 0.06; hl.visible = false;
  scene.add(hl);

  /* ------------------------------ dynamics ------------------------------ */
  const roadMeshes = new Map();   // tile.i -> {key, mesh}
  const bldGroups = new Map();    // tile.i -> {rev, group, mats}
  const anim = [];                // {obj, fn} per-frame animations
  const facadeMats = [];          // materials whose emissiveIntensity follows night
  let treeTrunks = null, treeTops = null, treeKey = '';
  let roadTilesCache = [];
  let carMesh = null;
  const cars = [];
  const CAR_COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0xecf0f1, 0x9b59b6, 0x2ecc71, 0xe67e22];

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.ConeGeometry(0.74, 0.5, 4);

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry && o.geometry !== unitBox && o.geometry !== roofGeo) o.geometry.dispose();
    });
    scene.remove(g);
  }

  /* --------------------------- road tile meshes -------------------------- */
  function maskOf(t) {
    let m = 0;
    const at = (x, y) => { const n = s.tiles[y * W + x]; return n && n.road ? 1 : 0; };
    if (t.y > 0) m |= at(t.x, t.y - 1);
    if (t.x < W - 1) m |= at(t.x + 1, t.y) << 1;
    if (t.y < H - 1) m |= at(t.x, t.y + 1) << 2;
    if (t.x > 0) m |= at(t.x - 1, t.y) << 3;
    return m || 15;
  }

  const roadGeo = new THREE.PlaneGeometry(1, 1);
  function syncRoads() {
    const seen = new Set();
    for (const t of s.tiles) {
      if (!t.road) continue;
      seen.add(t.i);
      const m = maskOf(t);
      const key = t.road + ':' + m;
      const cur = roadMeshes.get(t.i);
      if (cur && cur.key === key) continue;
      if (cur) { scene.remove(cur.mesh); cur.mesh.material.dispose?.(); }
      const mat = new THREE.MeshStandardMaterial({ map: roadTexture(t.road, m), roughness: 0.92, metalness: 0.02 });
      const mesh = new THREE.Mesh(roadGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(t.x, 0.03, t.y);
      mesh.receiveShadow = true;
      scene.add(mesh);
      roadMeshes.set(t.i, { key, mesh });
    }
    for (const [i, cur] of roadMeshes) {
      if (!seen.has(i)) { scene.remove(cur.mesh); roadMeshes.delete(i); }
    }
    roadTilesCache = s.tiles.filter((t) => t.road);
  }

  /* --------------------------- building meshes --------------------------- */
  const SIZES = {
    res: [0.55, 0.6, 0.66], com: [0.6, 0.64, 0.68], ind: [0.78, 0.8, 0.82], office: [0.6, 0.62, 0.66],
  };
  function buildStandardBlock(kind, lvl, t) {
    const g = new THREE.Group();
    const f = facade(kind, lvl, t.x * 131 + t.y);
    const mat = new THREE.MeshStandardMaterial({
      map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.1, roughness: 0.85, metalness: kind === 'office' ? 0.35 : 0.08,
    });
    facadeMats.push(mat);
    const hgt = { res: [0.4, 1.0, 2.3], com: [0.5, 1.3, 3.0], ind: [0.45, 0.6, 0.8], office: [1.3, 2.6, 4.4] }[kind][lvl - 1];
    const inset = SIZES[kind][lvl - 1];
    const body = new THREE.Mesh(unitBox, mat);
    body.scale.set(inset, hgt, inset);
    body.position.y = hgt / 2;
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    if (kind === 'res' && lvl === 1) {
      const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xa8563f, roughness: 0.9 }));
      roof.scale.set(inset + 0.14, 0.55, inset + 0.14);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = hgt + 0.27;
      roof.castShadow = true;
      g.add(roof);
    } else {
      const top = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: new THREE.Color(WALLS[kind][lvl - 1][1]), roughness: 0.9 }));
      top.scale.set(inset * 0.9, 0.06, inset * 0.9);
      top.position.y = hgt + 0.03;
      g.add(top);
    }
    if (kind === 'ind' && lvl >= 2) {
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.7 + lvl * 0.25, 10), new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.8 }));
      ch.position.set(inset * 0.28, (0.7 + lvl * 0.25) / 2 + hgt * 0.5, inset * 0.28);
      ch.castShadow = true;
      g.add(ch);
    }
    if (kind === 'office' && lvl === 3) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xdde4ea }));
      ant.position.y = hgt + 0.45;
      g.add(ant);
    }
    return g;
  }

  function buildService(k, t) {
    const g = new THREE.Group();
    const defs = {
      police: { col: 0x3b6fd4, h: 0.55 },
      fire: { col: 0xc4453a, h: 0.6 },
      hospital: { col: 0xe8ecef, h: 0.75 },
      school: { col: 0xd9b34a, h: 0.5 },
    };
    const d = defs[k];
    const mat = new THREE.MeshStandardMaterial({ color: d.col, roughness: 0.75 });
    facadeMats.push(mat);
    const body = new THREE.Mesh(unitBox, mat);
    body.scale.set(0.72, d.h, 0.6);
    body.position.y = d.h / 2;
    body.castShadow = true;
    g.add(body);
    const roof = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x555c66, roughness: 0.9 }));
    roof.scale.set(0.5, 0.08, 0.4);
    roof.position.y = d.h + 0.04;
    g.add(roof);
    const tower = new THREE.Mesh(unitBox, mat);
    tower.scale.set(0.16, d.h + 0.5, 0.16);
    tower.position.set(0.24, (d.h + 0.5) / 2, 0.18);
    tower.castShadow = true;
    g.add(tower);
    if (k === 'hospital') {
      const cross = document.createElement('canvas'); cross.width = cross.height = 64;
      const cg = cross.getContext('2d');
      cg.fillStyle = '#d43f3f';
      cg.fillRect(26, 10, 12, 44); cg.fillRect(10, 26, 44, 12);
      const ct = new THREE.CanvasTexture(cross); ct.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: ct, transparent: true }));
      sign.rotation.x = -Math.PI / 2;
      sign.position.y = d.h + 0.55;
      g.add(sign);
    }
    return g;
  }

  function buildPower(k, t) {
    const g = new THREE.Group();
    if (k === 'coal') {
      const hall = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.85 }));
      hall.scale.set(0.85, 0.5, 0.65); hall.position.y = 0.25; hall.castShadow = true;
      g.add(hall);
      for (const ox of [-0.22, 0.22]) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.7, 12), new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.8 }));
        stack.position.set(ox, 0.85, -0.18); stack.castShadow = true;
        g.add(stack);
      }
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4a4a }));
      lamp.position.set(0, 1.75, -0.18);
      g.add(lamp);
      anim.push({ obj: lamp, fn: (o, now) => { o.visible = (now / 600) % 2 < 1; } });
    } else if (k === 'wind') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 1.9, 8), new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.5 }));
      pole.position.y = 0.95; pole.castShadow = true;
      g.add(pole);
      const rotor = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.85, 0.03), new THREE.MeshStandardMaterial({ color: 0xf4f7f9, roughness: 0.5 }));
        blade.position.y = 0.45;
        const hold = new THREE.Group();
        hold.rotation.z = (i * Math.PI * 2) / 3;
        hold.add(blade);
        rotor.add(hold);
      }
      rotor.position.y = 1.9;
      g.add(rotor);
      anim.push({ obj: rotor, fn: (o, now, dt) => { o.rotation.z += dt * (1.2 + hash2(t.x, t.y) * 0.8); } });
    } else { // solar
      const pad = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.95 }));
      pad.scale.set(0.9, 0.03, 0.9); pad.position.y = 0.015;
      g.add(pad);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        const panel = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x1c3a63, roughness: 0.3, metalness: 0.5 }));
        panel.scale.set(0.36, 0.03, 0.26);
        panel.position.set(-0.2 + c * 0.4, 0.16, -0.2 + r * 0.4);
        panel.rotation.x = -0.5;
        panel.castShadow = true;
        g.add(panel);
      }
    }
    return g;
  }

  function buildParkOrPlaza(k, t) {
    const g = new THREE.Group();
    if (k === 'park') {
      const grass = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x3f9449, roughness: 0.95 }));
      grass.scale.set(0.94, 0.02, 0.94); grass.position.y = 0.01;
      g.add(grass);
      for (let i = 0; i < 3; i++) {
        const h = 0.3 + hash2(t.x * 3 + i, t.y) * 0.25;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, h * 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x6b4b2a }));
        trunk.position.set(-0.25 + (i * 0.25), h * 0.2, -0.15 + hash2(t.x, t.y + i) * 0.35);
        g.add(trunk);
        const top = new THREE.Mesh(new THREE.ConeGeometry(0.13, h, 7), new THREE.MeshStandardMaterial({ color: i % 2 ? '#2f7d3a' : '#37904a', roughness: 0.9 }));
        top.position.copy(trunk.position); top.position.y = h * 0.4 + h * 0.5;
        top.castShadow = true;
        g.add(top);
      }
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0x333940, emissive: 0xffd97a, emissiveIntensity: 0.4 }));
      lamp.position.set(0.3, 0.15, 0.28);
      g.add(lamp);
    } else {
      const pave = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.95 }));
      pave.scale.set(0.96, 0.03, 0.96); pave.position.y = 0.015;
      g.add(pave);
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.12, 18), new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 }));
      basin.position.y = 0.08; basin.castShadow = true;
      g.add(basin);
      const waterD = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 18), new THREE.MeshStandardMaterial({ color: 0x2f9ec4, transparent: true, opacity: 0.85, roughness: 0.15 }));
      waterD.position.y = 0.13;
      g.add(waterD);
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.7 }));
      jet.position.y = 0.3;
      g.add(jet);
      anim.push({ obj: jet, fn: (o, now) => { o.scale.y = 0.8 + Math.sin(now * 0.004 + t.x) * 0.3; } });
    }
    return g;
  }

  function buildSite(t) {
    const g = new THREE.Group();
    const slab = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.95 }));
    slab.scale.set(0.8, 0.04, 0.8); slab.position.y = 0.02;
    g.add(slab);
    const mast = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0xe5a33b, roughness: 0.7 }));
    mast.scale.set(0.06, 1.4, 0.06); mast.position.set(0.25, 0.7, 0.25);
    mast.castShadow = true;
    g.add(mast);
    const arm = new THREE.Group();
    const beam = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0xe5a33b }));
    beam.scale.set(0.9, 0.05, 0.05); beam.position.x = -0.45;
    arm.add(beam);
    const cable = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x333940 }));
    cable.scale.set(0.02, 0.3, 0.02); cable.position.set(-0.8, -0.15, 0);
    arm.add(cable);
    arm.position.y = 1.4;
    g.add(arm);
    anim.push({ obj: arm, fn: (o, now) => { o.rotation.y = Math.sin(now * 0.0006 + t.x) * 0.7; } });
    return g;
  }

  function syncBuildings() {
    for (const t of s.tiles) {
      if (!t.b) continue;
      const cur = bldGroups.get(t.i);
      const sig = t.rev + (t.b.ab ? 'a' : '') + (t.b.site ? 's' : '');
      if (cur && cur.rev === t.rev && cur.sig === sig) continue;
      if (cur) disposeGroup(cur.group);
      let g;
      if (t.b.site) g = buildSite(t);
      else if (t.b.k === 'res' || t.b.k === 'com' || t.b.k === 'ind' || t.b.k === 'office') {
        g = buildStandardBlock(t.b.k, t.b.lvl, t);
        if (t.b.ab) {
          g.traverse((o) => {
            if (o.material && o.material.emissiveIntensity !== undefined) o.material.emissiveIntensity = 0;
            if (o.material && o.material.color) o.material.color.multiplyScalar(0.45);
          });
        }
      } else if (CFG.BUILDS[t.b.k] && CFG.BUILDS[t.b.k].cat === 'service') g = buildService(t.b.k, t);
      else if (CFG.BUILDS[t.b.k] && CFG.BUILDS[t.b.k].cat === 'power') g = buildPower(t.b.k, t);
      else g = buildParkOrPlaza(t.b.k, t);
      g.position.set(t.x, 0, t.y);
      scene.add(g);
      bldGroups.set(t.i, { rev: t.rev, sig, group: g });
    }
    // removed buildings
    for (const [i, cur] of bldGroups) {
      const t = s.tiles[i];
      if (!t.b) { disposeGroup(cur.group); bldGroups.delete(i); }
    }
  }

  /* ------------------------------- trees -------------------------------- */
  function syncTrees() {
    const list = [];
    for (const t of s.tiles) if (t.tree && !t.road && !t.b && !t.z) list.push(t);
    const key = list.length + ':' + (list.length ? list[0].i + ',' + list[list.length - 1].i : '');
    if (key === treeKey) return;
    treeKey = key;
    if (treeTrunks) { scene.remove(treeTrunks); scene.remove(treeTops); }
    const n = list.length;
    treeTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x6b4b2a, roughness: 0.9 }), Math.max(1, n));
    treeTops = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 0.55, 6), new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.9 }), Math.max(1, n));
    treeTrunks.castShadow = treeTops.castShadow = true;
    const dummy = new THREE.Object3D();
    list.forEach((t, i) => {
      const jx = (hash2(t.x, t.y) - 0.5) * 0.4, jz = (hash2(t.y, t.x) - 0.5) * 0.4;
      const sc = 0.7 + hash2(t.x * 3, t.y * 5) * 0.7;
      dummy.position.set(t.x + jx, 0.15 * sc, t.y + jz);
      dummy.scale.setScalar(sc);
      dummy.rotation.y = hash2(t.x + 9, t.y) * 6.28;
      dummy.updateMatrix();
      treeTrunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = (0.3 + 0.22) * sc;
      dummy.updateMatrix();
      treeTops.setMatrixAt(i, dummy.matrix);
    });
    treeTrunks.count = n; treeTops.count = n;
    scene.add(treeTrunks); scene.add(treeTops);
  }

  /* -------------------------------- cars --------------------------------- */
  function ensureCars(n) {
    if (carMesh && carMesh.count >= n) { carMesh.count = n; return; }
    if (carMesh) scene.remove(carMesh);
    carMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.07, 0.3),
      new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.4 }),
      n
    );
    carMesh.castShadow = false;
    carMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) carMesh.setColorAt(i, new THREE.Color(CAR_COLORS[i % CAR_COLORS.length]));
    scene.add(carMesh);
  }

  function neighbors4(t) {
    const out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = s.tiles[(t.y + dy) * W + (t.x + dx)];
      if (n && n.road) out.push(n);
    }
    return out;
  }

  function stepCars(dt, s2) {
    const target = Math.min(70, Math.floor(roadTilesCache.length / 4) + Math.floor((s2.pop + s2.jobsC + s2.jobsI + s2.jobsO) / 60));
    if (roadTilesCache.length > 3 && cars.length < target && Math.random() < dt * 3) {
      const t = roadTilesCache[(Math.random() * roadTilesCache.length) | 0];
      const nbs = neighbors4(t);
      if (nbs.length) {
        const n = nbs[(Math.random() * nbs.length) | 0];
        cars.push({ x: t.x, y: t.y, nx: n.x, ny: n.y, t: 0, sp: (0.8 + Math.random() * 0.8) * CFG.ROAD[t.road].speed, col: (Math.random() * CAR_COLORS.length) | 0, life: 40 + Math.random() * 90 });
      }
    }
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      c.life -= dt;
      const here = s.tiles[c.y * W + c.x], next = s.tiles[c.ny * W + c.nx];
      if (!here || !next || !here.road || !next.road || c.life <= 0) { cars.splice(i, 1); continue; }
      c.t += dt * c.sp;
      if (c.t >= 1) {
        const px = c.x, py = c.y;
        c.x = c.nx; c.y = c.ny; c.t = 0;
        const nbs = neighbors4(here);
        if (!nbs.length) { cars.splice(i, 1); continue; }
        const dx = c.x - px, dy = c.y - py;
        const straight = nbs.find((n) => n.x === c.x + dx && n.y === c.y + dy);
        const pick = straight && Math.random() < 0.7 ? straight : nbs[(Math.random() * nbs.length) | 0];
        c.nx = pick.x; c.ny = pick.y;
        c.sp = (0.8 + Math.random() * 0.8) * CFG.ROAD[here.road].speed;
      }
    }
    ensureCars(Math.max(1, cars.length));
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const wx = lerp(c.x, c.nx, c.t), wz = lerp(c.y, c.ny, c.t);
      dummy.position.set(wx, 0.07, wz);
      dummy.rotation.y = Math.atan2(c.nx - c.x, c.ny - c.y) + Math.PI;
      dummy.updateMatrix();
      carMesh.setMatrixAt(i, dummy.matrix);
    }
    if (cars.length) carMesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------ day/night ------------------------------ */
  let dayTime = 0.35; // 0..1, 0.5 = noon
  const SKY_DAY = new THREE.Color('#87c5e8'), SKY_DUSK = new THREE.Color('#e8935e'), SKY_NIGHT = new THREE.Color('#0b1026');
  function setDayTime(v) {
    dayTime = ((v % 1) + 1) % 1;
    const ang = dayTime * Math.PI * 2 - Math.PI / 2; // 0.5 -> top
    const alt = Math.sin(ang);
    const R = 190;
    sun.position.set(W / 2 + Math.cos(ang) * R * 0.7, Math.max(8, alt * R), H / 2 + R * 0.35);
    const day = clamp01(alt * 2.2);
    const dusk = clamp01(1 - Math.abs(alt) * 3.2);
    sun.intensity = 0.15 + day * 1.5;
    hemi.intensity = 0.18 + day * 0.6;
    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, day).lerp(SKY_DUSK, dusk * 0.55 * (day * 0.8 + 0.2));
    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    const night = 1 - day;
    for (const m of facadeMats) m.emissiveIntensity = 0.08 + night * 0.95;
    water.material.color.setHSL(0.55, 0.55, 0.18 + day * 0.22);
  }
  setDayTime(dayTime);

  /* ------------------------------- camera -------------------------------- */
  const cam = {
    tx: W / 2, tz: H / 2, yaw: Math.PI * 0.75, pitch: 0.95, dist: 60,
    eye: new THREE.Vector3(),
  };
  function applyCamera(dt) {
    const k = dt == null ? 1 : 1 - Math.exp(-dt * 9);
    cam._x = lerp(cam._x ?? cam.tx, cam.tx, k);
    cam._z = lerp(cam._z ?? cam.tz, cam.tz, k);
    cam._d = lerp(cam._d ?? cam.dist, cam.dist, k);
    cam._p = lerp(cam._p ?? cam.pitch, cam.pitch, k);
    cam._y = lerp(cam._y ?? cam.yaw, cam.yaw, k);
    const cp = Math.cos(cam._p), sp = Math.sin(cam._p);
    cam.eye.set(
      cam._x + Math.sin(cam._y) * cp * cam._d,
      sp * cam._d,
      cam._z + Math.cos(cam._y) * cp * cam._d
    );
    camera.position.copy(cam.eye);
    camera.lookAt(cam._x, 0, cam._z);
  }
  function panBy(dx, dy) {
    const f = { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) };
    const r = { x: -f.z, z: f.x };
    const k = cam.dist * 0.0016;
    cam.tx = clamp(cam.tx + (-dx * r.x + -dy * f.x) * k, -8, W + 8);
    cam.tz = clamp(cam.tz + (-dx * r.z + -dy * f.z) * k, -8, H + 8);
  }
  function keyPan(dt2, keys) {
    const f = { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) };
    const r = { x: -f.z, z: f.x };
    const v = cam.dist * 0.9 * dt2;
    if (keys.w) { cam.tx += f.x * v; cam.tz += f.z * v; }
    if (keys.s) { cam.tx -= f.x * v; cam.tz -= f.z * v; }
    if (keys.a) { cam.tx -= r.x * v; cam.tz -= r.z * v; }
    if (keys.d) { cam.tx += r.x * v; cam.tz += r.z * v; }
    cam.tx = clamp(cam.tx, -8, W + 8); cam.tz = clamp(cam.tz, -8, H + 8);
  }
  function zoomBy(f) { cam.dist = clamp(cam.dist * f, 16, 180); }
  function focusOn(x, z) { cam.tx = x; cam.tz = z; }

  /* ------------------------------- picking ------------------------------- */
  const ndc = new THREE.Vector3();
  function pickTile(clientX, clientY, el) {
    const r = el.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5);
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    if (dir.y >= -0.02) return null;
    const t = -camera.position.y / dir.y;
    const px = camera.position.x + dir.x * t, pz = camera.position.z + dir.z * t;
    const x = Math.round(px), y = Math.round(pz);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return s.tiles[y * W + x];
  }

  /* ------------------------------- overlays ------------------------------ */
  const ovGeo = new THREE.PlaneGeometry(1, 1);
  const ovMeshes = new Map();
  function overlayColor(t, overlay) {
    if (overlay === 'power') {
      if (t.pw && (t.road || t.b)) return 'rgba(0,225,255,0.34)';
      if (t.b && !t.pw) return 'rgba(255,70,70,0.42)';
      return null;
    }
    if (overlay === 'pollution' && t.pol > 1) return `rgba(110,200,40,${Math.min(0.55, (t.pol / 100) * 0.6)})`;
    if (overlay === 'happy' && t.b && t.b.k === 'res' && !t.b.site) return `hsla(${(t.hap / 100) * 120},85%,45%,0.5)`;
    if (overlay === 'land' && t.t !== 0) return `hsla(${30 + t.lv * 40},85%,55%,${0.12 + t.lv * 0.35})`;
    if (overlay === 'traffic' && t.road) {
      const c = clamp01(s.congestion * 1.4 - 0.15);
      return c > 0.05 ? `hsla(${(1 - c) * 110},90%,50%,${0.25 + c * 0.45})` : null;
    }
    if (overlay === 'coverage' && t.b && !t.b.site) {
      const v = Math.max(t.safety || 0, t.health || 0, t.edu || 0, t.parkF || 0);
      return v > 0.02 ? `hsla(${v * 130},85%,50%,0.4)` : 'hsla(0,85%,50%,0.4)';
    }
    return null;
  }
  function syncOverlay(overlay) {
    const seen = new Set();
    if (overlay) {
      for (const t of s.tiles) {
        const col = overlayColor(t, overlay);
        if (!col) continue;
        seen.add(t.i);
        let m = ovMeshes.get(t.i);
        if (!m) {
          m = new THREE.Mesh(ovGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
          m.rotation.x = -Math.PI / 2;
          m.position.set(t.x, 0.05, t.y);
          scene.add(m);
          ovMeshes.set(t.i, m);
        }
        if (m._col !== col) { m.material.color.set(col); m.material.opacity = 1; m._col = col; }
      }
    }
    for (const [i, m] of ovMeshes) if (!seen.has(i)) { scene.remove(m); ovMeshes.delete(i); }
  }

  /* -------------------------------- sync --------------------------------- */
  let zonesDirty = true;
  function markZonesDirty() { zonesDirty = true; }
  function syncAll() {
    syncRoads();
    syncBuildings();
    syncTrees();
    if (zonesDirty) {
      zoneTex.image = paintZones(s);
      zoneTex.needsUpdate = true;
      zonesDirty = false;
    }
    ring.material.opacity = s.connected ? 0.25 : 0.5 + Math.sin(performance.now() * 0.004) * 0.3;
    arrow.material.color.set(s.connected ? 0x38d96b : 0xff5252);
    arrow.material.emissive.set(s.connected ? 0x1c7a3a : 0x7a1c1c);
  }

  /* -------------------------------- reset -------------------------------- */
  function reset(ns) {
    s = ns;
    for (const [, m] of roadMeshes) { scene.remove(m.mesh); m.mesh.material?.dispose?.(); }
    roadMeshes.clear();
    for (const [, b] of bldGroups) disposeGroup(b.group);
    bldGroups.clear();
    for (const [, m] of ovMeshes) scene.remove(m);
    ovMeshes.clear();
    cars.length = 0;
    anim.length = 0;
    treeKey = '';
    groundTex.image = paintGround(s);
    groundTex.needsUpdate = true;
    placeMarker();
  }

  /* ------------------------------- resize -------------------------------- */
  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  function render(dt, now) {
    for (const a of anim) a.fn(a.obj, now, dt);
    water.position.y = -0.18 + Math.sin(now * 0.0008) * 0.02;
    marker.children[0].position.y = 3.4 + Math.sin(now * 0.002) * 0.3;
    applyCamera(dt);
    renderer.render(scene, camera);
  }

  function dispose() {
    for (const [, m] of roadMeshes) m.mesh.material?.dispose?.();
    for (const [, b] of bldGroups) disposeGroup(b.group);
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    renderer, scene, camera,
    syncAll, markZonesDirty, syncOverlay, reset,
    stepCars, setDayTime, getDayTime: () => dayTime,
    pickTile, highlight: hl, focusOn,
    panBy, keyPan, zoomBy, cam,
    resize, render, dispose,
  };
}
