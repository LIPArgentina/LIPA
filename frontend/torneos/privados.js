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
  let visibleConfirmed = [];
  let bulkPresenceBusy=false;
  const pendingPresence=new Set();
  const tableSort = {verifiedBody:{key:'date',direction:'desc'},pendingBody:{key:'date',direction:'desc'},inactiveBody:{key:'date',direction:'desc'}};
  const nameCollator = new Intl.Collator('es', {sensitivity:'base',numeric:true});
  let diffusionMessage = '';
  let diffusionMedia=null, diffusionDraft=undefined, diffusionPreviewURL=null, diffusionPreviewRequest=0, preparingBatch=false;
  let batchContacts = window.LipaBatch.collect([]);
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
  function whatsappContact(value, diffusion = false) {
    const base = whatsappHref(value);
    // wa.me redirects can replace non-BMP emojis with U+FFFD. Use the direct endpoint.
    const href = diffusion && base !== '#' ? 'https://web.whatsapp.com/send?phone=' + String(value).replace(/\D/g, '') + '&text=' + encodeURIComponent(diffusionMessage) : base;
    const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l5.3-1.3A9.5 9.5 0 1 0 12 2Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.4 6.8c-.4 0-1.3.8-1.3 2 0 2.8 4.1 6.9 6.9 6.9 1.2 0 2-.9 2-1.3 0-.3-2-1.3-2.3-1.3-.3 0-.8.8-1 .8-.8 0-3.4-2.6-3.4-3.4 0-.2.8-.7.8-1 0-.3-1-2.7-1.7-2.7Z" fill="currentColor"/></svg>';
    if (diffusion) return base === '#'
      ? '<span class="whatsapp-contact diffusion-contact disabled" title="Difusión" aria-label="Difusión sin número">'+icon+'</span>'
      : '<a class="whatsapp-contact diffusion-contact" data-diffusion href="'+escapeHtml(href)+'" target="_blank" rel="noopener noreferrer" aria-label="Difusión" title="Difusión">'+icon+'</a>';
    return href === '#'
      ? '<span class="whatsapp-contact disabled" title="Guardá un número para abrir WhatsApp" aria-label="WhatsApp sin número">'+icon+'</span>'
      : '<a class="whatsapp-contact" href="'+href+'" target="_blank" rel="noopener noreferrer" aria-label="Abrir chat de WhatsApp" title="Abrir WhatsApp">'+icon+'</a>';
  }
  function paymentState(entry) {
    return entry?.estado_pago === '50' ? 'sena' : String(entry?.estado_pago || 'sin_sena');
  }
  function paymentSummary(rows) {
    rows=rows.flatMap(entry=>entry.pagos_categoria?Object.entries(entry.pagos_categoria).filter(([c])=>categoryFilter==='all'||categoryFilter===c).map(([categoria,p])=>({...entry,...p,categoria,pagos_categoria:null})): [entry]);
    const fullAmounts = {tercera:55000, segunda:70000, primera:80000, segunda_tercera:125000, primera_segunda:150000};
    let amount=0, missing=0;
    for(const entry of rows){
      const state=paymentState(entry);
      if(state==='sena'){
        const deposit=Number(entry.monto_sena)||(entry.estado_pago==='50'?50000:0);
        if(Number.isFinite(deposit)&&deposit>0)amount+=deposit;else missing++;
      }else if(state==='total'){
        if(fullAmounts[entry.categoria])amount+=fullAmounts[entry.categoria];else missing++;
      }
    }
    return {amount,missing};
  }
  function normalizeDepositAmount(value) {
    const amount = Number(String(value || '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const normalized = Math.round(amount < 1000 ? amount * 1000 : amount);
    return normalized <= 99999000 ? normalized : null;
  }
  function paymentSelect(entry) {
    if(entry.pagos_categoria)return Object.entries(entry.pagos_categoria).map(([categoria,p])=>`<div><small>${escapeHtml(categoria)}</small>${paymentSelect({...entry,...p,pagos_categoria:null,paymentCategory:categoria})}</div>`).join('');
    const state = paymentState(entry);
    const storedAmount = Number(entry.monto_sena || 0) || (entry.estado_pago === '50' ? 50000 : '');
    const paymentClass = state === 'efectivo' ? 'payment-cash' : state === 'total' ? 'payment-total' : state === 'sena' ? 'payment-deposit' : 'payment-none';
    return `<div class="payment-editor">
      <select class="payment-select ${paymentClass}" data-id="${entry.id}" data-payment-category="${entry.paymentCategory||''}">
        <option value="sin_sena" ${state === 'sin_sena' ? 'selected' : ''}>Sin seña</option>
        <option value="sena" ${state === 'sena' ? 'selected' : ''}>Seña</option>
        <option value="efectivo" ${state === 'efectivo' ? 'selected' : ''}>Efectivo</option>
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
      target.innerHTML = '<tr><td class="empty" colspan="9">No hay inscripciones para mostrar.</td></tr>';
      return;
    }
    const sort=tableSort[target.id];
    const value=entry=>sort.key==='date' ? (Date.parse(entry.created_at)||0) : sort.key==='team' ? (entry.equipo_nombre||'Sin registro') : (verified ? entry.nombre_oficial : entry.nombre_ingresado)||'';
    const ordered=[...rows].sort((a,b)=>{
      const comparison=sort.key==='date' ? value(a)-value(b) : nameCollator.compare(value(a),value(b));
      return (sort.direction==='asc'?comparison:-comparison)||Number(a.id)-Number(b.id);
    });
    for (const entry of ordered) {
      const tr = document.createElement('tr');
      const name = verified ? entry.nombre_oficial : entry.nombre_ingresado;
      tr.innerHTML = `<td><div class="player-name-cell">${playerPhotoButton(entry, name)}<strong>${escapeHtml(name)}</strong></div></td><td class="${entry.equipo_actual ? 'team-current' : 'team-history'}" title="${entry.equipo_nombre ? (entry.equipo_actual ? 'Equipo actual' : 'Último equipo histórico') : 'Sin registro'}">${escapeHtml(entry.equipo_nombre || 'Sin registro')}</td><td>${escapeHtml(entry.dni)}</td><td>${categorySelect(entry)}</td>
        <td><div class="contact-editor"><input class="contact-input" inputmode="tel" value="${escapeHtml(entry.whatsapp || '')}" placeholder="Agregar WhatsApp">${whatsappContact(entry.whatsapp)}${verified ? whatsappContact(entry.whatsapp, true) : ''}<button type="button" data-save-contact="${entry.id}">Guardar</button></div></td>
        <td>${paymentSelect(entry)}</td><td>${dateFormatter.format(new Date(entry.created_at))}</td>
        <td>${entry.baja_at ? `<span class="inactive-date" title="Fecha de baja">Baja: ${dateFormatter.format(new Date(entry.baja_at))}</span><button type="button" class="restore-button" data-restore="${entry.id}">Volver a inscribir</button>` : `<button class="delete-button" data-delete="${entry.id}">Dar de baja</button><button type="button" data-replace="${entry.id}">Reemplazar</button>`}</td>`;
      const presence=tr.insertCell(0);
      presence.innerHTML=`<input class="presence-check" type="checkbox" data-presence="${entry.id}" aria-label="En sala: ${escapeHtml(name)}" ${entry.en_sala?'checked':''}>`;
      [...tr.children].forEach((cell,index)=>cell.dataset.label=['En sala','Jugador','Equipo','DNI','Categoría','WhatsApp','Pago','Inscripción','Acciones'][index]);
      if(entry.baja_at){
        tr.querySelectorAll('select,input').forEach(control=>control.disabled=true);
        tr.querySelectorAll('[data-save-contact],[data-diffusion]').forEach(control=>control.remove());
      }
      target.appendChild(tr);
    }
  }
  document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{
    const table=button.closest('table');
    tableSort[table.querySelector('tbody').id]={key:button.dataset.sort,direction:button.dataset.direction};
    render();
  }));
  function render() {
    document.querySelectorAll('[data-sort-column]').forEach(th=>{
      const sort=tableSort[th.closest('table').querySelector('tbody').id];
      th.setAttribute('aria-sort',sort.key===th.dataset.sortColumn ? (sort.direction==='asc'?'ascending':'descending') : 'none');
      th.querySelectorAll('[data-sort]').forEach(button=>{
        const active=button.dataset.sort===sort.key&&button.dataset.direction===sort.direction;
        button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
      });
    });
    const filtered = entries.filter(item => {
      const paymentMatches = paymentFilter === 'all' || (item.pagos_categoria ? Object.entries(item.pagos_categoria).some(([c,p])=>(categoryFilter==='all'||categoryFilter===c)&&paymentState(p)===paymentFilter) : paymentState(item) === paymentFilter);
      const categoryMatches = categoryFilter === 'all'
        || (categoryFilter === 'sin_definir' ? !item.categoria : window.LipaCategories.matches(item.categoria, categoryFilter));
      return paymentMatches && categoryMatches;
    });
    const normalizeSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const query = normalizeSearch($('#registeredSearch').value);
    const words = query.split(/\s+/).filter(Boolean);
    const dniQuery = query.replace(/[.\s-]/g, '');
    const verified = filtered.filter(item => {
      if (item.baja_at || !item.corroborado) return false;
      const name = normalizeSearch(`${item.nombre_oficial || ''} ${item.nombre_ingresado || ''}`);
      return !query || words.every(word => name.includes(word))
        || (/^\d+$/.test(dniQuery) && String(item.dni || '').replace(/\D/g, '').includes(dniQuery));
    });
    const summary=paymentSummary(verified),totalNode=$('#paymentSum');
    totalNode.textContent='$ '+summary.amount.toLocaleString('es-AR')+(summary.missing?' *':'');
    const explanation='Señas y pagos completos de los jugadores mostrados. No incluye efectivo.'+(summary.missing?' Total parcial: '+summary.missing+' pago(s) sin importe definido.':'');
    totalNode.title=explanation;totalNode.setAttribute('aria-label',totalNode.textContent+'. '+explanation);
    $('#paymentSumNote').hidden=!summary.missing;
    $('#paymentSumNote').textContent=summary.missing?'* Total parcial: faltan definir importes de '+summary.missing+' pago(s).':'';
    batchContacts = window.LipaBatch.collect(verified);
    $('#prepareBatch').textContent = 'Preparar tanda (' + batchContacts.contacts.length + ')';
    $('#prepareBatch').disabled = !batchContacts.contacts.length;
    const pending = filtered.filter(item => !item.baja_at && !item.corroborado);
    const inactive = entries.filter(item=>item.baja_at);
    renderBody($('#inactiveBody'), inactive, true);
    $('#inactiveCount').textContent=String(inactive.length);
    visibleConfirmed = verified;
    renderBody($('#verifiedBody'), visibleConfirmed, true);
    renderBody($('#pendingBody'), pending, false);
    $('#verifiedCount').textContent = String(verified.length);
    $('#pendingCount').textContent = String(pending.length);
    updatePresenceControls();
  }
  function updatePresenceControls(){
    const total=visibleConfirmed.length;
    const present=visibleConfirmed.filter(entry=>entry.en_sala).length;
    const master=$('#allPresent');
    master.checked=total>0 && present===total;
    master.indeterminate=present>0 && present<total;
    master.disabled=bulkPresenceBusy || pendingPresence.size>0 || total===0;
    master.title=present+' de '+total+' jugadores visibles en sala';
    document.querySelectorAll('#verifiedBody [data-presence],#pendingBody [data-presence]').forEach(box=>{
      box.disabled=bulkPresenceBusy || pendingPresence.has(box.dataset.presence);
    });
  }
  async function setAllPresent(enSala){
    if(bulkPresenceBusy || pendingPresence.size)return;
    const targets=visibleConfirmed.filter(entry=>Boolean(entry.en_sala)!==enSala);
    if(!targets.length)return;
    const players=targets.length===1?'1 jugador visible':targets.length+' jugadores visibles';
    const question=enSala?'¿Marcar en sala a '+players+'?':'¿Quitar la marca de asistencia a '+players+'?';
    if(!confirm(question))return;
    bulkPresenceBusy=true;updatePresenceControls();$('#presenceStatus').textContent='Guardando…';
    try{
      const result=await api('/torneo-organizador/inscripciones/presencia-grupal',{method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({enSala,ids:targets.map(entry=>String(entry.id))})});
      const saved=new Set(result.ids);
      for(const entry of entries)if(saved.has(String(entry.id)))entry.en_sala=enSala;
      document.querySelectorAll('[data-presence]').forEach(box=>{if(saved.has(box.dataset.presence))box.checked=enSala;});
      if(saved.size!==targets.length)await load();
      $('#presenceStatus').textContent='Presencia actualizada.';
    }catch(error){$('#presenceStatus').textContent=error.message;}
    finally{bulkPresenceBusy=false;updatePresenceControls();}
  }
  $('#allPresent').onchange=event=>{
    const enSala=event.target.checked;
    updatePresenceControls();
    setAllPresent(enSala);
  };
  $('#registeredSearch').addEventListener('input', render);
  async function mediaBlob(meta){
    const response=await fetch(API+'/api/torneo-organizador/mensaje-difusion/adjunto?hash='+encodeURIComponent(meta.hash),{credentials:'include'});
    if(!response.ok)throw Error('No se pudo cargar el adjunto guardado. Volvé a abrir Mensaje de difusión.');
    const blob=await response.blob();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==meta.hash||blob.size!==meta.size)throw Error('El archivo cambió o no se descargó completo. Reintentá.');return blob;
  }
  async function prepareBatch(contacts,filters){
    if(preparingBatch)return;
    if(!document.documentElement.dataset.lipaBatchExtension){$('#batchInstall').showModal();return;}
    preparingBatch=true;$('#prepareBatch').disabled=true;setMessage('Cargando mensaje y adjunto guardados…');
    try{
      const saved=await api('/torneo-organizador/mensaje-difusion');diffusionMessage=saved.mensaje;diffusionMedia=saved.media;
      if(!diffusionMessage.trim())throw Error('Primero guardá el mensaje de difusión.');
      let media=null;
      if(diffusionMedia){
        if(document.documentElement.dataset.lipaBatchExtension!=='2')throw Error('Recargá la extensión actualizada y esta página para enviar el adjunto guardado.');
        const blob=await mediaBlob(diffusionMedia);const dataURL=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});media={...diffusionMedia,dataURL};
      }
      window.dispatchEvent(new CustomEvent('lipa-prepare-batch',{detail:{message:diffusionMessage,media,contacts,filters,organizer:String(session.torneoOrganizadorId||session.slug||'')}}));
      setMessage('Abriendo revisión del mensaje, adjunto y destinatarios. Todavía no se envió nada.',true);
    }catch(error){setMessage(error.message||'No se pudo preparar la tanda.');}finally{preparingBatch=false;render();}
  }
  $('#prepareBatch').addEventListener('click',()=>{
    const filters=$('#categoryFilter').selectedOptions[0].textContent+' · '+document.querySelector('.filter.active').textContent+' · Búsqueda: '+($('#registeredSearch').value||'Todas');
    prepareBatch(batchContacts.contacts.map(c=>({...c})),filters);
  });
  window.addEventListener('lipa-batch-result',event=>{if(event.detail?.error)setMessage(event.detail.error);});
  $('#closeBatchInstall').addEventListener('click',()=>$('#batchInstall').close());
  async function showDiffusionPreview(){
    const request=++diffusionPreviewRequest;if(diffusionPreviewURL)URL.revokeObjectURL(diffusionPreviewURL);diffusionPreviewURL=null;
    $('#diffusionVisual').replaceChildren();const meta=diffusionDraft===undefined?diffusionMedia:diffusionDraft;
    $('#diffusionPreview').hidden=!meta;$('#diffusionCaption').textContent=$('#diffusionMessage').value;if(!meta)return;
    $('#diffusionFileName').textContent=meta.name+' · '+(meta.size/1048576).toFixed(1)+' MB';
    try{const blob=diffusionDraft instanceof File?diffusionDraft:await mediaBlob(meta);if(request!==diffusionPreviewRequest)return;diffusionPreviewURL=URL.createObjectURL(blob);const el=document.createElement(meta.type.startsWith('video/')?'video':'img');el.src=diffusionPreviewURL;if(el.tagName==='VIDEO')el.controls=true;else el.alt='Vista previa del adjunto';$('#diffusionVisual').append(el);}catch(e){if(request===diffusionPreviewRequest)$('#diffusionStatus').textContent=e.message;}
  }
  async function openDiffusionMessage(){
    try{const saved=await api('/torneo-organizador/mensaje-difusion');diffusionMessage=saved.mensaje;diffusionMedia=saved.media;diffusionDraft=undefined;
      $('#diffusionAttachment').value='';$('#diffusionMessage').value=diffusionMessage;$('#diffusionStatus').textContent='';$('#diffusionModal').showModal();$('#diffusionMessage').focus();showDiffusionPreview();
    }catch(e){setMessage(e.message);}
  }
  $('#diffusionAttachment').addEventListener('change',()=>{const file=$('#diffusionAttachment').files[0];if(!file)return;if(!['image/jpeg','image/png','image/webp','video/mp4','video/webm'].includes(file.type)||!file.size||file.size>16*1024*1024){$('#diffusionStatus').textContent='Elegí JPG, PNG, WebP, MP4 o WebM de hasta 16 MB.';$('#diffusionAttachment').value='';return;}diffusionDraft=file;$('#diffusionStatus').textContent='Adjunto listo para guardar.';showDiffusionPreview();});
  $('#removeDiffusionAttachment').addEventListener('click',()=>{diffusionDraft=null;$('#diffusionAttachment').value='';showDiffusionPreview();});
  $('#diffusionMessage').addEventListener('input',()=>$('#diffusionCaption').textContent=$('#diffusionMessage').value);
  $('#editDiffusion').addEventListener('click', openDiffusionMessage);
  $('#copyDiffusion').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#diffusionMessage').value);
      $('#diffusionStatus').textContent = 'Mensaje copiado con emojis. Podés pegarlo en WhatsApp.';
    } catch (_) {
      $('#diffusionMessage').focus(); $('#diffusionMessage').select();
      $('#diffusionStatus').textContent = 'Copiá el texto seleccionado con Ctrl+C o desde el menú del teléfono.';
    }
  });
  $('#closeDiffusion').addEventListener('click', () => $('#diffusionModal').close());
  document.addEventListener('click', async event => {
    const diffusionLink=event.target.closest('[data-diffusion]');
    if(diffusionLink){
      event.preventDefault();
      const entry=entries.find(item=>String(item.id)===diffusionLink.closest('tr')?.querySelector('[data-category-id]')?.dataset.categoryId);
      if(!entry)return;
      const previewTab=window.open('about:blank','_blank');
      try{
        const saved=await api('/torneo-organizador/mensaje-difusion');diffusionMessage=saved.mensaje;diffusionMedia=saved.media;
        if(!diffusionMessage.trim()){previewTab?.close();await openDiffusionMessage();return;}
        const href='https://web.whatsapp.com/send?phone='+String(entry.whatsapp).replace(/\D/g,'')+'&text='+encodeURIComponent(diffusionMessage);
        if(!previewTab)throw Error('Permití abrir ventanas emergentes para abrir WhatsApp.');
        previewTab.location.href=href;
        if(diffusionMedia)setMessage('WhatsApp Web se abrió con el texto. El enlace directo no carga adjuntos: agregá la imagen o el video en WhatsApp.');
      }catch(e){previewTab?.close();setMessage(e.message);}
      return;
    }
    const emoji = event.target.closest('[data-emoji]');
    if (emoji) {
      const input = $('#diffusionMessage');
      if (input.value.length + emoji.dataset.emoji.length > input.maxLength) return;
      input.setRangeText(emoji.dataset.emoji, input.selectionStart, input.selectionEnd, 'end');
      input.focus();$('#diffusionCaption').textContent=input.value;
    }
  });
  $('#diffusionForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#saveDiffusion'); button.disabled = true;
    $('#diffusionStatus').textContent = 'Guardando…';
    try {
      const body=new FormData();body.append('mensaje',$('#diffusionMessage').value);body.append('mediaMode',diffusionDraft===undefined?'keep':diffusionDraft===null?'remove':'replace');if(diffusionDraft)body.append('archivo',diffusionDraft);
      const data=await api('/torneo-organizador/mensaje-difusion',{method:'PUT',body});
      diffusionMessage = data.mensaje;diffusionMedia=data.media;diffusionDraft=undefined;
      render(); $('#diffusionModal').close();
    } catch (error) { $('#diffusionStatus').textContent = error.message; }
    finally { button.disabled = false; }
  });
  async function load() {
    const data = await api('/torneo-organizador/inscripciones');
    entries = data.inscripciones || [];
    const info = data.organizador || {};
    diffusionMessage = info.mensajeDifusion || '';
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
    const check=event.target.closest('[data-presence]');
    if(check){
      pendingPresence.add(check.dataset.presence);updatePresenceControls();
      try{
        const saved=await api('/torneo-organizador/inscripciones/'+check.dataset.presence+'/presencia',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enSala:check.checked})});
        const entry=entries.find(p=>String(p.id)===check.dataset.presence);
        if(entry)entry.en_sala=saved.en_sala;
        const current=document.querySelector('[data-presence="'+check.dataset.presence+'"]');if(current)current.checked=saved.en_sala;
      }catch(error){check.checked=!check.checked;alert(error.message);await load();}
      finally{pendingPresence.delete(check.dataset.presence);updatePresenceControls();}
      return;
    }
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
      await api(`/torneo-organizador/inscripciones/${select.dataset.id}/pago`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ estadoPago:select.value, montoSena, categoria:select.dataset.paymentCategory }) });
      await load();
    } catch (error) { alert(error.message); await load(); }
  });
  document.addEventListener('click', async event => {
    const replaceButton=event.target.closest('[data-replace]');
    if(replaceButton){
      const source=entries.find(p=>String(p.id)===replaceButton.dataset.replace);
      const dni=prompt('DNI del jugador ya inscripto que ocupará este lugar:');
      if(!dni)return;
      const target=entries.find(p=>!p.baja_at&&String(p.dni)===dni.replace(/\D/g,''));
      if(!target){alert('No se encontró una inscripción activa con ese DNI.');return;}
      if(!confirm(`Reemplazar a ${source.nombre_oficial} por ${target.nombre_oficial} en ${source.categoria}. Se conservan el lugar sorteado, el pago de origen y las otras categorías del reemplazante.`))return;
      replaceButton.disabled=true;
      try{
        const result=await api(`/torneo-organizador/inscripciones/${source.id}/reemplazar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destinoId:String(target.id)})});
        $('#registeredSearch').value=target.nombre_oficial;
        await load();setMessage(`${result.nombre} reemplazó al jugador en ${result.categoria}, posición ${result.position}. Pagos conservados.`,true);
      }catch(error){alert(error.message);replaceButton.disabled=false;}
      return;
    }
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
    const restoreButton = event.target.closest('[data-restore]');
    if(restoreButton){
      restoreButton.disabled=true;
      try {
        await api(`/torneo-organizador/inscripciones/${restoreButton.dataset.restore}/reactivar`, {method:'PATCH'});
        await load();
        setMessage('Jugador reinscripto. Se conservaron su contacto, categoría y pago.',true);
      } catch(error){alert(error.message);restoreButton.disabled=false;}
      return;
    }
    const button = event.target.closest('[data-delete]');
    if (!button || !confirm('¿Dar de baja a este jugador del torneo? Su contacto y los datos de inscripción y pago se conservarán en la lista de bajas.')) return;
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
