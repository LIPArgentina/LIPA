(() => {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const input = document.getElementById('videosInput');
  const uploadBtn = document.getElementById('uploadBtn');
  const statusBox = document.getElementById('statusBox');

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function setStatus(text, type = 'info') {
    if (!statusBox) return;
    statusBox.hidden = !text;
    statusBox.textContent = text || '';
    statusBox.className = `status-box ${type}`;
  }

  function readSession() {
    for (const key of ['lpi.session', 'lpi_team_session']) {
      try {
        const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (!raw) continue;
        const sess = JSON.parse(raw);
        if (sess?.token) return sess;
      } catch {}
    }
    return {};
  }

  function authHeaders() {
    const token = readSession().token || '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  uploadBtn?.addEventListener('click', async () => {
    const files = Array.from(input?.files || []);
    if (!files.length) {
      setStatus('Elegí al menos un video.', 'error');
      return;
    }

    const body = new FormData();
    files.forEach((file) => body.append('videos', file));

    uploadBtn.disabled = true;
    setStatus('Subiendo videos. Esta carga puede tardar varios minutos...', 'info');

    try {
      const response = await fetch(apiUrl('/api/videos/admin/upload'), {
        method: 'POST',
        headers: authHeaders(),
        body
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
      if (input) input.value = '';
      setStatus('Videos subidos correctamente.', 'info');
      window.dispatchEvent(new CustomEvent('videos:refresh'));
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'No se pudieron subir los videos.', 'error');
    } finally {
      uploadBtn.disabled = false;
    }
  });
})();
