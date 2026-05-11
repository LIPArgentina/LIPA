(() => {
  'use strict';

  const $form = document.getElementById('torneosForm');
  const $category = document.getElementById('categorySelect');
  const $status = document.getElementById('statusSelect');
  const $cards = Array.from(document.querySelectorAll('.torneo-card'));
  const $statusBox = document.getElementById('statusBox');

  function normalize(value){
    return String(value || '').trim().toLowerCase();
  }

  function applyFilters(){
    const category = normalize($category?.value || 'todos');
    const status = normalize($status?.value || 'todos');
    let visible = 0;

    $cards.forEach((card) => {
      const cardCategory = normalize(card.dataset.category || 'todos');
      const cardStatus = normalize(card.dataset.status || 'todos');
      const matchCategory = category === 'todos' || cardCategory === category || cardCategory === 'todos';
      const matchStatus = status === 'todos' || cardStatus === status;
      const show = matchCategory && matchStatus;
      card.hidden = !show;
      if (show) visible += 1;
    });

    if ($statusBox) {
      if (visible) {
        $statusBox.className = 'status-box info';
        $statusBox.textContent = 'Los torneos se irán actualizando a medida que la comisión confirme fechas y cupos.';
      } else {
        $statusBox.className = 'status-box error';
        $statusBox.textContent = 'No hay torneos cargados para esos filtros.';
      }
    }
  }

  $form?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    applyFilters();
  });

  $category?.addEventListener('change', applyFilters);
  $status?.addEventListener('change', applyFilters);
})();
