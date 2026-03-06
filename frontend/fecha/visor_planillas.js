(function(){
  const $ = s => document.querySelector(s);

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

  // En el esquema nuevo la API ya devuelve la planilla lista para renderizar.
  // El indicador sigue existiendo por compatibilidad visual, pero queda "verde"
  // cuando la API responde correctamente.
  function markFreshness(card){
    try{
      updateGlobalJsIndicator(true);
      let wrap = card.querySelector('.title-indicator');
      if(!wrap){ wrap = document.createElement('div'); wrap.className='title-indicator'; card.appendChild(wrap); }
      let dot = wrap.querySelector('.fresh-indicator');
      if(!dot){ dot = document.createElement('div'); dot.className='fresh-indicator'; wrap.appendChild(dot); }
      dot.className = 'fresh-indicator fresh-ok';
      dot.title = 'Planilla cargada desde API privada';
    }catch(e){}
  }

  async function init(){
    try{
      const boards = document.getElementById('boards');
      if(!boards){
        showAlert('No existe el contenedor #boards');
        return;
      }

      const r = await fetch('/api/admin/planillas', { cache:'no-store' });
      if(!r.ok){
        throw new Error('No se pudieron cargar las planillas del admin (HTTP ' + r.status + ')');
      }

      const files = await r.json();

      if(!Array.isArray(files) || !files.length){
        showAlert('No hay planillas para mostrar');
        return;
      }

      boards.innerHTML = '';

      for(const item of files){
        const team = item.team || 'equipo';
        const plan = item.planilla || item.plan || {};

        const card = document.createElement('article');
        card.className = 'card';

        const h2 = document.createElement('h2');
        h2.textContent = String(team).toUpperCase();
        card.appendChild(h2);

        if(plan && (plan.individuales || plan.pareja1 || plan.pareja2 || plan.suplentes)){
          renderBoard(plan, card);
          markFreshness(card);
        }else{
          renderBoard({ individuales:[], pareja1:[], pareja2:[], suplentes:[] }, card);
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
    }catch(e){
      console.error(e);
      showAlert(e.message || String(e));
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


// === Indicador global de actualidad ===
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
    ? 'Todas las planillas visibles se cargaron desde API privada'
    : 'Hay planillas con problema de carga';
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
