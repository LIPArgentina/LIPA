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

  function formatSize(bytes) {
    const mb = Number(bytes || 0) / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(1)} MB`;
  }

  function uploadOne(file, index, total) {
    return new Promise((resolve, reject) => {
      const body = new FormData();
      body.append('videos', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl('/api/videos/admin/upload'));
      xhr.timeout = 0;

      Object.entries(authHeaders()).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });

      xhr.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable) {
          setStatus(`Subiendo ${index + 1} de ${total}: ${file.name} (${formatSize(file.size)})...`, 'info');
          return;
        }

        const pct = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        setStatus(`Subiendo ${index + 1} de ${total}: ${file.name} - ${pct}%`, 'info');
      });

      xhr.addEventListener('load', () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText || '{}');
        } catch {}

        if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) {
          resolve(data);
          return;
        }

        reject(new Error(data.error || `HTTP ${xhr.status}`));
      });

      xhr.addEventListener('error', () => {
        reject(new Error('La conexión se cortó durante la subida. Probá subir este video solo, con una conexión estable.'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('La subida fue cancelada.'));
      });

      xhr.send(body);
    });
  }

  uploadBtn?.addEventListener('click', async () => {
    const files = Array.from(input?.files || []);
    if (!files.length) {
      setStatus('Elegí al menos un video.', 'error');
      return;
    }

    uploadBtn.disabled = true;
    setStatus('Preparando subida...', 'info');

    try {
      for (let i = 0; i < files.length; i += 1) {
        await uploadOne(files[i], i, files.length);
      }

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
