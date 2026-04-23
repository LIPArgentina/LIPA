
(function(){
  const existing = window.LLAVES_SHARED || {};

  function renderDiagram(target, state, opts = {}) {
    if (!target) return;

    const admin = !!opts.admin;
    const grouped = (existing.byPhase || function(x){return {}})(state.series || []);

    const cuartos = grouped.cuartos || [];
    const semis = grouped.semi || [];
    const final = grouped.final?.[0];
    const third = grouped.tercer_puesto?.[0];

    const Q1 = cuartos[0], Q2 = cuartos[1], Q3 = cuartos[2], Q4 = cuartos[3];
    const S1 = semis[0], S2 = semis[1];

    const seriesCard = existing.seriesCard || function(){ return '<div>card</div>'; };

    target.innerHTML = `
      <div class="bracket">
        <div class="col">
          ${Q1 ? seriesCard(Q1, state.options, admin, state.category) : ''}
          ${Q2 ? seriesCard(Q2, state.options, admin, state.category) : ''}
        </div>

        <div class="col">
          ${S1 ? seriesCard(S1, state.options, admin, state.category) : ''}
        </div>

        <div class="col center">
          ${final ? seriesCard(final, state.options, admin, state.category) : ''}
          ${third ? seriesCard(third, state.options, admin, state.category) : ''}
        </div>

        <div class="col">
          ${S2 ? seriesCard(S2, state.options, admin, state.category) : ''}
        </div>

        <div class="col">
          ${Q3 ? seriesCard(Q3, state.options, admin, state.category) : ''}
          ${Q4 ? seriesCard(Q4, state.options, admin, state.category) : ''}
        </div>
      </div>
    `;
  }

  window.LLAVES_SHARED = {
    ...existing,
    renderDiagram
  };
})();
