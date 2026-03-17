// cruces_fecha.js CORREGIDO

const API_BASE = 'https://liga-backend-tt82.onrender.com';

function getStoredCrucesTeam() {
  try {
    return localStorage.getItem('crucesTeam') || '';
  } catch (_) {
    return '';
  }
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

async function resolveCrucesAccessKey(teamSlug){
  const normalizedSlug = normalizeCategoryTeamName(String(teamSlug || '').replace(/-/g, ' '));

  const tercera = await fetchCategoryTeamNames([
    '../data/usuarios.tercera.json',
    '/data/usuarios.tercera.json'
  ]);
  if (tercera.includes(normalizedSlug)) return CATEGORY_KEYS.tercera;

  const segunda = await fetchCategoryTeamNames([
    '../data/usuarios.segunda.json',
    '/data/usuarios.segunda.json'
  ]);
  if (segunda.includes(normalizedSlug)) return CATEGORY_KEYS.segunda;

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

    const r = await fetch(`${API_BASE}/api/cruces/status?` + qs.toString());
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
