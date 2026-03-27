(function(){
  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const qs = new URLSearchParams(location.search);
  const fechaISO = (qs.get('fechaISO') || '').slice(0, 10);
  const localSlug = (qs.get('localSlug') || '').trim().toLowerCase();
  const visitanteSlug = (qs.get('visitanteSlug') || '').trim().toLowerCase();
  const team = (qs.get('team') || '').trim().toLowerCase();

  const matchInfo = document.getElementById('matchInfo');
  const statusBox = document.getElementById('statusBox');
  const picturesInput = document.getElementById('picturesInput');
  const btnUpload = document.getElementById('btnUpload');
  const myFiles = document.getElementById('myFiles');
  const btnVolver = document.getElementById('btnVolver');

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

  function setStatus(text, type='') {
    statusBox.textContent = text || '';
    statusBox.className = 'status' + (type ? ' ' + type : '');
  }

  async function checkStatus() {
    matchInfo.textContent = `Fecha ${fechaISO} · ${localSlug} vs ${visitanteSlug}`;
    if (btnVolver) btnVolver.href = `../cruces/cruces_fecha.html?team=${encodeURIComponent(team)}`;

    const url = new URL(API_BASE + '/api/cruces/lock-status');
    url.searchParams.set('fechaISO', fechaISO);
    url.searchParams.set('equipoSlug', team);
    url.searchParams.set('localSlug', localSlug);
    url.searchParams.set('visitanteSlug', visitanteSlug);

    const res = await fetch(url.toString(), { headers: authHeaders(), credentials: 'include', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data?.ok && (data?.tipo === 'validado' || data?.locked);
    btnUpload.disabled = !ok;
    picturesInput.disabled = !ok;
    setStatus(ok ? 'Cruce validado. Ya podés subir fotos.' : 'Todavía no está habilitada la subida de fotos.', ok ? 'success' : 'error');
  }

  async function loadMyFiles() {
    myFiles.innerHTML = '<p class="muted">Cargando…</p>';
    const url = new URL(API_BASE + '/api/pictures/my');
    url.searchParams.set('fechaISO', fechaISO);
    const res = await fetch(url.toString(), { headers: authHeaders(), credentials: 'include', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      myFiles.innerHTML = '<p class="muted">No se pudieron cargar tus fotos.</p>';
      return;
    }
    const files = Array.isArray(data.files) ? data.files : [];
    if (!files.length) {
      myFiles.innerHTML = '<p class="muted">Todavía no subiste fotos.</p>';
      return;
    }
    myFiles.innerHTML = files.map(file => `
      <div class="file-row">
        <div class="file-meta">
          <strong>${file.filename}</strong>
          <span>${file.fechaISO}</span>
        </div>
        <div class="file-actions">
          <a class="btn" href="${API_BASE}/api/pictures/team/download?fechaISO=${encodeURIComponent(file.fechaISO)}&filename=${encodeURIComponent(file.filename)}">DESCARGAR</a>
        </div>
      </div>
    `).join('');
  }

  btnUpload?.addEventListener('click', async () => {
    const files = Array.from(picturesInput.files || []);
    if (!files.length) {
      setStatus('Elegí al menos una foto.', 'error');
      return;
    }

    const body = new FormData();
    body.append('fechaISO', fechaISO);
    body.append('localSlug', localSlug);
    body.append('visitanteSlug', visitanteSlug);
    for (const file of files) body.append('pictures', file);

    btnUpload.disabled = true;
    setStatus('Subiendo fotos…');

    try {
      const res = await fetch(API_BASE + '/api/pictures/upload', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'No se pudieron subir las fotos');
      picturesInput.value = '';
      setStatus('Fotos subidas correctamente.', 'success');
      await loadMyFiles();
    } catch (err) {
      setStatus(err.message || 'No se pudieron subir las fotos.', 'error');
    } finally {
      btnUpload.disabled = false;
    }
  });

  checkStatus().then(loadMyFiles).catch(() => setStatus('No se pudo verificar el estado del cruce.', 'error'));
})();
