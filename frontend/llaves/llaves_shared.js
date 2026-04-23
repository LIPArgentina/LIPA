
(function(){
  const API_BASE = ((window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '')) + '/api';
  const CATEGORY_CFG = {
    tercera: { phaseOrder: ['cuartos','semi','final'], extraTrianglesTarget: 5 },
    segunda: { phaseOrder: ['semi','final'], extraTrianglesTarget: 6 }
  };

  function api(path){ return `${API_BASE}${path}`; }
  function esc(v){ return String(v ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
  function byPhase(series){
    const out = { cuartos:[], semi:[], final:[], tercer_puesto:[] };
    (series || []).forEach(item => { if (out[item.phase]) out[item.phase].push(item); });
    Object.values(out).forEach(arr => arr.sort((a,b) => a.slot - b.slot));
    return out;
  }
  function getLegs(series){
    if (series.phase === 'final' || series.phase === 'tercer_puesto') return ['final'];
    return ['ida','vuelta'].concat(series.requiresExtra ? ['extra'] : []);
  }
  function legTitle(leg){ return leg === 'ida' ? 'Ida' : leg === 'vuelta' ? 'Vuelta' : leg === 'extra' ? 'Desempate' : 'Partido único'; }
  function phaseTitle(phase){ return ({cuartos:'Cuartos de final',semi:'Semifinales',final:'Final',tercer_puesto:'3er y 4to puesto'})[phase] || phase; }

  function renderStandingsSummary(container, standings){
    if (!container) return;
    container.innerHTML = '';
    Object.entries(standings || {}).forEach(([group, rows]) => {
      const div = document.createElement('div');
      div.className = 'summary-group';
      div.innerHTML = `<h3>Grupo ${esc(group)}</h3><ol>${(rows || []).slice(0,2).map(r => `<li>${esc(r.equipo)} <small>(${esc(r.pts)} pts · ${esc(r.tr)} tri)</small></li>`).join('')}</ol>`;
      container.appendChild(div);
    });
  }

  function seriesCard(series, options, admin, category){
    const isSingle = series.phase === 'final' || series.phase === 'tercer_puesto';
    const legs = getLegs(series);
    const teamOptions = (options || []).map(o => `<option value="${esc(o.displayName)}">${esc(o.displayName)}</option>`).join('');
    const homeField = admin
      ? `<select class="team-select" data-action="team" data-side="home"><option value=""></option>${teamOptions}</select>`
      : `<div class="team-badge">${esc(series.homeTeam || '—')}</div>`;
    const awayField = admin
      ? `<select class="team-select" data-action="team" data-side="away"><option value=""></option>${teamOptions}</select>`
      : `<div class="team-badge">${esc(series.awayTeam || '—')}</div>`;
    const winnerText = series.winner ? `Pasa: ${series.winner}` : (series.requiresExtra ? 'Desempate habilitado' : 'Pendiente');

    const legBlocks = legs.map(leg => {
      const match = series.matches?.[leg] || {};
      return `
        <div class="match-block" data-leg="${leg}">
          <div class="match-title"><strong>${legTitle(leg)}</strong><span>${leg === 'extra' ? `a ${CATEGORY_CFG[category].extraTrianglesTarget} triángulos` : ''}</span></div>
          <div class="date-row">${admin ? `<input type="text" placeholder="Fecha" data-action="date" value="${esc(match.date || '')}">` : `<input type="text" value="${esc(match.date || '')}" readonly>`}</div>
          <div class="match-grid">
            <div class="team-chip">${esc(series.homeTeam || 'Local')}</div>
            ${admin ? `<input type="number" min="0" data-action="home_points" value="${esc(match.home_points || 0)}">` : `<input type="text" value="${esc(match.home_points || 0)}" readonly>`}
            ${admin ? `<input type="number" min="0" data-action="home_triangles" value="${esc(match.home_triangles || 0)}">` : `<input type="text" value="${esc(match.home_triangles || 0)}" readonly>`}
            <div class="team-chip">${esc(series.awayTeam || 'Visitante')}</div>
            ${admin ? `<input type="number" min="0" data-action="away_points" value="${esc(match.away_points || 0)}">` : `<input type="text" value="${esc(match.away_points || 0)}" readonly>`}
            ${admin ? `<input type="number" min="0" data-action="away_triangles" value="${esc(match.away_triangles || 0)}">` : `<input type="text" value="${esc(match.away_triangles || 0)}" readonly>`}
          </div>
        </div>`;
    }).join('');

    return `
      <article class="series-card ${series.phase === 'final' ? 'final-card' : ''} ${series.phase === 'tercer_puesto' ? 'third-place' : ''}" data-phase="${series.phase}" data-slot="${series.slot}">
        <div class="series-head"><h4>${esc(series.label)}</h4><span class="series-winner">${esc(winnerText)}</span></div>
        <div class="series-teams ${admin ? '' : 'readonly'}">
          <div class="team-row"><label>Local / izquierda</label>${homeField}</div>
          <div class="team-row"><label>Visitante / derecha</label>${awayField}</div>
        </div>
        ${legBlocks}
        <div class="small-note">Puntos y triángulos. ${isSingle ? 'Partido único.' : 'La serie se define por sumatoria de ida y vuelta; si empatan en puntos y triángulos aparece desempate.'}</div>
      </article>`;
  }

  function attachAdminHandlers(root, state, onTeamChange, onMatchSave){
    root.querySelectorAll('.series-card').forEach(card => {
      const phase = card.dataset.phase;
      const slot = Number(card.dataset.slot || 0);
      const series = (state.series || []).find(item => item.phase === phase && item.slot === slot);
      if (!series) return;
      card.querySelectorAll('select[data-action="team"]').forEach(select => {
        const side = select.dataset.side;
        select.value = side === 'home' ? (series.manual_home_team || series.homeTeam || '') : (series.manual_away_team || series.awayTeam || '');
        select.addEventListener('change', () => onTeamChange({ phase, slot, side, team: select.value }));
      });
      card.querySelectorAll('.match-block').forEach(block => {
        const leg = block.dataset.leg;
        const save = () => {
          const payload = { category: state.category, phase, slot, leg };
          block.querySelectorAll('input[data-action]').forEach(input => { payload[input.dataset.action] = input.value; });
          onMatchSave(payload);
        };
        block.querySelectorAll('input[data-action]').forEach(input => {
          input.addEventListener('change', save);
          input.addEventListener('blur', save);
        });
      });
    });
  }

  function renderDiagram(target, state, opts = {}){
    if (!target) return;
    const admin = !!opts.admin;
    const grouped = byPhase(state.series || []);
    const order = CATEGORY_CFG[state.category].phaseOrder;
    const cols = order.map(phase => `
      <section class="phase-column">
        <h3 class="phase-title">${phaseTitle(phase)}</h3>
        ${(grouped[phase] || []).map(series => seriesCard(series, state.options, admin, state.category)).join('')}
      </section>`).join('');

    const third = grouped.tercer_puesto?.[0]
      ? `<div class="third-place-wrap">${seriesCard(grouped.tercer_puesto[0], state.options, admin, state.category)}</div>`
      : '';

    target.innerHTML = `<div class="phase-grid ${state.category}">${cols}</div>${third}`;
    if (admin && opts.onTeamChange && opts.onMatchSave) {
      attachAdminHandlers(target, state, opts.onTeamChange, opts.onMatchSave);
    }
  }

  window.LLAVES_SHARED = { api, renderStandingsSummary, renderDiagram };
})();
