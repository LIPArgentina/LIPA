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

  async function searchPlayer(ev) {
    ev?.preventDefault();
    clearResults();
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
    scheduleSuggestions();
  });
  $form?.addEventListener('submit', searchPlayer);
})();
