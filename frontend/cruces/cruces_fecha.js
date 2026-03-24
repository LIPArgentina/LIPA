const API_BASE = 'https://liga-backend-tt82.onrender.com/api';

function getCategoryFromURL(){
  const qs = new URLSearchParams(location.search);
  return String(qs.get('cat') || '').toLowerCase();
}

const CATEGORY_KEYS = {
  tercera: '__categoria_tercera__',
  segunda: '__categoria_segunda__'
};

function getAccessKey(){
  const cat = getCategoryFromURL();
  if (cat === 'tercera') return CATEGORY_KEYS.tercera;
  if (cat === 'segunda') return CATEGORY_KEYS.segunda;
  return null;
}

async function checkCrucesEnabled() {
  const app = document.getElementById('app-root');

  const accessKey = getAccessKey();
  if (!accessKey){
    app.innerHTML = '<h2 style="color:#ffe65a;">Cruces no disponibles</h2>';
    return false;
  }

  const fechaKey = new Date().toISOString().slice(0,10);

  const r = await fetch(`${API_BASE}/cruces/status?team=${accessKey}&fechaKey=${fechaKey}`);
  const j = await r.json();

  if (!j.enabled){
    app.innerHTML = '<h2 style="color:#ffe65a;">Cruces no habilitados</h2>';
    return false;
  }

  return true;
}

async function loadCruces(){
  const app = document.getElementById('app-root');

  try{
    const accessKey = getAccessKey();
    const fechaKey = new Date().toISOString().slice(0,10);

    // 🔥 CAMBIO CLAVE: POST en vez de GET
    const r = await fetch(`${API_BASE}/cruces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        team: accessKey,
        fechaKey
      })
    });

    const data = await r.json();

    app.innerHTML = `
      <div style="padding:20px;text-align:center;">
        <h2 style="color:#ffe65a;">Cruces cargados</h2>
        <pre style="text-align:left;max-width:800px;margin:auto;">
${JSON.stringify(data, null, 2)}
        </pre>
      </div>
    `;

  } catch(e){
    app.innerHTML = '<p>Error cargando cruces</p>';
  }
}

(async function(){
  const ok = await checkCrucesEnabled();
  if (ok) loadCruces();
})();