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
  const uploadProgressWrap = document.getElementById('uploadProgressWrap');
  const uploadProgress = document.getElementById('uploadProgress');
  const uploadProgressText = document.getElementById('uploadProgressText');
  const uploadProgressPercent = document.getElementById('uploadProgressPercent');
  if (isTiebreak) {
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = 'Subir foto del desempate';
  }
  const REQUIRED_PICTURES = isTiebreak ? 1 : 11;
  const MAX_IMAGE_SIDE = 2200;
  const JPEG_QUALITY = 0.84;
  let uploadAllowed = false;

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

  function setProgress(percent, text = '') {
    const safe = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (uploadProgressWrap) uploadProgressWrap.hidden = false;
    if (uploadProgress) uploadProgress.value = safe;
    if (uploadProgressPercent) uploadProgressPercent.textContent = `${safe}%`;
    if (uploadProgressText && text) uploadProgressText.textContent = text;
  }

  function hideProgress() {
    if (uploadProgressWrap) uploadProgressWrap.hidden = true;
    if (uploadProgress) uploadProgress.value = 0;
    if (uploadProgressPercent) uploadProgressPercent.textContent = '0%';
  }

  function canCompress(file) {
    const type = String(file?.type || '').toLowerCase();
    return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`No se pudo leer ${file.name}.`));
      };
      img.src = url;
    });
  }

  async function compressImage(file) {
    if (!canCompress(file)) return file;
    const img = await loadImage(file);
    const largestSide = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
    const scale = largestSide > MAX_IMAGE_SIDE ? MAX_IMAGE_SIDE / largestSide : 1;
    const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const baseName = String(file.name || 'foto').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  }

  async function prepareFiles(files) {
    const prepared = [];
    for (let index = 0; index < files.length; index += 1) {
      setProgress(Math.round((index / Math.max(files.length, 1)) * 15), `Preparando foto ${index + 1} de ${files.length}…`);
      try {
        prepared.push(await compressImage(files[index]));
      } catch {
        prepared.push(files[index]);
      }
    }
    return prepared;
  }

  function uploadWithProgress(body) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', API_BASE + '/api/pictures/upload');
      xhr.withCredentials = true;
      xhr.timeout = 4 * 60 * 1000;
      const headers = authHeaders();
      Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = 15 + Math.round((event.loaded / event.total) * 84);
        setProgress(percent, `Subiendo fotos… ${Math.min(100, percent)}%`);
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && data?.ok) return resolve(data);
        const detail = data?.error || `El servidor respondió con código ${xhr.status || 'desconocido'}.`;
        const errorId = data?.errorId ? ` Código de seguimiento: ${data.errorId}.` : '';
        reject(new Error(detail + errorId));
      };
      xhr.onerror = () => reject(new Error('Se cortó la conexión durante la carga. Revisá la señal e intentá nuevamente.'));
      xhr.ontimeout = () => reject(new Error('La carga demoró demasiado y fue cancelada. Probá nuevamente con una conexión más estable.'));
      xhr.onabort = () => reject(new Error('La carga fue cancelada antes de finalizar.'));
      xhr.send(body);
    });
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
    uploadAllowed = ok;
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
      setStatus(`Solo podés seleccionar hasta ${REQUIRED_PICTURES} fotos por carga.`, 'error');
      return;
    }

    if (files.length > 0 && files.length < REQUIRED_PICTURES) {
      setStatus(`Seleccionaste ${files.length} fotos. Podés subirlas ahora y completar las faltantes después.`, 'info');
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

    if (files.length > REQUIRED_PICTURES) {
      setStatus(`Solo se permiten ${REQUIRED_PICTURES} fotos por carga.`, 'error');
      return;
    }

    if (!isTiebreak && files.length < REQUIRED_PICTURES) {
      const confirmed = window.confirm(`Usted está subiendo ${files.length} foto${files.length === 1 ? '' : 's'}, pero deben ser 11. ¿Desea continuar con la carga?`);
      if (!confirmed) return;
    }

    const body = new FormData();
    body.append('fechaISO', fechaISO);
    body.append('localSlug', localSlug);
    body.append('visitanteSlug', visitanteSlug);
    body.append('tipo', tipo);
    btnUpload.disabled = true;
    btnChoosePhotos.disabled = true;
    picturesInput.disabled = true;
    setStatus('Preparando las fotos para subir…', 'info');
    setProgress(0, 'Preparando fotos…');

    try {
      const preparedFiles = await prepareFiles(files);
      preparedFiles.forEach((file) => body.append('pictures', file));
      const data = await uploadWithProgress(body);
      setProgress(100, 'Carga finalizada');
      picturesInput.value = '';
      updatePreview();
      pickedFilesText.textContent = 'No se eligió ningún archivo';
      const uploaded = Number(data?.uploadedCount ?? data?.files?.length ?? files.length);
      const total = Number(data?.totalPictures ?? uploaded);
      const duplicateText = Number(data?.duplicatesSkipped || 0) > 0
        ? ` ${data.duplicatesSkipped} foto${data.duplicatesSkipped === 1 ? '' : 's'} repetida${data.duplicatesSkipped === 1 ? '' : 's'} no se duplicaron.`
        : '';
      setStatus(isTiebreak
        ? 'La foto del desempate se subió correctamente.'
        : `${uploaded} foto${uploaded === 1 ? '' : 's'} subida${uploaded === 1 ? '' : 's'} correctamente. Hay ${total} de 11 fotos guardadas.${duplicateText}`,
      'success');
    } catch (err) {
      setStatus(err.message || 'No se pudieron subir las fotos.', 'error');
      setProgress(0, 'La carga no pudo completarse');
    } finally {
      btnUpload.disabled = !uploadAllowed;
      btnChoosePhotos.disabled = !uploadAllowed;
      picturesInput.disabled = !uploadAllowed;
    }
  });

  checkStatus().catch(() => setStatus('No se pudo verificar el estado del cruce.', 'error'));
})();
