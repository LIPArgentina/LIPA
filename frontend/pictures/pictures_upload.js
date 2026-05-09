(function(){
  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const qs = new URLSearchParams(location.search);
  const fechaISO = (qs.get('fechaISO') || '').slice(0, 10);
  const localSlug = (qs.get('localSlug') || '').trim().toLowerCase();
  const visitanteSlug = (qs.get('visitanteSlug') || '').trim().toLowerCase();
  const team = (qs.get('team') || '').trim().toLowerCase();
  const tipo = (qs.get('tipo') || '').trim().toLowerCase();
  const isTiebreak = tipo === 'desempate';

  const matchInfo = document.getElementById('matchInfo');
  const statusBox = document.getElementById('statusBox');
  const picturesInput = document.getElementById('picturesInput');
  const btnChoosePhotos = document.getElementById('btnChoosePhotos');
  const pickedFilesText = document.getElementById('pickedFilesText');
  const previewContainer = document.getElementById('previewContainer');
  const btnUpload = document.getElementById('btnUpload');
  const btnVolver = document.getElementById('btnVolver');
  if (isTiebreak) {
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = 'Subir foto del desempate';
  }
  const REQUIRED_PICTURES = isTiebreak ? 1 : 9;

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

  function setStatus(text, type='') {
    statusBox.textContent = text || '';
    statusBox.className = 'status' + (type ? ' ' + type : '');
  }

  function updatePreview() {
    const files = Array.from(picturesInput.files || []);
    previewContainer.innerHTML = '';

    if (!files.length) {
      pickedFilesText.textContent = 'No se eligió ningún archivo';
      return;
    }

    pickedFilesText.textContent = `${files.length} / ${REQUIRED_PICTURES} foto${REQUIRED_PICTURES === 1 ? '' : 's'} seleccionada${files.length === 1 ? '' : 's'}`;

    files.forEach(file => {
      if (!String(file.type || '').startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = document.createElement('img');
        img.className = 'preview-img';
        img.src = event.target?.result || '';
        img.alt = file.name;
        previewContainer.appendChild(img);
      };
      reader.readAsDataURL(file);
    });
  }

  async function checkStatus() {
    matchInfo.textContent = `${isTiebreak ? 'Desempate · ' : ''}Fecha ${fechaISO} · ${localSlug} vs ${visitanteSlug}`;
    if (btnVolver) btnVolver.href = `../cruces/cruces_fecha.html?team=${encodeURIComponent(team)}`;

    const url = new URL(API_BASE + (isTiebreak ? '/api/cruces/tiebreak-lock-status' : '/api/cruces/lock-status'));
    url.searchParams.set('fechaISO', fechaISO);
    url.searchParams.set('equipoSlug', team);
    url.searchParams.set('localSlug', localSlug);
    url.searchParams.set('visitanteSlug', visitanteSlug);

    const res = await fetch(url.toString(), { headers: authHeaders(), credentials: 'include', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data?.ok && (data?.tipo === 'validado' || data?.locked);
    btnUpload.disabled = !ok;
    picturesInput.disabled = !ok;
    btnChoosePhotos.disabled = !ok;
    setStatus(ok ? (isTiebreak ? 'Desempate validado. Ya podés subir la foto.' : 'Cruce validado. Ya podés subir fotos.') : 'Todavía no está habilitada la subida de fotos.', ok ? 'success' : 'error');
  }

  btnChoosePhotos?.addEventListener('click', () => {
    if (!btnChoosePhotos.disabled) picturesInput.click();
  });

  picturesInput?.addEventListener('change', () => {
    const files = Array.from(picturesInput.files || []);
    if (files.length > REQUIRED_PICTURES) {
      picturesInput.value = '';
      previewContainer.innerHTML = '';
      pickedFilesText.textContent = 'No se eligió ningún archivo';
      setStatus(`Solo podés seleccionar ${REQUIRED_PICTURES} fotos exactas.`, 'error');
      return;
    }

    if (files.length > 0 && files.length < REQUIRED_PICTURES) {
      setStatus(`Faltan ${REQUIRED_PICTURES - files.length} foto${REQUIRED_PICTURES - files.length === 1 ? '' : 's'} para completar la carga.`, 'error');
    } else if (files.length === REQUIRED_PICTURES) {
      setStatus('Cantidad correcta de fotos lista para subir.', 'success');
    } else {
      setStatus('');
    }

    updatePreview();
  });

  btnUpload?.addEventListener('click', async () => {
    const files = Array.from(picturesInput.files || []);
    if (!files.length) {
      setStatus(`Tenés que elegir ${REQUIRED_PICTURES} foto${REQUIRED_PICTURES === 1 ? '' : 's'}.`, 'error');
      return;
    }

    if (files.length !== REQUIRED_PICTURES) {
      if (files.length < REQUIRED_PICTURES) {
        setStatus(`Faltan ${REQUIRED_PICTURES - files.length} foto${REQUIRED_PICTURES - files.length === 1 ? '' : 's'} para poder enviar.`, 'error');
      } else {
        setStatus(`Solo se permiten ${REQUIRED_PICTURES} fotos por carga.`, 'error');
      }
      return;
    }

    const body = new FormData();
    body.append('fechaISO', fechaISO);
    body.append('localSlug', localSlug);
    body.append('visitanteSlug', visitanteSlug);
    body.append('tipo', tipo);
    for (const file of files) body.append('pictures', file);

    btnUpload.disabled = true;
    setStatus('Subiendo fotos…');

    try {
      const res = await fetch(API_BASE + '/api/pictures/upload', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'No se pudieron subir las fotos');
      picturesInput.value = '';
      updatePreview();
      pickedFilesText.textContent = 'No se eligió ningún archivo';
      setStatus(isTiebreak ? 'La foto del desempate se subió correctamente.' : 'Las 9 fotos se subieron correctamente.', 'success');
    } catch (err) {
      setStatus(err.message || 'No se pudieron subir las fotos.', 'error');
    } finally {
      btnUpload.disabled = false;
    }
  });

  checkStatus().catch(() => setStatus('No se pudo verificar el estado del cruce.', 'error'));
})();
