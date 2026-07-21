
function redirectToLogin() {
  try {
    localStorage.removeItem("lpi.session");
    sessionStorage.removeItem("lpi.session");
    localStorage.removeItem("lpi_team_session");
    sessionStorage.removeItem("lpi_team_session");
  } catch (_) {}

  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/auth/login.html?next=${next}&reason=auth`;
}

async function fetchWithAuth(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401 || res.status === 403) {
    redirectToLogin();
    throw new Error("No autenticado");
  }
  return res;
}



  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }

  function LPI_getApiBase(){
    try{
      return (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? String(window.APP_CONFIG.API_BASE_URL) : '').replace(/\/$/, '');
    }catch(_){
      return '';
    }
  }

  function LPI_apiUrl(path){
    const p = String(path || '');
    const base = LPI_getApiBase();
    return base + (p.startsWith('/') ? p : '/' + p);
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

  var slug = (typeof deriveTeamKey === 'function' ? deriveTeamKey() : computeSlug());
  if (!slug){ console.warn('No se pudo determinar el slug del equipo'); return; }

  function normalizePlayersPayload(data){
    return Array.isArray(data && data.players) ? data.players : [];
  }

  function applyPlayersPayload(data){
    window.LPI_PLAYER_DETAILS = Array.isArray(data && data.playerDetails) ? data.playerDetails : [];
    window.LPI_PLAYERS = window.LPI_PLAYER_DETAILS.length
      ? window.LPI_PLAYER_DETAILS.map(function(player){ return player.name || player.nombre || ''; }).filter(Boolean)
      : normalizePlayersPayload(data);
    window.LPI_CAPTAINS = [
      data && (data.captain || data.capitan),
      data && (data.subcaptain || data.subcapitan)
    ].filter(function(name){ return String(name || '').trim(); });
    if (data && data.teamName) {
      window.LPI_TEAM_NAME = window.LPI_TEAM_NAME || {};
      window.LPI_TEAM_NAME[slug] = data.teamName;
    }
    window.__LPI_players_ready = true;
    document.dispatchEvent(new Event('lpi:players-ready'));
  }

  function fetchJson(url){
    return fetchWithAuth(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      headers: LPI_getAuthHeaders()
    }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);
      return r.json();
    });
  }

  fetchJson(LPI_apiUrl('/api/team-assets?team=' + encodeURIComponent(slug)))
    .catch(function(err){
      console.warn('No se pudo cargar jugadores desde /api/team-assets, pruebo fallback:', err);
      return fetchJson(LPI_apiUrl('/api/team/players?team=' + encodeURIComponent(slug)));
    })
    .then(function(data){
      applyPlayersPayload(data);
    })
    .catch(function(err){
      console.error('No se pudo cargar jugadores por API:', err);
      window.LPI_PLAYERS = [];
      window.__LPI_players_ready = true;
      document.dispatchEvent(new Event('lpi:players-ready'));
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


(function(){
  var croppedPlayerCardPhoto = null;

  function getHeadersForFormData(){
    var headers = {};
    try {
      headers = LPI_getAuthHeaders ? LPI_getAuthHeaders() : {};
      delete headers["Content-Type"];
      delete headers["content-type"];
    } catch(_) {}
    return headers;
  }

  function playerPhotoSrc(player){
    if (player && player.fotoUrl) return LPI_apiUrl(player.fotoUrl);
    return '../logo_liga.png';
  }

  function formatBirthForDisplay(value){
    var raw = String(value || '').trim();
    var iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
    var display = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (display) return raw;
    return '';
  }

  function formatBirthForApi(value){
    var raw = String(value || '').trim();
    var iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      var isoDate = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      if (isoDate.getFullYear() === Number(iso[1]) && isoDate.getMonth() === Number(iso[2]) - 1 && isoDate.getDate() === Number(iso[3])) return raw;
      return '';
    }
    var display = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!display) return '';
    var day = Number(display[1]);
    var month = Number(display[2]);
    var year = Number(display[3]);
    var date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
    return display[3] + '-' + display[2] + '-' + display[1];
  }

  function normalizeBirthTyping(input){
    var digits = String(input.value || '').replace(/\D/g, '').slice(0, 8);
    var parts = [];
    if (digits.length > 0) parts.push(digits.slice(0, 2));
    if (digits.length > 2) parts.push(digits.slice(2, 4));
    if (digits.length > 4) parts.push(digits.slice(4, 8));
    input.value = parts.join('/');
  }

  function findPlayer(playerId, fallbackName){
    var id = String(playerId || '');
    var name = String(fallbackName || '').trim();
    var list = Array.isArray(window.LPI_PLAYER_DETAILS) ? window.LPI_PLAYER_DETAILS : [];
    return list.find(function(player){ return String(player.id || '') === id; }) ||
      list.find(function(player){ return String(player.name || player.nombre || '').trim() === name; }) ||
      null;
  }

  function showPlayerCardError(message){
    var err = document.getElementById('playerCardError');
    var ok = document.getElementById('playerCardSuccess');
    if (ok) ok.style.display = 'none';
    if (!err) return;
    err.textContent = message || 'No se pudo guardar';
    err.style.display = 'block';
  }

  function showPlayerCardSuccess(){
    var err = document.getElementById('playerCardError');
    var ok = document.getElementById('playerCardSuccess');
    if (err) err.style.display = 'none';
    if (ok) ok.style.display = 'block';
  }

  function resetPlayerCardMessages(){
    var err = document.getElementById('playerCardError');
    var ok = document.getElementById('playerCardSuccess');
    if (err) {
      err.textContent = '';
      err.style.display = 'none';
    }
    if (ok) ok.style.display = 'none';
  }

  function setPlayerCardEnabled(enabled){
    ['playerCardDni', 'playerCardBirth', 'playerCardPhoto', 'btnSavePlayerCard'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.disabled = !enabled;
    });
  }

  function markSelectedPlayer(playerId){
    document.querySelectorAll('.jugadores-container .fila').forEach(function(row){
      row.classList.toggle('is-selected', Boolean(playerId) && String(row.dataset.playerId || '') === String(playerId));
    });
  }

  function openPlayerCardEditor(playerId, fallbackName){
    var player = findPlayer(playerId, fallbackName);
    resetPlayerCardMessages();

    if (!player || !player.id) {
      document.getElementById('playerCardId').value = '';
      document.getElementById('playerCardName').value = fallbackName || '';
      document.getElementById('playerCardDni').value = '';
      document.getElementById('playerCardBirth').value = '';
      document.getElementById('playerCardPhoto').value = '';
      croppedPlayerCardPhoto = null;
      document.getElementById('playerCardPreview').src = '../logo_liga.png';
      setPlayerCardEnabled(false);
      markSelectedPlayer('');
      showPlayerCardError('Ese jugador todavía no tiene ficha editable en la base.');
      return;
    }

    document.getElementById('playerCardId').value = player.id || '';
    document.getElementById('playerCardName').value = player.name || player.nombre || '';
    document.getElementById('playerCardDni').value = player.dni || '';
    document.getElementById('playerCardBirth').value = formatBirthForDisplay(player.fechaNacimiento || player.fecha_nacimiento || player.birthDate || '');
    document.getElementById('playerCardPhoto').value = '';
    croppedPlayerCardPhoto = null;
    document.getElementById('playerCardPreview').src = playerPhotoSrc(player);
    setPlayerCardEnabled(true);
    markSelectedPlayer(player.id || '');
  }

  async function savePlayerCard(ev){
    ev?.preventDefault();
    var id = document.getElementById('playerCardId')?.value || '';
    var dni = document.getElementById('playerCardDni')?.value || '';
    var birthRaw = document.getElementById('playerCardBirth')?.value || '';
    var birth = formatBirthForApi(birthRaw);
    var photo = croppedPlayerCardPhoto || document.getElementById('playerCardPhoto')?.files?.[0] || null;
    if (!id) return showPlayerCardError('Jugador inválido');
    if (birthRaw.trim() && !birth) return showPlayerCardError('Ingresá la fecha como DD/MM/AAAA');
    if (!dni.trim() && !birth && !photo) return showPlayerCardError('No hay datos para guardar');

    var form = new FormData();
    form.set('id', id);
    form.set('dni', dni);
    form.set('fechaNacimiento', birth);
    if (photo) form.set('foto', photo);

    try {
      var res = await fetchWithAuth(LPI_apiUrl('/api/team/player-profile'), {
        method: 'POST',
        credentials: 'include',
        headers: getHeadersForFormData(),
        body: form
      });
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok || data.ok === false) throw new Error(data.error || 'No se pudo guardar');

      window.LPI_PLAYER_DETAILS = Array.isArray(data.playerDetails) ? data.playerDetails : (Array.isArray(data.players) ? data.players : window.LPI_PLAYER_DETAILS);
      if (Array.isArray(data.playerDetails)) {
        window.LPI_PLAYERS = data.playerDetails.map(function(player){ return player.name || player.nombre || ''; }).filter(Boolean);
      }
      if (typeof window.fillJugadores === 'function') window.fillJugadores();

      var updated = findPlayer(id, '');
      document.getElementById('playerCardPreview').src = playerPhotoSrc(updated || data.player || null);
      if (updated || data.player) openPlayerCardEditor(id, '');
      showPlayerCardSuccess();
    } catch (err) {
      showPlayerCardError(err.message || 'No se pudo guardar');
    }
  }

  window.openPlayerCardEditor = openPlayerCardEditor;

  document.addEventListener('DOMContentLoaded', function(){
    document.getElementById('playerCardPhoto')?.addEventListener('change', async function(){
      var file = this.files?.[0];
      if (!file) return;
      try {
        var cropped = window.LipaPhotoCropper
          ? await window.LipaPhotoCropper.pick(file, { outputName: document.getElementById('playerCardName')?.value || file.name })
          : file;
        if (!cropped) {
          this.value = '';
          return;
        }
        croppedPlayerCardPhoto = cropped;
        document.getElementById('playerCardPreview').src = URL.createObjectURL(cropped);
      } catch (err) {
        this.value = '';
        croppedPlayerCardPhoto = null;
        showPlayerCardError(err.message || 'No se pudo ajustar la foto');
      }
    });
    document.getElementById('playerCardBirth')?.addEventListener('input', function(){
      normalizeBirthTyping(this);
    });
    document.getElementById('playerCardForm')?.addEventListener('submit', savePlayerCard);
    setPlayerCardEnabled(false);
  });
})();


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
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

    function deriveCategory(){
      function normalizeCategory(raw){
        const v = String(raw || '').trim().toLowerCase();
        if (!v) return '';
        if (v.includes('terc')) return 'tercera';
        if (v.includes('seg')) return 'segunda';
        if (v === '3' || v === 'c') return 'tercera';
        if (v === '2' || v === 'b') return 'segunda';
        return '';
      }
      try {
        const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
        const val = normalizeCategory(sess && (sess.category || sess.categoria || sess.cat || sess.division || sess['división'] || sess.teamCategory || (sess.user && (sess.user.category || sess.user.categoria || sess.user.division))));
        if (val) return val;
      } catch(_) {}
      try {
        const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
        const val = normalizeCategory(sess2 && (sess2.category || sess2.categoria || sess2.cat || sess2.division || sess2['división'] || sess2.teamCategory || (sess2.user && (sess2.user.category || sess2.user.categoria || sess2.user.division))));
        if (val) return val;
      } catch(_) {}
      return '';
    }

    function deriveTeamKey(){
      try {
        const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
        if (sess && sess.slug) return String(sess.slug).trim();
      } catch(_) {}
      try {
        const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
        if (sess2 && (sess2.slug || sess2.team)) return String(sess2.slug || sess2.team).trim();
      } catch(_) {}

      const base = deriveTeam();
      const cat = deriveCategory();
      if (!base) return '';
      if (!cat) return base;
      if (base.endsWith('_' + cat) || base.endsWith(cat)) return base;
      return base + '_' + cat;
    }


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }


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




const alertBox = document.getElementById('alert');
function showAlert(msg) {
  alertBox.textContent = msg;
  alertBox.style.display = 'block';
  setTimeout(() => alertBox.style.display = 'none', 2000);
}

function showSendError(msg) {
  const dialog = document.getElementById('sendErrorDialog');
  const message = document.getElementById('sendErrorMessage');
  const accept = document.getElementById('sendErrorAccept');
  const text = msg || 'Hubo un error al enviar la planilla. Intentá nuevamente.';

  if (!dialog || !message || !accept || typeof dialog.showModal !== 'function') {
    if (typeof showAlert === 'function') showAlert(text);
    return;
  }

  message.textContent = text;
  accept.onclick = function(){
    dialog.close();
  };

  if (!dialog.open) dialog.showModal();
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


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }


(function() {
  function selectPlayers() {
    if (Array.isArray(window.LPI_PLAYER_DETAILS) && window.LPI_PLAYER_DETAILS.length) return window.LPI_PLAYER_DETAILS;
    if (Array.isArray(window.LPI_PLAYERS)) return window.LPI_PLAYERS;
    if (Array.isArray(window.LPI_JUGADORES)) return window.LPI_JUGADORES;
    const map = window.LPI_TEAM_PLAYERS;
    if (map && typeof map === "object") {
      const prefer = [ (typeof deriveTeamKey === 'function' ? deriveTeamKey() : deriveTeam()), deriveTeam() ].filter(Boolean);
      for (const k of prefer) if (Array.isArray(map[k])) return map[k];
      const keys = Object.keys(map);
      for (const k of keys) if (Array.isArray(map[k])) return map[k];
    }
    return [];
  }
  function getPlayerName(player){
    if (typeof player === 'string') return player;
    return player && (player.name || player.nombre) || '';
  }
  function wirePlayerSelection(row){
    if (row.dataset.selectionReady === '1') return;
    row.dataset.selectionReady = '1';
    row.addEventListener('click', function(ev){
      var name = row.querySelector('.jugador')?.textContent || '';
      if (!name.trim()) return;
      if (typeof window.openPlayerCardEditor === 'function') {
        window.openPlayerCardEditor(row.dataset.playerId || '', name);
      }
    });
  }
  function fillCapitanes(){
    var captains = Array.isArray(window.LPI_CAPTAINS) ? window.LPI_CAPTAINS : [];
    var slots = document.querySelectorAll(".jugadores-container .fila-capitan .jugador");
    slots.forEach(function(div, i){
      div.textContent = captains[i] || '';
      var row = div.closest('.fila');
      if (row) row.classList.toggle('has-player', Boolean(captains[i]));
    });
  }
  function fillJugadores(){
    fillCapitanes();
    const jugadores = selectPlayers().filter(Boolean).slice(0, 20);
    const rows = document.querySelectorAll(".jugadores-container .fila:not(.fila-capitan)");
    rows.forEach(function(row, i){
      var player = jugadores[i];
      var name = String(getPlayerName(player) || '').trim();
      var div = row.querySelector('.jugador');
      if (div) div.textContent = name;
      row.dataset.playerId = player && typeof player === 'object' && player.id ? String(player.id) : '';
      row.classList.toggle('has-player', Boolean(name));
      wirePlayerSelection(row);
    });
  }
  window.fillJugadores = fillJugadores;
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


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }


(function(){
  function ensureButtons(){
    var header = document.getElementById('headerActions');
    if(!header) return;

    var volver = document.createElement('a');
    volver.href = '../index.html';
    volver.textContent = 'Volver';
    volver.className = 'btn-logout';
    volver.style.textDecoration = 'none';

    var change = document.createElement('button');
    change.type = 'button';
    change.id = 'btnChangePassTop';
    change.textContent = 'Cambiar contraseña';
    change.className = 'btn-logout';
    change.style.background = '#d4af37';
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


(function(){
  function getTeamSlug(){
    try {
      const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
      if (sess && sess.slug) return String(sess.slug).trim();
    } catch(_){}
    try {
      const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
      if (sess2 && (sess2.slug || sess2.team)) return String(sess2.slug || sess2.team).trim();
    } catch(_){}
    return '';
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
    fetchWithAuth(LPI_apiUrl('/api/team/change-password'), {
      credentials: 'include',
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


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
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


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }

(function(){
  if (window.__LPI_UNIFIED_READY) return;
  window.__LPI_UNIFIED_READY = true;

  function once(fn){ let ran=false; return function(){ if(!ran){ ran=true; try{ fn.apply(this, arguments); this.__ran=true; }catch(_){} } } }


  var fill = (typeof window.fillJugadores === 'function') ? window.fillJugadores : null;


  var handle = once(function(ev){
    try{
      var detail = ev && ev.detail || {};
      if (detail && Array.isArray(detail.players) && typeof window.renderPlayers === 'function'){

        window.renderPlayers(detail.players);
      } else if (fill){
        fill();
      }
    }catch(_){}
  });

  window.addEventListener('lpi:players-ready', handle, { once: true });


  setTimeout(function(){
    try{

      if (!handle.__ran && fill) fill();
    }catch(_){}
  }, 300);

})();

function collectPlanillaPayload(){
    const pick = (group) => {
      const sel = `.group-container[data-group="${group}"] .yellow-box`;
      return Array.from(document.querySelectorAll(sel)).map(x => (x.dataset.player || '').trim());
    };
    const pickFree = () => Array.from(document.querySelectorAll('.yellow-box-free')).map(x => (x.dataset.player || '').trim());
    const team = (typeof deriveTeamKey === 'function') ? deriveTeamKey() : ((typeof deriveTeam === 'function') ? deriveTeam() : '');
    const category = (typeof deriveCategory === 'function') ? deriveCategory() : '';

    return {
      team,
      category,
      categoria: category,
      createdAt: new Date().toISOString(),
      individuales: pick('individual'),
      pareja1: pick('pareja1'),
      pareja2: pick('pareja2'),
      suplentes: pick('suplentes'),
      capitan: pickFree()
    };
  }

  function planillaHasAnyPlayer(payloadObj){
    const groups = [
      payloadObj && payloadObj.capitan,
      payloadObj && payloadObj.individuales,
      payloadObj && payloadObj.pareja1,
      payloadObj && payloadObj.pareja2,
      payloadObj && payloadObj.suplentes
    ];

    return groups.some(arr => Array.isArray(arr) && arr.some(name => String(name || '').trim()));
  }

  function clearPlanillaFields(){
    document.querySelectorAll('.yellow-box, .yellow-box-free').forEach(function(box){
      box.dataset.player = '';
      box.textContent = '';
    });
    if (typeof updateRepeatedHighlight === 'function') updateRepeatedHighlight();
  }

async function savePlanilla(){
    if (window.__LPI_PLANILLA_SEND_ENABLED__ === false) {
      if (typeof showSendError === 'function') showSendError('La carga de planilla está cerrada mientras los cruces estén habilitados.');
      return { ok:false, blocked:true };
    }

    const payloadObj = collectPlanillaPayload();

    if (!planillaHasAnyPlayer(payloadObj)) {
      if (typeof showSendError === 'function') showSendError('No se puede enviar una planilla totalmente vacía.');
      return { ok:false, empty:true };
    }

    try {
      const r = await fetchWithAuth(LPI_apiUrl('/api/save-planilla'), {
        credentials: 'include',
        method: 'POST',
        headers: LPI_getAuthHeaders(),
        body: JSON.stringify({ planilla: payloadObj })
      });
      if (!r.ok) {
        const t = await r.text().catch(()=> '');
        let msg = t || ('HTTP ' + r.status);
        try { const j = JSON.parse(t); if (j && (j.msg || j.error)) msg = j.msg || j.error; } catch(_) {}
        if (typeof showSendError === 'function') showSendError('No se pudo enviar la planilla: ' + msg);
        return { ok:false };
      }
      const json = await r.json().catch(() => ({}));
      if (json && json.ok) {
        if (typeof showToastOK === 'function') showToastOK('Enviada correctamente');
      } else {
        if (typeof showSendError === 'function') showSendError('No se pudo enviar la planilla. Intentá nuevamente.');
      }
      return json;
    } catch (e) {
      if (typeof showSendError === 'function') showSendError('Error de red al enviar la planilla. Revisá la conexión e intentá nuevamente.');
      return { ok:false, error: String((e && e.message) || e) };
    }
  }


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }

document.addEventListener('DOMContentLoaded', function(){
  var btn = document.getElementById('btnEnviar');
  if (btn) btn.addEventListener('click', savePlanilla);

  var btnVaciar = document.getElementById('btnVaciarPlanilla');
  if (btnVaciar) {
    btnVaciar.addEventListener('click', function(){
      clearPlanillaFields();
    });
  }
});


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
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

    var NAMES = window.LPI_TEAM_NAME || window.TEAM_NAMES || null;
    if (NAMES && (NAMES[slug] || NAMES[String(slug)])) return NAMES[slug] || NAMES[String(slug)];

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

  document.addEventListener('lpi:players-ready', setBadge, { once: true });
})();


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }


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


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }


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


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }


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


  function LPI_getAuthHeaders() {
    let token = "";

    try {
      const sess = JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "null");
      token = sess && (sess.token || sess.accessToken) ? (sess.token || sess.accessToken) : "";
    } catch (_) {}

    if (!token) {
      try {
        const sess2 = JSON.parse(localStorage.getItem("lpi_team_session") || sessionStorage.getItem("lpi_team_session") || "null");
        token = sess2 && (sess2.token || sess2.accessToken) ? (sess2.token || sess2.accessToken) : "";
      } catch (_) {}
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }


(function(){
  function readCrucesCategoryFromSession(){
    try {
      const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
      const raw = sess?.category || sess?.categoria || sess?.division || sess?.teamCategory || sess?.user?.category || sess?.user?.categoria || sess?.user?.division;
      const v = String(raw || '').trim().toLowerCase();
      if (v.includes('terc')) return 'tercera';
      if (v.includes('seg')) return 'segunda';
    } catch(_) {}
    try {
      const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
      const raw = sess2?.category || sess2?.categoria || sess2?.division || sess2?.teamCategory || sess2?.user?.category || sess2?.user?.categoria || sess2?.user?.division;
      const v = String(raw || '').trim().toLowerCase();
      if (v.includes('terc')) return 'tercera';
      if (v.includes('seg')) return 'segunda';
    } catch(_) {}
    return null;
  }

  async function readCrucesCategoryFromUsers(teamSlug){
    const fromSession = readCrucesCategoryFromSession();
    if (fromSession) return fromSession;

    const key = String(teamSlug || '').trim().toLowerCase();
    if (key.endsWith('tercera')) return 'tercera';
    if (key.endsWith('segunda')) return 'segunda';

    return null;
  }

  try{
    const params = new URLSearchParams(location.search);
    const teamFromUrl = params.get('team');
    const team = teamFromUrl || (typeof deriveTeam === 'function' ? deriveTeam() : '');
    if (team) {
      try { sessionStorage.setItem('lpi_cruces_team', team); } catch(_){}
      try { localStorage.setItem('lpi_cruces_team', team); } catch(_){}
      try { sessionStorage.setItem('crucesTeam', team); } catch(_){}
      try { localStorage.setItem('crucesTeam', team); } catch(_){}
    }

    const btn = document.querySelector('.btn-cruces');
    if (btn) {
      btn.setAttribute('href', '../cruces/cruces_fecha.html');
      btn.addEventListener('click', async function(ev){
        ev.preventDefault();

        const currentTeam = (typeof deriveTeam === 'function' ? deriveTeam() : team || '');
        if (currentTeam) {
          try { sessionStorage.setItem('lpi_cruces_team', currentTeam); } catch(_){}
          try { localStorage.setItem('lpi_cruces_team', currentTeam); } catch(_){}
          try { sessionStorage.setItem('crucesTeam', currentTeam); } catch(_){}
          try { localStorage.setItem('crucesTeam', currentTeam); } catch(_){}
        }

        let cat = readCrucesCategoryFromSession();
        if (!cat) {
          cat = await readCrucesCategoryFromUsers(currentTeam);
        }

        const url = cat
          ? ('../cruces/cruces_fecha.html?cat=' + encodeURIComponent(cat))
          : '../cruces/cruces_fecha.html';

        location.href = url;
      });
    }
  }catch(e){  }
})();


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
      const team = (typeof deriveTeamKey === 'function')
        ? deriveTeamKey()
        : ((typeof deriveTeam === 'function') ? deriveTeam() : '');

      const candidates = [];
      if (team) {
        candidates.push(LPI_apiUrl('/api/team/planilla?team=' + encodeURIComponent(team)));
      }
      candidates.push(LPI_apiUrl('/api/team/planilla'));

      for (const url of candidates) {
        const r = await fetchWithAuth(url, {
          credentials: 'include',
          method: 'GET',
          cache: 'no-store',
          headers: LPI_getAuthHeaders()
        });
        if (!r.ok) continue;
        const j = await r.json().catch(() => ({}));
        const p = j && j.planilla;
        if (p) {
          applyPlanilla(p);
          return;
        }
      }
    } catch(_) { }
  }
  if (document.readyState !== 'loading') {
    tryAutoload();
  } else {
    document.addEventListener('DOMContentLoaded', tryAutoload);
  }
})();


(function(){
  const CATEGORY_KEYS = {
    tercera: '__categoria_tercera__',
    segunda: '__categoria_segunda__'
  };

  function slugify(s){
    return String(s||'').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
  }

  function normalizeTeamName(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function normalizeCategoryValue(value){
    const v = String(value || '').trim().toLowerCase();
    if (!v) return null;
    if (v.includes('terc')) return 'tercera';
    if (v.includes('seg')) return 'segunda';
    if (v === '3' || v === 'c') return 'tercera';
    if (v === '2' || v === 'b') return 'segunda';
    return null;
  }

  function readLoggedSession(){
    try {
      const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
      if (sess) return sess;
    } catch(_) {}
    try {
      const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
      if (sess2) return sess2;
    } catch(_) {}
    return null;
  }

  function resolveCategoryFromSession(){
    const sess = readLoggedSession();
    if (!sess || typeof sess !== 'object') return null;

    const directKeys = [
      'category', 'categoria', 'cat', 'division', 'división', 'leagueCategory',
      'teamCategory', 'fixtureCategory', 'grupoCategoria'
    ];

    for (const key of directKeys){
      const value = normalizeCategoryValue(sess[key]);
      if (value) return value;
    }

    if (sess.team && typeof sess.team === 'object'){
      for (const key of directKeys){
        const value = normalizeCategoryValue(sess.team[key]);
        if (value) return value;
      }
    }

    if (sess.user && typeof sess.user === 'object'){
      for (const key of directKeys){
        const value = normalizeCategoryValue(sess.user[key]);
        if (value) return value;
      }
    }

    return null;
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

  async function resolveCategoryByTeam(teamSlug){
    const fromSession = resolveCategoryFromSession();
    if (fromSession) return fromSession;

    const key = String(teamSlug || '').trim().toLowerCase();
    if (key.endsWith('tercera')) return 'tercera';
    if (key.endsWith('segunda')) return 'segunda';

    return null;
  }

  const fechaKey = new Date().toISOString().slice(0,10);
  const btn = document.getElementById('btnVerCruces');

  function setEnabled(on, category){
    if(!btn) return;

    btn.classList.toggle('is-disabled', !on);

    if(!on){
      btn.setAttribute('aria-disabled','true');
      btn.title = category
        ? ('Esperando habilitación del admin para ' + category + '…')
        : 'Esperando habilitación del admin…';
    } else {
      btn.removeAttribute('aria-disabled');
      btn.title = category ? ('Cruces habilitados para ' + category) : '';
    }
  }

  if (btn && !btn.__crucesGuardWired){
    btn.__crucesGuardWired = true;
    btn.addEventListener('click', function(ev){
      if (btn.getAttribute('aria-disabled') === 'true'){
        ev.preventDefault();
        ev.stopPropagation();
      }
    });
  }

  let lastKey = '';
  let refreshTimer = null;
  let refreshInFlight = false;

  async function checkCruces(){
    if (refreshInFlight) return;
    refreshInFlight = true;

    try{
      const team = deriveTeam() || '';
      const category = await resolveCategoryByTeam(team);

      if (!category || !CATEGORY_KEYS[category]){
        setEnabled(false, null);
        return;
      }

      const currentKey = `${CATEGORY_KEYS[category]}::${fechaKey}`;
      if (currentKey === lastKey && btn && btn.dataset.crucesResolved === 'true') {
        return;
      }

      const qs = new URLSearchParams({
        team: CATEGORY_KEYS[category],
        fechaKey
      });

      const r = await fetchWithAuth(
        LPI_apiUrl('/api/cruces/status') + '?' + qs.toString(),
        { cache:'no-store', credentials:'include' }
      );

      const j = await r.json().catch(() => ({}));
      setEnabled(!!(j && j.enabled), category);

      if (btn) {
        btn.dataset.crucesResolved = 'true';
      }

      lastKey = currentKey;
    } catch(_){
      setEnabled(false, null);
    } finally {
      refreshInFlight = false;
    }
  }

  function queueCheck(){
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      checkCruces();
    }, 250);
  }

  setEnabled(false, null);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkCruces, { once:true });
  } else {
    checkCruces();
  }

  try{
    const es = new EventSource(LPI_apiUrl('/api/cruces/stream'), { withCredentials: true });
    es.onmessage = () => {
      queueCheck();
    };
  } catch(_){}


  setInterval(() => {
    queueCheck();
  }, 60000);
})();



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

(function setupModelSheetDownload(){
  function blankIndividualRows(){
    return Array.from({ length: 11 }, (_, index) => index === 0
      ? '<tr><td></td><td></td><td class="model-vs" rowspan="11">VS.</td><td></td><td></td></tr>'
      : '<tr><td></td><td></td><td></td><td></td></tr>'
    ).join('');
  }

  function buildModelSheet(){
    const sheet = document.createElement('section');
    sheet.className = 'model-a4-sheet';
    sheet.innerHTML = `
      <div class="model-meta"><span>Categoría:</span><span>Planilla modelo</span></div>
      <h1 class="model-title">L.I.P.A.</h1>
      <div class="model-bar"></div>
      <div class="model-header">
        <table class="model-form" aria-label="Datos del equipo local"><tbody>
          <tr><td class="model-label">SALA</td><td></td></tr>
          <tr><td class="model-label">CAPITANÍA</td><td></td></tr>
        </tbody></table>
        <div class="model-logo"><img src="../logo_liga.png" alt="Logo LIPA"></div>
        <table class="model-form" aria-label="Datos del equipo visitante"><tbody>
          <tr><td></td><td class="model-label">SALA</td></tr>
          <tr><td></td><td class="model-label">CAPITANÍA</td></tr>
        </tbody></table>
      </div>
      <div class="model-section">
        <table class="model-individuals" aria-label="Once partidos individuales">
          <colgroup><col style="width:32.5%"><col style="width:5%"><col style="width:25%"><col style="width:5%"><col style="width:32.5%"></colgroup>
          <thead><tr><th colspan="2">NOMBRE Y APELLIDO</th><th>INDIVIDUALES</th><th colspan="2">NOMBRE Y APELLIDO</th></tr></thead>
          <tbody>${blankIndividualRows()}</tbody>
        </table>
      </div>
      <table class="model-result" aria-label="Resultado final">
        <colgroup><col style="width:42%"><col style="width:8%"><col style="width:8%"><col style="width:42%"></colgroup>
        <thead><tr><th>SALA</th><th colspan="2">RESULTADO FINAL</th><th>SALA</th></tr></thead>
        <tbody><tr><td></td><td></td><td></td><td></td></tr><tr><td class="model-tri-left">TRIÁNGULOS TOTALES :</td><td></td><td></td><td class="model-tri-right">: TRIÁNGULOS TOTALES</td></tr></tbody>
      </table>
      <div class="model-subs">
        <table><thead><tr><th>SUPLENTES</th></tr></thead><tbody><tr><td></td></tr><tr><td></td></tr></tbody></table>
        <table><thead><tr><th>SUPLENTES</th></tr></thead><tbody><tr><td></td></tr><tr><td></td></tr></tbody></table>
      </div>
      <div class="model-signatures">
        <div class="model-signature"><div class="model-signature-line"></div><div class="model-signature-label">FIRMA LOCAL</div></div>
        <div class="model-signature"><div class="model-signature-line"></div><div class="model-signature-label">FIRMA VISITANTE</div></div>
      </div>`;
    return sheet;
  }

  async function downloadModelSheet(){
    if (!window.html2canvas) throw new Error('No se pudo cargar el generador de imágenes.');
    const previousBodyZoom = document.body.style.zoom;
    let sheet = null;
    try {
      document.body.style.zoom = '1';
      sheet = buildModelSheet();
      document.body.appendChild(sheet);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = await window.html2canvas(sheet, {
        backgroundColor:'#ffffff', scale:2, useCORS:true, logging:false,
        width:794, height:1123, windowWidth:794, windowHeight:1123
      });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.96));
      if (!blob) throw new Error('No se pudo generar la planilla modelo.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'planilla-modelo-11-individuales.jpg';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } finally {
      sheet?.remove();
      document.body.style.zoom = previousBodyZoom;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('btnPlanillaModelo');
    if (!button) return;
    button.addEventListener('click', async () => {
      const originalText = button.textContent;
      try {
        button.disabled = true;
        button.textContent = 'GENERANDO...';
        await downloadModelSheet();
      } catch (error) {
        console.error(error);
        alert(error?.message || 'No se pudo descargar la planilla modelo.');
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  });
})();




(function(){
  if (window.__LPI_CRUCES_PLANILLA_SYNC_V2__) return;
  window.__LPI_CRUCES_PLANILLA_SYNC_V2__ = true;

  const CATEGORY_KEYS = {
    tercera: '__categoria_tercera__',
    segunda: '__categoria_segunda__'
  };

  const fechaKey = new Date().toISOString().slice(0,10);
  const btnCruces = document.getElementById('btnVerCruces');
  const btnEnviar = document.getElementById('btnEnviar');
  const sendStatus = document.getElementById('sendPlanillaStatus');

  function normalizeCategoryValue(value){
    const v = String(value || '').trim().toLowerCase();
    if (!v) return null;
    if (v.includes('terc')) return 'tercera';
    if (v.includes('seg')) return 'segunda';
    if (v === '3' || v === 'c') return 'tercera';
    if (v === '2' || v === 'b') return 'segunda';
    return null;
  }

  function readLoggedSession(){
    try {
      const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
      if (sess) return sess;
    } catch(_) {}
    try {
      const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
      if (sess2) return sess2;
    } catch(_) {}
    return null;
  }

  function resolveCategoryFromSession(){
    const sess = readLoggedSession();
    if (!sess || typeof sess !== 'object') return null;

    const directKeys = [
      'category', 'categoria', 'cat', 'division', 'división', 'leagueCategory',
      'teamCategory', 'fixtureCategory', 'grupoCategoria'
    ];

    for (const key of directKeys){
      const value = normalizeCategoryValue(sess[key]);
      if (value) return value;
    }

    if (sess.team && typeof sess.team === 'object'){
      for (const key of directKeys){
        const value = normalizeCategoryValue(sess.team[key]);
        if (value) return value;
      }
    }

    if (sess.user && typeof sess.user === 'object'){
      for (const key of directKeys){
        const value = normalizeCategoryValue(sess.user[key]);
        if (value) return value;
      }
    }

    return null;
  }

  function deriveCurrentTeam(){
    try {
      if (typeof deriveTeam === 'function') return deriveTeam() || '';
    } catch(_) {}
    try {
      if (typeof deriveTeamKey === 'function') return deriveTeamKey() || '';
    } catch(_) {}
    return '';
  }

  async function resolveCategoryByTeam(teamSlug){
    const fromSession = resolveCategoryFromSession();
    if (fromSession) return fromSession;

    const key = String(teamSlug || '').trim().toLowerCase();
    if (key.endsWith('tercera')) return 'tercera';
    if (key.endsWith('segunda')) return 'segunda';

    return null;
  }

  function setCrucesEnabled(enabled, category){
    if (!btnCruces) return;

    btnCruces.classList.toggle('is-disabled', !enabled);

    if (!enabled){
      btnCruces.setAttribute('aria-disabled', 'true');
      btnCruces.title = category
        ? ('Esperando habilitación del admin para ' + category + '…')
        : 'Esperando habilitación del admin…';
    } else {
      btnCruces.removeAttribute('aria-disabled');
      btnCruces.title = category
        ? ('Cruces habilitados para ' + category)
        : 'Cruces habilitados';
    }
  }

  function setEnviarEnabled(enabled, category){
    if (!btnEnviar) return;

    btnEnviar.disabled = !enabled;
    btnEnviar.classList.toggle('is-disabled', !enabled);

    if (enabled){
      btnEnviar.title = category
        ? ('La carga está habilitada para ' + category)
        : 'La carga está habilitada';
      if (sendStatus){
        sendStatus.textContent = 'La carga de planilla está habilitada.';
        sendStatus.classList.add('is-open');
        sendStatus.classList.remove('is-closed');
      }
    } else {
      btnEnviar.title = category
        ? ('La carga está deshabilitada por el administrador para ' + category)
        : 'La carga está deshabilitada por el administrador';
      if (sendStatus){
        sendStatus.textContent = 'La carga de planilla está deshabilitada por el administrador.';
        sendStatus.classList.add('is-closed');
        sendStatus.classList.remove('is-open');
      }
    }
  }

  function applyState(crucesEnabled, category){
    const sendEnabled = !crucesEnabled;
    setCrucesEnabled(!!crucesEnabled, category);
    setEnviarEnabled(sendEnabled, category);
    window.__LPI_PLANILLA_SEND_ENABLED__ = sendEnabled;
  }

  if (btnCruces && !btnCruces.__lpiCrucesGuardV2){
    btnCruces.__lpiCrucesGuardV2 = true;
    btnCruces.addEventListener('click', function(ev){
      if (btnCruces.getAttribute('aria-disabled') === 'true'){
        ev.preventDefault();
        ev.stopPropagation();
      }
    }, true);
  }

  if (btnEnviar && !btnEnviar.__lpiSendGuardV2){
    btnEnviar.__lpiSendGuardV2 = true;
    btnEnviar.addEventListener('click', function(ev){
      if (btnEnviar.disabled || window.__LPI_PLANILLA_SEND_ENABLED__ === false){
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof showSendError === 'function') {
          showSendError('La carga de planilla está deshabilitada por el administrador.');
        }
      }
    }, true);
  }

  let refreshInFlight = false;
  let refreshTimer = null;

  async function checkRemoteState(){
    if (refreshInFlight) return;
    refreshInFlight = true;

    try {
      const team = deriveCurrentTeam();
      const category = await resolveCategoryByTeam(team);

      if (!category || !CATEGORY_KEYS[category]){
        applyState(false, category);
        return;
      }

      const qs = new URLSearchParams({
        team: CATEGORY_KEYS[category],
        fechaKey: fechaKey
      });

      const r = await fetchWithAuth(
        LPI_apiUrl('/api/cruces/status') + '?' + qs.toString(),
        { cache:'no-store', credentials:'include' }
      );

      const j = await r.json().catch(() => ({}));
      applyState(!!(j && j.enabled), category);
    } catch(_) {
      applyState(false, null);
    } finally {
      refreshInFlight = false;
    }
  }

  function queueCheck(){
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(checkRemoteState, 250);
  }



  applyState(false, null);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkRemoteState, { once:true });
  } else {
    checkRemoteState();
  }

  try{
    const es = new EventSource(LPI_apiUrl('/api/cruces/stream'), { withCredentials: true });
    es.onmessage = function(){
      queueCheck();
    };
    es.onerror = function(){};
  } catch(_) {}

  setInterval(queueCheck, 60000);
})();
