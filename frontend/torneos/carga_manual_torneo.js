(() => {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const SESSION_KEY = 'lpi.session';
  const $ = (s) => document.querySelector(s);

  const salaSelect = $('#salaSelect');
  const overwriteSlot = $('#overwriteSlot');
  const fullBox = $('#fullBox');
  const imageInput = $('#imageInput');
  const mediaBox = $('#mediaBox');
  const categoriaInput = $('#categoriaInput');
  const estiloInput = $('#estiloInput');
  const fechaInput = $('#fechaInput');
  const valorMesaInput = $('#valorMesaInput');
  const divisionDetails = $('#divisionDetails');
  const monedaSelect = $('#monedaSelect');
  const btnGuardar = $('#btnGuardar');
  const statusBox = $('#statusBox');

  const state = {
    salas: [],
    torneos: [],
    file: null
  };

  function apiUrl(path){ return `${API_BASE}${path}`; }

  function normalizeDisplayValue(value){
    const n = Number(String(value || '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return '';
    return String(Math.round(n > 0 && n < 1000 ? n * 1000 : n));
  }

  function renderDivisionDetails(){
    const selected = [...document.querySelectorAll('.js-division:checked')].map(el => el.value);
    divisionDetails.innerHTML = selected.map((division) => `
      <div class="division-detail" data-division="${division}">
        <strong>${division}</strong>
        <label>Hora<input class="js-division-hora" type="time" aria-label="Hora ${division}"></label>
        <label>Valor<input class="js-division-valor" type="number" min="0" step="any" inputmode="decimal" placeholder="10 = 10.000" aria-label="Valor ${division}"></label>
      </div>`).join('');
  }

  function collectCategorias(){
    return [...divisionDetails.querySelectorAll('.division-detail')].map((row) => ({
      categoria: row.dataset.division,
      hora: row.querySelector('.js-division-hora')?.value || '',
      valor: normalizeDisplayValue(row.querySelector('.js-division-valor')?.value),
      moneda: monedaSelect.value || 'ARS'
    }));
  }

  function readSession(){
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function getToken(){
    const params = new URLSearchParams(location.search);
    return params.get('token') || readSession().token || '';
  }

  function authHeaders(){
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
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
    if (!value) return 'Sin fecha';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Sin fecha';
    return d.toLocaleString('es-AR', { dateStyle:'medium', timeStyle:'short' });
  }

  function formatValor(valor, moneda){
    const n = Number(valor || 0);
    const prefix = moneda === 'USD' ? 'USD' : '$';
    return `${prefix} ${n.toLocaleString('es-AR')}`;
  }

  function getSelectedSalaId(){
    const n = Number(salaSelect.value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function ensureAdminSession(){
    const sess = readSession();
    const role = String(sess?.role || '').toLowerCase();

    if (role !== 'admin' || !getToken()) {
      setStatus('No hay sesión admin válida. Volvé a ingresar como admin.', 'error');
      return false;
    }

    return true;
  }

  async function loadSalas(){
    try {
      setStatus('Cargando salas…', 'info');

      const resp = await fetch(apiUrl('/api/salas'), {
        cache:'no-store',
        credentials:'include',
        headers: authHeaders()
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`);

      state.salas = Array.isArray(data.salas) ? data.salas : [];
      salaSelect.innerHTML = '<option value="">Seleccionar sala...</option>';

      state.salas
        .filter(s => s && s.id && s.nombre)
        .sort((a,b) => String(a.nombre).localeCompare(String(b.nombre), 'es'))
        .forEach((sala) => {
          const opt = document.createElement('option');
          opt.value = sala.id;
          opt.textContent = sala.nombre;
          salaSelect.appendChild(opt);
        });

      setStatus('', 'info');
    } catch (err) {
      console.error(err);
      salaSelect.innerHTML = '<option value="">No se pudieron cargar salas</option>';
      setStatus(err?.message || 'No se pudieron cargar las salas.', 'error');
    }
  }

  async function loadSalaTorneos(){
    const salaId = getSelectedSalaId();
    state.torneos = [];
    overwriteSlot.innerHTML = '';
    fullBox.hidden = true;

    if (!salaId) return;
    if (!ensureAdminSession()) return;

    try {
      setStatus('Cargando publicaciones de la sala…', 'info');

      const resp = await fetch(apiUrl(`/api/admin/sala-torneos/${encodeURIComponent(salaId)}`), {
        cache:'no-store',
        credentials:'include',
        headers: authHeaders()
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || data.msg || `HTTP ${resp.status}`);

      state.torneos = Array.isArray(data.torneos) ? data.torneos : [];
      renderOverwriteOptions();
      setStatus('', 'info');
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'No se pudieron cargar las publicaciones de la sala.', 'error');
    }
  }

  function renderOverwriteOptions(){
    overwriteSlot.innerHTML = '';

    const hasSix = state.torneos.length >= 6;
    fullBox.hidden = !hasSix;

    if (!hasSix) return;

    state.torneos
      .slice()
      .sort((a,b) => Number(a.slot || 0) - Number(b.slot || 0))
      .forEach((torneo) => {
        const opt = document.createElement('option');
        opt.value = torneo.slot;
        opt.textContent = `${torneo.slot}. ${torneo.categoria || 'Sin categoría'} - ${formatDateTime(torneo.fechaHora)} - ${formatValor(torneo.valor, torneo.moneda)}`;
        overwriteSlot.appendChild(opt);
      });
  }

  function getUploadSlot(){
    if (state.torneos.length >= 6) {
      const chosen = Number(overwriteSlot.value);
      return Number.isFinite(chosen) && chosen >= 1 && chosen <= 6 ? chosen : null;
    }

    const used = new Set(state.torneos.map(t => Number(t.slot)));
    for (let i = 1; i <= 6; i++) {
      if (!used.has(i)) return i;
    }
    return 6;
  }

  function renderPreview(){
    const old = mediaBox.querySelector('img');
    old?.remove();

    const empty = mediaBox.querySelector('.torneo-slot__empty');
    if (!state.file) {
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    const img = document.createElement('img');
    img.alt = 'Vista previa torneo';
    img.src = URL.createObjectURL(state.file);
    mediaBox.insertBefore(img, imageInput);
  }

  async function guardar(){
    const salaId = getSelectedSalaId();
    const slot = getUploadSlot();

    if (!ensureAdminSession()) return;

    if (!salaId) {
      setStatus('Seleccioná una sala.', 'error');
      return;
    }

    if (!slot) {
      setStatus('Elegí el recuadro a sobreescribir.', 'error');
      return;
    }

    if (!state.file) {
      setStatus('Seleccioná una imagen o GIF.', 'error');
      return;
    }

    const categoria = categoriaInput.value.trim();
    const estilo = estiloInput.value.trim();
    const fecha = fechaInput.value;
    const categorias = collectCategorias();
    const valorMesa = normalizeDisplayValue(valorMesaInput.value);
    const moneda = monedaSelect.value || 'ARS';

    if (!categoria || !estilo || !fecha || !categorias.length || categorias.some(item => !item.hora || !item.valor) || !valorMesa) {
      setStatus('Completá modalidad, categorías LIPA, fecha, hora, valores y valor mesa.', 'error');
      return;
    }

    if (state.torneos.length >= 6) {
      const ok = confirm(`La sala ya tiene 6 publicaciones. ¿Querés sobreescribir el recuadro ${slot}?`);
      if (!ok) return;
    }

    const formData = new FormData();
    formData.append('imagen', state.file);
    formData.append('categoria', categoria);
    formData.append('estilo', estilo);
    formData.append('fecha', fecha);
    formData.append('categorias', JSON.stringify(categorias));
    formData.append('valor', categorias[0].valor);
    formData.append('valorMesa', valorMesa);
    formData.append('moneda', moneda);

    try {
      btnGuardar.disabled = true;
      setStatus('Guardando carga manual…', 'info');

      const resp = await fetch(apiUrl(`/api/admin/sala-torneos/${encodeURIComponent(salaId)}/${encodeURIComponent(slot)}`), {
        method:'POST',
        credentials:'include',
        headers: authHeaders(),
        body: formData
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || data.msg || `HTTP ${resp.status}`);

      state.torneos = Array.isArray(data.torneos) ? data.torneos : [];
      state.file = null;
      imageInput.value = '';
      renderPreview();
      renderOverwriteOptions();
      setStatus('Torneo cargado correctamente.', 'ok');

      categoriaInput.value = '';
      estiloInput.value = '';
      fechaInput.value = '';
      valorMesaInput.value = '';
      monedaSelect.value = 'ARS';
      document.querySelectorAll('.js-division').forEach(el => { el.checked = false; });
      renderDivisionDetails();
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'No se pudo guardar la carga manual.', 'error');
    } finally {
      btnGuardar.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!ensureAdminSession()) {
      btnGuardar.disabled = true;
    }

    loadSalas();

    salaSelect.addEventListener('change', loadSalaTorneos);
    document.querySelectorAll('.js-division').forEach(el => el.addEventListener('change', renderDivisionDetails));
    document.addEventListener('focusout', (ev) => {
      if (!ev.target.matches('.js-division-valor, #valorMesaInput')) return;
      const normalized = normalizeDisplayValue(ev.target.value);
      if (normalized) ev.target.value = normalized;
    });
    imageInput.addEventListener('change', () => {
      state.file = imageInput.files?.[0] || null;
      renderPreview();
    });
    btnGuardar.addEventListener('click', guardar);
  });
})();
