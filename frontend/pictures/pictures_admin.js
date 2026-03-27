(function(){
  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const adminList = document.getElementById('adminList');
  const btnReload = document.getElementById('btnReload');

  function getToken() {
    try {
      const raw = localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session');
      const sess = raw ? JSON.parse(raw) : null;
      return String(sess?.token || sess?.accessToken || '').trim();
    } catch {
      return '';
    }
  }

  function authHeaders(extra = {}) {
    const headers = { ...extra };
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function downloadGroupZip(fechaISO, teamSlug, zipFilename) {
    const url = new URL(API_BASE + '/api/pictures/admin/group-download');
    url.searchParams.set('fechaISO', fechaISO);
    url.searchParams.set('teamSlug', teamSlug);

    const res = await fetch(url.toString(), {
      headers: authHeaders(),
      credentials: 'include',
      cache: 'no-store'
    });

    if (!res.ok) {
      let msg = 'No se pudo descargar el ZIP.';
      try {
        const data = await res.json();
        msg = data?.error || data?.msg || msg;
      } catch {}
      alert(msg);
      return;
    }

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = zipFilename || 'pictures.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function renderGroups(groups) {
    if (!groups.length) {
      adminList.innerHTML = '<p class="muted">No hay fotos cargadas.</p>';
      return;
    }

    adminList.innerHTML = groups.map(group => {
      const itemCount = Array.isArray(group.items) ? group.items.length : 0;
      const preview = (group.items || []).slice(0, 9).map(item => `
        <button class="thumb-btn" type="button" data-open-img="${escapeHtml(item.thumbUrl)}" data-open-title="${escapeHtml(item.filename)}">
          <img class="thumb-img" src="${escapeHtml(item.thumbUrl)}" alt="${escapeHtml(item.filename)}" loading="lazy" />
        </button>
      `).join('');

      return `
        <div class="group-card" data-fecha="${escapeHtml(group.fechaISO)}" data-team="${escapeHtml(group.teamSlug)}" data-zipname="${escapeHtml(group.zipFilename || 'pictures.zip')}">
          <div class="group-header group-header-stack">
            <div>
              <h3>${escapeHtml(group.teamName || group.teamSlug)}</h3>
              <div class="muted">${escapeHtml(group.teamSlug)} · ${escapeHtml(group.fechaISO)}</div>
              <div class="muted">${itemCount} foto${itemCount === 1 ? '' : 's'}</div>
            </div>
            <div class="group-actions">
              <button class="btn" type="button" data-download-zip="1">DESCARGAR ZIP</button>
              <button class="btn btn-danger" type="button" data-empty-folder="1">VACIAR CONTENIDO</button>
            </div>
          </div>
          <div class="thumb-grid">${preview}</div>
        </div>
      `;
    }).join('');
  }

  async function load() {
    adminList.innerHTML = '<p class="muted">Cargando…</p>';
    const res = await fetch(API_BASE + '/api/pictures/admin/list', {
      headers: authHeaders(),
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      adminList.innerHTML = `<p class="muted">${data?.error || 'No se pudieron cargar las fotos.'}</p>`;
      return;
    }

    const groups = Array.isArray(data.groups)
      ? data.groups
      : Array.isArray(data.items)
        ? []
        : [];

    renderGroups(groups);
  }

  adminList?.addEventListener('click', async (ev) => {
    const card = ev.target.closest('.group-card');
    if (!card) return;

    const openBtn = ev.target.closest('[data-open-img]');
    if (openBtn) {
      const src = openBtn.dataset.openImg || '';
      if (src) window.open(src, '_blank', 'noopener');
      return;
    }

    const downloadBtn = ev.target.closest('[data-download-zip]');
    if (downloadBtn) {
      await downloadGroupZip(card.dataset.fecha || '', card.dataset.team || '', card.dataset.zipname || 'pictures.zip');
      return;
    }

    const emptyBtn = ev.target.closest('[data-empty-folder]');
    if (emptyBtn) {
      const fechaISO = card.dataset.fecha || '';
      const teamSlug = card.dataset.team || '';
      if (!fechaISO || !teamSlug) return;
      const ok = confirm(`¿Vaciar todas las fotos de ${teamSlug} del ${fechaISO}? Esta acción no se puede deshacer.`);
      if (!ok) return;

      const res = await fetch(API_BASE + '/api/pictures/admin/team-folder', {
        method: 'DELETE',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({ fechaISO, teamSlug })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        alert(data?.error || 'No se pudo vaciar la carpeta.');
        return;
      }
      load();
    }
  });

  btnReload?.addEventListener('click', load);
  load();
})();
