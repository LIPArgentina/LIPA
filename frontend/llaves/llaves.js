
(function(){
  const { api, renderStandingsSummary, renderDiagram } = window.LLAVES_SHARED || {};
  const diagram = document.getElementById('llavesDiagram');
  const standingsSummary = document.getElementById('standingsSummary');
  const status = document.getElementById('saveStatus');
  const switches = Array.from(document.querySelectorAll('.sw[data-category]'));
  let currentCategory = 'tercera';
  let currentState = null;
  let savingTimer = null;

  function setStatus(text, ok=true){
    if (!status) return;
    status.textContent = text;
    status.style.color = ok ? '#b7b7b7' : '#ff7a7a';
  }

  async function fetchState(){
    setStatus('Cargando llaves…');
    const res = await fetch(api(`/llaves?category=${encodeURIComponent(currentCategory)}`), { credentials:'same-origin', cache:'no-store' });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'No se pudo cargar');
    currentState = data;
    renderStandingsSummary(standingsSummary, data.standings);
    renderDiagram(diagram, data, { admin:true, onTeamChange: saveTeam, onMatchSave: saveMatch });
    setStatus('Datos cargados');
  }

  function pulseSaved(msg){
    setStatus(msg || 'Guardado');
    clearTimeout(savingTimer);
    savingTimer = setTimeout(() => setStatus('Listo'), 1200);
  }

  async function saveTeam({ phase, slot, side, team }){
    setStatus('Guardando equipo…');
    const res = await fetch(api('/llaves/manual-team'), {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ category: currentCategory, phase, slot, side, team })
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setStatus(data?.error || 'Error guardando equipo', false);
      return;
    }
    currentState = data;
    renderStandingsSummary(standingsSummary, data.standings);
    renderDiagram(diagram, data, { admin:true, onTeamChange: saveTeam, onMatchSave: saveMatch });
    pulseSaved('Equipo actualizado');
  }

  async function saveMatch(payload){
    setStatus('Guardando partido…');
    const res = await fetch(api('/llaves/match'), {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setStatus(data?.error || 'Error guardando partido', false);
      return;
    }
    currentState = data;
    renderStandingsSummary(standingsSummary, data.standings);
    renderDiagram(diagram, data, { admin:true, onTeamChange: saveTeam, onMatchSave: saveMatch });
    pulseSaved('Partido actualizado');
  }

  switches.forEach(btn => btn.addEventListener('click', () => {
    currentCategory = btn.dataset.category;
    switches.forEach(item => item.classList.toggle('active', item === btn));
    fetchState().catch(err => setStatus(err.message || 'Error', false));
  }));

  fetchState().catch(err => setStatus(err.message || 'Error', false));
})();
