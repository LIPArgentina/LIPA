(function(){
  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const adminList = document.getElementById('adminList');
  const adminStatus = document.getElementById('adminStatus');
  const btnReload = document.getElementById('btnReload');
  const btnManualUpload = document.getElementById('btnManualUpload');
  const fechaFilter = document.getElementById('fechaFilter');

  const modal = document.getElementById('manualUploadModal');
  const btnCloseManualUpload = document.getElementById('btnCloseManualUpload');
  const btnCancelManualUpload = document.getElementById('btnCancelManualUpload');
  const btnChooseManualPhotos = document.getElementById('btnChooseManualPhotos');
  const btnSubmitManualUpload = document.getElementById('btnSubmitManualUpload');

  const manualPicturesInput = document.getElementById('manualPicturesInput');
  const manualPickedFilesText = document.getElementById('manualPickedFilesText');
  const manualPreviewContainer = document.getElementById('manualPreviewContainer');
  const manualStatusBox = document.getElementById('manualStatusBox');
  const manualFechaISO = document.getElementById('manualFechaISO');
  const manualTeamSlug = document.getElementById('manualTeamSlug');

  const blobUrlCache = new Map();
  const REQUIRED_PICTURES = 9;

  let allGroups = [];
  let availableDates = [];
  let availableTeams = [];

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
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function setStatus(node, text, type = '') {
    if (!node) return;
    node.textContent = text || '';
    node.className = 'status' + (type ? ' ' + type : '');
  }

  function revokeBlobCache() {
    for (const url of blobUrlCache.values()) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    blobUrlCache.clear();
  }

  function normalizeApiUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/')) return API_BASE + value;
    return API_BASE + '/' + value.replace(/^\/+/, '');
  }

  function buildFilePath(fechaISO, teamSlug, filename) {
    const parts = [fechaISO, teamSlug, filename]
      .map(v => String(v || '').trim())
      .filter(Boolean);
    return parts.join('/');
  }

  function unique(values) {
    const out = [];
    const seen = new Set();
    values.forEach((value) => {
      const v = String(value || '').trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      out.push(v);
    });
    return out;
  }

  function compareDateDesc(a, b) {
    return String(b || '').localeCompare(String(a || ''));
  }

  function compareTeams(a, b) {
    return String(a?.teamName || a?.label || a?.teamSlug || '').localeCompare(
      String(b?.teamName || b?.label || b?.teamSlug || ''),
      'es',
      { sensitivity: 'base' }
    );
  }

  function buildImageCandidates(item, card) {
    const fechaISO = card?.dataset?.fecha || '';
    const teamSlug = card?.dataset?.team || '';
    const filename = item?.filename || item?.name || item?.basename || '';

    const filePath = item?.filePath || item?.relativePath || item?.path || buildFilePath(fechaISO, teamSlug, filename);

    const directCandidates = [
      item?.thumbUrl,
      item?.previewUrl,
      item?.imageUrl,
      item?.image,
      item?.url,
      item?.downloadUrl,
      item?.viewUrl,
      item?.src
    ].map(normalizeApiUrl);

    const fileParamCandidates = [];
    if (filePath) {
      const qp = new URLSearchParams({ file: filePath }).toString();
      fileParamCandidates.push(
        API_BASE + '/api/pictures/admin/thumb?' + qp,
        API_BASE + '/api/pictures/admin/file?' + qp,
        API_BASE + '/api/pictures/admin/image?' + qp,
        API_BASE + '/api/pictures/admin/view?' + qp,
        API_BASE + '/api/pictures/file?' + qp,
        API_BASE + '/api/pictures/thumb?' + qp
      );
    }

    return unique([...directCandidates, ...fileParamCandidates]);
  }

  async function fetchBlobUrl(resourceUrl) {
    if (!resourceUrl) return '';
    if (blobUrlCache.has(resourceUrl)) return blobUrlCache.get(resourceUrl);

    const res = await fetch(resourceUrl, {
      headers: authHeaders(),
      credentials: 'include',
      cache: 'no-store'
    });

    if (!res.ok) {
      let msg = 'No se pudo cargar la imagen.';
      try {
        const data = await res.json();
        msg = data?.error || data?.msg || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    blobUrlCache.set(resourceUrl, objectUrl);
    return objectUrl;
  }

  async function fetchFirstAvailableBlobUrl(candidates) {
    let lastError = null;
    for (const url of candidates) {
      try {
        return await fetchBlobUrl(url);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('No se pudo cargar la imagen.');
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: authHeaders(options.headers || {}),
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || data?.msg || ('HTTP ' + res.status));
    }
    return data;
  }

  async function readErrorMessage(response, fallbackMessage) {
    try {
      const data = await response.json();
      return data?.error || data?.message || fallbackMessage;
    } catch (_) {
      try {
        const text = await response.text();
        return text || fallbackMessage;
      } catch (_) {
        return fallbackMessage;
      }
    }
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
      } catch (_) {}
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

  async function fetchFixtureDates() {
    const categories = ['segunda', 'tercera'];
    const kinds = ['ida', 'vuelta'];
    const dates = new Set();

    await Promise.all(categories.flatMap(category => kinds.map(async (kind) => {
      try {
        const url = API_BASE + '/api/fixture?kind=' + encodeURIComponent(kind) + '&category=' + encodeURIComponent(category);
        const data = await fetchJson(url);
        const fechas = Array.isArray(data?.data?.fechas) ? data.data.fechas : [];
        fechas.forEach((fecha) => {
          const raw = String(fecha?.date || fecha?.fecha || fecha?.fechaISO || '').trim();
          const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
          if (match) dates.add(match[1]);
        });
      } catch (_) {}
    })));

    return [...dates].sort(compareDateDesc);
  }

  async function fetchAvailableTeamsFromBackend() {
    try {
      const data = await fetchJson(API_BASE + '/api/pictures/admin/teams');
      const teams = Array.isArray(data?.teams) ? data.teams : [];
      return teams.map((team) => ({
        teamSlug: slugify(team?.teamSlug || team?.slug || team?.value || ''),
        teamName: String(team?.teamName || team?.displayName || team?.label || team?.name || team?.teamSlug || team?.slug || '').trim()
      })).filter(team => team.teamSlug);
    } catch (_) {
      return [];
    }
  }

  async function refreshAvailableTeams(groups) {
    const backendTeams = await fetchAvailableTeamsFromBackend();

    const groupedTeams = unique((groups || []).map(group => String(group?.teamSlug || '').trim()))
      .map((teamSlug) => {
        const group = (groups || []).find(item => String(item?.teamSlug || '').trim() === teamSlug);
        return {
          teamSlug,
          teamName: String(group?.teamName || teamSlug).trim()
        };
      });

    const mergedMap = new Map();
    [...backendTeams, ...groupedTeams].forEach((team) => {
      const key = slugify(team?.teamSlug);
      if (!key) return;
      const current = mergedMap.get(key);
      if (!current || (!current.teamName && team.teamName) || current.teamName === current.teamSlug) {
        mergedMap.set(key, {
          teamSlug: key,
          teamName: String(team?.teamName || key).trim()
        });
      }
    });

    availableTeams = [...mergedMap.values()].sort(compareTeams);

    if (!manualTeamSlug) return;
    const currentValue = String(manualTeamSlug.value || '').trim();
    const options = ['<option value="">Elegí un equipo</option>']
      .concat(
        availableTeams.map((team) => (
          `<option value="${escapeHtml(team.teamSlug)}">${escapeHtml(team.teamName)} - ${escapeHtml(team.teamSlug)}</option>`
        ))
      );
    manualTeamSlug.innerHTML = options.join('');
    if (currentValue && availableTeams.some(team => team.teamSlug === currentValue)) {
      manualTeamSlug.value = currentValue;
    }
  }

  function renderGroups(groups) {
    if (!groups.length) {
      adminList.innerHTML = '<p class="muted">No hay fotos cargadas para el filtro seleccionado.</p>';
      return;
    }

    adminList.innerHTML = groups.map(group => {
      const itemCount = Array.isArray(group.items) ? group.items.length : 0;
      const preview = (group.items || []).slice(0, 9).map(item => {
        const candidates = buildImageCandidates(item, {
          dataset: {
            fecha: group.fechaISO || '',
            team: group.teamSlug || ''
          }
        });

        return `
          <button class="thumb-btn" type="button" data-open-img-candidates="${escapeHtml(JSON.stringify(candidates))}" data-open-title="${escapeHtml(item.filename || item.name || '')}">
            <img
              class="thumb-img"
              src=""
              alt="${escapeHtml(item.filename || item.name || '')}"
              data-thumb-candidates="${escapeHtml(JSON.stringify(candidates))}"
              loading="lazy"
            />
          </button>
        `;
      }).join('');

      return `
        <div class="group-card" data-fecha="${escapeHtml(group.fechaISO)}" data-team="${escapeHtml(group.teamSlug)}" data-zipname="${escapeHtml(group.zipFilename || 'pictures.zip')}">
          <div class="group-header group-header-stack">
            <div>
              <h3>${escapeHtml(group.teamName || group.teamSlug)}</h3>
              <div class="muted">${escapeHtml(group.teamSlug)} · ${escapeHtml(group.fechaISO)}</div>
              <div class="muted">${itemCount} foto${itemCount === 1 ? '' : 's'}</div>
            </div>
            <div class="group-actions">
              <button class="btn btn-gold" type="button" data-prefill-manual="1">REPETIR CARGA</button>
              <button class="btn" type="button" data-download-zip="1">DESCARGAR ZIP</button>
              <button class="btn btn-danger" type="button" data-empty-folder="1">VACIAR CONTENIDO</button>
            </div>
          </div>
          <div class="thumb-grid">${preview}</div>
        </div>
      `;
    }).join('');
  }

  async function hydrateThumbs() {
    const imgs = Array.from(adminList.querySelectorAll('img[data-thumb-candidates]'));
    await Promise.all(imgs.map(async (img) => {
      let candidates = [];
      try {
        candidates = JSON.parse(img.dataset.thumbCandidates || '[]');
      } catch (_) {}
      if (!Array.isArray(candidates) || !candidates.length) return;

      try {
        img.src = await fetchFirstAvailableBlobUrl(candidates);
      } catch (_) {
        img.alt = 'No se pudo cargar la miniatura';
        img.closest('.thumb-btn')?.classList.add('thumb-failed');
      }
    }));
  }

  function getFilteredGroups() {
    const selectedDate = String(fechaFilter?.value || '').trim();
    if (!selectedDate) return allGroups.slice();
    return allGroups.filter(group => String(group?.fechaISO || '').slice(0, 10) === selectedDate);
  }

  async function renderCurrentGroups() {
    revokeBlobCache();
    renderGroups(getFilteredGroups());
    await hydrateThumbs();
  }

  function fillSelectOptions(selectNode, dates, placeholderLabel, includeEmpty) {
    if (!selectNode) return;
    const currentValue = String(selectNode.value || '').trim();
    const optionHtml = [];
    if (includeEmpty) optionHtml.push(`<option value="">${escapeHtml(placeholderLabel)}</option>`);
    dates.forEach((date) => {
      optionHtml.push(`<option value="${escapeHtml(date)}">${escapeHtml(date)}</option>`);
    });
    selectNode.innerHTML = optionHtml.join('');
    if (currentValue && dates.includes(currentValue)) {
      selectNode.value = currentValue;
    } else if (includeEmpty) {
      selectNode.value = '';
    } else if (dates.length) {
      selectNode.value = dates[0];
    }
  }

  async function refreshAvailableDates(groups) {
    const groupDates = unique((groups || []).map(group => String(group?.fechaISO || '').slice(0, 10))).sort(compareDateDesc);
    const fixtureDates = await fetchFixtureDates();
    availableDates = unique([...fixtureDates, ...groupDates]).sort(compareDateDesc);
    fillSelectOptions(fechaFilter, availableDates, 'TODAS', true);
    fillSelectOptions(manualFechaISO, availableDates, 'Elegí una fecha', true);
  }

  async function load() {
    setStatus(adminStatus, 'Cargando…', 'info');

    try {
      const data = await fetchJson(API_BASE + '/api/pictures/admin/list');
      allGroups = Array.isArray(data.groups) ? data.groups : [];
      await refreshAvailableDates(allGroups);
      await refreshAvailableTeams(allGroups);
      await renderCurrentGroups();
      setStatus(adminStatus, allGroups.length ? '' : 'No hay fotos cargadas.', allGroups.length ? '' : 'info');
    } catch (err) {
      adminList.innerHTML = `<p class="muted">${escapeHtml(err?.message || 'No se pudieron cargar las fotos.')}</p>`;
      setStatus(adminStatus, err?.message || 'No se pudieron cargar las fotos.', 'error');
    }
  }

  function openManualModal(prefill = {}) {
    if (prefill.fechaISO && availableDates.includes(String(prefill.fechaISO).slice(0, 10))) {
      manualFechaISO.value = String(prefill.fechaISO).slice(0, 10);
    }
    if (prefill.teamSlug) {
      const normalized = slugify(prefill.teamSlug);
      if (availableTeams.some(team => team.teamSlug === normalized)) {
        manualTeamSlug.value = normalized;
      }
    }

    modal.hidden = false;
    document.body.classList.add('modal-open');
    setStatus(manualStatusBox, 'Completá los datos y elegí exactamente 9 fotos.', 'info');
    setTimeout(() => manualFechaISO?.focus(), 0);
  }

  function closeManualModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function resetManualForm(options = {}) {
    if (!options.keepPrefill) {
      manualFechaISO.value = '';
      manualTeamSlug.value = '';
    }
    manualPicturesInput.value = '';
    manualPreviewContainer.innerHTML = '';
    manualPickedFilesText.textContent = 'No se eligió ningún archivo';
    setStatus(manualStatusBox, '');
  }

  function updateManualPreview() {
    const files = Array.from(manualPicturesInput.files || []);
    manualPreviewContainer.innerHTML = '';

    if (!files.length) {
      manualPickedFilesText.textContent = 'No se eligió ningún archivo';
      return;
    }

    manualPickedFilesText.textContent = `${files.length} / ${REQUIRED_PICTURES} fotos seleccionadas`;

    files.forEach(file => {
      if (!String(file.type || '').startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = document.createElement('img');
        img.className = 'preview-img';
        img.src = event.target?.result || '';
        img.alt = file.name;
        manualPreviewContainer.appendChild(img);
      };
      reader.readAsDataURL(file);
    });
  }

  function validateManualFields() {
    const fechaISO = String(manualFechaISO.value || '').slice(0, 10);
    const teamSlug = slugify(manualTeamSlug.value);
    const files = Array.from(manualPicturesInput.files || []);

    if (!fechaISO) return { ok: false, message: 'Elegí la fecha de carga.', type: 'error' };
    if (!teamSlug) return { ok: false, message: 'Elegí el equipo que sube las fotos.', type: 'error' };
    if (files.length !== REQUIRED_PICTURES) {
      return {
        ok: false,
        message: files.length < REQUIRED_PICTURES
          ? `Faltan ${REQUIRED_PICTURES - files.length} foto${REQUIRED_PICTURES - files.length === 1 ? '' : 's'} para poder enviar.`
          : `Solo se permiten ${REQUIRED_PICTURES} fotos por carga.`,
        type: 'error'
      };
    }

    return { ok: true, data: { fechaISO, teamSlug, files } };
  }

  async function submitManualUpload() {
    const validation = validateManualFields();
    if (!validation.ok) {
      setStatus(manualStatusBox, validation.message, validation.type);
      return;
    }

    const { fechaISO, teamSlug, files } = validation.data;
    const body = new FormData();
    body.append('fechaISO', fechaISO);
    body.append('teamSlug', teamSlug);
    body.append('team', teamSlug);
    body.append('manualUpload', '1');
    body.append('adminUpload', '1');
    for (const file of files) body.append('pictures', file);

    btnSubmitManualUpload.disabled = true;
    btnChooseManualPhotos.disabled = true;
    setStatus(manualStatusBox, 'Subiendo fotos…', 'info');

    try {
      const res = await fetch(API_BASE + '/api/pictures/admin/upload', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body
      });

      if (!res.ok) {
        const fallback = res.status === 502
          ? 'El backend devolvió 502 al subir las fotos. Revisá el deploy/logs del backend en staging.'
          : 'No se pudieron subir las fotos.';
        throw new Error(await readErrorMessage(res, fallback));
      }

      const data = await res.json().catch(() => ({}));
      if (!data?.ok) {
        throw new Error(data?.error || 'No se pudieron subir las fotos.');
      }

      setStatus(manualStatusBox, 'Las 9 fotos se subieron correctamente.', 'success');
      setStatus(adminStatus, `Carga manual completada para ${teamSlug} · ${fechaISO}.`, 'success');
      resetManualForm({ keepPrefill: true });
      await load();
    } catch (err) {
      setStatus(manualStatusBox, err?.message || 'No se pudieron subir las fotos.', 'error');
    } finally {
      btnSubmitManualUpload.disabled = false;
      btnChooseManualPhotos.disabled = false;
    }
  }

  adminList?.addEventListener('click', async (ev) => {
    const card = ev.target.closest('.group-card');
    if (!card) return;

    const openBtn = ev.target.closest('[data-open-img-candidates]');
    if (openBtn) {
      let candidates = [];
      try {
        candidates = JSON.parse(openBtn.dataset.openImgCandidates || '[]');
      } catch (_) {}
      if (!Array.isArray(candidates) || !candidates.length) return;
      try {
        const blobUrl = await fetchFirstAvailableBlobUrl(candidates);
        window.open(blobUrl, '_blank', 'noopener');
      } catch (err) {
        alert(err?.message || 'No se pudo abrir la imagen.');
      }
      return;
    }

    const prefillBtn = ev.target.closest('[data-prefill-manual]');
    if (prefillBtn) {
      resetManualForm();
      openManualModal({
        fechaISO: card.dataset.fecha || '',
        teamSlug: card.dataset.team || ''
      });
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
      await load();
    }
  });

  fechaFilter?.addEventListener('change', async () => {
    await renderCurrentGroups();
  });

  btnReload?.addEventListener('click', load);

  btnManualUpload?.addEventListener('click', () => {
    resetManualForm();
    openManualModal();
  });

  btnCloseManualUpload?.addEventListener('click', closeManualModal);
  btnCancelManualUpload?.addEventListener('click', closeManualModal);

  modal?.addEventListener('click', (ev) => {
    if (ev.target?.matches('[data-close-modal]')) closeManualModal();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modal && !modal.hidden) closeManualModal();
  });

  btnChooseManualPhotos?.addEventListener('click', () => {
    if (!btnChooseManualPhotos.disabled) manualPicturesInput.click();
  });

  manualPicturesInput?.addEventListener('change', () => {
    const files = Array.from(manualPicturesInput.files || []);
    if (files.length > REQUIRED_PICTURES) {
      manualPicturesInput.value = '';
      manualPreviewContainer.innerHTML = '';
      manualPickedFilesText.textContent = 'No se eligió ningún archivo';
      setStatus(manualStatusBox, `Solo podés seleccionar ${REQUIRED_PICTURES} fotos exactas.`, 'error');
      return;
    }

    if (files.length > 0 && files.length < REQUIRED_PICTURES) {
      setStatus(manualStatusBox, `Faltan ${REQUIRED_PICTURES - files.length} foto${REQUIRED_PICTURES - files.length === 1 ? '' : 's'} para completar la carga.`, 'error');
    } else if (files.length === REQUIRED_PICTURES) {
      setStatus(manualStatusBox, 'Cantidad correcta de fotos lista para subir.', 'success');
    } else {
      setStatus(manualStatusBox, '');
    }

    updateManualPreview();
  });

  manualTeamSlug?.addEventListener('change', () => {
    manualTeamSlug.value = slugify(manualTeamSlug.value);
  });

  btnSubmitManualUpload?.addEventListener('click', submitManualUpload);
  window.addEventListener('beforeunload', revokeBlobCache);
  load();
})();