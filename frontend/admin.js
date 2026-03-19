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
    const btnFixture = document.getElementById('btnFixture');
    const btnFecha   = document.getElementById('btnFecha');
    if(btnFixture) btnFixture.href = withMode(btnFixture.getAttribute('href') || 'fixture/fixture.html');
    if(btnFecha)   btnFecha.href   = withMode(btnFecha.getAttribute('href')   || 'visor_planillas.html');
  }catch(e){ console.warn('Nav admin patch:', e); }
})();

/* ====== Config compartida ====== */
const SLOTS = 20;
const LS_KEY = 'lpi_admin_roster_v1';
const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');

/* ====== Helpers ====== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
function toast(msg){ const t=$('#toast'); if(!t) return; t.textContent=msg; t.classList.add('show'); setTimeout(()=> t.classList.remove('show'), 1600); }
function normalizePhone(p){ return String(p||'').trim(); }
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
  if (s.drafts) delete s.drafts[getDraftKey(div, team)];
  writeLS(s);
}
function setLast(div,team){ const s=readLS(); s.division=div; s.team=team; writeLS(s); }
function getLast(){ const s=readLS(); return { division: s.division||'primera', team: s.team||null }; }

/* ====== Tabla izquierda (equipos de liga) ====== */
function renderRows(users){
  const tbody = $('#tbodyTeams');
  if (!tbody) return;
  tbody.innerHTML = '';
  const teams = (users||[]).filter(u => u && u.role === 'team');
  const by = {
    cap:  new Map(teams.map(u => [u.username, u.captain || ''])),
    mail: new Map(teams.map(u => [u.username, u.email   || ''])),
    tel:  new Map(teams.map(u => [u.username, u.phone   || ''])),
  };
  const names = teams.map(u => u.username);

  for(let i=0;i<SLOTS;i++){
    const name  = names[i] || '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-idx">${i+1}</td>
      <td><input class="input team" type="text" value="${name.replace(/"/g,'&quot;')}" aria-label="Nombre del equipo fila ${i+1}"></td>
      <td><input class="input captain" type="text" value="${(by.cap.get(name)||'').replace(/"/g,'&quot;')}" aria-label="Capitán fila ${i+1}"></td>
      <td><input class="input email" type="email" value="${(by.mail.get(name)||'').replace(/"/g,'&quot;')}" placeholder="correo@ejemplo.com" aria-label="Correo electrónico fila ${i+1}"></td>
      <td><input class="input phone" type="tel" value="${normalizePhone(by.tel.get(name)||'').replace(/"/g,'&quot;')}" placeholder="11 1234 5678" aria-label="Teléfono fila ${i+1}"></td>
      <td><button class="btn-del-team" type="button">Eliminar</button></td>`;
    const del = tr.querySelector('.btn-del-team');
    del?.addEventListener('click', () => tr.remove());
    tbody.appendChild(tr);
  }
}
function collectRows(){
  const rows = [];
  $$('#tbodyTeams tr').forEach(tr => {
    const name    = tr.querySelector('.team')?.value.trim()     || '';
    const captain = tr.querySelector('.captain')?.value.trim()  || '';
    const email   = tr.querySelector('.email')?.value.trim()    || '';
    const phone   = tr.querySelector('.phone')?.value.trim()    || '';
    if(!name) return;
    rows.push({ username:name, role:'team', captain, email, phone });
  });
  return rows;
}
async function saveTeams(){
  const teams = collectRows();
  try{
    const resp = await fetch(`${API_BASE}/api/save-teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ division: _activeDiv, teams })
    });
    const json = await resp.json().catch(()=>({}));
    if(!resp.ok || !json.ok){ throw new Error(json.error || ('HTTP '+resp.status)); }

    // refrescar desde DB para que quede sincronizado
    await loadDivision(_activeDiv, getSelectedTeamSlug(), true);
    toast('Guardado correctamente');
  }catch(e){
    console.warn('save-teams', e);
    toast('No se pudo guardar');
  }
}

/* ====== Panel derecho (plantel) ====== */
let teamsInDiv = []; // [{ name, slug }]
let _activeDiv = 'primera';

function buildPlayersUI(values){
  const cont = $('#players');
  if (!cont) return;
  cont.innerHTML = '';
  const arr = (values || []).slice(0,SLOTS);
  while(arr.length < SLOTS) arr.push('');

  arr.forEach((val, idx) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <div class="pill">${idx+1}</div>
      <input class="input" type="text" placeholder="Nombre y apellido" value="${(val||'').replace(/"/g,'&quot;')}" />
      <button class="btn-del" type="button">Eliminar</button>
    `;
    const input = row.querySelector('.input');
    const del   = row.querySelector('.btn-del');

    input.addEventListener('input', debounce(saveDraftNow, 150));
    del.addEventListener('click', () => {
      const vals = getCurrentValues();
      vals.splice(idx,1);
      while(vals.length < SLOTS) vals.push('');
      setCurrentValues(vals);
      saveDraftNow();
    });

    cont.appendChild(row);
  });
}
function getCurrentValues(){ return $$('#players .input').map(i => i.value.trim()); }
function setCurrentValues(arr){
  const inputs = $$('#players .input');
  for(let i=0;i<inputs.length;i++){ inputs[i].value = (arr[i]||''); }
}
function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

function fillTeamSelect(selectedSlug){
  const sel = $('#teamSelect');
  if (!sel) return;
  sel.innerHTML = '';
  teamsInDiv.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.slug;
    opt.textContent = t.name;
    if (selectedSlug && selectedSlug === t.slug) opt.selected = true;
    sel.appendChild(opt);
  });
  if (!selectedSlug && sel.options.length) sel.selectedIndex = 0;
}
function getSelectedTeamSlug(){ return $('#teamSelect')?.value || ''; }
function refreshDraftButtons(){ return; }
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
    .slice(0, SLOTS);
  const vals = items.concat(Array(Math.max(0, SLOTS - items.length)).fill(''));
  setCurrentValues(vals);
  saveDraftNow();
  refreshDraftButtons();
  toggleImportBox(false);
  toast(`Se importaron ${items.length} jugador(es)`);
}
function exportRoster(){
  const teamSlug = getSelectedTeamSlug();
  const teamName = (teamsInDiv.find(t => t.slug === teamSlug)?.name) || teamSlug || 'equipo';
  const players = getCurrentValues().filter(Boolean);

  if (!players.length){
    toast('No hay jugadores para exportar');
    return;
  }

  const lines = players.map((name, idx) => `${idx + 1}. ${name}`);
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
  setCurrentValues(Array(SLOTS).fill(''));
  refreshDraftButtons();
  toast('Borrador descartado');
}
function saveDraftNow(){
  const teamSlug = getSelectedTeamSlug();
  if (!teamSlug) return;
  setDraft(_activeDiv, teamSlug, getCurrentValues());
  setLast(_activeDiv, teamSlug);
}
async function loadTeamAssets(teamSlug){
  if (!teamSlug) {
    setCurrentValues(Array(SLOTS).fill(''));
    return;
  }
  try{
    const resp = await fetch(`${API_BASE}/api/team-assets?team=${encodeURIComponent(teamSlug)}`, { credentials:'include' });
    const json = await resp.json().catch(()=>({}));
    if(resp.ok && json.ok && Array.isArray(json.players) && json.players.length){
      const vals = json.players.slice(0,SLOTS);
      while(vals.length < SLOTS) vals.push('');
      setCurrentValues(vals);
      return;
    }
  }catch(e){
    console.warn('loadTeamAssets', e);
  }
  const draft = getDraft(_activeDiv, teamSlug);
  while(draft.length < SLOTS) draft.push('');
  setCurrentValues(draft);
}
async function saveTeamAssets(){
  const teamSlug = getSelectedTeamSlug();
  if (!teamSlug) return toast('Elegí un equipo');

  const teamName = (teamsInDiv.find(t => t.slug === teamSlug)?.name) || teamSlug;
  const players = getCurrentValues().filter(Boolean);

  try{
    const resp = await fetch(`${API_BASE}/api/save-team-assets`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      credentials:'include',
      body: JSON.stringify({ slug: teamSlug, teamName, players })
    });
    const json = await resp.json().catch(()=>({}));
    if(!resp.ok || !json.ok) throw new Error(json.error || ('HTTP '+resp.status));
    clearDraft(_activeDiv, teamSlug);
    toast('Plantel guardado');
  }catch(e){
    console.warn('save-team-assets', e);
    toast('No se pudo guardar el plantel');
  }
}

async function loadDivision(div, preferredSlug = null, keepSelection = false){
  _activeDiv = div;
  setLast(div, preferredSlug || getSelectedTeamSlug() || null);

  try{
    const resp = await fetch(`${API_BASE}/api/teams?division=${encodeURIComponent(div)}`, {
      credentials: 'include'
    });
    const json = await resp.json().catch(()=>({}));
    if(!resp.ok || !json.ok || !Array.isArray(json.teams)){
      throw new Error(json.error || ('HTTP ' + resp.status));
    }

    const teams = json.teams.filter(t => t && t.username);
    renderRows(teams);

    teamsInDiv = teams.map(t => ({
      name: t.username,
      slug: String(t.slug || slugify(t.username || '')).trim().toLowerCase()
    }));

    const currentSlug = keepSelection ? (preferredSlug || getSelectedTeamSlug()) : preferredSlug;
    const selectedSlug = teamsInDiv.some(t => t.slug === currentSlug)
      ? currentSlug
      : (teamsInDiv[0]?.slug || '');

    fillTeamSelect(selectedSlug);
    await loadTeamAssets(selectedSlug);
    refreshDraftButtons();
  }catch(e){
    console.warn('loadDivision', e);
    renderRows([]);
    teamsInDiv = [];
    fillTeamSelect('');
    buildPlayersUI(Array(SLOTS).fill(''));
    toast('No se pudieron cargar los equipos');
  }
}

function bindDivisionButtons(){
  ['primera','segunda','tercera'].forEach(div => {
    const btn = document.querySelector(`[data-division="${div}"]`) || document.getElementById(`btn-${div}`) || document.getElementById(div);
    if(btn){
      btn.addEventListener('click', () => loadDivision(div));
    }
  });
}

function bindEvents(){
  $('#btnSaveTeams')?.addEventListener('click', saveTeams);
  $('#btnSaveRoster')?.addEventListener('click', saveTeamAssets);
  $('#teamSelect')?.addEventListener('change', async () => {
    const slug = getSelectedTeamSlug();
    setLast(_activeDiv, slug);
    await loadTeamAssets(slug);
    refreshDraftButtons();
  });
  $('#btnImportToggle')?.addEventListener('click', () => toggleImportBox());
  $('#btnImportApply')?.addEventListener('click', importPlayersFromTextarea);
  $('#btnExportRoster')?.addEventListener('click', exportRoster);
  $('#btnLoadDraft')?.addEventListener('click', loadDraftIntoForm);
  $('#btnDiscardDraft')?.addEventListener('click', discardDraftForCurrentTeam);
}

async function init(){
  buildPlayersUI(Array(SLOTS).fill(''));
  bindDivisionButtons();
  bindEvents();
  const last = getLast();
  await loadDivision(last.division || 'primera', last.team || null);
}

document.addEventListener('DOMContentLoaded', init);
