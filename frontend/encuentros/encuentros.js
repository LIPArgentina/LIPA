(() => {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const dtf = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' });

  const photosModal = document.getElementById('photosModal');
  const photosStatus = document.getElementById('photosStatus');
  const photosMainImage = document.getElementById('photosMainImage');
  const photosPager = document.getElementById('photosPager');
  const photosCounter = document.getElementById('photosCounter');
  const photosModalSubtitle = document.getElementById('photosModalSubtitle');
  const btnClosePhotos = document.getElementById('btnClosePhotos');

  let currentPhotos = [];
  let currentPhotoIndex = 0;
  let currentObjectUrl = '';

  function apiUrl(path){
    return API_BASE + path;
  }

  async function fetchJson(url, options){
    const response = await fetch(url, options);
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      throw new Error(data?.error || data?.message || ('HTTP ' + response.status + ' @ ' + url));
    }
    return data;
  }

  function parseISOAsLocal(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDate(iso) {
    const raw = String(iso || '').trim();
    if (!raw) return '';
    const d = parseISOAsLocal(raw);
    if (!d) return raw;
    return dtf.format(d);
  }

  function buildDateKey(val){
    const raw = String(val || '').trim();
    if (!raw) return '';
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function safeArr(value, expected){
    const arr = Array.isArray(value) ? value.map(v => String(v || '').trim()) : [];
    const hasContent = arr.some(Boolean);
    if (!hasContent) return [];
    while (arr.length < expected) arr.push('');
    return arr.slice(0, expected);
  }

  function setPhotosStatus(text, type = ''){
    if (!photosStatus) return;
    photosStatus.textContent = text || '';
    photosStatus.className = 'photos-status' + (type ? ' ' + type : '');
  }

  function revokeCurrentObjectUrl(){
    if (!currentObjectUrl) return;
    try { URL.revokeObjectURL(currentObjectUrl); } catch (_) {}
    currentObjectUrl = '';
  }

  function resetPhotosViewer(){
    currentPhotos = [];
    currentPhotoIndex = 0;
    revokeCurrentObjectUrl();
    if (photosMainImage) {
      photosMainImage.removeAttribute('src');
      photosMainImage.alt = 'Foto del encuentro';
    }
    if (photosPager) photosPager.innerHTML = '';
    if (photosCounter) photosCounter.textContent = '';
    setPhotosStatus('', '');
  }

  async function fetchPhotoBlobUrl(item){
    const url = apiUrl(item.imageUrl || item.url || '');
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error('No se pudo cargar la foto.');
    }
    const blob = await response.blob();
    revokeCurrentObjectUrl();
    currentObjectUrl = URL.createObjectURL(blob);
    return currentObjectUrl;
  }

  async function showPhotoAt(index){
    if (!currentPhotos.length) return;
    const safeIndex = Math.max(0, Math.min(index, currentPhotos.length - 1));
    currentPhotoIndex = safeIndex;

    Array.from(photosPager.querySelectorAll('.photos-page-btn')).forEach((btn, idx) => {
      btn.classList.toggle('active', idx === safeIndex);
    });

    const item = currentPhotos[safeIndex];
    photosCounter.textContent = `Foto ${safeIndex + 1} de ${currentPhotos.length}`;
    setPhotosStatus('Cargando foto…', 'info');

    try {
      const blobUrl = await fetchPhotoBlobUrl(item);
      photosMainImage.src = blobUrl;
      photosMainImage.alt = item.filename || `Foto ${safeIndex + 1}`;
      setPhotosStatus('', '');
    } catch (err) {
      photosMainImage.removeAttribute('src');
      setPhotosStatus(err?.message || 'No se pudo cargar la foto.', 'error');
    }
  }

  function renderPhotosPager(){
    photosPager.innerHTML = '';
    currentPhotos.forEach((_item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'photos-page-btn' + (idx === currentPhotoIndex ? ' active' : '');
      btn.textContent = String(idx + 1);
      btn.addEventListener('click', () => {
        showPhotoAt(idx).catch(console.error);
      });
      photosPager.appendChild(btn);
    });
  }

  function openPhotosModal(){
    photosModal.hidden = false;
    document.body.classList.add('photos-open');
  }

  function closePhotosModal(){
    photosModal.hidden = true;
    document.body.classList.remove('photos-open');
    resetPhotosViewer();
  }

  async function openEncounterPhotos(item){
    resetPhotosViewer();
    openPhotosModal();

    const isTiebreak = String(item?.tipo || '').toLowerCase() === 'desempate';
    const subtitle = [
      isTiebreak ? 'DESEMPATE ·' : '',
      String(item.localName || '').toUpperCase(),
      'vs',
      String(item.visitanteName || '').toUpperCase(),
      '·',
      formatDate(item.fechaISO)
    ].filter(Boolean).join(' ');
    photosModalSubtitle.textContent = subtitle;
    setPhotosStatus('Buscando fotos del encuentro…', 'info');

    const params = new URLSearchParams({
      fechaISO: item.fechaISO || '',
      localSlug: item.localSlug || '',
      visitanteSlug: item.visitanteSlug || ''
    });
    if (isTiebreak) params.set('tipo', 'desempate');

    const url = apiUrl('/api/pictures/match?' + params.toString());

    try {
      const data = await fetchJson(url, { cache: 'no-store', credentials: 'same-origin' });
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) {
        setPhotosStatus('Todavía no hay fotos cargadas para este encuentro.', 'info');
        return;
      }

      currentPhotos = items;
      renderPhotosPager();
      await showPhotoAt(0);
    } catch (err) {
      setPhotosStatus(err?.message || 'No se pudieron cargar las fotos.', 'error');
    }
  }

  function createPtsBox(value){
    const wrap = document.createElement('div');
    wrap.className = 'pts-edit readonly';
    const box = document.createElement('div');
    box.className = 'pts-static';
    box.textContent = String(Number(value) || 0);
    wrap.appendChild(box);
    return wrap;
  }

  function createEmptyPtsBox(){
    const wrap = document.createElement('div');
    wrap.className = 'pts-edit readonly empty-pts';
    const box = document.createElement('div');
    box.className = 'pts-static';
    wrap.appendChild(box);
    return wrap;
  }

  function makeRow(num, text, side, pointsValue = null, sectionKey = ''){
    const row = document.createElement('div');
    row.className = 'row';
    if (sectionKey) row.dataset.section = sectionKey;

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = String(num);

    const slot = document.createElement('div');
    const isEmpty = !text || !String(text).trim();
    slot.className = 'slot' + (isEmpty ? ' is-empty' : '');
    if (!isEmpty) {
      slot.setAttribute('data-full', String(text).trim());
      slot.textContent = String(text).trim();
    }

    const ptsElement = pointsValue == null ? createEmptyPtsBox() : createPtsBox(pointsValue);

    if (side === 'left') {
      row.appendChild(badge);
      row.appendChild(slot);
      row.appendChild(ptsElement);
    } else {
      row.appendChild(ptsElement);
      row.appendChild(slot);
      row.appendChild(badge);
    }

    return row;
  }

  function renderSection(section, items, side, scoreRows){
    const div = document.createElement('div');
    div.className = 'section';
    div.innerHTML = `<h2>${section}</h2>`;

    if (section === 'INDIVIDUALES') {
      items.forEach((name, idx) => {
        div.appendChild(makeRow(idx + 1, name, side, scoreRows[idx] ?? 0, section));
      });
    } else if (section === 'PAREJA 1') {
      div.appendChild(makeRow(1, items[0] || '', side, scoreRows[7] ?? 0, section));
      div.appendChild(makeRow(2, items[1] || '', side, null, section));
    } else if (section === 'PAREJA 2') {
      div.appendChild(makeRow(1, items[0] || '', side, scoreRows[8] ?? 0, section));
      div.appendChild(makeRow(2, items[1] || '', side, null, section));
    } else {
      items.forEach((name, idx) => {
        div.appendChild(makeRow(idx + 1, name, side, null, section));
      });
    }

    return div;
  }


  function renderTiebreakSideCard(item, side){
    const isLeft = side === 'left';
    const name = isLeft ? item.localName : item.visitanteName;
    const opponent = isLeft ? item.visitanteName : item.localName;
    const data = isLeft ? (item.local || {}) : (item.visitante || {});
    const pair = Array.isArray(data.pareja) ? data.pareja : [];
    const puntos = Number(data.puntos || 0);

    const wrap = document.createElement('div');
    wrap.className = 'wrap tiebreak-result-wrap ' + (isLeft ? 'readonly-left' : 'readonly-right');

    const card = document.createElement('div');
    card.className = 'card tiebreak-result-card';

    const title = document.createElement('h2');
    title.className = 'title';
    title.textContent = String(name || '').toUpperCase();

    const meta = document.createElement('div');
    meta.className = 'meta';
    const formattedDate = formatDate(item.fechaISO);
    meta.textContent = formattedDate ? `vs ${opponent} · ${formattedDate}` : `vs ${opponent}`;

    const section = document.createElement('div');
    section.className = 'section tiebreak-result-section';
    section.innerHTML = '<h2>DESEMPATE</h2>';

    pair.slice(0, 2).forEach((player, idx) => {
      section.appendChild(makeRow(idx + 1, player || '', side, null, 'DESEMPATE'));
    });

    const score = document.createElement('div');
    score.className = 'tiebreak-result-score';
    score.textContent = String(puntos);

    card.append(title, meta, section, score);
    wrap.appendChild(card);
    return wrap;
  }

  function renderSideCard(planilla, scoreData, opponent, date, teamName, side){
    const card = document.querySelector('#card-template').content.cloneNode(true).querySelector('.card');
    card.querySelector('.title').textContent = String(teamName || '').toUpperCase();
    const formattedDate = formatDate(date);
    card.querySelector('.meta').textContent = formattedDate ? `vs ${opponent} · ${formattedDate}` : `vs ${opponent}`;
    const hint = card.querySelector('.hint');
    if (hint) hint.remove();

    const scoreRows = Array.isArray(scoreData?.scoreRows) ? scoreData.scoreRows : [];
    const data = {
      'CAPITÁN': safeArr(planilla?.capitan, 2),
      'INDIVIDUALES': safeArr(planilla?.individuales, 7),
      'PAREJA 1': safeArr(planilla?.pareja1, 2),
      'PAREJA 2': safeArr(planilla?.pareja2, 2),
      'SUPLENTES': safeArr(planilla?.suplentes, 3)
    };

    const secs = card.querySelector('.sections');
    ['CAPITÁN', 'INDIVIDUALES', 'PAREJA 1', 'PAREJA 2', 'SUPLENTES'].forEach((section) => {
      const items = data[section] || [];
      if (!items.length) return;
      secs.appendChild(renderSection(section, items, side, scoreRows));
    });

    const totalInput = card.querySelector('.total-input');
    if (totalInput) totalInput.value = String(Number(scoreData?.triangulosTotales ?? scoreData?.triangulos ?? 0) || 0);

    const winsBox = card.querySelector('.wins-box');
    if (winsBox) winsBox.textContent = String(Number(scoreData?.puntosTotales ?? 0) || 0);

    const wrap = card.parentElement;
    wrap.classList.add(side === 'left' ? 'readonly-left' : 'readonly-right');
    return wrap;
  }

  function renderEncounter(item){
    const node = document.importNode(document.getElementById('encounter-template').content, true);
    const isTiebreak = String(item?.tipo || '').toLowerCase() === 'desempate';
    node.querySelector('.encounter-title').textContent =
      `${isTiebreak ? 'DESEMPATE · ' : ''}${String(item.localName || '').toUpperCase()} VS ${String(item.visitanteName || '').toUpperCase()}`;

    const shell = node.querySelector('.encounter-shell');
    if (shell && isTiebreak) shell.classList.add('encounter-tiebreak');

    const photosBtn = node.querySelector('[data-open-photos]');
    if (photosBtn) {
      photosBtn.addEventListener('click', () => {
        openEncounterPhotos(item).catch(console.error);
      });
    }

    const leftRoot = node.querySelector('.encounter-left');
    const rightRoot = node.querySelector('.encounter-right');

    if (isTiebreak) {
      leftRoot.appendChild(renderTiebreakSideCard(item, 'left'));
      rightRoot.appendChild(renderTiebreakSideCard(item, 'right'));
    } else {
      leftRoot.appendChild(
        renderSideCard(
          item.localPlanilla || {},
          item.local || {},
          item.visitanteName || item.visitanteSlug || '',
          item.fechaISO,
          item.localName || item.localSlug || '',
          'left'
        )
      );

      rightRoot.appendChild(
        renderSideCard(
          item.visitantePlanilla || {},
          item.visitante || {},
          item.localName || item.localSlug || '',
          item.fechaISO,
          item.visitanteName || item.visitanteSlug || '',
          'right'
        )
      );
    }

    return node;
  }

  function normalizeFilterTeam(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' Y ')
      .replace(/\b(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)\b/gi, ' ')
      .replace(/[^A-Z0-9]/gi, '')
      .replace(/(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)$/i, '')
      .toUpperCase();
  }

  function resultMatchesTeams(item, localKey, visitanteKey){
    if (!localKey && !visitanteKey) return true;
    const itemLocal = normalizeFilterTeam(item?.localName || item?.localSlug || '');
    const itemVisitante = normalizeFilterTeam(item?.visitanteName || item?.visitanteSlug || '');
    if (localKey && visitanteKey) {
      return (itemLocal === localKey && itemVisitante === visitanteKey) ||
             (itemLocal === visitanteKey && itemVisitante === localKey);
    }
    const only = localKey || visitanteKey;
    return itemLocal === only || itemVisitante === only;
  }

  async function init(){
    const params = new URLSearchParams(location.search);
    const category = String(params.get('category') || 'segunda').trim().toLowerCase();
    const rawDate = params.get('date') || params.get('fechaISO') || '';
    const rawFecha = params.get('fecha') || '';
    const tipoFiltro = String(params.get('tipo') || '').trim().toLowerCase();
    const localFiltro = normalizeFilterTeam(params.get('local') || '');
    const visitanteFiltro = normalizeFilterTeam(params.get('visitante') || '');
    const fechaISO = buildDateKey(rawDate);

    document.getElementById('categoryLabel').textContent = `Categoría ${category.toUpperCase()}`;
    document.getElementById('datePill').textContent = formatDate(fechaISO || rawDate);
    document.getElementById('metaText').textContent = rawFecha
      ? `${rawFecha}ª fecha · cruces validados`
      : 'Resultados validados de la fecha';

    document.getElementById('btnVolver').addEventListener('click', (ev) => {
      ev.preventDefault();
      history.back();
    });

    btnClosePhotos?.addEventListener('click', closePhotosModal);
    photosModal?.addEventListener('click', (ev) => {
      if (ev.target?.matches('[data-close-photos]')) closePhotosModal();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && photosModal && !photosModal.hidden) closePhotosModal();
    });

    const data = await fetchJson(
      apiUrl('/api/cruces/results?fechaISO=' + encodeURIComponent(fechaISO) + '&category=' + encodeURIComponent(category)),
      { cache: 'no-store', credentials: 'same-origin' }
    );

    const container = document.getElementById('resultsContainer');
    container.innerHTML = '';

    let results = Array.isArray(data?.results) ? data.results : [];
    if (tipoFiltro === 'cruce' || tipoFiltro === 'desempate') {
      results = results.filter(item => String(item?.tipo || 'cruce').toLowerCase() === tipoFiltro);
    }
    if (localFiltro || visitanteFiltro) {
      results = results.filter(item => resultMatchesTeams(item, localFiltro, visitanteFiltro));
    }
    document.getElementById('heroTitle').textContent = results.length ? 'Encuentros validados' : 'Sin encuentros validados';
    document.getElementById('metaText').textContent = results.length
      ? `${results.length} encuentro${results.length === 1 ? '' : 's'} validado${results.length === 1 ? '' : 's'}`
      : 'Todavía no hay cruces validados para esta fecha.';

    if (!results.length) {
      container.innerHTML = '<div class="empty">Todavía no hay cruces validados para esta fecha.</div>';
      return;
    }

    results.forEach((item) => {
      container.appendChild(renderEncounter(item));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      console.error(err);
      const errorBox = document.getElementById('appError');
      if (errorBox) {
        errorBox.style.display = 'block';
        errorBox.textContent = err?.message || 'No se pudieron cargar los encuentros.';
      }
    });
  });
})();
