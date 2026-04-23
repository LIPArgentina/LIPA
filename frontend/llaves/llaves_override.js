
// Override seguro de renderDiagram sin romper api existente
(function(){
  if (!window.LLAVES_SHARED) return;

  const original = window.LLAVES_SHARED;

  function renderDiagram(target, state, opts = {}){
    if (!target) return;

    const admin = !!opts.admin;
    const grouped = original.byPhase(state.series || []);

    const cuartos = grouped.cuartos || [];
    const semis = grouped.semi || [];
    const final = grouped.final?.[0];
    const third = grouped.tercer_puesto?.[0];

    const leftCuartos = cuartos.slice(0,2);
    const rightCuartos = cuartos.slice(2,4);

    const leftSemi = semis[0];
    const rightSemi = semis[1];

    target.innerHTML = `
      <div class="bracket">
        <div class="side left">
          ${leftCuartos.map(s => original.seriesCard(s, state.options, admin, state.category)).join('')}
          ${leftSemi ? original.seriesCard(leftSemi, state.options, admin, state.category) : ''}
        </div>

        <div class="center">
          ${final ? original.seriesCard(final, state.options, admin, state.category) : ''}
          ${third ? original.seriesCard(third, state.options, admin, state.category) : ''}
        </div>

        <div class="side right">
          ${rightSemi ? original.seriesCard(rightSemi, state.options, admin, state.category) : ''}
          ${rightCuartos.map(s => original.seriesCard(s, state.options, admin, state.category)).join('')}
        </div>
      </div>
    `;
  }

  window.LLAVES_SHARED.renderDiagram = renderDiagram;
})();
