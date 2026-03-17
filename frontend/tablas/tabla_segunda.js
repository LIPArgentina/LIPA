function debounce(fn, wait = 100){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function equalizeTableWidths(){
  const wraps = Array.from(document.querySelectorAll('.table-wrap'));
  if (!wraps.length) return;
  wraps.forEach(w => w.style.width = '');
  if (window.innerWidth <= 980) return;
  const max = Math.max(...wraps.map(w => w.getBoundingClientRect().width));
  wraps.forEach(w => w.style.width = `${Math.ceil(max)}px`);
}

window.addEventListener('load', () => {
  equalizeTableWidths();
  window.addEventListener('resize', debounce(equalizeTableWidths, 120));
  const ro = new ResizeObserver(debounce(equalizeTableWidths, 60));
  document.querySelectorAll('.board').forEach(b => ro.observe(b));
});

const GROUPS = ['A', 'B'];
const cache = { ida: null, vuelta: null };
let selectedKind = 'ida';

function normalizeName(s){
  return (s || '').toString().trim().replace(/\s+/g, ' ');
}

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

const API_BASE = 'https://liga-backend-tt82.onrender.com/api';

async function fetchFixture(kind){
  const apiUrl = `${API_BASE}/fixture?kind=${encodeURIComponent(kind)}&category=segunda`;

  try {
    const apiRes = await fetch(apiUrl, { cache: 'no-store' });

    if (apiRes.ok) {
      const apiData = await apiRes.json().catch(() => null);

      if (apiData?.ok && apiData?.data) {
        console.log('✔ API SEGUNDA');
        cache[kind] = apiData.data;
        return apiData.data;
      }
    }
  } catch (err) {
    console.warn('fallback JSON', err);
  }

  const file = kind === 'vuelta'
    ? '../fixture/fixture.vuelta.segunda.json'
    : '../fixture/fixture.ida.segunda.json';

  const res = await fetch(file, { cache: 'no-store' });
  const data = await res.json();
  cache[kind] = data;
  return data;
}

function ensureFechaBlock(section, fechaIndex, fechaText){
  const tpl = document.getElementById('tpl-fecha');
  const clone = document.importNode(tpl.content, true);
  clone.querySelector('.h2').textContent = `${fechaIndex}ª FECHA`;
  clone.querySelector('.fecha-text').textContent = formatDateDMY(fechaText);
  clone.querySelector('.rows').setAttribute('data-fecha', String(fechaIndex));
  section.appendChild(clone);
  return section.querySelector(`.rows[data-fecha="${fechaIndex}"]`);
}

function renderRowsStatic(rowsCont, equipos){
  rowsCont.innerHTML = '';
  const list = Array.isArray(equipos) ? equipos : [];
  const total = Math.floor(list.length / 2);

  for (let k = 0; k < total; k++){
    const iL = 2 * k;
    const iV = 2 * k + 1;
    const L = list[iL] || { equipo:'', puntos:'' };
    const V = list[iV] || { equipo:'', puntos:'' };

    const row = document.createElement('div');
    row.className = 'row';

    const puntL = document.createElement('div');
    puntL.className = 'score-badge';
    puntL.textContent = L.puntos ?? '';

    const selL = document.createElement('div');
    selL.className = 'team-name';
    selL.textContent = L.equipo || '';

    const vs = document.createElement('div');
    vs.className = 'vs';
    vs.textContent = 'VS';

    const selV = document.createElement('div');
    selV.className = 'team-name';
    selV.textContent = V.equipo || '';

    const puntV = document.createElement('div');
    puntV.className = 'score-badge';
    puntV.textContent = V.puntos ?? '';

    row.append(puntL, selL, vs, selV, puntV);
    rowsCont.append(row);
  }
}

function buildFixtureCard(group, fechas){
  const section = document.querySelector(`section.card[data-group="${group}"]`);
  if (!section) return;
  section.innerHTML = `<h1 class="h1">GRUPO ${group}</h1>`;

  fechas.forEach((fechaObj, idx) => {
    const fechaIndex = idx + 1;
    const fechaText = fechaObj?.date || fechaObj?.fecha || '';
    const tabla = (fechaObj?.tablas || []).find(
      t => String(t?.grupo || '').toUpperCase() === group
    );
    const rowsCont = ensureFechaBlock(section, fechaIndex, fechaText);
    renderRowsStatic(rowsCont, tabla?.equipos || []);
  });
}

function renderSelectedFixture(){
  const fx = cache[selectedKind];
  if (!fx || !Array.isArray(fx.fechas)) return;
  GROUPS.forEach(group => buildFixtureCard(group, fx.fechas));
}

function calcRows(feeds){
  const puntos = Object.fromEntries(GROUPS.map(g => [g, Object.create(null)]));
  const ju = Object.fromEntries(GROUPS.map(g => [g, Object.create(null)]));
  const teamsSeen = Object.fromEntries(GROUPS.map(g => [g, new Map()]));

  (feeds || []).forEach(feed => {
    (feed?.fechas || []).forEach(fecha => {
      (fecha?.tablas || []).forEach(tabla => {
        const g = String(tabla?.grupo || '').toUpperCase();
        if (!GROUPS.includes(g)) return;

        const equipos = (tabla?.equipos || []).map(e => ({
          equipo: e?.equipo || '',
          puntos: parseInt(e?.puntos ?? 0, 10) || 0
        }));

        equipos.forEach(it => {
          const key = normalizeName(it.equipo);
          if (!key || key.toUpperCase() === 'WO') return;
          if (!puntos[g][key]) puntos[g][key] = { equipo: it.equipo, pts: 0 };
          puntos[g][key].pts += it.puntos;
          if (!teamsSeen[g].has(key)) teamsSeen[g].set(key, it.equipo);
        });

        for (let i = 0; i < equipos.length; i += 2){
          const A = equipos[i];
          const B = equipos[i + 1];
          if (!A || !B) continue;

          const aK = normalizeName(A.equipo);
          const bK = normalizeName(B.equipo);
          if (!aK || !bK) continue;
          if (aK.toUpperCase() === 'WO' || bK.toUpperCase() === 'WO') continue;
          if (A.puntos === 0 && B.puntos === 0) continue;

          ju[g][aK] = (ju[g][aK] || 0) + 1;
          ju[g][bK] = (ju[g][bK] || 0) + 1;
        }
      });
    });
  });

  const result = {};
  GROUPS.forEach(g => {
    result[g] = Array.from(teamsSeen[g].entries()).map(([key, display]) => ({
      key,
      equipo: puntos[g][key]?.equipo || display,
      pts: puntos[g][key]?.pts || 0,
      ju: ju[g][key] || ''
    }))
    .sort((a, b) => b.pts - a.pts || String(a.equipo).localeCompare(String(b.equipo)))
    .map((r, i) => ({
      pos: i + 1,
      equipo: r.equipo,
      ju: r.ju,
      tr: '',
      pts: r.pts
    }));
  });
  return result;
}

function buildStandingRow(d, idx){
  const row = document.createElement('div');
  row.className = 'row';
  row.setAttribute('role', 'row');
  const pillClass = idx < 2 ? 'yellow' : 'white';
  row.innerHTML = `
    <div class="square" data-field="pos">${d.pos ?? ''}</div>
    <div class="pill ${pillClass}" data-field="team">${d.equipo ?? ''}</div>
    <div class="square" data-field="ju">${d.ju ?? ''}</div>
    <div class="square" data-field="tr">${d.tr ?? ''}</div>
    <div class="square" data-field="pts">${d.pts ?? ''}</div>
  `;
  return row;
}

function fillBoard(group, data){
  const holder = document.querySelector(`[data-group-rows="${group}"]`);
  if (!holder) return;
  holder.innerHTML = '';
  (data || []).forEach((d, idx) => holder.appendChild(buildStandingRow(d, idx)));
}

function renderStandings(){
  const feeds = [cache.ida, cache.vuelta].filter(Boolean);
  if (!feeds.length) return;
  const result = calcRows(feeds);
  GROUPS.forEach(g => fillBoard(g, result[g] || []));
  equalizeTableWidths();
}

function setActive(kind){
  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-fixture') === kind);
  });
}

async function switchFixture(kind){
  selectedKind = kind;
  try { localStorage.setItem('fixture_kind_segunda', kind); } catch(_) {}
  if (!cache[kind]) await fetchFixture(kind);
  renderSelectedFixture();
  setActive(kind);
}

async function init(){
  try { selectedKind = localStorage.getItem('fixture_kind_segunda') || 'ida'; } catch(_) { selectedKind = 'ida'; }
  document.querySelectorAll('.pill-btn[data-fixture]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.getAttribute('data-fixture') || 'ida';
      switchFixture(kind).catch(err => {
        console.error(err);
        alert(err.message || String(err));
      });
    });
  });

  try {
    await Promise.all([fetchFixture('ida'), fetchFixture('vuelta')]);
    renderStandings();
    renderSelectedFixture();
    setActive(selectedKind);
  } catch (err) {
    console.error(err);
    alert('No se pudieron cargar los fixtures de segunda en formato JSON.');
  }
}

window.addEventListener('DOMContentLoaded', init);
