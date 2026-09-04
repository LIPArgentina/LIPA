(() => {
  'use strict';

  const API_BASE = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const FORMAT = window.LIPA_getMatchFormat?.() || {
    individualCount: 11, pairCount: 2, pairSize: 2, captainCount: 2, substituteCount: 2
  };

  const state = {
    teams: [],
    schedule: [],
    resultsByDate: new Map(),
    rosterCache: new Map(),
    publishedPlanillas: null,
    loadedResult: null,
    loadedFromPlanillas: false,
    editorReady: false
  };

  const $ = (selector) => document.querySelector(selector);

  function editorFormat() {
    if (Number($('#edicion')?.value || 6) === 5) {
      return {
        individualCount: 7,
        pairCount: 2,
        pairSize: 2,
        captainCount: 2,
        substituteCount: 2
      };
    }
    return {
      individualCount: Number(FORMAT.individualCount || 11),
      pairCount: Number(FORMAT.pairCount || 0),
      pairSize: Number(FORMAT.pairSize || 2),
      captainCount: Number(FORMAT.captainCount || 2),
      substituteCount: Number(FORMAT.substituteCount || 2)
    };
  }

  function editorSections() {
    const format = editorFormat();
    return [
      { key: 'capitan', title: 'CAPITÁN', count: format.captainCount, score: false },
      { key: 'individuales', title: 'INDIVIDUALES', count: format.individualCount, score: true },
      ...(format.pairCount >= 1 ? [{ key: 'pareja1', title: 'PAREJA 1', count: format.pairSize, score: 'single' }] : []),
      ...(format.pairCount >= 2 ? [{ key: 'pareja2', title: 'PAREJA 2', count: format.pairSize, score: 'single' }] : []),
      { key: 'suplentes', title: 'SUPLENTES', count: format.substituteCount, score: false }
    ];
  }

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function readSession() {
    try {
      const raw = localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function authHeaders(extra = {}) {
    const token = readSession()?.token;
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  async function fetchJson(path, options = {}) {
    const response = await fetch(apiUrl(path), {
      cache: 'no-store',
      credentials: 'include',
      ...options,
      headers: authHeaders(options.headers || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || data?.message || data?.msg || `HTTP ${response.status}`);
    }
    return data;
  }

  function setStatus(message, type = '') {
    const node = $('#status');
    node.className = `hint${type ? ` ${type}` : ''}`;
    node.textContent = message;
  }

  function normalizeIdentity(value = '') {
    const compact = String(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '')
      .replace(/(primera|segunda|tercera|1ra|2da|3ra|3era)$/g, '');
    const aliases = { west: 'thewest', albapool: 'alba', oldies3ra: 'oldies' };
    return aliases[compact] || compact;
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  function dateLabel(dateValue) {
    const parts = String(dateValue || '').split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateValue;
  }

  function teamForFixtureName(name) {
    const identity = normalizeIdentity(name);
    return state.teams.find((team) => normalizeIdentity(team.slug) === identity || normalizeIdentity(team.name) === identity) || {
      name: String(name || '').trim(), slug: identity
    };
  }

  function normalizeTeam(item) {
    const name = item?.username || item?.name || item?.equipo || item?.slug || 'Equipo';
    return { name: String(name), slug: String(item?.slug || normalizeIdentity(name)) };
  }

  function extractSchedule(fixtures) {
    const matches = [];
    fixtures.forEach(({ kind, data }) => {
      (Array.isArray(data?.fechas) ? data.fechas : []).forEach((fecha) => {
        const originalDate = String(fecha?.date || '').slice(0, 10);
        (Array.isArray(fecha?.tablas) ? fecha.tablas : []).forEach((tabla) => {
          const teams = Array.isArray(tabla?.equipos) ? tabla.equipos : [];
          for (let index = 0; index < teams.length - 1; index += 2) {
            const localItem = teams[index];
            const visitanteItem = teams[index + 1];
            if (String(localItem?.categoria || '').toLowerCase() !== 'local') continue;
            if (String(visitanteItem?.categoria || '').toLowerCase() !== 'visitante') continue;
            if (normalizeIdentity(localItem?.equipo) === 'wo' || normalizeIdentity(visitanteItem?.equipo) === 'wo') continue;
            const local = teamForFixtureName(localItem?.equipo);
            const visitante = teamForFixtureName(visitanteItem?.equipo);
            const date = String(
              localItem?.reprogramadoPara ||
              visitanteItem?.reprogramadoPara ||
              fecha?.reprogramadoPara ||
              originalDate
            ).slice(0, 10);
            matches.push({
              date, kind, group: String(tabla?.grupo || ''),
              originalDate,
              reprogrammed: Boolean(date && originalDate && date !== originalDate),
              localSlug: local.slug, localName: local.name,
              visitanteSlug: visitante.slug, visitanteName: visitante.name
            });
          }
        });
      });
    });
    return matches.sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));
  }

  function matchKey(match) {
    return `${normalizeIdentity(match?.localSlug || match?.localName)}::${normalizeIdentity(match?.visitanteSlug || match?.visitanteName)}`;
  }

  function selectedMatch() {
    const date = $('#fechaISO').value;
    const key = $('#fixtureMatch').value;
    return state.schedule.find((match) => match.date === date && matchKey(match) === key) || null;
  }

  function resultForMatch(match) {
    const results = state.resultsByDate.get(match?.date) || [];
    const key = matchKey(match);
    return results.find((result) => matchKey(result) === key) || null;
  }

  async function loadResultsForDate(date) {
    if (!date) return [];
    const category = $('#categoria').value;
    const data = await fetchJson(`/api/cruces/results?fechaISO=${encodeURIComponent(date)}&category=${encodeURIComponent(category)}`);
    const results = Array.isArray(data?.results) ? data.results.filter((item) => item?.tipo !== 'desempate') : [];
    state.resultsByDate.set(date, results);
    return results;
  }

  async function refreshMatchOptions() {
    const date = $('#fechaISO').value;
    await loadResultsForDate(date);
    const matches = state.schedule.filter((match) => match.date === date);
    const select = $('#fixtureMatch');
    select.innerHTML = matches.length ? '' : '<option value="">Sin partidos programados</option>';
    matches.forEach((match) => {
      const loaded = !!resultForMatch(match);
      const option = document.createElement('option');
      option.value = matchKey(match);
      option.textContent = `${match.group ? `GRUPO ${match.group} · ` : ''}${match.localName} vs ${match.visitanteName}${match.reprogrammed ? ` · REPROGRAMADO (ORIGINAL ${dateLabel(match.originalDate)})` : ''}${loaded ? ' · CARGADO' : ''}`;
      option.dataset.loaded = String(loaded);
      select.appendChild(option);
    });
    resetEditor();
    updateSelectionBadge();
  }

  function fillDateOptions() {
    const select = $('#fechaISO');
    const dates = [...new Set(state.schedule.map((match) => match.date))];
    select.innerHTML = dates.length ? '' : '<option value="">No hay fechas en el fixture</option>';
    dates.forEach((date) => {
      const kinds = [...new Set(state.schedule.filter((match) => match.date === date).map((match) => match.kind))];
      const reprogrammedMatches = state.schedule.filter((match) => match.date === date && match.reprogrammed);
      const option = document.createElement('option');
      option.value = date;
      option.textContent = `${dateLabel(date)} · ${kinds.map((kind) => kind.toUpperCase()).join(' / ')}${reprogrammedMatches.length ? ` · REPROGRAMADO (ORIGINAL ${dateLabel(reprogrammedMatches[0].originalDate)})` : ''}`;
      select.appendChild(option);
    });
  }

  async function loadSearchData() {
    const category = $('#categoria').value;
    const edition = Number($('#edicion').value || 6);
    setStatus('Cargando fixture y equipos…');
    state.resultsByDate.clear();
    state.rosterCache.clear();
    state.publishedPlanillas = null;
    state.loadedResult = null;

    try {
      const [teamsData, ida, vuelta] = await Promise.all([
        fetchJson(`/api/teams?division=${encodeURIComponent(category)}`),
        fetchJson(`/api/fixture?kind=ida&category=${encodeURIComponent(category)}&edition=${edition}`),
        fetchJson(`/api/fixture?kind=vuelta&category=${encodeURIComponent(category)}&edition=${edition}`)
      ]);
      const rawTeams = Array.isArray(teamsData) ? teamsData : (teamsData?.teams || teamsData?.users || []);
      state.teams = rawTeams.map(normalizeTeam);
      state.schedule = extractSchedule([
        { kind: 'ida', data: ida?.data || {} },
        { kind: 'vuelta', data: vuelta?.data || {} }
      ]);
      fillDateOptions();
      await refreshMatchOptions();
      setStatus(state.schedule.length
        ? 'Seleccioná un partido. Los que ya tienen resultado aparecen marcados como CARGADO.'
        : 'No hay partidos cargados en el fixture para esta selección.', state.schedule.length ? 'ok' : 'error');
    } catch (error) {
      console.error(error);
      state.schedule = [];
      fillDateOptions();
      resetEditor();
      setStatus(`No se pudo cargar la búsqueda: ${error.message}`, 'error');
    }
  }

  async function loadRoster(teamSlug) {
    const key = `${$('#categoria').value}::${teamSlug}`;
    if (state.rosterCache.has(key)) return state.rosterCache.get(key);
    const data = await fetchJson(`/api/team-assets?team=${encodeURIComponent(teamSlug)}`);
    const players = Array.isArray(data?.players) ? data.players.map(String) : [];
    state.rosterCache.set(key, players);
    return players;
  }

  async function loadPublishedPlanillas() {
    if (Array.isArray(state.publishedPlanillas)) return state.publishedPlanillas;
    const data = await fetchJson('/api/admin/planillas');
    state.publishedPlanillas = Array.isArray(data) ? data : [];
    return state.publishedPlanillas;
  }

  function publishedPlanillaForTeam(items, team) {
    const wanted = normalizeIdentity(team?.slug || team?.name);
    const category = String($('#categoria').value || '').toLowerCase();
    return items.find((item) => {
      const itemCategory = String(
        item?.category || item?.division || item?.categoria ||
        item?.planilla?.category || item?.planilla?.categoria || ''
      ).toLowerCase();
      if (itemCategory && itemCategory !== category) return false;
      const identities = [
        item?.team, item?.team_base, item?.slug_uid, item?.slug,
        item?.teamName, item?.name, item?.planilla?.team
      ].map(normalizeIdentity).filter(Boolean);
      return identities.includes(wanted);
    })?.planilla || null;
  }

  function pointsSelect() {
    return `<div class="ptsbox"><select class="pts-select">${Array.from({ length: 7 }, (_, value) => `<option value="${value}">${value}</option>`).join('')}</select></div>`;
  }

  function playerSelect(players) {
    return `<select class="player-select"><option value="">— Seleccionar —</option>${players.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}</select>`;
  }

  function renderTeam(rootId, role, teamName, players, right = false) {
    const root = document.getElementById(rootId);
    const card = $('#cardTpl').content.firstElementChild.cloneNode(true);
    card.querySelector('.team-role').textContent = role;
    card.querySelector('.team-title').textContent = String(teamName || '').toUpperCase();
    if (right) {
      card.querySelector('.total-wrap').classList.add('right');
      card.querySelector('.wins-wrap').classList.add('right');
      card.querySelector('.total-chip').classList.add('reverse');
      card.querySelector('.wins-chip').classList.add('reverse');
    }

    const sectionsNode = card.querySelector('.sections');
    editorSections().forEach((section) => {
      const sectionNode = document.createElement('div');
      sectionNode.className = 'section';
      sectionNode.dataset.section = section.key;
      sectionNode.innerHTML = `<h3>${section.title}</h3>`;
      for (let index = 0; index < section.count; index += 1) {
        const row = document.createElement('div');
        row.className = `row${right ? ' right' : ''}`;
        const badge = `<div class="badge">${index + 1}</div>`;
        const field = `<div class="select-wrap">${playerSelect(players)}</div>`;
        const score = section.score === true || (section.score === 'single' && index === 0)
          ? pointsSelect() : '<div class="ptsbox hidden-box"></div>';
        row.innerHTML = right ? `${score}${field}${badge}` : `${badge}${field}${score}`;
        sectionNode.appendChild(row);
      }
      sectionsNode.appendChild(sectionNode);
    });
    root.replaceChildren(card);
  }

  function scoreRows(rootId) {
    return [...document.querySelectorAll(`#${rootId} .pts-select`)].map((select) => Number(select.value || 0));
  }

  function recalc() {
    const local = scoreRows('localRoot');
    const visitante = scoreRows('visitanteRoot');
    let localWins = 0;
    let visitanteWins = 0;
    local.forEach((score, index) => {
      const rival = visitante[index] || 0;
      if (score > rival) localWins += 1;
      if (rival > score) visitanteWins += 1;
    });
    $('#localRoot .totalValue').textContent = local.reduce((sum, score) => sum + score, 0);
    $('#visitanteRoot .totalValue').textContent = visitante.reduce((sum, score) => sum + score, 0);
    $('#localRoot .winsValue').textContent = localWins;
    $('#visitanteRoot .winsValue').textContent = visitanteWins;
  }

  function setPlayerValue(select, value) {
    const player = String(value || '');
    if (player && ![...select.options].some((option) => option.value === player)) {
      select.add(new Option(player, player));
    }
    select.value = player;
  }

  function applyPlanilla(rootId, planilla = {}, side = {}) {
    ['capitan', 'individuales', 'pareja1', 'pareja2', 'suplentes'].forEach((key) => {
      const values = Array.isArray(planilla?.[key]) ? planilla[key] : [];
      document.querySelectorAll(`#${rootId} .section[data-section="${key}"] .player-select`).forEach((select, index) => {
        setPlayerValue(select, values[index] || '');
      });
    });
    const scores = Array.isArray(side?.scoreRows) ? side.scoreRows : [];
    document.querySelectorAll(`#${rootId} .pts-select`).forEach((select, index) => {
      select.value = String(Number(scores[index] || 0));
    });
  }

  function wireEditorEvents(rootId) {
    const root = document.getElementById(rootId);
    root.querySelectorAll('.pts-select').forEach((select) => select.addEventListener('change', recalc));
    let selectedSubstitute = null;
    root.querySelectorAll('.section[data-section="suplentes"] .player-select').forEach((select) => {
      select.addEventListener('focus', () => {
        root.querySelectorAll('.bench-selected').forEach((node) => node.classList.remove('bench-selected'));
        select.classList.add('bench-selected');
        selectedSubstitute = select;
      });
    });
    root.querySelectorAll('.section:not([data-section="suplentes"]):not([data-section="capitan"]) .player-select').forEach((select) => {
      select.addEventListener('change', () => {
        if (!selectedSubstitute?.value || !select.value || selectedSubstitute.value === select.value) return;
        const outgoing = select.value;
        const incoming = selectedSubstitute.value;
        const repeated = [...root.querySelectorAll('.section:not([data-section="suplentes"]):not([data-section="capitan"]) .player-select')]
          .filter((other) => other !== select && other.value === outgoing);
        select.value = incoming;
        if (repeated.length && window.confirm(`${outgoing} aparece en otro lugar. ¿También querés reemplazarlo por ${incoming}?`)) {
          repeated.forEach((other) => { other.value = incoming; });
        }
        selectedSubstitute.value = outgoing;
      });
    });
  }

  function updateSelectionBadge() {
    const match = selectedMatch();
    const loaded = !!(match && resultForMatch(match));
    const badge = $('#modeBadge');
    badge.textContent = loaded ? 'CARGADO' : 'NUEVO';
    badge.className = `mode-badge ${loaded ? 'loaded' : 'new'}`;
  }

  function resetEditor() {
    state.loadedResult = null;
    state.loadedFromPlanillas = false;
    state.editorReady = false;
    $('#localRoot').replaceChildren();
    $('#visitanteRoot').replaceChildren();
    $('#editorSummary').hidden = true;
    $('#btnGuardar').disabled = true;
    $('#btnGuardar').textContent = 'GUARDAR CRUCE';
    updateSelectionBadge();
  }

  async function loadSelectedMatch() {
    const match = selectedMatch();
    if (!match) return setStatus('Seleccioná un partido válido.', 'error');
    const button = $('#btnCargar');
    button.disabled = true;
    setStatus('Cargando jugadores y resultado…');
    try {
      const [localRoster, visitanteRoster] = await Promise.all([
        loadRoster(match.localSlug), loadRoster(match.visitanteSlug)
      ]);
      renderTeam('localRoot', 'LOCAL', match.localName, localRoster, false);
      renderTeam('visitanteRoot', 'VISITANTE', match.visitanteName, visitanteRoster, true);
      wireEditorEvents('localRoot');
      wireEditorEvents('visitanteRoot');

      const result = resultForMatch(match);
      if (result) {
        applyPlanilla('localRoot', result.localPlanilla, result.local);
        applyPlanilla('visitanteRoot', result.visitantePlanilla, result.visitante);
      } else {
        const planillas = await loadPublishedPlanillas();
        const localPlanilla = publishedPlanillaForTeam(planillas, {
          slug: match.localSlug, name: match.localName
        });
        const visitantePlanilla = publishedPlanillaForTeam(planillas, {
          slug: match.visitanteSlug, name: match.visitanteName
        });
        if (localPlanilla) applyPlanilla('localRoot', localPlanilla, {});
        if (visitantePlanilla) applyPlanilla('visitanteRoot', visitantePlanilla, {});
        state.loadedFromPlanillas = !!(localPlanilla || visitantePlanilla);
      }
      recalc();
      state.loadedResult = result;
      state.editorReady = true;
      $('#localTeam').value = match.localSlug;
      $('#visitanteTeam').value = match.visitanteSlug;
      $('#localTeamName').textContent = match.localName;
      $('#visitanteTeamName').textContent = match.visitanteName;
      $('#editorSummary').hidden = false;
      $('#btnGuardar').disabled = false;
      $('#btnGuardar').textContent = result ? 'ACTUALIZAR CRUCE' : 'GUARDAR CRUCE';
      updateSelectionBadge();
      setStatus(result
        ? 'Cruce cargado desde la base. Podés corregir jugadores o resultados y actualizarlo.'
        : state.loadedFromPlanillas
          ? 'El cruce todavía no está validado. Se cargaron las planillas publicadas y ya podés modificar jugadores antes de guardarlo.'
          : 'Este partido todavía no tiene un cruce guardado ni planillas publicadas. Completalo y guardalo.', result ? 'loaded' : 'ok');
    } catch (error) {
      console.error(error);
      resetEditor();
      setStatus(`No se pudo cargar el cruce: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function collectPlanilla(rootId) {
    const format = editorFormat();
    const output = { capitan: [], individuales: [], pareja1: [], pareja2: [], suplentes: [] };
    document.querySelectorAll(`#${rootId} .section`).forEach((section) => {
      output[section.dataset.section] = [...section.querySelectorAll('.player-select')].map((select) => select.value || '');
    });
    const scores = scoreRows(rootId);
    output.individualesPts = scores.slice(0, format.individualCount);
    output.pareja1Pts = format.pairCount >= 1 ? [scores[format.individualCount] || 0] : [];
    output.pareja2Pts = format.pairCount >= 2 ? [scores[format.individualCount + 1] || 0] : [];
    return output;
  }

  function collectStatus() {
    const match = selectedMatch();
    const persistedMatch = state.loadedResult || match;
    const format = editorFormat();
    const localScores = scoreRows('localRoot');
    const visitanteScores = scoreRows('visitanteRoot');
    return {
      fechaISO: match.date,
      category: $('#categoria').value,
      // Al corregir conservamos las claves originales para sobrescribir el
      // registro existente, incluso si el nombre administrativo cambió.
      localSlug: persistedMatch.localSlug,
      visitanteSlug: persistedMatch.visitanteSlug,
      validated: true,
      local: {
        jugadores: localScores.slice(0, format.individualCount), scoreRows: localScores,
        puntosTotales: Number($('#localRoot .winsValue').textContent || 0),
        triangulosTotales: Number($('#localRoot .totalValue').textContent || 0)
      },
      visitante: {
        jugadores: visitanteScores.slice(0, format.individualCount), scoreRows: visitanteScores,
        puntosTotales: Number($('#visitanteRoot .winsValue').textContent || 0),
        triangulosTotales: Number($('#visitanteRoot .totalValue').textContent || 0)
      },
      localPlanilla: collectPlanilla('localRoot'),
      visitantePlanilla: collectPlanilla('visitanteRoot')
    };
  }

  async function save() {
    if (!state.editorReady) return;
    const button = $('#btnGuardar');
    const wasUpdate = !!state.loadedResult;
    if (wasUpdate && !window.confirm('Vas a sobrescribir el cruce guardado. ¿Confirmás la corrección?')) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = wasUpdate ? 'ACTUALIZANDO…' : 'GUARDANDO…';
    setStatus(wasUpdate ? 'Actualizando el cruce en la base…' : 'Guardando el cruce en la base…');
    try {
      await fetchJson('/api/cruces/manual-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: $('#categoria').value,
          edition: Number($('#edicion').value || 6),
          status: collectStatus()
        })
      });
      await loadResultsForDate($('#fechaISO').value);
      state.loadedResult = resultForMatch(selectedMatch());
      $('#btnGuardar').textContent = 'ACTUALIZAR CRUCE';
      updateSelectionBadge();
      await refreshMatchOptionsKeepingSelection();
      setStatus(wasUpdate ? 'Cruce corregido y sobrescrito correctamente.' : 'Cruce guardado correctamente.', 'ok');
    } catch (error) {
      console.error(error);
      button.textContent = original;
      setStatus(`No se pudo guardar: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function refreshMatchOptionsKeepingSelection() {
    const key = $('#fixtureMatch').value;
    const date = $('#fechaISO').value;
    const matches = state.schedule.filter((match) => match.date === date);
    $('#fixtureMatch').innerHTML = '';
    matches.forEach((match) => {
      const option = new Option(
        `${match.group ? `GRUPO ${match.group} · ` : ''}${match.localName} vs ${match.visitanteName}${resultForMatch(match) ? ' · CARGADO' : ''}`,
        matchKey(match)
      );
      $('#fixtureMatch').add(option);
    });
    $('#fixtureMatch').value = key;
  }

  function withAdminMode(url) {
    const target = new URL(url, location.href);
    const params = new URLSearchParams(location.search);
    if (params.get('admin') === '1' || params.get('mode') === 'admin') target.searchParams.set('admin', '1');
    return `${target.pathname}${target.search}${target.hash}`;
  }

  function bind() {
    $('#btnVolverAdmin').href = withAdminMode($('#btnVolverAdmin').getAttribute('href'));
    $('#categoria').addEventListener('change', loadSearchData);
    $('#edicion').addEventListener('change', loadSearchData);
    $('#fechaISO').addEventListener('change', refreshMatchOptions);
    $('#fixtureMatch').addEventListener('change', () => { resetEditor(); updateSelectionBadge(); });
    $('#btnCargar').addEventListener('click', loadSelectedMatch);
    $('#btnGuardar').addEventListener('click', save);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bind();
    await loadSearchData();
  });
})();
