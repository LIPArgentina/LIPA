/* cruces_fecha.js — FINAL: TRIÁNGULOS ARRIBA, PUNTOS ABAJO, PAREJAS 1 SELECT, RUTA ../fecha/ */
(() => {
  'use strict';

  // --- ESCALADO GLOBAL: ajusta la "hoja" al ancho del viewport ---
  const DESIGN_WIDTH = 650;  // ancho ideal del layout en escritorio

    function applyPageScale() {
    const vw = window.innerWidth || document.documentElement.clientWidth || DESIGN_WIDTH;
    const outerW = window.outerWidth || vw;

    // Heurística: si el viewport interno es chico pero la ventana externa es grande,
    // asumimos que es emulación (DevTools / modo compatibilidad).
    const isEmulated = (outerW - vw > 200) && (outerW > 900);

    let scale;
    if (isEmulated) {
      // En modo emulado no escalamos para que el header llegue a los bordes
      scale = 1;
    } else {
      // Lógica de escalado original
      scale = vw / DESIGN_WIDTH;
      if (scale > 1) scale = 1;      // en escritorio no agrandamos
      if (scale < 0.4) scale = 0.4;  // límite para no quedar microscópico

      // achicamos todo un 10% extra
      scale *= 0.9;
    }

    document.documentElement.style.setProperty('--page-scale', String(scale));
  }

  window.addEventListener('resize', applyPageScale);
  window.addEventListener('orientationchange', applyPageScale);
  window.addEventListener('DOMContentLoaded', applyPageScale);

  // ---------------- UTILS ----------------
  const dtf = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' });

  const normalize = (s = '', { stripHyphens = false } = {}) => {
    const map = {
      'á':'a','é':'e','í':'i','ó':'o','ú':'u','ñ':'n','ü':'u',
      'Á':'A','É':'E','Í':'I','Ó':'O','Ú':'U','Ñ':'N','Ü':'U'
    };
    let out = String(s).toLowerCase()
      .replace(/[áéíóúñüÁÉÍÓÚÑÜ]/g, c => map[c])
      .replace(/[''´`]/g, '')
      .replace(/[^a-z0-9_-]/g, '');
    out = out.replace(/\s+/g, '');
    if (stripHyphens) out = out.replace(/-/g, '');
    return out.replace(/-+/g, '-').replace(/^-|-$/g, '');
  };

  const normPlanillaSlug = (name) => normalize(name, { stripHyphens: true });

  const parseISOAsLocal = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  };

  const formatDate = (iso) => {
    try { return dtf.format(parseISOAsLocal(iso)); }
    catch { return String(iso || ''); }
  };

  // ---------------- DATA LOADING ----------------
  const loadGlobalScript = (src, key) => new Promise((resolve, reject) => {
    try { delete window[key]; } catch {}
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      const data = window[key];
      try { delete window[key]; } catch {}
      data ? resolve(JSON.parse(JSON.stringify(data))) : reject(new Error('No data in ' + key));
    };
    s.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });

  async function loadAllFixtures() {
    const isFile = location.protocol === 'file:';
    const localWinBase = 'file:///C:/Users/javie/Desktop/LIGA/frontend/fixture/';
    const httpBase = 'http://localhost:3000/fixture/';
    const relBase = '/frontend/fixture/';
    const names = ['fixture.ida.tercera.js', 'fixture.vuelta.tercera.js'];

    const sources = isFile
      ? [...names.map(n => localWinBase + n), ...names.map(n => httpBase + n), ...names.map(n => relBase + n)]
      : [...names.map(n => httpBase + n), ...names.map(n => relBase + n)];

    const results = await Promise.allSettled(sources.map(src => loadGlobalScript(src, 'LPI_FIXTURE')));
    const all = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled' && results[i].value?.fechas) {
        all.push({ src: sources[i], fechas: results[i].value.fechas });
      }
    }
    if (!all.length) throw new Error('No se pudo cargar fixture.');
    return all;
  }

  function* iteratePairs(equipos) {
    for (let i = 0; i + 1 < equipos.length; i += 2) {
      const a = equipos[i], b = equipos[i + 1];
      const getName = (x) => (typeof x === 'string') ? x : String(x?.equipo || '').trim();
      const catA = String(a?.categoria || '').toLowerCase();
      const catB = String(b?.categoria || '').toLowerCase();
      let left = a, right = b;
      // Si vienen invertidos, los acomodamos por categoria
      if (catA === 'visitante' && catB === 'local') {
        left = b; right = a;
      } else if (catA === 'local' && catB === 'visitante') {
        left = a; right = b;
      } else if (catA === 'local' && !catB) {
        left = a; right = b;
      } else if (!catA && catB === 'visitante') {
        left = a; right = b;
      } else if (catA === 'visitante' && !catB) {
        // si solo A es visitante, lo pasamos a la derecha
        left = b; right = a;
      } else if (!catA && catB === 'local') {
        // si solo B es local, lo pasamos a la izquierda
        left = b; right = a;
      }
      yield [ getName(left), getName(right) ];
    }
  }

  function findAllMatchesForTeam(fixtures, teamSlug) {
    const matches = [];
    for (const fix of fixtures) {
      for (const fecha of fix.fechas) {
        for (const tabla of (fecha.tablas || [])) {
          const equipos = (tabla.equipos || []);
          for (const [loc, vis] of iteratePairs(equipos)) {
            const nLoc = normPlanillaSlug(loc);
            const nVis = normPlanillaSlug(vis);
            if (nLoc === teamSlug || nVis === teamSlug) {
              matches.push({ local: loc, visitante: vis, date: fecha.date, localSlug: nLoc, visitanteSlug: nVis });
            }
          }
        }
      }
    }
    return matches;
  }

function pickBestByClosestDate(matches) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Parseo local de 'YYYY-MM-DD' (evita corrimiento UTC)
  const _parseISOAsLocal = (iso) => {
    if (!iso) return new Date('Invalid');
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return new Date('Invalid');
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };

  // Fechas únicas del fixture (por día)
  const dates = Array.from(new Set(matches.map(m => String(m.date).slice(0,10))));
  if (dates.length === 0) return null;

  // Candidatas: aquellas cuyo rango [D-5, D+1] contiene "today"
  const candidates = [];
  for (const key of dates) {
    const d = _parseISOAsLocal(key);
    const start = new Date(d.getTime() - 5*24*60*60*1000);
    const end   = new Date(d.getTime() + 1*24*60*60*1000);
    if (today >= start && today <= end) {
      candidates.push({ key, diff: Math.abs(d - today) });
    }
  }
  if (candidates.length === 0) return null;

  // Elegimos la de menor |D - today| (si hubiera dos, quedará la más cercana)
  candidates.sort((a,b) => a.diff - b.diff);
  const bestKey = candidates[0].key;

  // Devolvemos un match de ese día (el más temprano)
  const dayMatches = matches.filter(m => String(m.date).startsWith(bestKey));
  if (dayMatches.length === 0) return null;
  return dayMatches.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
}


  function getStoredCrucesTeam() {
    try {
      const qs = new URLSearchParams(location.search).get('team');
      if (qs) {
        const clean = normPlanillaSlug(qs);
        try { sessionStorage.setItem('lpi_cruces_team', clean); } catch(_){}
        try { localStorage.setItem('lpi_cruces_team', clean); } catch(_){}
        try {
          const url = new URL(location.href);
          url.searchParams.delete('team');
          history.replaceState({}, '', url.pathname + url.search + url.hash);
        } catch(_){}
        return clean;
      }
    } catch(_) {}

    try {
      const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
      if (sess && sess.slug) return normPlanillaSlug(sess.slug);
    } catch(_) {}

    try {
      const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
      if (sess2 && (sess2.slug || sess2.team)) return normPlanillaSlug(sess2.slug || sess2.team);
    } catch(_) {}

    try {
      const saved = sessionStorage.getItem('lpi_cruces_team') || localStorage.getItem('lpi_cruces_team') || '';
      if (saved) return normPlanillaSlug(saved);
    } catch(_) {}

    return '';
  }

  async function checkCrucesEnabled(teamSlug) {
    const app = document.getElementById('app-root');
    const grid = document.getElementById('crucesGrid');
    const cta = document.getElementById('validateCta');
    const err = document.getElementById('appError');

    const block = (title, msg) => {
      if (grid) grid.innerHTML = '';
      if (cta) cta.style.display = 'none';
      if (err) err.style.display = 'none';
      if (app) {
        app.innerHTML = `
          <div style="min-height:60vh;display:flex;align-items:center;justify-content:center;padding:24px;">
            <div style="max-width:560px;margin:0 auto;text-align:center;background:#151617;border:1px solid #ffffff10;border-radius:18px;padding:28px 24px;box-shadow:0 10px 40px #00000040;">
              <h2 style="margin:0 0 10px;color:#ffe65a;font-size:28px;font-weight:900;">${title}</h2>
              <p style="margin:0;color:#e9e9e9;font-size:16px;line-height:1.5;">${msg}</p>
            </div>
          </div>
        `;
      }
      return false;
    };

    if (!teamSlug) {
      return block('Cruces no disponibles', 'No se pudo identificar el equipo para mostrar los cruces.');
    }

    try {
      const fechaKey = new Date().toISOString().slice(0,10);
      const qs = new URLSearchParams({ team: teamSlug, fechaKey });
      const r = await fetch('/api/cruces/status?' + qs.toString(), { cache:'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.enabled) {
        return block('Cruces no habilitados', 'El administrador todavía no habilitó los cruces para esta fecha.');
      }
      return true;
    } catch (e) {
      return block('No se pudo verificar el acceso', 'Probá nuevamente en unos minutos.');
    }
  }

  // ---------------- CARGAR PLANILLAS DESDE BACKEND (MISMO ORIGEN QUE VISOR) ----------------
  async function loadFirstExistingPlanilla(slug) {
    const team = normPlanillaSlug(slug);

    try {
      const r = await fetch('/api/cruces/planilla?team=' + encodeURIComponent(team), {
        cache: 'no-store',
        credentials: 'same-origin'
      });

      if (!r.ok) throw new Error('HTTP ' + r.status);

      const data = await r.json();

      return {
        team: data.team || team,
        capitan: Array.isArray(data.capitan) ? data.capitan : [],
        individuales: Array.isArray(data.individuales) ? data.individuales : Array(7).fill(''),
        pareja1: Array.isArray(data.pareja1) ? data.pareja1 : [],
        pareja2: Array.isArray(data.pareja2) ? data.pareja2 : [],
        suplentes: Array.isArray(data.suplentes) ? data.suplentes : []
      };
    } catch (e) {
      console.warn('No se pudo cargar planilla desde backend para', team, e);
      return {
        team,
        capitan: [],
        individuales: Array(7).fill(''),
        pareja1: [],
        pareja2: [],
        suplentes: []
      };
    }
  }

  // ---------------- RENDER ----------------
  function createPtsSelect() {
    const wrap = document.createElement('div');
    wrap.className = 'pts-edit';
    const sel = document.createElement('select');
    sel.className = 'pts-select';
    for (let v = 0; v <= 5; v++) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = String(v);
      if (v === 0) opt.selected = true;
      sel.appendChild(opt);
    }
    wrap.appendChild(sel);
    return wrap;
  }

  function makeRow(num, text, side, includePoints = false) {
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

    let ptsElement = null;
    if (includePoints) {
      ptsElement = createPtsSelect();
    } else {
      ptsElement = document.createElement('div');
      ptsElement.className = 'pts-edit';
      ptsElement.style.visibility = 'hidden';
    }

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

  function renderSide(rootId, planilla, opponent, date, teamName) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML = '';

    const card = document.querySelector('#card-template').content.cloneNode(true).querySelector('.card');
    card.querySelector('.title').textContent = teamName.toUpperCase();
    card.querySelector('.meta').textContent = `vs ${opponent} · ${formatDate(date)}`;

    const secs = card.querySelector('.sections');
    const data = {
      'CAPITÁN': planilla.capitan || [],
      'INDIVIDUALES': planilla.individuales || [],
      'PAREJA 1': planilla.pareja1 || [],
      'PAREJA 2': planilla.pareja2 || [],
      'SUPLENTES': planilla.suplentes || []
    };

    const sections = ['CAPITÁN', 'INDIVIDUALES', 'PAREJA 1', 'PAREJA 2', 'SUPLENTES'];
    sections.forEach(sec => {
      const div = document.createElement('div');
      div.className = 'section';
      div.innerHTML = `<h2>${sec}</h2>`;

      const items = data[sec];

      if (sec.includes('PAREJA') && items.length === 2) {
        div.appendChild(makeRow(1, items[0], rootId.includes('left') ? 'left' : 'right', true));
        div.appendChild(makeRow(2, items[1], rootId.includes('left') ? 'left' : 'right', false));
      } else {
        const includePts = sec === 'INDIVIDUALES';
        items.forEach((p, i) => {
          div.appendChild(makeRow(i + 1, p, rootId.includes('left') ? 'left' : 'right', includePts));
        });
      }

      secs.appendChild(div);
    });

    root.appendChild(card);
  }

  // ---------------- SCORES: TRIÁNGULOS ARRIBA, PUNTOS ABAJO ----------------
  function updateScoresFor(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;

    let totalTri = 0;
    let totalPts = 0;

    root.querySelectorAll('.pts-select').forEach(sel => {
      const val = parseInt(sel.value, 10);
      if (!isNaN(val)) {
        totalPts += val;
        if (val === 5) totalTri++;
      }
    });

    const totalInput = root.querySelector('.total-input');
    if (totalInput) totalInput.value = totalPts;

    const winsBox = root.querySelector('.wins-box');
    if (winsBox) winsBox.textContent = totalTri;
  }

  // ---------------- VALIDACIÓN ----------------
  function setupValidationButtons(local, visitante, matchDate) {
    const cta = document.getElementById('validateCta');
    const btn = document.getElementById('btnValidarGlobal');
    if (!cta || !btn) return;

    document.querySelectorAll('.btn-validate').forEach(b => {
      if (b.id !== 'btnValidarGlobal') b.remove();
    });

    cta.style.display = 'flex';

     
// === AUTOSAVE + STATUS HELPERS ===
const toDateAR = (d = new Date()) => {
  const z = new Date(d.getTime() - (d.getTimezoneOffset() * 60000));
  const pad = n => String(n).padStart(2, '0');
  return `${z.getFullYear()}-${pad(z.getMonth()+1)}-${pad(z.getDate())}`;
};
const todayISO_AR = toDateAR();

const getLoggedSlug = () => {
  const qs = new URLSearchParams(location.search).get('team');
  if (qs) return String(qs).toLowerCase();
  try {
    const raw = localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session');
    const sess = raw ? JSON.parse(raw) : null;
    if (sess?.slug) return String(sess.slug).toLowerCase();
  } catch {}
  return String(sessionStorage.getItem('teamSlug') || localStorage.getItem('teamSlug') || '').toLowerCase();
};
const mySlug = getLoggedSlug();
const localSlug = local.teamSlug;
const visitanteSlug = visitante.teamSlug;
const AUTOSAVE_KEY = `lpi.autosave.${mySlug}.${todayISO_AR}.${(mySlug===localSlug?visitanteSlug:localSlug)}`;

function readAllSelects(rootId) {
  const root = document.getElementById(rootId);
  return Array.from(root.querySelectorAll('.pts-select')).map(sel => {
    const n = parseInt(sel.value, 10);
    return Number.isFinite(n) ? n : 0;
  });
}
function writeAllSelects(rootId, values) {
  const root = document.getElementById(rootId);
  const selects = Array.from(root.querySelectorAll('.pts-select'));
  selects.forEach((sel,i) => {
    if (i < values.length) {
      sel.value = String(values[i]);
      sel.dispatchEvent(new Event('change',{bubbles:true}));
    }
  });
}

function computeTotalsFrom(rootId) {
  const root = document.getElementById(rootId);
  const winsEl = root.querySelector('[data-wins]');
  const triEl  = root.querySelector('.total-input');
  const puntosTotales = parseInt((winsEl?.textContent || '0').trim(),10) || 0;
  const triangulos     = parseInt((triEl?.value ?? triEl?.textContent ?? '0').toString().trim(),10) || 0;
  return { triangulos, puntosTotales };
}

function sliceToStatus(values) {
  const jugadores = values.slice(0,7);
  const pareja1 = { j1: values[7]  ?? 0, j2: values[8]  ?? 0 };
  const pareja2 = { j1: values[9]  ?? 0, j2: values[10] ?? 0 };
  return { jugadores, parejas: { pareja1, pareja2 } };
}

function buildMatchStatus() {
  const leftVals  = readAllSelects('planilla-root-left');
  const rightVals = readAllSelects('planilla-root-right');
  const leftT  = computeTotalsFrom('planilla-root-left');
  const rightT = computeTotalsFrom('planilla-root-right');
  const localData     = sliceToStatus(leftVals);
  const visitanteData = sliceToStatus(rightVals);
  return {
    fechaISO: todayISO_AR,
    local:     { ...localData,     triangulosTotales: leftT.triangulos,  puntosTotales: leftT.puntosTotales },
    visitante:{ ...visitanteData, triangulosTotales: rightT.triangulos, puntosTotales: rightT.puntosTotales }
  };
}

async function saveMatchStatus() {
  const status = buildMatchStatus();
  const body = { localSlug, visitanteSlug, fechaISO: todayISO_AR, status };
  const res = await fetch('/api/guardar-status-match', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  return res.ok;
}

// AUTOSAVE
function autosaveSave() {
  try {
    const payload = { fechaISO: todayISO_AR, left: readAllSelects('planilla-root-left'), right: readAllSelects('planilla-root-right') };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
  } catch {}
}
function autosaveLoad() { try{ const raw=localStorage.getItem(AUTOSAVE_KEY); return raw?JSON.parse(raw):null; }catch{ return null; } }
function autosaveApplyIfAny() {
  const data = autosaveLoad();
  if (!data || data.fechaISO !== todayISO_AR) return;
  writeAllSelects('planilla-root-left', data.left||[]);
  writeAllSelects('planilla-root-right', data.right||[]);
}
function autosaveClear(){ try{ localStorage.removeItem(AUTOSAVE_KEY);}catch{} }
let autosaveTimer=null;
function scheduleAutosave(){ clearTimeout(autosaveTimer); autosaveTimer=setTimeout(autosaveSave,400); }
function autosaveAttachListeners(){
  ['planilla-root-left','planilla-root-right'].forEach(id=>{
    const root = document.getElementById(id);
    root.addEventListener('change', ev => {
      if (ev.target && ev.target.classList && ev.target.classList.contains('pts-select')) scheduleAutosave();
    });
  });
}

// STATUS autocarga si existe
async function tryApplyStatusIfExists(){
  const src = `../cruces/status/${localSlug}.vs.${visitanteSlug}.js`;
  try {
    const data = await loadGlobalScript(src,'LPI_STATUS');
    if (!data || data.fechaISO !== todayISO_AR) return false;
    const L = [...(data.local.jugadores||[]), data.local.parejas?.pareja1?.j1 ?? 0, data.local.parejas?.pareja1?.j2 ?? 0, data.local.parejas?.pareja2?.j1 ?? 0, data.local.parejas?.pareja2?.j2 ?? 0];
    const R = [...(data.visitante.jugadores||[]), data.visitante.parejas?.pareja1?.j1 ?? 0, data.visitante.parejas?.pareja1?.j2 ?? 0, data.visitante.parejas?.pareja2?.j1 ?? 0, data.visitante.parejas?.pareja2?.j2 ?? 0];
    writeAllSelects('planilla-root-left',L);
    writeAllSelects('planilla-root-right',R);
    document.querySelectorAll('#planilla-root-left .pts-select, #planilla-root-right .pts-select').forEach(el=>el.disabled=true);
    const btn = document.getElementById('btnValidarGlobal');
    if (btn){ btn.textContent='VALIDADO'; btn.classList.add('success'); btn.disabled=true; }
    return true;
  } catch { return false; }
}

// Inicializar
autosaveApplyIfAny();
autosaveAttachListeners();
tryApplyStatusIfExists();
btn.onclick = async () => {
  const btnVolver = document.getElementById('btnVolver');
  const volverClass = btnVolver ? btnVolver.className : 'btn';

  const setBtnState = (mode, text) => {
    btn.disabled = (mode === 'success');
    btn.classList.remove('success','error','pending','rival-pending','btn','btn-validate');
    if (mode === 'pending') {
      text && (btn.textContent = text);
      volverClass.split(/\s+/).forEach(c => c && btn.classList.add(c));
    } else {
      btn.classList.add('btn-validate');
      btn.classList.add(mode);
      text && (btn.textContent = text);
    }
  };

  const sameTotalsStrict = (a, b) => {
    return (
      a.equipo1.triangulos    === b.equipo1.triangulos   &&
      a.equipo1.puntosTotales === b.equipo1.puntosTotales &&
      a.equipo2.triangulos    === b.equipo2.triangulos   &&
      a.equipo2.puntosTotales === b.equipo2.puntosTotales
    );
  };

  try {
    btn.disabled = true;
    setBtnState('pending','VALIDANDO...');

    const mySlug = getLoggedSlug();
    if (!mySlug) throw new Error('No pude determinar el equipo logueado.');
    const rivalSlug = (mySlug === localSlug) ? visitanteSlug : localSlug;

    const lockRes = await fetch(`/api/validar-lock?slug=${encodeURIComponent(mySlug)}&fechaISO=${encodeURIComponent(todayISO_AR)}`).catch(()=>null);
    if (lockRes && lockRes.ok) {
      const lock = await lockRes.json().catch(()=>null);
      if (lock?.locked) { setBtnState('success','VALIDADO'); return; }
    }

    const left  = computeTotalsFrom('planilla-root-left');
    const right = computeTotalsFrom('planilla-root-right');
    if ((left.puntosTotales + right.puntosTotales) !== 9) {
    setBtnState('error','ERROR: La suma de puntos debe ser 9');
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('success','error','pending','rival-pending','btn');
      btn.classList.add('btn-validate');
      btn.textContent = 'VALIDAR PLANILLA';
    }, 3000);
    return;
    }

    const mine = {
      fechaISO: todayISO_AR,
      equipo1: { triangulos:left.triangulos,  puntosTotales:left.puntosTotales },
      equipo2: { triangulos:right.triangulos, puntosTotales:right.puntosTotales }
    };

    const save = await fetch('/api/validar-planilla', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ slug: mySlug, validacion: mine })
    });
    const saveData = await save.json().catch(()=>null);
    if (!save.ok || !saveData?.ok) { setBtnState('error','ERROR: No se pudo guardar'); return; }

    const rivalSrc = `../cruces/${rivalSlug}.validacion.js`;
    const rivalVal = await loadGlobalScript(rivalSrc,'LPI_VALIDACION').catch(()=>null);
    if (!rivalVal || rivalVal.fechaISO !== todayISO_AR) { setBtnState('pending','PENDIENTE: tu rival todavía no validó'); return; }
    if (!sameTotalsStrict(mine, rivalVal)) {
      setBtnState('error','Los datos no coinciden, verificar con su rival');
      setTimeout(() => {
        // volver al estado pendiente anterior
        setBtnState('pending','PENDIENTE: tu rival todavía no validó');
        btn.disabled = false;
      }, 3000);
      return;
    }

    const lockBody = { slug: mySlug, fechaISO: todayISO_AR, lockUntil: new Date(Date.now()+24*60*60*1000).toISOString() };
    await fetch('/api/validar-lock', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(lockBody) }).catch(()=>{});

    await saveMatchStatus();
    autosaveClear();

    setBtnState('success','VALIDACIÓN EXITOSA');
    showToast('Validación exitosa','success');
    setTimeout(() => {
      window.location.reload();
    }, 3000);
  } catch (e) {
    console.error(e);
    setBtnState('error', e?.message || 'Error inesperado');
  } finally {
    if (!btn.classList.contains('success')) btn.disabled = false;
  }
};;;

  }

  function collectPlanilla(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return null;

    const plan = {
      capitan: [],
      individuales: [],
      pareja1: [],
      pareja2: [],
      suplentes: []
    };

    root.querySelectorAll('.section').forEach(sec => {
      const title = sec.querySelector('h2')?.textContent.toUpperCase();
      const target = title.includes('CAPITÁN') ? 'capitan' :
                    title.includes('INDIVIDUALES') ? 'individuales' :
                    title.includes('PAREJA 1') ? 'pareja1' :
                    title.includes('PAREJA 2') ? 'pareja2' :
                    title.includes('SUPLENTES') ? 'suplentes' : null;

      if (!target) return;

      sec.querySelectorAll('.slot').forEach(slot => {
        const text = slot.getAttribute('data-full') || slot.textContent.trim();
        if (text) plan[target].push(text);
      });

      if (target === 'individuales' || target === 'pareja1' || target === 'pareja2') {
        const ptsSelects = sec.querySelectorAll('.pts-select');
        if (!plan[target + 'Pts']) plan[target + 'Pts'] = [];
        ptsSelects.forEach((sel, i) => {
          plan[target + 'Pts'][i] = parseInt(sel.value, 10) || 0;
        });
      }
    });

    return plan;
  }

  function showToast(msg, type = 'info') {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = `toast toast-${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // ---------------- SYNC ----------------
  function syncSlotWidths() {
    const slots = document.querySelectorAll('.slot:not(.is-empty)');
    let max = 0;
    slots.forEach(s => { if (s.scrollWidth > max) max = s.scrollWidth; });
    const target = Math.min(Math.max(160, max + 34), 400);
    document.documentElement.style.setProperty('--slot-base-w', target + 'px');
  }

  function syncHeaderHeights() {
    const left = document.querySelector('#planilla-root-left .title');
    const right = document.querySelector('#planilla-root-right .title');
    if (left && right) {
      const h = Math.max(left.offsetHeight, right.offsetHeight);
      left.style.minHeight = right.style.minHeight = `${h}px`;
    }
  }

  // ---------------- BOOT ----------------
  async function bootCruces() {
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Cargando...';
    document.getElementById('app-root').appendChild(loading);

    try {
      const teamSlug = getStoredCrucesTeam();
      if (!teamSlug) throw new Error('Falta equipo');

      const [fixtureData] = await Promise.all([
        loadAllFixtures()
      ]);

      const allMatches = findAllMatchesForTeam(fixtureData, teamSlug);
      if (allMatches.length === 0) throw new Error('Partido no encontrado');

      const match = pickBestByClosestDate(allMatches);
      if (!match) throw new Error('No hay partido futuro');

      const local = { name: match.local, teamSlug: match.localSlug };
      const visitante = { name: match.visitante, teamSlug: match.visitanteSlug };

      const isLocal = normPlanillaSlug(local.name) === normPlanillaSlug(teamSlug);

      const localPlan = await loadFirstExistingPlanilla(local.teamSlug);
      const visitantePlan = await loadFirstExistingPlanilla(visitante.teamSlug);

renderSide('planilla-root-left',  localPlan,     visitante.name, match.date, local.name);
renderSide('planilla-root-right', visitantePlan, local.name,     match.date, visitante.name);

      ['planilla-root-left', 'planilla-root-right'].forEach(id => {
        const root = document.getElementById(id);
        root?.addEventListener('change', e => {
          if (e.target?.classList?.contains('pts-select')) updateScoresFor(id);
        });
      });

      updateScoresFor('planilla-root-left');
      updateScoresFor('planilla-root-right');

      setupValidationButtons(local, visitante, match.date);

      requestAnimationFrame(() => {
        syncSlotWidths();
        syncHeaderHeights();
      });
    } catch (e) {
      console.error(e);
      const err = document.getElementById('appError');
      if (err) { err.style.display = 'block'; err.textContent = e.message || 'Error al cargar'; }
    } finally {
      loading.remove();
    }
  }

  // ---------------- INIT ----------------
window.addEventListener('load', async () => {
  const teamSlug = getStoredCrucesTeam();
  const allowed = await checkCrucesEnabled(teamSlug);

  if (allowed) {
    bootCruces().catch(console.error);
  }

  // === BOTÓN VOLVER ===
  const volverBtn = document.getElementById('btnVolver');
  if (volverBtn) {
    volverBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.history.back();
    });
  }
});

let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    syncSlotWidths();
    syncHeaderHeights();
  });
});
})();