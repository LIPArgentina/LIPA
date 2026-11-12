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
  let categoryFilter = 'all';
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
    box.innerHTML = `<div class="candidate-help">Coincidencias en toda la base. Elegir una es opcional.</div>` + players.map(player =>
      `<button class="candidate-button" type="button" data-candidate-id="${player.id}" data-name="${escapeHtml(player.nombre)}" data-dni="${escapeHtml(player.dni)}"><strong>${escapeHtml(player.nombre)}</strong><span>${player.dni ? `DNI ${escapeHtml(player.dni)}` : 'DNI sin cargar'} · ${player.activo ? 'Activo' : 'Histórico'}</span></button>`
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
  function whatsappContact(value) {
    const href = whatsappHref(value);
    const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l5.3-1.3A9.5 9.5 0 1 0 12 2Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.4 6.8c-.4 0-1.3.8-1.3 2 0 2.8 4.1 6.9 6.9 6.9 1.2 0 2-.9 2-1.3 0-.3-2-1.3-2.3-1.3-.3 0-.8.8-1 .8-.8 0-3.4-2.6-3.4-3.4 0-.2.8-.7.8-1 0-.3-1-2.7-1.7-2.7Z" fill="currentColor"/></svg>';
    return href === '#'
      ? '<span class="whatsapp-contact disabled" title="Guardá un número para abrir WhatsApp" aria-label="WhatsApp sin número">'+icon+'</span>'
      : '<a class="whatsapp-contact" href="'+href+'" target="_blank" rel="noopener noreferrer" aria-label="Abrir chat de WhatsApp" title="Abrir WhatsApp">'+icon+'</a>';
  }
  function paymentState(entry) {
    return entry?.estado_pago === '50' ? 'sena' : String(entry?.estado_pago || 'sin_sena');
  }
  function normalizeDepositAmount(value) {
    const amount = Number(String(value || '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const normalized = Math.round(amount < 1000 ? amount * 1000 : amount);
    return normalized <= 99999000 ? normalized : null;
  }
  function paymentSelect(entry) {
    const state = paymentState(entry);
    const storedAmount = Number(entry.monto_sena || 0) || (entry.estado_pago === '50' ? 50000 : '');
    const paymentClass = state === 'total' ? 'payment-total' : state === 'sena' ? 'payment-deposit' : 'payment-none';
    return `<div class="payment-editor">
      <select class="payment-select ${paymentClass}" data-id="${entry.id}">
        <option value="sin_sena" ${state === 'sin_sena' ? 'selected' : ''}>Sin seña</option>
        <option value="sena" ${state === 'sena' ? 'selected' : ''}>Seña</option>
        <option value="total" ${state === 'total' ? 'selected' : ''}>Pago total</option>
      </select>
      <label class="table-deposit-amount"><span>$</span><input class="payment-amount" data-id="${entry.id}" type="text" inputmode="numeric" maxlength="5" value="${storedAmount}" aria-label="Monto de seña en pesos" ${state === 'sena' ? '' : 'disabled'}></label>
    </div>`;
  }
  function categorySelect(entry) {
    return `<select class="category-select ${entry.categoria ? '' : 'category-missing'}" data-category-id="${entry.id}">
      <option value="" ${entry.categoria ? '' : 'selected'} disabled>Definir categoría</option>
      <option value="primera" ${entry.categoria === 'primera' ? 'selected' : ''}>Primera</option>
      <option value="segunda" ${entry.categoria === 'segunda' ? 'selected' : ''}>Segunda</option>
      <option value="tercera" ${entry.categoria === 'tercera' ? 'selected' : ''}>Tercera</option>
      <option value="segunda_tercera" ${entry.categoria === 'segunda_tercera' ? 'selected' : ''}>Segunda + Tercera</option>
      <option value="primera_segunda" ${entry.categoria === 'primera_segunda' ? 'selected' : ''}>Primera + Segunda</option>
    </select>`;
  }
  function playerPhotoButton(entry, name) {
    const hasPhoto = Boolean(entry.foto_path);
    return `<button class="photo-icon" type="button" data-photo-name="${escapeHtml(name)}" data-photo-path="${escapeHtml(entry.foto_path || '')}" aria-label="${hasPhoto ? 'Ver' : 'Sin'} foto de ${escapeHtml(name)}" title="${hasPhoto ? 'Ver foto' : 'Sin foto cargada'}" ${hasPhoto ? '' : 'disabled'}>📷</button>`;
  }
  function renderBody(target, rows, verified) {
    target.innerHTML = '';
    if (!rows.length) {
      target.innerHTML = '<tr><td class="empty" colspan="7">No hay inscripciones para mostrar.</td></tr>';
      return;
    }
    for (const entry of rows) {
      const tr = document.createElement('tr');
      const name = verified ? entry.nombre_oficial : entry.nombre_ingresado;
      tr.innerHTML = `<td><div class="player-name-cell">${playerPhotoButton(entry, name)}<strong>${escapeHtml(name)}</strong></div></td><td>${escapeHtml(entry.dni)}</td><td>${categorySelect(entry)}</td>
        <td><div class="contact-editor"><input class="contact-input" inputmode="tel" value="${escapeHtml(entry.whatsapp || '')}" placeholder="Agregar WhatsApp">${whatsappContact(entry.whatsapp)}<button type="button" data-save-contact="${entry.id}">Guardar</button></div></td>
        <td>${paymentSelect(entry)}</td><td>${dateFormatter.format(new Date(entry.created_at))}</td>
        <td><button class="delete-button" data-delete="${entry.id}">Quitar</button></td>`;
      target.appendChild(tr);
    }
  }
  function render() {
    const filtered = entries.filter(item => {
      const paymentMatches = paymentFilter === 'all' || paymentState(item) === paymentFilter;
      const categoryMatches = categoryFilter === 'all'
        || (categoryFilter === 'sin_definir' ? !item.categoria : window.LipaCategories.matches(item.categoria, categoryFilter));
      return paymentMatches && categoryMatches;
    });
    const normalizeSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const query = normalizeSearch($('#registeredSearch').value);
    const words = query.split(/\s+/).filter(Boolean);
    const dniQuery = query.replace(/[.\s-]/g, '');
    const verified = filtered.filter(item => {
      if (!item.corroborado) return false;
      const name = normalizeSearch(`${item.nombre_oficial || ''} ${item.nombre_ingresado || ''}`);
      return !query || words.every(word => name.includes(word))
        || (/^\d+$/.test(dniQuery) && String(item.dni || '').replace(/\D/g, '').includes(dniQuery));
    });
    const pending = filtered.filter(item => !item.corroborado);
    renderBody($('#verifiedBody'), verified, true);
    renderBody($('#pendingBody'), pending, false);
    $('#verifiedCount').textContent = String(verified.length);
    $('#pendingCount').textContent = String(pending.length);
  }
  $('#registeredSearch').addEventListener('input', render);
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
  $('#refreshPending').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Revisando…';
    try {
      const data = await api('/torneo-organizador/inscripciones/revisar-pendientes', { method: 'POST' });
      const count = Number(data.actualizadas || 0);
      setMessage(count
        ? `${count} ${count === 1 ? 'inscripción actualizada' : 'inscripciones actualizadas'} desde la base.`
        : 'No se encontraron nuevas coincidencias por DNI.', true);
      await load();
    } catch (error) {
      setMessage(error.message || 'No se pudieron revisar los pendientes.');
    } finally {
      button.disabled = false;
      button.textContent = 'Revisar pendientes';
    }
  });
  async function saveRegistration(payload, confirmed = false) {
    try {
      const data = await api('/torneo-organizador/inscripciones', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      if (data.requiresConfirmation && !confirmed) {
        pendingSubmit = payload;
        $('#pendingModal').showModal();
        return;
      }
      $('#registrationForm').reset();
      syncDepositAmount();
      setMessage(payload.listaEspera ? 'Jugador agregado a la lista de espera, en pendientes de revisión.' : data.corroborado ? `Inscripción confirmada como ${data.inscripcion.nombre_oficial}.` : 'Inscripción guardada en la lista provisoria.', true);
      await load();
    } catch (error) { setMessage(error.message); }
  }
  $('#registrationForm').addEventListener('submit', event => {
    event.preventDefault();
    const payment = new FormData(event.currentTarget).get('payment');
    const montoSena = payment === 'sena' ? normalizeDepositAmount($('#depositAmount').value) : null;
    if (payment === 'sena' && montoSena === null) {
      setMessage('Ingresá el monto. Podés escribir 10000 o usar el atajo 10 para $10.000.');
      $('#depositAmount').focus();
      return;
    }
    saveRegistration({ nombre: $('#playerName').value.trim(), dni: $('#playerDni').value, whatsapp: $('#playerWhatsapp').value, estadoPago: payment, montoSena, listaEspera: event.submitter?.id === 'addWaiting' });
  });
  function syncDepositAmount() {
    const selected = document.querySelector('input[name="payment"]:checked')?.value;
    const input = $('#depositAmount');
    input.disabled = selected !== 'sena';
    if (input.disabled) input.value = '';
  }
  document.querySelectorAll('input[name="payment"]').forEach(radio => radio.addEventListener('change', () => {
    syncDepositAmount();
    if (radio.checked && radio.value === 'sena') $('#depositAmount').focus();
  }));
  document.addEventListener('input', event => {
    if (!event.target.matches('#depositAmount, .payment-amount')) return;
    event.target.value = String(event.target.value || '').replace(/\D/g, '').slice(0, 5);
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
    if (button.dataset.dni) $('#playerDni').value = button.dataset.dni;
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
    const category = event.target.closest('.category-select');
    if (category) {
      try {
        await api(`/torneo-organizador/inscripciones/${category.dataset.categoryId}/categoria`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ categoria:category.value }) });
        await load();
      } catch (error) { alert(error.message); await load(); }
      return;
    }
    const paymentControl = event.target.closest('.payment-select, .payment-amount');
    if (!paymentControl) return;
    const editor = paymentControl.closest('.payment-editor');
    const select = editor.querySelector('.payment-select');
    const amountInput = editor.querySelector('.payment-amount');
    if (paymentControl.matches('.payment-select') && select.value === 'sena') {
      amountInput.disabled = false;
      amountInput.focus();
      return;
    }
    const montoSena = select.value === 'sena' ? normalizeDepositAmount(amountInput.value) : null;
    if (select.value === 'sena' && montoSena === null) {
      alert('Ingresá el monto. Podés escribir 10000 o usar el atajo 10 para $10.000.');
      amountInput.focus();
      return;
    }
    try {
      await api(`/torneo-organizador/inscripciones/${select.dataset.id}/pago`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ estadoPago:select.value, montoSena }) });
      await load();
    } catch (error) { alert(error.message); await load(); }
  });
  document.addEventListener('click', async event => {
    const photoButton = event.target.closest('[data-photo-path]');
    if (photoButton && photoButton.dataset.photoPath) {
      $('#photoName').textContent = photoButton.dataset.photoName || 'Foto del jugador';
      $('#playerPhoto').src = `${API}/api/players-admin/photo/${encodeURIComponent(photoButton.dataset.photoPath)}`;
      $('#playerPhoto').alt = `Foto de ${photoButton.dataset.photoName || 'jugador'}`;
      $('#photoModal').showModal();
      return;
    }
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
  $('#categoryFilter').addEventListener('change', event => {
    categoryFilter = event.target.value;
    render();
  });

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
  $('#closePhoto').addEventListener('click', () => $('#photoModal').close());
  $('#photoModal').addEventListener('click', event => { if (event.target === $('#photoModal')) $('#photoModal').close(); });
  load().catch(error => { setMessage(error.message); });
})();
