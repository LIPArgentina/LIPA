
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
      return d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
    }catch(_){
      return false;
    }
  }

  function markFreshness(card, updatedAt){
    try{
      const isToday = !!updatedAt && isSameLocalDay(updatedAt);
      updateGlobalJsIndicator(isToday);

      let wrap = card.querySelector('.title-indicator');
      if(!wrap){ wrap = document.createElement('div'); wrap.className='title-indicator'; card.appendChild(wrap); }

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
    const normalized = normalizeTeamName(team);
    if(state.categories.tercera.has(normalized)) return 'tercera';
    if(state.categories.segunda.has(normalized)) return 'segunda';
    return 'sin-categoria';
  }

  function getVisibleFiles(){
    if(!state.activeCategory) return state.allFiles.slice();
    return state.allFiles.filter(item => item.__category === state.activeCategory);
  }

  function updateCategoryButtons(){
    const buttons = document.querySelectorAll('[data-category-filter]');
    buttons.forEach(btn => {
      const isActive = btn.dataset.categoryFilter === state.activeCategory;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    const badge = document.getElementById('categoryFilterStatus');
    if(!badge) return;
    if(!state.activeCategory){
      badge.textContent = 'Mostrando todas las planillas';
      return;
    }
    badge.textContent = 'Filtro activo: ' + state.activeCategory;
  }

  function renderBoards(){
    const boards = document.getElementById('boards');
    if(!boards) return;

    boards.innerHTML = '';
    resetGlobalJsIndicator();

    const visibleFiles = getVisibleFiles();

    if(!visibleFiles.length){
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No hay planillas para mostrar en esta categoría';
      boards.appendChild(empty);
      updateGlobalJsIndicator(true);
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

    if(typeof window._sortBoards === 'function'){
      window._sortBoards('team-asc');
    }

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

      const [_, planillasResponse] = await Promise.all([
        loadCategoryMaps(),
        fetch('/api/admin/planillas', { cache:'no-store' })
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

// === Indicador global de actualidad ===
let GLOBAL_JS_ALL_TODAY = true;
let GLOBAL_JS_CHECKS = 0;

function resetGlobalJsIndicator(){
  GLOBAL_JS_ALL_TODAY = true;
  GLOBAL_JS_CHECKS = 0;
  const dot = document.getElementById('globalJsIndicator');
  if (!dot) return;
  dot.classList.remove('fresh-ok','fresh-stale');
  dot.classList.add('fresh-stale');
  dot.title = 'Comprobando fecha de planillas…';
}

function updateGlobalJsIndicator(isToday){
  GLOBAL_JS_CHECKS++;
  if (!isToday) GLOBAL_JS_ALL_TODAY = false;
  const dot = document.getElementById('globalJsIndicator');
  if (!dot) return;
  dot.classList.remove('fresh-ok','fresh-stale');
  dot.classList.add(GLOBAL_JS_ALL_TODAY ? 'fresh-ok' : 'fresh-stale');
  dot.title = GLOBAL_JS_CHECKS === 0
    ? 'Comprobando fecha de planillas…'
    : (GLOBAL_JS_ALL_TODAY
      ? 'Todas las planillas visibles son del día'
      : 'Hay planillas visibles con fecha anterior');
}

(function(){
  if (window.__CRUCES_ADMIN_WIRED__) return;
  window.__CRUCES_ADMIN_WIRED__ = true;

  const btn = document.getElementById('btnHabilitarCruces');
  if(!btn) return;
  if (btn.__wired) return; btn.__wired = true;

  let inflight = false;

  function currentTeam(){
    try{ return new URLSearchParams(location.search).get('team') || '*'; }catch(_){ return '*'; }
  }
  const fechaKey = new Date().toISOString().slice(0,10);

  async function getStatus(){
    const qs = new URLSearchParams({ team: currentTeam(), fechaKey });
    const r = await fetch('/api/cruces/status?' + qs.toString(), { cache:'no-store' });
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  }

  function setUI(enabled, remainingMs){
    const label = document.getElementById('crucesStatusLabel');
    if (enabled){
      btn.textContent = 'deshabilitar cruces';
      btn.dataset.state = 'on';
      const hrs = Math.max(1, Math.floor((remainingMs||0)/3600000));
      btn.title = 'Habilitado. Expira en ~' + hrs + 'h';
      if(label) label.textContent = 'los cruces están habilitados';
    }else{
      btn.textContent = 'habilitar cruces';
      btn.dataset.state = 'off';
      btn.title = 'Al hacer clic se habilita por 48 horas';
      if(label) label.textContent = 'los cruces están deshabilitados';
    }
  }

  async function refresh(){
    try{
      const j = await getStatus();
      setUI(!!j.enabled, j.remainingMs);
    }catch(_){
      setUI(false, 0);
    }
  }

  btn.addEventListener('click', async (ev)=>{
    ev.preventDefault(); ev.stopPropagation();
    if (inflight) return; inflight = true;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = (btn.dataset.state === 'on') ? 'deshabilitando…' : 'habilitando…';
    try{
      const endpoint = (btn.dataset.state === 'on')
        ? '/api/cruces/disable'
        : '/api/cruces/enable';

      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ team: currentTeam(), fechaKey })
      });
      if(!r.ok) throw new Error('HTTP '+r.status);
      await refresh();
    }catch(e){
      btn.textContent = old;
      alert('No se pudo actualizar cruces: ' + (e && e.message || e));
    }finally{
      btn.disabled = false;
      setTimeout(()=>{ inflight = false; }, 300);
    }
  }, { once:false, passive:false });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh, { once:true });
  } else {
    refresh();
  }

  try{
    const es = new EventSource('/api/cruces/stream');
    es.onmessage = ()=> refresh();
  }catch(_){}
})();
