const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');

const $ = (selector) => document.querySelector(selector);
let croppedPlayerPhoto = null;

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

function toast(msg){
  const node = $('#toast');
  if (!node) return;
  node.textContent = msg;
  node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 1800);
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

function apiUrl(path){
  return `${API_BASE}${path}`;
}

function photoSrc(player){
  return player?.fotoUrl ? apiUrl(player.fotoUrl) : '../logo_liga.png';
}

function setStatus(message, isError = false){
  const node = $('#formStatus');
  if (!node) return;
  node.textContent = message || '';
  node.style.color = isError ? '#ff6b6b' : '#f6d66b';
}

const teamsCache = new Map();

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

function selectExistingOption(select, selected){
  const value = String(selected || '').trim();
  if (!value) {
    select.value = '';
    return;
  }

  const normalized = slugify(value);
  const match = Array.from(select.options).find(option =>
    option.value === value ||
    option.value === normalized ||
    slugify(option.textContent) === normalized
  );
  select.value = match?.value || '';
}

async function fillTeamDropdown(selector, category, selected = ''){
  const select = $(selector);
  if (!select) return;
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
    selectExistingOption(select, current);
  } catch (err) {
    select.innerHTML = '<option value="">No se pudieron cargar equipos</option>';
    toast(err.message || 'No se pudieron cargar equipos');
  }
}

async function refreshPlayerTeams(selected = ''){
  await fillTeamDropdown('#playerTeam', $('#playerCategory')?.value || 'tercera', selected);
}

async function refreshSearchTeams(selected = ''){
  await fillTeamDropdown('#teamSearch', $('#teamCategory')?.value || 'tercera', selected);
}

function clearForm(){
  $('#playerId').value = '';
  $('#associationId').value = '';
  $('#playerName').value = '';
  $('#playerDni').value = '';
  $('#playerBirth').value = '';
  $('#playerPhoto').value = '';
  croppedPlayerPhoto = null;
  $('#playerCategory').value = 'tercera';
  refreshPlayerTeams();
  $('#photoPreview').src = '../logo_liga.png';
  setStatus('');
}

async function fillForm(player){
  $('#playerId').value = player?.id || '';
  $('#associationId').value = player?.associationId || '';
  $('#playerName').value = player?.nombre || player?.name || '';
  $('#playerDni').value = player?.dni || '';
  $('#playerBirth').value = player?.fechaNacimiento || player?.fecha_nacimiento || '';
  $('#playerCategory').value = player?.categoria || 'tercera';
  await refreshPlayerTeams(player?.teamSlug || player?.equipo || '');
  $('#playerPhoto').value = '';
  croppedPlayerPhoto = null;
  $('#photoPreview').src = photoSrc(player);
  setStatus(`Editando ${player?.nombre || player?.name || 'jugador'}`);
}

function renderPlayers(players = []){
  const results = $('#results');
  if (!results) return;

  if (!players.length) {
    results.innerHTML = '<p class="hint">No hay jugadores para mostrar.</p>';
    return;
  }

  results.innerHTML = players.map((player, idx) => `
    <article class="player-card" data-index="${idx}">
      <img src="${escapeHtml(photoSrc(player))}" alt="Foto de ${escapeHtml(player.nombre || player.name || 'jugador')}">
      <div>
        <h3>${escapeHtml(player.nombre || player.name || '')}</h3>
        <p>DNI ${escapeHtml(player.dni || '-')} · Nac. ${escapeHtml(player.fechaNacimiento || player.fecha_nacimiento || '-')}</p>
        <p>${escapeHtml((player.categoria || '').toUpperCase())} · ${escapeHtml(player.equipo || player.teamName || 'Sin equipo activo')}</p>
      </div>
      <div class="player-actions">
        <button class="btn btn-edit-player" type="button">Editar</button>
        <button class="btn btn-history-player" type="button">Historial</button>
        ${player.associationId ? '<button class="btn btn-deactivate-player" type="button">Quitar</button>' : ''}
      </div>
    </article>
  `).join('');

  results.querySelectorAll('.player-card').forEach(card => {
    const player = players[Number(card.dataset.index)];
    card.querySelector('.btn-edit-player')?.addEventListener('click', () => fillForm(player));
    card.querySelector('.btn-history-player')?.addEventListener('click', () => showHistory(player));
    card.querySelector('.btn-deactivate-player')?.addEventListener('click', () => deactivateAssociation(player));
  });
}

async function fetchJson(path, options = {}){
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    ...options,
    headers: options.body instanceof FormData
      ? authHeaders(options.headers || {})
      : authHeaders({ ...(options.headers || {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || data.msg || `HTTP ${res.status}`);
  return data;
}

async function searchPlayers(ev){
  ev?.preventDefault();
  const q = $('#playerSearch').value.trim();
  if (q.length < 2) {
    toast('Ingresá al menos 2 caracteres');
    return;
  }
  try {
    const data = await fetchJson(`/api/players-admin/search?q=${encodeURIComponent(q)}`);
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
    const data = await fetchJson(`/api/players-admin/by-team?category=${encodeURIComponent(category)}&team=${encodeURIComponent(team)}`);
    renderPlayers(data.players || []);
  } catch (err) {
    renderPlayers([]);
    toast(err.message || 'No se pudo buscar el equipo');
  }
}

async function savePlayer(ev){
  ev?.preventDefault();
  const form = new FormData();
  const photo = croppedPlayerPhoto || $('#playerPhoto').files?.[0];
  if ($('#playerId').value) form.set('id', $('#playerId').value);
  if ($('#associationId').value) form.set('associationId', $('#associationId').value);
  form.set('nombre', $('#playerName').value.trim());
  form.set('dni', $('#playerDni').value.trim());
  form.set('fechaNacimiento', $('#playerBirth').value);
  form.set('categoria', $('#playerCategory').value);
  form.set('team', $('#playerTeam').value.trim());
  if (photo) form.set('foto', photo);

  try {
    setStatus('Guardando...');
    const data = await fetchJson('/api/players-admin/save', {
      method: 'POST',
      body: form,
    });
    const player = data.player || {};
    await fillForm(player);
    renderPlayers(data.associations || (player.id ? [player] : []));
    toast('Jugador guardado');
  } catch (err) {
    setStatus(err.message || 'No se pudo guardar', true);
  }
}

async function deactivateAssociation(player){
  if (!player?.associationId) return;
  const ok = confirm(`¿Quitar a ${player.nombre || player.name} de ${player.equipo || 'este equipo'}?`);
  if (!ok) return;
  try {
    await fetchJson('/api/players-admin/deactivate-association', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ associationId: player.associationId }),
    });
    toast('Asociación desactivada');
    searchByTeam();
  } catch (err) {
    toast(err.message || 'No se pudo quitar');
  }
}

async function showHistory(player){
  const dialog = $('#historyDialog');
  const body = $('#historyBody');
  if (!dialog || !body || !player?.id) return;
  try {
    const data = await fetchJson(`/api/players-admin/history/${encodeURIComponent(player.id)}`);
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
              <td>${escapeHtml(item.desde || '-')}</td>
              <td>${escapeHtml(item.hasta || '-')}</td>
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

$('#playerPhoto')?.addEventListener('change', async () => {
  const input = $('#playerPhoto');
  const file = input?.files?.[0];
  if (!file) return;
  try {
    const cropped = window.LipaPhotoCropper
      ? await window.LipaPhotoCropper.pick(file, { outputName: $('#playerName')?.value || file.name })
      : file;
    if (!cropped) {
      input.value = '';
      return;
    }
    croppedPlayerPhoto = cropped;
    $('#photoPreview').src = URL.createObjectURL(cropped);
  } catch (err) {
    input.value = '';
    croppedPlayerPhoto = null;
    toast(err.message || 'No se pudo ajustar la foto');
  }
});

$('#playerSearchForm')?.addEventListener('submit', searchPlayers);
$('#teamSearchForm')?.addEventListener('submit', searchByTeam);
$('#playerForm')?.addEventListener('submit', savePlayer);
$('#btnClearForm')?.addEventListener('click', clearForm);
$('#btnCloseHistory')?.addEventListener('click', () => $('#historyDialog')?.close());
$('#playerCategory')?.addEventListener('change', () => refreshPlayerTeams());
$('#teamCategory')?.addEventListener('change', () => refreshSearchTeams());

clearForm();
refreshSearchTeams();
renderPlayers([]);
