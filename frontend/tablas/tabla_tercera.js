/* JS extraído de tabla_tercera.html */

// Sincroniza el ancho de ambas .table-wrap al de la más ancha
  function equalizeTableWidths(){
    const wraps = Array.from(document.querySelectorAll('.table-wrap'));
    if(!wraps.length) return;
    // reset widths to natural content size to measure
    wraps.forEach(w => w.style.width = '');
    // for accurate measure after fonts load
    const widths = wraps.map(w => w.getBoundingClientRect().width);
    const max = Math.ceil(Math.max.apply(null, widths));
    wraps.forEach(w => w.style.width = max + 'px');
  }

  // Debounce util
  function debounce(fn, wait){
    let t; return function(){ clearTimeout(t); t = setTimeout(fn, wait); };
  }

  document.addEventListener('DOMContentLoaded', function(){
    fillDashes();
    // Igualar una vez cargado el DOM
    equalizeTableWidths();

    // Recalcular cuando cargan las fuentes (impacta en ancho)
    if(document.fonts && document.fonts.ready){
      document.fonts.ready.then(equalizeTableWidths);
    }

    // Recalcular en resize
    window.addEventListener('resize', debounce(equalizeTableWidths, 120));

    // Recalcular si cambia el contenido (por ejemplo, si inyectás equipos por JS)
    const ro = new ResizeObserver(debounce(equalizeTableWidths, 60));
    document.querySelectorAll('.board').forEach(b => ro.observe(b));
  });

// --- siguiente bloque de script ---

// Versión simplificada sin categorías: sólo ida/vuelta de "tercera"
(function(){
  const SCRIPT_ID = 'fixture-data-script';

  function injectScript(src){
    return new Promise((resolve, reject) => {
      // limpiar script anterior
      const existing = document.getElementById(SCRIPT_ID);
      if (existing) existing.remove();

      const s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.src = src;
      s.async = false;
      s.onload = () => resolve(src);
      s.onerror = () => reject(new Error('No se pudo cargar: ' + src));
      document.head.appendChild(s);
    });
  }

  async function load(kind){
    // Mapea ida/vuelta a archivos fijos
    const file = kind === 'vuelta' ? '../fixture/fixture.vuelta.tercera.js' : '../fixture/fixture.ida.tercera.js';
    const src = file;
    await injectScript(src);
    // Notificar y aplicar render si existe
    const detail = { src, kind, category: 'tercera', fixture: window.LPI_FIXTURE || null };
    document.dispatchEvent(new CustomEvent('fixture:data-ready', { detail }));
    if (typeof window.applyFixture === 'function') { try { window.applyFixture(); } catch(_){} }
    // Guardar última selección de ida/vuelta
    try { localStorage.setItem('fixture_kind', kind); } catch(_){}
    return detail;
  }

  // Bind de botones [data-fixture]
  function bind(){
    document.querySelectorAll('[data-fixture]').forEach(el => {
      const handler = (ev) => {
        if (el.tagName === 'A') ev.preventDefault();
        const kind = el.getAttribute('data-fixture') || 'ida';
        load(kind).catch(err => { console.error(err); alert(err.message||err); });
      };
      el.addEventListener('click', handler);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(e); } });
    });
  }

  // Restaurar última (por defecto 'ida')
  function restore(){
    let kind = 'ida';
    try { kind = localStorage.getItem('fixture_kind') || 'ida'; } catch(_){}
    return load(kind);
  }

  window.FixtureSwitcher = { switch: load, bind, restore };

  // Init
  window.addEventListener('DOMContentLoaded', () => { bind(); restore(); });
})();

// --- siguiente bloque de script ---

// ==== SOLO LECTURA ====
function clearGroups(){
  document.querySelectorAll('section.card[data-group] .rows, section.card[data-group] .rule, section.card[data-group] .fecha-header, section.card[data-group] .h2')
    .forEach(n => n.remove());
}

function ensureFechaBlocks(totalFechas){
  const tpl = document.getElementById('tpl-fecha');
  document.querySelectorAll('section.card[data-group]').forEach(section => {
    for(let fecha=1; fecha<=totalFechas; fecha++){
      if (section.querySelector(`.rows[data-fecha="${fecha}"]`)) continue;
      const clone = document.importNode(tpl.content, true);
      const h2 = clone.querySelector('.h2'); if (h2) h2.textContent = fecha + 'ª FECHA';
      clone.querySelector('.rows').setAttribute('data-fecha', String(fecha));
      section.appendChild(clone);
    }
  });
}

// Formatea a dd/mm/aaaa si parece una fecha válida (si no, deja el texto tal cual)
function formatDateDMY(val){
  if (val == null) return '';
  const s = String(val).trim();
  if (!s) return '';
  // Si ya viene como dd/mm/aaaa, lo dejamos
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s.padStart(10,'0');
  // Normalizar separadores a '-'
  const norm = s.replace(/[\.\/]/g,'-');
  // Casos ISO (yyyy-mm-dd)
  let m = norm.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m){
    const [_,Y,M,D] = m;
    const dd = String(parseInt(D,10)).padStart(2,'0');
    const mm = String(parseInt(M,10)).padStart(2,'0');
    const yyyy = String(parseInt(Y,10)).padStart(4,'0');
    return dd + '/' + mm + '/' + yyyy;
  }
  // Casos dd-mm-yyyy
  m = norm.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m){
    const [_,D,M,Y] = m;
    const dd = String(parseInt(D,10)).padStart(2,'0');
    const mm = String(parseInt(M,10)).padStart(2,'0');
    const yyyy = String(parseInt(Y,10)).padStart(4,'0');
    return dd + '/' + mm + '/' + yyyy;
  }
  // Intento con Date.parse para strings conocidos (mes en texto, etc.)
  const t = Date.parse(s);
  if (!Number.isNaN(t)){
    const d = new Date(t);
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = String(d.getFullYear()).padStart(4,'0');
    return dd + '/' + mm + '/' + yyyy;
  }
  // Si no se reconoce, se deja como está
  return s;
}

function setHeaderDate(fechaIndex, value){
  document.querySelectorAll(`.rows[data-fecha="${fechaIndex}"]`).forEach(rows => {
    const header = rows.previousElementSibling && rows.previousElementSibling.previousElementSibling
      ? rows.previousElementSibling.previousElementSibling
      : null;
    if (!header) return;
    const box = header.querySelector('.fecha-text');
    const formatted = formatDateDMY(value);
    box.textContent = formatted;
  });
}

function renderRowsStatic(rowsCont, equipos){
  rowsCont.innerHTML = '';
  const list = Array.isArray(equipos) ? equipos : [];
  const total = Math.floor(list.length / 2);
  for (let k=0; k<total; k++){
    const iL = 2*k, iV = 2*k+1;
    const L = list[iL] || {equipo:'', puntos:''};
    const V = list[iV] || {equipo:'', puntos:''};

    const row = document.createElement('div');
    row.className = 'row';

    const puntL = document.createElement('div');
    puntL.className = 'score-badge';
    puntL.setAttribute('aria-label', 'Puntos local');
    puntL.textContent = (L.puntos ?? '') === '' ? '' : String(L.puntos).slice(0,1);

    const selL = document.createElement('div');
    selL.className = 'team-name';
    selL.textContent = L.equipo || '';

    const vs = document.createElement('div');
    vs.className = 'vs';
    vs.textContent = 'VS';

    const selV = document.createElement('div');
    selV.className = 'team-name';
    selV.textContent = V.equipo || '';

    const puntV = document.createElement('div');
    puntV.className = 'score-badge';
    puntV.setAttribute('aria-label', 'Puntos visitante');
    puntV.textContent = (V.puntos ?? '') === '' ? '' : String(V.puntos).slice(0,1);

    row.append(puntL, selL, vs, selV, puntV);
    rowsCont.appendChild(row);
  }
}

window.applyFixture = function applyFixture(){
  const fx = window.LPI_FIXTURE;
  if (!fx) { alert('No se pudo cargar el fixture'); return; }

  const totalFechas = Array.isArray(fx.fechas) ? fx.fechas.length : 7;
  clearGroups();
  ensureFechaBlocks(totalFechas);

  for (let fecha=1; fecha<=totalFechas; fecha++){
    const f = fx.fechas && fx.fechas[fecha-1];
    // Tomar cualquier key posible para la fecha:
    const fechaTexto = (f && (f.date || f.fecha || f.dia || f.when || f.title || f.titulo)) || '';
    setHeaderDate(fecha, fechaTexto);

    ['A','B'].forEach(grupo => {
      const cont = document.querySelector(`section.card[data-group="${grupo}"] .rows[data-fecha="${fecha}"]`);
      if (!cont) return;
      const tabla = (f?.tablas || []).find(t => (t.grupo||'').toUpperCase() === grupo);
      const equipos = tabla?.equipos || [];
      renderRowsStatic(cont, equipos);
    });
  }
};

window.addEventListener('load', () => {
  FixtureSwitcher.bind();
  FixtureSwitcher.restore({ fallback: 'ida' });
});

// --- siguiente bloque de script ---

(() => {
  const norm = s => (s||'').toString().trim().replace(/\s+/g,' ');
  const cache = { ida: null, vuelta: null };

  function addToCache(kind, fixture){
    if (!fixture) return;
    if (kind === 'ida') cache.ida = fixture;
    if (kind === 'vuelta') cache.vuelta = fixture;
  }

  function calcRows(feeds){
    const puntos = { A:Object.create(null), B:Object.create(null) };
    const ju = { A:Object.create(null), B:Object.create(null) };
    (feeds||[]).forEach(feed => {
      (feed.fechas||[]).forEach(fecha => {
        (fecha.tablas||[]).forEach(tabla => {
          const g = (tabla.grupo||'').toUpperCase();
          if (!puntos[g]) return;
          const equipos = (tabla.equipos||[]).map(e => ({equipo:e.equipo, puntos: parseInt(e.puntos||0,10)||0}));
          // puntos
          equipos.forEach(it => {
            const key = norm(it.equipo);
            if (!puntos[g][key]) puntos[g][key] = { equipo: it.equipo, pts: 0 };
            puntos[g][key].pts += it.puntos;
          });
          // cruces y JU
          for (let i=0;i<equipos.length;i+=2){
            const A = equipos[i], B = equipos[i+1];
            if (!A || !B) continue;
            const aK = norm(A.equipo), bK = norm(B.equipo);
            const ambosCero = A.puntos===0 && B.puntos===0;
            const aWO = aK.toUpperCase()==='WO', bWO = bK.toUpperCase()==='WO';
            if (ambosCero) continue;
            if (aWO || bWO) continue;
            ju[g][aK] = (ju[g][aK]||0) + 1;
            ju[g][bK] = (ju[g][bK]||0) + 1;
          }
        });
      });
    });
    function ordenar(gkey){
      const rows = Object.values(puntos[gkey]).sort((a,b)=> b.pts - a.pts || String(a.equipo).localeCompare(String(b.equipo)));
      return rows.map((r,i)=>({ pos:i+1, equipo:r.equipo, ju:(ju[gkey][norm(r.equipo)]||0)||'', tr:'', pts:r.pts }));
    }
    return { A: ordenar('A'), B: ordenar('B') };
  }

  function fillBoard(boardEl, data){
    if (!boardEl) return;
    const rows = boardEl.querySelectorAll('.row[role="row"]');
    for (let i=0; i<rows.length && i<data.length; i++){
      const d = data[i], row = rows[i];
      const set = (name,val)=>{ const el=row.querySelector('[data-field="'+name+'"]'); if (el) el.textContent = (val ?? ''); };
      set('pos', d.pos); set('team', d.equipo); set('ju', d.ju); set('tr', d.tr); set('pts', d.pts);
    }
  }

  function render(){
    const feeds = [cache.ida, cache.vuelta].filter(Boolean);
    if (!feeds.length) return;
    const {A,B} = calcRows(feeds);
    const boards = document.querySelectorAll('#posiciones .board');
    if (boards.length>=2){ fillBoard(boards[0],A); fillBoard(boards[1],B); }
    else boards.forEach((b,idx)=> fillBoard(b, idx===0?A:B));
  }

  // Escuchar datos que carga el sitio
  document.addEventListener('fixture:data-ready', (ev) => {
    const { kind, category, fixture } = ev.detail || {};
    if (category!=='tercera') return;
    addToCache(kind, fixture);
    render();
  });

  // Pre-cargar ida + vuelta con el loader del sitio y restaurar la vista del usuario
  window.addEventListener('load', async () => {
    const FS = window.FixtureSwitcher;
    if (!FS || typeof FS.switch!=='function') { render(); return; }
    let last = 'ida'; try { last = localStorage.getItem('fixture_kind') || 'ida'; } catch(_){}
    try {
      await FS.switch('ida');    // carga ida y dispara evento => cache.ida
      await FS.switch('vuelta'); // carga vuelta y dispara evento => cache.vuelta
      await FS.switch(last);     // restaura lo que tenía la UI
    } catch(e){ console.warn('Precarga ida/vuelta fallida', e); }
    render();
  });

  // util por consola
  window.__pos_recalc = render;
})();

// --- siguiente bloque de script ---

// Toggle de opacidad de los botones (usa .pill-btn.active { opacity:1 })
(function(){
  function setActive(kind){
    document.querySelectorAll('.pill-btn').forEach(btn => {
      const k = btn.getAttribute('data-fixture') || '';
      btn.classList.toggle('active', k === kind);
    });
  }

  // Cuando el sitio anuncia que se cargó un fixture
  document.addEventListener('fixture:data-ready', (ev) => {
    const { kind } = ev.detail || {};
    if (!kind) return;
    setActive(kind);
  });

  // Al iniciar, reflejar lo último guardado
  document.addEventListener('DOMContentLoaded', () => {
    let kind = 'ida';
    try { kind = localStorage.getItem('fixture_kind') || 'ida'; } catch(_){}
    setActive(kind);
  });
})();