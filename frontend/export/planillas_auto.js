const API_BASE = (window.APP_CONFIG?.API_BASE_URL || 'https://liga-backend-tt82.onrender.com').replace(/\/+$/, '');
const CATEGORY_KEYS = {
  tercera: '__categoria_tercera__',
  segunda: '__categoria_segunda__'
};

const TEAM_ALIASES = {
  DOGOSBILLARDS: ['DOGOS BILLARDS', 'DOGOSBILLARDS'],
  PRBAR: ['PR BAR', 'PRBAR'],
  DUCKHUNTER: ['DUCK HUNTER', 'DUCK HUNTERS', 'DUCKHUNTER', 'DUCKHUNTERS'],
  CHUAVECHITO: ['CHUAVECHITO'],
  IMPERIOSUR: ['IMPERIO SUR', 'IMPERIOSUR'],
  BAIRES: ['BAIRES'],
  LOSPATOSDELTREBOL: ['LOS PATOS DEL TREBOL', 'LOSPATOSDELTREBOL'],
  ELTREBOLDEPACHECO: ['EL TREBOL DE PACHECO', 'ELTREBOLDEPACHECO']
};

const state = {
  category: 'tercera',
  allPlanillas: [],
  completeSheets: []
};

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');
const statusDot = $('#statusDot');
const statusText = $('#statusText');
const statusMeta = $('#statusMeta');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setStatus(kind, text, meta){
  statusDot.className = 'status-dot ' + (kind || '');
  statusText.textContent = text || '';
  statusMeta.textContent = meta || '';
}

function categoryLabel(category){
  return String(category || '').toUpperCase();
}

function normalizeText(value){
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' Y ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function compactKey(value){
  return normalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function teamKeyVariants(value){
  const raw = String(value || '');
  const normalized = normalizeText(raw);
  const variants = new Set();
  const compact = compactKey(raw);
  if (compact) variants.add(compact);

  const baseNormalized = normalized
    .replace(/\b(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const baseCompact = baseNormalized.replace(/[^A-Z0-9]/g, '');
  if (baseCompact) variants.add(baseCompact);

  const slugCompact = compact
    .replace(/(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)$/g, '');
  if (slugCompact) variants.add(slugCompact);

  const noDe = baseCompact.replace(/^DE/, '');
  if (noDe) variants.add(noDe);

  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    const aliasKeys = [canonical, ...aliases].map((v) => compactKey(v)).filter(Boolean);
    if (aliasKeys.includes(compact) || aliasKeys.includes(baseCompact) || aliasKeys.includes(slugCompact)) {
      aliasKeys.forEach((v) => variants.add(v));
    }
  }

  return [...variants].filter(Boolean);
}

function resolvePlanillaCategory(item){
  return 'todas';
}

async function fetchJson(url, options){
  const response = await fetch(url, options);
  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const message = data?.error || data?.message || ('HTTP ' + response.status + ' @ ' + url);
    throw new Error(message);
  }
  return data;
}

function fechaKeyActual(){
  return new Date().toISOString().slice(0, 10);
}

async function checkCrucesEnabled(category){
  const team = CATEGORY_KEYS[category];
  if (!team) return false;
  const params = new URLSearchParams({ team, fechaKey: fechaKeyActual() });
  const data = await fetchJson(`${API_BASE}/api/cruces/status?` + params.toString(), { cache: 'no-store' });
  return !!data?.enabled;
}

async function loadCruces(category){
  const team = CATEGORY_KEYS[category];
  return await fetchJson(`${API_BASE}/api/cruces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team, fechaKey: fechaKeyActual() })
  });
}

async function loadPlanillas(){
  const data = await fetchJson(`${API_BASE}/api/admin/planillas`, { cache: 'no-store' });
  if (!Array.isArray(data)) return [];
  return data.map((item) => ({
    ...item,
    __category: resolvePlanillaCategory(item)
  }));
}

function pushCruce(list, left, right){
  const local = String(left || '').trim();
  const visitante = String(right || '').trim();
  if (!local || !visitante) return;
  list.push({ local, visitante });
}

function extractCruces(input){
  const result = [];
  const visited = new WeakSet();

  function walk(node){
    if (!node) return;
    if (typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (typeof node.local === 'string' && typeof node.visitante === 'string') {
      pushCruce(result, node.local, node.visitante);
    }
    if (typeof node.equipoLocal === 'string' && typeof node.equipoVisitante === 'string') {
      pushCruce(result, node.equipoLocal, node.equipoVisitante);
    }
    if (typeof node.home === 'string' && typeof node.away === 'string') {
      pushCruce(result, node.home, node.away);
    }
    if (typeof node.left === 'string' && typeof node.right === 'string') {
      pushCruce(result, node.left, node.right);
    }

    if (Array.isArray(node.equipos) && node.equipos.length >= 2) {
      const equipos = node.equipos.filter(Boolean);
      const byCategory = {
        local: equipos.find((item) => String(item?.categoria || '').toLowerCase() === 'local'),
        visitante: equipos.find((item) => String(item?.categoria || '').toLowerCase() === 'visitante')
      };
      if (byCategory.local?.equipo && byCategory.visitante?.equipo) {
        pushCruce(result, byCategory.local.equipo, byCategory.visitante.equipo);
      } else {
        for (let i = 0; i < equipos.length; i += 2) {
          const a = equipos[i];
          const b = equipos[i + 1];
          if (a?.equipo && b?.equipo) pushCruce(result, a.equipo, b.equipo);
        }
      }
    }

    Object.values(node).forEach(walk);
  }

  walk(input);

  const dedup = new Map();
  result.forEach((item) => {
    const key = compactKey(item.local) + '::' + compactKey(item.visitante);
    if (!dedup.has(key)) dedup.set(key, item);
  });
  return [...dedup.values()];
}

function buildPlanillaIndex(planillas, category){
  const index = new Map();
  planillas.forEach((item) => {
    teamKeyVariants(item.team).forEach((variant) => {
      if (!index.has(variant)) index.set(variant, item);
    });
  });
  return index;
}

function findPlanilla(index, teamName){
  const variants = teamKeyVariants(teamName);
  for (const variant of variants) {
    if (index.has(variant)) return index.get(variant);
  }
  return null;
}

function text(value){
  return String(value || '').trim();
}

function safeArr(value, expected){
  const arr = Array.isArray(value) ? value.map(text) : [];
  if (typeof expected === 'number') {
    while (arr.length < expected) arr.push('');
    return arr.slice(0, expected);
  }
  return arr;
}

function escapeHtml(value){
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createIndRows(local, visitante){
  const l = safeArr(local?.individuales, 7);
  const v = safeArr(visitante?.individuales, 7);
  return l.map((name, idx) => `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td class="center bold">${idx + 1}</td>
      <td class="center bold">VS.</td>
      <td class="center bold">${idx + 1}</td>
      <td>${escapeHtml(v[idx])}</td>
    </tr>
  `).join('');
}

function createPairRows(pairA, pairB){
  const a = safeArr(pairA, 2);
  const b = safeArr(pairB, 2);
  return `
    <tr>
      <td>${escapeHtml(a[0])}</td>
      <td class="center bold" rowspan="2">VS.</td>
      <td>${escapeHtml(b[0])}</td>
    </tr>
    <tr>
      <td>${escapeHtml(a[1])}</td>
      <td>${escapeHtml(b[1])}</td>
    </tr>
  `;
}

function createSubsRows(local, visitante){
  const l = safeArr(local?.suplentes, 2);
  const v = safeArr(visitante?.suplentes, 2);
  return `
    <tr><td>${escapeHtml(l[0])}</td><td>${escapeHtml(v[0])}</td></tr>
    <tr><td>${escapeHtml(l[1])}</td><td>${escapeHtml(v[1])}</td></tr>
  `;
}

function renderSheet(item){
  const localTeam = text(item.localTeamName);
  const visitanteTeam = text(item.visitanteTeamName);
  const localPlan = item.localPlan || {};
  const visitantePlan = item.visitantePlan || {};
  const localCap = safeArr(localPlan.capitan, 2);
  const visitCap = safeArr(visitantePlan.capitan, 2);

  const article = document.createElement('article');
  article.className = 'sheet-card';
  article.innerHTML = `
    <div class="sheet-head">
      <div>
        <h2 class="sheet-title">${escapeHtml(localTeam)} vs ${escapeHtml(visitanteTeam)}</h2>
        <div class="sheet-sub">${escapeHtml(categoryLabel(item.category))}</div>
      </div>
    </div>
    <div class="sheet-body">
      <div class="compact-sheet">
        <div class="league-title">Liga de Pool Independiente</div>
        <div class="bar"></div>

        <div class="header-grid">
          <table aria-label="Datos sala local">
            <tr><td class="bold center" style="width:74px;">SALA</td><td></td></tr>
            <tr><td class="bold center">CAPITANÍA</td><td>${escapeHtml(localCap.filter(Boolean).join(' / '))}</td></tr>
          </table>
          <div class="logo-box">
            <img src="../logo_liga.png" alt="Logo Liga" onerror="this.style.display='none'; this.parentNode.textContent='LIPA';" />
          </div>
          <table aria-label="Datos sala visitante">
            <tr><td></td><td class="bold center" style="width:74px;">SALA</td></tr>
            <tr><td>${escapeHtml(visitCap.filter(Boolean).join(' / '))}</td><td class="bold center">CAPITANÍA</td></tr>
          </table>
        </div>

        <table aria-label="Equipos enfrentados" style="margin-bottom:10px;">
          <tr>
            <th>${escapeHtml(localTeam)}</th>
            <th style="width:64px;">VS.</th>
            <th>${escapeHtml(visitanteTeam)}</th>
          </tr>
        </table>

        <table aria-label="Individuales">
          <thead>
            <tr>
              <th colspan="2">Nombre y apellido</th>
              <th style="width:52px;">Ind.</th>
              <th style="width:52px;">Ind.</th>
              <th>Nombre y apellido</th>
            </tr>
          </thead>
          <tbody>${createIndRows(localPlan, visitantePlan)}</tbody>
        </table>

        <div class="spacer"></div>
        <table aria-label="Pareja 1">
          <thead><tr><th>Pareja 1</th><th style="width:64px;">VS.</th><th>Pareja 1</th></tr></thead>
          <tbody>${createPairRows(localPlan.pareja1, visitantePlan.pareja1)}</tbody>
        </table>

        <div class="spacer"></div>
        <table aria-label="Pareja 2">
          <thead><tr><th>Pareja 2</th><th style="width:64px;">VS.</th><th>Pareja 2</th></tr></thead>
          <tbody>${createPairRows(localPlan.pareja2, visitantePlan.pareja2)}</tbody>
        </table>

        <div class="spacer"></div>
        <table aria-label="Suplentes">
          <thead><tr><th>Suplentes</th><th>Suplentes</th></tr></thead>
          <tbody>${createSubsRows(localPlan, visitantePlan)}</tbody>
        </table>

        <div class="sig-grid">
          <div class="sig"><div class="sig-line"></div><div class="sig-label">Firma local</div></div>
          <div class="sig"><div class="sig-line"></div><div class="sig-label">Firma visitante</div></div>
        </div>
      </div>
    </div>
  `;
  return article;
}

function renderEmpty(message){
  grid.innerHTML = `<div class="empty" style="grid-column:1 / -1;">${escapeHtml(message)}</div>`;
}

function buildCompleteSheets(cruces, planillas, category){
  const index = buildPlanillaIndex(planillas, category);
  const complete = [];
  cruces.forEach((cruce) => {
    const localItem = findPlanilla(index, cruce.local);
    const visitItem = findPlanilla(index, cruce.visitante);
    if (!localItem || !visitItem) return;
    complete.push({
      category,
      localTeamName: cruce.local,
      visitanteTeamName: cruce.visitante,
      localPlan: localItem.planilla || localItem.plan || {},
      visitantePlan: visitItem.planilla || visitItem.plan || {},
      localDbTeam: localItem.team,
      visitanteDbTeam: visitItem.team
    });
  });
  return complete;
}

function renderSheets(sheets){
  grid.innerHTML = '';
  if (!sheets.length) {
    renderEmpty('Todavía no hay cruces completos para mostrar en esta categoría.');
    return;
  }
  sheets.forEach((item) => grid.appendChild(renderSheet(item)));
}

async function reload(){
  const category = state.category;
  setStatus('warn', 'Buscando cruces y planillas...', 'Categoría: ' + categoryLabel(category));
  grid.innerHTML = '';

  try {
    await sleep(150);
    const enabled = await checkCrucesEnabled(category);
    if (!enabled) {
      state.completeSheets = [];
      renderEmpty('Los cruces de ' + categoryLabel(category) + ' no están habilitados en este momento.');
      setStatus('warn', 'Cruces no habilitados', 'No se encontró habilitación activa para hoy.');
      return;
    }

    await sleep(150);
    const crucesRaw = await loadCruces(category);

    await sleep(150);
    const planillas = await loadPlanillas();

    const cruces = extractCruces(crucesRaw);
    const completeSheets = buildCompleteSheets(cruces, planillas, category);

    state.allPlanillas = planillas;
    state.completeSheets = completeSheets;

    renderSheets(completeSheets);

    const totalCruces = cruces.length;
    const totalCompletos = completeSheets.length;
    setStatus(
      totalCompletos ? 'ok' : 'warn',
      totalCompletos
        ? ('Se encontraron ' + totalCompletos + ' planilla' + (totalCompletos === 1 ? '' : 's') + ' completa' + (totalCompletos === 1 ? '' : 's'))
        : 'No hay cruces completos todavía',
      'Cruces detectados: ' + totalCruces + ' · Completos: ' + totalCompletos
    );
  } catch (error) {
    console.error(error);
    renderEmpty(error?.message || 'No se pudieron cargar las planillas automáticas.');
    setStatus('error', 'Error al cargar', error?.message || 'Falló la consulta al backend.');
  }
}

function wireCategoryButtons(){
  document.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', async () => {
      const category = button.dataset.category;
      if (!category || state.category === category) return;
      state.category = category;
      document.querySelectorAll('[data-category]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.category === category);
      });
      await reload();
    });
  });
}

function wireToolbar(){
  $('#btnRefresh').addEventListener('click', reload);
  $('#btnPdf').addEventListener('click', () => window.print());
}

document.addEventListener('DOMContentLoaded', async () => {
  wireCategoryButtons();
  wireToolbar();
  await reload();
});
