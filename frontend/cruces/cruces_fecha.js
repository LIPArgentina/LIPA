const API_BASE = (window.APP_CONFIG?.API_BASE_URL || 'https://liga-backend-tt82.onrender.com').replace(/\/+$/, '') + '/api';

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

const $ = (sel) => document.querySelector(sel);
const appRoot = $('#app-root');
const errorBox = $('#appError');
const leftRoot = $('#planilla-root-left');
const rightRoot = $('#planilla-root-right');
const validateCta = $('#validateCta');
const btnVolver = $('#btnVolver');
const template = $('#card-template');

function getCategoryFromURL(){
  const qs = new URLSearchParams(location.search);
  const raw = String(qs.get('cat') || '').trim().toLowerCase();
  if (raw.includes('terc')) return 'tercera';
  if (raw.includes('seg')) return 'segunda';
  return raw;
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

function sameTeam(a, b){
  const setA = new Set(teamKeyVariants(a));
  return teamKeyVariants(b).some((v) => setA.has(v));
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

function localDateKey(date = new Date()){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(value){
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfToday(){
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getLoggedTeam(){
  const direct = sessionStorage.getItem('lpi_cruces_team') || localStorage.getItem('lpi_cruces_team') || localStorage.getItem('crucesTeam') || sessionStorage.getItem('crucesTeam');
  if (direct) return String(direct).trim();

  try {
    const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
    if (sess?.slug) return String(sess.slug).trim();
  } catch (_) {}

  try {
    const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
    if (sess2?.slug || sess2?.team) return String(sess2.slug || sess2.team).trim();
  } catch (_) {}

  return '';
}

function getStoredFixtureKinds(){
  const kinds = [];
  const preferred = localStorage.getItem('fixture_kind') || sessionStorage.getItem('fixture_kind') || '';
  if (preferred) kinds.push(preferred);
  ['ida', 'vuelta'].forEach((k) => { if (!kinds.includes(k)) kinds.push(k); });
  return kinds;
}

async function fetchJson(url, options){
  const response = await fetch(url, options);
  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const message = data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function checkCrucesEnabled(category){
  const team = CATEGORY_KEYS[category];
  if (!team) return false;
  const params = new URLSearchParams({ team, fechaKey: localDateKey() });
  const data = await fetchJson(`${API_BASE}/cruces/status?${params.toString()}`, { cache: 'no-store' });
  return !!data?.enabled;
}

async function loadPlanillas(){
  const data = await fetchJson(`${API_BASE}/admin/planillas`, { cache: 'no-store' });
  return Array.isArray(data) ? data : [];
}

async function loadFixture(category, kind){
  const params = new URLSearchParams({ kind, category });
  const data = await fetchJson(`${API_BASE}/fixture?${params.toString()}`, { cache: 'no-store' });
  if (!data?.ok || !data?.data) throw new Error(data?.error || 'Fixture inválido');
  return data.data;
}

function extractMatchesFromFecha(fecha){
  const result = [];
  if (!fecha || !Array.isArray(fecha.tablas)) return result;

  fecha.tablas.forEach((tabla) => {
    const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos.filter(Boolean) : [];
    if (equipos.length < 2) return;

    const local = equipos.find((item) => String(item?.categoria || '').toLowerCase() === 'local');
    const visitante = equipos.find((item) => String(item?.categoria || '').toLowerCase() === 'visitante');

    if (local?.equipo && visitante?.equipo) {
      result.push({ local: local.equipo, visitante: visitante.equipo, grupo: tabla?.grupo || '' });
      return;
    }

    for (let i = 0; i < equipos.length; i += 2) {
      const a = equipos[i];
      const b = equipos[i + 1];
      if (a?.equipo && b?.equipo) {
        result.push({ local: a.equipo, visitante: b.equipo, grupo: tabla?.grupo || '' });
      }
    }
  });

  return result;
}

function findUpcomingCruceForTeam(fixture, teamName){
  const today = startOfToday();
  const fechas = Array.isArray(fixture?.fechas) ? [...fixture.fechas] : [];

  fechas.sort((a, b) => {
    const da = parseDateKey(a?.date);
    const db = parseDateKey(b?.date);
    return (da?.getTime() || Number.MAX_SAFE_INTEGER) - (db?.getTime() || Number.MAX_SAFE_INTEGER);
  });

  for (const fecha of fechas) {
    const dt = parseDateKey(fecha?.date);
    if (!dt || dt < today) continue;

    const cruces = extractMatchesFromFecha(fecha);
    const found = cruces.find((item) => sameTeam(item.local, teamName) || sameTeam(item.visitante, teamName));
    if (found) {
      return {
        ...found,
        date: fecha.date || '',
        fecha
      };
    }
  }

  return null;
}

async function resolveCruce(teamName, category){
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

function buildPlanillaIndex(planillas){
  const index = new Map();
  planillas.forEach((item) => {
    teamKeyVariants(item?.team).forEach((variant) => {
      if (!index.has(variant)) index.set(variant, item);
    });
    teamKeyVariants(item?.planilla?.team).forEach((variant) => {
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

function sectionHtml(label, values){
  const arr = Array.isArray(values) ? values : [values];
  const textRows = arr.map((v) => text(v)).filter(Boolean);
  return `
    <section class="section-block">
      <h3>${escapeHtml(label)}</h3>
      <div class="section-lines">
        ${textRows.length ? textRows.map((v) => `<div class="line">${escapeHtml(v)}</div>`).join('') : '<div class="line empty">Sin cargar</div>'}
      </div>
    </section>
  `;
}

function buildSections(plan){
  return [
    sectionHtml('CAPITÁN', safeArr(plan?.capitan, 1)),
    sectionHtml('INDIVIDUALES', safeArr(plan?.individuales, 7)),
    sectionHtml('PAREJA 1', safeArr(plan?.pareja1, 2)),
    sectionHtml('PAREJA 2', safeArr(plan?.pareja2, 2)),
    sectionHtml('SUPLENTES', safeArr(plan?.suplentes, 2))
  ].join('');
}

function renderSide(root, sideLabel, teamName, item, matchDate){
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
  sections.innerHTML = buildSections(plan || {});
  if (totalInput) totalInput.value = '0';
  if (winsBox) winsBox.textContent = '0';

  if (!plan) card.classList.add('is-missing');
  root.appendChild(fragment);
}

function renderMessage(message){
  leftRoot.innerHTML = '';
  rightRoot.innerHTML = '';
  validateCta.style.display = 'none';
  appRoot.insertAdjacentHTML('beforeend', '');
  errorBox.style.display = 'block';
  errorBox.innerHTML = `<h2 style="color:#ffe65a; margin:0;">${escapeHtml(message)}</h2>`;
}

function clearMessage(){
  errorBox.style.display = 'none';
  errorBox.textContent = '';
}

function wireBack(){
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

async function init(){
  wireBack();
  clearMessage();
  leftRoot.innerHTML = '';
  rightRoot.innerHTML = '';
  validateCta.style.display = 'none';

  try {
    const category = getCategoryFromURL();
    if (!CATEGORY_KEYS[category]) {
      renderMessage('Cruces no disponibles');
      return;
    }

    const enabled = await checkCrucesEnabled(category);
    if (!enabled) {
      renderMessage('Cruces no habilitados');
      return;
    }

    const loggedTeam = getLoggedTeam();
    if (!loggedTeam) {
      renderMessage('No se pudo determinar el equipo logueado');
      return;
    }

    const cruce = await resolveCruce(loggedTeam, category);
    if (!cruce) {
      renderMessage('No se encontró un cruce próximo para este equipo');
      return;
    }

    const planillas = await loadPlanillas();
    const index = buildPlanillaIndex(planillas);
    const localItem = findPlanilla(index, cruce.local);
    const visitanteItem = findPlanilla(index, cruce.visitante);

    renderSide(leftRoot, 'LOCAL', cruce.local, localItem, cruce.date);
    renderSide(rightRoot, 'VISITANTE', cruce.visitante, visitanteItem, cruce.date);
  } catch (error) {
    console.error(error);
    renderMessage(error?.message || 'Error cargando cruces');
  }
}

document.addEventListener('DOMContentLoaded', init);
