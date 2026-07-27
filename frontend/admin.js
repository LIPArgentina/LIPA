
(function(){
  try{
    const params = new URLSearchParams(location.search);
    const isAdmin = params.get('admin') === '1' || params.get('mode') === 'admin';
    const withMode = (url) => {
      if(!isAdmin) return url;
      const u = new URL(url, location.origin);
      u.searchParams.set('admin','1');
      return u.pathname + u.search;
    };
    [
      ['btnJugadoresAdmin', 'jugadores/jugadores_admin.html'],
      ['btnFixture', 'fixture/fixture.html'],
      ['btnLlaves', 'llaves/llaves.html'],
      ['btnCrucesManual', 'cruces/cruces_manuales.html'],
      ['btnFecha', 'fecha/visor_planillas.html'],
      ['btnPictures', 'pictures/pictures_admin.html'],
      ['btnCargaManualTorneo', 'torneos/carga_manual_torneo.html'],
      ['btnVideosAdmin', 'videos/videos_admin.html'],
      ['btnCrucesView', 'cruces/cruces_fecha_view.html'],
    ].forEach(([id, fallback]) => {
      const btn = document.getElementById(id);
      if (btn) btn.href = withMode(btn.getAttribute('href') || fallback);
    });
  }catch(e){ console.warn('Nav admin patch:', e); }
})();


const DIVISIONES = ['primera', 'segunda', 'tercera'];
const ADMIN_TABS = ['primera', 'segunda', 'tercera', 'salas'];
const SALAS_SLOTS = 30;
const SLOTS = 20;
const LS_KEY = 'lpi_admin_roster_v1';
const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');

function readAppSession(){
  for (const key of ['lpi.session', 'lpi_team_session']) {
    try {
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (!raw) continue;
      const sess = JSON.parse(raw);
      if (sess && sess.token) return sess;
    } catch {}
  }
  return null;
}
function authHeaders(extra = {}){
  const sess = readAppSession();
  return sess?.token ? { ...extra, Authorization: `Bearer ${sess.token}` } : extra;
}


const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
function toast(msg){ const t=$('#toast'); if(!t) return; t.textContent=msg; t.classList.add('show'); setTimeout(()=> t.classList.remove('show'), 1800); }
function escapeHtml(value){
  return String(value || '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
function normalizeLocation(p){ return String(p||'').trim(); }
function slugify(s){
  return String(s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]/g,'');
}
function readLS(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'{}'); }catch{ return {}; } }
function writeLS(obj){ try{ localStorage.setItem(LS_KEY, JSON.stringify(obj||{})); }catch{} }
function getDraftKey(div, team){ return div + '/' + team; }
function getDraft(div, team){
  const s = readLS();
  const draft = s.drafts?.[getDraftKey(div, team)];
  return Array.isArray(draft) ? draft.slice(0, SLOTS) : Array(SLOTS).fill('');
}
function hasDraft(div, team){
  const s = readLS();
  const draft = s.drafts?.[getDraftKey(div, team)];
  return Array.isArray(draft) && draft.some(v => (v || '').trim() !== '');
}
function setDraft(div, team, arr){
  const s = readLS();
  s.drafts = s.drafts || {};
  s.drafts[getDraftKey(div, team)] = (arr || []).slice(0, SLOTS);
  writeLS(s);
}
function clearDraft(div, team){
  const s = readLS();
  if (s.drafts) {
    delete s.drafts[getDraftKey(div, team)];
  }
  writeLS(s);
}
function setLast(div,team){ const s=readLS(); s.division=div; s.team=team; writeLS(s); }
function getLast(){ const s=readLS(); return { division: s.division||'primera', team: s.team||null }; }

function copyToClipboard(text){
  const value = String(text || '');
  if (!value) return Promise.resolve(false);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value).then(() => true).catch(() => false);
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return Promise.resolve(!!ok);
  } catch {
    return Promise.resolve(false);
  }
}

const resetPassUI = {
  modal: null,
  teamName: null,
  passValue: null,
  hint: null,
  copyBtn: null,
  closeBtn: null,
};

function ensureResetPassUI(){
  if (!resetPassUI.modal) {
    resetPassUI.modal = $('#resetPassModal');
    resetPassUI.teamName = $('#resetPassTeamName');
    resetPassUI.passValue = $('#resetPassValue');
    resetPassUI.hint = $('#resetPassHint');
    resetPassUI.copyBtn = $('#btnCopyResetPass');
    resetPassUI.closeBtn = $('#btnCloseResetPass');

    resetPassUI.copyBtn?.addEventListener('click', async () => {
      const value = resetPassUI.passValue?.value || '';
      const copied = await copyToClipboard(value);
      if (resetPassUI.hint) {
        resetPassUI.hint.textContent = copied
          ? 'Contraseña copiada al portapapeles.'
          : 'No se pudo copiar automáticamente. Copiala manualmente.';
        resetPassUI.hint.classList.toggle('is-copied', copied);
      }
    });

    resetPassUI.closeBtn?.addEventListener('click', () => {
      resetPassUI.modal?.close();
    });
  }
  return resetPassUI;
}

function openResetPassModal(teamName, password, copied = false){
  const ui = ensureResetPassUI();
  if (!ui.modal || !ui.modal.showModal) return;

  if (ui.teamName) ui.teamName.textContent = teamName || 'Equipo';
  if (ui.passValue) ui.passValue.value = password || '';
  if (ui.hint) {
    ui.hint.textContent = copied
      ? 'Contraseña copiada al portapapeles. Al ingresar, el equipo deberá cambiarla.'
      : 'Copiala y enviásela al equipo. Al ingresar deberá cambiarla.';
    ui.hint.classList.toggle('is-copied', copied);
  }

  ui.modal.showModal();
  setTimeout(() => {
    ui.passValue?.focus();
    ui.passValue?.select();
  }, 30);

}

async function impersonateTeam(team, target){
  const teamId = team?.id ? Number(team.id) : NaN;
  const slug = String(team?.slug || '').trim();
  const name = String(team?.name || slug || 'equipo').trim();
  const category = String(team?.category || _activeDiv || '').trim();

  if ((!Number.isFinite(teamId) || teamId <= 0) && !slug) {
    alert('Ese equipo todavía no tiene ID ni slug válido. Guardá la tabla primero y volvé a probar.');
    return;
  }

  const ok = confirm(`Vas a ingresar como "${name}".\n\nLos cambios que hagas se van a guardar como si los hiciera ese capitán. ¿Continuar?`);
  if (!ok) return;

  try {
    const payload = {};
    if (Number.isFinite(teamId) && teamId > 0) payload.teamId = teamId;
    if (slug) payload.slug = slug;

    const resp = await fetch(`${API_BASE}/api/admin/impersonate-team`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok || !data.session) {
      throw new Error(data.error || data.msg || `HTTP ${resp.status}`);
    }

    const previousSession = localStorage.getItem('lpi.session');
    if (previousSession) localStorage.setItem('lpi.admin.session.backup', previousSession);

    const session = data.session;
    localStorage.setItem('lpi.session', JSON.stringify(session));
    sessionStorage.setItem('lpi.session', JSON.stringify(session));
    localStorage.setItem('lpi_team_session', JSON.stringify(session));
    sessionStorage.setItem('lpi_team_session', JSON.stringify(session));
    if (session.slug || session.team) {
      const sessionSlug = session.slug || session.team;
      localStorage.setItem('teamSlug', sessionSlug);
      sessionStorage.setItem('teamSlug', sessionSlug);
      sessionStorage.setItem('lpi_cruces_team', sessionSlug);
    }
    if (session.category || category) {
      localStorage.setItem('lpi.lastCategory', session.category || category);
    }

    const sessionSlug = encodeURIComponent(session.slug || session.team || slug);
    const sessionCategory = encodeURIComponent(session.category || category || 'primera');
    const url = target === 'cruces'
      ? `cruces/cruces_fecha.html?cat=${sessionCategory}&team=${sessionSlug}`
      : `templates/plantilla.html?team=${sessionSlug}`;

    window.open(url, '_blank');
    toast(`Sesión generada: ${name}`);
  } catch (err) {
    console.error('impersonate-team', err);
    alert(err?.message || 'No se pudo ingresar como ese capitán');
  }
}

async function setTeamActive(tr, active){
  const rawId = tr?.dataset?.teamId;
  const teamName = tr?.querySelector('.team')?.value?.trim() || 'equipo';
  const teamId = rawId ? Number(rawId) : NaN;

  if (!Number.isFinite(teamId) || teamId <= 0) {
    alert('Ese equipo todavía no tiene ID en la base. Guardalo primero y después vas a poder cambiar su estado.');
    return;
  }

  const action = active ? 'reactivar' : 'desactivar';
  if (!confirm(`¿Querés ${action} "${teamName}"?`)) return;

  const resp = await fetch(`${API_BASE}/api/teams/${encodeURIComponent(teamId)}/active`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify({ activo: active })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);

  tr.dataset.active = active ? '1' : '0';
  tr.classList.toggle('team-inactive', !active);
  const toggleBtn = tr.querySelector('.btn-toggle-team-active');
  if (toggleBtn) toggleBtn.textContent = active ? 'Desactivar' : 'Reactivar';
  tr.querySelectorAll('.btn-team-planilla, .btn-team-cruces').forEach(btn => {
    btn.disabled = !active || !teamName;
  });
  toast(active ? 'Equipo reactivado' : 'Equipo desactivado');
}

function renderRows(users){
  const tbody = $('#tbodyTeams');
  tbody.innerHTML = '';
  const teams = (users||[]).filter(u => u && u.role === 'team');
  const by = {
    sala: new Map(teams.map(u => [u.username, u.sala || u.email || ''])),
    ubicacion: new Map(teams.map(u => [u.username, u.ubicacion || u.location || u.phone || ''])),
    captain: new Map(teams.map(u => [u.username, u.captain || u.capitan || ''])),
    subcaptain: new Map(teams.map(u => [u.username, u.subcaptain || u.subcapitan || ''])),
    id:   new Map(teams.map(u => [u.username, u.id || null])),
    activo: new Map(teams.map(u => [u.username, u.activo !== false])),
  };
  const names = teams.map(u => u.username);

  for(let i=0;i<Math.max(20, names.length);i++){
    const name  = names[i] || '';
    const teamId = by.id.get(name) || '';
    const canReset = Boolean(teamId);
    const isActive = name ? by.activo.get(name) !== false : true;
    const tr = document.createElement('tr');
    if (teamId) tr.dataset.teamId = String(teamId);
    tr.dataset.active = isActive ? '1' : '0';
    tr.classList.toggle('team-inactive', !isActive);

    tr.innerHTML = `
      <td class="col-idx">${i+1}</td>
      <td><input class="input team" type="text" value="${escapeHtml(name)}" aria-label="Nombre del equipo fila ${i+1}"></td>
      <td><input class="input captain" type="text" value="${escapeHtml(by.captain.get(name)||'')}" placeholder="Capitán" aria-label="Capitán fila ${i+1}"></td>
      <td><input class="input subcaptain" type="text" value="${escapeHtml(by.subcaptain.get(name)||'')}" placeholder="Subcapitán" aria-label="Subcapitán fila ${i+1}"></td>
      <td><input class="input sala" type="text" value="${escapeHtml(by.sala.get(name)||'')}" placeholder="Nombre de sala" aria-label="Sala fila ${i+1}"></td>
      <td><input class="input location" type="url" value="${escapeHtml(normalizeLocation(by.ubicacion.get(name)||''))}" placeholder="Link de Google Maps" aria-label="Ubicación Google Maps fila ${i+1}"></td>
      <td class="team-actions-cell">
        <button class="btn-reset-pass btn-team-planilla" type="button" title="Ingresar como capitán y abrir planilla" aria-label="Ingresar como capitán y abrir planilla de ${escapeHtml(name || ('fila ' + (i+1)))}" ${name && isActive ? '' : 'disabled'}>📋</button>
        <button class="btn-reset-pass btn-team-cruces" type="button" title="Ingresar como capitán y abrir cruces" aria-label="Ingresar como capitán y abrir cruces de ${escapeHtml(name || ('fila ' + (i+1)))}" ${name && isActive ? '' : 'disabled'}>⚔️</button>
        <button class="btn-reset-pass" type="button" title="Blanquear contraseña" aria-label="Blanquear contraseña de ${escapeHtml(name || ('fila ' + (i+1)))}" ${canReset ? '' : 'disabled'}>🔑</button>
        <button class="btn-toggle-team-active" type="button" ${teamId ? '' : 'disabled'}>${isActive ? 'Desactivar' : 'Reactivar'}</button>
        <button class="btn-del-team" type="button">Eliminar</button>
      </td>`;

    const del = tr.querySelector('.btn-del-team');
    del?.addEventListener('click', () => {
      const teamValue = tr.querySelector('.team')?.value?.trim() || `fila ${i+1}`;
      if(!confirm(`¿Eliminar el equipo "${teamValue}" de la tabla?`)) return;
      tr.remove();
    });

    tr.querySelector('.btn-toggle-team-active')?.addEventListener('click', async () => {
      const nextActive = tr.dataset.active === '0';
      try {
        await setTeamActive(tr, nextActive);
      } catch (err) {
        console.error('set-team-active', err);
        alert(err?.message || 'No se pudo cambiar el estado del equipo');
      }
    });

    const getTeamForImpersonation = () => ({
      id: tr.dataset.teamId || '',
      slug: slugify(tr.querySelector('.team')?.value?.trim() || ''),
      name: tr.querySelector('.team')?.value?.trim() || `fila ${i+1}`,
      category: _activeDiv
    });

    tr.querySelector('.btn-team-planilla')?.addEventListener('click', () => {
      impersonateTeam(getTeamForImpersonation(), 'planilla');
    });

    tr.querySelector('.btn-team-cruces')?.addEventListener('click', () => {
      impersonateTeam(getTeamForImpersonation(), 'cruces');
    });

    const resetBtn = tr.querySelector('.btn-reset-pass:not(.btn-team-planilla):not(.btn-team-cruces)');
    resetBtn?.addEventListener('click', async () => {
      const teamName = tr.querySelector('.team')?.value?.trim() || `fila ${i+1}`;
      const rawId = tr.dataset.teamId;
      const teamId = rawId ? Number(rawId) : NaN;

      if (!Number.isFinite(teamId) || teamId <= 0) {
        alert('Ese equipo todavía no tiene ID en la base. Guardalo primero y después vas a poder blanquearle la contraseña.');
        return;
      }

      const ok = confirm(`¿Blanquear la contraseña de "${teamName}"?\n\nSe va a generar una contraseña temporal nueva y el equipo deberá cambiarla al ingresar.`);
      if (!ok) return;

      try {
        resetBtn.disabled = true;

        const resp = await fetch(`${API_BASE}/api/admin/reset-team-password/${encodeURIComponent(teamId)}`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include'
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${resp.status}`);
        }

        const tempPassword = String(data.newPassword || '').trim();
        const copied = await copyToClipboard(tempPassword);
        openResetPassModal(teamName, tempPassword, copied);
        toast(`Contraseña blanqueada: ${teamName}`);
      } catch (err) {
        console.error('reset-team-password', err);
        alert(err?.message || 'No se pudo blanquear la contraseña');
      } finally {
        resetBtn.disabled = false;
      }
    });
    tbody.appendChild(tr);
  }
}
function collectRows(){
  const rows = [];
  $$('#tbodyTeams tr').forEach(tr => {
    const name    = tr.querySelector('.team')?.value.trim()     || '';
    const captain = tr.querySelector('.captain')?.value.trim()  || '';
    const subcaptain = tr.querySelector('.subcaptain')?.value.trim() || '';
    const sala      = tr.querySelector('.sala')?.value.trim()      || '';
    const ubicacion = tr.querySelector('.location')?.value.trim()  || '';
    const activo = tr.dataset.active !== '0';
    if(!name) return;
    rows.push({ username:name, role:'team', captain, subcaptain, email:sala, phone:ubicacion, activo });
  });
  return rows;
}
async function saveTeams(){
  const teams = collectRows();
  try{
    const resp = await fetch(`${API_BASE}/api/save-teams`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ division: _activeDiv, teams })
    });
    const json = await resp.json().catch(()=>({}));
    if(!resp.ok || !json.ok){ throw new Error(json.error || ('HTTP '+resp.status)); }
    toast('Guardado correctamente');
    await loadDivision(_activeDiv);
  }catch(e){
    console.warn('save-teams', e);
    toast('No se pudo guardar');
  }
}

let teamsInDiv = []; // [{ id, name, slug }]

function normalizePlayerFormValue(value){
  if (typeof value === 'string') {
    return { name: value.trim(), dni: '', fechaNacimiento: '' };
  }

  return {
    id: value?.id || null,
    name: String(value?.name || value?.nombre || '').trim(),
    dni: String(value?.dni || '').replace(/\D/g, ''),
    fechaNacimiento: String(value?.fechaNacimiento || value?.birthDate || value?.fecha_nacimiento || '').slice(0, 10)
  };
}

function buildPlayersUI(values){
  const cont = $('#players');
  if (!cont) return;
  cont.innerHTML = '';
  const arr = (values || []).map(normalizePlayerFormValue).slice(0,SLOTS);
  while(arr.length < SLOTS) arr.push({ name: '', dni: '', fechaNacimiento: '' });

  arr.forEach((val, idx) => {
    const player = normalizePlayerFormValue(val);
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <div class="pill">${idx+1}</div>
      <input class="input player-name" type="text" placeholder="Nombre y apellido" value="${escapeHtml(player.name)}" />
      <input class="input player-dni" type="text" inputmode="numeric" placeholder="DNI" value="${escapeHtml(player.dni)}" />
      <input class="input player-birth" type="date" value="${escapeHtml(player.fechaNacimiento)}" />
      <button class="btn-del" type="button">Eliminar</button>
    `;
    const inputs = row.querySelectorAll('.input');
    const del   = row.querySelector('.btn-del');

    inputs.forEach(input => input.addEventListener('input', debounce(saveDraftNow, 150)));
    del.addEventListener('click', () => {
      const vals = getCurrentValues();
      vals.splice(idx,1);
      while(vals.length < SLOTS) vals.push({ name: '', dni: '', fechaNacimiento: '' });
      setCurrentValues(vals);
      saveDraftNow();
    });

    cont.appendChild(row);
  });
}
function getCurrentValues(){
  return $$('#players .player-row').map(row => ({
    name: row.querySelector('.player-name')?.value.trim() || '',
    dni: row.querySelector('.player-dni')?.value.replace(/\D/g, '').trim() || '',
    fechaNacimiento: row.querySelector('.player-birth')?.value || ''
  }));
}
function setCurrentValues(arr){
  const rows = $$('#players .player-row');
  for(let i=0;i<rows.length;i++){
    const player = normalizePlayerFormValue(arr[i] || {});
    const row = rows[i];
    const name = row.querySelector('.player-name');
    const dni = row.querySelector('.player-dni');
    const birth = row.querySelector('.player-birth');
    if (name) name.value = player.name || '';
    if (dni) dni.value = player.dni || '';
    if (birth) birth.value = player.fechaNacimiento || '';
  }
}
function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

function fillTeamSelect(){
  const sel = $('#teamSelect');
  if (!sel) return;
  sel.innerHTML = '';
  teamsInDiv.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.slug; opt.textContent = t.name;
    sel.appendChild(opt);
  });
}
function getSelectedTeamSlug(){ return $('#teamSelect')?.value || ''; }
function refreshDraftButtons(){
  return;
}
function toggleImportBox(force){
  const box = $('#importBox');
  if (!box) return;
  const open = typeof force === 'boolean' ? force : box.hasAttribute('hidden');
  if (open) box.removeAttribute('hidden');
  else box.setAttribute('hidden', 'hidden');
}
function importPlayersFromTextarea(){
  const ta = $('#importPlayersText');
  if (!ta) return;
  const raw = ta.value || '';
  const items = raw
    .split(/\r?\n|;/)
    .map(s => s.replace(/^\s*\d+[.)-]?\s*/, '').trim())
    .filter(Boolean)
    .map(name => ({ name, dni: '', fechaNacimiento: '' }))
    .slice(0, SLOTS);
  const vals = items.concat(Array(Math.max(0, SLOTS - items.length)).fill(null).map(() => ({ name: '', dni: '', fechaNacimiento: '' })));
  setCurrentValues(vals);
  saveDraftNow();
  refreshDraftButtons();
  toggleImportBox(false);
  toast(`Se importaron ${items.length} jugador(es)`);
}
function exportRoster(){
  const teamSlug = getSelectedTeamSlug();
  const teamName = (teamsInDiv.find(t => t.slug === teamSlug)?.name) || teamSlug || 'equipo';
  const players = getCurrentValues().filter(item => item.name);

  if (!players.length){
    toast('No hay jugadores para exportar');
    return;
  }

  const lines = players.map((player, idx) => {
    const extra = [
      player.dni ? `DNI ${player.dni}` : '',
      player.fechaNacimiento ? `Nac. ${player.fechaNacimiento}` : ''
    ].filter(Boolean).join(' - ');
    return `${idx + 1}. ${player.name}${extra ? ` (${extra})` : ''}`;
  });
  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${teamSlug || 'equipo'}.players.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  toast(`Lista exportada: ${teamName}`);
}
function loadDraftIntoForm(){
  const teamSlug = getSelectedTeamSlug();
  if (!teamSlug || !hasDraft(_activeDiv, teamSlug)) {
    toast('No hay borrador para este equipo');
    refreshDraftButtons();
    return;
  }
  const vals = getDraft(_activeDiv, teamSlug);
  while (vals.length < SLOTS) vals.push('');
  setCurrentValues(vals);
  toast('Borrador cargado');
  refreshDraftButtons();
}
async function discardDraftForCurrentTeam(){
  const teamSlug = getSelectedTeamSlug();
  if (!teamSlug) return;
  clearDraft(_activeDiv, teamSlug);
  refreshDraftButtons();
  await changeTeam();
  toast('Borrador descartado');
}

async function loadPlayersForTeam(slug){
  try {
    const r = await fetch(`${API_BASE}/api/team-assets?team=${encodeURIComponent(slug)}`, {
      cache: 'no-store',
      credentials: 'include'
    });

    if (!r.ok) {
      throw new Error('No se pudo cargar el plantel');
    }

    const data = await r.json();

    if (Array.isArray(data.playerDetails)) {
      return data.playerDetails.map(normalizePlayerFormValue).slice(0, SLOTS);
    }

    if (Array.isArray(data.players)) {
      return data.players.map(normalizePlayerFormValue).slice(0, SLOTS);
    }
  } catch (e) {
    console.warn('loadPlayersForTeam', e);
  }

  return Array(SLOTS).fill(null).map(() => ({ name: '', dni: '', fechaNacimiento: '' }));
}

async function changeTeam(){
  const teamSlug = $('#teamSelect').value;
  let vals = await loadPlayersForTeam(teamSlug);
  while (vals.length < SLOTS) vals.push({ name: '', dni: '', fechaNacimiento: '' });
  buildPlayersUI(vals);
  refreshDraftButtons();
  setLast(_activeDiv, teamSlug);
}
function saveDraftNow(){
  const teamSlug = $('#teamSelect').value;
  if(!teamSlug) return;
  setDraft(_activeDiv, teamSlug, getCurrentValues());
}
async function saveRoster(){
  const teamSlug = $('#teamSelect').value;
  const teamName = (teamsInDiv.find(t=>t.slug===teamSlug)?.name) || teamSlug;
  const players  = getCurrentValues().slice(0,SLOTS).filter(item => item.name);
  try{
    const resp = await fetch(`${API_BASE}/api/save-team-assets`, {
      method:'POST',
      headers: authHeaders({ 'Content-Type':'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ slug: teamSlug, teamName, players })
    });
    const json = await resp.json().catch(()=> ({}));
    if(!resp.ok || !json.ok){ throw new Error(json?.error || 'Error al guardar'); }
    clearDraft(_activeDiv, teamSlug);
    refreshDraftButtons();
    toast('Guardado correctamente');
  }catch(e){
    console.warn(e); toast('Error al guardar');
  }
}

async function loadTeamsForDivision(div){
  try {
    const r = await fetch(`${API_BASE}/api/teams?division=${encodeURIComponent(div)}&includeInactive=1`, {
      cache: 'no-store',
      credentials: 'include'
    });

    if (!r.ok) {
      throw new Error('No se pudieron cargar los equipos');
    }

    const data = await r.json();
    const raw =
      Array.isArray(data) ? data :
      Array.isArray(data.teams) ? data.teams :
      Array.isArray(data.users) ? data.users :
      [];

    return raw
      .filter(u => u && (u.role === 'team' || u.username || u.name))
      .map(u => ({
        id: u.id || null,
        username: u.username || u.name || '',
        role: 'team',
        captain: u.captain || u.capitan || '',
        subcaptain: u.subcaptain || u.subcapitan || '',
        email: u.sala || u.email || '',
        phone: u.ubicacion || u.location || u.phone || '',
        slug: u.slug || slugify(u.username || u.name || ''),
        activo: u.activo !== false
      }))
      .filter(u => u.username);
  } catch (e) {
    console.warn('loadTeamsForDivision', e);
    toast('No se pudieron cargar los equipos');
    return [];
  }
}


function normalizeSala(item){
  return {
    id: item?.id || null,
    nombre: String(item?.nombre || item?.name || item?.sala || item?.room || '').trim(),
    direccion: String(item?.direccion || item?.address || '').trim(),
    ubicacion: String(item?.ubicacion || item?.location || item?.maps || '').trim(),
    contacto: String(item?.contacto || item?.whatsapp || item?.phone_contact || '').trim(),
  };
}

function renderSalasRows(salas){
  const tbody = $('#tbodySalas');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rows = Array.isArray(salas) ? salas.map(normalizeSala).slice(0, SALAS_SLOTS) : [];

  for (let i = 0; i < SALAS_SLOTS; i++){
    const sala = rows[i] || { id: null, nombre: '', direccion: '', ubicacion: '', contacto: '' };
    const canReset = Boolean(sala.id);
    const tr = document.createElement('tr');
    if (sala.id) tr.dataset.salaId = String(sala.id);

    tr.innerHTML = `
      <td class="col-idx">${i + 1}</td>
      <td><input class="input sala-name" type="text" value="${sala.nombre.replace(/"/g,'&quot;')}" placeholder="Nombre de sala" aria-label="Nombre de sala fila ${i + 1}"></td>
      <td><input class="input sala-address" type="text" value="${sala.direccion.replace(/"/g,'&quot;')}" placeholder="Dirección" aria-label="Dirección fila ${i + 1}"></td>
      <td><input class="input sala-location" type="url" value="${normalizeLocation(sala.ubicacion).replace(/"/g,'&quot;')}" placeholder="Link de Google Maps" aria-label="Ubicación fila ${i + 1}"></td>
      <td><input class="input sala-contact" type="text" value="${(sala.contacto || '').replace(/"/g,'&quot;')}" placeholder="WhatsApp o link de grupo" aria-label="Contacto WhatsApp fila ${i + 1}"></td>
      <td class="team-actions-cell">
        <button class="btn-reset-pass btn-reset-sala-pass" type="button" title="Blanquear contraseña" aria-label="Blanquear contraseña de ${sala.nombre || ('fila ' + (i + 1))}" ${canReset ? '' : 'disabled'}>🔑</button>
        <button class="btn-del-sala" type="button">Eliminar</button>
      </td>`;

    tr.querySelector('.btn-del-sala')?.addEventListener('click', () => {
      const name = tr.querySelector('.sala-name')?.value?.trim() || `fila ${i + 1}`;
      if (!confirm(`¿Eliminar la sala "${name}" de la tabla?`)) return;
      tr.querySelector('.sala-name').value = '';
      tr.querySelector('.sala-address').value = '';
      tr.querySelector('.sala-location').value = '';
      tr.querySelector('.sala-contact').value = '';
      delete tr.dataset.salaId;
      const resetBtn = tr.querySelector('.btn-reset-sala-pass');
      if (resetBtn) resetBtn.disabled = true;
    });

    const resetBtn = tr.querySelector('.btn-reset-sala-pass');
    resetBtn?.addEventListener('click', async () => {
      const salaName = tr.querySelector('.sala-name')?.value?.trim() || `fila ${i + 1}`;
      const rawId = tr.dataset.salaId;
      const salaId = rawId ? Number(rawId) : NaN;

      if (!Number.isFinite(salaId) || salaId <= 0) {
        alert('Esa sala todavía no tiene ID en la base. Guardala primero y después vas a poder blanquearle la contraseña.');
        return;
      }

      const ok = confirm(`¿Blanquear la contraseña de "${salaName}"?\n\nSe va a generar una contraseña temporal nueva.`);
      if (!ok) return;

      try {
        resetBtn.disabled = true;

        const resp = await fetch(`${API_BASE}/api/admin/reset-sala-password/${encodeURIComponent(salaId)}`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include'
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${resp.status}`);
        }

        const tempPassword = String(data.newPassword || '').trim();
        const copied = await copyToClipboard(tempPassword);
        openResetPassModal(salaName, tempPassword, copied);
        toast(`Contraseña blanqueada: ${salaName}`);
      } catch (err) {
        console.error('reset-sala-password', err);
        alert(err?.message || 'No se pudo blanquear la contraseña');
      } finally {
        resetBtn.disabled = false;
      }
    });

    tbody.appendChild(tr);
  }
}

function collectSalasRows(){
  const rows = [];
  $$('#tbodySalas tr').forEach(tr => {
    const nombre = tr.querySelector('.sala-name')?.value.trim() || '';
    const direccion = tr.querySelector('.sala-address')?.value.trim() || '';
    const ubicacion = tr.querySelector('.sala-location')?.value.trim() || '';
    const contacto = tr.querySelector('.sala-contact')?.value.trim() || '';
    if (!nombre && !direccion && !ubicacion && !contacto) return;
    const id = tr.dataset.salaId || null;
    rows.push({ id, nombre, direccion, ubicacion, contacto });
  });
  return rows;
}

async function loadSalas(){
  try{
    const resp = await fetch(`${API_BASE}/api/salas`, {
      cache: 'no-store',
      credentials: 'include'
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    const raw = Array.isArray(data) ? data : Array.isArray(data.salas) ? data.salas : [];
    renderSalasRows(raw);
  }catch(e){
    console.warn('load-salas', e);
    renderSalasRows([]);
    toast('No se pudieron cargar las salas');
  }
}

async function saveSalas(){
  const salas = collectSalasRows();
  try{
    const resp = await fetch(`${API_BASE}/api/save-salas`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ salas })
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.ok === false) throw new Error(json.error || `HTTP ${resp.status}`);
    toast('Salas guardadas correctamente');
    await loadSalas();
  }catch(e){
    console.warn('save-salas', e);
    toast('No se pudieron guardar las salas');
  }
}

function showAdminTab(tab){
  const isSalas = tab === 'salas';
  $('#teamsAdminView')?.toggleAttribute('hidden', isSalas);
  $('#salasAdminView')?.toggleAttribute('hidden', !isSalas);
}


let pendingImportTable = null;

function makeExportFilename(kind){
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === 'salas') return `lpi-salas-${stamp}.json`;
  return `lpi-${_activeDiv || 'division'}-equipos-${stamp}.json`;
}

function downloadJson(filename, payload){
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportTeamsTable(){
  const teams = collectRows().map(item => ({
    nombre: item.username || '',
    capitan: item.captain || '',
    subcapitan: item.subcaptain || '',
    sala: item.email || '',
    ubicacion: item.phone || '',
    activo: item.activo !== false
  }));

  downloadJson(makeExportFilename('teams'), {
    tipo: 'equipos',
    division: _activeDiv,
    exportado: new Date().toISOString(),
    equipos: teams
  });
  toast(`Tabla ${_activeDiv} exportada`);
}

function exportSalasTable(){
  const salas = collectSalasRows().map(item => ({
    nombre: item.nombre || '',
    direccion: item.direccion || '',
    ubicacion: item.ubicacion || '',
    contacto: item.contacto || ''
  }));

  downloadJson(makeExportFilename('salas'), {
    tipo: 'salas',
    exportado: new Date().toISOString(),
    salas
  });
  toast('Tabla salas exportada');
}

function openImportDialog(kind){
  pendingImportTable = kind;
  const input = $('#tableImportFile');
  if (!input) return;
  input.value = '';
  input.click();
}

function getImportedArray(data, kind){
  if (Array.isArray(data)) return data;
  if (kind === 'salas') return Array.isArray(data?.salas) ? data.salas : [];
  return Array.isArray(data?.equipos) ? data.equipos : Array.isArray(data?.teams) ? data.teams : [];
}

function importTeamsTable(items){
  const users = (items || []).slice(0, 20).map(item => ({
    id: item?.id || null,
    username: item?.username || item?.nombre || item?.name || item?.equipo || '',
    role: 'team',
    captain: item?.captain || item?.capitan || '',
    subcaptain: item?.subcaptain || item?.subcapitan || '',
    email: item?.email || item?.sala || item?.room || '',
    phone: item?.phone || item?.ubicacion || item?.location || item?.maps || '',
    slug: item?.slug || slugify(item?.username || item?.nombre || item?.name || item?.equipo || '')
  })).filter(item => item.username || item.email || item.phone);

  renderRows(users);
  teamsInDiv = users
    .filter(item => item.username)
    .map(item => ({ id: item.id, name: item.username, slug: item.slug || slugify(item.username) }));
  toast('Tabla importada. Revisá y guardá para actualizar la DB.');
}

function importSalasTable(items){
  const salas = (items || []).slice(0, SALAS_SLOTS).map(item => ({
    id: item?.id || null,
    nombre: item?.nombre || item?.name || item?.sala || item?.room || '',
    direccion: item?.direccion || item?.address || '',
    ubicacion: item?.ubicacion || item?.location || item?.maps || '',
    contacto: item?.contacto || item?.whatsapp || item?.phone_contact || ''
  }));
  renderSalasRows(salas);
  toast('Tabla importada. Revisá y guardá para actualizar la DB.');
}

async function handleTableImportFile(ev){
  const file = ev?.target?.files?.[0];
  const kind = pendingImportTable;
  pendingImportTable = null;
  if (!file || !kind) return;

  try{
    const text = await file.text();
    const data = JSON.parse(text);
    const items = getImportedArray(data, kind);
    if (!items.length) throw new Error('El archivo no tiene datos para importar.');

    if (kind === 'salas') importSalasTable(items);
    else importTeamsTable(items);
  }catch(e){
    console.warn('import-table', e);
    alert(e?.message || 'No se pudo importar el archivo. Usá un JSON exportado desde esta pantalla.');
  }
}

let _activeDiv = 'primera';
async function loadDivision(div){
  _activeDiv = div;
  showAdminTab(div);
  $$('.sw').forEach(btn => {
    const on = btn.dataset.div === div;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  if (div === 'salas') {
    await loadSalas();
    return;
  }

  if (!DIVISIONES.includes(div)) {
    renderRows([]);
    teamsInDiv = [];
    fillTeamSelect();
    buildPlayersUI([]);
    return;
  }

  const users = await loadTeamsForDivision(div);
  renderRows(users);

  teamsInDiv = users.filter(u => u.activo !== false).map(u => ({
    id: u.id,
    name: u.username,
    slug: u.slug || slugify(u.username)
  }));

  if ($('#teamSelect')) {
    fillTeamSelect();

    const last = getLast();
    const fallback = teamsInDiv[0]?.slug || '';
    const wantSlug = (last.division === div && last.team) ? last.team : fallback;

    if (wantSlug) {
      $('#teamSelect').value = wantSlug;
      await changeTeam();
    } else {
      buildPlayersUI(Array(SLOTS).fill(''));
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  ensureResetPassUI();
  $$('.sw').forEach(btn => btn.addEventListener('click', () => loadDivision(btn.dataset.div)));
  $('#btnSaveTeams')?.addEventListener('click', saveTeams);
  $('#btnExportTeams')?.addEventListener('click', exportTeamsTable);
  $('#btnImportTeams')?.addEventListener('click', () => openImportDialog('teams'));
  $('#btnSaveRoster')?.addEventListener('click', saveRoster);
  $('#btnSaveSalas')?.addEventListener('click', saveSalas);
  $('#btnExportSalas')?.addEventListener('click', exportSalasTable);
  $('#btnImportSalas')?.addEventListener('click', () => openImportDialog('salas'));
  $('#tableImportFile')?.addEventListener('change', handleTableImportFile);
  $('#teamSelect')?.addEventListener('change', changeTeam);

  $('#btnToggleImport')?.addEventListener('click', () => toggleImportBox());
  $('#btnApplyImport')?.addEventListener('click', importPlayersFromTextarea);
  $('#btnCancelImport')?.addEventListener('click', () => toggleImportBox(false));
  $('#btnExportRoster')?.addEventListener('click', exportRoster);

  buildPlayersUI(Array(SLOTS).fill(''));
  refreshDraftButtons();
  const last = getLast();
  loadDivision(last.division || 'primera');
});

(function(){
  function getTeamSlug(){
    try {
      if (typeof deriveTeam === 'function') return deriveTeam();
    } catch(_){}
    try {
      var file = (location.pathname.split('/').pop()||'').replace(/\.html$/i,'');
      return file.toLowerCase();
    } catch(_){
      return 'equipo';
    }
  }

  var passModal = null;

  function ensureModal(){
    if (!passModal) {
      passModal = document.getElementById('passModal');
    }
    return passModal;
  }

  function openModal(ev){
    if (ev && ev.preventDefault) ev.preventDefault();
    var dlg = ensureModal();
    if (!dlg || !dlg.showModal) return;
    document.getElementById('oldPass').value = '';
    document.getElementById('newPass').value = '';
    document.getElementById('newPass2').value = '';
    document.getElementById('passError').style.display = 'none';
    document.getElementById('passSuccess').style.display = 'none';
    dlg.showModal();
  }

  function wireOpen(){
    ensureModal();
    var btn = document.getElementById('btnChangePassword');
    if (btn) btn.addEventListener('click', openModal);
  }

  function submitPass(ev){
    if (ev && ev.preventDefault) ev.preventDefault();
    var oldPass = document.getElementById('oldPass').value;
    var newPass = document.getElementById('newPass').value;
    var newPass2 = document.getElementById('newPass2').value;
    var err = document.getElementById('passError');
    var ok  = document.getElementById('passSuccess');

    if(!oldPass || !newPass || newPass !== newPass2){
      err.textContent = 'Revisá los campos';
      err.style.display = 'block';
      ok.style.display = 'none';
      return;
    }

    var slug = getTeamSlug();
    fetch(`${API_BASE}/api/admin/change-password`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ slug: slug, oldPassword: oldPass, newPassword: newPass })
    })
    .then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json().catch(function(){return {};});
    })
    .then(function(){
      err.style.display = 'none';
      ok.style.display = 'block';
      setTimeout(function(){
        var dlg = ensureModal();
        if (dlg && dlg.close) dlg.close();
      }, 800);
    })
    .catch(function(){
      err.textContent = 'No se pudo actualizar.';
      err.style.display = 'block';
      ok.style.display = 'none';
    });
  }

  function wireSubmit(){
    var btn = document.getElementById('submitPass');
    if (btn) btn.addEventListener('click', submitPass);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){
      wireOpen();
      wireSubmit();
    });
  } else {
    wireOpen();
    wireSubmit();
  }
})();

(function(){
  function wirePasswordToggles(){
    var toggles = document.querySelectorAll('input[data-toggle]');
    toggles.forEach(function(chk){
      var selector = chk.getAttribute('data-toggle');
      if (!selector) return;
      var target = document.querySelector(selector);
      if (!target) return;

      function update(){
        try{
          target.type = chk.checked ? 'text' : 'password';
        }catch(e){
          console.warn('No se pudo cambiar el tipo del campo de contraseña', e);
        }
      }

      chk.addEventListener('change', update);
      update();
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wirePasswordToggles);
  } else {
    wirePasswordToggles();
  }
})();


