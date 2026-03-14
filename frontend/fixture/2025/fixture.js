(function(){
  const KIND_KEY = 'fixture_kind';    // ida | vuelta
  const CAT_KEY  = 'fixture_cat';     // primera | segunda | tercera
  const SCRIPT_ID = 'fixture-data-script';

  
  let PERSIST_WARNED = false;
function removeExistingScript(){
    const old = document.getElementById(SCRIPT_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
  function injectScript(src){
    return new Promise((resolve, reject) => {
      removeExistingScript();
      try { delete window.LPI_FIXTURE; } catch(_) { window.LPI_FIXTURE = undefined; }
      const s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.src = src;
      s.async = false;
      s.onload = () => resolve(src);
      s.onerror = () => reject(new Error('No se pudo cargar: ' + src));
      document.head.appendChild(s);
    });
  }
  
  function getStored(key, fallback){ try { return localStorage.getItem(key) || fallback; } catch(_) { return fallback; } }
  function setStored(key, val){
    try { localStorage.setItem(key, val); }
    catch(e){ if(!PERSIST_WARNED){ PERSIST_WARNED = true; alert('No se pudo guardar tu preferencia en este navegador. Se usará un valor temporal.'); } }
  }

  function markActiveKind(kind){
    document.querySelectorAll('[data-fixture]').forEach(el=>{
      const isActive = el.getAttribute('data-fixture') === kind;
      el.classList.toggle('active', isActive);
    });
  }
  function markActiveCat(cat){
    document.querySelectorAll('[data-cat]').forEach(el=>{
      const isActive = el.getAttribute('data-cat') === cat;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-pressed', String(isActive));
    });
  }

  window.FixtureSwitcher = {
    async switch(kind, opts = {}){
      const category = (opts.category) || getStored(CAT_KEY, 'tercera');
      const base = opts.base || './';
      const persist = opts.persist !== false;

      let file;
      if (kind === 'ida')      file = `fixture.ida.${category}.js`;
      else if (kind === 'vuelta') file = `fixture.vuelta.${category}.js`;
      else if (!/\.js($|\?)/i.test(kind)) file = String(kind) + '.js';
      else file = kind;

      const src = (base.endsWith('/') ? base : base + '/') + file;
      await injectScript(src);

      markActiveKind(kind);
      markActiveCat(category);

      const detail = { src, kind, category, fixture: window.LPI_FIXTURE || null };
      document.dispatchEvent(new CustomEvent('fixture:data-ready', { detail }));
      if (typeof window.applyFixture === 'function') { try { window.applyFixture(); } catch(e){} }

      if (persist){
        setStored(KIND_KEY, kind);
        setStored(CAT_KEY, category);
      }
      return detail;
    },

    setCategory(cat, opts = {}){
      const category = String(cat || 'tercera').toLowerCase();
      setStored(CAT_KEY, category);
      markActiveCat(category);
      return this.switch('ida', { base: opts.base, category, persist: true });
    },

    bind(opts = {}){
      const selKind = opts.selectorKind || '[data-fixture]';
      const selCat  = opts.selectorCat  || '[data-cat]';

      document.querySelectorAll(selKind).forEach(el => {
        const handler = (ev) => {
          if (el.tagName === 'A') ev.preventDefault();
          const kind = el.getAttribute('data-fixture') || 'ida';
          const category = getStored(CAT_KEY, 'tercera');
          this.switch(kind, { category }).catch(err => { console.error(err); alert(err.message||err); });
        };
        el.addEventListener('click', handler);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(e); } });
      });

      document.querySelectorAll(selCat).forEach(el => {
        const handler = (ev) => {
          if (el.tagName === 'A') ev.preventDefault();
          const cat = el.getAttribute('data-cat') || 'tercera';
          this.setCategory(cat, { base: opts.base }).catch(err => { console.error(err); alert(err.message||err); });
        };
        el.addEventListener('click', handler);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(e); } });
      });
    },

    restore(opts = {}){
      const category = getStored(CAT_KEY, 'tercera');
      let kind = getStored(KIND_KEY, null);
      if (!kind) kind = (opts.fallback || 'ida');
      markActiveCat(category);
      markActiveKind(kind);
      return this.switch(kind, { base: opts.base, category });
    }
  };
})();

// === Module chunk separator ===

/* --- Cargar equipos desde usuarios.<cat>.js --- */
function loadUsersJS(cat){
  return new Promise((resolve, reject) => {
    const ID = 'users-script';
    const old = document.getElementById(ID);
    if (old) old.remove();                     // quita el script anterior si había

    // Limpia LPI_USERS previo
    try { delete window.LPI_USERS; } catch(_) { window.LPI_USERS = undefined; }

    const s = document.createElement('script');
    s.id = ID;
    s.src = `../data/usuarios.${cat}.js`;   // <-- tu ruta de JS
    s.onload = () => {
      const arr = (window.LPI_USERS || [])
        .filter(u => u.role === 'team')
        .map(u => u.username);
      const uniq = Array.from(new Set(arr.filter(n => n && n.trim() !== '')));
      const resto = uniq.filter(n => n !== 'WO')
        .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
      const equipos = ['WO', ...resto];
      resolve(equipos);
    };
    s.onerror = () => reject(new Error(`No se pudo cargar usuarios.${cat}.js`));
    document.head.appendChild(s);
  });
}

// Restaura fechas desde el fixture (si el JS las trae)
function restoreDatesFromFixture(fx){
  if (!fx || !Array.isArray(fx.fechas)) return;
  for (let fecha=1; fecha<=7; fecha++){
    const f = fx.fechas[fecha-1];
    if (!f) continue;
    const rows = document.querySelector(`.rows[data-fecha="${fecha}"]`);
    if (!rows) continue;
    const header = rows.previousElementSibling && rows.previousElementSibling.previousElementSibling
      ? rows.previousElementSibling.previousElementSibling
      : document.querySelector('.fecha-header');
    const dateInput = header && header.querySelector && header.querySelector('.fecha-input');
    if (dateInput && typeof f.date === 'string') dateInput.value = f.date;
  }
}

  
/* --- Render con SELECTS: equipos + puntos --- */
function renderRows(rowsCont, equipos, fecha, grupo, equiposCat){
  rowsCont.innerHTML = '';
  const __list = (equipos || []);
  if (__list.length % 2 !== 0) console.warn('Número impar de equipos en fecha ' + fecha);
  const total = Math.floor(__list.length / 2);
  for (let k = 0; k < total; k++){
    const iL = 2*k, iV = 2*k+1;
    const L = equipos[iL] || {equipo:'', puntos:''};
    const V = equipos[iV] || {equipo:'', puntos:''};

    const row = document.createElement('div');
    row.className = 'row';

    // Puntos local (0–9)
    const puntL = document.createElement('select');
    puntL.className = 'score-badge';
    puntL.dataset.field = 'puntos'; puntL.dataset.side = 'L';
    puntL.dataset.fecha = fecha; puntL.dataset.grupo = grupo; puntL.dataset.index = k;
    for (let n=0; n<=9; n++){ const o=document.createElement('option'); o.value=o.textContent=String(n); puntL.appendChild(o); }
    if (L.puntos !== undefined && L.puntos !== '') puntL.value = String(L.puntos).slice(0,1);

    // Equipo local
    const selL = document.createElement('select');
    selL.className = 'team-name';
    selL.dataset.field = 'equipo'; selL.dataset.side = 'L';
    selL.dataset.fecha = fecha; selL.dataset.grupo = grupo; selL.dataset.index = k;
    equiposCat.forEach(n => { const o=document.createElement('option'); o.value=o.textContent=n; selL.appendChild(o); });
    if (L.equipo) selL.value = L.equipo; else selL.value = 'WO';

    // VS
    const vs = document.createElement('div');
    vs.className = 'vs';
    vs.textContent = 'VS';

    // Equipo visitante
    const selV = document.createElement('select');
    selV.className = 'team-name';
    selV.dataset.field = 'equipo'; selV.dataset.side = 'V';
    selV.dataset.fecha = fecha; selV.dataset.grupo = grupo; selV.dataset.index = k;
    equiposCat.forEach(n => { const o=document.createElement('option'); o.value=o.textContent=n; selV.appendChild(o); });
    if (V.equipo) selV.value = V.equipo; else selV.value = 'WO';

    // Puntos visitante (0–9)
    const puntV = document.createElement('select');
    puntV.className = 'score-badge';
    puntV.dataset.field = 'puntos'; puntV.dataset.side = 'V';
    puntV.dataset.fecha = fecha; puntV.dataset.grupo = grupo; puntV.dataset.index = k;
    for (let n=0; n<=9; n++){ const o=document.createElement('option'); o.value=o.textContent=String(n); puntV.appendChild(o); }
    if (V.puntos !== undefined && V.puntos !== '') puntV.value = String(V.puntos).slice(0,1);

    row.appendChild(puntL);
    row.appendChild(selL);
    row.appendChild(vs);
    row.appendChild(selV);
    row.appendChild(puntV);
    rowsCont.appendChild(row);
  }
}

  
/* --- applyFixture: carga usuarios según categoría y pinta --- */
window.applyFixture = async function applyFixture(){
  const fx = window.LPI_FIXTURE;
  if (!fx) { alert('No se pudo cargar el fixture'); return; }

  // categoría guardada (tal como ya hacías)
  const cat = (localStorage.getItem('fixture_cat') || 'tercera');
  const equiposCat = await loadUsersJS(cat);   // <- carga desde usuarios.<cat>.js

  // helpers locales
  function clearGroups(){
    document.querySelectorAll('section.card[data-group] .rows, section.card[data-group] .rule, section.card[data-group] .fecha-header, section.card[data-group] .h2')
      .forEach(n => n.remove());
  }
  function ensureFechaBlocks(){
  const tpl = document.getElementById('tpl-fecha');
  document.querySelectorAll('section.card[data-group]').forEach(section => {
    const existingFechas = Array.from(section.querySelectorAll('.rows[data-fecha]')).map(el => Number(el.getAttribute('data-fecha')));
    const maxFecha = Math.max(...existingFechas, 7); // Dinámico basado en existentes o al menos 7
    for(let fecha=1; fecha<=maxFecha; fecha++){
      if (section.querySelector(`.rows[data-fecha="${fecha}"]`)) continue;
      const clone = document.importNode(tpl.content, true);
      const h2 = clone.querySelector('.h2'); if (h2) h2.textContent = fecha + 'ª FECHA';
      clone.querySelector('.rows').setAttribute('data-fecha', String(fecha));
      section.appendChild(clone);
    }
  });
}

  clearGroups();
  ensureFechaBlocks();
  restoreDatesFromFixture(fx);

  const rowsAll = document.querySelectorAll('.rows[data-fecha]');
  const fechas = Array.from(new Set(Array.from(rowsAll).map(el => Number(el.getAttribute('data-fecha'))))).sort((a,b)=>a-b);

  for (let fecha of fechas){
    ['A','B'].forEach(grupo => {
      const cont = document.querySelector(`section.card[data-group="${grupo}"] [data-fecha="${fecha}"]`);
      if (!cont) return;
      const tabla = (fx.fechas?.[fecha-1]?.tablas || []).find(t => (t.grupo||'').toUpperCase() === grupo);
      const equipos = tabla?.equipos || [];
      renderRows(cont, equipos, fecha, grupo, equiposCat); // <- pasa equiposCat
    });
  }
};


  window.addEventListener('load', () => {
    FixtureSwitcher.bind();
    FixtureSwitcher.restore({ fallback: 'ida' });
  });


/* === Helper: alterna categoria 'local'/'visitante' al guardar === */
function assignCategoriasAlternadas(fixture, scope = 'fecha'){
  if (!fixture || !Array.isArray(fixture.fechas)) return fixture;
  for (const fecha of fixture.fechas){
    if (!Array.isArray(fecha.tablas)) continue;
    if (scope === 'tabla'){
      // Alterna dentro de cada tabla (A y B por separado)
      for (const tabla of fecha.tablas){
        if (!Array.isArray(tabla.equipos)) continue;
        for (let i = 0; i < tabla.equipos.length; i++){
          const eq = tabla.equipos[i];
          if (eq && typeof eq === 'object'){
            eq.categoria = (i % 2 === 0) ? 'local' : 'visitante';
          }
        }
      }
    } else {
      // Alterna a lo largo de toda la fecha (A continúa en B)
      const refs = [];
      for (const tabla of fecha.tablas){
        if (Array.isArray(tabla.equipos)){
          for (let i = 0; i < tabla.equipos.length; i++) refs.push(tabla.equipos[i]);
        }
      }
      for (let i = 0; i < refs.length; i++){
        const eq = refs[i];
        if (eq && typeof eq === 'object'){
          eq.categoria = (i % 2 === 0) ? 'local' : 'visitante';
        }
      }
    }
  }
  return fixture;
}

// === Construye objeto fixture con fechas incluidas ===
function buildFixtureFromUI(){
  const fechasArr = [];
  const rowsAll = document.querySelectorAll('.rows[data-fecha]');
  const fechas = Array.from(new Set(Array.from(rowsAll).map(el => Number(el.getAttribute('data-fecha'))))).sort((a,b)=>a-b);
  for (let fecha of fechas){
    const entry = { date: '', tablas: [] };
    const anyRows = document.querySelector(`.rows[data-fecha="${fecha}"]`);
    if (anyRows){
      const header = anyRows.previousElementSibling && anyRows.previousElementSibling.previousElementSibling
        ? anyRows.previousElementSibling.previousElementSibling
        : document.querySelector('.fecha-header');
      const dateInput = header && header.querySelector && header.querySelector('.fecha-input');
      if (dateInput) entry.date = dateInput.value || '';
    }
    ['A','B'].forEach(grupo => {
      const rows = document.querySelector(`section.card[data-group="${grupo}"] .rows[data-fecha="${fecha}"]`);
      const equipos = [];
      if (rows){
        rows.querySelectorAll('.row').forEach(row => {
          const selL  = row.querySelector('select.team-name[data-side="L"]');
          const selV  = row.querySelector('select.team-name[data-side="V"]');
          const puntL = row.querySelector('select.score-badge[data-side="L"]');
          const puntV = row.querySelector('select.score-badge[data-side="V"]');
          equipos.push({ equipo: selL ? selL.value : '', puntos: puntL ? Number(puntL.value||0) : 0 });
          equipos.push({ equipo: selV ? selV.value : '', puntos: puntV ? Number(puntV.value||0) : 0 });
        });
      }
      entry.tablas.push({ grupo, equipos });
    });
    fechasArr.push(entry);
  }
  return { fechas: fechasArr };
}
function currentCategoryKind(){
  const cat  = (localStorage.getItem('fixture_cat')  || 'tercera');
  const kind = (localStorage.getItem('fixture_kind') || 'ida');
  return { cat, kind };
}
async function saveFixtureJSOnServer(){
  const { cat, kind } = currentCategoryKind();
  const filename    = `fixture.${kind}.${cat}`;
  const relPathJS   = `fixture/${filename}.js`;
  const relPathJSON = `fixture/${filename}.json`;
  const data    = buildFixtureFromUI();
  // Alternar categoria antes de guardar (por fecha completa)
  assignCategoriasAlternadas(data, 'fecha');

  const js      = "window.LPI_FIXTURE = " + JSON.stringify(data, null, 2) + "\n";
  const jsonStr = JSON.stringify(data, null, 2);
  // JS
  {
    const resp = await fetch('/api/save-js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPathJS, content: js })
    });
    const j = await resp.json().catch(()=>({ok:false}));
    if (!resp.ok || !j.ok) throw new Error(j.error || `Error guardando ${relPathJS}`);
  }
  // JSON
  {
    const resp = await fetch('/api/save-js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPathJSON, content: jsonStr })
    });
    const j = await resp.json().catch(()=>({ok:false}));
    if (!resp.ok || !j.ok) throw new Error(j.error || `Error guardando ${relPathJSON}`);
  }
  showToast('Guardado correctamente');
}
(function wireUnifiedSave(){
  const btn = document.getElementById('saveFixture');
  if (!btn) return;
  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try {
      await saveFixtureJSOnServer();
    } catch(e){
      console.error(e);
      alert(e && e.message ? e.message : 'Error al guardar');
    }
  });
})();

function showToast(message, ms=2500){
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=>{ el.classList.remove('show'); }, ms);
}

// === Module chunk separator ===

/* === Parche: la fecha del Grupo B replica la del Grupo A si viene vacía === */
(function mirrorGroupBDatesFromA(){
  function headerOf(group, fecha){
    const rows = document.querySelector(`section.card[data-group="${group}"] .rows[data-fecha="${fecha}"]`);
    if (!rows) return null;
    const header = rows.previousElementSibling && rows.previousElementSibling.previousElementSibling
      ? rows.previousElementSibling.previousElementSibling
      : null;
    return header;
  }
  function getDateValue(group, fecha){
    const h = headerOf(group, fecha);
    if (!h) return '';
    const inp = h.querySelector && h.querySelector('.fecha-input');
    return inp ? String(inp.value||'').trim() : '';
  }
  function setDateValue(group, fecha, value){
    const h = headerOf(group, fecha);
    if (!h) return;
    const inp = h.querySelector && h.querySelector('.fecha-input');
    if (inp) inp.value = value || '';
  }

  function mirrorAll(){
    // Contá cuántas fechas hay construidas
    const countA = document.querySelectorAll('section.card[data-group="A"] .rows[data-fecha]').length;
    const countB = document.querySelectorAll('section.card[data-group="B"] .rows[data-fecha]').length;
    const total = Math.max(countA, countB, 7);
    for (let f=1; f<=total; f++){
      const a = getDateValue('A', f);
      const b = getDateValue('B', f);
      if (a && !b) setDateValue('B', f, a);
    }
  }

  // 1) Envolvemos applyFixture si existe
  const _orig = window.applyFixture;
  window.applyFixture = async function(){
    if (typeof _orig === 'function'){
      try { await _orig(); } catch(e){ console.error(e); }
    }
    mirrorAll();
  };

  // 2) También nos enganchamos al evento de datos
  document.addEventListener('fixture:data-ready', mirrorAll);

  // 3) Por si ya se construyó todo antes
  window.addEventListener('load', mirrorAll);
})();