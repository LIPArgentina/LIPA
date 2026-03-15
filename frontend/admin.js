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
  


/* ====== Header: mantener ?admin=1 en enlaces ====== */
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
const BASE = 'data/';
const FILES = {
  primera:  BASE + 'usuarios.primera.js',
  segunda:  BASE + 'usuarios.segunda.js',
  tercera:  BASE + 'usuarios.tercera.js',
};
const EQUIPOS_DIR = 'equipos/';
const SLOTS = 20;
const LS_KEY = 'lpi_admin_roster_v1';

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
  if (s.drafts) {
    delete s.drafts[getDraftKey(div, team)];
  }
  writeLS(s);
}
function setLast(div,team){ const s=readLS(); s.division=div; s.team=team; writeLS(s); }
function getLast(){ const s=readLS(); return { division: s.division||'primera', team: s.team||null }; }

/* ====== Tabla izquierda (equipos de liga) ====== */
function renderRows(users){
  const tbody = $('#tbodyTeams');
  tbody.innerHTML = '';
  const teams = (users||[]).filter(u => u && u.role === 'team');
  const by = {
    cap:  new Map(teams.map(u => [u.username, u.captain || ''])),
    mail: new Map(teams.map(u => [u.username, u.email   || ''])),
    tel:  new Map(teams.map(u => [u.username, u.phone   || ''])),
  };
  const names = teams.map(u => u.username);

  for(let i=0;i<20;i++){
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
    del?.addEventListener('click', () => {
      const teamValue = tr.querySelector('.team')?.value?.trim() || `fila ${i+1}`;
      if(!confirm(`¿Eliminar el equipo "${teamValue}" de la tabla?`)) return;
      tr.remove();
    });
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
    const resp = await fetch('/api/save-teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ division: _activeDiv, teams })
    });
    const json = await resp.json().catch(()=>({}));
    if(!resp.ok || !json.ok){ throw new Error(json.error || ('HTTP '+resp.status)); }
    toast('Guardado correctamente');
  }catch(e){
    console.warn('save-teams', e);
    toast('No se pudo guardar');
  }
}

/* ====== Panel derecho (plantel) ====== */
let teamsInDiv = []; // [{ name, slug }]

function buildPlayersUI(values){
  const cont = $('#players'); cont.innerHTML = '';
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

function fillTeamSelect(){
  const sel = $('#teamSelect'); sel.innerHTML = '';
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
  refreshDraftButtons();
  await changeTeam();
  toast('Borrador descartado');
}

/* === Cargar jugadores desde /equipos/<slug>.players.js o .json === */
function getPlayersFromGlobal(slug){
  try {
    const m = window.LPI_TEAM_PLAYERS || {};
    const arr = m[slug];
    return Array.isArray(arr) ? arr.slice(0, SLOTS) : null;
  } catch { return null; }
}
  async function loadPlayersForTeam(slug){

  try {

    const r = await fetch(`/api/team-assets?team=${encodeURIComponent(slug)}`, {
      cache: 'no-store'
    });

    if (!r.ok) {
      throw new Error('No se pudo cargar el plantel');
    }

    const data = await r.json();

    if (Array.isArray(data.players)) {
      return data.players.slice(0, SLOTS);
    }

  } catch (e) {
    console.warn('loadPlayersForTeam', e);
  }

  return Array(SLOTS).fill('');
}
  // 1) Intento JS
  try {
    if (window.LPI_TEAM_PLAYERS && window.LPI_TEAM_PLAYERS[slug]) {
      delete window.LPI_TEAM_PLAYERS[slug];
    }
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `${EQUIPOS_DIR}${slug}.players.js?t=${Date.now()}`;
      s.onload = () => res();
      s.onerror = () => { s.remove(); rej(new Error('no-js')); };
      document.head.appendChild(s);
    });
    const arr = getPlayersFromGlobal(slug);
    if (arr) return arr;
  } catch(e) { /* sigue */ }

  // 2) Fallback JSON
  try {
    const r = await fetch(`${EQUIPOS_DIR}${slug}.players.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j.players)) return j.players.slice(0, SLOTS);
    }
  } catch(e) { /* nada */ }

  // 3) Nada
  return Array(SLOTS).fill('');
}

/* === Cambio de equipo (async) === */
async function changeTeam(){
  const teamSlug = $('#teamSelect').value;
  let vals = await loadPlayersForTeam(teamSlug);
  while (vals.length < SLOTS) vals.push('');
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
  const players  = getCurrentValues().slice(0,SLOTS);
  try{
    const resp = await fetch('/api/save-team-assets', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ slug: teamSlug, teamName, players })
    });
    const json = await resp.json().catch(()=> ({}));
    if(!resp.ok || !json.ok){ throw new Error(json?.error || 'Error al guardar'); }
    window.LPI_TEAM_PLAYERS = window.LPI_TEAM_PLAYERS || {};
    window.LPI_TEAM_PLAYERS[teamSlug] = players.slice(0,SLOTS);
    clearDraft(_activeDiv, teamSlug);
    refreshDraftButtons();
    toast('Guardado correctamente');
  }catch(e){
    console.warn(e); toast('Error al guardar');
  }
}

/* ====== Carga de división (compartida para ambos paneles) ====== */
let _currentScript = null;
let _activeDiv = 'primera';
async function loadDivision(div){
  _activeDiv = div;
  $$('.sw').forEach(btn => {
    const on = btn.dataset.div === div;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  try { delete window.LPI_USERS; } catch {}
  if(_currentScript){ _currentScript.remove(); _currentScript = null; }

  const src = FILES[div];
  if(!src){ renderRows([]); teamsInDiv=[]; fillTeamSelect(); buildPlayersUI([]); return; }

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = () => { _currentScript = s; resolve(); };
    s.onerror = () => { if(s && s.parentNode) s.parentNode.removeChild(s); reject(new Error('No se pudo cargar '+src)); };
    document.head.appendChild(s);
  }).catch(err => { console.warn(err); toast('No se pudo cargar '+src); });

  const users = Array.isArray(window.LPI_USERS) ? window.LPI_USERS : [];
  renderRows(users);

  // preparar panel derecho
  teamsInDiv = users.filter(u => u && u.role==='team').map(u => ({ name: u.username, slug: (u.slug||slugify(u.username)) }));
  fillTeamSelect();
  const last = getLast();
  const fallback = teamsInDiv[0]?.slug || '';
  const wantSlug = (last.division===div && last.team) ? last.team : fallback;
  if (wantSlug) { $('#teamSelect').value = wantSlug; changeTeam(); }
}

/* ====== Init ====== */
document.addEventListener('DOMContentLoaded', () => {
  $$('.sw').forEach(btn => btn.addEventListener('click', () => loadDivision(btn.dataset.div)));
  $('#btnSaveTeams').addEventListener('click', saveTeams);
  $('#btnSaveRoster').addEventListener('click', saveRoster);
  $('#teamSelect').addEventListener('change', changeTeam);
  $('#btnToggleImport')?.addEventListener('click', () => toggleImportBox());
  $('#btnApplyImport')?.addEventListener('click', importPlayersFromTextarea);
  $('#btnCancelImport')?.addEventListener('click', () => toggleImportBox(false));
  $('#btnExportRoster')?.addEventListener('click', exportRoster);

  buildPlayersUI(Array(SLOTS).fill(''));
  refreshDraftButtons();
  const last = getLast();
  loadDivision(last.division || 'primera');
});

// === Cambio de contraseña (admin) ===
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
    fetch('/api/admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
})();;

// === Toggles "Mostrar" para contraseñas ===
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
      // Estado inicial
      update();
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wirePasswordToggles);
  } else {
    wirePasswordToggles();
  }
})();
