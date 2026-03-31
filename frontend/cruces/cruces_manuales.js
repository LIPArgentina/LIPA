(() => {
  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const PLANILLAS_ENDPOINT = '/api/admin/planillas';

  const state = {
    teamsRaw: [],
    filteredTeams: [],
    localPlan: null,
    visitantePlan: null
  };

  const sections = [
    { key:'capitan', title:'CAPITÁN', count:2, score:false },
    { key:'individuales', title:'INDIVIDUALES', count:7, score:true },
    { key:'pareja1', title:'PAREJA 1', count:2, score:'single' },
    { key:'pareja2', title:'PAREJA 2', count:2, score:'single' },
    { key:'suplentes', title:'SUPLENTES', count:2, score:false }
  ];

  const $ = (sel) => document.querySelector(sel);

  const normalize = (s='') => String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'').trim();

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

  function teamDivisionValue(item){
    return String(item?.division || item?.categoria || item?.teamCategory || item?.planilla?.division || item?.plan?.division || '').toLowerCase().trim();
  }

  function teamDisplay(item){
    return item?.team || item?.teamName || item?.equipo || item?.nombre || item?.slug || 'Equipo';
  }

  function teamSlug(item){
    return item?.slug || normalize(teamDisplay(item));
  }

  async function loadTeams(){
    setStatus('Cargando equipos desde DB...');
    try{
      const res = await fetch(apiUrl(PLANILLAS_ENDPOINT), { cache:'no-store', credentials:'include' });
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const arr = await res.json();
      if(!Array.isArray(arr)) throw new Error('La respuesta no es un array');
      state.teamsRaw = arr;
      applyCategoryFilter();
      setStatus('<span class="ok">Equipos cargados desde DB.</span>');
    }catch(err){
      console.error(err);
      state.teamsRaw = sampleTeams();
      applyCategoryFilter();
      setStatus('<span class="error">No se pudo leer la DB real. Quedó cargado un modo de ejemplo para probar la pantalla.</span>');
    }
  }

  function sampleTeams(){
    return [
      { slug:'takospro', team:'TAKOS PRO', division:'segunda', planilla:{
        capitan:['Favio Godoy', 'Nestor Gomez'],
        individuales:['Javier Jerez','Emanuel Dengler','Mauro Moyano','Jose Alarcon','Pablo Sconza','Carlos Dominguez','Matias De Trueba'],
        pareja1:['Antonio Haberkorn','Dylan Sierra'],
        pareja2:['Javier Nicola','Favio Godoy'],
        suplentes:['Cesar Corvillon','Braian Fursa']
      }},
      { slug:'oldies', team:'OLDIES', division:'segunda', planilla:{
        capitan:['Enrique Rosales', 'Fabian Rodriguez'],
        individuales:['Alan Nuñez','Fabian Rodriguez','Cristian Chavez','Enrique Rosales','Emanuel Garcia','Jorge Chavez','Jose Ortega'],
        pareja1:['Adrian Bravo','Hector Gonzalez'],
        pareja2:['Diego Paradiso','Alan Nuñez'],
        suplentes:['Leonardo Longobardi','Fabian Rodriguez']
      }},
      { slug:'anexo', team:'ANEXO', division:'tercera', planilla:{
        capitan:['Luis Miguel Cruz Mercado', ''],
        individuales:['Julio Molina','Federico Damian Herrera','Andres Carrillo','Juan Suarez','Diego Paterno','Gaston Alejandro Fernandez','Miguel Angel Aguirre'],
        pareja1:['Israel Lugo','Carlos Ariel Cabrera'],
        pareja2:['Matias Daniel Flores','L Luis Mercado'],
        suplentes:['Elias Juan Saavedra','Gustavo Romero']
      }},
      { slug:'academiadepool', team:'ACADEMIA DE POOL', division:'tercera', planilla:{
        capitan:['Fabian Eguez', 'Joel Koroluk'],
        individuales:['Fernando Kowalczuk','Damian Argiello','Julian Gonzalez','Fernando Ruiz','Cristian Georgiovitch','Facundo Luna','Gerardo Cardozo'],
        pareja1:['Gabriel Zambianchi','Hernan Cardozo'],
        pareja2:['Fabian Eguez','Orion Pala'],
        suplentes:['Fernando Gonzalez','Joel Koroluk']
      }}
    ];
  }

  function filteredTeamsByCategory(category){
    return state.teamsRaw
      .filter(t => teamDivisionValue(t) === category)
      .sort((a,b) => teamDisplay(a).localeCompare(teamDisplay(b), 'es'));
  }

  function applyCategoryFilter(){
    const category = $('#categoria').value;
    state.filteredTeams = filteredTeamsByCategory(category);
    fillTeamSelects();
    renderBoth();
  }

  function fillTeamSelects(){
    const teams = state.filteredTeams;
    const localSel = $('#localTeam');
    const visSel = $('#visitanteTeam');
    const prevLocal = localSel.value;
    const prevVis = visSel.value;

    localSel.innerHTML = '<option value="">Seleccionar...</option>';
    visSel.innerHTML = '<option value="">Seleccionar...</option>';

    teams.forEach(t => {
      const label = teamDisplay(t);
      const slug = teamSlug(t);
      localSel.insertAdjacentHTML('beforeend', `<option value="${slug}">${label}</option>`);
      visSel.insertAdjacentHTML('beforeend', `<option value="${slug}">${label}</option>`);
    });

    if ([...localSel.options].some(o => o.value === prevLocal)) {
      localSel.value = prevLocal;
    } else if (teams[0]) {
      localSel.value = teamSlug(teams[0]);
    }

    if ([...visSel.options].some(o => o.value === prevVis && o.value !== localSel.value)) {
      visSel.value = prevVis;
    } else {
      const second = teams.find(t => teamSlug(t) !== localSel.value);
      visSel.value = second ? teamSlug(second) : '';
    }
  }

  function findPlan(slug){
    const item = state.filteredTeams.find(t => teamSlug(t) === slug) || state.teamsRaw.find(t => teamSlug(t) === slug);
    if(!item) return emptyPlanilla(slug);
    const plan = item.planilla || item.plan || item;
    return {
      team: teamDisplay(item),
      slug: teamSlug(item),
      capitan: Array.isArray(plan.capitan) ? plan.capitan : ['',''],
      individuales: Array.isArray(plan.individuales) ? plan.individuales : ['','','','','','',''],
      pareja1: Array.isArray(plan.pareja1) ? plan.pareja1 : ['',''],
      pareja2: Array.isArray(plan.pareja2) ? plan.pareja2 : ['',''],
      suplentes: Array.isArray(plan.suplentes) ? plan.suplentes : ['','']
    };
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
    card.querySelector('.team-title').textContent = (plan.team || '').toUpperCase();

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

    const alternative = state.filteredTeams.find(t => {
      const slug = teamSlug(t);
      return changed === 'local' ? slug !== localSel.value : slug !== visSel.value;
    });

    if (changed === 'local') {
      visSel.value = alternative ? teamSlug(alternative) : '';
    } else {
      localSel.value = alternative ? teamSlug(alternative) : '';
    }
  }

  function renderBoth(){
    const localSlug = $('#localTeam').value;
    const visitanteSlug = $('#visitanteTeam').value;

    if (!localSlug || !visitanteSlug) {
      document.getElementById('localRoot').innerHTML = '';
      document.getElementById('visitanteRoot').innerHTML = '';
      setStatus('<span class="error">No hay suficientes equipos cargados para esta categoría.</span>');
      return;
    }

    state.localPlan = findPlan(localSlug);
    state.visitantePlan = findPlan(visitanteSlug);

    renderTeam('localRoot', 'LOCAL', state.localPlan, false);
    renderTeam('visitanteRoot', 'VISITANTE', state.visitantePlan, true);
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

      setStatus(
        `<span class="ok">Cruce guardado en DB.</span> ` +
        `Ganador automático: <strong>${winnerSlug.toUpperCase()}</strong>.`
      );
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

    $('#categoria').addEventListener('change', () => {
      applyCategoryFilter();
    });

    $('#localTeam').addEventListener('change', () => {
      ensureDistinctTeams('local');
      renderBoth();
    });

    $('#visitanteTeam').addEventListener('change', () => {
      ensureDistinctTeams('visitante');
      renderBoth();
    });
  }

  function init(){
    initHeaderLinks();
    bindUi();

    const today = new Date();
    const mm = String(today.getMonth()+1).padStart(2,'0');
    const dd = String(today.getDate()).padStart(2,'0');
    $('#fechaISO').value = `${today.getFullYear()}-${mm}-${dd}`;

    loadTeams();
  }

  document.addEventListener('DOMContentLoaded', init);
})();