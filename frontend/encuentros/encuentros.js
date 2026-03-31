const API_BASE = (window.APP_CONFIG?.API_BASE_URL || 'https://liga-backend-tt82.onrender.com').replace(/\/+$/, '') + '/api';

function formatDateDMY(val){
  if (val == null) return '';
  const s = String(val).trim();
  if (!s) return '';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d,m,y] = s.split('/');
    return `${d.padStart(2,'0')}/${m.padStart(2,'0')}/${y}`;
  }
  const norm = s.replace(/[\.\/]/g,'-');
  let m = norm.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[3].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[1]}`;
  m = norm.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[3]}`;
  const t = Date.parse(s);
  if (!Number.isNaN(t)){
    const d = new Date(t);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }
  return s;
}

function buildDateKey(val){
  const s = String(val || '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return s;
}

function renderRows(container, equipos){
  container.innerHTML = '';
  const list = Array.isArray(equipos) ? equipos : [];
  for (let i = 0; i < list.length; i += 2) {
    const L = list[i] || { equipo:'', puntos:'', puntosExtra:'' };
    const V = list[i + 1] || { equipo:'', puntos:'', puntosExtra:'' };
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="triangle-badge">${L.puntosExtra ?? ''}</div>
      <div class="score-badge">${L.puntos ?? ''}</div>
      <div class="team-name">${L.equipo || ''}</div>
      <div class="vs">VS</div>
      <div class="team-name">${V.equipo || ''}</div>
      <div class="score-badge">${V.puntos ?? ''}</div>
      <div class="triangle-badge">${V.puntosExtra ?? ''}</div>
    `;
    container.appendChild(row);
  }
}

async function init(){
  const params = new URLSearchParams(location.search);
  const category = (params.get('category') || 'segunda').toLowerCase();
  const kind = (params.get('kind') || 'ida').toLowerCase();
  const rawDate = params.get('date') || '';
  const rawFecha = params.get('fecha') || '';
  const targetKey = buildDateKey(rawDate);

  document.getElementById('categoryLabel').textContent = `Categoría ${category.toUpperCase()} · ${kind.toUpperCase()}`;
  document.getElementById('datePill').textContent = formatDateDMY(rawDate || rawFecha);
  document.getElementById('metaText').textContent = rawFecha ? `${rawFecha}ª fecha · todos los encuentros` : 'Todos los encuentros de la fecha';
  document.getElementById('btnVolver').addEventListener('click', (ev) => { ev.preventDefault(); history.back(); });

  const res = await fetch(`${API_BASE}/fixture?kind=${encodeURIComponent(kind)}&category=${encodeURIComponent(category)}`, { cache:'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok || !json?.data?.fechas) throw new Error(json?.error || 'No se pudo cargar el fixture');

  const fechaObj = (json.data.fechas || []).find((fecha) => buildDateKey(fecha?.date) === targetKey);
  const groupsContainer = document.getElementById('groupsContainer');

  if (!fechaObj) {
    groupsContainer.innerHTML = '<div class="empty">No se encontraron encuentros para esa fecha.</div>';
    return;
  }

  const tablas = Array.isArray(fechaObj.tablas) ? fechaObj.tablas : [];
  if (!tablas.length) {
    groupsContainer.innerHTML = '<div class="empty">No hay encuentros cargados para esa fecha.</div>';
    return;
  }

  const tpl = document.getElementById('tpl-group');
  groupsContainer.innerHTML = '';
  tablas.forEach((tabla) => {
    const clone = document.importNode(tpl.content, true);
    clone.querySelector('.group-title').textContent = `GRUPO ${String(tabla?.grupo || '').toUpperCase() || '-'}`;
    renderRows(clone.querySelector('.rows'), tabla?.equipos || []);
    groupsContainer.appendChild(clone);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => {
    console.error(err);
    document.getElementById('groupsContainer').innerHTML = `<div class="empty">${err?.message || 'No se pudieron cargar los encuentros.'}</div>`;
  });
});
