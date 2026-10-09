const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');

const $ = (selector) => document.querySelector(selector);
let croppedPlayerPhoto = null;
let editingOriginalName = '';
let editingOriginalCategory = '';
let editingOriginalDni = '';
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
function maxTeamPlayers(category){
  return category === 'segunda' ? 25 : 20;
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
  editingOriginalCategory = '';
  editingOriginalDni = '';
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
  editingOriginalCategory = player?.categoria || player?.categoriaActual || '';
  editingOriginalDni = player?.dni || '';
  $('#playerId').value = player?.id || '';
  $('#associationId').value = player?.associationId || '';
  $('#playerName').value = editingOriginalName;
  $('#playerName').readOnly = true;
  $('#playerDni').value = player?.dni || '';
  $('#playerBirth').value = player?.fechaNacimiento || player?.fecha_nacimiento || '';
  $('#playerCategory').value = player?.categoria || player?.categoriaActual || 'tercera';
  await refreshPlayerTeams(player?.teamSlug || player?.equipo || '');
  $('#playerPhoto').value = '';
  croppedPlayerPhoto = null;
  $('#photoPreview').src = photoSrc(player);
  setStatus(`Editando ${player?.nombre || player?.name || 'jugador'}`);
}

function categoryLabel(value, short = false){
  const labels = short
    ? { primera: '1ra', segunda: '2da', tercera: '3ra' }
    : { primera: 'Primera', segunda: 'Segunda', tercera: 'Tercera' };
  return labels[value] || value;
}

function categoryRank(value){
  return { tercera: 1, segunda: 2, primera: 3 }[value] || 0;
}

function chooseCategoryChangeMode(playerName, fromCategory, toCategory){
  const dialog = $('#categoryChangeDialog');
  const message = $('#categoryChangeMessage');
  if (!dialog || typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm('¿Deseás ascender al jugador y quitarlo de su categoría anterior?') ? 'ascend' : 'both');
  }

  message.textContent = `El jugador pertenece a la ${categoryLabel(fromCategory, true)} categoría. ¿Desea ascenderlo a ${categoryLabel(toCategory, true)} categoría o va a jugar en ambas?`;
  dialog.showModal();

  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(value);
    };
    $('#btnPromoteCategory').onclick = () => finish('ascend');
    $('#btnPlayBothCategories').onclick = () => finish('both');
    $('#btnCancelCategoryChange').onclick = () => finish(null);
    dialog.oncancel = event => {
      event.preventDefault();
      finish(null);
    };
  });
}

function chooseAssociationsToRemove(player, activeAssociations){
  const dialog = $('#removeAssociationsDialog');
  const message = $('#removeAssociationsMessage');
  const actions = $('#removeAssociationsActions');
  if (!dialog || !message || !actions || typeof dialog.showModal !== 'function') {
    const ok = window.confirm(`¿Quitar a ${player.nombre || player.name} de sus categorías activas?`);
    return Promise.resolve(ok ? activeAssociations.map(item => Number(item.id)) : []);
  }

  message.textContent = `${player.nombre || player.name} está activo en ${activeAssociations.map(item => categoryLabel(item.categoria)).join(' y ')}. ¿De qué categoría desea quitarlo?`;
  actions.innerHTML = '';

  return new Promise(resolve => {
    let settled = false;
    const finish = ids => {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(ids);
    };

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    cancel.onclick = () => finish([]);
    actions.appendChild(cancel);

    activeAssociations.forEach(item => {
      const button = document.createElement('button');
      button.className = 'btn';
      button.type = 'button';
      button.textContent = `Quitar de ${categoryLabel(item.categoria)}`;
      button.onclick = () => finish([Number(item.id)]);
      actions.appendChild(button);
    });

    if (activeAssociations.length > 1) {
      const all = document.createElement('button');
      all.className = 'btn btn-gold';
      all.type = 'button';
      all.textContent = 'Quitar de ambas';
      all.onclick = () => finish(activeAssociations.map(item => Number(item.id)));
      actions.appendChild(all);
    }

    dialog.oncancel = event => {
      event.preventDefault();
      finish([]);
    };
    dialog.showModal();
  });
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
        <p>${escapeHtml((player.categoriaActual || player.categoria || '').toUpperCase())} · ${escapeHtml(player.equipo || player.teamName || 'Sin equipo activo')}</p>
      </div>
      <div class="player-actions">
        <button class="btn btn-edit-player" type="button">Editar</button>
        <button class="btn btn-rename-player" type="button">Editar nombre</button>
        <button class="btn btn-history-player" type="button">Historial</button>
        ${player.associationId
          ? '<button class="btn btn-deactivate-player" type="button">Quitar</button>'
          : '<button class="btn btn-delete-player" type="button">Eliminar</button>'}
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
  const limit = maxTeamPlayers(category);
  if (!alreadyInTeam && players.length >= limit) {
    throw new Error(`Ese equipo ya tiene ${limit} jugadores activos. Quitá uno antes de agregar otro.`);
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
  if (!res.ok || data.ok === false) {
    const error = new Error(data.error || data.msg || `HTTP ${res.status}`);
    error.data = data;
    throw error;
  }
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

function selectedTeamContext(){
  const category = $('#teamCategory')?.value || '';
  const team = $('#teamSearch')?.value?.trim() || '';
  const teamName = $('#teamSearch')?.selectedOptions?.[0]?.textContent?.trim() || '';
  if (!team || team === UNASSIGNED_TEAM_VALUE) {
    throw new Error('Elegí un equipo antes de importar o exportar.');
  }
  return { category, team, teamName };
}

function csvCell(value){
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return /[",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function exportTeamPlayers(){
  try {
    const { category, team, teamName } = selectedTeamContext();
    const data = await fetchJson(`/api/players-admin/team-file?category=${encodeURIComponent(category)}&team=${encodeURIComponent(team)}`);
    const players = Array.isArray(data.players) ? data.players : [];
    const lines = players.map(player => [
      csvCell(String(player.nombre || player.name || '').replaceAll(',', ' ').replace(/\s+/g, ' ').trim()),
      csvCell(player.dni)
    ].join(', '));
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `jugadores-${slugify(teamName || team)}-${category}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Se exportaron ${players.length} jugadores`);
  } catch (err) {
    toast(err.message || 'No se pudo exportar el equipo');
  }
}

function parseDelimitedLine(line, delimiter){
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value){
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseTeamImport(text){
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('El archivo está vacío.');
  const split = line => parseDelimitedLine(line, ',');
  const first = split(lines[0]);
  const headers = first.map(normalizeHeader);
  const nameIndex = headers.findIndex(value => ['nombre', 'nombreyapellido', 'jugador'].includes(value));
  const dniIndex = headers.findIndex(value => value === 'dni' || value === 'documento');
  const hasHeader = nameIndex >= 0 && dniIndex >= 0;
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows = dataLines.map((line, index) => {
    const cells = split(line);
    const rowNumber = index + (hasHeader ? 2 : 1);
    if (hasHeader) {
      return {
        row: rowNumber,
        nombre: cells[nameIndex] || '',
        dni: cells[dniIndex] || ''
      };
    }
    if (cells.length === 2) return { row: rowNumber, nombre: cells[0], dni: cells[1] };
    return { row: rowNumber, nombre: '', dni: '' };
  });
  if (!rows.length) throw new Error('El archivo no contiene jugadores.');
  return rows;
}

async function importTeamFile(file){
  const { category, team, teamName } = selectedTeamContext();
  const rows = parseTeamImport(await file.text());
  if (!confirm(`Se procesarán ${rows.length} filas para ${teamName}.\n\nLos jugadores omitidos no serán eliminados. ¿Continuar?`)) return;
  const decisions = {};
  let data = await fetchJson('/api/players-admin/import-team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, team, rows })
  });
  while (data.requiresReview) {
    const reviewed = await reviewTeamImport(data.reviews || []);
    if (!reviewed) return;
    Object.assign(decisions, reviewed);
    data = await fetchJson('/api/players-admin/import-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, team, rows, decisions })
    });
  }
  toast(`Importación completa: ${data.created || 0} nuevos y ${data.updated || 0} actualizados`);
  await searchByTeam();
}

function reviewTeamImport(reviews){
  const dialog = $('#teamImportReviewDialog');
  const list = $('#teamImportReviewList');
  if (!dialog || !list || !reviews.length) return Promise.resolve({});
  list.innerHTML = reviews.map((review, index) => `
    <div class="import-review-item">
      <label for="importReview${index}"><small>${review.row ? `Fila ${escapeHtml(review.row)}` : 'Plantel actual'}</small><br>${escapeHtml(review.message)}</label>
      <select id="importReview${index}" class="input" data-review-id="${escapeHtml(review.id)}">
        <option value="">Elegir una opción</option>
        ${(review.options || []).map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}
      </select>
    </div>
  `).join('');

  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(value);
    };
    $('#btnCancelTeamImport').onclick = () => finish(null);
    $('#btnConfirmTeamImport').onclick = () => {
      const decisions = {};
      const selects = [...list.querySelectorAll('[data-review-id]')];
      const missing = selects.find(select => !select.value);
      if (missing) {
        missing.focus();
        toast('Elegí una opción para cada caso');
        return;
      }
      selects.forEach(select => { decisions[select.dataset.reviewId] = select.value; });
      finish(decisions);
    };
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      finish(null);
    }, { once:true });
    dialog.showModal();
  });
}

async function handleTeamImportChange(){
  const input = $('#teamImportFile');
  const file = input?.files?.[0];
  if (!file) return;
  try {
    await importTeamFile(file);
  } catch (err) {
    const conflicts = Array.isArray(err?.data?.conflicts) ? err.data.conflicts : [];
    const detail = conflicts.length
      ? `\n\n${conflicts.slice(0, 12).map(item => `Fila ${item.row}: ${item.message}`).join('\n')}`
      : '';
    alert(`${err.message || 'No se pudo importar el equipo'}${detail}`);
  } finally {
    input.value = '';
  }
}

async function splitCategoryIdentity({ playerId, category, dni, playerName }){
  const confirmed = confirm(
    `${playerName} tiene historial en más de una categoría.\n\n` +
    `¿Separar todo su historial de ${categoryLabel(category)} con el DNI ${dni}, conservando el registro anterior para las demás categorías?`
  );
  if (!confirmed) return null;
  return fetchJson('/api/players-admin/split-category-identity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, category, dni }),
  });
}

async function savePlayer(ev){
  ev?.preventDefault();
  const category = $('#playerCategory').value;
  const team = $('#playerTeam').value.trim();
  const associationId = $('#associationId').value;
  const playerId = $('#playerId').value;
  const playerName = $('#playerName').value.trim();
  const requestedDni = $('#playerDni').value.trim();
  let categoryChangeMode = '';

  if (playerId && slugify(playerName) !== slugify(editingOriginalName)) {
    setStatus('Para cargar otro jugador tocá Nuevo antes de guardar.', true);
    return;
  }

  if (playerId && editingOriginalDni && requestedDni && requestedDni !== editingOriginalDni) {
    try {
      const historyData = await fetchJson(`/api/players-admin/history/${encodeURIComponent(playerId)}`);
      const categories = new Set((historyData.history || []).map(item => item.categoria).filter(Boolean));
      if (categories.size > 1) {
        const splitData = await splitCategoryIdentity({ playerId, category, dni: requestedDni, playerName });
        if (!splitData) {
          setStatus('Separación cancelada. No se modificó nada.');
          return;
        }
        const splitPlayer = splitData.player || {};
        await fillForm(splitPlayer);
        renderPlayers(splitData.associations || (splitPlayer.id ? [splitPlayer] : []));
        toast('Jugador e historial separados correctamente');
        return;
      }
    } catch (err) {
      setStatus(err.message || 'No se pudo separar la identidad', true);
      return;
    }
  }

  if (associationId && editingOriginalCategory && category !== editingOriginalCategory) {
    if (categoryRank(category) < categoryRank(editingOriginalCategory)) {
      setStatus(`Un jugador de ${categoryLabel(editingOriginalCategory)} no puede jugar en ${categoryLabel(category)}.`, true);
      return;
    }
    if (!team) {
      setStatus('Elegí el equipo de la nueva categoría antes de guardar.', true);
      return;
    }
    categoryChangeMode = await chooseCategoryChangeMode(playerName, editingOriginalCategory, category);
    if (!categoryChangeMode) {
      setStatus('Cambio de categoría cancelado.');
      return;
    }
  }

  const form = new FormData();
  const photo = croppedPlayerPhoto || $('#playerPhoto').files?.[0];
  if (playerId) form.set('id', playerId);
  if (associationId) form.set('associationId', associationId);
  form.set('nombre', playerName);
  form.set('dni', requestedDni);
  form.set('fechaNacimiento', $('#playerBirth').value);
  form.set('categoria', category);
  form.set('team', team);
  if (categoryChangeMode) form.set('categoryChangeMode', categoryChangeMode);
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
  if (!player?.id) return;
  try {
    const data = await fetchJson(`/api/players-admin/history/${encodeURIComponent(player.id)}`);
    const activeAssociations = (data.history || []).filter(item => item.activo && item.id);
    if (!activeAssociations.length) {
      toast('El jugador no tiene categorías activas');
      return;
    }
    const associationIds = await chooseAssociationsToRemove(player, activeAssociations);
    if (!associationIds.length) return;
    await fetchJson('/api/players-admin/deactivate-associations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id, associationIds }),
    });
    toast(associationIds.length > 1 ? 'Categorías desactivadas' : 'Categoría desactivada');
    if (currentResultsMode === 'players') await searchPlayers();
    else await searchByTeam();
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
    if (currentResultsMode === 'players') await searchPlayers();
    else await searchByTeam();
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
$('#btnExportTeam')?.addEventListener('click', exportTeamPlayers);
$('#btnImportTeam')?.addEventListener('click', () => {
  try {
    selectedTeamContext();
    $('#teamImportFile')?.click();
  } catch (err) {
    toast(err.message || 'Elegí un equipo');
  }
});
$('#teamImportFile')?.addEventListener('change', handleTeamImportChange);

clearForm();
refreshSearchTeams();
renderPlayers([]);
