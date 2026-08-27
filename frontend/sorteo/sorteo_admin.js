(() => {
  'use strict';
  const API_BASE = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const body = document.querySelector('#participantsBody');
  const total = document.querySelector('#totalCount');
  const message = document.querySelector('#adminMessage');
  const empty = document.querySelector('#emptyState');
  const search = document.querySelector('#searchInput');
  let participants = [];

  function readSession() {
    try { return JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null'); }
    catch { return null; }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('es-AR', { dateStyle:'short', timeStyle:'short', timeZone:'America/Argentina/Buenos_Aires' }).format(new Date(value));
  }

  function render() {
    const query = search.value.trim().toLocaleLowerCase('es');
    const rows = participants.filter((item) => !query || item.nombre.toLocaleLowerCase('es').includes(query) || item.dni.includes(query));
    body.innerHTML = rows.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.nombre)}</td><td>${escapeHtml(item.dni)}</td><td>${escapeHtml(formatDate(item.created_at))}</td></tr>`).join('');
    empty.hidden = rows.length > 0;
  }

  async function loadParticipants() {
    const session = readSession();
    if (!session?.token || String(session.role || '').toLowerCase() !== 'admin') {
      const returnPath = `${location.pathname}${location.search}`;
      location.replace(`/auth/login.html?return=${encodeURIComponent(returnPath)}`);
      return;
    }
    message.textContent = '';
    body.innerHTML = '<tr class="loading-row"><td colspan="4">Cargando inscriptos…</td></tr>';
    try {
      const response = await fetch(`${API_BASE}/api/sorteo/admin/inscriptos`, { credentials:'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || data.msg || 'No se pudo cargar el listado.');
      participants = Array.isArray(data.inscriptos) ? data.inscriptos : [];
      total.textContent = String(data.total ?? participants.length);
      render();
    } catch (error) {
      body.innerHTML = '';
      total.textContent = '—';
      message.textContent = error.message || 'No se pudo cargar el listado.';
      empty.hidden = false;
    }
  }

  search.addEventListener('input', render);
  document.querySelector('#reloadButton').addEventListener('click', loadParticipants);
  loadParticipants();
})();
