/* ============================================================================
   City Builder v2 — DOM UI (HUD, toolbar, panels, modals, toasts).
   Pure DOM, talks to the sim state + game callbacks via a small ctx object.
   ============================================================================ */
import { CFG, TOOLS, TOOL_CATEGORIES, OVERLAYS, MONTHS, ZONE_NAME, TERRAIN_NAME } from './config.js';
import { fmt$, clamp01 } from './utils.js';

const esc = (str) => String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createUI(root, ctx) {
  const ui = {};
  const el = document.createElement('div');
  el.className = 'cb-ui';
  el.innerHTML = `
    <div class="cb-hud">
      <input id="cb-cityname" title="Click to rename your city" value="${esc(ctx.s.cityName)}" spellcheck="false" maxlength="24">
      <span class="cb-stat" title="Treasury">💰 <b id="cb-money"></b></span>
      <span class="cb-stat" title="Population">👥 <b id="cb-pop"></b></span>
      <span class="cb-stat" title="Average happiness">😊 <b id="cb-happy"></b></span>
      <span class="cb-stat" title="Jobs (shops / industry / offices)">💼 <b id="cb-jobs"></b></span>
      <span class="cb-stat" title="Monthly balance">📈 <b id="cb-bal"></b></span>
      <span class="cb-stat" title="Date">📅 <b id="cb-date"></b></span>
      <span class="cb-demand" title="Demand — R homes · C shops · I industry · O offices">
        <i>R</i><span class="cb-dbar"><span class="cb-dfill" id="cb-dr" style="background:#4ade80"></span></span>
        <i>C</i><span class="cb-dbar"><span class="cb-dfill" id="cb-dc" style="background:#60a5fa"></span></span>
        <i>I</i><span class="cb-dbar"><span class="cb-dfill" id="cb-di" style="background:#facc15"></span></span>
        <i>O</i><span class="cb-dbar"><span class="cb-dfill" id="cb-do" style="background:#22d3ee"></span></span>
      </span>
      <span class="cb-speed">
        <button id="cb-pause" title="Pause (Space)">⏸</button>
        <button id="cb-play" title="Normal speed">▶️</button>
        <button id="cb-fast" title="Fast forward">⏩</button>
      </span>
    </div>

    <div id="cb-connwarn" class="cb-connwarn hidden">⛔ <b>Not connected!</b> Your road network must reach the highway marker <span style="color:#38d96b">▲</span> at the map edge before anyone will move in.</div>

    <div class="cb-side">
      <div class="cb-side-group" id="cb-overlays">
        ${OVERLAYS.map((o) => `<button data-ov="${o.id}" title="${o.name} overlay">${o.icon}</button>`).join('')}
      </div>
      <div class="cb-side-group">
        <button id="cb-daynight" title="Toggle day/night cycle">🌗</button>
        <button id="cb-save" title="Save to this browser">💾</button>
        <button id="cb-load" title="Load saved city">📂</button>
        <button id="cb-export" title="Export save file">⬇️</button>
        <button id="cb-import" title="Import save file">⬆️</button>
        <button id="cb-new" title="New city">🗺️</button>
        <button id="cb-settings" title="Budget & taxes">⚙️</button>
        <button id="cb-help" title="How to play (H)">❓</button>
      </div>
    </div>

    <div class="cb-dock">
      <div class="cb-cats" id="cb-cats">
        <button class="cb-cat" data-cat="-" title="Quick tools"><span class="ico">🖐️</span><span class="lbl">Pan</span></button>
        ${TOOL_CATEGORIES.map((c) => `<button class="cb-cat" data-cat="${c.id}"><span class="ico">${c.icon}</span><span class="lbl">${c.name}</span></button>`).join('')}
        <button class="cb-cat" data-cat="dozer" title="Bulldoze"><span class="ico">💥</span><span class="lbl">Bulldoze</span></button>
      </div>
      <div class="cb-subtools hidden" id="cb-subtools"></div>
    </div>
    <div class="cb-hint hidden" id="cb-hint"></div>
    <div class="cb-tooltip hidden" id="cb-tooltip"></div>
    <div class="cb-info hidden" id="cb-info"></div>
    <div class="cb-toasts" id="cb-toasts"></div>
    <div class="cb-backdrop hidden" id="cb-modal"></div>
    <input type="file" id="cb-file" accept="application/json,.json" style="display:none">
  `;
  root.appendChild(el);
  for (const m of el.innerHTML.matchAll(/id="(cb-[a-z-]+)"/g)) {
    ui[m[1].slice(3)] = el.querySelector('#' + m[1]); // 'cb-money' -> ui.money
  }

  /* ------------------------------ toolbar ------------------------------ */
  let activeCat = '-';
  function renderCat(cat) {
    activeCat = cat;
    for (const b of ui.cats.querySelectorAll('[data-cat]')) b.classList.toggle('active', b.dataset.cat === cat);
    const sub = ui.subtools;
    if (cat === '-' || cat === 'dozer') { sub.classList.add('hidden'); return; }
    const tools = TOOLS.filter((t) => t.cat === cat);
    sub.innerHTML = tools.map((t) => `
      <button class="cb-tool" data-tool="${t.id}" title="${t.name} (${t.key || 'click'})">
        <span class="ico">${t.icon}</span><span class="lbl">${t.name}</span>
        <span class="cost">${t.cost ? fmt$(t.cost) : 'free'}</span>
      </button>`).join('');
    sub.classList.remove('hidden');
  }

  function setTool(id) {
    ctx.setTool(id);
    const t = TOOLS.find((x) => x.id === id);
    for (const b of ui.subtools.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === id);
    if (t && t.hint) { ui.hint.textContent = t.hint; ui.hint.classList.remove('hidden'); }
    else ui.hint.classList.add('hidden');
    // keep the category open if the tool belongs to one
    if (t && t.cat && t.cat !== activeCat) renderCat(t.cat);
    if (id === 'pan') renderCat('-');
    if (id === 'bulldoze') renderCat('dozer');
  }

  ui.cats.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    const cat = b.dataset.cat;
    if (cat === '-') return ctx.setTool('pan'), renderCat('-');
    if (cat === 'dozer') return ctx.setTool('bulldoze'), renderCat('dozer');
    if (activeCat === cat) { renderCat('-'); return; }
    renderCat(cat);
    const first = TOOLS.find((t) => t.cat === cat);
    if (first) ctx.setTool(first.id), syncActiveTool();
  });
  function syncActiveTool() {
    for (const b of ui.subtools.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === ctx.tool());
  }
  ui.subtools.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
  });

  /* ------------------------------ overlays ----------------------------- */
  ui.overlays.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ov]');
    if (!b) return;
    const ov = ctx.toggleOverlay(b.dataset.ov);
    for (const x of ui.overlays.querySelectorAll('[data-ov]')) x.classList.toggle('active', x.dataset.ov === ov);
  });

  /* ------------------------------- buttons ----------------------------- */
  ui.pause.addEventListener('click', () => ctx.setPaused(true));
  ui.play.addEventListener('click', () => ctx.setSpeed(1));
  ui.fast.addEventListener('click', () => ctx.setSpeed(3));
  ui.save.addEventListener('click', () => ctx.save(false));
  ui.load.addEventListener('click', () => openLoad());
  ui.export.addEventListener('click', () => ctx.exportSave());
  ui.import.addEventListener('click', () => ui.file.click());
  ui.file.addEventListener('change', (e) => { if (e.target.files[0]) ctx.importSave(e.target.files[0]); e.target.value = ''; });
  ui.new.addEventListener('click', openNew);
  ui.settings.addEventListener('click', openBudget);
  ui.help.addEventListener('click', openHelp);
  ui.daynight.addEventListener('click', () => ctx.toggleDayCycle());
  ui.cityname.addEventListener('change', () => {
    ctx.s.cityName = ui.cityname.value.trim() || ctx.s.cityName;
    ui.cityname.value = ctx.s.cityName;
  });

  /* -------------------------------- HUD -------------------------------- */
  function updateHUD() {
    const s = ctx.s;
    ui.money.textContent = fmt$(s.money);
    ui.money.style.color = s.money < 0 ? '#ff7b7b' : '#ffd97a';
    ui.pop.textContent = s.pop.toLocaleString('en-US');
    ui.happy.textContent = Math.round(s.happy * 100) + '%';
    ui.jobs.textContent = `${s.jobsC}/${s.jobsI}/${s.jobsO}`;
    const bal = s.income - s.upkeep;
    ui.bal.textContent = (bal >= 0 ? '+' : '−') + fmt$(Math.abs(bal));
    ui.bal.style.color = bal >= 0 ? '#86efac' : '#ff7b7b';
    ui.date.textContent = `${MONTHS[s.month - 1]} ${s.year}`;
    ui.dr.style.width = Math.round(s.dR * 100) + '%';
    ui.dc.style.width = Math.round(s.dC * 100) + '%';
    ui.di.style.width = Math.round(s.dI * 100) + '%';
    ui.do.style.width = Math.round(s.dO * 100) + '%';
    ui.connwarn.classList.toggle('hidden', s.connected);
  }

  /* ------------------------------- toasts ------------------------------ */
  function toast(msg, kind) {
    const d = document.createElement('div');
    d.className = 'cb-toast' + (kind === 'warn' ? ' warn' : '');
    d.textContent = msg;
    ui.toasts.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, 3600);
    while (ui.toasts.children.length > 4) ui.toasts.firstChild.remove();
  }

  /* ------------------------------ tooltip ------------------------------ */
  const tip = ui.tooltip;
  function showTip(mx, my, t) {
    if (!t) { tip.classList.add('hidden'); return; }
    const rows = [`<b>${TERRAIN_NAME[t.t]}</b>`];
    if (t.road) rows.push(`🛣️ ${CFG.ROAD[t.road].name}${t.pw ? ' · ⚡' : ''}`);
    if (t.z) rows.push(`🗺️ ${ZONE_NAME[t.z]} zone`);
    if (t.b) {
      const def = CFG.BUILDS[t.b.k];
      rows.push(`${def ? def.icon : '🏗️'} <b>${def ? def.name : t.b.k}</b>${t.b.site ? ' · under construction' : ''}${t.b.ab ? ' · abandoned' : ''}`);
      if (t.b.k === 'res' && !t.b.site) rows.push(`👥 ${Math.round(t.b.pop)}/${CFG.POP_CAP[t.b.lvl]} · 😊 ${Math.round(t.hap || 0)}%`);
      if (CFG.JOB_CAP[t.b.k]) rows.push(`💼 ${Math.round(t.b.jobs)}/${CFG.JOB_CAP[t.b.k][t.b.lvl]} jobs`);
    }
    if (t.t !== 0) {
      if (t.pol > 2) rows.push(`☣️ pollution ${Math.round(t.pol)}%`);
      rows.push(`💎 land value ${Math.round((t.lv || 0) * 100)}%`);
      if (t.edu > 0.05) rows.push(`🎓 education ${Math.round(t.edu * 100)}%`);
      if (t.safety > 0.05 || t.health > 0.05) rows.push(`🚨 safety ${Math.round((t.safety || 0) * 100)}% · 🏥 health ${Math.round((t.health || 0) * 100)}%`);
    }
    tip.innerHTML = rows.join('<br>');
    tip.classList.remove('hidden');
    tip.style.transform = `translate(${Math.min(mx + 16, window.innerWidth - 270)}px, ${Math.min(my + 18, window.innerHeight - 150)}px)`;
  }
  function hideTip() { tip.classList.add('hidden'); }

  /* ---------------------------- info card ------------------------------ */
  const info = ui.info;
  function showInfo(t) {
    if (!t || !t.b) { info.classList.add('hidden'); return; }
    const def = CFG.BUILDS[t.b.k];
    const title = def ? def.icon + ' ' + def.name : '🏗️ Building';
    const lvl = ['res', 'com', 'ind', 'office'].includes(t.b.k) ? ` · Level ${t.b.lvl}` : '';
    const bar = (v) => `<span class="cb-ibar"><span style="width:${Math.round(clamp01(v) * 100)}%"></span></span>`;
    info.innerHTML = `
      <button class="cb-x" data-close>✕</button>
      <h3>${title}${lvl}</h3>
      ${t.b.k === 'res' ? `<p>👥 Residents: <b>${Math.round(t.b.pop)}</b> / ${CFG.POP_CAP[t.b.lvl]}</p>` : ''}
      ${CFG.JOB_CAP[t.b.k] ? `<p>💼 Jobs: <b>${Math.round(t.b.jobs)}</b> / ${CFG.JOB_CAP[t.b.k][t.b.lvl]}</p>` : ''}
      <p>💎 Land value ${bar(t.lv)}</p>
      ${t.b.k === 'res' ? `<p>😊 Happiness ${bar((t.hap || 0) / 100)}</p><p>🎓 Education ${bar(t.edu || 0)}</p><p>🚨 Safety ${bar(t.safety || 0)}</p><p>🏥 Health ${bar(t.health || 0)}</p>` : ''}
      <p>☣️ Pollution ${bar(t.pol / 100)}</p>
      ${t.b.ab ? '<p class="cb-dim">This building is abandoned — check power and happiness.</p>' : ''}
    `;
    info.classList.remove('hidden');
    info.querySelector('[data-close]').onclick = () => info.classList.add('hidden');
  }
  function hideInfo() { info.classList.add('hidden'); }

  /* ------------------------------- modals ------------------------------ */
  const modal = ui.modal;
  function openModal(html) {
    modal.innerHTML = `<div class="cb-modal">${html}<button class="cb-x" data-close>✕</button></div>`;
    modal.classList.remove('hidden');
    modal.onclick = (e) => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); };
  }
  function closeModal() { modal.classList.add('hidden'); modal.innerHTML = ''; }

  function openHelp() {
    openModal(`
      <h2>🏛️ How to play</h2>
      <ol class="cb-steps">
        <li><b>Connect to the outside world.</b> A highway stub enters the map at the edge (green ▲ marker). Extend it with roads into your city — nobody arrives without it!</li>
        <li><b>Build power.</b> A coal plant, wind turbines or solar — connected to your road grid. Roads carry the power lines.</li>
        <li><b>Zone next to streets/avenues.</b> 🏠 homes, 🏬 shops, 🏭 industry, 🏢 offices. Buildings construct themselves when the R/C/I/O demand bars are up.</li>
        <li><b>Provide services.</b> Police & fire raise safety, hospitals raise health, schools educate (offices need education!). Parks raise land value so buildings level up.</li>
        <li><b>Watch traffic.</b> Dark red roads on the 🚗 overlay are congested — upgrade them to avenues, or add alternate routes.</li>
      </ol>
      <h3>Controls</h3>
      <table class="cb-keys">
        <tr><td>Left-drag</td><td>build with the selected tool</td></tr>
        <tr><td>Right-drag</td><td>orbit the camera</td></tr>
        <tr><td>Middle-drag / 🖐️ / WASD</td><td>pan</td></tr>
        <tr><td>Scroll / pinch</td><td>zoom</td></tr>
        <tr><td><b>Q/1-9/0/X</b></td><td>tools · <b>Space</b> pause · <b>H</b> help · <b>Esc</b> close</td></tr>
      </table>
      <p class="cb-dim">Your city autosaves every game year. ⬇️ Export keeps a file copy that works anywhere.</p>
      <button class="cb-btn" data-close>Let's build 🏗️</button>
    `);
  }

  function openBudget() {
    const s = ctx.s;
    openModal(`
      <h2>⚙️ Budget & taxes</h2>
      <p>Monthly income <b>${fmt$(s.income)}</b> · upkeep <b>${fmt$(s.upkeep)}</b></p>
      <label class="cb-row">Tax rate <b id="cb-taxv">${s.tax}%</b>
        <input type="range" id="cb-tax" min="0" max="20" step="1" value="${s.tax}">
      </label>
      <p class="cb-dim">Low taxes keep residents happy but earn less. Above 9% happiness starts to drop.</p>
      <div style="margin-top:10px"><button class="cb-btn" data-close>Done</button></div>
    `);
    const tax = modal.querySelector('#cb-tax'), taxv = modal.querySelector('#cb-taxv');
    tax.addEventListener('input', () => { s.tax = +tax.value; taxv.textContent = s.tax + '%'; ctx.recompute(); updateHUD(); });
  }

  function openNew() {
    openModal(`
      <h2>🗺️ New city</h2>
      <p>This abandons <b>${esc(ctx.s.cityName)}</b> and generates a fresh island with a new highway connection.</p>
      <label class="cb-row">Map seed (optional)
        <input type="text" id="cb-seed" placeholder="leave empty for random" maxlength="12">
      </label>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="cb-btn danger" id="cb-gonew">Generate new island</button>
        <button class="cb-btn" data-close>Cancel</button>
      </div>
    `);
    const btn = modal.querySelector('#cb-gonew'), seedIn = modal.querySelector('#cb-seed');
    setTimeout(() => seedIn.focus(), 50);
    btn.addEventListener('click', () => {
      const raw = seedIn.value.trim();
      let seed = 0;
      if (raw) { if (/^\d+$/.test(raw)) seed = +raw % 1e9; else { for (let i = 0; i < raw.length; i++) seed = (seed * 31 + raw.charCodeAt(i)) >>> 0; } }
      ctx.newCity(seed || undefined);
      closeModal();
    });
  }

  function openLoad() {
    const raw = ctx.rawSave();
    if (!raw) return toast('No saved city found in this browser', 'warn');
    let meta = '';
    try {
      const d = JSON.parse(raw);
      meta = `<p class="cb-dim">Saved: <b>${MONTHS[(d.month || 1) - 1]} ${d.year}</b> · 👥 ${(d.pop || 0).toLocaleString()} · ${esc(d.cityName || 'Unnamed')}</p>`;
    } catch (e) { /* ignore */ }
    openModal(`
      <h2>📂 Load city</h2>
      ${meta}
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="cb-btn" id="cb-goload">Load it</button>
        <button class="cb-btn" data-close>Cancel</button>
      </div>
    `);
    modal.querySelector('#cb-goload').addEventListener('click', () => {
      if (ctx.load()) { closeModal(); toast('City loaded 📂'); }
      else toast('Could not read that save', 'warn');
    });
  }

  /* ------------------------------ lifecycle ----------------------------- */
  renderCat('-');
  setTool('pan');
  updateHUD();

  return { updateHUD, toast, showTip, hideTip, showInfo, hideInfo, openHelp, closeModal, setTool, syncActiveTool, get el() { return el; } };
}
