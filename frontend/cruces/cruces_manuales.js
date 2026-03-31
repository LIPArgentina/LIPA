(() => {
  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');

  const state = {
    teams: [],
    planCache: new Map()
  };

  const sections = [
    { key:'capitan', title:'CAPITÁN', count:2, score:false },
    { key:'individuales', title:'INDIVIDUALES', count:7, score:true },
    { key:'pareja1', title:'PAREJA 1', count:2, score:'single' },
    { key:'pareja2', title:'PAREJA 2', count:2, score:'single' },
    { key:'suplentes', title:'SUPLENTES', count:2, score:false }
  ];

  const $ = (sel) => document.querySelector(sel);

  function withAdminMode(url){
    try{
      const params = new URLSearchParams(location.search);
      const isAdmin = params.get('admin') === '1' || params.get('mode') === 'admin';
      const u = new URL(url, location.href);
      if (isAdmin) u.searchParams.set('admin', '1');
      return u.pathname + u.search + u.hash;
    }catch{
      return url;
    }
  }

  function apiUrl(path){
    return (API_BASE || '') + path;
  }

  function setStatus(html, cls = ''){
    const node = $('#status');
    if (!node) return;
    node.className = 'hint' + (cls ? ' ' + cls : '');
    node.innerHTML = html;
  }

  function slugify(s=''){
    return String(s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,'');
  }

  function emptyPlanilla(team=''){
    return {
      team,
      capitan:['',''],
      individuales:['','','','','','',''],
      pareja1:['',''],
      pareja2:['',''],
      suplentes:['','']
    };
  }

  function normalizeTeamItem(item){
    const name = item?.username || item?.team || item?.teamName || item?.equipo || item?.nombre || item?.name || item?.slug || 'Equipo';
    const slug = item?.slug || slugify(name);
    return { name, slug };
  }

  async function fetchJson(path){
    const res = await fetch(apiUrl(path), {
      cache:'no-store',
      credentials:'include'
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
    return data;
  }

  async function loadTeamsByCategory(category){
    setStatus(`Cargando equipos de ${category}...`);
    const data = await fetchJson('/api/teams?division=' + encodeURIComponent(category));
    const raw = Array.isArray(data) ? data : Array.isArray(data?.teams) ? data.teams : Array.isArray(data?.users) ? data.users : [];
    state.teams = raw
      .map(normalizeTeamItem)
      .filter(t => t.slug && t.name)
      .sort((a,b) => a.name.localeCompare(b.name, 'es'));

    fillTeamSelects();

    if (state.teams.length < 2) {
      document.getElementById('localRoot').innerHTML = '';
      document.getElementById('visitanteRoot').innerHTML = '';
      setStatus('<span class="error">No hay suficientes equipos cargados para esta categoría.</span>');
      return;
    }

    setStatus(`<span class="ok">Equipos cargados para ${category}.</span>`);
    renderBoth();
  }

  function fillTeamSelects(){
    const localSel = $('#localTeam');
    const visSel = $('#visitanteTeam');
    const prevLocal = localSel.value;
    const prevVis = visSel.value;

    localSel.innerHTML = '<option value="">Seleccionar...</option>';
    visSel.innerHTML = '<option value="">Seleccionar...</option>';

    state.teams.forEach(t => {
      localSel.insertAdjacentHTML('beforeend', `<option value="${t.slug}">${t.name}</option>`);
      visSel.insertAdjacentHTML('beforeend', `<option value="${t.slug}">${t.name}</option>`);
    });

    if ([...localSel.options].some(o => o.value === prevLocal)) {
      localSel.value = prevLocal;
    } else if (state.teams[0]) {
      localSel.value = state.teams[0].slug;
    }

    if ([...visSel.options].some(o => o.value === prevVis && o.value !== localSel.value)) {
      visSel.value = prevVis;
    } else {
      const other = state.teams.find(t => t.slug !== localSel.value);
      visSel.value = other ? other.slug : '';
    }
  }

  async function loadPlanilla(teamSlug){
    if (!teamSlug) return emptyPlanilla('');
    if (state.planCache.has(teamSlug)) return state.planCache.get(teamSlug);

    try{
      const data = await fetchJson('/api/team/planilla?team=' + encodeURIComponent(teamSlug));
      const plan = data?.planilla || data || {};
      const normalized = {
        team: data?.team || plan?.team || state.teams.find(t => t.slug === teamSlug)?.name || teamSlug,
        slug: teamSlug,
        capitan: Array.isArray(plan.capitan) ? plan.capitan : ['',''],
        individuales: Array.isArray(plan.individuales) ? plan.individuales : ['','','','','','',''],
        pareja1: Array.isArray(plan.pareja1) ? plan.pareja1 : ['',''],
        pareja2: Array.isArray(plan.pareja2) ? plan.pareja2 : ['',''],
        suplentes: Array.isArray(plan.suplentes) ? plan.suplentes : ['','']
      };
      state.planCache.set(teamSlug, normalized);
      return normalized;
    }catch(err){
      console.warn('loadPlanilla', teamSlug, err);
      const fallback = emptyPlanilla(state.teams.find(t => t.slug === teamSlug)?.name || teamSlug);
      fallback.slug = teamSlug;
      state.planCache.set(teamSlug, fallback);
      return fallback;
    }
  }

  function makePtsSelect(max=6){
    let opts = '';
    for(let i=0;i<=max;i++) opts += `<option value="${i}">${i}</option>`;
    return `<div class="ptsbox"><select>${opts}</select></div>`;
  }

  function escapeHtml(str=''){
    return String(str)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;');
  }

  function renderTeam(rootId, role, plan, isRight=false){
    const root = document.getElementById(rootId);
    root.innerHTML = '';
    if (!plan?.team) return;

    const card = document.getElementById('cardTpl').content.firstElementChild.cloneNode(true);
    card.querySelector('.team-role').textContent = role;
    card.querySelector('.team-title').textContent = String(plan.team || '').toUpperCase();

    const totalWrap = card.querySelector('.total-wrap');
    const winsWrap = card.querySelector('.wins-wrap');
    if(isRight){
      totalWrap.classList.add('right');
      winsWrap.classList.add('right');
      card.querySelector('.total-chip').classList.add('reverse');
      card.querySelector('.wins-chip').classList.add('reverse');
    }

    const sectionsNode = card.querySelector('.sections');
    sections.forEach(section => {
      const sec = document.createElement('div');
      sec.className = 'section';
      sec.dataset.section = section.key;
      sec.innerHTML = `<h3>${section.title}</h3>`;

      const values = plan[section.key] || [];
      for(let i=0;i<section.count;i++){
        const val = values[i] || '';
        const row = document.createElement('div');
        row.className = 'row' + (isRight ? ' right' : '');
        row.dataset.section = section.key;

        const badge = `<div class="badge">${i+1}</div>`;
        const slot = `<div class="slot ${val ? '' : 'empty'}" data-full="${escapeHtml(val)}">${escapeHtml(val || '—')}</div>`;
        let pts = `<div class="ptsbox hidden-box"></div>`;

        if(section.score === true){
          pts = makePtsSelect(6);
        }else if(section.score === 'single' && i === 0){
          pts = makePtsSelect(6);
        }

        row.innerHTML = isRight ? `${pts}${slot}${badge}` : `${badge}${slot}${pts}`;
        sec.appendChild(row);
      }

      sectionsNode.appendChild(sec);
    });

    root.appendChild(card);
  }

  function scoreRowsFor(rootId){
    return Array.from(document.querySelectorAll(`#${rootId} .ptsbox select`)).map(s => Number(s.value || 0));
  }

  function collectPlanilla(rootId){
    const out = { capitan:[], individuales:[], pareja1:[], pareja2:[], suplentes:[] };
    document.querySelectorAll(`#${rootId} .section`).forEach(sec => {
      const key = sec.dataset.section;
      out[key] = Array.from(sec.querySelectorAll('.slot')).map(s => {
        const txt = s.dataset.full || '';
        return txt === '—' ? '' : txt;
      }).filter(Boolean);
    });

    const scores = scoreRowsFor(rootId);
    out.individualesPts = scores.slice(0,7);
    out.pareja1Pts = [scores[7] || 0];
    out.pareja2Pts = [scores[8] || 0];
    return out;
  }

  function matchWins(a, b){
    if(a === b) return [0,0];
    return a > b ? [1,0] : [0,1];
  }

  function recalc(){
    const left = scoreRowsFor('localRoot');
    const right = scoreRowsFor('visitanteRoot');

    const leftTriangles = left.reduce((a,b)=>a+b,0);
    const rightTriangles = right.reduce((a,b)=>a+b,0);
    let leftPts = 0;
    let rightPts = 0;

    for(let i=0;i<9;i++){
      const [l,r] = matchWins(left[i] || 0, right[i] || 0);
      leftPts += l;
      rightPts += r;
    }

    const lTri = document.querySelector('#localRoot .totalValue');
    const rTri = document.querySelector('#visitanteRoot .totalValue');
    const lWin = document.querySelector('#localRoot .winsValue');
    const rWin = document.querySelector('#visitanteRoot .winsValue');
    if (lTri) lTri.textContent = leftTriangles;
    if (rTri) rTri.textContent = rightTriangles;
    if (lWin) lWin.textContent = leftPts;
    if (rWin) rWin.textContent = rightPts;
  }

  function bindScoreEvents(){
    document.querySelectorAll('.ptsbox select').forEach(sel => {
      sel.addEventListener('change', recalc);
    });
  }

  function ensureDistinctTeams(changed){
    const localSel = $('#localTeam');
    const visSel = $('#visitanteTeam');
    if (!localSel.value || !visSel.value) return;
    if (localSel.value !== visSel.value) return;

    const alternative = state.teams.find(t => changed === 'local' ? t.slug !== localSel.value : t.slug !== visSel.value);
    if (changed === 'local') visSel.value = alternative ? alternative.slug : '';
    else localSel.value = alternative ? alternative.slug : '';
  }

  async function renderBoth(){
    const localSlug = $('#localTeam').value;
    const visitanteSlug = $('#visitanteTeam').value;

    if (!localSlug || !visitanteSlug) {
      document.getElementById('localRoot').innerHTML = '';
      document.getElementById('visitanteRoot').innerHTML = '';
      setStatus('<span class="error">No hay suficientes equipos cargados para esta categoría.</span>');
      return;
    }

    const [localPlan, visitantePlan] = await Promise.all([
      loadPlanilla(localSlug),
      loadPlanilla(visitanteSlug)
    ]);

    renderTeam('localRoot', 'LOCAL', localPlan, false);
    renderTeam('visitanteRoot', 'VISITANTE', visitantePlan, true);
    bindScoreEvents();
    recalc();
  }

  function collectStatus(){
    const fechaISO = $('#fechaISO').value;
    const localSlug = $('#localTeam').value;
    const visitanteSlug = $('#visitanteTeam').value;

    const localRows = scoreRowsFor('localRoot');
    const visRows = scoreRowsFor('visitanteRoot');

    const localTri = Number(document.querySelector('#localRoot .totalValue')?.textContent || 0);
    const visTri = Number(document.querySelector('#visitanteRoot .totalValue')?.textContent || 0);
    const localPts = Number(document.querySelector('#localRoot .winsValue')?.textContent || 0);
    const visPts = Number(document.querySelector('#visitanteRoot .winsValue')?.textContent || 0);

    return {
      fechaISO,
      localSlug,
      visitanteSlug,
      validated: true,
      local: {
        parejas: {
          pareja1: { j1: localRows[7] || 0, j2: 0 },
          pareja2: { j1: localRows[8] || 0, j2: 0 }
        },
        jugadores: localRows.slice(0,7),
        scoreRows: localRows,
        puntosTotales: localPts,
        triangulosTotales: localTri
      },
      visitante: {
        parejas: {
          pareja1: { j1: visRows[7] || 0, j2: 0 },
          pareja2: { j1: visRows[8] || 0, j2: 0 }
        },
        jugadores: visRows.slice(0,7),
        scoreRows: visRows,
        puntosTotales: visPts,
        triangulosTotales: visTri
      },
      localPlanilla: collectPlanilla('localRoot'),
      visitantePlanilla: collectPlanilla('visitanteRoot')
    };
  }

  function buildValidation(status){
    return {
      fechaISO: status.fechaISO,
      localSlug: status.localSlug,
      visitanteSlug: status.visitanteSlug,
      local: {
        scoreRows: status.local.scoreRows,
        triangulos: status.local.triangulosTotales,
        puntosTotales: status.local.puntosTotales
      },
      visitante: {
        scoreRows: status.visitante.scoreRows,
        triangulos: status.visitante.triangulosTotales,
        puntosTotales: status.visitante.puntosTotales
      },
      localPlanilla: status.localPlanilla,
      visitantePlanilla: status.visitantePlanilla
    };
  }

  function resolveWinner(status){
    return status.local.puntosTotales > status.visitante.puntosTotales ? status.localSlug : status.visitanteSlug;
  }

  function validateInputs(status){
    if(!status.fechaISO) throw new Error('Falta la fecha.');
    if(!status.localSlug) throw new Error('Falta seleccionar el equipo local.');
    if(!status.visitanteSlug) throw new Error('Falta seleccionar el equipo visitante.');
    if(status.localSlug === status.visitanteSlug) throw new Error('Local y visitante no pueden ser el mismo equipo.');
  }

  async function postJson(path, body){
    const res = await fetch(apiUrl(path), {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      credentials:'include',
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok || data?.ok === false){
      throw new Error(data?.error || data?.message || ('HTTP ' + res.status));
    }
    return data;
  }

  async function saveToDb(){
    const btn = $('#btnGuardar');
    const originalText = btn.textContent;

    try{
      const status = collectStatus();
      validateInputs(status);

      btn.disabled = true;
      btn.textContent = 'GUARDANDO...';
      setStatus('Guardando cruce manual en DB...');

      const categoria = $('#categoria').value;
      const localEquipoSlug = `${status.localSlug}_${categoria}`;
      const visitanteEquipoSlug = `${status.visitanteSlug}_${categoria}`;
      const validacion = buildValidation(status);
      const winnerSlug = resolveWinner(status);

      await postJson('/api/cruces/match-status', {
        localSlug: status.localSlug,
        visitanteSlug: status.visitanteSlug,
        fechaISO: status.fechaISO,
        equipoSlug: localEquipoSlug,
        status,
        validar: true
      });

      await postJson('/api/cruces/match-status', {
        localSlug: status.localSlug,
        visitanteSlug: status.visitanteSlug,
        fechaISO: status.fechaISO,
        equipoSlug: visitanteEquipoSlug,
        status,
        validar: true
      });

      await postJson('/api/cruces/validate', {
        fechaISO: status.fechaISO,
        localSlug: status.localSlug,
        visitanteSlug: status.visitanteSlug,
        equipoSlug: status.localSlug,
        validacion,
        status
      });

      await postJson('/api/cruces/validate', {
        fechaISO: status.fechaISO,
        localSlug: status.localSlug,
        visitanteSlug: status.visitanteSlug,
        equipoSlug: status.visitanteSlug,
        validacion,
        status
      });

      setStatus(`<span class="ok">Cruce guardado en DB.</span> Ganador automático: <strong>${winnerSlug.toUpperCase()}</strong>.`);
    }catch(err){
      console.error(err);
      setStatus(`<span class="error">No se pudo guardar en DB: ${err.message || 'error desconocido'}.</span>`);
    }finally{
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function initHeaderLinks(){
    const btnVolverAdmin = $('#btnVolverAdmin');
    if (btnVolverAdmin) btnVolverAdmin.href = withAdminMode(btnVolverAdmin.getAttribute('href') || '../admin.html');
  }

  function bindUi(){
    $('#btnGuardar').addEventListener('click', saveToDb);

    $('#categoria').addEventListener('change', async () => {
      state.planCache.clear();
      await loadTeamsByCategory($('#categoria').value);
    });

    $('#localTeam').addEventListener('change', async () => {
      ensureDistinctTeams('local');
      await renderBoth();
    });

    $('#visitanteTeam').addEventListener('change', async () => {
      ensureDistinctTeams('visitante');
      await renderBoth();
    });
  }

  async function init(){
    initHeaderLinks();
    bindUi();

    const today = new Date();
    const mm = String(today.getMonth()+1).padStart(2,'0');
    const dd = String(today.getDate()).padStart(2,'0');
    $('#fechaISO').value = `${today.getFullYear()}-${mm}-${dd}`;

    await loadTeamsByCategory($('#categoria').value);
  }

  document.addEventListener('DOMContentLoaded', init);
})();