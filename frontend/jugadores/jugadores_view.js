const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');

const $ = (selector) => document.querySelector(selector);

let currentPlayers = [];
const teamsCache = new Map();

function readSession(){
  for (const key of ['lpi.session', 'lpi_team_session']) {
    try {
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (!raw) continue;
      const sess = JSON.parse(raw);
      if (sess?.token) return sess;
    } catch {}
  }
  return null;
}

function authHeaders(extra = {}){
  const sess = readSession();
  return sess?.token ? { ...extra, Authorization: `Bearer ${sess.token}` } : extra;
}

function apiUrl(path){
  return `${API_BASE}${path}`;
}

function escapeHtml(value){
  return String(value || '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function slugify(value){
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function photoSrc(player){
  return player?.fotoUrl ? apiUrl(player.fotoUrl) : '../logo_liga.png';
}

function showDate(value){
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const [year, month, day] = raw.split('-');
  return `${day}/${month}/${year}`;
}

function toast(msg){
  const node = $('#toast');
  if (!node) return;
  node.textContent = msg;
  node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 1800);
}

function setStatus(message, isError = false){
  const node = $('#formStatus');
  if (!node) return;
  node.textContent = message || '';
  node.style.color = isError ? '#ff6b6b' : '#f6d66b';
}

async function fetchJson(path, options = {}){
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    ...options,
    headers: authHeaders({ ...(options.headers || {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || data.msg || `HTTP ${res.status}`);
  return data;
}

async function loadTeams(category){
  if (teamsCache.has(category)) return teamsCache.get(category);
  const data = await fetchJson(`/api/teams?division=${encodeURIComponent(category)}`);
  const teams = (data.teams || data.equipos || [])
    .map(team => {
      const name = team.username || team.nombre || team.name || team.equipo || '';
      const slug = team.slug || team.slug_uid || team.slug_base || slugify(name);
      return { name, slug };
    })
    .filter(team => team.name && team.slug);

  teamsCache.set(category, teams);
  return teams;
}

async function refreshSearchTeams(selected = ''){
  const select = $('#teamSearch');
  if (!select) return;
  const category = $('#teamCategory')?.value || 'tercera';
  const current = selected || select.value;
  select.innerHTML = '<option value="">Seleccionar equipo</option>';

  try {
    const teams = await loadTeams(category);
    teams.forEach(team => {
      const option = document.createElement('option');
      option.value = team.slug;
      option.textContent = team.name;
      select.appendChild(option);
    });

    if (current) {
      const normalized = slugify(current);
      const match = Array.from(select.options).find(option =>
        option.value === current ||
        option.value === normalized ||
        slugify(option.textContent) === normalized
      );
      select.value = match?.value || '';
    }
  } catch (err) {
    select.innerHTML = '<option value="">No se pudieron cargar equipos</option>';
    toast(err.message || 'No se pudieron cargar equipos');
  }
}

function clearFicha(){
  $('#photoPreview').src = '../logo_liga.png';
  $('#playerName').value = '';
  $('#playerDni').value = '';
  $('#playerBirth').value = '';
  $('#playerCategory').value = '';
  $('#playerTeam').value = '';
  setStatus('Seleccioná un jugador para ver su ficha.');
}

function fillFicha(player){
  $('#photoPreview').src = photoSrc(player);
  $('#playerName').value = player?.nombre || player?.name || '';
  $('#playerDni').value = player?.dni || '';
  $('#playerBirth').value = showDate(player?.fechaNacimiento || player?.fecha_nacimiento || '');
  $('#playerCategory').value = (player?.categoria || '').toUpperCase();
  $('#playerTeam').value = player?.equipo || player?.teamName || '';
  setStatus(`Viendo ficha de ${player?.nombre || player?.name || 'jugador'}.`);
}

function renderPlayers(players = []){
  const results = $('#results');
  if (!results) return;
  currentPlayers = players;

  if (!players.length) {
    results.innerHTML = '<p class="hint">No hay jugadores para mostrar.</p>';
    clearFicha();
    return;
  }

  results.innerHTML = players.map((player, idx) => `
    <article class="player-card" data-index="${idx}" tabindex="0">
      <img src="${escapeHtml(photoSrc(player))}" alt="Foto de ${escapeHtml(player.nombre || player.name || 'jugador')}">
      <div>
        <h3>${escapeHtml(player.nombre || player.name || '')}</h3>
        <p>DNI ${escapeHtml(player.dni || '-')} · Nac. ${escapeHtml(showDate(player.fechaNacimiento || player.fecha_nacimiento) || '-')}</p>
        <p>${escapeHtml((player.categoria || '').toUpperCase())} · ${escapeHtml(player.equipo || player.teamName || 'Sin equipo activo')}</p>
      </div>
      <div class="player-actions">
        <button class="btn btn-history-player" type="button">Historial</button>
      </div>
    </article>
  `).join('');

  results.querySelectorAll('.player-card').forEach(card => {
    const player = players[Number(card.dataset.index)];
    const select = () => {
      results.querySelectorAll('.player-card').forEach(item => item.classList.remove('is-selected'));
      card.classList.add('is-selected');
      fillFicha(player);
    };
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('.btn-history-player')) return;
      select();
    });
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        select();
      }
    });
    card.querySelector('.btn-history-player')?.addEventListener('click', () => showHistory(player));
  });

  fillFicha(players[0]);
  results.querySelector('.player-card')?.classList.add('is-selected');
}

async function searchPlayers(ev){
  ev?.preventDefault();
  const q = $('#playerSearch').value.trim();
  if (q.length < 2) {
    toast('Ingresá al menos 2 caracteres');
    return;
  }
  try {
    const data = await fetchJson(`/api/players-public/search?q=${encodeURIComponent(q)}`);
    renderPlayers(data.players || []);
  } catch (err) {
    renderPlayers([]);
    toast(err.message || 'No se pudo buscar');
  }
}

async function searchByTeam(ev){
  ev?.preventDefault();
  const category = $('#teamCategory').value;
  const team = $('#teamSearch').value.trim();
  if (!team) {
    toast('Elegí un equipo');
    return;
  }
  try {
    const data = await fetchJson(`/api/players-public/by-team?category=${encodeURIComponent(category)}&team=${encodeURIComponent(team)}`);
    renderPlayers(data.players || []);
  } catch (err) {
    renderPlayers([]);
    toast(err.message || 'No se pudo buscar el equipo');
  }
}

async function showHistory(player){
  const dialog = $('#historyDialog');
  const body = $('#historyBody');
  if (!dialog || !body || !player?.id) return;
  try {
    const data = await fetchJson(`/api/players-public/history/${encodeURIComponent(player.id)}`);
    const history = data.history || [];
    body.innerHTML = history.length ? `
      <table class="history-table">
        <thead>
          <tr>
            <th>Equipo</th>
            <th>Categoría</th>
            <th>Desde</th>
            <th>Hasta</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${history.map(item => `
            <tr>
              <td>${escapeHtml(item.equipo || '')}</td>
              <td>${escapeHtml((item.categoria || '').toUpperCase())}</td>
              <td>${escapeHtml(showDate(item.desde) || '-')}</td>
              <td>${escapeHtml(showDate(item.hasta) || '-')}</td>
              <td>${item.activo ? 'Activo' : 'Histórico'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p class="hint">Sin historial para mostrar.</p>';
    dialog.showModal();
  } catch (err) {
    toast(err.message || 'No se pudo cargar el historial');
  }
}

$('#playerSearchForm')?.addEventListener('submit', searchPlayers);
$('#teamSearchForm')?.addEventListener('submit', searchByTeam);
$('#teamCategory')?.addEventListener('change', () => refreshSearchTeams());
$('#btnCloseHistory')?.addEventListener('click', () => $('#historyDialog')?.close());

refreshSearchTeams();
clearFicha();
renderPlayers([]);
