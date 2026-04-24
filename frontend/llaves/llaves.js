const API_BASE = (() => {
  const configured = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  if (configured) return configured + '/api';

  const host = String(window.location.hostname || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  const isStaging = host.includes('staging');

  return (isLocal
    ? 'http://localhost:3000/api'
    : (isStaging
        ? 'https://liga-backend-staging.onrender.com/api'
        : 'https://liga-backend-tt82.onrender.com/api'));
})();

const STORAGE_KEY = 'llaves_tercera_local';
const SAVE_KIND = 'llaves';
const SAVE_CATEGORY = 'tercera';

const BRACKET_CONFIG = [
  {
    id: 'q1',
    slot: 'slot-q1',
    title: 'Cuartos de final',
    subtitle: 'Cuartos de final',
    legs: 2,
    helper: 'Serie ida y vuelta'
  },
  {
    id: 'q2',
    slot: 'slot-q2',
    title: 'Cuartos de final',
    subtitle: 'Cuartos de final',
    legs: 2,
    helper: 'Serie ida y vuelta'
  },
  {
    id: 's1',
    slot: 'slot-s1',
    title: 'Semifinal',
    subtitle: 'Semifinal',
    legs: 2,
    helper: 'Serie ida y vuelta · sugerido: ganadores de Q1 y Q2'
  },
  {
    id: 'final',
    slot: 'slot-final',
    title: 'Final',
    subtitle: 'Final única',
    legs: 1,
    helper: 'Partido único'
  },
  {
    id: 'third',
    slot: 'slot-third',
    title: '3er y 4to puesto',
    subtitle: 'Partido por el podio',
    legs: 1,
    helper: 'Partido único entre les no ganadores de las semifinales'
  },
  {
    id: 's2',
    slot: 'slot-s2',
    title: 'Semifinal',
    subtitle: 'Semifinal',
    legs: 2,
    helper: 'Serie ida y vuelta · sugerido: ganadores de Q3 y Q4'
  },
  {
    id: 'q3',
    slot: 'slot-q3',
    title: 'Cuartos de final',
    subtitle: 'Cuartos de final',
    legs: 2,
    helper: 'Serie ida y vuelta'
  },
  {
    id: 'q4',
    slot: 'slot-q4',
    title: 'Cuartos de final',
    subtitle: 'Cuartos de final',
    legs: 2,
    helper: 'Serie ida y vuelta'
  }
];

const PLACEHOLDER_TEAMS = [
  'WO',
  'GANADOR Q1', 'GANADOR Q2', 'GANADOR Q3', 'GANADOR Q4',
  'GANADOR S1', 'GANADOR S2',
  'PERDEDOR S1', 'PERDEDOR S2'
];

let TEAM_OPTIONS = ['WO'];

function normalizeTeamName(name){
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const upper = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const aliases = {
    'ANEXO 2DA': 'ANEXO 2DA',
    'ANEXO 2DA.': 'ANEXO 2DA',
    'ANEXO 2da': 'ANEXO 2DA'
  };
  return aliases[raw] || aliases[upper] || raw;
}

function unique(list){
  return Array.from(new Set(list.filter(Boolean)));
}

function getTeamOptions(){
  return unique(['WO', ...TEAM_OPTIONS.filter(t => t !== 'WO'), ...PLACEHOLDER_TEAMS.filter(t => t !== 'WO')]);
}

async function loadUsersJS(cat = 'tercera'){
  return new Promise((resolve, reject) => {
    const ID = 'users-script';
    const old = document.getElementById(ID);
    if (old) old.remove();

    try { delete window.LPI_USERS; } catch(_) { window.LPI_USERS = undefined; }

    const s = document.createElement('script');
    s.id = ID;
    s.src = `../data/usuarios.${cat}.js`;
    s.onload = () => {
      const arr = (window.LPI_USERS || [])
        .filter(u => u.role === 'team')
        .map(u => normalizeTeamName(u.username));
      const uniq = unique(arr.filter(Boolean));
      const resto = uniq.filter(n => n !== 'WO')
        .sort((a,b) => a.localeCompare(b, 'es', { sensitivity:'base' }));
      resolve(['WO', ...resto]);
    };
    s.onerror = () => reject(new Error(`No se pudo cargar usuarios.${cat}.js`));
    document.head.appendChild(s);
  });
}

function getEmptyLeg(){
  return {
    date: '',
    home: { team: 'WO', puntos: 0, puntosExtra: 0 },
    away: { team: 'WO', puntos: 0, puntosExtra: 0 }
  };
}

function getDefaultData(){
  return {
    rounds: BRACKET_CONFIG.map(item => ({
      id: item.id,
      title: item.title,
      legs: Array.from({ length: item.legs }, () => getEmptyLeg())
    }))
  };
}

function mergeWithDefaults(raw){
  const base = getDefaultData();
  if (!raw || !Array.isArray(raw.rounds)) return base;

  base.rounds.forEach(round => {
    const found = raw.rounds.find(r => r?.id === round.id);
    if (!found || !Array.isArray(found.legs)) return;

    round.legs = round.legs.map((leg, index) => {
      const src = found.legs[index] || {};
      return {
        date: typeof src.date === 'string' ? src.date : '',
        home: {
          team: normalizeTeamName(src?.home?.team) || 'WO',
          puntos: Number(src?.home?.puntos || 0),
          puntosExtra: Number(src?.home?.puntosExtra || 0)
        },
        away: {
          team: normalizeTeamName(src?.away?.team) || 'WO',
          puntos: Number(src?.away?.puntos || 0),
          puntosExtra: Number(src?.away?.puntosExtra || 0)
        }
      };
    });
  });

  return base;
}

async function loadFromServer(){
  try {
    const resp = await fetch(`${API_BASE}/fixture?kind=${encodeURIComponent(SAVE_KIND)}&category=${encodeURIComponent(SAVE_CATEGORY)}`, {
      cache: 'no-store'
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data?.ok || !data?.data) throw new Error('Sin datos guardados');
    return mergeWithDefaults(data.data);
  } catch (_) {
    return null;
  }
}

function loadFromLocal(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return mergeWithDefaults(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

function saveLocal(data){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch (_) {}
}

function makeScoreOptions(max, selected){
  return Array.from({ length: max + 1 }, (_, n) => `<option value="${n}" ${Number(selected) === n ? 'selected' : ''}>${n}</option>`).join('');
}

function makeTeamOptions(selected){
  const safe = normalizeTeamName(selected) || 'WO';
  const options = unique([...getTeamOptions(), safe]);
  return options.map(name => `<option value="${escapeHtml(name)}" ${name === safe ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
}

function escapeHtml(value){
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createLegMarkup(roundId, legIndex, legData, totalLegs){
  const label = totalLegs === 1 ? 'Partido' : (legIndex === 0 ? 'Ida' : 'Vuelta');
  return `
    <div class="match-block" data-round="${roundId}" data-leg="${legIndex}">
      <div class="match-top">
        <div class="match-label">${label}</div>
        <input type="date" class="fecha-input" data-field="date" value="${escapeHtml(legData.date || '')}" />
      </div>
      <div class="team-row">
        <select class="score-badge" data-side="home" data-field="puntos">${makeScoreOptions(9, legData.home.puntos)}</select>
        <select class="score-badge score-badge-white" data-side="home" data-field="puntosExtra">${makeScoreOptions(54, legData.home.puntosExtra)}</select>
        <select class="select-team" data-side="home" data-field="team">${makeTeamOptions(legData.home.team)}</select>
        <select class="select-team" data-side="away" data-field="team">${makeTeamOptions(legData.away.team)}</select>
        <select class="score-badge score-badge-white" data-side="away" data-field="puntosExtra">${makeScoreOptions(54, legData.away.puntosExtra)}</select>
        <select class="score-badge" data-side="away" data-field="puntos">${makeScoreOptions(9, legData.away.puntos)}</select>
      </div>
    </div>
  `;
}

function aggregateRound(round){
  const totals = { home: 0, away: 0, homeExtra: 0, awayExtra: 0 };
  (round.legs || []).forEach(leg => {
    totals.home += Number(leg?.home?.puntos || 0);
    totals.away += Number(leg?.away?.puntos || 0);
    totals.homeExtra += Number(leg?.home?.puntosExtra || 0);
    totals.awayExtra += Number(leg?.away?.puntosExtra || 0);
  });
  return totals;
}

function getLeaderLabel(round){
  const { home, away, homeExtra, awayExtra } = aggregateRound(round);
  if (home > away) return 'Local arriba';
  if (away > home) return 'Visitante arriba';
  if (homeExtra > awayExtra) return 'Desempata local';
  if (awayExtra > homeExtra) return 'Desempata visitante';
  return 'Serie igualada';
}

function renderBracket(data){
  BRACKET_CONFIG.forEach(config => {
    const round = data.rounds.find(r => r.id === config.id) || { legs: [] };
    const slot = document.getElementById(config.slot);
    if (!slot) return;

    const legsMarkup = round.legs.map((leg, index) => createLegMarkup(config.id, index, leg, config.legs)).join('');
    const totals = aggregateRound(round);

    slot.innerHTML = `
      <article class="tie-card card ${config.legs === 1 ? 'single-match' : ''}" data-round-card="${config.id}">
        <div class="tie-header">
          <div>
            <div class="tie-subtitle">${escapeHtml(config.subtitle)}</div>
            <h2 class="tie-title">${escapeHtml(config.title)}</h2>
          </div>
        </div>
        <p class="tie-helper">${escapeHtml(config.helper)}</p>
        <div class="round-group">${legsMarkup}</div>
        <div class="agg-row">
          <div class="agg-chip">Serie <strong>${totals.home} - ${totals.away}</strong></div>
          <div class="agg-chip">Extra <strong>${totals.homeExtra} - ${totals.awayExtra}</strong></div>
          <div class="agg-chip">${escapeHtml(getLeaderLabel(round))}</div>
        </div>
      </article>
    `;
  });
}

function readBracketFromUI(){
  const rounds = BRACKET_CONFIG.map(config => {
    const card = document.querySelector(`[data-round-card="${config.id}"]`);
    const legEls = Array.from(card?.querySelectorAll('.match-block') || []);

    return {
      id: config.id,
      title: config.title,
      legs: legEls.map(legEl => ({
        date: legEl.querySelector('[data-field="date"]')?.value || '',
        home: {
          team: normalizeTeamName(legEl.querySelector('[data-side="home"][data-field="team"]')?.value || 'WO') || 'WO',
          puntos: Number(legEl.querySelector('[data-side="home"][data-field="puntos"]')?.value || 0),
          puntosExtra: Number(legEl.querySelector('[data-side="home"][data-field="puntosExtra"]')?.value || 0)
        },
        away: {
          team: normalizeTeamName(legEl.querySelector('[data-side="away"][data-field="team"]')?.value || 'WO') || 'WO',
          puntos: Number(legEl.querySelector('[data-side="away"][data-field="puntos"]')?.value || 0),
          puntosExtra: Number(legEl.querySelector('[data-side="away"][data-field="puntosExtra"]')?.value || 0)
        }
      }))
    };
  });

  return { rounds };
}

function refreshTotals(){
  const data = readBracketFromUI();
  saveLocal(data);
  renderBracket(data);
  wireInputs();
}

function wireInputs(){
  document.querySelectorAll('#bracketRoot select, #bracketRoot input[type="date"]').forEach(el => {
    el.addEventListener('change', refreshTotals);
  });
}

function showToast(message, ms = 2500){
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), ms);
}

async function saveOnServer(){
  const data = readBracketFromUI();
  saveLocal(data);

  const resp = await fetch(`${API_BASE}/fixture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: SAVE_KIND,
      category: SAVE_CATEGORY,
      data
    })
  });

  const result = await resp.json().catch(() => null);
  if (!resp.ok || !result?.ok) {
    throw new Error(result?.error || 'Error al guardar llaves en DB');
  }

  showToast('Llaves guardadas correctamente');
}

async function bootstrap(){
  TEAM_OPTIONS = await loadUsersJS('tercera');
  const serverData = await loadFromServer();
  const localData = loadFromLocal();
  const data = serverData || localData || getDefaultData();
  renderBracket(data);
  wireInputs();

  document.getElementById('saveBracket')?.addEventListener('click', async () => {
    try {
      await saveOnServer();
    } catch (err) {
      console.error(err);
      alert(err?.message || 'No se pudo guardar');
    }
  });

  document.getElementById('resetBracket')?.addEventListener('click', () => {
    const clean = getDefaultData();
    saveLocal(clean);
    renderBracket(clean);
    wireInputs();
    showToast('Llaves reiniciadas');
  });
}

window.addEventListener('load', () => {
  bootstrap().catch(err => {
    console.error(err);
    alert(err?.message || 'No se pudieron cargar las llaves');
  });
});
