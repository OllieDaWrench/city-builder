/* ============================================================================
   City Builder v2 — game controller. Glues sim + world + UI together:
   input (mouse/touch/keys), the main loop, storage, speed, day cycle.
   ============================================================================ */
import { CFG, TOOLS } from './config.js';
import { newCity, tick, applyAt, serialize, deserialize, recomputeAll } from './sim.js';
import { createWorld } from './world3d.js';
import { createUI } from './ui.js';
import { lineTiles, clamp } from './utils.js';

export function createGame(canvasHolder, root) {
  let s = newCity();
  let world = null;
  let ui = null;

  let tool = 'pan';
  let overlay = null;
  let paused = false;
  let speed = 1;
  let dayCycle = true;

  let hoverTile = null;
  let painting = false, orbiting = false, panning = false;
  let lastPaint = null, lastPos = null;
  const pts = new Map();
  let pinch = null;
  const keys = {};
  const warned = {};

  let acc = 0;
  let lastT = performance.now();
  let raf = 0;
  let disposed = false;

  /* ------------------------------- storage ------------------------------- */
  let memSave = null;
  const store = () => { try { return window.localStorage; } catch (e) { return null; } };

  function save(auto) {
    const data = JSON.stringify(serialize(s));
    const ls = store();
    if (!ls) { memSave = data; if (!auto) ui.toast('Storage blocked here — use Export ⬇️ instead', 'warn'); return false; }
    try { ls.setItem(CFG.SAVE_KEY, data); if (!auto) ui.toast('City saved 💾'); return true; }
    catch (e) { memSave = data; if (!auto) ui.toast('Save failed — try Export', 'warn'); return false; }
  }
  function rawSave() {
    const ls = store();
    return ls ? ls.getItem(CFG.SAVE_KEY) : memSave;
  }
  function load() {
    const raw = rawSave();
    if (!raw) return false;
    try { setCity(deserialize(JSON.parse(raw))); return true; } catch (e) { return false; }
  }
  function exportSave() {
    try {
      const blob = new Blob([JSON.stringify(serialize(s))], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `city-builder-${s.cityName.replace(/\s+/g, '-').toLowerCase()}-${s.year}-${String(s.month).padStart(2, '0')}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      ui.toast('Save exported ⬇️');
    } catch (e) { ui.toast('Export blocked in this preview', 'warn'); }
  }
  function importSave(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try { setCity(deserialize(JSON.parse(String(rd.result)))); ui.toast('City loaded 📂'); }
      catch (e) { ui.toast('That file is not a valid save', 'warn'); }
    };
    rd.readAsText(file);
  }
  function newCityUI(seed) {
    setCity(newCity(seed));
    ui.toast(`Welcome to ${s.cityName} 🌊`);
  }
  function setCity(ns) {
    s = ns;
    s.onAutosave = () => save(true);
    s.toastPush = (m, k) => ui.toast(m, k);
    acc = 0;
    world.reset(s);
    ui.el.querySelector('#cb-cityname').value = s.cityName;
    world.syncAll();
    world.syncOverlay(overlay);
    ui.updateHUD();
  }

  /* ------------------------------ tools/paint ---------------------------- */
  function warnOnce(key, msg) {
    if (!msg || warned[key]) return;
    warned[key] = true;
    ui.toast(msg, 'warn');
    setTimeout(() => delete warned[key], 2500);
  }

  function applyToolAt(t) {
    const r = applyAt(s, tool, t);
    if (r.msg) warnOnce(tool + r.msg, r.msg);
    if (r.ok) world.markZonesDirty();
    return r;
  }

  function paintTo(t) {
    if (!lastPaint) { applyToolAt(t); lastPaint = t; return; }
    if (t.i === lastPaint.i) return;
    lineTiles(lastPaint.x, lastPaint.y, t.x, t.y, (x, y) => {
      const tt = s.tiles[y * CFG.W + x];
      if (tt) applyToolAt(tt);
    });
    lastPaint = t;
  }

  function finishStroke() {
    recomputeAll(s);
    world.syncAll();
    world.syncOverlay(overlay);
    ui.updateHUD();
  }

  /* ------------------------------ day/night ------------------------------ */
  function advanceDay(dt) {
    if (!dayCycle) return;
    world.setDayTime(world.getDayTime() + dt * speed * 0.02); // one day ≈ 50 s at 1x
  }

  /* -------------------------------- input -------------------------------- */
  const dom = () => world.renderer.domElement;

  function onDown(e) {
    const el = dom();
    const r = el.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    pts.set(e.pointerId, p);
    if (pts.size === 2) {
      painting = false; orbiting = false; panning = false;
      const [a, b] = [...pts.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, d0: world.cam.dist, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    el.setPointerCapture?.(e.pointerId);
    lastPos = p;
    if (e.button === 2 || e.button === 1) orbiting = true;
    else if (e.shiftKey || tool === 'pan') {
      if (tool === 'pan' && e.button === 0) {
        const t = world.pickTile(e.clientX, e.clientY, el);
        if (t && t.b) { ui.showInfo(t); return; }
        ui.hideInfo();
      }
      panning = true;
    } else {
      painting = true; lastPaint = null;
      const t = world.pickTile(e.clientX, e.clientY, el);
      if (t) { applyToolAt(t); lastPaint = t; ui.updateHUD(); }
    }
  }

  function onMove(e) {
    const el = dom();
    const r = el.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (pts.has(e.pointerId)) pts.set(e.pointerId, p);

    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      world.cam.dist = clamp(pinch.d0 * (pinch.dist / dist), 16, 180);
      world.panBy(pinch.mid.x - (a.x + b.x) / 2, pinch.mid.y - (a.y + b.y) / 2);
      pinch.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return;
    }

    hoverTile = world.pickTile(e.clientX, e.clientY, el);
    if (hoverTile) {
      world.highlight.visible = tool !== 'pan';
      world.highlight.position.set(hoverTile.x, 0.06, hoverTile.y);
    } else world.highlight.visible = false;

    if (orbiting && lastPos) {
      world.cam.yaw -= (p.x - lastPos.x) * 0.005;
      world.cam.pitch = clamp(world.cam.pitch + (p.y - lastPos.y) * 0.004, 0.35, 1.4);
    } else if (panning && lastPos) {
      world.panBy(p.x - lastPos.x, p.y - lastPos.y);
    } else if (painting && hoverTile) {
      paintTo(hoverTile);
      ui.updateHUD();
    }
    lastPos = p;
  }

  function onUp(e) {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      const wasPainting = painting;
      painting = false; orbiting = false; panning = false; lastPos = null;
      if (wasPainting) finishStroke();
    }
  }

  function onWheel(e) {
    e.preventDefault();
    world.zoomBy(Math.exp(-e.deltaY * 0.0012));
  }

  function onKeyDown(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown') e.preventDefault();
    if (k === ' ') { e.preventDefault(); setPaused(!paused); return; }
    if (k === 'h') { ui.openHelp(); return; }
    if (k === 'escape') { ui.closeModal(); setTool('pan'); return; }
    const t = TOOLS.find((x) => x.key === k);
    if (t) ui.setTool(t.id);
    keys[k] = true;
  }
  function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }

  function setPaused(p) { paused = p; syncSpeed(); }
  function setSpeed(v) { speed = v; paused = false; syncSpeed(); }
  function setTool(id) { tool = id; painting = false; dom().style.cursor = id === 'pan' ? 'grab' : 'crosshair'; }
  function toggleOverlay(id) { overlay = overlay === id ? null : id; world.syncOverlay(overlay); return overlay; }
  function toggleDayCycle() {
    dayCycle = !dayCycle;
    if (!dayCycle) world.setDayTime(0.42);
    ui.toast(dayCycle ? 'Day/night cycle on 🌗' : 'Permanent daylight ☀️');
    return dayCycle;
  }
  function syncSpeed() {
    ui.pause.classList.toggle('active', paused);
    ui.play.classList.toggle('active', !paused && speed === 1);
    ui.fast.classList.toggle('active', !paused && speed === 3);
  }

  /* -------------------------------- loop --------------------------------- */
  function loop(now) {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;

    world.keyPan(dt, keys);
    if (!paused) {
      acc += dt * speed;
      let guard = 0;
      while (acc >= CFG.TICK_SECONDS && guard++ < 4) { acc -= CFG.TICK_SECONDS; tick(s); ui.updateHUD(); }
    }
    advanceDay(dt);
    world.stepCars(dt, s);
    world.render(dt, now);

    // hover tooltip (throttled to pointer position via mousemove-free approach)
    if (hoverTile && tool !== 'pan' && pts.size === 0 && !painting) ui.showTip(lastPos?.x ?? -100, lastPos?.y ?? -100, hoverTile);
    else if (!hoverTile || painting) ui.hideTip();
  }

  /* ------------------------------ bootstrap ------------------------------ */
  world = createWorld(root, s);
  s.onAutosave = () => save(true);
  s.toastPush = (m, k) => ui.toast(m, k);

  ui = createUI(root, {
    s,
    tool: () => tool,
    setTool,
    setPaused,
    setSpeed,
    toggleOverlay,
    toggleDayCycle,
    save,
    load,
    rawSave,
    exportSave,
    importSave,
    newCity: newCityUI,
    recompute: () => { recomputeAll(s); },
  });
  setCity(s);

  const el = () => world.renderer.domElement;
  const listen = (target, ev, fn, opt) => {
    target.addEventListener(ev, fn, opt);
    return () => target.removeEventListener(ev, fn, opt);
  };
  const disposers = [
    listen(window, 'resize', () => world.resize()),
    listen(el(), 'pointerdown', onDown),
    listen(el(), 'pointermove', onMove),
    listen(window, 'pointerup', onUp),
    listen(window, 'pointercancel', onUp),
    listen(el(), 'wheel', onWheel, { passive: false }),
    listen(el(), 'contextmenu', (e) => e.preventDefault()),
    listen(el(), 'pointerleave', () => { hoverTile = null; world.highlight.visible = false; ui.hideTip(); }),
    listen(window, 'keydown', onKeyDown),
    listen(window, 'keyup', onKeyUp),
  ];

  raf = requestAnimationFrame(loop);
  setTimeout(() => { if (!disposed && s.tick === 0) ui.openHelp(); }, 600);

  return {
    getState: () => s,
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const d of disposers) { try { d(); } catch (e) { /* noop */ } }
      world.dispose();
      ui.el.remove();
    },
  };
}
