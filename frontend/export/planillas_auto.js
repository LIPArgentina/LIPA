const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
const CATEGORY_KEYS = {
  tercera: '__categoria_tercera__',
  segunda: '__categoria_segunda__'
};

const TEAM_ALIASES = {
  DOGOSBILLARDS: ['DOGOS BILLARDS', 'DOGOSBILLARDS'],
  PRBAR: ['PR BAR', 'PRBAR'],
  DUCKHUNTER: ['DUCK HUNTER', 'DUCK HUNTERS', 'DUCKHUNTER', 'DUCKHUNTERS'],
  CHUAVECHITO: ['CHUAVECHITO'],
  IMPERIOSUR: ['IMPERIO SUR', 'IMPERIOSUR'],
  BAIRES: ['BAIRES'],
  LOSPATOSDELTREBOL: ['LOS PATOS DEL TREBOL', 'LOSPATOSDELTREBOL'],
  ELTREBOLDEPACHECO: ['EL TREBOL DE PACHECO', 'ELTREBOLDEPACHECO']
};

const state = {
  category: 'tercera',
  allPlanillas: [],
  completeSheets: []
};

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');
const statusDot = $('#statusDot');
const statusText = $('#statusText');
const statusMeta = $('#statusMeta');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setStatus(kind, text, meta){
  statusDot.className = 'status-dot ' + (kind || '');
  statusText.textContent = text || '';
  statusMeta.textContent = meta || '';
}

function categoryLabel(category){
  return String(category || '').toUpperCase();
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

function teamKeyVariants(value){
  const raw = String(value || '');
  const normalized = normalizeText(raw);
  const variants = new Set();
  const compact = compactKey(raw);
  if (compact) variants.add(compact);

  const baseNormalized = normalized
    .replace(/\b(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const baseCompact = baseNormalized.replace(/[^A-Z0-9]/g, '');
  if (baseCompact) variants.add(baseCompact);

  const slugCompact = compact
    .replace(/(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)$/g, '');
  if (slugCompact) variants.add(slugCompact);

  const noDe = baseCompact.replace(/^DE/, '');
  if (noDe) variants.add(noDe);

  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    const aliasKeys = [canonical, ...aliases].map((v) => compactKey(v)).filter(Boolean);
    if (aliasKeys.includes(compact) || aliasKeys.includes(baseCompact) || aliasKeys.includes(slugCompact)) {
      aliasKeys.forEach((v) => variants.add(v));
    }
  }

  return [...variants].filter(Boolean);
}

function resolvePlanillaCategory(item){
  return 'todas';
}

async function fetchJson(url, options){
  const response = await fetch(url, options);
  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const message = data?.error || data?.message || ('HTTP ' + response.status + ' @ ' + url);
    throw new Error(message);
  }
  return data;
}

async function checkCrucesEnabled(category){
  const team = CATEGORY_KEYS[category];
  if (!team) return false;

  const params = new URLSearchParams({ team });
  const data = await fetchJson(`${API_BASE}/api/cruces/status?` + params.toString(), { cache: 'no-store' });

  return !!data?.enabled;
}

async function loadFixture(kind, category){
  return await fetchJson(`${API_BASE}/api/fixture?kind=${encodeURIComponent(kind)}&category=${encodeURIComponent(category)}`, {
    cache: 'no-store'
  });
}

function parseISOAsLocal(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateKeyFromRaw(raw){
  const d = parseISOAsLocal(raw);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function collectFixtureCandidates(raw, kind){
  const fechas = Array.isArray(raw?.data?.fechas) ? raw.data.fechas : [];
  return fechas
    .map((fechaNode) => ({
      kind,
      rawDate: fechaNode?.date || fechaNode?.fecha || fechaNode?.fechaISO || fechaNode?.fechaKey || '',
      dateKey: dateKeyFromRaw(fechaNode?.date || fechaNode?.fecha || fechaNode?.fechaISO || fechaNode?.fechaKey || ''),
      fechaNode
    }))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.dateKey));
}

function selectBestFixtureCandidate(candidates){
  if (!Array.isArray(candidates) || !candidates.length) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const makeKey = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const todayKey = makeKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = makeKey(yesterday);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = makeKey(tomorrow);

  const sorted = candidates.slice().sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  return (
    sorted.find((item) => item.dateKey === todayKey) ||
    sorted.find((item) => item.dateKey === yesterdayKey) ||
    sorted.find((item) => item.dateKey === tomorrowKey) ||
    sorted.find((item) => item.dateKey > tomorrowKey) ||
    sorted[sorted.length - 1] ||
    null
  );
}

function extractCrucesFromFechaNode(fechaNode){
  const result = [];
  const tablas = Array.isArray(fechaNode?.tablas) ? fechaNode.tablas : [];

  tablas.forEach((tabla) => {
    const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos.filter(Boolean) : [];
    if (!equipos.length) return;

    const local = equipos.find((item) => String(item?.categoria || '').toLowerCase() === 'local');
    const visitante = equipos.find((item) => String(item?.categoria || '').toLowerCase() === 'visitante');

    if (local?.equipo && visitante?.equipo) {
      pushCruce(result, local.equipo, visitante.equipo);
      return;
    }

    for (let i = 0; i < equipos.length; i += 2) {
      const a = equipos[i];
      const b = equipos[i + 1];
      if (a?.equipo && b?.equipo) pushCruce(result, a.equipo, b.equipo);
    }
  });

  return result;
}

async function loadBestFixtureCruces(category){
  const [idaRaw, vueltaRaw] = await Promise.all([
    loadFixture('ida', category),
    loadFixture('vuelta', category).catch(() => null)
  ]);

  const candidates = [
    ...collectFixtureCandidates(idaRaw, 'ida'),
    ...collectFixtureCandidates(vueltaRaw, 'vuelta')
  ];

  const selected = selectBestFixtureCandidate(candidates);
  return {
    selected,
    cruces: selected ? extractCrucesFromFechaNode(selected.fechaNode) : []
  };
}

async function loadPlanillas(){
  const data = await fetchJson(`${API_BASE}/api/admin/planillas`, { cache: 'no-store' });
  if (!Array.isArray(data)) return [];
  return data.map((item) => ({
    ...item,
    __category: resolvePlanillaCategory(item)
  }));
}

function pushCruce(list, left, right){
  const local = String(left || '').trim();
  const visitante = String(right || '').trim();
  if (!local || !visitante) return;
  list.push({ local, visitante });
}

function extractCruces(input){
  const result = [];
  const visited = new WeakSet();

  function walk(node){
    if (!node) return;
    if (typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (typeof node.local === 'string' && typeof node.visitante === 'string') {
      pushCruce(result, node.local, node.visitante);
    }
    if (typeof node.equipoLocal === 'string' && typeof node.equipoVisitante === 'string') {
      pushCruce(result, node.equipoLocal, node.equipoVisitante);
    }
    if (typeof node.home === 'string' && typeof node.away === 'string') {
      pushCruce(result, node.home, node.away);
    }
    if (typeof node.left === 'string' && typeof node.right === 'string') {
      pushCruce(result, node.left, node.right);
    }

    if (Array.isArray(node.equipos) && node.equipos.length >= 2) {
      const equipos = node.equipos.filter(Boolean);
      const byCategory = {
        local: equipos.find((item) => String(item?.categoria || '').toLowerCase() === 'local'),
        visitante: equipos.find((item) => String(item?.categoria || '').toLowerCase() === 'visitante')
      };
      if (byCategory.local?.equipo && byCategory.visitante?.equipo) {
        pushCruce(result, byCategory.local.equipo, byCategory.visitante.equipo);
      } else {
        for (let i = 0; i < equipos.length; i += 2) {
          const a = equipos[i];
          const b = equipos[i + 1];
          if (a?.equipo && b?.equipo) pushCruce(result, a.equipo, b.equipo);
        }
      }
    }

    Object.values(node).forEach(walk);
  }

  walk(input);

  const dedup = new Map();
  result.forEach((item) => {
    const key = compactKey(item.local) + '::' + compactKey(item.visitante);
    if (!dedup.has(key)) dedup.set(key, item);
  });
  return [...dedup.values()];
}

function buildPlanillaIndex(planillas, category){
  const index = new Map();
  planillas.forEach((item) => {
    teamKeyVariants(item.team).forEach((variant) => {
      if (!index.has(variant)) index.set(variant, item);
    });
  });
  return index;
}

function findPlanilla(index, teamName){
  const variants = teamKeyVariants(teamName);
  for (const variant of variants) {
    if (index.has(variant)) return index.get(variant);
  }
  return null;
}

function text(value){
  return String(value || '').trim();
}

function safeArr(value, expected){
  const arr = Array.isArray(value) ? value.map(text) : [];
  if (typeof expected === 'number') {
    while (arr.length < expected) arr.push('');
    return arr.slice(0, expected);
  }
  return arr;
}

function escapeHtml(value){
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function individualRows(local, visitante){
  const left = safeArr(local?.individuales, 7);
  const right = safeArr(visitante?.individuales, 7);

  return left.map((name, idx) => {
    if(idx === 0){
      return `<tr class="ind-row">
        <td>${escapeHtml(name)}</td>
        <td></td>
        <td class="center-col" rowspan="7">VS.</td>
        <td></td>
        <td>${escapeHtml(right[idx])}</td>
      </tr>`;
    }
    return `<tr class="ind-row">
      <td>${escapeHtml(name)}</td>
      <td></td>
      <td></td>
      <td>${escapeHtml(right[idx])}</td>
    </tr>`;
  }).join('');
}

function doublesRows(localPair, visitantePair){
  const l = safeArr(localPair, 2);
  const r = safeArr(visitantePair, 2);
  return `<tr>
    <td>${escapeHtml(l[0])}</td>
    <td rowspan="2"></td>
    <td class="vs-merged" rowspan="2">VS.</td>
    <td rowspan="2"></td>
    <td>${escapeHtml(r[0])}</td>
  </tr>
  <tr>
    <td>${escapeHtml(l[1])}</td>
    <td>${escapeHtml(r[1])}</td>
  </tr>`;
}

function subsRows(items){
  const rows = safeArr(items, 2);
  return rows.map((v) => `<tr><td>${escapeHtml(v)}</td></tr>`).join('');
}

function renderSheet(item, index){
  const localTeam = text(item.localTeamName);
  const visitanteTeam = text(item.visitanteTeamName);
  const localPlan = item.localPlan || {};
  const visitantePlan = item.visitantePlan || {};
  const localCap = safeArr(localPlan.capitan, 2).filter(Boolean).join(' / ');
  const visitCap = safeArr(visitantePlan.capitan, 2).filter(Boolean).join(' / ');

  const article = document.createElement('article');
  article.className = 'sheet-shell';
  article.innerHTML = `
    <div class="sheet-head">
      <div>
        <h2 class="sheet-title">${escapeHtml(localTeam)} vs ${escapeHtml(visitanteTeam)}</h2>
        <div class="sheet-sub">${escapeHtml(categoryLabel(item.category))}</div>
      </div>
    </div>

    <div class="sheet-viewport">
      <section class="sheet-page">
        <div class="page-meta">
          <span>Categoría: ${escapeHtml(categoryLabel(item.category))}</span>
          <span>Planilla ${index + 1}</span>
        </div>

        <h1 class="league-title">L.I.P.A.</h1>
        <div class="bar"></div>

        <div class="header-grid">
          <div>
            <table class="form" aria-label="Datos de sala local">
              <tr>
                <td class="label-cell">SALA</td>
                <td>${escapeHtml(localTeam)}</td>
              </tr>
              <tr>
                <td class="label-cell">CAPITANÍA</td>
                <td>${escapeHtml(localCap)}</td>
              </tr>
            </table>
          </div>

          <div class="logo-box">
            <img src="../logo_liga.png" alt="Logo Liga" onerror="this.style.display='none';" />
          </div>

          <div>
            <table class="form" aria-label="Datos de sala visitante">
              <tr>
                <td>${escapeHtml(visitanteTeam)}</td>
                <td class="label-cell">SALA</td>
              </tr>
              <tr>
                <td>${escapeHtml(visitCap)}</td>
                <td class="label-cell">CAPITANÍA</td>
              </tr>
            </table>
          </div>
        </div>

        <div class="section">
          <table class="ind-table" aria-label="Partidos individuales">
            <colgroup>
              <col style="width:32.5%">
              <col style="width:5%">
              <col style="width:25%">
              <col style="width:5%">
              <col style="width:32.5%">
            </colgroup>
            <thead class="ind-head">
              <tr>
                <th colspan="2">Nombre y apellido</th>
                <th>Individuales</th>
                <th colspan="2">Nombre y apellido</th>
              </tr>
            </thead>
            <tbody>${individualRows(localPlan, visitantePlan)}</tbody>
          </table>
        </div>

        <div class="doubles-section">
          <div class="doubles-label">Parejas 1</div>
          <table class="doubles" aria-label="Partidos de parejas 1">
            <colgroup>
              <col style="width:32.5%">
              <col style="width:5%">
              <col style="width:25%">
              <col style="width:5%">
              <col style="width:32.5%">
            </colgroup>
            <tbody>${doublesRows(localPlan.pareja1, visitantePlan.pareja1)}</tbody>
          </table>
        </div>

        <div class="doubles-section">
          <div class="doubles-label">Parejas 2</div>
          <table class="doubles" aria-label="Partidos de parejas 2">
            <colgroup>
              <col style="width:32.5%">
              <col style="width:5%">
              <col style="width:25%">
              <col style="width:5%">
              <col style="width:32.5%">
            </colgroup>
            <tbody>${doublesRows(localPlan.pareja2, visitantePlan.pareja2)}</tbody>
          </table>
        </div>

        <div class="result-section">
          <table class="result" aria-label="Resultado final">
            <colgroup>
              <col style="width:42%">
              <col style="width:8%">
              <col style="width:8%">
              <col style="width:42%">
            </colgroup>
            <thead>
              <tr>
                <th>Sala</th>
                <th colspan="2">Resultado Final</th>
                <th>Sala</th>
              </tr>
            </thead>
            <tbody>
              <tr><td></td><td></td><td></td><td></td></tr>
              <tr>
                <td class="tri-left">Triángulos Totales</td>
                <td></td>
                <td></td>
                <td class="tri-right">Triángulos Totales</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="subs">
          <div class="subs-grid">
            <div>
              <table class="subs-table" aria-label="Suplentes local">
                <thead><tr><th>Suplentes</th></tr></thead>
                <tbody>${subsRows(localPlan.suplentes)}</tbody>
              </table>
            </div>
            <div>
              <table class="subs-table" aria-label="Suplentes visitante">
                <thead><tr><th>Suplentes</th></tr></thead>
                <tbody>${subsRows(visitantePlan.suplentes)}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="signatures">
          <div class="sig">
            <div class="sig-line"></div>
            <div class="sig-label">Firma local</div>
          </div>
          <div class="sig">
            <div class="sig-line"></div>
            <div class="sig-label">Firma visitante</div>
          </div>
        </div>
      </section>
    </div>
  `;
  return article;
}

function renderEmpty(message){
  grid.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
}

function buildCompleteSheets(cruces, planillas, category){
  const index = buildPlanillaIndex(planillas, category);
  const complete = [];
  cruces.forEach((cruce) => {
    const localItem = findPlanilla(index, cruce.local);
    const visitItem = findPlanilla(index, cruce.visitante);
    if (!localItem || !visitItem) return;
    complete.push({
      category,
      localTeamName: cruce.local,
      visitanteTeamName: cruce.visitante,
      localPlan: localItem.planilla || localItem.plan || {},
      visitantePlan: visitItem.planilla || visitItem.plan || {},
      localDbTeam: localItem.team,
      visitanteDbTeam: visitItem.team
    });
  });
  return complete;
}

function renderSheets(sheets){
  grid.innerHTML = '';
  if (!sheets.length) {
    renderEmpty('Todavía no hay cruces completos para mostrar en esta categoría.');
    return;
  }
  sheets.forEach((item, index) => grid.appendChild(renderSheet(item, index)));
}

async function reload(){
  const category = state.category;
  setStatus('warn', 'Buscando cruces y planillas...', 'Categoría: ' + categoryLabel(category));
  grid.innerHTML = '';

  try {
    await sleep(150);
    const enabled = await checkCrucesEnabled(category);
    if (!enabled) {
      state.completeSheets = [];
      renderEmpty('Los cruces de ' + categoryLabel(category) + ' no están habilitados en este momento.');
      setStatus('warn', 'Cruces no habilitados', 'No se encontró habilitación activa.');
      return;
    }

    await sleep(150);
    const fixtureInfo = await loadBestFixtureCruces(category);

    await sleep(150);
    const planillas = await loadPlanillas();

    const cruces = fixtureInfo.cruces;
    const completeSheets = buildCompleteSheets(cruces, planillas, category);

    state.allPlanillas = planillas;
    state.completeSheets = completeSheets;

    renderSheets(completeSheets);

    const totalCruces = cruces.length;
    const totalCompletos = completeSheets.length;
    const selectedDate = fixtureInfo?.selected?.dateKey || 'sin fecha';
    const selectedKind = fixtureInfo?.selected?.kind || 'sin tramo';
    setStatus(
      totalCompletos ? 'ok' : 'warn',
      totalCompletos
        ? ('Se encontraron ' + totalCompletos + ' planilla' + (totalCompletos === 1 ? '' : 's') + ' completa' + (totalCompletos === 1 ? '' : 's'))
        : 'No hay cruces completos todavía',
      'Fixture usado: ' + selectedKind.toUpperCase() + ' · Fecha: ' + selectedDate + ' · Cruces detectados: ' + totalCruces + ' · Completos: ' + totalCompletos
    );
  } catch (error) {
    console.error(error);
    renderEmpty(error?.message || 'No se pudieron cargar las planillas automáticas.');
    setStatus('error', 'Error al cargar', error?.message || 'Falló la consulta al backend.');
  }
}

function wireCategoryButtons(){
  document.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', async () => {
      const category = button.dataset.category;
      if (!category || state.category === category) return;
      state.category = category;
      document.querySelectorAll('[data-category]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.category === category);
      });
      await reload();
    });
  });
}

function wireToolbar(){
  $('#btnRefresh').addEventListener('click', reload);
  $('#btnPdfZip').addEventListener('click', () => exportAllSheets('pdf'));
  $('#btnJpgZip').addEventListener('click', () => exportAllSheets('jpg'));
}

document.addEventListener('DOMContentLoaded', async () => {
  wireCategoryButtons();
  wireToolbar();
  await reload();
});


function slugify(value){
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function sheetFileName(item, ext){
  const left = slugify(item.localTeamName || 'local');
  const right = slugify(item.visitanteTeamName || 'visitante');
  const cat = slugify(item.category || state.category || 'categoria');
  return `planilla-${cat}-${left}-vs-${right}.${ext}`;
}

async function clonePageForCapture(pageEl){
  const clone = pageEl.cloneNode(true);
  clone.style.transform = 'none';
  clone.style.transformOrigin = 'top left';
  clone.style.width = '793.701px';
  clone.style.minHeight = '1122.52px';
  clone.style.position = 'fixed';
  clone.style.left = '-10000px';
  clone.style.top = '0';
  clone.style.zIndex = '-1';
  clone.style.margin = '0';
  clone.style.background = '#fff';
  clone.style.boxShadow = 'none';
  clone.style.border = '1px solid #000';
  document.body.appendChild(clone);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return clone;
}

async function renderSheetCanvas(sheetShell){
  const pageEl = sheetShell.querySelector('.sheet-page');
  if (!pageEl) throw new Error('No se encontró la planilla para exportar.');

  const clone = await clonePageForCapture(pageEl);
  try {
    const canvas = await html2canvas(clone, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      width: 794,
      height: 1123,
      windowWidth: 794,
      windowHeight: 1123
    });
    return canvas;
  } finally {
    clone.remove();
  }
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportSheetAsPdf(sheetShell, item){
  const canvas = await renderSheetCanvas(sheetShell);
  const imgData = canvas.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });
  pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  pdf.save(sheetFileName(item, 'pdf'));
}

async function exportSheetAsJpg(sheetShell, item){
  const canvas = await renderSheetCanvas(sheetShell);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.96));
  if (!blob) throw new Error('No se pudo generar la imagen JPG.');
  downloadBlob(blob, sheetFileName(item, 'jpg'));
}

async function exportAllSheets(kind){
  const shells = Array.from(document.querySelectorAll('.sheet-shell'));
  if (!shells.length || !state.completeSheets.length) {
    setStatus('warn', 'No hay planillas para exportar', 'Primero cargá una categoría con cruces completos.');
    return;
  }

  const label = kind === 'pdf' ? 'PDFs' : 'JPGs';
  setStatus('warn', 'Preparando descargas...', `Generando ${state.completeSheets.length} archivo(s) ${label} individuales`);

  try {
    for (let i = 0; i < shells.length; i++) {
      const shell = shells[i];
      const item = state.completeSheets[i];
      if (kind === 'pdf') {
        await exportSheetAsPdf(shell, item);
      } else {
        await exportSheetAsJpg(shell, item);
      }
      await sleep(350);
    }

    setStatus('ok', `Descarga iniciada: ${label}`, `Se generaron ${shells.length} archivo(s) individuales.`);
  } catch (error) {
    console.error(error);
    setStatus('error', 'No se pudieron exportar las planillas', error?.message || 'Error al generar los archivos.');
  }
}
