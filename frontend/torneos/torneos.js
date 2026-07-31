(() => {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const grid = document.getElementById('torneosGrid');
  const statusBox = document.getElementById('statusBox');
  const lightbox = document.getElementById('imageLightbox');
  const lightboxImg = document.getElementById('imageLightboxImg');
  const lightboxClose = document.getElementById('imageLightboxClose');

  function apiUrl(path){
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_BASE}${path}`;
  }

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

    const fecha = d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    const hora = d.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    return `${fecha}, ${hora} hs`;
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

  function normalizeWhatsappUrl(value){
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (/^https?:\/\/(chat\.whatsapp\.com|wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(raw)) {
      return raw;
    }

    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';

    if (digits.length <= 10) {
      return `https://wa.me/549${digits}`;
    }

    return `https://wa.me/${digits}`;
  }

  function buildWhatsappMessage(torneo){
    const fecha = formatDateTime(torneo?.fechaHora);
    const categoria = String(torneo?.categoria || '').trim();
    const divisiones = Array.isArray(torneo?.categorias) ? torneo.categorias.map(item => item.categoria).filter(Boolean).join(', ') : '';

    return `Hola, vengo de la APP de LIPA y quiero inscribirme al torneo del ${fecha}. Categoría: ${categoria || '—'}${divisiones ? ` (${divisiones})` : ''}.`;
  }

  function addWhatsappMessage(url, message){
    if (!url || !message) return url || '';

    try {
      const parsed = new URL(url);
      parsed.searchParams.set('text', message);
      return parsed.toString();
    } catch (err) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}text=${encodeURIComponent(message)}`;
    }
  }

  function buildWhatsappUrl(torneo, contactValue = torneo?.contacto){
    const baseUrl = normalizeWhatsappUrl(contactValue);
    if (!baseUrl) return '';

    return addWhatsappMessage(baseUrl, buildWhatsappMessage(torneo));
  }

  function renderCategoryDetails(torneo){
    const items = Array.isArray(torneo?.categorias) ? torneo.categorias : [];
    if (!items.length) return `<div class="torneo-row"><span>Fecha y hora</span><strong>${formatDateTime(torneo.fechaHora)}</strong></div><div class="torneo-row"><span>Valor</span><strong>${formatValor(torneo.valor, torneo.moneda)}</strong></div>`;
    const date = new Date(torneo.fechaHora).toLocaleDateString('es-AR', { dateStyle:'medium' });
    return `<div class="torneo-row"><span>Fecha</span><strong>${date}</strong></div><div class="categoria-publica-list">${items.map(item => `<div class="categoria-publica"><strong>${escapeHtml(item.categoria)}</strong><span>${escapeHtml(item.hora)} hs</span><span>${formatValor(item.valor, item.moneda || torneo.moneda)}</span></div>`).join('')}</div>${torneo.valorMesa != null ? `<div class="torneo-row"><span>Valor mesa</span><strong>${formatValor(torneo.valorMesa, torneo.moneda)}</strong></div>` : ''}`;
  }

  function openImageLightbox(src, alt){
    if (!lightbox || !lightboxImg || !src) return;
    lightboxImg.src = src;
    lightboxImg.alt = alt || 'Imagen ampliada del torneo';
    lightbox.hidden = false;
    document.body.classList.add('no-scroll');
  }

  function closeImageLightbox(){
    if (!lightbox || !lightboxImg) return;
    lightbox.hidden = true;
    lightboxImg.removeAttribute('src');
    document.body.classList.remove('no-scroll');
  }

  function blobToDataUrl(blob){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function loadImageAsDataUrl(url){
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors'
    });

    if (!response.ok) {
      throw new Error(`No se pudo cargar la imagen: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    return blobToDataUrl(blob);
  }

  function wireImageLightbox(img){
    img.addEventListener('click', () => {
      const src = img.currentSrc || img.src || img.dataset.src;
      openImageLightbox(src, img.alt);
    });

    img.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        const src = img.currentSrc || img.src || img.dataset.src;
        openImageLightbox(src, img.alt);
      }
    });
  }

  async function hydrateTournamentImages(){
    const images = document.querySelectorAll('.torneo-img[data-src]');

    for (const img of images) {
      wireImageLightbox(img);

      try {
        const url = img.dataset.src;
        if (!url) continue;

        const dataUrl = await loadImageAsDataUrl(url);
        img.src = dataUrl;
        img.classList.remove('is-broken');
      } catch (err) {
        console.error(err);
        img.classList.add('is-broken');
        img.alt = `${img.alt || 'Imagen del torneo'} - no se pudo cargar`;
      }
    }
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
      const imageUrl = apiUrl(torneo.mediaUrl);
      const card = document.createElement('article');
      card.className = 'torneo-card';
      card.innerHTML = `
        <div class="torneo-card__media">
          <img class="torneo-img" alt="Torneo de ${escapeHtml(torneo.sala || 'sala')}" data-src="${escapeHtml(imageUrl)}" loading="lazy" role="button" tabindex="0" title="Tocar para ampliar">
        </div>
        <div class="torneo-card__body">
          <div class="torneo-row torneo-row--sala"><span>Sala</span><strong>${escapeHtml(torneo.sala || 'Sala')}</strong></div>
          <div class="torneo-row"><span>Categoría</span><strong>${escapeHtml(torneo.categoria || '—')}</strong></div>
          ${renderCategoryDetails(torneo)}
          ${(buildWhatsappUrl(torneo) || buildWhatsappUrl(torneo, torneo.contacto2)) ? `<div class="contactos-row">${buildWhatsappUrl(torneo) ? `<a class="btn-contacto" href="${escapeHtml(buildWhatsappUrl(torneo))}" target="_blank" rel="noopener noreferrer">${torneo.contacto2 ? 'CONTACTO 1' : 'CONTACTO'}</a>` : ''}${buildWhatsappUrl(torneo, torneo.contacto2) ? `<a class="btn-contacto" href="${escapeHtml(buildWhatsappUrl(torneo, torneo.contacto2))}" target="_blank" rel="noopener noreferrer">CONTACTO 2</a>` : ''}</div>` : ''}
          ${torneo.ubicacion ? `
            <a 
              class="btn-ver-ubicacion" 
              href="${escapeHtml(torneo.ubicacion)}" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              VER UBICACIÓN
            </a>
          ` : ''}
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

      render(
        Array.isArray(data.torneos)
          ? data.torneos.map(t => ({
              ...t,
              ubicacion: t.ubicacion || t.salaUbicacion || '',
              contacto: t.contacto || t.salaContacto || '',
              contacto2: t.contacto2 || t.salaContacto2 || ''
            }))
          : []
      );

      await hydrateTournamentImages();
    } catch (err) {
      console.error(err);
      render([]);
      setStatus(err?.message || 'No se pudieron cargar los torneos.', 'error');
    }
  }

  lightboxClose?.addEventListener('click', closeImageLightbox);
  lightbox?.addEventListener('click', (ev) => {
    if (ev.target === lightbox) closeImageLightbox();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && lightbox && !lightbox.hidden) closeImageLightbox();
  });

  document.addEventListener('DOMContentLoaded', loadTorneos);
})();
