(() => {
  'use strict';
  const API = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  let session = window.LPI_AUTH?.readSession?.();
  if (!session || session.role !== 'torneo') {
    location.replace(`/auth/login.html?return=${encodeURIComponent(location.pathname)}`);
    return;
  }

  const $ = selector => document.querySelector(selector);
  let entries = [];
  let paymentFilter = 'all';
  let pendingSubmit = null;
  let candidateTimer = null;
  let candidateRequest = 0;
  const dateFormatter = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }
  function setMessage(text, ok = false) {
    const node = $('#formMessage'); node.textContent = text || ''; node.classList.toggle('ok', ok);
  }
  function hideCandidates() {
    const box = $('#candidateBox');
    box.hidden = true;
    box.innerHTML = '';
  }
  function renderCandidates(players) {
    const box = $('#candidateBox');
    if (!players.length) { hideCandidates(); return; }
    box.innerHTML = `<div class="candidate-help">Coincidencias en la base. Elegir una es opcional.</div>` + players.map(player =>
      `<button class="candidate-button" type="button" data-candidate-id="${player.id}" data-name="${escapeHtml(player.nombre)}" data-dni="${escapeHtml(player.dni)}"><strong>${escapeHtml(player.nombre)}</strong><span>DNI ${escapeHtml(player.dni)}</span></button>`
    ).join('');
    box.hidden = false;
  }
  function scheduleCandidateSearch() {
    clearTimeout(candidateTimer);
    const name = $('#playerName').value.trim();
    const dni = $('#playerDni').value.replace(/\D/g, '');
    const query = dni.length >= 2 ? dni : name;
    if (query.length < 2) { hideCandidates(); return; }
    candidateTimer = setTimeout(async () => {
      const request = ++candidateRequest;
      try {
        const data = await api(`/torneo-organizador/jugadores?q=${encodeURIComponent(query)}`);
        if (request === candidateRequest) renderCandidates(data.jugadores || []);
      } catch (_) {
        if (request === candidateRequest) hideCandidates();
      }
    }, 220);
  }
  async function api(path, options = {}) {
    const response = await fetch(`${API}/api${path}`, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || data.msg || `HTTP ${response.status}`), { status: response.status });
    return data;
  }
  function whatsappHref(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits ? `https://wa.me/${digits}` : '#';
  }
  function paymentSelect(entry) {
    const paymentClass = entry.estado_pago === 'total' ? 'payment-total' : entry.estado_pago === '50' ? 'payment-half' : 'payment-none';
    return `<select class="payment-select ${paymentClass}" data-id="${entry.id}">
      <option value="sin_sena" ${entry.estado_pago === 'sin_sena' ? 'selected' : ''}>Sin seña</option>
      <option value="50" ${entry.estado_pago === '50' ? 'selected' : ''}>50% de seña</option>
      <option value="total" ${entry.estado_pago === 'total' ? 'selected' : ''}>Pago total</option>
    </select>`;
  }
  function renderBody(target, rows, verified) {
    target.innerHTML = '';
    if (!rows.length) {
      target.innerHTML = '<tr><td class="empty" colspan="6">No hay inscripciones para mostrar.</td></tr>';
      return;
    }
    for (const entry of rows) {
      const tr = document.createElement('tr');
      const name = verified ? entry.nombre_oficial : entry.nombre_ingresado;
      tr.innerHTML = `<td><strong>${escapeHtml(name)}</strong></td><td>${escapeHtml(entry.dni)}</td>
        <td><div class="contact-editor"><input class="contact-input" inputmode="tel" value="${escapeHtml(entry.whatsapp || '')}" placeholder="Agregar WhatsApp"><button type="button" data-save-contact="${entry.id}">Guardar</button></div></td>
        <td>${paymentSelect(entry)}</td><td>${dateFormatter.format(new Date(entry.created_at))}</td>
        <td><button class="delete-button" data-delete="${entry.id}">Quitar</button></td>`;
      target.appendChild(tr);
    }
  }
  function render() {
    const filtered = entries.filter(item => paymentFilter === 'all' || item.estado_pago === paymentFilter);
    const verified = filtered.filter(item => item.corroborado);
    const pending = filtered.filter(item => !item.corroborado);
    renderBody($('#verifiedBody'), verified, true);
    renderBody($('#pendingBody'), pending, false);
    $('#verifiedCount').textContent = String(verified.length);
    $('#pendingCount').textContent = String(pending.length);
  }
  async function load() {
    const data = await api('/torneo-organizador/inscripciones');
    entries = data.inscripciones || [];
    const info = data.organizador || {};
    $('#promotionalName').textContent = info.nombrePromocional || session.displayName || 'Inscripciones';
    $('#organizerName').textContent = info.nombreOrganizador || '—';
    $('#organizerWhatsapp').href = whatsappHref(info.whatsapp);
    $('#organizerWhatsapp').hidden = !info.whatsapp;
    $('#organizerLocation').href = info.ubicacion || '#';
    $('#organizerLocation').hidden = !info.ubicacion;
    render();
    if (info.mustChangePassword || session.mustChangePassword) openPassword(true);
  }
  async function saveRegistration(payload, confirmed = false) {
    try {
      const data = await api('/torneo-organizador/inscripciones', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      if (data.requiresConfirmation && !confirmed) {
        pendingSubmit = payload;
        $('#pendingModal').showModal();
        return;
      }
      $('#registrationForm').reset();
      setMessage(data.corroborado ? `Inscripción confirmada como ${data.inscripcion.nombre_oficial}.` : 'Inscripción guardada en la lista provisoria.', true);
      await load();
    } catch (error) { setMessage(error.message); }
  }
  $('#registrationForm').addEventListener('submit', event => {
    event.preventDefault();
    const payment = new FormData(event.currentTarget).get('payment');
    saveRegistration({ nombre: $('#playerName').value.trim(), dni: $('#playerDni').value, whatsapp: $('#playerWhatsapp').value, estadoPago: payment });
  });
  $('#playerName').addEventListener('input', scheduleCandidateSearch);
  $('#playerDni').addEventListener('input', scheduleCandidateSearch);
  $('#pasteWhatsapp').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = String(text || '').trim();
      const normalized = `${trimmed.startsWith('+') ? '+' : ''}${trimmed.replace(/\D/g, '')}`;
      if (!normalized || normalized === '+') throw new Error('El portapapeles no contiene un número.');
      $('#playerWhatsapp').value = normalized;
      $('#playerWhatsapp').focus();
      setMessage('WhatsApp pegado.', true);
    } catch (error) {
      setMessage(error?.message || 'El navegador no permitió leer el portapapeles.');
    }
  });
  $('#candidateBox').addEventListener('click', event => {
    const button = event.target.closest('[data-candidate-id]');
    if (!button) return;
    $('#playerName').value = button.dataset.name || '';
    $('#playerDni').value = button.dataset.dni || '';
    hideCandidates();
    $('#playerWhatsapp').focus();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#candidateBox, #playerName, #playerDni')) hideCandidates();
  });
  $('#confirmPending').addEventListener('click', async () => {
    $('#pendingModal').close();
    const payload = pendingSubmit; pendingSubmit = null;
    if (payload) await saveRegistration({ ...payload, confirmProvisional: true }, true);
  });
  $('#cancelPending').addEventListener('click', () => { pendingSubmit = null; $('#pendingModal').close(); });
  document.addEventListener('change', async event => {
    const select = event.target.closest('.payment-select');
    if (!select) return;
    try {
      await api(`/torneo-organizador/inscripciones/${select.dataset.id}/pago`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ estadoPago:select.value }) });
      await load();
    } catch (error) { alert(error.message); await load(); }
  });
  document.addEventListener('click', async event => {
    const contactButton = event.target.closest('[data-save-contact]');
    if (contactButton) {
      const row = contactButton.closest('tr');
      const input = row?.querySelector('.contact-input');
      try {
        await api(`/torneo-organizador/inscripciones/${contactButton.dataset.saveContact}/contacto`, {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ whatsapp:input?.value || '' })
        });
        contactButton.textContent = 'Guardado';
        setTimeout(() => { contactButton.textContent = 'Guardar'; }, 1200);
        await load();
      } catch (error) { alert(error.message); }
      return;
    }
    const button = event.target.closest('[data-delete]');
    if (!button || !confirm('¿Quitar esta inscripción?')) return;
    try { await api(`/torneo-organizador/inscripciones/${button.dataset.delete}`, { method:'DELETE' }); await load(); }
    catch (error) { alert(error.message); }
  });
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
    paymentFilter = button.dataset.payment;
    document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button));
    render();
  }));

  const passwordModal = $('#passwordModal');
  let passwordRequired = false;
  function openPassword(required = false) {
    passwordRequired = required;
    $('#passwordRequirement').hidden = !required;
    $('#cancelPassword').hidden = required;
    $('#passwordMessage').textContent = '';
    passwordModal.showModal();
  }
  $('#btnPassword').addEventListener('click', () => openPassword(false));
  $('#cancelPassword').addEventListener('click', () => { if (!passwordRequired) passwordModal.close(); });
  $('#passwordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const next = $('#newPassword').value;
    if (next !== $('#repeatPassword').value) { $('#passwordMessage').textContent = 'Las contraseñas no coinciden.'; return; }
    try {
      await api('/torneo-organizador/change-password', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ oldPassword:$('#oldPassword').value, newPassword:next }) });
      const updated = { ...session, mustChangePassword:false };
      session = updated;
      localStorage.setItem('lpi.session', JSON.stringify(updated));
      passwordRequired = false; passwordModal.close();
    } catch (error) { $('#passwordMessage').textContent = error.message; }
  });
  passwordModal.addEventListener('cancel', event => { if (passwordRequired) event.preventDefault(); });
  $('#btnLogout').addEventListener('click', () => window.LPI_AUTH?.logout?.({ redirect:true }));
  load().catch(error => { setMessage(error.message); });
})();
