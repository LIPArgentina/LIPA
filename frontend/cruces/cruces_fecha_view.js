(() => {
  'use strict';

  const API_BASE = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const FORMAT = window.LIPA_getMatchFormat?.() || {
    individualCount: 11,
    captainCount: 2,
    substituteCount: 2
  };
  const COUNTS = {
    capitan: Number(FORMAT.captainCount || 2),
    individuales: Number(FORMAT.individualCount || 11),
    suplentes: Number(FORMAT.substituteCount || 2)
  };
  const state = {
    category: 'tercera',
    matches: [],
    plans: new Map(),
    players: new Map()
  };

  const message = document.getElementById('viewerMessage');
  const grid = document.getElementById('teamsGrid');
  const matchSelect = document.getElementById('matchSelect');
  const fixtureDate = document.getElementById('fixtureDate');
  const releaseStatus = document.getElementById('releaseStatus');
  const TEAM_ALIASES = {
    OLDIES: ['OLDIES', 'OLDIES 3RA', 'OLDIES3RA'],
    THEWEST: ['THE WEST', 'WEST'],
    ALBA: ['ALBA', 'ALBA POOL']
  };

  function apiUrl(path) {
    return API_BASE + path;
  }

  async function fetchJson(path, options = {}) {
    const response = await fetch(apiUrl(path), {
      cache: 'no-store',
      ...options,
      headers: { ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.msg || data?.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' Y ')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
  }

  function aliases(value) {
    const exact = normalize(value);
    const base = exact.replace(/(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)$/g, '');
    const result = new Set([exact, base].filter(Boolean));
    for (const [canonical, names] of Object.entries(TEAM_ALIASES)) {
      const keys = [canonical, ...names].map(normalize).filter(Boolean);
      if (keys.includes(exact) || keys.includes(base)) keys.forEach(key => result.add(key));
    }
    return [...result];
  }

  function localDateKey() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  }

  function formatDate(value) {
    if (!value) return '—';
    const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(Date.UTC(year, month - 1, day, 15)));
  }

  function extractMatches(fecha) {
    const result = [];
    for (const table of Array.isArray(fecha?.tablas) ? fecha.tablas : []) {
      if (table?.fechaLibrePorReajuste) continue;
      const teams = Array.isArray(table?.equipos) ? table.equipos : [];
      for (let index = 0; index + 1 < teams.length; index += 2) {
        const local = String(teams[index]?.equipo || '').trim();
        const visitante = String(teams[index + 1]?.equipo || '').trim();
        if (!local || !visitante || normalize(local) === 'WO' || normalize(visitante) === 'WO') continue;
        result.push({
          local,
          visitante,
          group: String(table?.grupo || ''),
          date: String(fecha?.date || '').slice(0, 10)
        });
      }
    }
    return result;
  }

  function selectRelevantDate(fechas) {
    const today = localDateKey();
    const valid = fechas
      .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || '').slice(0, 10)))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return valid.find(item => String(item.date).slice(0, 10) >= today) || valid[valid.length - 1] || null;
  }

  async function loadMatches() {
    const [ida, vuelta] = await Promise.all([
      fetchJson(`/api/fixture?kind=ida&category=${encodeURIComponent(state.category)}`),
      fetchJson(`/api/fixture?kind=vuelta&category=${encodeURIComponent(state.category)}`)
    ]);
    const idaData = ida?.data && typeof ida.data === 'object' ? ida.data : ida;
    const vueltaData = vuelta?.data && typeof vuelta.data === 'object' ? vuelta.data : vuelta;
    const fechas = [
      ...(Array.isArray(idaData?.fechas) ? idaData.fechas : []),
      ...(Array.isArray(vueltaData?.fechas) ? vueltaData.fechas : [])
    ];
    const selected = selectRelevantDate(fechas);
    return { date: selected?.date || '', matches: extractMatches(selected) };
  }

  async function loadPlans(matches) {
    const rows = await fetchJson('/api/planillas');
    const index = new Map();
    const wanted = new Set(matches.flatMap(match => [...aliases(match.local), ...aliases(match.visitante)]));
    const metadata = (Array.isArray(rows) ? rows : []).filter(item => {
      if (String(item?.division || '').toLowerCase() !== state.category) return false;
      return [item?.slug_uid, item?.team, item?.teamName].some(source =>
        aliases(source).some(key => wanted.has(key))
      );
    });

    await Promise.all(metadata.map(async item => {
      const data = await fetchJson(`/api/planilla?team=${encodeURIComponent(item.slug_uid || item.team)}`);
      const plan = data?.planilla || {};
      const sources = [item?.slug_uid, item?.team, item?.teamName, plan?.team];
      const normalizedPlan = {
        ...plan,
        teamRef: item?.slug_uid || item?.team || item?.teamName || ''
      };
      for (const source of sources) {
        for (const key of aliases(source)) {
          if (!index.has(key)) index.set(key, normalizedPlan);
        }
      }
    }));
    return index;
  }

  function findPlan(teamName) {
    for (const key of aliases(teamName)) {
      if (state.plans.has(key)) return state.plans.get(key);
    }
    return {};
  }

  function planEntries(plan, section, count) {
    const names = Array.isArray(plan?.[section]) ? plan[section] : [];
    const ids = Array.isArray(plan?.jugadorIds?.[section]) ? plan.jugadorIds[section] : [];
    return Array.from({ length: count }, (_, index) => ({
      name: String(names[index] || '').trim(),
      id: Number(ids[index]) || null
    }));
  }

  function closePhoto() {
    document.getElementById('playerPhotoModal').hidden = true;
    document.body.style.overflow = '';
  }

  async function loadPlayers(teamRef) {
    const key = `${state.category}:${normalize(teamRef)}`;
    if (!state.players.has(key)) {
      const params = new URLSearchParams({ category: state.category, team: teamRef });
      state.players.set(key, fetchJson(`/api/players-public/by-team?${params}`).then(data => (
        Array.isArray(data?.players) ? data.players : []
      )).catch(() => []));
    }
    return state.players.get(key);
  }

  async function showPhoto(entry, teamRef) {
    const modal = document.getElementById('playerPhotoModal');
    const title = document.getElementById('playerPhotoName');
    const image = document.getElementById('playerPhotoImage');
    const status = document.getElementById('playerPhotoStatus');
    const profileButton = document.getElementById('playerProfileButton');
    title.textContent = entry.name;
    if (profileButton) {
      profileButton.dataset.player = entry.name;
      profileButton.dataset.category = state.category;
    }
    image.src = '../logo_liga.png';
    status.textContent = 'Buscando foto…';
    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    const players = await loadPlayers(teamRef);
    const player = players.find(item => entry.id && Number(item?.id) === entry.id)
      || players.find(item => normalize(item?.nombre || item?.name) === normalize(entry.name));
    if (!player) {
      status.textContent = 'No se encontró la ficha del jugador.';
      return;
    }
    image.src = player?.fotoUrl ? apiUrl(player.fotoUrl) : '../logo_liga.png';
    status.textContent = player?.fotoUrl ? '' : 'Este jugador todavía no tiene una foto cargada.';
  }

  function openPlayerProfile() {
    const button = document.getElementById('playerProfileButton');
    const status = document.getElementById('playerPhotoStatus');
    const player = String(button?.dataset.player || '').trim();
    const category = String(button?.dataset.category || state.category).trim().toLowerCase();
    if (category !== 'tercera') {
      status.textContent = 'Ficha no disponible por falta de datos para esta categoría. Pedir al capitán que lo complete.';
      return;
    }
    if (!player) {
      status.textContent = 'No se pudo identificar al jugador.';
      return;
    }
    const params = new URLSearchParams({ mode: 'individual', category, player, auto: '1', edition: '6' });
    const modal = document.getElementById('playerProfileModal');
    const frame = document.getElementById('playerProfileFrame');
    frame.src = `../consultas/consultas.html?${params.toString()}`;
    modal.hidden = false;
  }

  function closePlayerProfile() {
    const modal = document.getElementById('playerProfileModal');
    const frame = document.getElementById('playerProfileFrame');
    modal.hidden = true;
    frame.src = 'about:blank';
  }

  function createSection(title, entries, teamRef) {
    const section = document.createElement('section');
    section.className = 'players-section';
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.appendChild(heading);

    entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      const number = document.createElement('div');
      number.className = 'player-number';
      number.textContent = String(index + 1);
      const slot = document.createElement('div');
      slot.className = `player-slot${entry.name ? '' : ' empty'}`;
      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = entry.name;
      slot.appendChild(name);
      if (entry.name) {
        const photo = document.createElement('button');
        photo.type = 'button';
        photo.className = 'photo-button';
        photo.textContent = '📷';
        photo.setAttribute('aria-label', `Ver foto de ${entry.name}`);
        photo.addEventListener('click', () => showPhoto(entry, teamRef));
        slot.appendChild(photo);
      }
      row.append(number, slot);
      section.appendChild(row);
    });
    return section;
  }

  function renderCard(root, role, teamName, plan) {
    root.innerHTML = '';
    const roleNode = document.createElement('div');
    roleNode.className = 'team-role';
    roleNode.textContent = role;
    const name = document.createElement('h2');
    name.className = 'team-name';
    name.textContent = teamName;
    root.append(roleNode, name);
    root.appendChild(createSection(
      'CAPITÁN',
      planEntries(plan, 'capitan', COUNTS.capitan),
      plan.teamRef || teamName
    ));
    root.appendChild(createSection(
      'INDIVIDUALES',
      planEntries(plan, 'individuales', COUNTS.individuales),
      plan.teamRef || teamName
    ));
    root.appendChild(createSection(
      'SUPLENTES',
      planEntries(plan, 'suplentes', COUNTS.suplentes),
      plan.teamRef || teamName
    ));
  }

  function renderSelectedMatch() {
    const match = state.matches[Number(matchSelect.value) || 0];
    if (!match) {
      grid.hidden = true;
      message.hidden = false;
      message.textContent = 'No hay cruces disponibles para esta fecha.';
      return;
    }
    renderCard(document.getElementById('localCard'), 'LOCAL', match.local, findPlan(match.local));
    renderCard(document.getElementById('visitorCard'), 'VISITANTE', match.visitante, findPlan(match.visitante));
    message.hidden = true;
    grid.hidden = false;
  }

  async function loadReleaseStatus() {
    try {
      const data = await fetchJson(`/api/cruces/status?team=__categoria_${state.category}__`);
      const enabled = Boolean(data?.enabled);
      releaseStatus.textContent = enabled ? 'CRUCES PUBLICADOS' : 'PUBLICACIÓN PENDIENTE';
      releaseStatus.classList.toggle('is-open', enabled);
      return enabled;
    } catch (error) {
      releaseStatus.textContent = 'ESTADO NO DISPONIBLE';
      releaseStatus.classList.remove('is-open');
      throw error;
    }
  }

  async function loadCategory() {
    message.hidden = false;
    message.className = 'viewer-message';
    message.textContent = 'Cargando cruces y planillas…';
    grid.hidden = true;
    state.players.clear();
    document.querySelectorAll('[data-category]').forEach(button => {
      button.classList.toggle('active', button.dataset.category === state.category);
    });
    try {
      const enabled = await loadReleaseStatus();
      if (!enabled) {
        state.matches = [];
        state.plans = new Map();
        matchSelect.innerHTML = '';
        fixtureDate.textContent = '—';
        message.className = 'viewer-message';
        message.textContent = 'Los cruces de Tercera todavía no están habilitados.';
        return;
      }

      const { date, matches } = await loadMatches();
      const plans = await loadPlans(matches);
      state.matches = matches;
      state.plans = plans;
      fixtureDate.textContent = formatDate(date).toUpperCase();
      matchSelect.innerHTML = '';
      matches.forEach((match, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${match.group ? `GRUPO ${match.group} · ` : ''}${match.local} vs ${match.visitante}`;
        matchSelect.appendChild(option);
      });
      renderSelectedMatch();
    } catch (error) {
      message.className = 'viewer-message error';
      message.textContent = `No se pudo cargar el visor: ${error.message}`;
    }
  }

  async function init() {
    document.querySelectorAll('[data-category]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.disabled || button.dataset.category !== 'tercera') return;
        state.category = button.dataset.category;
        const url = new URL(location.href);
        url.searchParams.set('cat', state.category);
        history.replaceState(null, '', url);
        loadCategory();
      });
    });
    matchSelect.addEventListener('change', renderSelectedMatch);
    document.getElementById('closePhotoButton').addEventListener('click', closePhoto);
    document.getElementById('playerProfileButton').addEventListener('click', openPlayerProfile);
    document.getElementById('closePlayerProfileButton').addEventListener('click', closePlayerProfile);
    document.querySelector('[data-close-player-profile]').addEventListener('click', closePlayerProfile);
    document.querySelector('[data-close-photo]').addEventListener('click', closePhoto);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !document.getElementById('playerProfileModal').hidden) {
        closePlayerProfile();
      } else if (event.key === 'Escape') {
        closePhoto();
      }
    });
    await loadCategory();
  }

  init();
})();
