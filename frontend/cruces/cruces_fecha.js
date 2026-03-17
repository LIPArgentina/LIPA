/* cruces_fecha.js — FINAL: TRIÁNGULOS ARRIBA, PUNTOS ABAJO, PAREJAS 1 SELECT, RUTA ../fecha/ */
(() => {
  'use strict';
  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || "https://liga-backend-tt82.onrender.com").replace(/\/+$/, "");  // ---------------- UTILS ----------------
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
  async function loadJson(src) {
    const r = await fetch(src, { cache: 'no-store' });
    if (!r.ok) throw new Error('No se pudo cargar ' + src + ' (' + r.status + ')');
    return r.json();
  }

  async function loadAllFixtures() {
    const isFile = location.protocol === 'file:';
    const apiBase = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG?.API_BASE_URL) ? APP_CONFIG.API_BASE_URL : '';
    const localWinBase = 'file:///C:/Users/javie/Desktop/LIGA/frontend/fixture/';
    const httpBase = apiBase ? (apiBase.replace(/\/$/, '') + '/fixture/') : '/fixture/';
    const relBase = '../fixture/';
    const relBase2 = './fixture/';
    const legacyBase = '/frontend/fixture/';
    const names = [
      'fixture.ida.tercera.json',
      'fixture.vuelta.tercera.json',
      'fixture.ida.segunda.json',
      'fixture.vuelta.segunda.json'
    ];

    const sources = isFile
      ? [
          ...names.map(n => localWinBase + n),
          ...names.map(n => httpBase + n),
          ...names.map(n => relBase + n),
          ...names.map(n => relBase2 + n),
          ...names.map(n => legacyBase + n)
        ]
      : [
          ...names.map(n => httpBase + n),
          ...names.map(n => relBase + n),
          ...names.map(n => relBase2 + n),
          ...names.map(n => legacyBase + n)
        ];

    const results = await Promise.allSettled(sources.map(src => loadJson(src)));
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

  function findAllMatchesForTeam(fixtures, teamCandidates) {
    const wanted = new Set(
      (Array.isArray(teamCandidates) ? teamCandidates : [teamCandidates])
        .map(v => normPlanillaSlug(v))
        .filter(Boolean)
    );

    const matches = [];
    for (const fix of fixtures) {
      for (const fecha of fix.fechas) {
        for (const tabla of (fecha.tablas || [])) {
          const equipos = (tabla.equipos || []);
          for (const [loc, vis] of iteratePairs(equipos)) {
            const nLoc = normPlanillaSlug(loc);
            const nVis = normPlanillaSlug(vis);
            if (wanted.has(nLoc) || wanted.has(nVis)) {
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


  function getStoredCrucesCandidates() {
    const out = [];
    const push = (value) => {
      const clean = normPlanillaSlug(value);
      if (clean && !out.includes(clean)) out.push(clean);
    };

    try {
      const qs = new URLSearchParams(location.search).get('team');
      if (qs) {
        push(qs);
        try { sessionStorage.setItem('lpi_cruces_team', normPlanillaSlug(qs)); } catch(_){}
        try { localStorage.setItem('lpi_cruces_team', normPlanillaSlug(qs)); } catch(_){}
        try {
          const url = new URL(location.href);
          url.searchParams.delete('team');
          history.replaceState({}, '', url.pathname + url.search + url.hash);
        } catch(_){}
      }
    } catch(_) {}

    try {
      const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
      if (sess) {
        push(sess.slug);
        push(sess.team);
        push(sess.displayName);
        push(sess.teamName);
        push(sess.name);
        push(sess.user);
      }
    } catch(_) {}

    try {
      const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
      if (sess2) {
        push(sess2.slug);
        push(sess2.team);
        push(sess2.displayName);
        push(sess2.teamName);
        push(sess2.name);
        push(sess2.user);
      }
    } catch(_) {}

    try {
      push(sessionStorage.getItem('lpi_cruces_team'));
      push(localStorage.getItem('lpi_cruces_team'));
      push(sessionStorage.getItem('teamSlug'));
      push(localStorage.getItem('teamSlug'));
      push(sessionStorage.getItem('team'));
      push(localStorage.getItem('team'));
    } catch(_) {}

    return out;
  }

  function getStoredCrucesTeam() {
    const candidates = getStoredCrucesCandidates();
    return candidates[0] || '';
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
      const r = await fetch(`${API_BASE}/api/cruces/status?` + qs.toString(), { cache:'no-store' });
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
  let __PLANILLAS_CACHE = null;

  function emptyPlanilla(team = '') {
    return {
      team,
      capitan: ['', ''],
      individuales: Array(7).fill(''),
      pareja1: ['', ''],
      pareja2: ['', ''],
      suplentes: ['', '', '']
    };
  }

  async function loadPlanillasIndex() {
    if (__PLANILLAS_CACHE) return __PLANILLAS_CACHE;

    const map = new Map();

    try {
      const r = await fetch(`${API_BASE}/api/admin/planillas`, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);

      const arr = await r.json();
      if (Array.isArray(arr)) {
        arr.forEach(item => {
          const teamKey = normPlanillaSlug(item?.team || item?.slug || item?.equipo || '');
          const plan = item?.planilla || item?.plan || item || {};
          if (teamKey) {
            map.set(teamKey, {
              team: item?.team || teamKey,
              capitan: Array.isArray(plan.capitan) ? plan.capitan : ['', ''],
              individuales: Array.isArray(plan.individuales) ? plan.individuales : Array(7).fill(''),
              pareja1: Array.isArray(plan.pareja1) ? plan.pareja1 : ['', ''],
              pareja2: Array.isArray(plan.pareja2) ? plan.pareja2 : ['', ''],
              suplentes: Array.isArray(plan.suplentes) ? plan.suplentes : ['', '', '']
            });
          }
        });
      }
    } catch (e) {
      console.warn('No se pudo cargar índice global de planillas', e);
    }

    __PLANILLAS_CACHE = map;
    return map;
  }

  async function loadFirstExistingPlanilla(slug) {
    const team = normPlanillaSlug(slug);

    try {
      const planillas = await loadPlanillasIndex();
      if (planillas && planillas.has(team)) {
        return planillas.get(team);
      }
    } catch (e) {
      console.warn('Índice de planillas no disponible para', team, e);
    }

    try {
      const r = await fetch(`${API_BASE}/api/team/planilla?team=` + encodeURIComponent(team), {
        cache: 'no-store',
        credentials: 'same-origin'
      });

      if (!r.ok) throw new Error('HTTP ' + r.status);

      const data = await r.json();
      const plan = data?.planilla || data || {};

      return {
        team: data?.team || plan?.team || team,
        capitan: Array.isArray(plan.capitan) ? plan.capitan : ['', ''],
        individuales: Array.isArray(plan.individuales) ? plan.individuales : Array(7).fill(''),
        pareja1: Array.isArray(plan.pareja1) ? plan.pareja1 : ['', ''],
        pareja2: Array.isArray(plan.pareja2) ? plan.pareja2 : ['', ''],
        suplentes: Array.isArray(plan.suplentes) ? plan.suplentes : ['', '', '']
      };
    } catch (e) {
      console.warn('No se pudo cargar planilla desde backend para', team, e);
      return emptyPlanilla(team);
    }
  }

  // ---------------- RENDER ----------------
  function createPtsSelect() {
    const wrap = document.createElement('div');
    wrap.className = 'pts-edit';
    const sel = document.createElement('select');
    sel.className = 'pts-select';
    for (let v = 0; v <= 6; v++) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = String(v);
      if (v === 0) opt.selected = true;
      sel.appendChild(opt);
    }
    wrap.appendChild(sel);
    return wrap;
  }

  function makeRow(num, text, side, includePoints = false, sectionKey = '') {
    const row = document.createElement('div');
    row.className = 'row';
    if (sectionKey) row.dataset.section = sectionKey;

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = String(num);

    const slot = document.createElement('div');
    const isEmpty = !text || !String(text).trim();
    slot.className = 'slot' + (isEmpty ? ' is-empty' : '');
    if (sectionKey) slot.dataset.section = sectionKey;
    slot.dataset.side = side;
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

      const side = rootId.includes('left') ? 'left' : 'right';
      if (sec.includes('PAREJA') && items.length === 2) {
        div.appendChild(makeRow(1, items[0], side, true, sec));
        div.appendChild(makeRow(2, items[1], side, false, sec));
      } else {
        const includePts = sec === 'INDIVIDUALES';
        items.forEach((p, i) => {
          div.appendChild(makeRow(i + 1, p, side, includePts, sec));
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

    let totalEquipo = 0;
    let totalPts = 0;

    root.querySelectorAll('.row').forEach(row => {
      const sel = row.querySelector('.pts-select');
      if (!sel) return;

      const val = parseInt(sel.value, 10);
      if (isNaN(val)) return;

      totalPts += val;

      const section = String(row.dataset.section || '').toUpperCase();

      if (section === 'INDIVIDUALES') {
        if (val === 5 || val === 6) totalEquipo++;
      } else if (section === 'PAREJA 1' || section === 'PAREJA 2') {
        if (val === 4 || val === 5 || val === 6) totalEquipo++;
      }
    });

    const totalInput = root.querySelector('.total-input');
    if (totalInput) totalInput.value = totalPts;

    const winsBox = root.querySelector('.wins-box');
    if (winsBox) winsBox.textContent = totalEquipo;
  }


  // ---------------- CAMBIOS CON SUPLENTES ----------------
  function ensureSwapStyles(){
    if (document.getElementById('swap-styles')) return;
    const style = document.createElement('style');
    style.id = 'swap-styles';
    style.textContent = `
      .slot.slot-selected-sub{
        background:#9bf59b !important;
        box-shadow:0 0 0 2px #31c45b inset;
        color:#092b09 !important;
      }
      .slot.slot-sub-in{
        background:#c8ffb8 !important;
        box-shadow:0 0 0 2px #55c44d inset;
        color:#16320f !important;
      }
      .slot.slot-sub-out{
        background:#ffb6b6 !important;
        box-shadow:0 0 0 2px #d94b4b inset;
        color:#4a1010 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function setSlotValue(slot, value){
    const txt = String(value || '').trim();
    if (txt) {
      slot.textContent = txt;
      slot.setAttribute('data-full', txt);
      slot.classList.remove('is-empty');
    } else {
      slot.textContent = '';
      slot.removeAttribute('data-full');
      slot.classList.add('is-empty');
    }
  }

  function getSlotValue(slot){
    return (slot.getAttribute('data-full') || slot.textContent || '').trim();
  }

  function lockValidatedMatchUI(){
    document.querySelectorAll('#planilla-root-left .pts-select, #planilla-root-right .pts-select').forEach(el => {
      el.disabled = true;
    });

    document.querySelectorAll('#planilla-root-left .slot, #planilla-root-right .slot').forEach(slot => {
      slot.style.pointerEvents = 'none';
      slot.style.cursor = 'default';
      slot.classList.remove('slot-selected-sub', 'slot-sub-in', 'slot-sub-out');
    });

    const btn = document.getElementById('btnValidarGlobal');
    if (btn){
      btn.textContent = 'VALIDADO';
      btn.classList.add('success');
      btn.disabled = true;
    }
  }

  function clearSwapMarks(root){
    root.querySelectorAll('.slot').forEach(s => {
      s.classList.remove('slot-selected-sub', 'slot-sub-in', 'slot-sub-out');
    });
  }

  function setupSuplentesSwap(rootId){
    ensureSwapStyles();
    const root = document.getElementById(rootId);
    if (!root) return;

    let selectedBenchSlot = null;

    const getSectionName = (slot) => {
      const sec = slot.closest('.section');
      return (sec?.querySelector('h2')?.textContent || '').toUpperCase();
    };

    const isBenchSlot = (slot) => getSectionName(slot).includes('SUPLENTES');
    const isSwappableField = (slot) => {
      const name = getSectionName(slot);
      return name.includes('INDIVIDUALES') || name.includes('PAREJA 1') || name.includes('PAREJA 2');
    };

    root.querySelectorAll('.slot').forEach(slot => {
      if (slot.dataset.swapWired === '1') return;
      slot.dataset.swapWired = '1';
      slot.style.cursor = 'pointer';

      slot.addEventListener('click', () => {
        const slotValue = getSlotValue(slot);
        if (!slotValue) return;

        if (isBenchSlot(slot)) {
          root.querySelectorAll('.slot.slot-selected-sub').forEach(s => s.classList.remove('slot-selected-sub'));
          slot.classList.remove('slot-sub-in', 'slot-sub-out');
          slot.classList.add('slot-selected-sub');
          selectedBenchSlot = slot;
          root.dispatchEvent(new Event('cruces:changed'));
          return;
        }

        if (!selectedBenchSlot) return;
        if (!isSwappableField(slot)) return;
        if (selectedBenchSlot === slot) return;

        const currentFieldPlayer = getSlotValue(slot);
        const selectedSub = getSlotValue(selectedBenchSlot);
        if (!currentFieldPlayer || !selectedSub) return;

        root.querySelectorAll('.slot.slot-sub-in, .slot.slot-sub-out').forEach(s => {
          s.classList.remove('slot-sub-in', 'slot-sub-out');
        });

        setSlotValue(slot, selectedSub);
        setSlotValue(selectedBenchSlot, currentFieldPlayer);

        slot.classList.remove('slot-selected-sub');
        slot.classList.add('slot-sub-in');

        selectedBenchSlot.classList.remove('slot-selected-sub');
        selectedBenchSlot.classList.add('slot-sub-out');
        selectedBenchSlot.classList.add('slot-selected-sub');

        root.dispatchEvent(new Event('cruces:changed'));
      });
    });
  }

  function applyCollectedPlanilla(rootId, plan) {
    const root = document.getElementById(rootId);
    if (!root || !plan) return;

    const map = {
      'CAPITÁN': Array.isArray(plan.capitan) ? plan.capitan : [],
      'INDIVIDUALES': Array.isArray(plan.individuales) ? plan.individuales : [],
      'PAREJA 1': Array.isArray(plan.pareja1) ? plan.pareja1 : [],
      'PAREJA 2': Array.isArray(plan.pareja2) ? plan.pareja2 : [],
      'SUPLENTES': Array.isArray(plan.suplentes) ? plan.suplentes : [],
    };

    root.querySelectorAll('.section').forEach(sec => {
      const title = (sec.querySelector('h2')?.textContent || '').toUpperCase();
      const values = map[title];
      if (!values) return;
      const slots = sec.querySelectorAll('.slot');
      slots.forEach((slot, idx) => {
        setSlotValue(slot, values[idx] || '');
      });
    });

    clearSwapMarks(root);
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

function buildMatchStatus(validated = false) {
  const leftVals  = readAllSelects('planilla-root-left');
  const rightVals = readAllSelects('planilla-root-right');
  const leftT  = computeTotalsFrom('planilla-root-left');
  const rightT = computeTotalsFrom('planilla-root-right');
  const localData     = sliceToStatus(leftVals);
  const visitanteData = sliceToStatus(rightVals);
  return {
    fechaISO: todayISO_AR,
    validated: !!validated,
    localSlug,
    visitanteSlug,
    localPlanilla: collectPlanilla('planilla-root-left'),
    visitantePlanilla: collectPlanilla('planilla-root-right'),
    local:     { ...localData,     triangulosTotales: leftT.triangulos,  puntosTotales: leftT.puntosTotales },
    visitante: { ...visitanteData, triangulosTotales: rightT.triangulos, puntosTotales: rightT.puntosTotales }
  };
}

async function saveMatchStatus(validated = false) {
  const status = buildMatchStatus(validated);
  const body = {
    localSlug,
    visitanteSlug,
    fechaISO: todayISO_AR,
    equipoSlug: mySlug,
    status,
    validar: !!validated
  };
  const res = await fetch(`${API_BASE}/api/cruces/match-status`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'No se pudo guardar el status del cruce');
  }
  return data;
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
let serverSaveTimer=null;
function scheduleAutosave(){
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveSave, 300);

  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(async () => {
    try { await saveMatchStatus(false); } catch(e) { console.warn('autosave cruces', e); }
  }, 600);
}
function autosaveAttachListeners(){
  ['planilla-root-left','planilla-root-right'].forEach(id=>{
    const root = document.getElementById(id);
    root.addEventListener('change', ev => {
      if (ev.target && ev.target.classList && ev.target.classList.contains('pts-select')) scheduleAutosave();
    });
    root.addEventListener('cruces:changed', scheduleAutosave);
  });
}

// STATUS autocarga: primero borrador propio, si no existe compartido final
async function tryApplyStatusIfExists(){
  try {
    const qs = new URLSearchParams({
      localSlug,
      visitanteSlug,
      fechaISO: todayISO_AR,
      equipoSlug: mySlug
    });
    const res = await fetch(`${API_BASE}/api/cruces/match-status?` + qs.toString(), {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const result = await res.json().catch(() => null);
    if (!res.ok || !result?.ok || !result?.data) return false;

    const data = result.data;
    if (data.localPlanilla) applyCollectedPlanilla('planilla-root-left', data.localPlanilla);
    if (data.visitantePlanilla) applyCollectedPlanilla('planilla-root-right', data.visitantePlanilla);

    const L = [...(data.local?.jugadores||[]), data.local?.parejas?.pareja1?.j1 ?? 0, data.local?.parejas?.pareja1?.j2 ?? 0, data.local?.parejas?.pareja2?.j1 ?? 0, data.local?.parejas?.pareja2?.j2 ?? 0];
    const R = [...(data.visitante?.jugadores||[]), data.visitante?.parejas?.pareja1?.j1 ?? 0, data.visitante?.parejas?.pareja1?.j2 ?? 0, data.visitante?.parejas?.pareja2?.j1 ?? 0, data.visitante?.parejas?.pareja2?.j2 ?? 0];
    writeAllSelects('planilla-root-left', L);
    writeAllSelects('planilla-root-right', R);
    updateScoresFor('planilla-root-left');
    updateScoresFor('planilla-root-right');

    if (data.validated === true) {
      lockValidatedMatchUI();
    }
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

    const lockRes = await fetch(`${API_BASE}/api/cruces/lock-status?fechaISO=${encodeURIComponent(todayISO_AR)}&equipoSlug=${encodeURIComponent(mySlug)}&localSlug=${encodeURIComponent(localSlug)}&visitanteSlug=${encodeURIComponent(visitanteSlug)}`).catch(()=>null);
    if (lockRes && lockRes.ok) {
      const lock = await lockRes.json().catch(()=>null);
      if (lock?.locked || lock?.validatedFinal) { setBtnState('success','VALIDADO'); return; }
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

    const statusForValidate = buildMatchStatus(true);
    const save = await fetch(`${API_BASE}/api/cruces/validate`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        fechaISO: todayISO_AR,
        localSlug,
        visitanteSlug,
        equipoSlug: mySlug,
        validacion: mine,
        status: statusForValidate
      })
    });
    const saveData = await save.json().catch(()=>null);
    if (!save.ok || !saveData) { setBtnState('error','ERROR: No se pudo guardar'); return; }

    if (saveData?.tipo === 'pendiente') {
      setBtnState('pending', saveData?.mensaje || 'PENDIENTE: tu rival todavía no validó');
      return;
    }

    if (saveData?.tipo === 'mismatch' || saveData?.ok === false) {
      setBtnState('error', saveData?.error || 'Los datos no coinciden, verificar con su rival');
      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('success','error','pending','rival-pending','btn');
        btn.classList.add('btn-validate');
        btn.textContent = 'VALIDAR PLANILLA';
      }, 3000);
      return;
    }

    const statusResult = saveData;

    if (statusResult?.tipo !== 'validado' && statusResult?.ok !== true) {
      setBtnState('pending', statusResult?.mensaje || 'PENDIENTE: falta coincidencia final con tu rival');
      return;
    }

    autosaveClear();
    lockValidatedMatchUI();

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
    const leftTitle = document.querySelector('#planilla-root-left .title');
    const rightTitle = document.querySelector('#planilla-root-right .title');
    const leftMeta = document.querySelector('#planilla-root-left .meta');
    const rightMeta = document.querySelector('#planilla-root-right .meta');

    if (!leftTitle || !rightTitle || !leftMeta || !rightMeta) return;

    leftTitle.style.minHeight = '';
    rightTitle.style.minHeight = '';
    leftMeta.style.minHeight = '';
    rightMeta.style.minHeight = '';

    const maxTitle = Math.max(leftTitle.offsetHeight, rightTitle.offsetHeight);
    const maxMeta = Math.max(leftMeta.offsetHeight, rightMeta.offsetHeight);

    leftTitle.style.minHeight = maxTitle + 'px';
    rightTitle.style.minHeight = maxTitle + 'px';
    leftMeta.style.minHeight = maxMeta + 'px';
    rightMeta.style.minHeight = maxMeta + 'px';
  }

  function syncSectionStarts() {
    const leftCard = document.querySelector('#planilla-root-left .card');
    const rightCard = document.querySelector('#planilla-root-right .card');
    const leftFirstSection = document.querySelector('#planilla-root-left .section');
    const rightFirstSection = document.querySelector('#planilla-root-right .section');

    if (!leftCard || !rightCard || !leftFirstSection || !rightFirstSection) return;

    leftFirstSection.style.marginTop = '';
    rightFirstSection.style.marginTop = '';

    const leftTop = leftFirstSection.getBoundingClientRect().top - leftCard.getBoundingClientRect().top;
    const rightTop = rightFirstSection.getBoundingClientRect().top - rightCard.getBoundingClientRect().top;

    if (leftTop < rightTop) {
      leftFirstSection.style.marginTop = (26 + (rightTop - leftTop)) + 'px';
    } else if (rightTop < leftTop) {
      rightFirstSection.style.marginTop = (26 + (leftTop - rightTop)) + 'px';
    }
  }

  function syncRowHeights() {
    const leftRows = document.querySelectorAll('#planilla-root-left .row');
    const rightRows = document.querySelectorAll('#planilla-root-right .row');

    const max = Math.max(leftRows.length, rightRows.length);

    leftRows.forEach(r => { r.style.height = ''; });
    rightRows.forEach(r => { r.style.height = ''; });

    for (let i = 0; i < max; i++) {
      const l = leftRows[i];
      const r = rightRows[i];
      if (!l || !r) continue;

      const h = Math.max(l.offsetHeight, r.offsetHeight);
      l.style.height = h + 'px';
      r.style.height = h + 'px';
    }
  }


  // ---------------- BOOT ----------------
  async function bootCruces() {
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Cargando...';
    document.getElementById('app-root').appendChild(loading);

    try {
      const teamCandidates = getStoredCrucesCandidates();
      const teamSlug = teamCandidates[0] || '';
      if (!teamSlug) throw new Error('Falta equipo');

      const [fixtureData] = await Promise.all([
        loadAllFixtures()
      ]);

      const allMatches = findAllMatchesForTeam(fixtureData, teamCandidates);
      if (allMatches.length === 0) {
        throw new Error('Partido no encontrado para: ' + teamCandidates.join(', '));
      }

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

      setupSuplentesSwap('planilla-root-left');
      setupSuplentesSwap('planilla-root-right');

      setupValidationButtons(local, visitante, match.date);

      requestAnimationFrame(() => {
        syncSlotWidths();
        syncHeaderHeights();
        syncSectionStarts();
        syncRowHeights();
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
    syncSectionStarts();
    syncRowHeights();
  });
});
})();