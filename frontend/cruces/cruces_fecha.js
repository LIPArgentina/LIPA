(function(){
  const API_BASE = 'https://liga-backend-tt82.onrender.com/api';

  const CATEGORY_KEYS = {
    tercera: '__categoria_tercera__',
    segunda: '__categoria_segunda__'
  };

  function qs(name){
    return new URLSearchParams(location.search).get(name);
  }

  function getCategoryFromURL(){
    return String(qs('cat') || '').trim().toLowerCase();
  }

  function getAccessKey(){
    const cat = getCategoryFromURL();
    return CATEGORY_KEYS[cat] || null;
  }

  function getFechaKeyLocal(){
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function slugify(value){
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s_-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-');
  }

  function teamKeyFromName(name){
    const base = slugify(name);
    const cat = getCategoryFromURL();
    if (!base) return '';
    if (!cat) return base;
    if (base.endsWith('-' + cat) || base.endsWith('_' + cat)) return base;
    return `${base}_${cat}`;
  }

  function normalizeForMatch(value){
    return slugify(String(value || '').replace(/_(segunda|tercera)$/i, ''));
  }

  function getStoredTeam(){
    const candidates = [
      sessionStorage.getItem('lpi_cruces_team'),
      localStorage.getItem('lpi_cruces_team'),
      sessionStorage.getItem('crucesTeam'),
      localStorage.getItem('crucesTeam')
    ].filter(Boolean);

    try {
      const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
      if (sess && (sess.slug || sess.team)) candidates.push(sess.slug || sess.team);
    } catch(_) {}

    try {
      const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
      if (sess2 && (sess2.slug || sess2.team)) candidates.push(sess2.slug || sess2.team);
    } catch(_) {}

    for (const c of candidates){
      const norm = normalizeForMatch(c);
      if (norm) return norm;
    }
    return '';
  }

  function showMessage(html){
    const app = document.getElementById('app-root');
    if (app) app.innerHTML = html;
  }

  async function fetchJson(url, options){
    const r = await fetch(url, Object.assign({ credentials: 'include', cache: 'no-store' }, options || {}));
    const text = await r.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch(_) {}
    if (!r.ok) {
      const msg = (json && (json.error || json.msg)) || text || ('HTTP ' + r.status);
      throw new Error(msg);
    }
    return json;
  }

  async function checkCrucesEnabled() {
    const accessKey = getAccessKey();
    if (!accessKey){
      showMessage('<h2 style="color:#ffe65a; text-align:center;">Cruces no disponibles</h2>');
      return false;
    }

    const fechaKey = getFechaKeyLocal();
    const j = await fetchJson(`${API_BASE}/cruces/status?team=${encodeURIComponent(accessKey)}&fechaKey=${encodeURIComponent(fechaKey)}`);

    if (!j.enabled){
      showMessage('<h2 style="color:#ffe65a; text-align:center;">Cruces no habilitados</h2>');
      return false;
    }

    return true;
  }

  async function fetchCruces(){
    const accessKey = getAccessKey();
    const fechaKey = getFechaKeyLocal();
    return fetchJson(`${API_BASE}/cruces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: accessKey, fechaKey })
    });
  }

  async function fetchPlanilla(teamName){
    const team = teamKeyFromName(teamName);
    if (!team) return null;

    const urls = [
      `${API_BASE}/team/planilla?team=${encodeURIComponent(team)}`,
      `${API_BASE}/team/planilla`
    ];

    for (const url of urls){
      try {
        const opts = url.endsWith('/team/planilla')
          ? {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' }
            }
          : {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' }
            };
        const json = await fetchJson(url, opts);
        if (json && json.planilla) return json.planilla;
      } catch(_) {}
    }
    return null;
  }

  function escapeHtml(value){
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderSection(title, items){
    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    return `
      <section class="planilla-section">
        <h3>${escapeHtml(title)}</h3>
        <div class="planilla-list">
          ${safeItems.length
            ? safeItems.map((item, idx) => `<div class="planilla-row"><span class="n">${idx + 1}</span><span class="v">${escapeHtml(item)}</span></div>`).join('')
            : '<div class="planilla-empty">Sin cargar</div>'}
        </div>
      </section>
    `;
  }

  function buildCard(teamName, planilla, sideLabel){
    if (!planilla){
      return `
        <div class="wrap">
          <div class="card">
            <h2 class="title">${escapeHtml(teamName)}</h2>
            <div class="meta">${escapeHtml(sideLabel)} · Planilla no encontrada</div>
            <div class="hint">No se pudo cargar la planilla guardada para este equipo.</div>
            ${renderSection('CAPITÁN', [])}
            ${renderSection('INDIVIDUALES', [])}
            ${renderSection('PAREJA 1', [])}
            ${renderSection('PAREJA 2', [])}
            ${renderSection('SUPLENTES', [])}
          </div>
        </div>
      `;
    }

    const createdAt = planilla.createdAt ? new Date(planilla.createdAt) : null;
    const createdText = createdAt && !isNaN(createdAt)
      ? createdAt.toLocaleString('es-AR')
      : 'Sin fecha';

    return `
      <div class="wrap">
        <div class="card">
          <h2 class="title">${escapeHtml(teamName)}</h2>
          <div class="meta">${escapeHtml(sideLabel)} · Cargada: ${escapeHtml(createdText)}</div>
          <div class="sections">
            ${renderSection('CAPITÁN', planilla.capitan || [])}
            ${renderSection('INDIVIDUALES', planilla.individuales || [])}
            ${renderSection('PAREJA 1', planilla.pareja1 || [])}
            ${renderSection('PAREJA 2', planilla.pareja2 || [])}
            ${renderSection('SUPLENTES', planilla.suplentes || [])}
          </div>
        </div>
      </div>
    `;
  }

  function resolveCruce(cruces){
    const ownTeam = getStoredTeam();
    if (!Array.isArray(cruces) || !cruces.length) return null;
    if (!ownTeam) return cruces[0];

    return cruces.find(function(cruce){
      return normalizeForMatch(cruce.local) === ownTeam || normalizeForMatch(cruce.visitante) === ownTeam;
    }) || cruces[0];
  }

  function wireHeader(selectedCruce){
    const btnVolver = document.getElementById('btnVolver');
    if (btnVolver) btnVolver.href = 'javascript:history.back()';

    const title = document.getElementById('headerTitle');
    if (title && selectedCruce){
      title.textContent = 'CRUCES';
    }
  }

  async function loadCruces(){
    const rootLeft = document.getElementById('planilla-root-left');
    const rootRight = document.getElementById('planilla-root-right');
    const appError = document.getElementById('appError');

    try{
      const data = await fetchCruces();
      const selectedCruce = resolveCruce(data && data.cruces);

      if (!selectedCruce){
        showMessage('<h2 style="color:#ffe65a; text-align:center;">No hay cruces cargados para esta fecha</h2>');
        return;
      }

      wireHeader(selectedCruce);

      const [planillaLocal, planillaVisitante] = await Promise.all([
        fetchPlanilla(selectedCruce.local),
        fetchPlanilla(selectedCruce.visitante)
      ]);

      if (rootLeft) rootLeft.innerHTML = buildCard(selectedCruce.local, planillaLocal, 'Local');
      if (rootRight) rootRight.innerHTML = buildCard(selectedCruce.visitante, planillaVisitante, 'Visitante');

      if (appError) {
        appError.style.display = 'none';
        appError.textContent = '';
      }
    } catch(e){
      if (appError){
        appError.textContent = 'Error cargando cruces: ' + (e && e.message ? e.message : 'desconocido');
        appError.style.display = 'block';
      } else {
        showMessage('<p style="text-align:center; color:#fff;">Error cargando cruces</p>');
      }
    }
  }

  (async function(){
    const ok = await checkCrucesEnabled().catch(function(){ return false; });
    if (ok) loadCruces();
  })();
})();
