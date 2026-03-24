const API_BASE = (window.APP_CONFIG?.API_BASE_URL || 'https://liga-backend-tt82.onrender.com').replace(/\/+$/, '') + '/api';

const CATEGORY_KEYS = {
  tercera: '__categoria_tercera__',
  segunda: '__categoria_segunda__'
};

const TEAM_ALIASES = {
  DOGOSBILLARDS: ['DOGOS BILLARDS', 'DOGOSBILLARDS'],
  PRBAR: ['PR BAR', 'PRBAR'],
  DUCKHUNTER: ['DUCK HUNTER', 'DUCKHUNTER'],
  CHUAVECHITO: ['CHUAVECHITO'],
  IMPERIOSUR: ['IMPERIO SUR', 'IMPERIOSUR'],
  BAIRES: ['BAIRES'],
  LOSPATOSDELTREBOL: ['LOS PATOS DEL TREBOL', 'LOSPATOSDELTREBOL'],
  ELTREBOLDEPACHECO: ['EL TREBOL DE PACHECO', 'ELTREBOLDEPACHECO'],
  ELTREBOLMORENO: ['EL TREBOL MORENO', 'ELTREBOLMORENO'],
  SEGUNDADELTREBOL: ['SEGUNDA DEL TREBOL', 'SEGUNDADELTREBOL'],
  ACADEMIADEPOOL: ['ACADEMIA DE POOL', 'ACADEMIA DE POOL ARGENTINA', 'ACADEMIADEPOOL', 'ACADEMIADEPOOLARGENTINA'],
  VICTORIA: ['VICTORIA'],
  TAKOSFUSION: ['TAKOS FUSION', 'TAKOSFUSION'],
  TAKOSPRO: ['TAKOS PRO', 'TAKOSPRO'],
  WHYNOT: ['WHY NOT', 'WHYNOT'],
  THECUES: ['THE CUES', 'THECUES'],
  OLDIES3RA: ['OLDIES 3RA', 'OLDIES3RA'],
  OLDIES: ['OLDIES'],
  ANEXO2DA: ['ANEXO 2DA', 'ANEXO2DA'],
  ANEXO: ['ANEXO']
};

const SCORE_SECTIONS = [
  { key: 'capitan', label: 'CAPITÁN', count: 1, editable: true },
  { key: 'individuales', label: 'INDIVIDUALES', count: 7, editable: true },
  { key: 'pareja1', label: 'PAREJA 1', count: 2, editable: true },
  { key: 'pareja2', label: 'PAREJA 2', count: 2, editable: true },
  { key: 'suplentes', label: 'SUPLENTES', count: 2, editable: false }
];

const $ = (sel) => document.querySelector(sel);
const errorBox = $('#appError');
const leftRoot = $('#planilla-root-left');
const rightRoot = $('#planilla-root-right');
const validateCta = $('#validateCta');
const btnValidarGlobal = $('#btnValidarGlobal');
const btnVolver = $('#btnVolver');
const template = $('#card-template');

let currentContext = null;

function getCategoryFromURL() {
  const qs = new URLSearchParams(location.search);
  const raw = String(qs.get('cat') || '').trim().toLowerCase();
  if (raw.includes('terc')) return 'tercera';
  if (raw.includes('seg')) return 'segunda';
  return raw;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' Y ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function compactKey(value) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function teamKeyVariants(value) {
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

  const slugCompact = compact.replace(/(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)$/g, '');
  if (slugCompact) variants.add(slugCompact);

  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    const aliasKeys = [canonical, ...aliases].map((v) => compactKey(v)).filter(Boolean);
    if (aliasKeys.includes(compact) || aliasKeys.includes(baseCompact) || aliasKeys.includes(slugCompact)) {
      aliasKeys.forEach((v) => variants.add(v));
    }
  }

  return [...variants].filter(Boolean);
}

function sameTeam(a, b) {
  const setA = new Set(teamKeyVariants(a));
  return teamKeyVariants(b).some((v) => setA.has(v));
}

function text(value) {
  return String(value || '').trim();
}

function safeArr(value, expected) {
  const arr = Array.isArray(value) ? value.map(text) : [];
  while (arr.length < expected) arr.push('');
  return arr.slice(0, expected);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getLoggedTeam() {
  const direct = sessionStorage.getItem('lpi_cruces_team') || localStorage.getItem('lpi_cruces_team') || localStorage.getItem('crucesTeam') || sessionStorage.getItem('crucesTeam');
  if (direct) return String(direct).trim();
  try {
    const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
    if (sess?.slug) return String(sess.slug).trim();
  } catch (_) {}
  return '';
}

function getStoredFixtureKinds() {
  const kinds = [];
  const preferred = localStorage.getItem('fixture_kind') || sessionStorage.getItem('fixture_kind') || '';
  if (preferred) kinds.push(preferred);
  ['ida', 'vuelta'].forEach((k) => { if (!kinds.includes(k)) kinds.push(k); });
  return kinds;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const message = data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function checkCrucesEnabled(category) {
  const team = CATEGORY_KEYS[category];
  if (!team) return false;
  const params = new URLSearchParams({ team, fechaKey: localDateKey() });
  const data = await fetchJson(`${API_BASE}/cruces/status?${params.toString()}`, { cache: 'no-store' });
  return !!data?.enabled;
}

async function loadPlanillas() {
  const data = await fetchJson(`${API_BASE}/admin/planillas`, { cache: 'no-store' });
  return Array.isArray(data) ? data : [];
}

async function loadFixture(category, kind) {
  const params = new URLSearchParams({ kind, category });
  const data = await fetchJson(`${API_BASE}/fixture?${params.toString()}`, { cache: 'no-store' });
  if (!data?.ok || !data?.data) throw new Error(data?.error || 'Fixture inválido');
  return data.data;
}

function extractMatchesFromFecha(fecha) {
  const result = [];
  if (!fecha || !Array.isArray(fecha.tablas)) return result;

  fecha.tablas.forEach((tabla) => {
    const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos.filter(Boolean) : [];
    if (equipos.length < 2) return;

    for (let i = 0; i < equipos.length; i += 2) {
      const local = equipos[i];
      const visitante = equipos[i + 1];
      if (local?.equipo && visitante?.equipo) {
        result.push({ local: local.equipo, visitante: visitante.equipo, grupo: tabla?.grupo || '' });
      }
    }
  });
  return result;
}

function findUpcomingCruceForTeam(fixture, teamName) {
  const today = startOfToday();
  const fechas = Array.isArray(fixture?.fechas) ? [...fixture.fechas] : [];
  fechas.sort((a, b) => (parseDateKey(a?.date)?.getTime() || Number.MAX_SAFE_INTEGER) - (parseDateKey(b?.date)?.getTime() || Number.MAX_SAFE_INTEGER));

  for (const fecha of fechas) {
    const dt = parseDateKey(fecha?.date);
    if (!dt || dt < today) continue;
    const cruces = extractMatchesFromFecha(fecha);
    const found = cruces.find((item) => sameTeam(item.local, teamName) || sameTeam(item.visitante, teamName));
    if (found) return { ...found, date: fecha.date || '', fecha };
  }
  return null;
}

async function resolveCruce(teamName, category) {
  let lastError = null;
  for (const kind of getStoredFixtureKinds()) {
    try {
      const fixture = await loadFixture(category, kind);
      const match = findUpcomingCruceForTeam(fixture, teamName);
      if (match) return { ...match, kind };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

function buildPlanillaIndex(planillas) {
  const index = new Map();
  planillas.forEach((item) => {
    teamKeyVariants(item?.team).forEach((variant) => { if (!index.has(variant)) index.set(variant, item); });
    teamKeyVariants(item?.planilla?.team).forEach((variant) => { if (!index.has(variant)) index.set(variant, item); });
  });
  return index;
}

function findPlanilla(index, teamName) {
  for (const variant of teamKeyVariants(teamName)) {
    if (index.has(variant)) return index.get(variant);
  }
  return null;
}

function getStorageKey() {
  if (!currentContext) return 'cruces_fecha_scores';
  const { category, date, local, visitante } = currentContext;
  return `cruces_fecha_scores:${category}:${date}:${compactKey(local)}:${compactKey(visitante)}`;
}

function loadStoredScores() {
  try {
    return JSON.parse(localStorage.getItem(getStorageKey()) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function saveStoredScores() {
  const data = {};
  document.querySelectorAll('.pts-select').forEach((select) => {
    data[select.dataset.scoreKey] = String(select.value || '0');
  });
  data.__validated = btnValidarGlobal?.dataset.state === 'success';
  localStorage.setItem(getStorageKey(), JSON.stringify(data));
}

function buildSelectOptions(selected) {
  let html = '';
  for (let i = 0; i <= 15; i += 1) {
    html += `<option value="${i}" ${String(selected) === String(i) ? 'selected' : ''}>${i}</option>`;
  }
  return html;
}

function rowHtml({ side, name, idx, editable, scoreKey, scoreValue }) {
  const slotClass = name ? 'slot' : 'slot is-empty';
  const shown = name || 'Sin cargar';
  const pts = editable
    ? `<div class="pts-edit"><select class="pts-select" data-score-key="${escapeHtml(scoreKey)}" aria-label="Puntos ${escapeHtml(name || `fila ${idx}`)}">${buildSelectOptions(scoreValue)}</select></div>`
    : '';
  return `<div class="row" data-side="${escapeHtml(side)}">${pts}<div class="badge">${idx}</div><div class="${slotClass}" data-full="${escapeHtml(shown)}">${escapeHtml(shown)}</div></div>`;
}

function sectionHtml(side, spec, plan, stored) {
  const values = safeArr(plan?.[spec.key], spec.count);
  const rows = values.map((name, index) => {
    const scoreKey = `${side}:${spec.key}:${index}`;
    const scoreValue = stored[scoreKey] ?? '0';
    return rowHtml({
      side,
      name,
      idx: index + 1,
      editable: spec.editable && !!name,
      scoreKey,
      scoreValue
    });
  }).join('');

  return `<section class="section"><h2>${escapeHtml(spec.label)}</h2>${rows}</section>`;
}

function renderSide(root, sideLabel, teamName, item, matchDate, side, stored) {
  root.innerHTML = '';
  const fragment = template.content.firstElementChild.cloneNode(true);
  const card = fragment.querySelector('.card');
  const title = fragment.querySelector('.title');
  const meta = fragment.querySelector('.meta');
  const hint = fragment.querySelector('.hint');
  const sections = fragment.querySelector('.sections');
  const totalInput = fragment.querySelector('.total-input');
  const winsBox = fragment.querySelector('[data-wins]');
  const plan = item?.planilla || item?.plan || null;

  title.textContent = String(teamName || '').toUpperCase();
  meta.textContent = `${sideLabel} · ${matchDate || 'Sin fecha'}`;
  hint.textContent = plan ? 'Planilla cargada desde DB.' : 'Planilla no encontrada para este equipo.';
  sections.innerHTML = SCORE_SECTIONS.map((spec) => sectionHtml(side, spec, plan || {}, stored)).join('');
  totalInput.value = '0';
  winsBox.textContent = '0';
  if (!plan) card.classList.add('is-missing');
  root.appendChild(fragment);
}

function renderMessage(message) {
  leftRoot.innerHTML = '';
  rightRoot.innerHTML = '';
  validateCta.style.display = 'none';
  errorBox.style.display = 'block';
  errorBox.innerHTML = `<h2 style="color:#ffe65a; margin:0;">${escapeHtml(message)}</h2>`;
}

function clearMessage() {
  errorBox.style.display = 'none';
  errorBox.textContent = '';
}

function ensureToast() {
  let toast = document.getElementById('toast-cruces');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-cruces';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  return toast;
}

function showToast(message, kind = 'info') {
  const toast = ensureToast();
  toast.textContent = message;
  toast.className = `toast toast-${kind} show`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function getSideTotal(side) {
  return [...document.querySelectorAll(`.pts-select[data-score-key^="${side}:"]`)].reduce((acc, select) => acc + Number(select.value || 0), 0);
}

function updateWins(localTotal, visitanteTotal) {
  let localWins = 0;
  let visitanteWins = 0;
  if (localTotal > visitanteTotal) {
    localWins = 2;
  } else if (visitanteTotal > localTotal) {
    visitanteWins = 2;
  } else if (localTotal !== 0 || visitanteTotal !== 0) {
    localWins = 1;
    visitanteWins = 1;
  }
  const leftWins = leftRoot.querySelector('[data-wins]');
  const rightWins = rightRoot.querySelector('[data-wins]');
  if (leftWins) leftWins.textContent = String(localWins);
  if (rightWins) rightWins.textContent = String(visitanteWins);
}

function updateScoresUI() {
  const localTotal = getSideTotal('local');
  const visitanteTotal = getSideTotal('visitante');
  const leftTotal = leftRoot.querySelector('.total-input');
  const rightTotal = rightRoot.querySelector('.total-input');
  if (leftTotal) leftTotal.value = String(localTotal);
  if (rightTotal) rightTotal.value = String(visitanteTotal);
  updateWins(localTotal, visitanteTotal);

  if (btnValidarGlobal?.dataset.state !== 'success') {
    btnValidarGlobal.classList.remove('error', 'success', 'rival-pending');
    btnValidarGlobal.classList.add('pending');
    btnValidarGlobal.textContent = 'VALIDAR PLANILLA';
    btnValidarGlobal.dataset.state = 'pending';
  }
  saveStoredScores();
}

function bindScoreEvents() {
  document.querySelectorAll('.pts-select').forEach((select) => {
    select.addEventListener('change', updateScoresUI);
  });
}

function applyStoredValidationState() {
  const stored = loadStoredScores();
  if (stored.__validated && btnValidarGlobal) {
    btnValidarGlobal.classList.remove('pending', 'error');
    btnValidarGlobal.classList.add('success');
    btnValidarGlobal.textContent = 'PLANILLA VALIDADA';
    btnValidarGlobal.dataset.state = 'success';
  }
}

function wireValidation() {
  if (!btnValidarGlobal) return;
  btnValidarGlobal.addEventListener('click', () => {
    const hasPlanillas = leftRoot.querySelector('.card') && rightRoot.querySelector('.card');
    if (!hasPlanillas) {
      showToast('No hay planillas cargadas para validar', 'error');
      return;
    }
    btnValidarGlobal.classList.remove('pending', 'error');
    btnValidarGlobal.classList.add('success');
    btnValidarGlobal.textContent = 'PLANILLA VALIDADA';
    btnValidarGlobal.dataset.state = 'success';
    saveStoredScores();
    showToast('Puntos guardados en esta sesión', 'success');
  });
}

function wireBack() {
  if (!btnVolver) return;
  btnVolver.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (document.referrer) {
      history.back();
    } else {
      const cat = getCategoryFromURL();
      location.href = `../templates/plantilla.html${cat ? `?cat=${encodeURIComponent(cat)}` : ''}`;
    }
  });
}

async function init() {
  wireBack();
  wireValidation();
  clearMessage();
  leftRoot.innerHTML = '';
  rightRoot.innerHTML = '';
  validateCta.style.display = 'none';

  try {
    const category = getCategoryFromURL();
    if (!CATEGORY_KEYS[category]) return renderMessage('Cruces no disponibles');

    const enabled = await checkCrucesEnabled(category);
    if (!enabled) return renderMessage('Cruces no habilitados');

    const loggedTeam = getLoggedTeam();
    if (!loggedTeam) return renderMessage('No se pudo determinar el equipo logueado');

    const cruce = await resolveCruce(loggedTeam, category);
    if (!cruce) return renderMessage('No se encontró un cruce próximo para este equipo');

    currentContext = { category, date: cruce.date, local: cruce.local, visitante: cruce.visitante };

    const planillas = await loadPlanillas();
    const index = buildPlanillaIndex(planillas);
    const localItem = findPlanilla(index, cruce.local);
    const visitanteItem = findPlanilla(index, cruce.visitante);
    const stored = loadStoredScores();

    renderSide(leftRoot, 'LOCAL', cruce.local, localItem, cruce.date, 'local', stored);
    renderSide(rightRoot, 'VISITANTE', cruce.visitante, visitanteItem, cruce.date, 'visitante', stored);
    validateCta.style.display = 'flex';
    bindScoreEvents();
    updateScoresUI();
    applyStoredValidationState();
  } catch (error) {
    console.error(error);
    renderMessage(error?.message || 'Error cargando cruces');
  }
}

document.addEventListener('DOMContentLoaded', init);
