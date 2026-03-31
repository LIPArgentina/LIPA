(() => {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || 'https://liga-backend-tt82.onrender.com').replace(/\/+$/, '');
  const dtf = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' });

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

  function normalizeText(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' Y ')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function compactKey(value){
    return normalizeText(value).replace(/[^A-Z0-9]/g, '');
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
    while (arr.length < expected) arr.push('');
    return arr.slice(0, expected);
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

  function makeRow(num, text, side, pointsValue = null){
    const row = document.createElement('div');
    row.className = 'row';

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

    const ptsElement = pointsValue == null
      ? (() => {
          const ghost = document.createElement('div');
          ghost.className = 'pts-edit readonly empty-pts';
          ghost.innerHTML = '<div class="pts-static"></div>';
          return ghost;
        })()
      : createPtsBox(pointsValue);

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

  function renderSideCard(planilla, scoreData, opponent, date, teamName, side){
    const card = document.querySelector('#card-template').content.cloneNode(true).querySelector('.card');
    card.querySelector('.title').textContent = String(teamName || '').toUpperCase();
    const formattedDate = formatDate(date);
    card.querySelector('.meta').textContent = formattedDate ? `vs ${opponent} · ${formattedDate}` : `vs ${opponent}`;

    const scoreRows = Array.isArray(scoreData?.scoreRows) ? scoreData.scoreRows : [];
    const secs = card.querySelector('.sections');
    const data = {
      'CAPITÁN': safeArr(planilla?.capitan, 2),
      'INDIVIDUALES': safeArr(planilla?.individuales, 7),
      'PAREJA 1': safeArr(planilla?.pareja1, 2),
      'PAREJA 2': safeArr(planilla?.pareja2, 2),
      'SUPLENTES': safeArr(planilla?.suplentes, 3)
    };

    ['CAPITÁN', 'INDIVIDUALES', 'PAREJA 1', 'PAREJA 2', 'SUPLENTES'].forEach((section) => {
      const div = document.createElement('div');
      div.className = 'section';
      div.innerHTML = `<h2>${section}</h2>`;

      const items = data[section];
      if (section === 'INDIVIDUALES') {
        items.forEach((name, idx) => {
          div.appendChild(makeRow(idx + 1, name, side, scoreRows[idx] ?? 0));
        });
      } else if (section === 'PAREJA 1') {
        div.appendChild(makeRow(1, items[0], side, scoreRows[7] ?? 0));
        div.appendChild(makeRow(2, items[1], side, scoreRows[8] ?? 0));
      } else if (section === 'PAREJA 2') {
        div.appendChild(makeRow(1, items[0], side, scoreRows[9] ?? 0));
        div.appendChild(makeRow(2, items[1], side, scoreRows[10] ?? 0));
      } else {
        items.forEach((name, idx) => {
          div.appendChild(makeRow(idx + 1, name, side, null));
        });
      }

      secs.appendChild(div);
    });

    const totalInput = card.querySelector('.total-input');
    if (totalInput) totalInput.value = String(Number(scoreData?.triangulosTotales ?? scoreData?.triangulos ?? 0) || 0);

    const winsBox = card.querySelector('.wins-box');
    if (winsBox) winsBox.textContent = String(Number(scoreData?.puntosTotales ?? 0) || 0);

    return card.parentElement;
  }

  function renderEncounter(item, index){
    const node = document.importNode(document.getElementById('encounter-template').content, true);
    node.querySelector('.encounter-title').textContent =
      `${String(item.localName || '').toUpperCase()} VS ${String(item.visitanteName || '').toUpperCase()}`;

    const leftRoot = node.querySelector('.encounter-left');
    const rightRoot = node.querySelector('.encounter-right');

    const leftCard = renderSideCard(
      item.localPlanilla || {},
      item.local || {},
      item.visitanteName || item.visitanteSlug || '',
      item.fechaISO,
      item.localName || item.localSlug || '',
      'left'
    );
    const rightCard = renderSideCard(
      item.visitantePlanilla || {},
      item.visitante || {},
      item.localName || item.localSlug || '',
      item.fechaISO,
      item.visitanteName || item.visitanteSlug || '',
      'right'
    );

    leftRoot.appendChild(leftCard);
    rightRoot.appendChild(rightCard);
    return node;
  }

  async function init(){
    const params = new URLSearchParams(location.search);
    const category = String(params.get('category') || 'segunda').trim().toLowerCase();
    const rawDate = params.get('date') || params.get('fechaISO') || '';
    const rawFecha = params.get('fecha') || '';
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

    const data = await fetchJson(
      apiUrl('/api/cruces/results?fechaISO=' + encodeURIComponent(fechaISO) + '&category=' + encodeURIComponent(category)),
      { cache: 'no-store', credentials: 'same-origin' }
    );

    const container = document.getElementById('resultsContainer');
    container.innerHTML = '';

    const results = Array.isArray(data?.results) ? data.results : [];
    document.getElementById('heroTitle').textContent = results.length
      ? 'Encuentros validados'
      : 'Sin encuentros validados';
    document.getElementById('metaText').textContent = results.length
      ? `${results.length} encuentro${results.length === 1 ? '' : 's'} validado${results.length === 1 ? '' : 's'}`
      : 'Todavía no hay cruces validados para esta fecha.';

    if (!results.length) {
      container.innerHTML = '<div class="empty">Todavía no hay cruces validados para esta fecha.</div>';
      return;
    }

    results.forEach((item, index) => {
      container.appendChild(renderEncounter(item, index));
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
