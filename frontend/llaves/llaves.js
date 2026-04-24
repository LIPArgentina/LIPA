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

const STORAGE_PREFIX = 'llaves_local_';
const SAVE_KIND = 'llaves';

const CATEGORY_CONFIG = {
  tercera: {
    subtitle: 'TERCERA',
    layoutClass: 'bracket-tercera',
    teamSource: 'tercera',
    rounds: [
      { id: 'q1', slot: 'slot-q1', title: 'Cuartos de final', subtitle: 'Cuartos de final', legs: 2, helper: 'Serie ida y vuelta' },
      { id: 'q2', slot: 'slot-q2', title: 'Cuartos de final', subtitle: 'Cuartos de final', legs: 2, helper: 'Serie ida y vuelta' },
      { id: 's1', slot: 'slot-s1', title: 'Semifinal', subtitle: 'Semifinal', legs: 2, helper: 'Serie ida y vuelta' },
      { id: 'final', slot: 'slot-final', title: 'Final', subtitle: 'Final única', legs: 1, helper: 'Partido único' },
      { id: 'third', slot: 'slot-third', title: '3er y 4to puesto', subtitle: 'Partido por el podio', legs: 1, helper: 'Partido único' },
      { id: 's2', slot: 'slot-s2', title: 'Semifinal', subtitle: 'Semifinal', legs: 2, helper: 'Serie ida y vuelta' },
      { id: 'q3', slot: 'slot-q3', title: 'Cuartos de final', subtitle: 'Cuartos de final', legs: 2, helper: 'Serie ida y vuelta' },
      { id: 'q4', slot: 'slot-q4', title: 'Cuartos de final', subtitle: 'Cuartos de final', legs: 2, helper: 'Serie ida y vuelta' }
    ],
    slots: ['slot-q1','slot-q2','slot-s1','slot-final','slot-third','slot-s2','slot-q3','slot-q4']
  },
  segunda: {
    subtitle: 'SEGUNDA',
    layoutClass: 'bracket-segunda',
    teamSource: 'segunda',
    rounds: [
      { id: 's1', slot: 'slot-s1', title: 'Semifinal', subtitle: 'Semifinal', legs: 2, helper: 'Serie ida y vuelta' },
      { id: 'final', slot: 'slot-final', title: 'Final', subtitle: 'Final única', legs: 1, helper: 'Partido único' },
      { id: 'third', slot: 'slot-third', title: '3er y 4to puesto', subtitle: 'Partido por el podio', legs: 1, helper: 'Partido único' },
      { id: 's2', slot: 'slot-s2', title: 'Semifinal', subtitle: 'Semifinal', legs: 2, helper: 'Serie ida y vuelta' }
    ],
    slots: ['slot-s1','slot-final','slot-third','slot-s2']
  }
};

let currentCategory = 'tercera';
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

function getStorageKey(category){
  return `${STORAGE_PREFIX}${category}`;
}

function getCategoryConfig(category = currentCategory){
  return CATEGORY_CONFIG[category] || CATEGORY_CONFIG.tercera;
}

function getTeamOptions(){
  return unique(['WO', ...TEAM_OPTIONS.filter(Boolean).map(normalizeTeamName)]);
}

async function loadUsersJS(cat){
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

function getDefaultData(category = currentCategory){
  const cfg = getCategoryConfig(category);
  return {
    rounds: cfg.rounds.map(item => ({
      id: item.id,
      title: item.title,
      legs: Array.from({ length: item.legs }, () => getEmptyLeg())
    }))
  };
}

function mergeWithDefaults(raw, category = currentCategory){
  const base = getDefaultData(category);
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

async function loadFromServer(category = currentCategory){
  try {
    const resp = await fetch(`${API_BASE}/fixture?kind=${encodeURIComponent(SAVE_KIND)}&category=${encodeURIComponent(category)}`, {
      cache: 'no-store'
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data?.ok || !data?.data) throw new Error('Sin datos guardados');
    return mergeWithDefaults(data.data, category);
  } catch (_) {
    return null;
  }
}

function loadFromLocal(category = currentCategory){
  try {
    const raw = localStorage.getItem(getStorageKey(category));
    if (!raw) return null;
    return mergeWithDefaults(JSON.parse(raw), category);
  } catch (_) {
    return null;
  }
}

function saveLocal(data, category = currentCategory){
  try { localStorage.setItem(getStorageKey(category), JSON.stringify(data)); }
  catch (_) {}
}

function makeScoreOptions(max, selected){
  return Array.from({ length: max + 1 }, (_, n) => `<option value="${n}" ${Number(selected) === n ? 'selected' : ''}>${n}</option>`).join('');
}

function escapeHtml(value){
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function makeTeamOptions(selected){
  const safe = normalizeTeamName(selected) || 'WO';
  const options = unique([...getTeamOptions(), safe]);
  return options.map(name => `<option value="${escapeHtml(name)}" ${name === safe ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
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

function renderBracket(data){
  const cfg = getCategoryConfig();
  clearUnusedSlots(cfg);

  cfg.rounds.forEach(config => {
    const round = data.rounds.find(r => r.id === config.id) || { legs: [] };
    const slot = document.getElementById(config.slot);
    if (!slot) return;

    const legsMarkup = round.legs.map((leg, index) => createLegMarkup(config.id, index, leg, config.legs)).join('');

    slot.innerHTML = `
      <article class="tie-card" data-round-card="${config.id}">
        <div class="tie-header">
          <div>
            <div class="tie-subtitle">${escapeHtml(config.subtitle)}</div>
            <h2 class="tie-title">${escapeHtml(config.title)}</h2>
          </div>
        </div>
        <p class="tie-helper">${escapeHtml(config.helper)}</p>
        <div class="round-group">${legsMarkup}</div>
      </article>
    `;
  });
}

function clearUnusedSlots(cfg){
  const allSlots = unique(Object.values(CATEGORY_CONFIG).flatMap(item => item.slots));
  allSlots.forEach(slotId => {
    const slot = document.getElementById(slotId);
    if (slot && !cfg.slots.includes(slotId)) slot.innerHTML = '';
  });

  const root = document.getElementById('bracketRoot');
  root.classList.remove('bracket-tercera', 'bracket-segunda');
  root.classList.add(cfg.layoutClass);

  const qfLeft = document.querySelector('.qf-left');
  const qfRight = document.querySelector('.qf-right');

  if (cfg.layoutClass === 'bracket-segunda'){
    if (qfLeft) qfLeft.style.display = 'none';
    if (qfRight) qfRight.style.display = 'none';
  } else {
    if (qfLeft) qfLeft.style.display = '';
    if (qfRight) qfRight.style.display = '';
  }
}

function readBracketFromUI(){
  const cfg = getCategoryConfig();
  const rounds = cfg.rounds.map(config => {
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

function wireInputs(){
  document.querySelectorAll('#bracketRoot select, #bracketRoot input[type="date"]').forEach(el => {
    el.addEventListener('change', () => {
      saveLocal(readBracketFromUI(), currentCategory);
    });
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

function setActiveCategoryButton(category){
  document.querySelectorAll('.cat-btn[data-category]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });
  const subtitle = document.getElementById('categorySubtitle');
  if (subtitle) subtitle.textContent = getCategoryConfig(category).subtitle;
}

async function saveOnServer(){
  const data = readBracketFromUI();
  saveLocal(data, currentCategory);

  const resp = await fetch(`${API_BASE}/fixture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: SAVE_KIND,
      category: currentCategory,
      data
    })
  });

  const result = await resp.json().catch(() => null);
  if (!resp.ok || !result?.ok) {
    throw new Error(result?.error || 'Error al guardar llaves en DB');
  }

  showToast('Llaves guardadas correctamente');
}


const GROUPS_BY_CATEGORY = {
  tercera: ['A', 'B', 'C', 'D'],
  segunda: ['A', 'B']
};

function fixtureJsonFallbackPath(kind, category){
  return category === 'tercera'
    ? (kind === 'vuelta' ? '../fixture/fixture.vuelta.tercera.json' : '../fixture/fixture.ida.tercera.json')
    : null;
}

async function fetchFixtureData(kind, category){
  const url = `${API_BASE}/fixture?kind=${encodeURIComponent(kind)}&category=${encodeURIComponent(category)}`;
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    const data = await resp.json().catch(() => null);
    if (resp.ok && data?.ok && data?.data) return data.data;
  } catch (_) {}

  const fallback = fixtureJsonFallbackPath(kind, category);
  if (!fallback) return null;

  try {
    const resp = await fetch(fallback, { cache: 'no-store' });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) {
    return null;
  }
}

function collectStandingsEntriesFromFixtures(feeds){
  const entries = [];
  (feeds || []).forEach(feed => {
    if (!feed) return;
    const kind = String(feed.kind || '').toLowerCase();
    (feed?.fechas || []).forEach((fecha, idx) => {
      entries.push({ kind, fechaIndex: idx + 1, fecha });
    });
  });
  return entries;
}

function calcStandingsFromFixtures(category, ida, vuelta){
  const groups = GROUPS_BY_CATEGORY[category] || [];
  const entries = collectStandingsEntriesFromFixtures([
    ida ? { ...ida, kind: 'ida' } : null,
    vuelta ? { ...vuelta, kind: 'vuelta' } : null
  ]);

  const puntos = Object.fromEntries(groups.map(g => [g, Object.create(null)]));
  const triangulos = Object.fromEntries(groups.map(g => [g, Object.create(null)]));
  const jugados = Object.fromEntries(groups.map(g => [g, Object.create(null)]));
  const seen = Object.fromEntries(groups.map(g => [g, new Map()]));

  entries.forEach(entry => {
    (entry?.fecha?.tablas || []).forEach(tabla => {
      const g = String(tabla?.grupo || '').trim().toUpperCase();
      if (!groups.includes(g)) return;

      const equipos = (tabla?.equipos || []).map(e => ({
        equipo: e?.equipo || '',
        puntos: parseInt(e?.puntos ?? 0, 10) || 0,
        puntosExtra: parseInt(e?.puntosExtra ?? 0, 10) || 0
      }));

      equipos.forEach(item => {
        const key = normalizeTeamName(item.equipo);
        if (!key || key === 'WO') return;

        if (!puntos[g][key]) puntos[g][key] = { equipo: key, pts: 0 };
        puntos[g][key].pts += item.puntos;
        triangulos[g][key] = (triangulos[g][key] || 0) + item.puntosExtra;
        if (!seen[g].has(key)) seen[g].set(key, item.equipo);
      });

      for (let i = 0; i < equipos.length; i += 2){
        const A = equipos[i];
        const B = equipos[i + 1];
        if (!A || !B) continue;

        const aK = normalizeTeamName(A.equipo);
        const bK = normalizeTeamName(B.equipo);
        if (!aK || !bK || aK === 'WO' || bK === 'WO') continue;
        if (A.puntos === 0 && B.puntos === 0 && A.puntosExtra === 0 && B.puntosExtra === 0) continue;

        jugados[g][aK] = (jugados[g][aK] || 0) + 1;
        jugados[g][bK] = (jugados[g][bK] || 0) + 1;
      }
    });
  });

  const result = {};
  groups.forEach(g => {
    result[g] = Object.values(puntos[g])
      .sort((a, b) =>
        (b.pts - a.pts) ||
        ((triangulos[g][normalizeTeamName(b.equipo)] || 0) - (triangulos[g][normalizeTeamName(a.equipo)] || 0)) ||
        String(a.equipo).localeCompare(String(b.equipo), 'es', { sensitivity: 'base' })
      )
      .map((row, index) => ({
        pos: index + 1,
        equipo: row.equipo,
        pts: row.pts,
        tr: triangulos[g][normalizeTeamName(row.equipo)] || 0,
        ju: jugados[g][normalizeTeamName(row.equipo)] || 0
      }));
  });

  return result;
}

async function loadFinalStandings(category){
  const [ida, vuelta] = await Promise.all([
    fetchFixtureData('ida', category),
    fetchFixtureData('vuelta', category)
  ]);
  return calcStandingsFromFixtures(category, ida, vuelta);
}

function standingTeam(standings, group, pos){
  return standings?.[group]?.find(row => Number(row.pos) === Number(pos))?.equipo || '';
}

function isAutoFillableTeam(name){
  const value = normalizeTeamName(name);
  return !value || value === 'WO';
}

function setLegTeamIfEmpty(leg, side, team){
  if (!leg || !team) return;
  if (isAutoFillableTeam(leg?.[side]?.team)) {
    leg[side].team = normalizeTeamName(team);
  }
}

function fillTwoLegTie(round, groupWinnerTeam, groupSecondTeam){
  if (!round || !Array.isArray(round.legs) || round.legs.length < 2) return;

  // Regla LIPA:
  // El equipo que salió 1ro juega la ida de visitante/derecha
  // y la vuelta de local/izquierda.
  setLegTeamIfEmpty(round.legs[0], 'home', groupSecondTeam);
  setLegTeamIfEmpty(round.legs[0], 'away', groupWinnerTeam);
  setLegTeamIfEmpty(round.legs[1], 'home', groupWinnerTeam);
  setLegTeamIfEmpty(round.legs[1], 'away', groupSecondTeam);
}

async function applyAutomaticEntrants(data, category){
  const standings = await loadFinalStandings(category);
  const findRound = id => data.rounds.find(round => round.id === id);

  if (category === 'tercera') {
    fillTwoLegTie(findRound('q1'), standingTeam(standings, 'A', 1), standingTeam(standings, 'B', 2));
    fillTwoLegTie(findRound('q2'), standingTeam(standings, 'C', 1), standingTeam(standings, 'D', 2));
    fillTwoLegTie(findRound('q3'), standingTeam(standings, 'B', 1), standingTeam(standings, 'A', 2));
    fillTwoLegTie(findRound('q4'), standingTeam(standings, 'D', 1), standingTeam(standings, 'C', 2));
  } else if (category === 'segunda') {
    fillTwoLegTie(findRound('s1'), standingTeam(standings, 'A', 1), standingTeam(standings, 'B', 2));
    fillTwoLegTie(findRound('s2'), standingTeam(standings, 'B', 1), standingTeam(standings, 'A', 2));
  }

  return data;
}


async function renderCategory(category){
  currentCategory = category;
  setActiveCategoryButton(category);
  TEAM_OPTIONS = await loadUsersJS(getCategoryConfig(category).teamSource);
  const serverData = await loadFromServer(category);
  const localData = loadFromLocal(category);
  const data = serverData || localData || getDefaultData(category);
  await applyAutomaticEntrants(data, category);
  saveLocal(data, category);
  renderBracket(data);
  wireInputs();
}

async function bootstrap(){
  await renderCategory(currentCategory);

  document.querySelectorAll('.cat-btn[data-category]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nextCategory = btn.dataset.category || 'tercera';
      try {
        await renderCategory(nextCategory);
      } catch (err) {
        console.error(err);
        alert(err?.message || 'No se pudieron cargar las llaves');
      }
    });
  });

  document.getElementById('saveBracket')?.addEventListener('click', async () => {
    try {
      await saveOnServer();
    } catch (err) {
      console.error(err);
      alert(err?.message || 'No se pudo guardar');
    }
  });

  document.getElementById('resetBracket')?.addEventListener('click', () => {
    const clean = getDefaultData(currentCategory);
    saveLocal(clean, currentCategory);
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
