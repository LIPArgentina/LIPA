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
    const resp = await fetch(`${API_BASE}/llaves?category=${encodeURIComponent(category)}`, {
      cache: 'no-store',
      credentials: 'include'
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

function getGroupsForCategory(category){
  return category === 'segunda' ? ['A','B'] : ['A','B','C','D'];
}

function normalizeForCompare(name){
  return normalizeTeamName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function parseScore(value){
  const n = parseInt(value ?? 0, 10);
  return Number.isFinite(n) ? n : 0;
}

async function fetchFixtureData(kind, category){
  const resp = await fetch(`${API_BASE}/fixture?kind=${encodeURIComponent(kind)}&category=${encodeURIComponent(category)}`, {
    cache: 'no-store'
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.ok || !data?.data) {
    throw new Error(data?.error || `No se pudo cargar fixture ${kind} de ${category}`);
  }
  return data.data;
}

function collectFixtureEntries(ida, vuelta){
  const entries = [];
  [
    { kind:'ida', data: ida },
    { kind:'vuelta', data: vuelta }
  ].forEach(feed => {
    (feed.data?.fechas || []).forEach((fecha, idx) => {
      entries.push({ kind: feed.kind, fechaIndex: idx + 1, fecha });
    });
  });
  return entries;
}

function iterateGroupMatches(entries, callback){
  (entries || []).forEach(entry => {
    (entry.fecha?.tablas || []).forEach(tabla => {
      const group = String(tabla?.grupo || '').toUpperCase();
      const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];

      for (let i = 0; i < equipos.length; i += 2) {
        const home = equipos[i];
        const away = equipos[i + 1];
        if (!home || !away) continue;

        const homeName = normalizeTeamName(home.equipo);
        const awayName = normalizeTeamName(away.equipo);
        if (!homeName || !awayName) continue;
        if (normalizeForCompare(homeName) === 'WO' || normalizeForCompare(awayName) === 'WO') continue;

        callback({
          group,
          home: {
            team: homeName,
            key: normalizeForCompare(homeName),
            puntos: parseScore(home.puntos),
            puntosExtra: parseScore(home.puntosExtra)
          },
          away: {
            team: awayName,
            key: normalizeForCompare(awayName),
            puntos: parseScore(away.puntos),
            puntosExtra: parseScore(away.puntosExtra)
          }
        });
      }
    });
  });
}

function computeHeadToHead(group, tiedKeys, entries){
  const tied = new Set(tiedKeys);
  const table = Object.create(null);

  tiedKeys.forEach(key => {
    table[key] = { pts: 0, tr: 0 };
  });

  iterateGroupMatches(entries, match => {
    if (match.group !== group) return;
    if (!tied.has(match.home.key) || !tied.has(match.away.key)) return;

    table[match.home.key].pts += match.home.puntos;
    table[match.home.key].tr += match.home.puntosExtra;
    table[match.away.key].pts += match.away.puntos;
    table[match.away.key].tr += match.away.puntosExtra;
  });

  return table;
}

function computeStandings(category, ida, vuelta){
  const groups = getGroupsForCategory(category);
  const entries = collectFixtureEntries(ida, vuelta);

  const stats = Object.fromEntries(groups.map(g => [g, Object.create(null)]));

  iterateGroupMatches(entries, match => {
    if (!groups.includes(match.group)) return;

    [match.home, match.away].forEach(team => {
      if (!stats[match.group][team.key]) {
        stats[match.group][team.key] = {
          key: team.key,
          equipo: team.team,
          pts: 0,
          tr: 0,
          ju: 0
        };
      }
    });

    // Si todo está en cero, lo consideramos no jugado para JU,
    // pero no afecta puntos/triángulos.
    const played = (
      match.home.puntos > 0 ||
      match.away.puntos > 0 ||
      match.home.puntosExtra > 0 ||
      match.away.puntosExtra > 0
    );

    stats[match.group][match.home.key].pts += match.home.puntos;
    stats[match.group][match.home.key].tr += match.home.puntosExtra;
    stats[match.group][match.away.key].pts += match.away.puntos;
    stats[match.group][match.away.key].tr += match.away.puntosExtra;

    if (played) {
      stats[match.group][match.home.key].ju += 1;
      stats[match.group][match.away.key].ju += 1;
    }
  });

  const result = {};

  groups.forEach(group => {
    const rows = Object.values(stats[group]);
    const buckets = new Map();

    rows.forEach(row => {
      const bucketKey = `${row.pts}|${row.tr}`;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey).push(row);
    });

    const bucketKeys = Array.from(buckets.keys()).sort((a,b) => {
      const [ap, at] = a.split('|').map(Number);
      const [bp, bt] = b.split('|').map(Number);
      return (bp - ap) || (bt - at);
    });

    const ordered = [];

    bucketKeys.forEach(bucketKey => {
      const bucket = buckets.get(bucketKey);
      if (bucket.length <= 1) {
        ordered.push(...bucket);
        return;
      }

      const tiedKeys = bucket.map(row => row.key);
      const h2h = computeHeadToHead(group, tiedKeys, entries);

      bucket.sort((a,b) => {
        const hA = h2h[a.key] || { pts: 0, tr: 0 };
        const hB = h2h[b.key] || { pts: 0, tr: 0 };
        return (hB.pts - hA.pts) ||
               (hB.tr - hA.tr) ||
               String(a.equipo).localeCompare(String(b.equipo), 'es', { sensitivity:'base' });
      });

      ordered.push(...bucket);
    });

    result[group] = ordered.map((row, idx) => ({
      ...row,
      pos: idx + 1
    }));
  });

  return result;
}

function getRound(data, id){
  return data.rounds.find(round => round.id === id);
}

function setTwoLegTie(data, roundId, firstPlaceTeam, secondPlaceTeam){
  const round = getRound(data, roundId);
  if (!round || round.legs.length < 2) return;

  const first = normalizeTeamName(firstPlaceTeam) || 'WO';
  const second = normalizeTeamName(secondPlaceTeam) || 'WO';

  // Regla LIPA: el 1ro de grupo arranca visitante/derecha y define local/izquierda.
  round.legs[0].home.team = second;
  round.legs[0].away.team = first;
  round.legs[1].home.team = first;
  round.legs[1].away.team = second;
}

async function applyAutomaticEntrants(data, category){
  const [ida, vuelta] = await Promise.all([
    fetchFixtureData('ida', category),
    fetchFixtureData('vuelta', category)
  ]);

  const standings = computeStandings(category, ida, vuelta);
  const team = (group, pos) => standings[group]?.find(row => row.pos === pos)?.equipo || 'WO';

  if (category === 'tercera') {
    setTwoLegTie(data, 'q1', team('A', 1), team('B', 2));
    setTwoLegTie(data, 'q2', team('C', 1), team('D', 2));
    setTwoLegTie(data, 'q3', team('B', 1), team('A', 2));
    setTwoLegTie(data, 'q4', team('D', 1), team('C', 2));
  } else {
    setTwoLegTie(data, 's1', team('A', 1), team('B', 2));
    setTwoLegTie(data, 's2', team('B', 1), team('A', 2));
  }

  return standings;
}

function getAutoEntrantRoundIds(category){
  return category === 'tercera'
    ? new Set(['q1','q2','q3','q4'])
    : new Set(['s1','s2']);
}

function mergeSavedDbData(baseData, savedData, category){
  if (!savedData || !Array.isArray(savedData.rounds)) return baseData;

  const autoRounds = getAutoEntrantRoundIds(category);

  baseData.rounds.forEach(round => {
    const savedRound = savedData.rounds.find(r => r?.id === round.id);
    if (!savedRound || !Array.isArray(savedRound.legs)) return;

    round.legs.forEach((leg, index) => {
      const savedLeg = savedRound.legs[index];
      if (!savedLeg) return;

      // Siempre preservamos fecha y resultados guardados.
      leg.date = typeof savedLeg.date === 'string' ? savedLeg.date : leg.date;
      leg.home.puntos = Number(savedLeg?.home?.puntos || 0);
      leg.home.puntosExtra = Number(savedLeg?.home?.puntosExtra || 0);
      leg.away.puntos = Number(savedLeg?.away?.puntos || 0);
      leg.away.puntosExtra = Number(savedLeg?.away?.puntosExtra || 0);

      // En Q iniciales de tercera y semis iniciales de segunda,
      // los equipos siempre vienen de la tabla/fixture actual.
      // En el resto, se respetan equipos guardados hasta automatizar avances.
      if (!autoRounds.has(round.id)) {
        leg.home.team = normalizeTeamName(savedLeg?.home?.team) || leg.home.team;
        leg.away.team = normalizeTeamName(savedLeg?.away?.team) || leg.away.team;
      }
    });
  });

  return baseData;
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
      const data = readBracketFromUI();
      applyAutomaticAdvance(data);
      saveLocal(data, currentCategory);
      renderBracket(data);
      wireInputs();
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
  applyAutomaticAdvance(data);
  saveLocal(data, currentCategory);

  const resp = await fetch(`${API_BASE}/llaves`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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


function llGetRound(data, id){
  return (data?.rounds || []).find(r => r.id === id);
}

function llCloneTeam(team){
  return {
    team: normalizeTeamName(team?.team) || 'WO',
    puntos: Number(team?.puntos || 0),
    puntosExtra: Number(team?.puntosExtra || 0)
  };
}

function llSetLegTeams(round, legIndex, homeTeam, awayTeam){
  if (!round || !round.legs || !round.legs[legIndex]) return;
  round.legs[legIndex].home.team = normalizeTeamName(homeTeam) || 'WO';
  round.legs[legIndex].away.team = normalizeTeamName(awayTeam) || 'WO';
}

function llIsRealTeam(name){
  const n = normalizeTeamName(name);
  return !!n && n !== 'WO';
}

function llLegPlayed(leg){
  if (!leg) return false;
  return [
    leg?.home?.puntos,
    leg?.away?.puntos,
    leg?.home?.puntosExtra,
    leg?.away?.puntosExtra
  ].some(v => Number(v || 0) > 0);
}

function llSingleWinner(round){
  const leg = round?.legs?.[0];
  if (!leg || !llIsRealTeam(leg.home.team) || !llIsRealTeam(leg.away.team) || !llLegPlayed(leg)) {
    return { winner:'WO', loser:'WO', decided:false };
  }

  const hp = Number(leg.home.puntos || 0);
  const ap = Number(leg.away.puntos || 0);
  const ht = Number(leg.home.puntosExtra || 0);
  const at = Number(leg.away.puntosExtra || 0);

  if (hp > ap) return { winner: leg.home.team, loser: leg.away.team, decided:true };
  if (ap > hp) return { winner: leg.away.team, loser: leg.home.team, decided:true };
  if (ht > at) return { winner: leg.home.team, loser: leg.away.team, decided:true };
  if (at > ht) return { winner: leg.away.team, loser: leg.home.team, decided:true };

  return { winner:'WO', loser:'WO', decided:false };
}

function llSeriesWinner(round){
  if (!round || !Array.isArray(round.legs) || round.legs.length === 0) {
    return { winner:'WO', loser:'WO', decided:false, needsExtra:false };
  }

  if (round.legs.length === 1) return llSingleWinner(round);

  const ida = round.legs[0];
  const vuelta = round.legs[1];

  if (!ida || !vuelta || !llLegPlayed(ida) || !llLegPlayed(vuelta)) {
    return { winner:'WO', loser:'WO', decided:false, needsExtra:false };
  }

  const firstTeam = normalizeTeamName(vuelta.home.team || ida.away.team);
  const secondTeam = normalizeTeamName(ida.home.team || vuelta.away.team);

  if (!llIsRealTeam(firstTeam) || !llIsRealTeam(secondTeam)) {
    return { winner:'WO', loser:'WO', decided:false, needsExtra:false };
  }

  // Regla visual: el primero de grupo juega ida de visitante y vuelta de local.
  // Por eso acumulamos por nombre de equipo y no por lado fijo.
  const acc = {};
  [firstTeam, secondTeam].forEach(t => acc[t] = { pts:0, tri:0 });

  [ida, vuelta].forEach(leg => {
    const h = normalizeTeamName(leg.home.team);
    const a = normalizeTeamName(leg.away.team);
    if (acc[h]) {
      acc[h].pts += Number(leg.home.puntos || 0);
      acc[h].tri += Number(leg.home.puntosExtra || 0);
    }
    if (acc[a]) {
      acc[a].pts += Number(leg.away.puntos || 0);
      acc[a].tri += Number(leg.away.puntosExtra || 0);
    }
  });

  const a = acc[firstTeam];
  const b = acc[secondTeam];

  if (a.pts > b.pts) return { winner:firstTeam, loser:secondTeam, decided:true, needsExtra:false };
  if (b.pts > a.pts) return { winner:secondTeam, loser:firstTeam, decided:true, needsExtra:false };
  if (a.tri > b.tri) return { winner:firstTeam, loser:secondTeam, decided:true, needsExtra:false };
  if (b.tri > a.tri) return { winner:secondTeam, loser:firstTeam, decided:true, needsExtra:false };

  const extra = round.legs[2];
  if (extra && llLegPlayed(extra)) {
    const hp = Number(extra.home.puntos || 0);
    const ap = Number(extra.away.puntos || 0);
    const ht = Number(extra.home.puntosExtra || 0);
    const at = Number(extra.away.puntosExtra || 0);
    if (hp > ap) return { winner: extra.home.team, loser: extra.away.team, decided:true, needsExtra:false };
    if (ap > hp) return { winner: extra.away.team, loser: extra.home.team, decided:true, needsExtra:false };
    if (ht > at) return { winner: extra.home.team, loser: extra.away.team, decided:true, needsExtra:false };
    if (at > ht) return { winner: extra.away.team, loser: extra.home.team, decided:true, needsExtra:false };
  }

  return { winner:'WO', loser:'WO', decided:false, needsExtra:true };
}

function llEnsureExtraIfNeeded(data){
  const target = currentCategory === 'segunda' ? 6 : 5;
  (data.rounds || []).forEach(round => {
    if (!['q1','q2','q3','q4','s1','s2'].includes(round.id)) return;
    const outcome = llSeriesWinner(round);
    if (outcome.needsExtra && round.legs.length < 3) {
      const extra = getEmptyLeg();
      extra.date = round.legs?.[1]?.date || '';
      extra.home.team = normalizeTeamName(round.legs?.[1]?.home?.team || round.legs?.[0]?.away?.team) || 'WO';
      extra.away.team = normalizeTeamName(round.legs?.[1]?.away?.team || round.legs?.[0]?.home?.team) || 'WO';
      round.legs.push(extra);
      round.helper = `Desempate a ${target} triángulos`;
    }
  });
}

function llSetSeriesTeams(round, teamA, teamB){
  if (!round || !Array.isArray(round.legs)) return;

  if (round.legs.length === 1) {
    llSetLegTeams(round, 0, teamA, teamB);
    return;
  }

  // ida: equipo A visitante/derecha, equipo B local/izquierda
  llSetLegTeams(round, 0, teamB, teamA);
  // vuelta: equipo A local/izquierda, equipo B visitante/derecha
  llSetLegTeams(round, 1, teamA, teamB);

  if (round.legs[2]) {
    llSetLegTeams(round, 2, teamA, teamB);
  }
}

function applyAutomaticAdvance(data){
  llEnsureExtraIfNeeded(data);

  if (currentCategory === 'tercera') {
    const q1 = llSeriesWinner(llGetRound(data, 'q1'));
    const q2 = llSeriesWinner(llGetRound(data, 'q2'));
    const q3 = llSeriesWinner(llGetRound(data, 'q3'));
    const q4 = llSeriesWinner(llGetRound(data, 'q4'));

    llSetSeriesTeams(llGetRound(data, 's1'), q1.winner, q2.winner);
    llSetSeriesTeams(llGetRound(data, 's2'), q3.winner, q4.winner);
  }

  const s1 = llSeriesWinner(llGetRound(data, 's1'));
  const s2 = llSeriesWinner(llGetRound(data, 's2'));

  llSetSeriesTeams(llGetRound(data, 'final'), s1.winner, s2.winner);
  llSetSeriesTeams(llGetRound(data, 'third'), s1.loser, s2.loser);

  llEnsureExtraIfNeeded(data);
  return data;
}

function mergeSavedEditableData(baseData, savedData){
  if (!savedData || !Array.isArray(savedData.rounds)) return baseData;

  baseData.rounds.forEach(round => {
    const savedRound = savedData.rounds.find(r => r?.id === round.id);
    if (!savedRound || !Array.isArray(savedRound.legs)) return;

    round.legs.forEach((leg, index) => {
      const savedLeg = savedRound.legs[index];
      if (!savedLeg) return;

      leg.date = typeof savedLeg.date === 'string' ? savedLeg.date : leg.date;
      leg.home.puntos = Number(savedLeg?.home?.puntos || 0);
      leg.home.puntosExtra = Number(savedLeg?.home?.puntosExtra || 0);
      leg.away.puntos = Number(savedLeg?.away?.puntos || 0);
      leg.away.puntosExtra = Number(savedLeg?.away?.puntosExtra || 0);
    });
  });

  return baseData;
}

async function renderCategory(category){
  currentCategory = category;
  setActiveCategoryButton(category);
  TEAM_OPTIONS = await loadUsersJS(getCategoryConfig(category).teamSource);

  const data = getDefaultData(category);

  // 1) clasificados iniciales siempre desde fixture/tablas
  await applyAutomaticEntrants(data, category);

  // 2) recuperar resultados/fechas guardadas
  const savedDbData = await loadFromServer(category);
  mergeSavedEditableData(data, savedDbData);

  // 3) avanzar automáticamente semis/final/tercer puesto
  applyAutomaticAdvance(data);

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
