(function () {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const SESSION_KEY = 'lpi.session';
  const form = document.getElementById('salaLoginForm');
  const select = document.getElementById('salaSelect');
  const password = document.getElementById('salaPass');
  const toggle = document.getElementById('toggleSalaPass');
  const errorBox = document.getElementById('salaError');
  const checking = document.getElementById('checkingSession');
  let salas = [];

  if (new URLSearchParams(location.search).get('app') === 'true') {
    document.body.classList.add('app-mode');
  }

  function apiUrl(path) { return `${API_BASE}${path}`; }
  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveSession(data, sala) {
    const session = {
      role: 'sala',
      displayName: data.displayName || sala.nombre,
      slug: data.slug || sala.slug,
      salaId: data.salaId || sala.id || null,
      category: 'salas',
      token: data.token || '',
      refreshToken: data.refreshToken || '',
      sessionExpiresAt: data.sessionExpiresAt || '',
      ts: Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem('lpi.lastSalaSlug', session.slug);
    return session;
  }
  function goToAdmin(session) {
    const params = new URLSearchParams();
    if (new URLSearchParams(location.search).get('app') === 'true') params.set('app', 'true');
    if (session.slug) params.set('sala', session.slug);
    location.replace(`./admin_salas.html?${params}`);
  }
  async function sessionIsValid(session) {
    if (session.role !== 'sala' || !session.token) return false;
    try {
      const response = await fetch(apiUrl('/api/sala/torneos'), {
        cache: 'no-store',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${session.token}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  function normalizeSalas(data) {
    const list = Array.isArray(data) ? data : (Array.isArray(data?.salas) ? data.salas : []);
    return list.map(item => ({
      id: item.id || item.salaId || null,
      nombre: item.nombre || item.name || item.sala || '',
      slug: item.slug || item.username || ''
    })).filter(item => item.nombre && item.slug);
  }
  async function loadSalas() {
    const response = await fetch(apiUrl('/api/salas'), { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudieron cargar las salas');
    salas = normalizeSalas(await response.json()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    select.innerHTML = '<option value="">Seleccioná una sala…</option>';
    salas.forEach(sala => {
      const option = document.createElement('option');
      option.value = sala.slug;
      option.textContent = sala.nombre;
      select.appendChild(option);
    });
    const last = localStorage.getItem('lpi.lastSalaSlug');
    if (last && salas.some(sala => sala.slug === last)) select.value = last;
  }
  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
  }
  async function init() {
    const session = readSession();
    if (await sessionIsValid(session)) {
      goToAdmin(session);
      return;
    }
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    checking.hidden = true;
    form.classList.remove('hidden');
    try { await loadSalas(); }
    catch (error) { showError(error.message); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.classList.add('hidden');
    const sala = salas.find(item => item.slug === select.value);
    if (!sala) return showError('Seleccioná una sala válida');
    try {
      const response = await fetch(apiUrl('/api/sala/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: sala.slug, salaId: sala.id, password: password.value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.msg || data.error || 'Sala o contraseña incorrecta');
      goToAdmin(saveSession(data, sala));
    } catch (error) {
      showError(error.message || 'No se pudo iniciar sesión');
    }
  });
  toggle.addEventListener('change', () => { password.type = toggle.checked ? 'text' : 'password'; });
  document.addEventListener('DOMContentLoaded', init);
})();
