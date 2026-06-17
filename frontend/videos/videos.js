(() => {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const grid = document.getElementById('videosGrid');
  const statusBox = document.getElementById('statusBox');

  function apiUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_BASE}${path}`;
  }

  function setStatus(text, type = 'info') {
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

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function seek(video, seconds) {
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + seconds));
  }

  async function toggleFullscreen(card, video) {
    if (!video && !card) return;

    if (video && typeof video.webkitEnterFullscreen === 'function') {
      video.webkitEnterFullscreen();
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    const target = video?.requestFullscreen ? video : card;
    if (target.requestFullscreen) await target.requestFullscreen();
  }

  function wireControls(card) {
    const video = card.querySelector('video');
    card.querySelector('[data-action="play"]')?.addEventListener('click', () => video?.play());
    card.querySelector('[data-action="pause"]')?.addEventListener('click', () => video?.pause());
    card.querySelector('[data-action="back"]')?.addEventListener('click', () => seek(video, -30));
    card.querySelector('[data-action="forward"]')?.addEventListener('click', () => seek(video, 30));
    card.querySelector('[data-action="fullscreen"]')?.addEventListener('click', () => toggleFullscreen(card, video));
  }

  function render(videos) {
    if (!grid) return;
    grid.innerHTML = '';

    if (!videos.length) {
      setStatus('Todavía no hay videos cargados.', 'info');
      return;
    }

    setStatus('', 'info');

    videos.forEach((item) => {
      const title = item.title || item.filename || 'Video';
      const url = apiUrl(item.url);
      const card = document.createElement('article');
      card.className = 'video-card';
      card.innerHTML = `
        <h2 class="video-card__title">${escapeHtml(title)}</h2>
        <div class="video-card__stage">
          <video preload="metadata" playsinline src="${escapeHtml(url)}"></video>
        </div>
        <div class="video-controls" aria-label="Controles de ${escapeHtml(title)}">
          <button class="video-control" type="button" data-action="play">Play</button>
          <button class="video-control" type="button" data-action="pause">Pause</button>
          <button class="video-control" type="button" data-action="back">-30s</button>
          <button class="video-control" type="button" data-action="forward">+30s</button>
          <button class="video-control" type="button" data-action="fullscreen">Pantalla</button>
        </div>
      `;
      wireControls(card);
      grid.appendChild(card);
    });
  }

  async function loadVideos() {
    try {
      setStatus('Cargando videos...', 'info');
      const response = await fetch(apiUrl('/api/videos'), { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
      render(Array.isArray(data.videos) ? data.videos : []);
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'No se pudieron cargar los videos.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', loadVideos);
  window.addEventListener('videos:refresh', loadVideos);
})();
