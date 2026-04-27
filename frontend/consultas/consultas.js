(() => {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const dtf = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' });

  const $form = document.getElementById('consultaForm');
  const $category = document.getElementById('categorySelect');
  const $player = document.getElementById('playerInput');
  const $datalist = document.getElementById('playerSuggestions');
  const $status = document.getElementById('statusBox');
  const $summary = document.getElementById('summaryBox');
  const $results = document.getElementById('resultsBox');
  const $ranking = document.getElementById('rankingBox');
  const $rankingButtons = Array.from(document.querySelectorAll('[data-ranking-limit]'));

  let debounceTimer = null;
  let lastSuggestions = [];

  function apiUrl(path) {
    return API_BASE + path;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      throw new Error(data?.error || data?.message || 'No se pudo consultar.');
    }
    return data;
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
  }

  function renderSuggestions(items = []) {
    lastSuggestions = items;
    if (!$datalist) return;
    $datalist.innerHTML = '';
    items.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.name || '';
      option.label = item.label || item.name || '';
      $datalist.appendChild(option);
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
      const data = await fetchJson(apiUrl('/api/cruces/player-query?category=' + encodeURIComponent(category) + '&q=' + encodeURIComponent(q)));
      renderSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch (err) {
      console.error(err);
    }
  }

  function scheduleSuggestions() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadSuggestions, 250);
  }

  function resultClass(result) {
    if (result === 'ganado') return 'win';
    if (result === 'perdido') return 'loss';
    return 'draw';
  }

  function renderSummary(data) {
    const player = data?.player || {};
    const matches = Array.isArray(data?.matches) ? data.matches : [];
    const ganados = matches.filter((item) => item.result === 'ganado').length;
    const perdidos = matches.filter((item) => item.result === 'perdido').length;
    const triangulosFavorTotal = matches.reduce((acc, item) => acc + (Number(item.triangulosFavor || 0) || 0), 0);
    const triangulosContraTotal = matches.reduce((acc, item) => acc + (Number(item.triangulosContra || 0) || 0), 0);
    const efectividad = Number(data.total || 0) > 0 ? Math.round((ganados / Number(data.total || 0)) * 100) : 0;

    $summary.hidden = false;
    $summary.innerHTML = `
      <div>
        <h2 class="summary-title">${player.name || 'Jugador'}</h2>
        <p class="summary-meta">${player.teamName || ''} · Categoría ${(data.category || '').toUpperCase()}</p>
      </div>
      <div class="summary-stats">
        <div class="summary-count">
          <strong>${Number(data.total || 0)}</strong>
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
          <strong>${efectividad}%</strong>
          <span>efectividad</span>
        </div>
      </div>
    `;
  }

  function renderMatches(matches = []) {
    $results.innerHTML = '';
    matches.forEach((item) => {
      const cls = resultClass(item.result);
      const card = document.createElement('article');
      card.className = 'match-card ' + cls;
      card.innerHTML = `
        <div class="match-head">
          <div>
            <h3 class="match-title">${item.teamName || ''}</h3>
            <p class="match-rival">vs ${item.opponentPlayerName || 'Rival'} · ${item.opponentName || ''}</p>
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
      $results.appendChild(card);
    });
  }

  function renderRanking(data, limit) {
    const items = Array.isArray(data?.ranking) ? data.ranking : [];
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
          <td class="num ok">${Number(item.wins || 0)}</td>
          <td class="num bad">${Number(item.losses || 0)}</td>
          <td class="num">${Number(item.triangulosFavor || 0)}</td>
          <td class="num">${Number(item.triangulosContra || 0)}</td>
          <td class="num ${diffClass}">${diff > 0 ? '+' : ''}${diff}</td>
          <td class="num">${Number(item.effectiveness || 0)}%</td>
        </tr>
      `;
    }).join('');

    $ranking.innerHTML = `
      <div class="ranking-head">
        <div>
          <h2 class="ranking-title">Ranking Top ${limit}</h2>
          <p class="ranking-meta">Ordenado por partidos ganados. Desempate: diferencia de triángulos.</p>
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
              <th class="num">PG</th>
              <th class="num">PP</th>
              <th class="num">TF</th>
              <th class="num">TC</th>
              <th class="num">DIF</th>
              <th class="num">EFEC</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
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
      const data = await fetchJson(apiUrl('/api/cruces/player-ranking?category=' + encodeURIComponent(category) + '&limit=' + encodeURIComponent(limit)));
      setStatus('', 'info');
      renderRanking(data, limit);
    } catch (err) {
      console.error(err);
      clearRanking();
      setStatus(err?.message || 'No se pudo cargar el ranking.', 'error');
    }
  }

  async function searchPlayer(ev) {
    ev?.preventDefault();
    clearResults();
    clearRanking();
    setStatus('Buscando jugador…', 'info');

    const q = String($player?.value || '').trim();
    const category = String($category?.value || '').trim();

    if (!category || q.length < 2) {
      setStatus('Seleccioná una categoría y escribí al menos 2 letras.', 'error');
      return;
    }

    try {
      const data = await fetchJson(apiUrl('/api/cruces/player-query?category=' + encodeURIComponent(category) + '&q=' + encodeURIComponent(q)));
      renderSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : lastSuggestions);

      if (!data?.player) {
        const count = Array.isArray(data?.suggestions) ? data.suggestions.length : 0;
        setStatus(count ? 'Elegí una coincidencia de la lista y volvé a buscar.' : 'No se encontraron jugadores con esa búsqueda.', count ? 'info' : 'error');
        return;
      }

      setStatus('', 'info');
      renderSummary(data);
      renderMatches(Array.isArray(data?.matches) ? data.matches : []);
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'No se pudo consultar el jugador.', 'error');
    }
  }

  $player?.addEventListener('input', scheduleSuggestions);
  $category?.addEventListener('change', () => {
    renderSuggestions([]);
    clearRanking();
    scheduleSuggestions();
  });
  $rankingButtons.forEach((btn) => {
    btn.addEventListener('click', () => loadRanking(Number(btn.dataset.rankingLimit || 10)));
  });
  $form?.addEventListener('submit', searchPlayer);
})();
