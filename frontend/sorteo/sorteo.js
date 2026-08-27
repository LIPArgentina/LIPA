(() => {
  'use strict';
  const API_BASE = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const form = document.querySelector('#raffleForm');
  const nameInput = document.querySelector('#nombre');
  const dniInput = document.querySelector('#dni');
  const submitButton = document.querySelector('#submitButton');
  const message = document.querySelector('#formMessage');
  const termsDialog = document.querySelector('#termsDialog');
  const DEVICE_STORAGE_KEY = 'lipa.sorteo.installationId';

  function generateDeviceId() {
    if (window.crypto?.randomUUID) return `lipa-${window.crypto.randomUUID()}`;
    const random = new Uint32Array(4);
    window.crypto?.getRandomValues?.(random);
    return `lipa-${Date.now().toString(36)}-${Array.from(random, (value) => value.toString(36)).join('-')}`;
  }

  function getDeviceId() {
    try {
      const stored = localStorage.getItem(DEVICE_STORAGE_KEY);
      if (stored) return stored;
    } catch (_) {}

    let deviceId = '';
    try {
      deviceId = String(window.AndroidBridge?.getInstallationId?.() || '').trim();
    } catch (_) {}
    if (!deviceId) deviceId = generateDeviceId();

    try { localStorage.setItem(DEVICE_STORAGE_KEY, deviceId); } catch (_) {}
    return deviceId;
  }

  function showMessage(text, type = '') {
    message.textContent = text || '';
    message.className = `form-message ${type}`.trim();
  }

  dniInput.addEventListener('input', () => {
    dniInput.value = dniInput.value.replace(/\D/g, '').slice(0, 9);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nombre = nameInput.value.trim().replace(/\s+/g, ' ');
    const dni = dniInput.value.replace(/\D/g, '');
    const deviceId = getDeviceId();
    if (nombre.length < 4 || !nombre.includes(' ')) return showMessage('Ingresá tu nombre y apellido.', 'error');
    if (!/^\d{7,9}$/.test(dni)) return showMessage('Ingresá un DNI válido, solo con números.', 'error');

    submitButton.disabled = true;
    submitButton.textContent = 'ENVIANDO…';
    showMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/sorteo/inscripcion`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, dni, deviceId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || 'No se pudo completar la inscripción.');
      showMessage(data.message || (data.alreadyRegistered ? '¡Usted ya estaba registrado!' : '¡Ya estás participando! ¡Mucha suerte!'), 'ok');
      if (!data.alreadyRegistered) form.reset();
    } catch (error) {
      showMessage(error.message || 'No se pudo completar la inscripción. Intentá nuevamente.', 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'ENVIAR';
    }
  });

  document.querySelector('#termsButton').addEventListener('click', () => termsDialog.showModal());
  document.querySelector('#closeTerms').addEventListener('click', () => termsDialog.close());
  document.querySelector('#closeTermsTop').addEventListener('click', () => termsDialog.close());
  termsDialog.addEventListener('click', (event) => {
    if (event.target === termsDialog) termsDialog.close();
  });
})();
