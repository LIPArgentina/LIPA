const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');

const $ = (selector) => document.querySelector(selector);
let croppedPlayerPhoto = null;
let editingOriginalName = '';
let currentResultsMode = 'players';
const UNASSIGNED_TEAM_VALUE = '__sin_equipo__';

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
const MAX_TEAM_PLAYERS = 20;

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
  const isSearchTeam = selector === '#teamSearch';
  select.innerHTML = isSearchTeam
    ? '<option value="__sin_equipo__">Buscar jugadores sin equipo</option>'
    : '<option value="">Seleccionar equipo</option>';

  try {
    const teams = await loadTeams(category);
    teams.forEach(team => {
      const option = document.createElement('option');
      option.value = team.slug;
      option.textContent = team.name;
      select.appendChild(option);
    });
    selectExistingOption(select, current || (isSearchTeam ? UNASSIGNED_TEAM_VALUE : ''));
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
  $('#playerName').readOnly = false;
  editingOriginalName = '';
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
  editingOriginalName = player?.nombre || player?.name || '';
  $('#playerId').value = player?.id || '';
  $('#associationId').value = player?.associationId || '';
  $('#playerName').value = editingOriginalName;
  $('#playerName').readOnly = true;
  $('#playerDni').value = player?.dni || '';
  $('#playerBirth').value = player?.fechaNacimiento || player?.fecha_nacimiento || '';
  $('#playerCategory').value = player?.categoria || 'tercera';
  await refreshPlayerTeams(player?.teamSlug || player?.equipo || '');
  $('#playerPhoto').value = '';
  croppedPlayerPhoto = null;
  $('#photoPreview').src = photoSrc(player);
  setStatus(`Editando ${player?.nombre || player?.name || 'jugador'}`);
}

function renderPlayers(players = [], { mode = currentResultsMode } = {}){
  const results = $('#results');
  if (!results) return;
  currentResultsMode = mode;

  if (!players.length) {
    results.innerHTML = '<p class="hint">No hay jugadores para mostrar.</p>';
    return;
  }

  results.innerHTML = players.map((player, idx) => `
    <article class="player-card" data-index="${idx}">
      <div class="player-card__number">${idx + 1}</div>
      <img src="${escapeHtml(photoSrc(player))}" alt="Foto de ${escapeHtml(player.nombre || player.name || 'jugador')}">
      <div>
        <h3>${escapeHtml(player.nombre || player.name || '')}</h3>
        <p>DNI ${escapeHtml(player.dni || '-')} · Nac. ${escapeHtml(player.fechaNacimiento || player.fecha_nacimiento || '-')}</p>
        <p>${escapeHtml((player.categoria || '').toUpperCase())} · ${escapeHtml(player.equipo || player.teamName || 'Sin equipo activo')}</p>
      </div>
      <div class="player-actions">
        <button class="btn btn-edit-player" type="button">Editar</button>
        <button class="btn btn-rename-player" type="button">Editar nombre</button>
        <button class="btn btn-history-player" type="button">Historial</button>
        ${mode === 'unassigned'
          ? '<button class="btn btn-delete-player" type="button">Eliminar</button>'
          : (player.associationId ? '<button class="btn btn-deactivate-player" type="button">Quitar</button>' : '')}
      </div>
    </article>
  `).join('');

  results.querySelectorAll('.player-card').forEach(card => {
    const player = players[Number(card.dataset.index)];
    card.querySelector('.btn-edit-player')?.addEventListener('click', () => fillForm(player));
    card.querySelector('.btn-rename-player')?.addEventListener('click', () => renamePlayer(player));
    card.querySelector('.btn-history-player')?.addEventListener('click', () => showHistory(player));
    card.querySelector('.btn-deactivate-player')?.addEventListener('click', () => deactivateAssociation(player));
    card.querySelector('.btn-delete-player')?.addEventListener('click', () => deletePlayer(player));
  });
}

async function ensureTeamHasRoom({ category, team, associationId, playerId }){
  if (!category || !team) return true;
  const data = await fetchJson(`/api/players-admin/by-team?category=${encodeURIComponent(category)}&team=${encodeURIComponent(team)}`);
  const players = data.players || [];
  const alreadyInTeam = players.some(player =>
    (associationId && String(player.associationId || '') === String(associationId)) ||
    (playerId && String(player.id || '') === String(playerId))
  );
  if (!alreadyInTeam && players.length >= MAX_TEAM_PLAYERS) {
    throw new Error(`Ese equipo ya tiene ${MAX_TEAM_PLAYERS} jugadores activos. Quitá uno antes de agregar otro.`);
  }
  return true;
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
    renderPlayers(data.players || [], { mode: 'players' });
  } catch (err) {
    renderPlayers([], { mode: 'players' });
    toast(err.message || 'No se pudo buscar');
  }
}

async function searchByTeam(ev){
  ev?.preventDefault();
  const category = $('#teamCategory').value;
  const team = $('#teamSearch').value.trim();
  if (team === UNASSIGNED_TEAM_VALUE) {
    try {
      const data = await fetchJson('/api/players-admin/unassigned');
      renderPlayers(data.players || [], { mode: 'unassigned' });
    } catch (err) {
      renderPlayers([], { mode: 'unassigned' });
      toast(err.message || 'No se pudo buscar jugadores sin equipo');
    }
    return;
  }
  if (!team) {
    toast('Elegí un equipo');
    return;
  }
  try {
    const data = await fetchJson(`/api/players-admin/by-team?category=${encodeURIComponent(category)}&team=${encodeURIComponent(team)}`);
    renderPlayers(data.players || [], { mode: 'team' });
  } catch (err) {
    renderPlayers([], { mode: 'team' });
    toast(err.message || 'No se pudo buscar el equipo');
  }
}

async function savePlayer(ev){
  ev?.preventDefault();
  const category = $('#playerCategory').value;
  const team = $('#playerTeam').value.trim();
  const associationId = $('#associationId').value;
  const playerId = $('#playerId').value;
  const playerName = $('#playerName').value.trim();

  if (playerId && slugify(playerName) !== slugify(editingOriginalName)) {
    setStatus('Para cargar otro jugador tocá Nuevo antes de guardar.', true);
    return;
  }

  const form = new FormData();
  const photo = croppedPlayerPhoto || $('#playerPhoto').files?.[0];
  if (playerId) form.set('id', playerId);
  if (associationId) form.set('associationId', associationId);
  form.set('nombre', playerName);
  form.set('dni', $('#playerDni').value.trim());
  form.set('fechaNacimiento', $('#playerBirth').value);
  form.set('categoria', category);
  form.set('team', team);
  if (photo) form.set('foto', photo);

  try {
    setStatus('Guardando...');
    await ensureTeamHasRoom({ category, team, associationId, playerId });
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

async function renamePlayer(player){
  if (!player?.id) return;
  const currentName = player.nombre || player.name || '';
  const newName = prompt('Corregir nombre del jugador:', currentName);
  if (newName === null) return;
  const cleanName = newName.trim();
  if (!cleanName) {
    toast('El nombre no puede estar vacío');
    return;
  }
  if (slugify(cleanName) === slugify(currentName)) return;

  try {
    const data = await fetchJson('/api/players-admin/rename-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id, nombre: cleanName }),
    });
    toast('Nombre actualizado');
    const updated = data.player || { ...player, nombre: cleanName, name: cleanName };
    await fillForm(updated);
    if (currentResultsMode === 'players') searchPlayers();
    else searchByTeam();
  } catch (err) {
    toast(err.message || 'No se pudo editar el nombre');
  }
}

async function deletePlayer(player){
  if (!player?.id) return;
  const name = player.nombre || player.name || 'este jugador';
  const ok = confirm(`¿Eliminar definitivamente a ${name} de la base de datos?\n\nEste cambio es irreversible y también se borrará su historial y su foto si existe.`);
  if (!ok) return;
  try {
    await fetchJson('/api/players-admin/delete-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id }),
    });
    toast('Jugador eliminado');
    clearForm();
    searchByTeam();
  } catch (err) {
    toast(err.message || 'No se pudo eliminar');
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
