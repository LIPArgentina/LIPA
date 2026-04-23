// REEMPLAZA SOLO ESTE ARCHIVO
(function(){
  const { renderStandingsSummary } = window.LLAVES_SHARED || {};

  function byPhase(series){
    const out = { cuartos:[], semi:[], final:[], tercer_puesto:[] };
    (series || []).forEach(item => { if (out[item.phase]) out[item.phase].push(item); });
    Object.values(out).forEach(arr => arr.sort((a,b) => a.slot - b.slot));
    return out;
  }

  function seriesCard(s){
    return `<div class="series-card"><strong>${s.label}</strong><div>${s.homeTeam} vs ${s.awayTeam}</div></div>`;
  }

  function renderDiagram(target, state){
    const grouped = byPhase(state.series || []);
    const cuartos = grouped.cuartos || [];
    const semis = grouped.semi || [];

    const leftCuartos = cuartos.slice(0,2);
    const rightCuartos = cuartos.slice(2,4);

    target.innerHTML = `
    <div class="bracket">
      <div class="side">
        ${leftCuartos.map(seriesCard).join('')}
        ${semis[0] ? seriesCard(semis[0]) : ''}
      </div>

      <div class="center">
        ${grouped.final[0] ? seriesCard(grouped.final[0]) : ''}
        ${grouped.tercer_puesto[0] ? seriesCard(grouped.tercer_puesto[0]) : ''}
      </div>

      <div class="side">
        ${semis[1] ? seriesCard(semis[1]) : ''}
        ${rightCuartos.map(seriesCard).join('')}
      </div>
    </div>`;
  }

  window.LLAVES_SHARED.renderDiagram = renderDiagram;
})();
