(() => {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const grid = document.getElementById('torneosGrid');
  const statusBox = document.getElementById('statusBox');

  function apiUrl(path){ return `${API_BASE}${path}`; }

  function setStatus(text, type = 'info'){
    if (!statusBox) return;
    if (!text) {
      statusBox.hidden = true;
      statusBox.textContent = '';
      statusBox.className = 'status-box';
      return;
    }
    statusBox.hidden = false;
    statusBox.textContent = text;
    statusBox.className = `status-box ${type}`;
  }

  function formatDateTime(value){
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-AR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function formatValor(valor, moneda){
    const n = Number(valor || 0);
    const prefix = moneda === 'USD' ? 'USD' : '$';
    return `${prefix} ${n.toLocaleString('es-AR')}`;
  }

  function escapeHtml(value){
    return String(value || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;');
  }

  function render(torneos){
    if (!grid) return;
    grid.innerHTML = '';

    if (!torneos.length) {
      setStatus('No hay torneos próximos cargados por las salas.', 'error');
      return;
    }

    setStatus('', 'info');
    torneos.forEach((torneo) => {
      const card = document.createElement('article');
      card.className = 'torneo-card';
      card.innerHTML = `
        <div class="torneo-card__media">
          <img alt="Torneo de ${escapeHtml(torneo.sala || 'sala')}" src="${apiUrl(torneo.mediaUrl)}" loading="lazy">
        </div>
        <div class="torneo-card__body">
          <div class="torneo-row torneo-row--sala"><span>Sala</span><strong>${escapeHtml(torneo.sala || 'Sala')}</strong></div>
          <div class="torneo-row"><span>Categoría</span><strong>${escapeHtml(torneo.categoria || '—')}</strong></div>
          <div class="torneo-row"><span>Fecha y hora</span><strong>${formatDateTime(torneo.fechaHora)}</strong></div>
          <div class="torneo-row"><span>Valor</span><strong>${formatValor(torneo.valor, torneo.moneda)}</strong></div>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  async function loadTorneos(){
    try {
      setStatus('Cargando torneos…', 'info');
      const resp = await fetch(apiUrl('/api/torneos'), { cache: 'no-store' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`);
      render(Array.isArray(data.torneos) ? data.torneos : []);
    } catch (err) {
      console.error(err);
      render([]);
      setStatus(err?.message || 'No se pudieron cargar los torneos.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', loadTorneos);
})();
