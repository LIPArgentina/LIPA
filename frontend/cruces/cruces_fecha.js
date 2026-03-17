// cruces_fecha.js CORREGIDO

const API_BASE = 'https://liga-backend-tt82.onrender.com';

function slugify(value){
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function getStoredCrucesTeam() {
  try {
    const direct = localStorage.getItem('crucesTeam') || sessionStorage.getItem('crucesTeam');
    if (direct) return slugify(direct);
  } catch (_) {}

  try {
    const s1 = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
    if (s1) {
      if (s1.slug) return slugify(s1.slug);
      if (s1.team) return slugify(s1.team);
      if (s1.username) return slugify(s1.username);
      if (s1.user?.slug) return slugify(s1.user.slug);
      if (s1.user?.team) return slugify(s1.user.team);
      if (s1.user?.username) return slugify(s1.user.username);
    }
  } catch (_) {}

  try {
    const s2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
    if (s2) {
      if (s2.slug) return slugify(s2.slug);
      if (s2.team) return slugify(s2.team);
      if (s2.username) return slugify(s2.username);
      if (s2.user?.slug) return slugify(s2.user.slug);
      if (s2.user?.team) return slugify(s2.user.team);
      if (s2.user?.username) return slugify(s2.user.username);
    }
  } catch (_) {}

  try {
    const qs = new URLSearchParams(location.search);
    const qTeam = qs.get('team') || qs.get('slug') || qs.get('equipo');
    if (qTeam) return slugify(qTeam);
  } catch (_) {}

  try {
    const ref = document.referrer || '';
    const m = ref.match(/\/equipos\/([^\/?#]+)\.html/i);
    if (m) return slugify(m[1]);
  } catch (_) {}

  return '';
}

const CATEGORY_KEYS = {
  tercera: '__categoria_tercera__',
  segunda: '__categoria_segunda__'
};

function normalizeCategoryTeamName(value){
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function fetchCategoryTeamNames(paths){
  for (const path of paths){
    try{
      const r = await fetch(path, { cache:'no-store' });
      if(!r.ok) continue;

      const contentType = (r.headers.get('content-type') || '').toLowerCase();

      if(contentType.includes('application/json') || path.endsWith('.json')){
        const data = await r.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : []);
        const names = [];
        list.forEach(item => {
          if (!item || typeof item !== 'object') return;
          ['username','equipo','nombre','team'].forEach(k=>{
            if (typeof item[k] === 'string') names.push(normalizeCategoryTeamName(item[k]));
          });
        });
        const uniq = [...new Set(names.filter(Boolean))];
        if (uniq.length) return uniq;
      }
    } catch(_) {}
  }
  return [];
}

function matchTeam(list, target){
  return list.some(name => name.includes(target) || target.includes(name));
}

async function resolveCrucesAccessKey(teamSlug){
  try {
    const qs = new URLSearchParams(location.search);
    const cat = String(qs.get('cat') || '').trim().toLowerCase();
    if (cat === 'tercera') return CATEGORY_KEYS.tercera;
    if (cat === 'segunda') return CATEGORY_KEYS.segunda;
  } catch(_) {}

  const normalizedSlug = normalizeCategoryTeamName(String(teamSlug || '').replace(/-/g, ' '));

  const tercera = await fetchCategoryTeamNames([
    '../data/usuarios.tercera.json',
    '/data/usuarios.tercera.json'
  ]);
  if (matchTeam(tercera, normalizedSlug)) return CATEGORY_KEYS.tercera;

  const segunda = await fetchCategoryTeamNames([
    '../data/usuarios.segunda.json',
    '/data/usuarios.segunda.json'
  ]);
  if (matchTeam(segunda, normalizedSlug)) return CATEGORY_KEYS.segunda;

  return null;
}

async function checkCrucesEnabled(teamSlug) {
  const app = document.getElementById('app-root');

  const block = (title, msg) => {
    if (app) {
      app.innerHTML = `
        <div style="min-height:60vh;display:flex;align-items:center;justify-content:center;">
          <div style="text-align:center;">
            <h2 style="color:#ffe65a;">${title}</h2>
            <p>${msg}</p>
          </div>
        </div>
      `;
    }
    return false;
  };

  if (!teamSlug) {
    return block('Cruces no disponibles', 'No se pudo identificar el equipo.');
  }

  try {
    const accessKey = await resolveCrucesAccessKey(teamSlug);
    if (!accessKey) {
      return block('Cruces no disponibles', 'No se pudo determinar la categoría.');
    }

    const fechaKey = new Date().toISOString().slice(0,10);
    const qs = new URLSearchParams({ team: accessKey, fechaKey });

    const r = await fetch(`${API_BASE}/api/cruces/status?` + qs.toString(), {
  cache: 'no-store'
});
    const j = await r.json();

    if (!j.enabled) {
      return block('Cruces no habilitados', 'El administrador no habilitó los cruces.');
    }

    return true;
  } catch (e) {
    return block('Error', 'No se pudo verificar.');
  }
}

(async function(){
  const team = getStoredCrucesTeam();
  await checkCrucesEnabled(team);
})();
