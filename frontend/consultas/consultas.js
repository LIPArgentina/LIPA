(() => {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const dtf = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' });

  const $form = document.getElementById('consultaForm');
  const $category = document.getElementById('categorySelect');
  const $player = document.getElementById('playerInput');
  const $datalist = document.getElementById('playerSuggestions');
  const $team = document.getElementById('teamInput');
  const $teamDatalist = document.getElementById('teamSuggestions');
  const $status = document.getElementById('statusBox');
  const $summary = document.getElementById('summaryBox');
  const $results = document.getElementById('resultsBox');
  const $ranking = document.getElementById('rankingBox');
  const $rankingButtons = Array.from(document.querySelectorAll('[data-ranking-limit]'));
  const $modeButtons = Array.from(document.querySelectorAll('[data-consult-mode]'));
  const $rankingEdition = document.getElementById('rankingEditionSelect');
  const $radInfo = document.getElementById('btnRadInfo');
  const $radModal = document.getElementById('radModal');
  const $radClose = document.getElementById('btnRadClose');

  let debounceTimer = null;
  let lastSuggestions = [];
  let lastTeamSuggestions = [];
  let teamDebounceTimer = null;
  let currentRankingTab = 'players';
  let currentConsultMode = 'individual';
  let currentSearchEdition = 'total';
  let currentRankingEdition = 'total';
  let lastRankingData = null;
  let lastRankingLimit = 10;
  let lastRankingMode = 'players';
  let hasAdminAccess = false;

  function apiUrl(path) {
    return API_BASE + path;
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
    const session = readSession();
    return session?.token
      ? { ...extra, Authorization: `Bearer ${session.token}` }
      : extra;
  }

  function withCacheBust(path) {
    const sep = path.includes('?') ? '&' : '?';
    return path + sep + '_=' + Date.now();
  }

  function editionLabel(value) {
    if (String(value || '').toLowerCase() === 'total') return 'TOTAL';
    return `${Number(value || 6)}TA EDICIÓN`;
  }

  function setSearchEdition(value) {
    currentSearchEdition = String(value || '6').toLowerCase();
    currentRankingEdition = currentSearchEdition;
    if ($rankingEdition && Array.from($rankingEdition.options).some((option) => option.value === currentSearchEdition)) {
      $rankingEdition.value = currentSearchEdition;
    }
  }

  function getTeamEdition() {
    return currentSearchEdition === 'total' ? '6' : currentSearchEdition;
  }

  function updateRankingEditionOptions() {
    if (!$rankingEdition) return;
    const previous = String(currentRankingEdition || $rankingEdition.value || '6').toLowerCase();
    $rankingEdition.innerHTML = currentRankingTab === 'teams'
      ? '<option value="5">5ta</option><option value="6">6ta</option>'
      : '<option value="5">5ta</option><option value="6">6ta</option><option value="total">Total</option>';
    if (Array.from($rankingEdition.options).some((option) => option.value === previous)) {
      $rankingEdition.value = previous;
    } else {
      $rankingEdition.value = '6';
    }
    setSearchEdition($rankingEdition.value);
  }

  function setConsultMode(mode, { preserveEdition = true } = {}) {
    const nextMode = mode === 'group' ? 'group' : 'individual';
    const previousEdition = preserveEdition ? currentSearchEdition : '6';
    currentConsultMode = nextMode;
    currentRankingTab = nextMode === 'group' ? 'teams' : 'players';
    $modeButtons.forEach((button) => {
      const active = button.dataset.consultMode === nextMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelector('.field-player')?.style.setProperty('display', nextMode === 'individual' ? 'flex' : 'none');
    document.querySelector('.field-team')?.style.setProperty('display', nextMode === 'group' ? 'flex' : 'none');
    updateRankingEditionOptions();
    if (Array.from($rankingEdition?.options || []).some((option) => option.value === previousEdition)) {
      setSearchEdition(previousEdition);
    }
    clearRanking();
    clearResults();
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: authHeaders()
    });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      throw new Error(data?.error || data?.message || 'No se pudo consultar.');
    }
    return data;
  }

  async function enableAdminCategories() {
    const session = readSession();
    if (String(session?.role || '').toLowerCase() !== 'admin' || !session?.token) return false;

    try {
      await fetchJson(apiUrl('/api/admin/session'));
      if ($category && !Array.from($category.options).some((option) => option.value === 'segunda')) {
        const option = document.createElement('option');
        option.value = 'segunda';
        option.textContent = 'Segunda';
        $category.insertBefore(option, $category.firstChild);
      }
      return true;
    } catch (_) {
      return false;
    }
  }


  function toNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function round1(value) {
    return Math.round(toNumber(value) * 10) / 10;
  }

  function buildRadContext(items = []) {
    const playedValues = items
      .map((item) => toNumber(item.played))
      .filter((played) => played > 0);

    const maxPlayed = playedValues.length ? Math.max(...playedValues) : 0;
    const avgPlayed = playedValues.length
      ? playedValues.reduce((acc, played) => acc + played, 0) / playedValues.length
      : 0;
    const spread = maxPlayed > 0 ? (maxPlayed - avgPlayed) / maxPlayed : 0;
    const force = 1 + spread;

    return { maxPlayed, avgPlayed, spread, force };
  }

  function calculateRad(item, context) {
    if (item && item.rad !== undefined) {
      return {
        ...item,
        effectiveness: round1(item.effectiveness),
        rad: round1(item.rad),
        radPenalty: round1(item.radPenalty || 1),
      };
    }
    const played = toNumber(item?.played);
    const wins = toNumber(item?.wins);
    const effectiveness = played > 0 ? (wins / played) * 100 : 0;
    const maxPlayed = toNumber(context?.maxPlayed);
    const force = toNumber(context?.force) || 1;
    const penalty = maxPlayed > 0 && played > 0
      ? 1 + ((maxPlayed - played) / maxPlayed) * force
      : 1;
    const rad = penalty > 0 ? effectiveness / penalty : 0;

    return {
      ...item,
      effectiveness: round1(effectiveness),
      rad: round1(rad),
      radPenalty: round1(penalty),
    };
  }

  function sortPlayersByRad(items = [], context = null) {
    const radContext = context || buildRadContext(items);
    return items
      .map((item) => calculateRad(item, radContext))
      .sort((a, b) =>
        toNumber(b.rad) - toNumber(a.rad) ||
        toNumber(b.diff) - toNumber(a.diff) ||
        toNumber(b.triangulosFavor) - toNumber(a.triangulosFavor) ||
        toNumber(b.wins) - toNumber(a.wins)
      );
  }

  function openRadModal() {
    if (!$radModal) return;
    $radModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeRadModal() {
    if (!$radModal) return;
    $radModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function formatDate(iso) {
    const raw = String(iso || '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : dtf.format(d);
  }

  function setStatus(text, type = 'info') {
    if (!$status) return;
    if (!text) {
      $status.hidden = true;
      $status.textContent = '';
      $status.className = 'status-box';
      return;
    }
    $status.hidden = false;
    $status.textContent = text;
    $status.className = 'status-box ' + type;
  }

  function clearResults() {
    if ($summary) {
      $summary.hidden = true;
      $summary.innerHTML = '';
    }
    if ($results) $results.innerHTML = '';
  }

  function clearRanking() {
    if ($ranking) {
      $ranking.hidden = true;
      $ranking.innerHTML = '';
    }
    $rankingButtons.forEach((btn) => btn.classList.remove('active'));
    lastRankingData = null;
    lastRankingMode = 'players';
  }

  function renderSuggestions(items = []) {
    lastSuggestions = items;
    if (!$datalist) return;
    $datalist.innerHTML = '';
    items.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.label || item.name || '';
      option.label = item.label || item.name || '';
      $datalist.appendChild(option);
    });
  }

  function renderTeamSuggestions(items = []) {
    lastTeamSuggestions = items;
    if (!$teamDatalist) return;
    $teamDatalist.innerHTML = '';
    items.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.name || '';
      option.label = item.label || item.name || '';
      $teamDatalist.appendChild(option);
    });
  }

  async function loadSuggestions() {
    const q = String($player?.value || '').trim();
    const category = String($category?.value || '').trim();
    if (q.length < 2 || !category) {
      renderSuggestions([]);
      return;
    }

    try {
      const data = await fetchJson(apiUrl('/api/cruces/player-query?category=' + encodeURIComponent(category) + '&q=' + encodeURIComponent(q) + '&edition=' + encodeURIComponent(currentSearchEdition) + '&suggest=1'));
      renderSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch (err) {
      console.error(err);
    }
  }

  function scheduleSuggestions() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadSuggestions, 250);
  }

  async function loadTeamSuggestions() {
    const q = String($team?.value || '').trim();
    const category = String($category?.value || '').trim();
    if (q.length < 2 || !category) {
      renderTeamSuggestions([]);
      return;
    }

    try {
      const data = await fetchJson(apiUrl('/api/cruces/team-query?category=' + encodeURIComponent(category) + '&q=' + encodeURIComponent(q) + '&edition=' + encodeURIComponent(getTeamEdition())));
      renderTeamSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch (err) {
      console.error(err);
    }
  }

  function scheduleTeamSuggestions() {
    clearTimeout(teamDebounceTimer);
    teamDebounceTimer = setTimeout(loadTeamSuggestions, 250);
  }


  function resultClass(result) {
    if (result === 'ganado') return 'win';
    if (result === 'perdido') return 'loss';
    return 'draw';
  }

  function renderSummary(data) {
    const player = data?.player || {};
    const matches = Array.isArray(data?.matches) ? data.matches : [];
    const ganados = player.wins !== undefined ? toNumber(player.wins) : matches.filter((item) => item.result === 'ganado').length;
    const perdidos = player.losses !== undefined ? toNumber(player.losses) : matches.filter((item) => item.result === 'perdido').length;
    const triangulosFavorTotal = player.triangulosFavor !== undefined
      ? toNumber(player.triangulosFavor)
      : matches.reduce((acc, item) => acc + (Number(item.triangulosFavor || 0) || 0), 0);
    const triangulosContraTotal = player.triangulosContra !== undefined
      ? toNumber(player.triangulosContra)
      : matches.reduce((acc, item) => acc + (Number(item.triangulosContra || 0) || 0), 0);
    const played = player.played !== undefined ? toNumber(player.played) : Number(data.total || matches.length || 0);
    const efectividad = player.effectiveness !== undefined
      ? round1(player.effectiveness)
      : (played > 0 ? Math.round((ganados / played) * 100) : 0);

    const radValue =
      data?.rad !== undefined && data?.rad !== null
        ? Number(data.rad || 0)
        : player?.rad !== undefined && player?.rad !== null
          ? Number(player.rad || 0)
          : calculateRad({
              played,
              wins: ganados,
              losses: perdidos,
              triangulosFavor: triangulosFavorTotal,
              triangulosContra: triangulosContraTotal,
              diff: triangulosFavorTotal - triangulosContraTotal,
              effectiveness: efectividad
            }, data?.radContext || null).rad;

    $summary.hidden = false;
    $summary.innerHTML = `
      <div class="summary-player">
        <h2 class="summary-title">${player.name || 'Jugador'}</h2>
        <p class="summary-meta">${player.teamName || ''} · Categoría ${(data.category || '').toUpperCase()} · ${data?.editionLabel || editionLabel(data?.edition || currentSearchEdition)}</p>
      </div>
      <div class="summary-stats">
        <div class="summary-count">
          <strong>${played}</strong>
          <span>partidos jugados</span>
        </div>
        <div class="summary-count summary-win">
          <strong>${ganados}</strong>
          <span>ganados</span>
        </div>
        <div class="summary-count summary-loss">
          <strong>${perdidos}</strong>
          <span>perdidos</span>
        </div>
        <div class="summary-count summary-tri-favor">
          <strong>${triangulosFavorTotal}</strong>
          <span>triángulos a favor</span>
        </div>
        <div class="summary-count summary-tri-contra">
          <strong>${triangulosContraTotal}</strong>
          <span>triángulos en contra</span>
        </div>
        <div class="summary-count summary-eff">
          <strong>${Number(efectividad || 0).toFixed(Number(efectividad || 0) % 1 ? 1 : 0)}%</strong>
          <span>efectividad</span>
        </div>
        <div class="summary-count summary-rad">
          <strong>${Number(radValue || 0).toFixed(1)}</strong>
          <span>RAD</span>
        </div>
      </div>
    `;
  }

  function renderMatchCard(item, { pair = false } = {}) {
    const cls = resultClass(item.result);
    const card = document.createElement('article');
    card.className = 'match-card ' + cls;

    const rivalText = pair
      ? `en pareja con ${item.companionName || 'Sin compañero'} vs ${(Array.isArray(item.opponentPairPlayers) ? item.opponentPairPlayers.filter(Boolean).join(' - ') : '') || 'Rivales'} · ${item.opponentName || ''}`
      : `vs ${item.opponentPlayerName || 'Rival'} · ${item.opponentName || ''}`;

    card.innerHTML = `
      <div class="match-head">
        <div>
          <h3 class="match-title">${item.teamName || ''}</h3>
          <p class="match-rival">${rivalText}</p>
          <span class="result-pill ${cls}">${item.result || ''}</span>
        </div>
        <time class="match-date">${formatDate(item.fechaISO)}</time>
      </div>
      <div class="match-stats">
        <div class="stat ${cls === 'win' ? 'win' : ''}">
          <span>Triángulos a favor</span>
          <strong>${Number(item.triangulosFavor || 0)}</strong>
        </div>
        <div class="stat ${cls === 'loss' ? 'loss' : ''}">
          <span>Triángulos en contra</span>
          <strong>${Number(item.triangulosContra || 0)}</strong>
        </div>
      </div>
    `;
    return card;
  }

  function renderMatches(matches = [], pairMatches = []) {
    $results.innerHTML = '';

    matches.forEach((item) => {
      $results.appendChild(renderMatchCard(item));
    });

    if (pairMatches.length) {
      const pairTitle = document.createElement('h2');
      pairTitle.className = 'matches-section-title';
      pairTitle.textContent = 'PARTIDOS EN PAREJA';
      $results.appendChild(pairTitle);

      pairMatches.forEach((item) => {
        $results.appendChild(renderMatchCard(item, { pair: true }));
      });
    }
  }

  function renderRanking(data, limit) {
    const rawItems = Array.isArray(data?.ranking) ? data.ranking : [];
    const items = rawItems.slice(0, limit);
    if (!$ranking) return;

    $ranking.hidden = false;
    if (!items.length) {
      $ranking.innerHTML = '<div class="ranking-empty">No hay datos suficientes para armar el ranking.</div>';
      return;
    }

    const rows = items.map((item, idx) => {
      const diff = Number(item.diff || 0);
      const diffClass = diff >= 0 ? 'ok' : 'bad';
      return `
        <tr>
          <td class="rank-pos">#${idx + 1}</td>
          <td class="player-name">${item.name || ''}</td>
          <td class="team-name">${item.teamName || ''}</td>
          <td class="num">${Number(item.played || 0)}</td>
          <td class="num rad-score" title="Rendimiento Ajustado Dinámico">${Number(item.rad || 0).toFixed(1)}</td>
          <td class="num">${Number(item.effectiveness || 0).toFixed(1)}%</td>
          <td class="num ok">${Number(item.wins || 0)}</td>
          <td class="num bad">${Number(item.losses || 0)}</td>
          <td class="num ${diffClass}">${diff > 0 ? '+' : ''}${diff}</td>
          <td class="num">${Number(item.triangulosFavor || 0)}</td>
          <td class="num">${Number(item.triangulosContra || 0)}</td>
        </tr>
      `;
    }).join('');

    $ranking.innerHTML = `
      <div class="ranking-head">
        <div>
          <h2 class="ranking-title">Ranking Top ${limit} · ${data?.editionLabel || editionLabel(currentRankingEdition)}</h2>
          <p class="ranking-meta">Ranking realizado sobre una base de ${Number(data?.totalRegisteredPlayers || 0)} jugadores registrados y ${Number(data?.totalActivePlayers || 0)} jugadores activos.</p>
        </div>
      </div>
      <div class="ranking-table-wrap">
        <table class="ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Jugador</th>
              <th>Equipo</th>
              <th class="num">PJ</th>
              <th class="num rad-head" title="Rendimiento Ajustado Dinámico">RAD</th>
              <th class="num">EFEC</th>
              <th class="num">PG</th>
              <th class="num">PP</th>
              <th class="num">DIF</th>
              <th class="num">TF</th>
              <th class="num">TC</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }


  function renderRankingSwitch() {
    if (!lastRankingData) return;
    if (lastRankingMode !== currentRankingTab) {
      loadRanking(lastRankingLimit);
      return;
    }
    if (currentRankingTab === 'teams') {
      renderTeamsRanking(lastRankingData, lastRankingLimit);
      return;
    }
    renderRanking(lastRankingData, lastRankingLimit);
  }

  function renderTeamsRanking(data, limit) {
    const items = Array.isArray(data?.ranking) ? data.ranking : [];
    if (!$ranking) return;

    $ranking.hidden = false;
    if (!items.length) {
      $ranking.innerHTML = '<div class="ranking-empty">No hay datos suficientes para armar el ranking por equipos.</div>';
      return;
    }

    const rows = items.map((team, idx) => {
      const diffP = Number(team.diffPuntos || 0);
      const diffT = Number(team.diffTriangulos || 0);

      return `
        <tr>
          <td class="rank-pos">#${idx + 1}</td>
          <td class="team-name team-main">${team.teamName}</td>
          <td class="num">${Number(team.played || 0)}</td>
          <td class="num ok">${Number(team.puntosFavor || 0)}</td>
          <td class="num bad">${Number(team.puntosContra || 0)}</td>
          <td class="num ${diffP >= 0 ? 'ok' : 'bad'}">${diffP > 0 ? '+' : ''}${diffP}</td>
          <td class="num">${Number(team.triangulosFavor || 0)}</td>
          <td class="num">${Number(team.triangulosContra || 0)}</td>
          <td class="num ${diffT >= 0 ? 'ok' : 'bad'}">${diffT > 0 ? '+' : ''}${diffT}</td>
        </tr>
      `;
    }).join('');

    $ranking.innerHTML = `
      <div class="ranking-head">
        <div>
          <h2 class="ranking-title">Ranking Equipos Top ${limit} · ${data?.editionLabel || editionLabel(currentRankingEdition)}</h2>
          <p class="ranking-meta">Ordenado por puntos a favor. Desempate: diferencia de puntos y diferencia de triángulos.</p>
        </div>
      </div>
      <div class="ranking-table-wrap">
        <table class="ranking-table team-ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Equipo</th>
              <th class="num">PJ</th>
              <th class="num">PF</th>
              <th class="num">PC</th>
              <th class="num">DIF-P</th>
              <th class="num">TF</th>
              <th class="num">TC</th>
              <th class="num">DIF-T</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }


  function renderTeamSearchResults(data) {
    const rawItems = Array.isArray(data?.players) ? data.players : [];
    const rawPairItems = Array.isArray(data?.pairPlayers) ? data.pairPlayers : [];
    const team = data?.team || {};
    const items = rawItems;
    if (!$ranking) return;

    $ranking.hidden = false;
    if (!items.length) {
      $ranking.innerHTML = '<div class="ranking-empty">No hay jugadores para mostrar en ese equipo.</div>';
      return;
    }

    const buildRows = (sourceItems, { showRad = false } = {}) => sourceItems.map((item, idx) => {
      const diff = Number(item.diff || 0);
      const diffClass = diff >= 0 ? 'ok' : 'bad';
      return `
        <tr>
          <td class="rank-pos">#${idx + 1}</td>
          <td class="player-name">${item.name || ''}</td>
          <td class="team-name">${item.teamName || team.name || ''}</td>
          <td class="num">${Number(item.played || 0)}</td>
          ${showRad ? `<td class="num rad-score" title="Rendimiento Ajustado Dinámico">${Number(item.rad || 0).toFixed(1)}</td>` : ''}
          <td class="num">${Number(item.effectiveness || 0).toFixed(1)}%</td>
          <td class="num ok">${Number(item.wins || 0)}</td>
          <td class="num bad">${Number(item.losses || 0)}</td>
          <td class="num ${diffClass}">${diff > 0 ? '+' : ''}${diff}</td>
          <td class="num">${Number(item.triangulosFavor || 0)}</td>
          <td class="num">${Number(item.triangulosContra || 0)}</td>
        </tr>
      `;
    }).join('');
    const rows = buildRows(items, { showRad: true });
    const pairRows = buildRows(rawPairItems);

    $ranking.innerHTML = `
      <div class="ranking-head">
        <div>
          <h2 class="ranking-title">Jugadores de ${team.name || 'equipo'} · ${data?.editionLabel || editionLabel(getTeamEdition())}</h2>
          <p class="ranking-meta">${Number(data?.totalActivePlayers || 0)} jugadores con partidos sobre ${Number(data?.totalTeamPlayers || data?.totalRegisteredPlayers || 0)} integrantes del historial del equipo.</p>
        </div>
      </div>
      <h3 class="team-stats-subtitle">Individuales</h3>
      <div class="ranking-table-wrap">
        <table class="ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Jugador</th>
              <th>Equipo</th>
              <th class="num">PJ</th>
              <th class="num rad-head" title="Rendimiento Ajustado Dinámico">RAD</th>
              <th class="num">EFEC</th>
              <th class="num">PG</th>
              <th class="num">PP</th>
              <th class="num">DIF</th>
              <th class="num">TF</th>
              <th class="num">TC</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="team-pair-section">
        <div class="ranking-head">
          <div>
            <h3 class="team-stats-subtitle">Parejas</h3>
            <p class="ranking-meta">${Number(data?.totalActivePairPlayers || 0)} jugadores disputaron partidos en pareja.</p>
          </div>
        </div>
        <div class="ranking-table-wrap">
          <table class="ranking-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Jugador</th>
                <th>Equipo</th>
                <th class="num">PJ</th>
                <th class="num">EFEC</th>
                <th class="num">PG</th>
                <th class="num">PP</th>
                <th class="num">DIF</th>
                <th class="num">TF</th>
                <th class="num">TC</th>
              </tr>
            </thead>
            <tbody>${pairRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  async function searchTeam() {
    clearResults();
    clearRanking();
    setStatus('Buscando equipo…', 'info');
    if (currentSearchEdition === 'total') setSearchEdition('6');

    const q = String($team?.value || '').trim();
    const category = String($category?.value || '').trim();

    if (!category || q.length < 2) {
      setStatus('Seleccioná una categoría y escribí al menos 2 letras del equipo.', 'error');
      return;
    }

    try {
      const data = await fetchJson(apiUrl('/api/cruces/team-query?category=' + encodeURIComponent(category) + '&q=' + encodeURIComponent(q) + '&edition=' + encodeURIComponent(getTeamEdition())));
      renderTeamSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : lastTeamSuggestions);

      if (!data?.team) {
        const count = Array.isArray(data?.suggestions) ? data.suggestions.length : 0;
        setStatus(count ? 'Elegí una coincidencia de equipo de la lista y volvé a buscar.' : 'No se encontraron equipos con esa búsqueda.', count ? 'info' : 'error');
        return;
      }

      try {
        data.radContext = data?.radContext || null;
      } catch (err) {
        console.warn('No se pudo obtener el contexto RAD de la categoría. Se usa el equipo como referencia.', err);
      }

      setStatus('', 'info');
      renderTeamSearchResults(data);
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'No se pudo consultar el equipo.', 'error');
    }
  }

  async function loadRanking(limit) {
    clearResults();
    setStatus('Armando ranking…', 'info');

    const category = String($category?.value || '').trim();
    if (!category) {
      setStatus('Seleccioná una categoría.', 'error');
      return;
    }

    $rankingButtons.forEach((btn) => {
      btn.classList.toggle('active', String(btn.dataset.rankingLimit || '') === String(limit));
    });

    try {
      const endpoint = currentRankingTab === 'teams' ? '/api/cruces/team-ranking' : '/api/cruces/player-ranking';
      const requestedLimit = Number(limit || 10);
      const fetchLimit = requestedLimit;
      const edition = currentRankingTab === 'teams' && currentRankingEdition === 'total' ? '6' : currentRankingEdition;
      const data = await fetchJson(apiUrl(withCacheBust(endpoint + '?category=' + encodeURIComponent(category) + '&limit=' + encodeURIComponent(fetchLimit) + '&edition=' + encodeURIComponent(edition))));

      setStatus('', 'info');
      lastRankingData = data;
      lastRankingLimit = limit;
      lastRankingMode = currentRankingTab;
      renderRankingSwitch();
    } catch (err) {
      console.error(err);
      clearRanking();
      setStatus(err?.message || 'No se pudo cargar el ranking.', 'error');
    }
  }

  async function searchPlayer(ev, retryingSuggestion = false) {
    ev?.preventDefault();

    clearResults();
    clearRanking();
    setStatus('Buscando jugador…', 'info');

    const q = String($player?.value || '').trim();
    const category = String($category?.value || '').trim();

    if (!category || q.length < 2) {
      setStatus('Seleccioná una categoría y escribí al menos 2 letras de un jugador o equipo.', 'error');
      return;
    }

    try {
      const data = await fetchJson(apiUrl('/api/cruces/player-query?category=' + encodeURIComponent(category) + '&q=' + encodeURIComponent(q) + '&edition=' + encodeURIComponent(currentSearchEdition)));
      renderSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : lastSuggestions);

      if (!data?.player) {
        const count = Array.isArray(data?.suggestions) ? data.suggestions.length : 0;
        if (!retryingSuggestion && count === 1 && data.suggestions[0]?.label) {
          $player.value = data.suggestions[0].label;
          await searchPlayer(null, true);
          return;
        }
        setStatus(count ? 'Elegí una coincidencia de la lista y volvé a buscar.' : 'No se encontraron jugadores con esa búsqueda.', count ? 'info' : 'error');
        return;
      }

      setStatus('', 'info');
      renderSummary(data);
      renderMatches(Array.isArray(data?.matches) ? data.matches : [], Array.isArray(data?.pairMatches) ? data.pairMatches : []);
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'No se pudo consultar el jugador.', 'error');
    }
  }

  $player?.addEventListener('input', () => {
    if (String($player.value || '').trim()) {
      if ($team) $team.value = '';
      renderTeamSuggestions([]);
    }
    scheduleSuggestions();
  });
  $team?.addEventListener('input', () => {
    if (String($team.value || '').trim()) {
      if ($player) $player.value = '';
      renderSuggestions([]);
      if (currentSearchEdition === 'total') setSearchEdition('6');
    }
    scheduleTeamSuggestions();
  });
  $category?.addEventListener('change', () => {
    renderSuggestions([]);
    renderTeamSuggestions([]);
    clearRanking();
    scheduleSuggestions();
    scheduleTeamSuggestions();
  });
  $rankingEdition?.addEventListener('change', () => {
    setSearchEdition($rankingEdition.value || 'total');
    clearRanking();
    clearResults();
    if (currentConsultMode === 'individual') scheduleSuggestions();
    else scheduleTeamSuggestions();
  });
  $rankingButtons.forEach((btn) => {
    btn.addEventListener('click', () => loadRanking(Number(btn.getAttribute('data-ranking-limit') || btn.dataset.rankingLimit || 10)));
  });
  $modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => setConsultMode(btn.dataset.consultMode || 'individual'));
  });
  $radInfo?.addEventListener('click', openRadModal);
  $radClose?.addEventListener('click', closeRadModal);
  $radModal?.addEventListener('click', (ev) => {
    if (ev.target === $radModal) closeRadModal();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeRadModal();
  });
  $form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (currentConsultMode === 'group') searchTeam();
    else searchPlayer();
  });
  setConsultMode('individual', { preserveEdition: false });

  async function applyLinkedPlayerSearch() {
    const params = new URLSearchParams(location.search);
    if (params.get('auto') !== '1') return;
    const category = String(params.get('category') || '').trim().toLowerCase();
    const player = String(params.get('player') || '').trim();
    if (!['segunda', 'tercera'].includes(category) || (category === 'segunda' && !hasAdminAccess) || player.length < 2) return;
    if ($category) $category.value = category;
    setConsultMode('individual');
    if ($player) $player.value = player;
    if ($team) $team.value = '';
    setSearchEdition(params.get('edition') || 'total');
    await searchPlayer(null);
  }

  async function initializeAccess() {
    hasAdminAccess = await enableAdminCategories();
    await applyLinkedPlayerSearch();
  }

  initializeAccess();
})();
