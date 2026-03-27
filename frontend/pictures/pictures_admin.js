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

  function groupBy(items, keyFn) {
    const map = new Map();
    for (const item of items) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
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

    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      adminList.innerHTML = '<p class="muted">No hay fotos cargadas.</p>';
      return;
    }

    const groups = groupBy(items, item => `${item.fechaISO}__${item.teamSlug}`);
    const html = [];

    for (const [key, rows] of groups.entries()) {
      const first = rows[0];
      html.push(`
        <div class="group" data-fecha="${first.fechaISO}" data-team="${first.teamSlug}">
          <div class="group-header">
            <div>
              <h3>${first.teamName}</h3>
              <div class="muted">${first.teamSlug} · ${first.fechaISO}</div>
            </div>
            <button class="btn btn-danger" data-empty-folder="${key}">VACIAR CONTENIDO</button>
          </div>
          <div class="list">
            ${rows.map(row => `
              <div class="file-row">
                <div class="file-meta">
                  <strong>${row.filename}</strong>
                  <span>${Math.round((row.size || 0) / 1024)} KB · ${new Date(row.modifiedAt).toLocaleString('es-AR')}</span>
                </div>
                <div class="file-actions">
                  <a class="btn" href="${API_BASE}${row.downloadUrl}">DESCARGAR</a>
                  <button class="btn btn-danger" data-file="${encodeURIComponent(`${row.fechaISO}/${row.teamSlug}/${row.filename}`)}">ELIMINAR</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `);
    }

    adminList.innerHTML = html.join('');
  }

  adminList?.addEventListener('click', async (ev) => {
    const deleteBtn = ev.target.closest('[data-file]');
    const emptyBtn = ev.target.closest('[data-empty-folder]');

    if (deleteBtn) {
      const rel = decodeURIComponent(deleteBtn.dataset.file || '');
      if (!confirm('¿Eliminar esta foto?')) return;
      const res = await fetch(API_BASE + '/api/pictures/admin/file', {
        method: 'DELETE',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({ file: rel })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        alert(data?.error || 'No se pudo eliminar.');
        return;
      }
      load();
      return;
    }

    if (emptyBtn) {
      const group = emptyBtn.closest('.group');
      const fechaISO = group?.dataset.fecha || '';
      const teamSlug = group?.dataset.team || '';
      if (!fechaISO || !teamSlug) return;
      if (!confirm('¿Vaciar todas las fotos de esta carpeta?')) return;
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
