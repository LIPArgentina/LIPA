(function(){
    const $ = s => document.querySelector(s);

    function showAlert(msg){
      const a = $('#alert');
      a.textContent = msg;
      a.style.display = 'block';
      setTimeout(()=> a.style.display='none', 4000);
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
      const wrap = document.createElement('div'); wrap.className='board';
      const groups = document.createElement('div'); groups.className='groups';

      const g1 = document.createElement('article'); g1.className='group'; g1.innerHTML = '<h3>INDIVIDUALES</h3>';
      g1.appendChild(fill(Array.isArray(plan.individuales)?plan.individuales:[], 7));

      const g2 = document.createElement('article'); g2.className='group'; g2.innerHTML = '<h3>PAREJA 1</h3>';
      g2.appendChild(fill(Array.isArray(plan.pareja1)?plan.pareja1:[], 2));

      const g3 = document.createElement('article'); g3.className='group'; g3.innerHTML = '<h3>PAREJA 2</h3>';
      g3.appendChild(fill(Array.isArray(plan.pareja2)?plan.pareja2:[], 2));

      const g4 = document.createElement('article'); g4.className='group'; g4.innerHTML = '<h3>SUPLENTES</h3>';g4.appendChild(fill(Array.isArray(plan.suplentes)?plan.suplentes:[], 2));
      groups.appendChild(g1); groups.appendChild(g2); groups.appendChild(g3); groups.appendChild(g4);
      wrap.appendChild(groups);
      target.appendChild(wrap);
    }

    function loadPlanillaScript(src){
      return new Promise((resolve, reject)=>{
        const s = document.createElement('script');
        s.src = src.startsWith('./') || src.startsWith('../') || src.startsWith('/') ? src : ('./' + src);
        s.onload = ()=> {
          const data = window.LPI_PLANILLA ? JSON.parse(JSON.stringify(window.LPI_PLANILLA)) : null;
          try { delete window.LPI_PLANILLA; } catch {}
          resolve(data);
        };
        s.onerror = ()=> reject(new Error('No se pudo cargar ' + src));
        document.head.appendChild(s);
      });
    }

    function loadUsuarios(){
      return new Promise((resolve)=>{
        const s = document.createElement('script');
        s.src = '../data/usuarios.tercera.js';
        s.onload = ()=> resolve(Array.isArray(window.LPI_USERS) ? window.LPI_USERS : []);
        s.onerror = ()=> resolve([]);
        document.head.appendChild(s);
      });
    }

    function toSlug(n){
      return (n||'').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
    }

    async function tryLoadPlanillasFromUsers(){
      const users = await loadUsuarios();
      const teams = users.filter(u=>u.role==='team').map(u=>({ team: u.username, slug: (u.slug || toSlug(u.username||'')) }));
      const results = [];
      for(const t of teams){
        const file = `${t.slug}.planilla.js`;
        try{
          const plan = await loadPlanillaScript(file);
          if(plan) results.push({ file, team: t.slug, plan });
        }catch{}
      }
      return results;
    }

    async function init(){
      try{
        let files = null;
        // Intento API
        try{
          const r = await fetch('/api/planillas');
          if(r.ok){ files = await r.json(); }
        }catch(e){ /* sin API: seguimos */ }

        const boards = document.getElementById('boards');

        if(!Array.isArray(files) || !files.length){
          const attempts = await tryLoadPlanillasFromUsers();
          if(!attempts.length){
            showAlert('No hay planillas para mostrar');
            return;
          }
          for(const item of attempts){
            const card = document.createElement('article'); card.className='card';
            const h2 = document.createElement('h2'); h2.textContent = (item.team || 'equipo').toUpperCase();
            card.appendChild(h2);
            renderBoard(item.plan, card);
            markFreshness(card, item.file);
boards.appendChild(card);
          }
          return;
        }

        // Con API
        for(const item of files){
          const file = item.file || '';
          const team = item.team || (file.replace(/\.planilla\.js$/,'') || 'equipo');

          const card = document.createElement('article');
          card.className = 'card';
          const h2 = document.createElement('h2'); h2.textContent = team.toUpperCase();
          card.appendChild(h2);

          try{
            const plan = await loadPlanillaScript(file);
            if(plan && (plan.individuales || plan.pareja1 || plan.pareja2 || plan.suplentes)){
              renderBoard(plan, card);
            markFreshness(card, file);
}else{
              renderBoard({individuales:[],pareja1:[],pareja2:[]}, card);
              const small = document.createElement('div'); small.style.cssText='opacity:.8;text-align:center;margin-top:6px;font-size:12px;';
              small.textContent = 'Formato inválido';
              card.appendChild(small);
            }
          }catch(e){
            renderBoard({individuales:[],pareja1:[],pareja2:[]}, card);
            const small = document.createElement('div'); small.style.cssText='opacity:.8;text-align:center;margin-top:6px;font-size:12px;';
            small.textContent = 'No se pudo cargar ' + file;
            card.appendChild(small);
          }

          boards.appendChild(card);
        }
      }catch(e){
        console.error(e); showAlert(e.message || String(e));
      }
    }
    document.addEventListener('DOMContentLoaded', init);
  })();
  
// Ordenar tarjetas por equipo
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


// === Indicador global de JS (verde solo si todos los .js son de hoy) ===
let GLOBAL_JS_ALL_TODAY = true;
let GLOBAL_JS_CHECKS = 0;

function updateGlobalJsIndicator(isToday){
  GLOBAL_JS_CHECKS++;
  if (!isToday) GLOBAL_JS_ALL_TODAY = false;
  const dot = document.getElementById('globalJsIndicator');
  if (!dot) return;
  dot.classList.remove('fresh-ok','fresh-stale');
  dot.classList.add(GLOBAL_JS_ALL_TODAY ? 'fresh-ok' : 'fresh-stale');
  dot.title = GLOBAL_JS_ALL_TODAY
    ? 'Todas las planillas (.js) tienen fecha de hoy'
    : 'Hay planillas (.js) con fecha distinta a hoy';
}

// === Indicador de actualidad por Last-Modified (sin await) ===
function markFreshness(card, file){
  try{
    fetch(file, { method: 'HEAD', cache: 'no-cache' })
      .then(res => {
        const lm = res.headers.get('Last-Modified');
        let cls = 'fresh-stale', title = 'No se pudo determinar fecha';
        let isToday = false;
        if (lm){
          const last = new Date(lm), now = new Date();
          const sameDay = (a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
          isToday = sameDay(last, now);
          cls = isToday ? 'fresh-ok' : 'fresh-stale';
          title = 'Última modificación: ' + last.toLocaleDateString() + (isToday ? ' (hoy)' : '');
        }
        updateGlobalJsIndicator(isToday);
        let wrap = card.querySelector('.title-indicator');
        if(!wrap){ wrap = document.createElement('div'); wrap.className='title-indicator'; card.appendChild(wrap); }
        let dot = wrap.querySelector('.fresh-indicator');
        if(!dot){ dot = document.createElement('div'); dot.className='fresh-indicator'; wrap.appendChild(dot); }
        dot.className = 'fresh-indicator ' + cls;
        dot.title = title;
      })
      .catch(()=>{});
  }catch(e){}
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

  // Click handler con bloqueo y stopPropagation por si hay listeners externos
  btn.addEventListener('click', async (ev)=>{
    ev.preventDefault(); ev.stopPropagation();
    if (inflight) return; inflight = true;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = (btn.dataset.state === 'on') ? 'deshabilitando…' : 'habilitando…';
    try{
      const r = await fetch('/api/cruces/enable', {
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
      setTimeout(()=>{ inflight = false; }, 300); // leve debounce
    }
  }, { once:false, passive:false });

  // Estado inicial
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh, { once:true });
  } else {
    refresh();
  }

  // SSE refresca estado (no hace POST)
  try{
    const es = new EventSource('/api/cruces/stream');
    es.onmessage = ()=> refresh();
  }catch(_){}
})();
