(() => {
  'use strict';
  if (window.LPI_AUTH?.readSession?.()?.role !== 'torneo') {
    location.replace(`/auth/login.html?return=${encodeURIComponent(location.pathname)}`);
    return;
  }
  const API = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const states = [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  async function api(path, options = {}) {
    const response = await fetch(`${API}/api/torneo-organizador/sorteos${path}`, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo conectar con el servidor.'), { status: response.status });
    return data;
  }
  // Rejection sampling avoids modulo bias in Fisher-Yates.
  function randomIndex(max) {
    const limit = 4294967296 - (4294967296 % max);
    const sample = new Uint32Array(1);
    do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
    return sample[0] % max;
  }
  function shuffle(state) {
    const previous = state.players.map(player => player.id).join(',');
    do {
      for (let i = state.players.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1);
        [state.players[i], state.players[j]] = [state.players[j], state.players[i]];
      }
    } while (state.players.map(player => player.id).join(',') === previous);
    renderRows(state, true);
  }
  function fit(state) {
    const wrap = state.card.querySelector('.table-wrap');
    const rowHeight = Math.max(14, Math.min(28, Math.floor((wrap.clientHeight - 21) / Math.max(1, state.players.length))));
    state.card.style.setProperty('--row-height', `${rowHeight}px`);
    state.card.style.setProperty('--name-size', `${Math.max(11, Math.min(14, rowHeight - 2))}px`);
    state.body.querySelectorAll('.name').forEach(name => {
      name.style.transform = '';
      const available = name.clientWidth;
      if (available && name.scrollWidth > available) name.style.transform = `scaleX(${available / name.scrollWidth})`;
    });
  }
  function renderRows(state, animate = false) {
    state.body.replaceChildren();
    state.players.forEach((player, index) => {
      const row = document.createElement('tr');
      const position = document.createElement('td');
      position.textContent = index + 1;
      const cell = document.createElement('td');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = player.nombre;
      cell.append(name);
      row.append(position, cell);
      state.body.append(row);
      if (animate && !reducedMotion && cell.animate) cell.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 260 });
    });
    if (!state.players.length) {
      const row = state.body.insertRow();
      const cell = row.insertCell(); cell.colSpan = 2; cell.className = 'empty';
      cell.textContent = 'Sin jugadores confirmados en esta categoría.';
    }
    fit(state);
  }
  function message(state, text, type = '') {
    state.status.textContent = text; state.status.className = `status ${type}`;
  }
  async function save(state) {
    state.saving = true;
    state.button.disabled = true;
    state.button.textContent = 'GUARDANDO…';
    message(state, 'Guardando el orden del sorteo…');
    try {
      const data = await api(`/${state.category}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orden: state.players.map(player => String(player.id)), revision: state.revision, resetResults: state.resetResults === true })
      });
      state.revision = data.revision;
      state.dirty = false;
      state.drawn = true;
      state.hasResults = false;
      state.button.textContent = 'SORTEAR POSICIÓN';
      message(state, 'Orden guardado. Podés continuar a la grilla.', 'saved');
    } catch (error) {
      state.conflict = error.status === 409;
      state.button.textContent = state.conflict ? 'RECARGAR LISTAS' : 'REINTENTAR GUARDADO';
      message(state, error.message, 'error');
    } finally {
      state.saving = false;
      state.button.disabled = false;
    }
  }
  async function toggle(state) {
    if (state.saving) return;
    if (state.conflict) { location.reload(); return; }
    if (state.timer) {
      clearInterval(state.timer); state.timer = null;
      state.card.classList.remove('running');
      await save(state); return;
    }
    if (state.dirty) { await save(state); return; }
    if (state.drawn && !confirm(`Ya hay un sorteo de ${state.label}. Se va a repetir y el nuevo orden reemplazará al anterior al detenerlo.${state.hasResults ? ' ATENCIÓN: se borrarán todos los resultados de la grilla de esta categoría.' : ''} ¿Continuar?`)) return;
    state.resetResults = state.hasResults;
    state.dirty = true;
    state.card.classList.add('running');
    state.button.textContent = 'DETENER';
    message(state, 'Sorteando… Presioná DETENER para guardar el orden.');
    shuffle(state);
    state.timer = setInterval(() => shuffle(state), 500);
  }
  async function load() {
    const data = await api('');
    document.querySelector('#tournamentName').textContent = data.nombre;
    const missing = data.jugadores.filter(player => !player.categoria).length;
    document.querySelector('#pageMessage').textContent = missing
      ? `${missing} jugador(es) confirmado(s) sin categoría: asignala en Inscripciones para incluirlos.`
      : '';
    for (const [category, label] of [['primera', 'Primera'], ['segunda', 'Segunda'], ['tercera', 'Tercera']]) {
      let players = data.jugadores.filter(player => window.LipaCategories.includes(player.categoria, category));
      const saved = data.sorteos.find(draw => draw.categoria === category);
      const byId = new Map(players.map(player => [String(player.id), player]));
      const order = Array.isArray(saved?.orden) ? saved.orden.map(String) : [];
      const valid = Boolean(saved) && order.length === players.length && new Set(order).size === players.length && order.every(id => byId.has(id));
      if (valid) players = order.map(id => byId.get(id));
      const card = document.createElement('section');
      card.className = 'category'; card.setAttribute('aria-labelledby', `heading-${category}`);
      card.innerHTML = `<div class="category-heading"><h2 id="heading-${category}">${label.toUpperCase()}</h2><span class="count">${players.length} jugadores</span></div><div class="table-wrap"><table aria-label="Posiciones de ${label}"><thead><tr><th scope="col">N.º</th><th scope="col">Jugador</th></tr></thead><tbody></tbody></table></div><div class="category-footer"><p class="status" role="status"></p><button type="button" class="draw-button" aria-describedby="status-${category}">SORTEAR POSICIÓN</button></div>`;
      document.querySelector('#categories').append(card);
      const state = { category, label, players, card, body: card.querySelector('tbody'), status: card.querySelector('.status'), button: card.querySelector('button'), revision: saved?.revision || 0, drawn: Boolean(saved), dirty: false, timer: null, saving: false };
      state.status.id = `status-${category}`;
      state.hasResults = Boolean(saved?.tiene_resultados);
      state.button.disabled = players.length < 2;
      message(state, saved ? (valid ? 'Orden guardado recuperado.' : 'Cambiaron los participantes. Repetí el sorteo.') : 'Listo para sortear.', saved ? (valid ? 'saved' : 'error') : '');
      if (players.length < 2) message(state, 'Se necesitan al menos dos jugadores para sortear.');
      state.button.addEventListener('click', () => toggle(state));
      states.push(state);
      renderRows(state);
      new ResizeObserver(() => fit(state)).observe(card.querySelector('.table-wrap'));
    }
    document.fonts?.ready.then(() => states.forEach(fit));
  }
  window.addEventListener('beforeunload', event => {
    if (states.some(state => state.dirty || state.saving)) { event.preventDefault(); event.returnValue = ''; }
  });
  load().catch(error => { document.querySelector('#pageMessage').textContent = error.message; });
})();
