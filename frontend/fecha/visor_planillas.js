// base del backend
const API_BASE = (window.APP_CONFIG?.API_BASE_URL || "https://liga-backend-tt82.onrender.com").replace(/\/+$/, "");

(function(){
  const $ = s => document.querySelector(s);

  const state = {
    allFiles: [],
    activeCategory: null,
    categories: {
      tercera: new Set(),
      segunda: new Set()
    }
  };

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || "https://liga-backend-tt82.onrender.com").replace(/\/+$/, "");

  function showAlert(msg){
    const a = $('#alert');
    if(!a){
      alert(msg);
      return;
    }
    a.textContent = msg;
    a.style.display = 'block';
    setTimeout(()=> a.style.display='none', 4000);
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

  function slot(idx, name){
    const el = document.createElement('div'); el.className='slot';
    const n  = Object.assign(document.createElement('div'), {className:'nro'});
    n.textContent = idx;
    const y  = Object.assign(document.createElement('div'), {className:'yellow-box'});
    y.textContent = name || '';
    el.appendChild(n); el.appendChild(y);
    return el;
  }

  function renderBoard(plan, target){
    function fill(arr, count){
      const c = document.createElement('div'); c.className='grid';
      for(let i=0;i<count;i++){ c.appendChild(slot(i+1, arr[i] || '')); }
      return c;
    }

    const safePlan = plan || {};
    const wrap = document.createElement('div'); wrap.className='board';
    const groups = document.createElement('div'); groups.className='groups';

    const g1 = document.createElement('article'); g1.className='group'; g1.innerHTML = '<h3>INDIVIDUALES</h3>';
    g1.appendChild(fill(Array.isArray(safePlan.individuales) ? safePlan.individuales : [], 7));

    const g2 = document.createElement('article'); g2.className='group'; g2.innerHTML = '<h3>PAREJA 1</h3>';
    g2.appendChild(fill(Array.isArray(safePlan.pareja1) ? safePlan.pareja1 : [], 2));

    const g3 = document.createElement('article'); g3.className='group'; g3.innerHTML = '<h3>PAREJA 2</h3>';
    g3.appendChild(fill(Array.isArray(safePlan.pareja2) ? safePlan.pareja2 : [], 2));

    const g4 = document.createElement('article'); g4.className='group'; g4.innerHTML = '<h3>SUPLENTES</h3>';
    g4.appendChild(fill(Array.isArray(safePlan.suplentes) ? safePlan.suplentes : [], 2));

    groups.appendChild(g1); groups.appendChild(g2); groups.appendChild(g3); groups.appendChild(g4);
    wrap.appendChild(groups);
    target.appendChild(wrap);
  }

  function formatDateTime(value){
    try{
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return 'fecha inválida';
      return d.toLocaleString('es-AR', {
        year:'numeric',
        month:'2-digit',
        day:'2-digit',
        hour:'2-digit',
        minute:'2-digit'
      });
    }catch(_){
      return String(value || '');
    }
  }

  function isSameLocalDay(value){
  try{
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return false;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    // diferencia en días
    const diffMs = today.getTime() - target.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    return diffDays >= 0 && diffDays <= 3; // 👈 4 días (0,1,2,3)
  }catch(_){
    return false;
  }
}

  function markFreshness(card, updatedAt){
    try{
      const isToday = !!updatedAt && isSameLocalDay(updatedAt);

      let wrap = card.querySelector('.title-indicator');
      if(!wrap){ wrap = document.createElement('div'); wrap.className='title-indicator'; card.insertBefore(wrap, card.querySelector('h2').nextSibling); }

      let dot = wrap.querySelector('.fresh-indicator');
      if(!dot){ dot = document.createElement('div'); dot.className='fresh-indicator'; wrap.appendChild(dot); }

      dot.className = 'fresh-indicator ' + (isToday ? 'fresh-ok' : 'fresh-stale');

      if (updatedAt) {
        dot.title = isToday
          ? ('Planilla cargada hoy: ' + formatDateTime(updatedAt))
          : ('Planilla cargada el: ' + formatDateTime(updatedAt));
      } else {
        dot.title = 'Planilla sin fecha de actualización';
      }
    }catch(e){}
  }

  function getCategoryFreshStats(category){
    const files = state.allFiles.filter(item => item.__category === category);
    const total = files.length;
    const updated = files.filter(item => !!item.updatedAt && isSameLocalDay(item.updatedAt)).length;
    return {
      total,
      updated,
      allFresh: total > 0 && updated === total
    };
  }

  function updateCategoryHeaderIndicator(category){
    const stats = getCategoryFreshStats(category);
    const suffix = category.charAt(0).toUpperCase() + category.slice(1);
    const dot = document.getElementById('globalIndicator' + suffix);
    const counter = document.getElementById('globalCounter' + suffix);

    if(counter){
      counter.textContent = stats.updated + ' planillas actualizadas de ' + stats.total;
    }

    if(dot){
      dot.classList.remove('fresh-ok','fresh-stale');
      dot.classList.add(stats.allFresh ? 'fresh-ok' : 'fresh-stale');
      if(stats.total === 0){
        dot.title = 'No hay planillas de ' + category + ' para comprobar';
      }else if(stats.allFresh){
        dot.title = 'Todas las planillas de ' + category + ' cumplen la regla de fecha';
      }else{
        dot.title = 'Hay planillas de ' + category + ' que no cumplen la regla de fecha';
      }
    }
  }

  function updateHeaderIndicators(){
    updateCategoryHeaderIndicator('tercera');
    updateCategoryHeaderIndicator('segunda');
  }

  function extractTeamNamesFromData(data){
    const teams = [];

    function push(value){
      const normalized = normalizeTeamName(value);
      if(normalized) teams.push(normalized);
    }

    function walk(value){
      if(!value) return;
      if(typeof value === 'string'){
        push(value);
        return;
      }
      if(Array.isArray(value)){
        value.forEach(walk);
        return;
      }
      if(typeof value === 'object'){
        if(typeof value.equipo === 'string') push(value.equipo);
        if(typeof value.nombre === 'string') push(value.nombre);
        if(typeof value.team === 'string') push(value.team);
        Object.values(value).forEach(walk);
      }
    }

    walk(data);
    return [...new Set(teams)];
  }

  function parseJsLikeTeamFile(text){
    try{
      const teams = [];
      const regex = /(?:equipo|nombre|team)\s*:\s*['"]([^'"]+)['"]/gi;
      let match;
      while((match = regex.exec(text))){
        teams.push(normalizeTeamName(match[1]));
      }
      if(teams.length) return [...new Set(teams)];

      const stringRegex = /['"]([^'"\n\r]{2,})['"]/g;
      while((match = stringRegex.exec(text))){
        const candidate = normalizeTeamName(match[1]);
        if(candidate && /[A-Z]/.test(candidate) && !/^(USE STRICT|CONST|LET|VAR|EXPORT|DEFAULT)$/.test(candidate)){
          teams.push(candidate);
        }
      }
      return [...new Set(teams)];
    }catch(_){
      return [];
    }
  }

  async function fetchTeamNames(paths){
    for(const path of paths){
      try{
        const r = await fetch(path, { cache:'no-store' });
        if(!r.ok) continue;
        const contentType = (r.headers.get('content-type') || '').toLowerCase();
        if(contentType.includes('application/json') || path.endsWith('.json')){
          const data = await r.json();
          const teams = extractTeamNamesFromData(data);
          if(teams.length) return teams;
        }else{
          const text = await r.text();
          const teams = parseJsLikeTeamFile(text);
          if(teams.length) return teams;
        }
      }catch(_){ }
    }
    return [];
  }

  async function loadCategoryMaps(){
    const tercera = await fetchTeamNames([
      '../data/usuarios.tercera.json',
      '/data/usuarios.tercera.json',
      'data/usuarios.tercera.json',
      '../data/usuarios.tercera.js',
      '/data/usuarios.tercera.js',
      'data/usuarios.tercera.js'
    ]);

    const segunda = await fetchTeamNames([
      '../data/usuarios.segunda.json',
      '/data/usuarios.segunda.json',
      'data/usuarios.segunda.json',
      '../data/usuarios.segunda.js',
      '/data/usuarios.segunda.js',
      'data/usuarios.segunda.js'
    ]);

    state.categories.tercera = new Set(tercera);
    state.categories.segunda = new Set(segunda);
  }

  function resolveCategory(team){
    const raw = String(team || '').trim();
    const normalized = normalizeTeamName(raw);
    const compact = normalized
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

    // Prioridad 1: resolver por slug / team key guardado en DB
    if (
      /(?:^|[_\s-])tercera$/.test(raw.toLowerCase()) ||
      compact.endsWith('tercera') ||
      compact.endsWith('3ra') ||
      compact.endsWith('3era')
    ) return 'tercera';

    if (
      /(?:^|[_\s-])segunda$/.test(raw.toLowerCase()) ||
      compact.endsWith('segunda') ||
      compact.endsWith('2da') ||
      compact.endsWith('2nda')
    ) return 'segunda';

    // Prioridad 2: fallback legacy por archivos de usuarios
    if(state.categories.tercera.has(normalized)) return 'tercera';
    if(state.categories.segunda.has(normalized)) return 'segunda';

    return 'sin-categoria';
  }

  function getVisibleFiles(){
    if(!state.activeCategory) return state.allFiles.slice();
    return state.allFiles.filter(item => item.__category === state.activeCategory);
  }

  function compareUpdatedAtAsc(a, b){
    const timeA = a && a.updatedAt ? new Date(a.updatedAt).getTime() : Number.NEGATIVE_INFINITY;
    const timeB = b && b.updatedAt ? new Date(b.updatedAt).getTime() : Number.NEGATIVE_INFINITY;
    const safeA = Number.isFinite(timeA) ? timeA : Number.NEGATIVE_INFINITY;
    const safeB = Number.isFinite(timeB) ? timeB : Number.NEGATIVE_INFINITY;

    if(safeA !== safeB) return safeA - safeB;

    const nameA = String(a?.team || '').toLowerCase();
    const nameB = String(b?.team || '').toLowerCase();
    return nameA.localeCompare(nameB, 'es');
  }

  function updateCategoryButtons(){
    const buttons = document.querySelectorAll('[data-category-filter]');
    buttons.forEach(btn => {
      const isActive = btn.dataset.categoryFilter === state.activeCategory;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function renderBoards(){
    const boards = document.getElementById('boards');
    if(!boards) return;

    boards.innerHTML = '';
    updateHeaderIndicators();

    const visibleFiles = getVisibleFiles().sort(compareUpdatedAtAsc);

    if(!visibleFiles.length){
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No hay planillas para mostrar en esta categoría';
      boards.appendChild(empty);
      updateHeaderIndicators();
      updateCategoryButtons();
      return;
    }

    for(const item of visibleFiles){
      const team = item.team || 'equipo';
      const plan = item.planilla || item.plan || {};
      const updatedAt = item.updatedAt || null;

      const card = document.createElement('article');
      card.className = 'card';
      card.dataset.category = item.__category || 'sin-categoria';

      const categoryPill = document.createElement('div');
      categoryPill.className = 'category-pill';
      categoryPill.textContent = item.__category === 'segunda'
        ? 'SEGUNDA'
        : (item.__category === 'tercera' ? 'TERCERA' : 'SIN CATEGORÍA');
      card.appendChild(categoryPill);

      const h2 = document.createElement('h2');
      h2.textContent = String(team).toUpperCase();
      card.appendChild(h2);

      if(plan && (plan.individuales || plan.pareja1 || plan.pareja2 || plan.suplentes)){
        renderBoard(plan, card);
        markFreshness(card, updatedAt);
      }else{
        renderBoard({ individuales:[], pareja1:[], pareja2:[], suplentes:[] }, card);
        markFreshness(card, updatedAt);
        const small = document.createElement('div');
        small.style.cssText = 'opacity:.8;text-align:center;margin-top:6px;font-size:12px;';
        small.textContent = 'Formato inválido';
        card.appendChild(small);
      }

      boards.appendChild(card);
    }

    updateHeaderIndicators();
    updateCategoryButtons();
  }

  function setupCategoryFilters(){
    const buttons = document.querySelectorAll('[data-category-filter]');
    buttons.forEach(btn => {
      btn.addEventListener('click', ()=>{
        const category = btn.dataset.categoryFilter;
        state.activeCategory = (state.activeCategory === category) ? null : category;
        renderBoards();
      });
    });
    updateCategoryButtons();
  }

  async function init(){
    try{
      const boards = document.getElementById('boards');
      if(!boards){
        showAlert('No existe el contenedor #boards');
        return;
      }

      setupCategoryFilters();
      resetCategoryHeaderIndicators();

      const [_, planillasResponse] = await Promise.all([
        loadCategoryMaps(),
        fetch(`${API_BASE}/api/admin/planillas`, { cache:'no-store' })
      ]);

      if(!planillasResponse.ok){
        throw new Error('No se pudieron cargar las planillas del admin (HTTP ' + planillasResponse.status + ')');
      }

      const files = await planillasResponse.json();

      if(!Array.isArray(files) || !files.length){
        showAlert('No hay planillas para mostrar');
        return;
      }

      state.allFiles = files.map(item => ({
        ...item,
        __category: resolveCategory(item.team)
      }));

      renderBoards();
    }catch(e){
      console.error(e);
      showAlert(e.message || String(e));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

window._sortBoards = function(mode){
  const cont = document.getElementById('boards');
  if(!cont) return;
  const cards = Array.from(cont.querySelectorAll('.card'));
  cards.sort((a,b)=>{
    const ta = (a.querySelector('h2')?.textContent || '').toLowerCase();
    const tb = (b.querySelector('h2')?.textContent || '').toLowerCase();
    if(mode === 'team-desc') return ta < tb ? 1 : (ta > tb ? -1 : 0);
    return ta > tb ? 1 : (ta < tb ? -1 : 0);
  });
  cards.forEach(c=>cont.appendChild(c));
};

// === Indicadores generales por categoría ===
function resetCategoryHeaderIndicators(){
  ['tercera','segunda'].forEach((category) => {
    const suffix = category.charAt(0).toUpperCase() + category.slice(1);
    const dot = document.getElementById('globalIndicator' + suffix);
    const counter = document.getElementById('globalCounter' + suffix);
    if(dot){
      dot.classList.remove('fresh-ok','fresh-stale');
      dot.classList.add('fresh-stale');
      dot.title = 'Comprobando planillas de ' + category + '…';
    }
    if(counter){
      counter.textContent = '0 planillas actualizadas de 0';
    }
  });
}

(function(){
  if (window.__CRUCES_ADMIN_WIRED__) return;
  window.__CRUCES_ADMIN_WIRED__ = true;

  const CATEGORY_KEYS = {
    tercera: '__categoria_tercera__',
    segunda: '__categoria_segunda__'
  };

  function fechaKeyActual(){
    return new Date().toISOString().slice(0,10);
  }

  function getButton(category){
    return document.getElementById(category === 'tercera' ? 'btnHabilitarCrucesTercera' : 'btnHabilitarCrucesSegunda');
  }

  function getLabel(category){
    return document.getElementById(category === 'tercera' ? 'crucesStatusLabelTercera' : 'crucesStatusLabelSegunda');
  }

  function setLoading(category){
    const btn = getButton(category);
    const label = getLabel(category);
    if (!btn) return;

    btn.disabled = true;
    btn.dataset.state = 'loading';
    btn.textContent = category === 'tercera'
      ? 'consultando tercera...'
      : 'consultando segunda...';
    btn.title = 'Consultando estado actual...';

    if (label){
      label.textContent = category === 'tercera'
        ? 'consultando estado de cruces tercera...'
        : 'consultando estado de cruces segunda...';
    }
  }

  function setUI(category, enabled, remainingMs){
    const btn = getButton(category);
    const label = getLabel(category);
    if (!btn) return;

    btn.disabled = false;

    if (enabled){
      btn.textContent = category === 'tercera'
        ? 'deshabilitar cruces tercera'
        : 'deshabilitar cruces segunda';
      btn.dataset.state = 'on';
      const hrs = Math.max(1, Math.floor((remainingMs || 0) / 3600000));
      btn.title = 'Habilitado. Expira en ~' + hrs + 'h';
      if (label) label.textContent = 'los cruces de ' + category + ' están habilitados';
    } else {
      btn.textContent = category === 'tercera'
        ? 'habilitar cruces tercera'
        : 'habilitar cruces segunda';
      btn.dataset.state = 'off';
      btn.title = 'Al hacer clic se habilita por 48 horas';
      if (label) label.textContent = 'los cruces de ' + category + ' están deshabilitados';
    }
  }

  async function getStatus(category){
    const qs = new URLSearchParams({
      team: CATEGORY_KEYS[category],
      fechaKey: fechaKeyActual()
    });

    const r = await fetch(`${API_BASE}/api/cruces/status?` + qs.toString(), {
      cache: 'no-store'
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  }

  async function refreshCategory(category){
    try {
      const j = await getStatus(category);
      setUI(category, !!j.enabled, j.remainingMs);
    } catch (_) {
      setUI(category, false, 0);
    }
  }

  async function refreshAll(){
    await Promise.all([
      refreshCategory('tercera'),
      refreshCategory('segunda')
    ]);
  }

  function wireButton(category){
    const btn = getButton(category);
    if (!btn || btn.__wired) return;
    btn.__wired = true;

    let inflight = false;

    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (inflight || btn.dataset.state === 'loading') return;
      inflight = true;

      const old = btn.textContent;
      const turningOff = btn.dataset.state === 'on';

      btn.disabled = true;
      btn.textContent = turningOff
        ? ('deshabilitando ' + category + '...')
        : ('habilitando ' + category + '...');

      try {
        const endpoint = turningOff
          ? '/api/cruces/disable'
          : '/api/cruces/enable';

        const r = await fetch(`${API_BASE}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            team: CATEGORY_KEYS[category],
            fechaKey: fechaKeyActual()
          })
        });

        if (!r.ok) throw new Error('HTTP ' + r.status);
        await refreshCategory(category);
      } catch (e) {
        btn.textContent = old;
        alert('No se pudo actualizar cruces de ' + category + ': ' + ((e && e.message) || e));
      } finally {
        btn.disabled = false;
        setTimeout(() => { inflight = false; }, 300);
      }
    }, { once: false, passive: false });
  }

  wireButton('tercera');
  wireButton('segunda');

  setLoading('tercera');
  setLoading('segunda');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshAll, { once: true });
  } else {
    refreshAll();
  }

  try {
    const es = new EventSource(`${API_BASE}/api/cruces/stream`);
    es.onmessage = () => refreshAll();
  } catch (_) {}

  setInterval(refreshAll, 15000);
})();