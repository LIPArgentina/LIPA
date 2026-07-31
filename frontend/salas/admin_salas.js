(function(){
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const sessionKey = 'lpi.session';
  const MAX_SLOTS = 6;

  const $ = (s) => document.querySelector(s);
  const grid = $('#torneosGrid');
  const statusBox = $('#statusBox');
  const state = { torneos: [], selectedFiles: new Map() };

  function readSession(){
    try { return JSON.parse(localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey) || '{}'); }
    catch { return {}; }
  }

  function getParams(){ return new URLSearchParams(location.search); }
  function getSalaSlug(){ const p = getParams(); return p.get('sala') || readSession().slug || ''; }
  function getSalaId(){ const p = getParams(); return p.get('salaId') || readSession().salaId || null; }
  function getToken(){ const p = getParams(); return p.get('token') || readSession().token || ''; }
  function authHeaders(){ const token = getToken(); return token ? { Authorization: `Bearer ${token}` } : {}; }
  function apiUrl(path){ return `${API_BASE}${path}`; }

  function setSalaName(){
    const sess = readSession();
    const label = sess.displayName || getSalaSlug() || 'Sala';
    const el = $('#salaName');
    if (el) el.textContent = label;
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

  function setMessage(type, text){
    const err = $('#passError');
    const ok = $('#passSuccess');
    if (err) err.hidden = true;
    if (ok) ok.hidden = true;
    const el = type === 'ok' ? ok : err;
    if (el) {
      el.textContent = text;
      el.hidden = false;
    }
  }

  function resetPassForm(){
    $('#oldPass').value = '';
    $('#newPass').value = '';
    $('#newPass2').value = '';
    $('#passError').hidden = true;
    $('#passSuccess').hidden = true;
  }

  function openPassModal(){
    resetPassForm();
    const dlg = $('#passModal');
    if (dlg?.showModal) dlg.showModal();
  }

  async function submitPassword(ev){
    ev.preventDefault();
    const oldPassword = $('#oldPass').value;
    const newPassword = $('#newPass').value;
    const newPassword2 = $('#newPass2').value;

    if (!oldPassword || !newPassword || newPassword !== newPassword2) {
      setMessage('error', 'Revisá los campos');
      return;
    }

    try {
      const resp = await fetch(apiUrl('/api/sala/change-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'omit',
        body: JSON.stringify({ slug: getSalaSlug(), salaId: getSalaId(), oldPassword, newPassword })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.msg || data.error || `HTTP ${resp.status}`);
      setMessage('ok', '¡Contraseña actualizada!');
      setTimeout(() => $('#passModal')?.close(), 800);
    } catch (err) {
      setMessage('error', err?.message || 'No se pudo actualizar.');
    }
  }

  function wirePasswordToggles(){
    document.querySelectorAll('input[data-toggle]').forEach((chk) => {
      const target = document.querySelector(chk.getAttribute('data-toggle'));
      if (!target) return;
      chk.addEventListener('change', () => { target.type = chk.checked ? 'text' : 'password'; });
    });
  }

  function formatForInput(value){
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDateForInput(value){ return formatForInput(value).slice(0, 10); }
  function normalizeDisplayValue(value){
    const n = Number(String(value || '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return '';
    return String(Math.round(n > 0 && n < 1000 ? n * 1000 : n));
  }
  function divisionRowsHtml(categorias = []){
    return categorias.map((item) => `<div class="division-detail" data-division="${escapeAttr(item.categoria)}"><strong>${escapeAttr(item.categoria)}</strong><label>Hora<input class="js-division-hora" type="time" value="${escapeAttr(item.hora || '')}"></label><label>Valor<input class="js-division-valor" type="number" min="0" step="any" inputmode="decimal" value="${item.valor ?? ''}" placeholder="10 = 10.000"></label></div>`).join('');
  }
  function selectedCategorias(card){
    return [...card.querySelectorAll('.division-detail')].map(row => ({ categoria:row.dataset.division, hora:row.querySelector('.js-division-hora')?.value || '', valor:normalizeDisplayValue(row.querySelector('.js-division-valor')?.value), moneda:card.querySelector('.js-moneda')?.value || 'ARS' }));
  }

  function renderSlots(){
    if (!grid) return;
    grid.innerHTML = '';

    const bySlot = new Map((state.torneos || []).map(t => [Number(t.slot), t]));

    for (let slot = 1; slot <= MAX_SLOTS; slot++) {
      const torneo = bySlot.get(slot) || null;
      const file = state.selectedFiles.get(slot) || null;
      const previewUrl = file ? URL.createObjectURL(file) : (torneo?.mediaUrl ? apiUrl(torneo.mediaUrl) : '');
      const legacyTime = formatForInput(torneo?.fechaHora || '').slice(11,16);
      const savedCategorias = Array.isArray(torneo?.categorias) && torneo.categorias.length ? torneo.categorias : (torneo ? [{ categoria:'1ra', hora:legacyTime, valor:torneo.valor, moneda:torneo.moneda || 'ARS' }] : []);

      const card = document.createElement('article');
      card.className = 'torneo-slot';
      card.dataset.slot = String(slot);
      card.innerHTML = `
        <div class="torneo-slot__media">
          ${previewUrl ? `<img alt="Torneo slot ${slot}" src="${previewUrl}">` : `<div class="torneo-slot__empty">Cargar imagen o GIF</div>`}
          <input class="torneo-slot__file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Cargar imagen slot ${slot}">
        </div>
        <div class="torneo-slot__fields">
          <label>Categoría
            <input class="js-categoria" type="text" value="${escapeAttr(torneo?.categoria || '')}" placeholder="Ej: Parejas, Individual">
          </label>
          <fieldset class="divisiones-fieldset"><legend>Categorías LIPA</legend><div class="divisiones-checks">${['1ra','2da','3ra'].map(d => `<label><input type="checkbox" class="js-division" value="${d}" ${savedCategorias.some(c => c.categoria === d) ? 'checked' : ''}> ${d}</label>`).join('')}</div></fieldset>
          <div class="division-details">${divisionRowsHtml(savedCategorias)}</div>
          <label>Fecha<input class="js-fecha date-visible" type="date" value="${formatDateForInput(torneo?.fechaHora || '')}"></label>
          <label>Valor mesa<input class="js-valor-mesa" type="number" min="0" step="any" inputmode="decimal" value="${torneo?.valorMesa ?? ''}" placeholder="10 = 10.000"></label>
          <label>Moneda<select class="js-moneda"><option value="ARS" ${(torneo?.moneda || 'ARS') === 'ARS' ? 'selected' : ''}>Pesos</option><option value="USD" ${(torneo?.moneda || 'ARS') === 'USD' ? 'selected' : ''}>Dólares</option></select></label>
        </div>
        <div class="torneo-slot__actions">
          <button class="btn btn-primary js-save" type="button">Guardar</button>
          <button class="btn btn-danger js-delete" type="button" ${torneo ? '' : 'disabled'}>Eliminar</button>
        </div>
      `;

      const fileInput = card.querySelector('.torneo-slot__file');
      const saveBtn = card.querySelector('.js-save');
      const deleteBtn = card.querySelector('.js-delete');
      card.querySelectorAll('.js-division').forEach((checkbox) => checkbox.addEventListener('change', () => {
        const current = new Map(selectedCategorias(card).map(item => [item.categoria, item]));
        const next = [...card.querySelectorAll('.js-division:checked')].map(el => current.get(el.value) || { categoria:el.value, hora:'', valor:'' });
        card.querySelector('.division-details').innerHTML = divisionRowsHtml(next);
      }));

      fileInput.addEventListener('change', () => {
        const chosen = fileInput.files?.[0] || null;
        if (!chosen) return;
        state.selectedFiles.set(slot, chosen);
        renderSlots();
      });

      saveBtn.addEventListener('click', () => saveSlot(slot, card));
      deleteBtn.addEventListener('click', () => deleteSlot(slot));
      grid.appendChild(card);
    }
  }

  function escapeAttr(value){
    return String(value || '')
      .replaceAll('&','&amp;')
      .replaceAll('"','&quot;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;');
  }

  async function loadTorneos(){
    try {
      setStatus('Cargando torneos…', 'info');
      const resp = await fetch(apiUrl('/api/sala/torneos'), {
        cache: 'no-store',
        credentials: 'omit',
        headers: authHeaders()
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || data.msg || `HTTP ${resp.status}`);
      state.torneos = Array.isArray(data.torneos) ? data.torneos : [];
      state.selectedFiles.clear();
      renderSlots();
      setStatus('', 'info');
    } catch (err) {
      console.error(err);
      renderSlots();
      setStatus(err?.message || 'No se pudieron cargar los torneos.', 'error');
    }
  }

  async function saveSlot(slot, card){
    try {
      const file = state.selectedFiles.get(slot);
      if (!file) {
        setStatus('Seleccioná una imagen o GIF para guardar este recuadro.', 'error');
        return;
      }

      const categoria = card.querySelector('.js-categoria')?.value.trim() || '';
      const fecha = card.querySelector('.js-fecha')?.value || '';
      const categorias = selectedCategorias(card);
      const valorMesa = normalizeDisplayValue(card.querySelector('.js-valor-mesa')?.value);
      const moneda = card.querySelector('.js-moneda')?.value || 'ARS';

      if (!categoria || !fecha || !categorias.length || categorias.some(item => !item.hora || !item.valor) || !valorMesa) {
        setStatus('Completá modalidad, categorías LIPA, fecha, horas, valores y valor mesa.', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('imagen', file);
      formData.append('categoria', categoria);
      formData.append('fecha', fecha);
      formData.append('categorias', JSON.stringify(categorias));
      formData.append('valor', categorias[0].valor);
      formData.append('valorMesa', valorMesa);
      formData.append('moneda', moneda);

      setStatus('Guardando torneo…', 'info');
      const resp = await fetch(apiUrl(`/api/sala/torneos/${encodeURIComponent(slot)}`), {
        method: 'POST',
        credentials: 'omit',
        headers: authHeaders(),
        body: formData
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || data.msg || `HTTP ${resp.status}`);
      state.torneos = Array.isArray(data.torneos) ? data.torneos : [];
      state.selectedFiles.clear();
      renderSlots();
      setStatus('Torneo guardado correctamente.', 'ok');
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'No se pudo guardar el torneo.', 'error');
    }
  }

  async function deleteSlot(slot){
    if (!confirm('¿Eliminar esta publicación?')) return;
    try {
      setStatus('Eliminando publicación…', 'info');
      const resp = await fetch(apiUrl(`/api/sala/torneos/${encodeURIComponent(slot)}`), {
        method: 'DELETE',
        credentials: 'omit',
        headers: authHeaders()
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || data.msg || `HTTP ${resp.status}`);
      state.torneos = Array.isArray(data.torneos) ? data.torneos : [];
      state.selectedFiles.clear();
      renderSlots();
      setStatus('Publicación eliminada.', 'ok');
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'No se pudo eliminar la publicación.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setSalaName();
    wirePasswordToggles();
    renderSlots();
    loadTorneos();
    grid?.addEventListener('focusout', (ev) => {
      if (!ev.target.matches('.js-division-valor, .js-valor-mesa')) return;
      const normalized = normalizeDisplayValue(ev.target.value);
      if (normalized) ev.target.value = normalized;
    });
    $('#btnChangePassword')?.addEventListener('click', openPassModal);
    $('#btnCancelPass')?.addEventListener('click', () => $('#passModal')?.close());
    $('#passForm')?.addEventListener('submit', submitPassword);
  });
})();
