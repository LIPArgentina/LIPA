// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

(function(){
  function localSlugify(s){
    return String(s||'').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'')
      .trim().replace(/\s+/g,'-').replace(/-+/g,'-');
  }
  function computeSlug(){
    try{
      var sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
      if (sess && sess.slug) return localSlugify(sess.slug);
    }catch(_){}
    try{
      var sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
      if (sess2 && (sess2.slug || sess2.team)) return localSlugify(sess2.slug || sess2.team);
    }catch(_){}
    var m = (location.pathname||'').match(/\/equipos\/([^\/]+)\.html$/i);
    if (m) return localSlugify(m[1]);
    var file = (location.pathname.split('/').pop()||'').replace(/\.html$/i,'');
    if (file) return localSlugify(file);
    return '';
  }

  var slug = computeSlug();
if (!slug){ console.warn('No se pudo determinar el slug del equipo'); return; }

fetch(APP_CONFIG.API_BASE_URL + '/api/team/players?team=' + slug, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin'
  })
    .then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data){
      window.LPI_PLAYERS = Array.isArray(data && data.players) ? data.players : [];
      if (data && data.teamName) {
        window.LPI_TEAM_NAME = window.LPI_TEAM_NAME || {};
        window.LPI_TEAM_NAME[slug] = data.teamName;
      }
      window.__LPI_players_ready = true;
      document.dispatchEvent(new Event('lpi:players-ready'));
    })
    .catch(function(err){
      console.error('No se pudo cargar jugadores por API:', err);
    });
})();

(function(){
  try{
    const url = new URL(location.href);
    if (url.searchParams.has('team')) {
      url.searchParams.delete('team');
      history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  }catch(_){ }
})();

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

    function slugify(s){
      return String(s||'')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9\s-]/g,'')
        .trim()
        .replace(/\s+/g,'-')
        .replace(/-+/g,'-');
    }
    function deriveTeam(){
      try {
        const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
        if (sess && sess.slug) return slugify(sess.slug);
      } catch(_) {}
      try {
        const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
        if (sess2 && (sess2.slug || sess2.team)) return slugify(sess2.slug || sess2.team);
      } catch(_) {}
      const m = location.pathname.match(/\/equipos\/([^\/]+)\.html$/i);
      if (m) return slugify(m[1]);
      const file = (location.pathname.split('/').pop()||'').replace(/\.html$/i,'');
      if (file) return slugify(file);
      return '';
    }

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

/* ========= AUTH persistente (con fallback para file://) ========= */
const AUTH_KEY = 'lpi_auth';
function tryParse(s){ try{ return JSON.parse(s || '{}'); } catch { return {}; } }
function setAuth(user, days=7){
  const exp = Date.now() + days*864e5;
  const auth = { user, exp };
  try{ localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); }catch{}
  try{ sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth)); }catch{}
  try{ const wn = tryParse(window.name); wn.lpi = auth; window.name = JSON.stringify(wn); }catch{}
}
function clearAuth(){
  try{ localStorage.removeItem(AUTH_KEY); }catch{}
  try{ sessionStorage.removeItem(AUTH_KEY); }catch{}
  try{ const wn = tryParse(window.name); delete wn.lpi; window.name = JSON.stringify(wn); }catch{}
}
function getAuth(){
  let obj=null, raw=null;
  try{ raw = localStorage.getItem(AUTH_KEY); if(raw) obj = JSON.parse(raw); }catch{}
  if(!obj){ try{ raw = sessionStorage.getItem(AUTH_KEY); if(raw) obj = JSON.parse(raw); }catch{} }
  if(!obj){ try{ const wn = tryParse(window.name); if(wn.lpi) obj = wn.lpi; }catch{} }
  if(!obj){
    const u = new URLSearchParams(location.search).get('u');
    if(u) obj = { user: decodeURIComponent(u), exp: Date.now()+7*864e5 };
  }
  if(obj && obj.exp && Date.now()>obj.exp){ clearAuth(); obj=null; }
  if(obj){
    try{ localStorage.setItem(AUTH_KEY, JSON.stringify(obj)); }catch{}
    try{ sessionStorage.setItem(AUTH_KEY, JSON.stringify(obj)); }catch{}
    try{ const wn = tryParse(window.name); wn.lpi = obj; window.name = JSON.stringify(wn); }catch{}
  }
  return obj;
}
function logoutAuth(){ clearAuth(); }

/* ====== Header: badge + logout ====== */
document.addEventListener('DOMContentLoaded', ()=>{
  const auth = getAuth();
  const actions = document.getElementById('headerActions');

  if(auth && actions){
    const badge = document.createElement('span');
    badge.className = 'user-badge';
    badge.textContent = `Hola, ${auth.user}`;

    const btn = document.createElement('button');
    btn.className = 'btn-logout';
    btn.type = 'button';
    btn.textContent = 'Cerrar sesión';
    btn.addEventListener('click', ()=>{
      logoutAuth();
      location.href = '../index.html';
    });

    actions.append(badge, btn);
  }

  // Si abrís con file://, transportar el usuario en el clic del logo
  const logo = document.querySelector('a.logo-link');
  if(logo && location.protocol === 'file:' && auth?.user){
    logo.addEventListener('click', (e)=>{
      e.preventDefault();
      const url = new URL(logo.getAttribute('href'), location.href);
      url.searchParams.set('u', encodeURIComponent(auth.user));
      location.href = url.toString();
    });
  }
});

/* =========================
   Tu DnD original
   ========================= */
const alertBox = document.getElementById('alert');
function showAlert(msg) {
  alertBox.textContent = msg;
  alertBox.style.display = 'block';
  setTimeout(() => alertBox.style.display = 'none', 2000);
}

function showToastOK(msg){
const prevBg = alertBox.style.background;
const prevBorder = alertBox.style.border;
const prevColor = alertBox.style.color;
const prevTop = alertBox.style.top;
const prevBottom = alertBox.style.bottom;
const prevLeft = alertBox.style.left;
const prevTransform = alertBox.style.transform;

alertBox.textContent = msg;

// Toast OK: negro y abajo (centrado). Cambios temporales SOLO para este aviso.
alertBox.style.background = '#000';
alertBox.style.border = '2px solid #777';
alertBox.style.color = '#fff';
  alertBox.style.padding = '10px 16px';
  alertBox.style.height = 'auto';
  alertBox.style.maxHeight = 'none';
  alertBox.style.maxWidth = '520px';
  alertBox.style.width = 'auto';
  alertBox.style.whiteSpace = 'normal';
  alertBox.style.textAlign = 'center';
alertBox.style.top = 'auto';
alertBox.style.bottom = '24px';
alertBox.style.left = '50%';
alertBox.style.transform = 'translateX(-50%)';
alertBox.style.display = 'block';

setTimeout(() => {
  alertBox.style.display = 'none';
  // Restaurar estilos originales para no afectar el toast de error ni el DnD
  alertBox.style.background = prevBg;
  alertBox.style.border = prevBorder;
  alertBox.style.color = prevColor;
  alertBox.style.top = prevTop;
  alertBox.style.bottom = prevBottom;
  alertBox.style.left = prevLeft;
  alertBox.style.transform = prevTransform;
}, 2000);
}

let draggedPlayer = null;
let originBox = null;
const trash = document.getElementById('trash');

function computeCountsExcludingOrigin() {
  const allBoxes = Array.from(document.querySelectorAll('.yellow-box'));
  const players = allBoxes.map(b => b.dataset.player).filter(p => p);
  const counts = {};
  players.forEach(p => counts[p] = (counts[p] || 0) + 1);
  if(originBox && originBox.dataset.player) {
    const name = originBox.dataset.player;
    counts[name] = (counts[name] || 0) - 1;
    if(counts[name] <= 0) delete counts[name];
  }
  return counts;
}

function updateRepeatedHighlight() {
  const boxes = document.querySelectorAll('.yellow-box');
  const players = Array.from(boxes).map(b => b.dataset.player).filter(p => p);
  const counts = {};
  players.forEach(p => counts[p] = (counts[p] || 0) + 1);
  const repeated = Object.keys(counts).filter(name => counts[name] >= 2);
  boxes.forEach(b => b.classList.remove('repeated'));
  boxes.forEach(b => {
    if(repeated.includes(b.dataset.player)) b.classList.add('repeated');
  });
}

// Drag desde la lista de jugadores (filas)
document.querySelectorAll('.fila').forEach(el => {
  el.addEventListener('dragstart', e => {
    draggedPlayer = el.querySelector('.jugador').textContent;
    originBox = null;
    trash.style.display = 'flex';
  });
  el.addEventListener('dragend', e => {
    draggedPlayer = null;
    originBox = null;
    trash.style.display = 'none';
  });
});

// Drag & Drop para casilleros
document.querySelectorAll('.yellow-box').forEach(box => {
  box.addEventListener('dragstart', e => {
    if(box.dataset.player) {
      draggedPlayer = box.dataset.player;
      originBox = box;
      trash.style.display = 'flex';
    } else {
      e.preventDefault();
    }
  });
  box.addEventListener('dragend', e => {
    draggedPlayer = null;
    originBox = null;
    trash.style.display = 'none';
    box.classList.remove('valid','invalid','over');
  });

  box.addEventListener('dragover', e => {
    e.preventDefault();
    if(!draggedPlayer) return;
    const gc = box.closest('.group-container');
    if (gc && (gc.dataset.group === 'suplentes' || gc.dataset.free === 'true')) {
      box.classList.remove('valid','invalid','over');
      box.classList.add('over','valid');
      return;
    }

    const groupContainer = box.closest('.group-container');
    const counts = computeCountsExcludingOrigin();
    const countDragged = counts[draggedPlayer] || 0;
    const inSameGroup = Array.from(groupContainer.querySelectorAll('.yellow-box'))
                             .some(b => b.dataset.player === draggedPlayer);
    const repeatedPlayers = Object.keys(counts).filter(name => counts[name] >= 2);

    box.classList.remove('valid','invalid','over'); box.classList.add('over');

    if (inSameGroup) {
      box.classList.add('invalid');
    } else if (countDragged >= 2) {
      box.classList.add('invalid');
    } else if (repeatedPlayers.length > 0 && !repeatedPlayers.includes(draggedPlayer) && countDragged >= 1) {
      box.classList.add('invalid');
    } else {
      box.classList.add('valid');
    }
  });

  box.addEventListener('dragleave', e => {
    box.classList.remove('valid','invalid','over');
  });

  box.addEventListener('drop', e => {
    e.preventDefault();
    if(!draggedPlayer) return;
    box.classList.remove('valid','invalid','over');
    const gc2 = box.closest('.group-container');
    if (gc2 && (gc2.dataset.group === 'suplentes' || gc2.dataset.free === 'true')) {
      box.dataset.player = draggedPlayer;
      box.textContent = draggedPlayer;
      if (originBox && originBox !== box) {
        originBox.dataset.player = "";
        originBox.textContent = "";
        originBox = null;
      }
      updateRepeatedHighlight();
      return;
    }

    const groupContainer = box.closest('.group-container');
    const counts = computeCountsExcludingOrigin();
    const countDragged = counts[draggedPlayer] || 0;
    const inSameGroup = Array.from(groupContainer.querySelectorAll('.yellow-box'))
                             .some(b => b.dataset.player === draggedPlayer);
    const repeatedPlayers = Object.keys(counts).filter(name => counts[name] >= 2);

    if (inSameGroup) { showAlert("No se puede repetir dentro del mismo grupo"); return; }
    if (countDragged >= 2) { showAlert("Este jugador ya alcanzó el máximo de apariciones (2)."); return; }
    if (repeatedPlayers.length > 0 && !repeatedPlayers.includes(draggedPlayer) && countDragged >= 1) {
      showAlert("Ya hay un jugador repetido, no se puede repetir otro.");
      return;
    }

    box.dataset.player = draggedPlayer;
    box.textContent = draggedPlayer;

    if (originBox && originBox !== box) {
      originBox.dataset.player = "";
      originBox.textContent = "";
      originBox = null;
    }

    updateRepeatedHighlight();
  });
});

// Papelera
trash.addEventListener('dragover', e => { e.preventDefault(); trash.classList.add('over'); });
trash.addEventListener('dragleave', e => { trash.classList.remove('over'); });
trash.addEventListener('drop', e => {
  e.preventDefault();
  trash.classList.remove('over');
  if(originBox) {
    originBox.dataset.player = "";
    originBox.textContent = "";
    originBox = null;
    updateRepeatedHighlight();
  }
  draggedPlayer = null;
  trash.style.display = 'none';
});

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

// Carga de nombres hacia la columna "JUGADORES" (robusta, espera a que estén listos)
(function() {
  function selectPlayers() {
    if (Array.isArray(window.LPI_PLAYERS)) return window.LPI_PLAYERS;
    if (Array.isArray(window.LPI_JUGADORES)) return window.LPI_JUGADORES;
    const map = window.LPI_TEAM_PLAYERS;
    if (map && typeof map === "object") {
      const prefer = [ deriveTeam() ];
      for (const k of prefer) if (Array.isArray(map[k])) return map[k];
      const keys = Object.keys(map);
      for (const k of keys) if (Array.isArray(map[k])) return map[k];
    }
    return [];
  }
  function fillJugadores(){
    const jugadores = selectPlayers().map(x => String(x||'').trim()).filter(Boolean);
    const slots = document.querySelectorAll(".jugadores-container .fila .jugador");
    slots.forEach((div, i) => { if (i < jugadores.length) div.textContent = jugadores[i]; });
  }
  document.addEventListener("DOMContentLoaded", function () {
    let tries = 0;
    function tryFill(){
      try {
        const haveData = !!(window.LPI_PLAYERS || window.LPI_JUGADORES || (window.LPI_TEAM_PLAYERS && Object.keys(window.LPI_TEAM_PLAYERS||{}).length));
        if (!haveData && tries < 20){ tries++; return setTimeout(tryFill, 100); }
        fillJugadores();
      } catch (e) {
        console.error("Error rellenando jugadores:", e);
      }
    }
    if (window.__LPI_players_ready) fillJugadores();
    else {
      document.addEventListener('lpi:players-ready', fillJugadores, { once:true });
      tryFill();
    }
  });
})();

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

// ===== Botones "Volver" + "Cambiar contraseña" en header =====
(function(){
  function ensureButtons(){
    var header = document.getElementById('headerActions');
    if(!header) return;
    // Volver
    var volver = document.createElement('a');
    volver.href = '../index.html';
    volver.textContent = 'Volver';
    volver.className = 'btn-logout';
    volver.style.textDecoration = 'none';
    // Cambiar contraseña
    var change = document.createElement('button');
    change.type = 'button';
    change.id = 'btnChangePassTop';
    change.textContent = 'Cambiar contraseña';
    change.className = 'btn-logout'; // mismo look visual
    change.style.background = '#d4af37'; // dorado suave
    change.style.color = '#111';
    change.style.borderColor = '#d4af37';
    change.style.fontWeight = '800';

    header.appendChild(change);
    header.appendChild(volver);
  }
  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureButtons);
  } else {
    ensureButtons();
  }
})();

// ===== Lógica cambio de contraseña (equipo) =====
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
  var passModal = document.getElementById('passModal');
  function openModal(){
    if(!passModal) return;
    document.getElementById('oldPass').value = '';
    document.getElementById('newPass').value = '';
    document.getElementById('newPass2').value = '';
    document.getElementById('passError').style.display = 'none';
    document.getElementById('passSuccess').style.display = 'none';
    passModal.showModal();
  }
  function wireOpen(){
    var btn = document.getElementById('btnChangePassTop');
    if(btn) btn.addEventListener('click', openModal);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wireOpen);
  } else { wireOpen(); }

  function submitPass(ev){
    ev.preventDefault();
    var oldPass = document.getElementById('oldPass').value;
    var newPass = document.getElementById('newPass').value;
    var newPass2 = document.getElementById('newPass2').value;
    var err = document.getElementById('passError');
    var ok = document.getElementById('passSuccess');
    if(!oldPass || !newPass || newPass !== newPass2){
      err.textContent = 'Revisá los campos';
      err.style.display = 'block';
      ok.style.display = 'none';
      return;
    }
    var slug = getTeamSlug();
    fetch('/api/team/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: slug, oldPassword: oldPass, newPassword: newPass })
    })
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json().catch(function(){return {};}); })
    .then(function(){
      err.style.display = 'none';
      ok.style.display = 'block';
      setTimeout(function(){ if(passModal && passModal.close) passModal.close(); }, 800);
    })
    .catch(function(){
      err.textContent = 'No se pudo actualizar.';
      err.style.display = 'block';
      ok.style.display = 'none';
    });
  }
  function wireSubmit(){
    var btn = document.getElementById('submitPass');
    if(btn) btn.addEventListener('click', submitPass);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wireSubmit);
  } else { wireSubmit(); }
})();

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

(function(){
  const passModal = document.getElementById("passModal");
  if (!passModal) return;

  passModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { try { passModal.close(); } catch(_){} }
  });

  passModal.addEventListener("click", (e) => {
    const panel = passModal.querySelector(".modal__panel");
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) {
      try { passModal.close(); } catch(_){}
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target && e.target.matches('input[type="checkbox"][data-toggle]')) {
      const sel = e.target.getAttribute("data-toggle");
      const input = document.querySelector(sel);
      if (input) input.type = e.target.checked ? "text" : "password";
    }
  });
})();

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

(function(){
  if (window.__LPI_UNIFIED_READY) return; // evitar duplicado si ya existe
  window.__LPI_UNIFIED_READY = true;

  function once(fn){ let ran=false; return function(){ if(!ran){ ran=true; try{ fn.apply(this, arguments); this.__ran=true; }catch(_){} } } }

  // Buscar función de rellenado si existe
  var fill = (typeof window.fillJugadores === 'function') ? window.fillJugadores : null;

  // Handler principal: usa el detalle de players si viene, o delega al fill existente
  var handle = once(function(ev){
    try{
      var detail = ev && ev.detail || {};
      if (detail && Array.isArray(detail.players) && typeof window.renderPlayers === 'function'){
        // Si la página expone renderPlayers(lista), úsalo directamente
        window.renderPlayers(detail.players);
      } else if (fill){
        fill(); // la función interna sabe cómo leer jugadores globales/estado
      }
    }catch(_){}
  });

  window.addEventListener('lpi:players-ready', handle, { once: true });

  // Fallback: si por alguna razón no llega el evento, intentamos una sola vez más
  setTimeout(function(){
    try{
      // Si ya corrió el handler, nada; si no, invocamos fill si está
      if (!handle.__ran && fill) fill();
    }catch(_){}
  }, 300);

})();

async function savePlanilla(){
    const pick = (group) => {
      const sel = `.group-container[data-group="${group}"] .yellow-box`;
      return Array.from(document.querySelectorAll(sel)).map(x => (x.dataset.player || '').trim());
    };
    const pickFree = () => Array.from(document.querySelectorAll('.yellow-box-free')).map(x => (x.dataset.player || '').trim());
    const team = (typeof deriveTeam === 'function') ? deriveTeam() : '';

    const payloadObj = {
      team,
      createdAt: new Date().toISOString(),
      individuales: pick('individual'),
      pareja1: pick('pareja1'),
      pareja2: pick('pareja2'),
      suplentes: pick('suplentes'),
      capitan: pickFree()
    };

    try {
      const r = await fetch('/api/save-planilla', {
        method: 'POST',
        headers: LPI_getAuthHeaders(),
        body: JSON.stringify({ planilla: payloadObj })
      });
      if (!r.ok) {
        const t = await r.text().catch(()=> '');
        if (typeof showAlert === 'function') showAlert('No se pudo guardar la planilla: ' + (t || ('HTTP ' + r.status)));
        return { ok:false };
      }
      const json = await r.json().catch(() => ({}));
      if (json && json.ok) {
        if (typeof showToastOK === 'function') showToastOK('Enviada correctamente');
      } else {
        if (typeof showAlert === 'function') showAlert('No se pudo guardar la planilla.');
      }
      return json;
    } catch (e) {
      if (typeof showAlert === 'function') showAlert('Error de red al guardar la planilla.');
      return { ok:false, error: String((e && e.message) || e) };
    }
  }

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

document.addEventListener('DOMContentLoaded', function(){
  var btn = document.getElementById('btnEnviar');
  if (btn) btn.addEventListener('click', savePlanilla);
});

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

(function(){
  function slugify(s){
    return String(s||'').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'')
      .trim().replace(/\s+/g,'-').replace(/-+/g,'-');
  }
  function getSlug(){
    try{ const sess = JSON.parse(localStorage.getItem('lpi.session')||sessionStorage.getItem('lpi.session')||'null'); if (sess && sess.slug) return slugify(sess.slug); }catch(_){}
    try{ const sess2 = JSON.parse(localStorage.getItem('lpi_team_session')||sessionStorage.getItem('lpi_team_session')||'null'); if (sess2 && (sess2.slug || sess2.team)) return slugify(sess2.slug || sess2.team); }catch(_){}
    const f = (location.pathname.split('/').pop()||'').replace(/\.html$/i,''); if (f) return slugify(f);
    return '';
  }
  function pickTeamName(slug){
    // Preferir nombres publicados por el players.js
    var NAMES = window.LPI_TEAM_NAME || window.TEAM_NAMES || null;
    if (NAMES && (NAMES[slug] || NAMES[String(slug)])) return NAMES[slug] || NAMES[String(slug)];
    // Fallback a storage
    var sess = null;
    try{ sess = JSON.parse(localStorage.getItem('lpi.session')||sessionStorage.getItem('lpi.session')||'null'); }catch(_){}
    if (sess && sess.displayName) return sess.displayName;
    return slug ? slug.toUpperCase() : 'EQUIPO';
  }
  function setBadge(){
    var el = document.getElementById('teamNameBadge');
    if (!el) return;
    var slug = getSlug();
    el.textContent = pickTeamName(slug);
    document.title = (pickTeamName(slug) || 'Equipo').toString().toUpperCase();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setBadge);
  } else {
    setBadge();
  }
  // Reintentar cuando el players.js haya cargado y expuesto NAMES
  document.addEventListener('lpi:players-ready', setBadge, { once: true });
})();

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

// DnD sin validación para CAPITÁN (no participa de las reglas)
(function(){
  function wireFree(box){
    box.addEventListener('dragstart', function(e){
      if (box.dataset.player) { draggedPlayer = box.dataset.player; originBox = box; trash.style.display='flex'; }
      else { e.preventDefault(); }
    });
    box.addEventListener('dragend', function(){ draggedPlayer=null; originBox=null; trash.style.display='none'; });
    box.addEventListener('dragover', function(e){ e.preventDefault(); });
    box.addEventListener('drop', function(e){
      e.preventDefault();
      if (!draggedPlayer) return;
      box.dataset.player = draggedPlayer;
      box.textContent = draggedPlayer;
      if (originBox && originBox !== box) {
        originBox.dataset.player = "";
        originBox.textContent = "";
        originBox = null;
      }
    });
  }
  function initFree(){
    document.querySelectorAll('.yellow-box-free').forEach(wireFree);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFree);
  else initFree();
})();

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

// === Shim unificado con Pointer Events (touch/pen) para Drag & Drop ===
(function(){
  if (window.__LPI_POINTER_SHIM__) return;
  window.__LPI_POINTER_SHIM__ = true;

  let dragging = false;
  let pointerId = null;

  function closestDrop(target){
    if (!target) return null;
    return target.closest('.yellow-box, .yellow-box-free, #trash');
  }
  function getPlayerFromElement(el){
    if (!el) return "";
    if (el.classList && el.classList.contains('fila')) {
      const j = el.querySelector('.jugador');
      return (j && j.textContent || '').trim();
    }
    if (el.classList && (el.classList.contains('yellow-box') || el.classList.contains('yellow-box-free'))) {
      return (el.dataset && el.dataset.player) ? String(el.dataset.player).trim() : "";
    }
    return "";
  }

  function startDragFrom(el){
    const p = getPlayerFromElement(el);
    if (!p) return false;
    try {
      window.draggedPlayer = p;
      window.originBox = (el.classList.contains('yellow-box') || el.classList.contains('yellow-box-free')) ? el : null;
      const trashEl = document.getElementById('trash');
      if (trashEl) trashEl.style.display = 'flex';
    } catch(_) {}
    return true;
  }

  function onPointerDown(e){
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    const t = e.target.closest('.fila, .yellow-box, .yellow-box-free');
    if (!t) return;

    const ok = startDragFrom(t);
    if (!ok) return;

    dragging = true;
    pointerId = e.pointerId;
    if (t.setPointerCapture) { try { t.setPointerCapture(pointerId); } catch(_){ } }
    e.preventDefault();
  }

  function onPointerMove(e){
    if (!dragging || e.pointerId !== pointerId) return;
    e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    document.querySelectorAll('.yellow-box.over, .yellow-box.valid, .yellow-box.invalid, #trash.over')
      .forEach(b => b.classList.remove('over','valid','invalid'));
    const over = closestDrop(el);
    if (over){
      over.classList.add('over');
      if (over.id !== 'trash') {
        const gc = over.closest('.group-container');
        if (gc && (gc.dataset.group === 'suplentes' || gc.dataset.free === 'true')) {
          over.classList.add('valid');
        }
      }
    }
  }

  function dispatchDropOn(target){
    if (!target) return;
    try {
      const ev = new Event('drop', { bubbles: true, cancelable: true });
      target.dispatchEvent(ev);
    } catch(_){}
  }

  function cleanup(){
    document.querySelectorAll('.yellow-box.over, .yellow-box.valid, .yellow-box.invalid, #trash.over')
      .forEach(b => b.classList.remove('over','valid','invalid'));
    const trashEl = document.getElementById('trash');
    if (trashEl) trashEl.style.display = 'none';
    try { window.draggedPlayer = null; window.originBox = null; } catch(_){}
    dragging = false;
    pointerId = null;
  }

  function onPointerUp(e){
    if (!dragging || e.pointerId !== pointerId) return;
    e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const dropTarget = closestDrop(el);
    if (dropTarget) dispatchDropOn(dropTarget);
    cleanup();
  }

  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp, { passive: false });
  document.addEventListener('pointercancel', onPointerUp, { passive: false });
})();

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

// ===== Tap-to-place (fallback para touch) =====
(function(){
  if (window.__LPI_TAP_PLACE__) return;
  window.__LPI_TAP_PLACE__ = true;

  var isTouchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  if (!isTouchCapable) return;

  var selectedPlayer = null;
  var selectedOrigin = null;

  function clearHints(){
    document.querySelectorAll('.tap-hint, .tap-selecting').forEach(function(n){
      n.classList.remove('tap-hint','tap-selecting');
    });
  }
  function showTrash(show){
    var t = document.getElementById('trash');
    if (t) t.style.display = show ? 'flex' : 'none';
  }

  function startSelectionFromElement(el){
    clearHints();
    var p = '';
    if (el.classList.contains('fila')){
      var j = el.querySelector('.jugador');
      p = (j && j.textContent || '').trim();
      selectedOrigin = null;
    } else if (el.classList.contains('yellow-box') || el.classList.contains('yellow-box-free')){
      p = (el.dataset && el.dataset.player) ? String(el.dataset.player).trim() : '';
      selectedOrigin = el;
    }
    if (!p) return false;
    selectedPlayer = p;
    el.classList.add('tap-selecting');
    showTrash(true);
    document.querySelectorAll('.yellow-box, .yellow-box-free').forEach(function(b){
      b.classList.add('tap-hint');
    });
    return true;
  }

  function computeCountsExcludingOrigin(){
    try {
      if (typeof window.computeCountsExcludingOrigin === 'function'){
        return window.computeCountsExcludingOrigin();
      }
    } catch(_){}
    var allBoxes = Array.from(document.querySelectorAll('.yellow-box'));
    var players = allBoxes.map(function(b){ return b.dataset.player; }).filter(Boolean);
    var counts = {};
    players.forEach(function(p){ counts[p] = (counts[p]||0)+1; });
    if (selectedOrigin && selectedOrigin.dataset && selectedOrigin.dataset.player){
      var nm = selectedOrigin.dataset.player;
      counts[nm] = (counts[nm]||0) - 1;
      if (counts[nm] <= 0) delete counts[nm];
    }
    return counts;
  }

  function applyPlacementToBox(box){
    var gc2 = box.closest('.group-container');
    if (gc2 && (gc2.dataset.group === 'suplentes' || gc2.dataset.free === 'true')) {
      box.dataset.player = selectedPlayer;
      box.textContent = selectedPlayer;
      if (selectedOrigin && selectedOrigin !== box) {
        selectedOrigin.dataset.player = "";
        selectedOrigin.textContent = "";
        selectedOrigin = null;
      }
      try { if (typeof window.updateRepeatedHighlight === 'function') window.updateRepeatedHighlight(); } catch(_){}
      return;
    }

    var groupContainer = box.closest('.group-container');
    var counts = computeCountsExcludingOrigin();
    var countDragged = counts[selectedPlayer] || 0;
    var inSameGroup = Array.from(groupContainer.querySelectorAll('.yellow-box'))
                           .some(function(b){ return b.dataset.player === selectedPlayer; });
    var repeatedPlayers = Object.keys(counts).filter(function(name){ return counts[name] >= 2; });

    if (inSameGroup) { try { window.showAlert && window.showAlert("No se puede repetir dentro del mismo grupo"); } catch(_){}
      return; }
    if (countDragged >= 2) { try { window.showAlert && window.showAlert("Este jugador ya alcanzó el máximo de apariciones (2)."); } catch(_){}
      return; }
    if (repeatedPlayers.length > 0 && repeatedPlayers.indexOf(selectedPlayer) === -1 && countDragged >= 1) {
      try { window.showAlert && window.showAlert("Ya hay un jugador repetido, no se puede repetir otro."); } catch(_){}
      return;
    }

    box.dataset.player = selectedPlayer;
    box.textContent = selectedPlayer;
    if (selectedOrigin && selectedOrigin !== box) {
      selectedOrigin.dataset.player = "";
      selectedOrigin.textContent = "";
      selectedOrigin = null;
    }
    try { if (typeof window.updateRepeatedHighlight === 'function') window.updateRepeatedHighlight(); } catch(_){}
  }

  function endSelection(){
    selectedPlayer = null;
    selectedOrigin = null;
    clearHints();
    showTrash(false);
  }

  document.addEventListener('click', function(e){
    if (selectedPlayer){
      var targetTrash = e.target.id === 'trash' ? e.target : (e.target.closest && e.target.closest('#trash'));
      if (targetTrash){
        if (selectedOrigin){
          selectedOrigin.dataset.player = "";
          selectedOrigin.textContent = "";
          try { if (typeof window.updateRepeatedHighlight === 'function') window.updateRepeatedHighlight(); } catch(_){}
        }
        endSelection();
        e.preventDefault();
        return;
      }
      var dest = e.target.closest && e.target.closest('.yellow-box, .yellow-box-free');
      if (dest){
        applyPlacementToBox(dest);
        endSelection();
        e.preventDefault();
        return;
      }
      endSelection();
      return;
    }
    var src = e.target.closest && e.target.closest('.fila, .yellow-box, .yellow-box-free');
    if (src){
      startSelectionFromElement(src);
      e.preventDefault();
      return;
    }
  }, { passive: false });

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && selectedPlayer){
      endSelection();
    }
  });
})();

// === LPI Auth helper ===
  function LPI_getAuthHeaders(){
    const pass = (window.__lpi_getCaptainPass ? window.__lpi_getCaptainPass() : (sessionStorage.getItem('lpi_team_pass') || localStorage.getItem('lpi_team_pass') || '')).trim();
    return { 'Authorization': 'Bearer ' + pass, 'Content-Type': 'application/json' };
  }

// Guarda el team para cruces y evita exponerlo en la URL pública
(function(){
  try{
    const params = new URLSearchParams(location.search);
    const teamFromUrl = params.get('team');
    const team = teamFromUrl || (typeof deriveTeam === 'function' ? deriveTeam() : '');
    if (team) {
      localStorage.setItem('team', team);
      sessionStorage.setItem('lpi_cruces_team', team);
      localStorage.setItem('lpi_cruces_team', team);
    }

    const btn = document.querySelector('.btn-cruces');
    if (btn) {
      btn.setAttribute('href', '../cruces/cruces_fecha.html');
      btn.addEventListener('click', function(){
        const currentTeam = (typeof deriveTeam === 'function' ? deriveTeam() : team || '');
        if (currentTeam) {
          try { sessionStorage.setItem('lpi_cruces_team', currentTeam); } catch(_){}
          try { localStorage.setItem('lpi_cruces_team', currentTeam); } catch(_){}
        }
      });
    }
  }catch(e){ /* no-op */ }
})();

// === Autocarga de planilla por defecto (hoy o mañana) vía API privada ===
(function(){
  function sameDay(a,b){
    return a && b &&
      a.getFullYear()===b.getFullYear() &&
      a.getMonth()===b.getMonth() &&
      a.getDate()===b.getDate();
  }
  function shouldLoad(createdAt){
    if (!createdAt) return false;
    const d = new Date(createdAt);
    if (isNaN(d)) return false;
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate()+1);
    return sameDay(d, now) || sameDay(d, tomorrow);
  }
  function setBox(el, name){
    if (!el) return;
    const value = (name || '').trim();
    el.dataset.player = value;
    el.textContent = value;
  }
  function fillGroup(group, arr, useFreeBox){
    const selector = '.group-container[data-group="' + group + '"] ' + (useFreeBox ? '.yellow-box-free' : '.yellow-box');
    const boxes = document.querySelectorAll(selector);
    for (let i=0; i<boxes.length; i++){
      setBox(boxes[i], (arr && arr[i]) ? arr[i] : '');
    }
  }
  function applyPlanilla(plan){
    try {
      fillGroup('capitan',     plan.capitan      || [], true);
      fillGroup('individual',  plan.individuales || [], false);
      fillGroup('pareja1',     plan.pareja1      || [], false);
      fillGroup('pareja2',     plan.pareja2      || [], false);
      fillGroup('suplentes',   plan.suplentes    || [], false);
    } catch(_) { }
  }
  async function tryAutoload(){
    try {
      const r = await fetch('/api/team/planilla', {
        method: 'GET',
        cache: 'no-store',
        headers: LPI_getAuthHeaders()
      });
      if (!r.ok) return;
      const j = await r.json().catch(() => ({}));
      const p = j && j.planilla;
      if (p && shouldLoad(p.createdAt)) {
        applyPlanilla(p);
      }
    } catch(_) { }
  }
  if (document.readyState !== 'loading') {
    tryAutoload();
  } else {
    document.addEventListener('DOMContentLoaded', tryAutoload);
  }
})();

// === Control remoto de "ver cruces" (habilitado por admin) ===
(function(){
  function slugify(s){
    return String(s||'').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
  }
  function deriveTeam(){
    try {
      const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
      if (sess && sess.slug) return slugify(sess.slug);
    } catch(_) {}
    try {
      const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
      if (sess2 && (sess2.slug || sess2.team)) return slugify(sess2.slug || sess2.team);
    } catch(_) {}
    try {
      const m = location.pathname.match(/\/equipos\/([^\/]+)\.html$/i);
      if (m) return slugify(m[1]);
    } catch(_) {}
    const file = (location.pathname.split('/').pop()||'').replace(/\.html$/i,'');
    if (file) return slugify(file);
    return '';
  }

  const fechaKey = new Date().toISOString().slice(0,10);
  const btn = document.getElementById('btnVerCruces');
  function setEnabled(on){
    if(!btn) return;
    btn.classList.toggle('is-disabled', !on);
    if(!on){ btn.setAttribute('aria-disabled','true'); btn.title='Esperando habilitación del admin…'; }
    else{ btn.removeAttribute('aria-disabled'); btn.title=''; }
  }
  async function refresh(){
    try{
      const team = deriveTeam() || '*';
      const qs = new URLSearchParams({ team, fechaKey });
      const r = await fetch('/api/cruces/status?' + qs.toString(), { cache:'no-store' });
      const j = await r.json();
      setEnabled(!!(j && j.enabled));
    }catch(_){
      setEnabled(false);
    }
  }

  setEnabled(false);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh, { once:true });
  } else {
    refresh();
  }

  try{
    const es = new EventSource('/api/cruces/stream');
    es.onmessage = (ev)=>{
      try{
        const data = JSON.parse(ev.data||'{}');
        if (data && data.type === 'cruces'){
          const team = deriveTeam() || '*';
          if (!data.team || data.team === '*' || data.team === team){
            if (!data.fechaKey || data.fechaKey === fechaKey){
              refresh();
            }
          }
        }
      }catch(_){}
    };
  }catch(_){}

  setInterval(refresh, 15000);
})();


// ===== Ajuste visual mobile: el mensaje de éxito no empuja el layout =====
document.addEventListener("DOMContentLoaded", function () {
  const posibles = [
    document.getElementById("mensaje-exito"),
    document.querySelector(".success-message"),
    document.querySelector(".mensaje-exito")
  ].filter(Boolean);

  posibles.forEach(el => {
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.bottom = "16px";
    el.style.transform = "translateX(-50%)";
    el.style.zIndex = "9999";
    el.style.margin = "0";
  });
});

