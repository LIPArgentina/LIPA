/* cruces_fecha.js — FINAL: TRIÁNGULOS ARRIBA, PUNTOS ABAJO, PAREJAS 1 SELECT, RUTA ../fecha/ */
(() => {
  'use strict';  // ---------------- UTILS ----------------
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
    const raw = String(iso || '').trim();
    if (!raw) return '';
    try {
      const d = parseISOAsLocal(raw);
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
      if (d.getFullYear() < 2000) return '';
      return dtf.format(d);
    } catch {
      return '';
    }
  };

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || 'https://liga-backend-tt82.onrender.com').replace(/\/+$/, '');
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
      const aliasKeys = [canonical, ...aliases].map(v => compactKey(v)).filter(Boolean);
      if (aliasKeys.includes(compact) || aliasKeys.includes(baseCompact) || aliasKeys.includes(slugCompact)) {
        aliasKeys.forEach(v => variants.add(v));
      }
    }

    return [...variants].filter(Boolean);
  }

  function withBust(params){
  const qs = new URLSearchParams(params);
  qs.set('_', String(Date.now()));
  return qs;
}

function apiUrl(path){
    if (!API_BASE) return path;
    return API_BASE + path;
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

  function deriveCategory(){
    const fromUrl = new URLSearchParams(location.search).get('cat');
    const normalizeCategory = (raw) => {
      const v = String(raw || '').trim().toLowerCase();
      if (!v) return '';
      if (v.includes('terc')) return 'tercera';
      if (v.includes('seg')) return 'segunda';
      if (v === '3' || v === 'c') return 'tercera';
      if (v === '2' || v === 'b') return 'segunda';
      return '';
    };

    const urlCat = normalizeCategory(fromUrl);
    if (urlCat) return urlCat;

    try {
      const sess = JSON.parse(localStorage.getItem('lpi.session') || sessionStorage.getItem('lpi.session') || 'null');
      const val = normalizeCategory(sess && (sess.category || sess.categoria || sess.cat || sess.division || sess['división'] || sess.teamCategory || (sess.user && (sess.user.category || sess.user.categoria || sess.user.division))));
      if (val) return val;
    } catch (_) {}

    try {
      const sess2 = JSON.parse(localStorage.getItem('lpi_team_session') || sessionStorage.getItem('lpi_team_session') || 'null');
      const val = normalizeCategory(sess2 && (sess2.category || sess2.categoria || sess2.cat || sess2.division || sess2['división'] || sess2.teamCategory || (sess2.user && (sess2.user.category || sess2.user.categoria || sess2.user.division))));
      if (val) return val;
    } catch (_) {}

    const team = getStoredCrucesTeam();
    if (String(team).includes('tercera')) return 'tercera';
    if (String(team).includes('segunda')) return 'segunda';
    return '';
  }

  function teamNameFromRef(ref){
    if (typeof ref === 'string') return ref.trim();
    if (!ref || typeof ref !== 'object') return '';
    return String(ref.equipo || ref.nombre || ref.team || ref.displayName || ref.slug || '').trim();
  }

  function teamSlugFromRef(ref){
    if (typeof ref === 'string') return normPlanillaSlug(ref);
    if (!ref || typeof ref !== 'object') return '';
    return normPlanillaSlug(ref.slug || ref.teamSlug || ref.team || ref.equipo || ref.nombre || ref.displayName || '');
  }

  function pushCruce(list, localRef, visitanteRef, date){
    const localName = teamNameFromRef(localRef);
    const visitanteName = teamNameFromRef(visitanteRef);
    if (!localName || !visitanteName) return;
    list.push({
      local: localName,
      visitante: visitanteName,
      localSlug: teamSlugFromRef(localRef) || normPlanillaSlug(localName),
      visitanteSlug: teamSlugFromRef(visitanteRef) || normPlanillaSlug(visitanteName),
      date: date || null
    });
  }

  function extractCruces(input){
    const result = [];
    const visited = new WeakSet();

    function walk(node, inheritedDate = null){
      if (!node) return;
      if (typeof node !== 'object') return;
      if (visited.has(node)) return;
      visited.add(node);

      if (Array.isArray(node)) {
        node.forEach(item => walk(item, inheritedDate));
        return;
      }

      const nodeDate = node.date || node.fecha || node.fechaISO || node.fechaKey || inheritedDate || null;

      if (node.local && node.visitante) pushCruce(result, node.local, node.visitante, nodeDate);
      if (node.equipoLocal && node.equipoVisitante) pushCruce(result, node.equipoLocal, node.equipoVisitante, nodeDate);
      if (node.home && node.away) pushCruce(result, node.home, node.away, nodeDate);
      if (node.left && node.right) pushCruce(result, node.left, node.right, nodeDate);

      if (Array.isArray(node.equipos) && node.equipos.length >= 2) {
        const equipos = node.equipos.filter(Boolean);
        const byCategory = {
          local: equipos.find(item => String(item?.categoria || '').toLowerCase() === 'local'),
          visitante: equipos.find(item => String(item?.categoria || '').toLowerCase() === 'visitante')
        };
        if (byCategory.local && byCategory.visitante) {
          pushCruce(result, byCategory.local, byCategory.visitante, nodeDate);
        } else {
          for (let i = 0; i < equipos.length; i += 2) {
            const a = equipos[i];
            const b = equipos[i + 1];
            if (a && b) pushCruce(result, a, b, nodeDate);
          }
        }
      }

      Object.values(node).forEach(value => walk(value, nodeDate));
    }

    walk(input);

    const dedup = new Map();
    result.forEach(item => {
      const key = compactKey(item.local) + '::' + compactKey(item.visitante) + '::' + String(item.date || '');
      if (!dedup.has(key)) dedup.set(key, item);
    });
    return [...dedup.values()];
  }

  function findCruceForTeam(cruces, teamCandidates){
    const variants = new Set();
    (Array.isArray(teamCandidates) ? teamCandidates : [teamCandidates]).forEach(value => {
      teamKeyVariants(value).forEach(v => variants.add(v));
    });

    const matches = cruces.filter(cruce => {
      const localVariants = teamKeyVariants(cruce.local);
      const visitanteVariants = teamKeyVariants(cruce.visitante);
      return localVariants.some(v => variants.has(v)) || visitanteVariants.some(v => variants.has(v));
    });

    if (!matches.length) return null;

    const today = new Date();
    today.setHours(0,0,0,0);

    const toDate = (raw) => {
      if (!raw) return null;
      const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    };

    const scored = matches.map(item => {
      const d = toDate(item.date);
      const diff = d ? Math.abs(d - today) : Number.MAX_SAFE_INTEGER;
      const inWindow = d ? (today >= new Date(d.getTime() - 5*24*60*60*1000) && today <= new Date(d.getTime() + 1*24*60*60*1000)) : false;
      return { item, d, diff, inWindow };
    });

    const candidates = scored.filter(x => x.inWindow);
    const pool = candidates.length ? candidates : scored;
    pool.sort((a, b) => a.diff - b.diff);
    return pool[0]?.item || null;
  }

  async function loadCrucesFromDb(category){
    const team = CATEGORY_KEYS[category];
    if (!team) throw new Error('Categoría inválida para cruces');
    return fetchJson(apiUrl('/api/cruces'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team })
    });
  }

  // ---------------- DATA LOADING ----------------
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

  async function checkCrucesEnabled(category) {
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

    const categoryKey = CATEGORY_KEYS[category];
    if (!category || !categoryKey) {
      return block('Cruces no disponibles', 'No se pudo identificar la categoría para mostrar los cruces.');
    }

    try {
      const fechaKey = new Date().toISOString().slice(0,10);
      const qs = new URLSearchParams({ team: categoryKey, fechaKey });
      const j = await fetchJson(apiUrl('/api/cruces/status?') + qs.toString(), { cache:'no-store', credentials:'same-origin' });
      if (!j || !j.enabled) {
        return block('Cruces no habilitados', 'El administrador todavía no habilitó los cruces para esta fecha.');
      }
      return true;
    } catch (e) {
      console.error('checkCrucesEnabled', e);
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
      const r = await fetch(apiUrl('/api/admin/planillas'), {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);

      const arr = await r.json();
      if (Array.isArray(arr)) {
        arr.forEach(item => {
          const rawTeam = item?.team || item?.slug || item?.equipo || item?.nombre || '';
          const teamKey = normPlanillaSlug(rawTeam);
          const plan = item?.planilla || item?.plan || item || {};
          if (teamKey) {
            const normalizedPlan = {
              team: item?.team || rawTeam || teamKey,
              capitan: Array.isArray(plan.capitan) ? plan.capitan : ['', ''],
              individuales: Array.isArray(plan.individuales) ? plan.individuales : Array(7).fill(''),
              pareja1: Array.isArray(plan.pareja1) ? plan.pareja1 : ['', ''],
              pareja2: Array.isArray(plan.pareja2) ? plan.pareja2 : ['', ''],
              suplentes: Array.isArray(plan.suplentes) ? plan.suplentes : ['', '', '']
            };
            map.set(teamKey, normalizedPlan);
            teamKeyVariants(rawTeam).forEach(aliasKey => {
              if (aliasKey) map.set(normPlanillaSlug(aliasKey), normalizedPlan);
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
    const variants = teamKeyVariants(slug).map(v => normPlanillaSlug(v)).filter(Boolean);
    const team = variants[0] || normPlanillaSlug(slug);

    try {
      const planillas = await loadPlanillasIndex();
      for (const key of [team, ...variants]) {
        if (planillas && planillas.has(key)) return planillas.get(key);
      }
    } catch (e) {
      console.warn('Índice de planillas no disponible para', slug, e);
    }

    for (const key of [team, ...variants]) {
      try {
        const r = await fetch(apiUrl('/api/team/planilla?team=' + encodeURIComponent(key)), {
          cache: 'no-store',
          credentials: 'same-origin'
        });

        if (!r.ok) continue;

        const data = await r.json();
        const plan = data?.planilla || data || {};

        return {
          team: data?.team || plan?.team || slug || key,
          capitan: Array.isArray(plan.capitan) ? plan.capitan : ['', ''],
          individuales: Array.isArray(plan.individuales) ? plan.individuales : Array(7).fill(''),
          pareja1: Array.isArray(plan.pareja1) ? plan.pareja1 : ['', ''],
          pareja2: Array.isArray(plan.pareja2) ? plan.pareja2 : ['', ''],
          suplentes: Array.isArray(plan.suplentes) ? plan.suplentes : ['', '', '']
        };
      } catch (e) {
        console.warn('No se pudo cargar planilla desde backend para', key, e);
      }
    }

    return emptyPlanilla(slug || team);
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
    const formattedDate = formatDate(date);
    card.querySelector('.meta').textContent = formattedDate ? `vs ${opponent} · ${formattedDate}` : `vs ${opponent}`;

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

  function planillaTieneContenido(plan) {
    if (!plan) return false;
    const values = [
      ...(Array.isArray(plan.capitan) ? plan.capitan : []),
      ...(Array.isArray(plan.individuales) ? plan.individuales : []),
      ...(Array.isArray(plan.pareja1) ? plan.pareja1 : []),
      ...(Array.isArray(plan.pareja2) ? plan.pareja2 : []),
      ...(Array.isArray(plan.suplentes) ? plan.suplentes : []),
    ];
    return values.some(v => String(v || '').trim() !== '');
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

function collectScoreRows(rootId) {
  const root = document.getElementById(rootId);
  if (!root) return [];
  return Array.from(root.querySelectorAll('.pts-select')).map(sel => {
    const n = parseInt(sel.value, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function normalizeCompareText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function clearMismatchVisual() {
  document.querySelectorAll('.slot-error, .pts-error, .total-error, .wins-error').forEach(el => {
    el.classList.remove('slot-error', 'pts-error', 'total-error', 'wins-error');
  });
}

function markPtsError(rootId, scoreIndex) {
  const root = document.getElementById(rootId);
  if (!root) return;
  const boxes = Array.from(root.querySelectorAll('.pts-edit')).filter(box => box.querySelector('.pts-select'));
  const box = boxes[scoreIndex];
  if (box) box.classList.add('pts-error');
}

function markTotalError(rootId, metric) {
  const root = document.getElementById(rootId);
  if (!root) return;
  if (metric === 'triangulos') {
    const el = root.querySelector('.total-box');
    if (el) el.classList.add('total-error');
  } else if (metric === 'puntos') {
    const el = root.querySelector('.wins-box');
    if (el) el.classList.add('wins-error');
  }
}

function markPlanillaSlotError(rootId, section, index) {
  const root = document.getElementById(rootId);
  if (!root) return;
  const wanted = String(section || '').toUpperCase();
  const secEl = Array.from(root.querySelectorAll('.section'))
    .find(sec => (sec.querySelector('h2')?.textContent || '').toUpperCase() === wanted);
  if (!secEl) return;
  const slot = secEl.querySelectorAll('.slot')[index];
  if (slot) slot.classList.add('slot-error');
}

function applyMismatchDiff(diffList) {
  clearMismatchVisual();
  if (!Array.isArray(diffList)) return;

  diffList.forEach(item => {
    const side = item?.side === 'visitante' ? 'planilla-root-right' : 'planilla-root-left';
    if (item?.type === 'score') {
      markPtsError(side, Number(item.scoreIndex || 0));
    } else if (item?.type === 'total') {
      markTotalError(side, item.metric);
    } else if (item?.type === 'slot') {
      markPlanillaSlotError(side, item.section, Number(item.index || 0));
    }
  });
}

function buildValidationSnapshot(status) {
  const source = status || buildMatchStatus(true);
  return {
    fechaISO: source.fechaISO,
    localSlug: source.localSlug,
    visitanteSlug: source.visitanteSlug,
    localPlanilla: source.localPlanilla,
    visitantePlanilla: source.visitantePlanilla,
    local: {
      triangulos: source?.local?.triangulosTotales ?? 0,
      puntosTotales: source?.local?.puntosTotales ?? 0,
      scoreRows: Array.isArray(source?.local?.scoreRows) ? source.local.scoreRows : []
    },
    visitante: {
      triangulos: source?.visitante?.triangulosTotales ?? 0,
      puntosTotales: source?.visitante?.puntosTotales ?? 0,
      scoreRows: Array.isArray(source?.visitante?.scoreRows) ? source.visitante.scoreRows : []
    }
  };
}

let validationPollTimer = null;
function stopValidationPolling() {
  if (validationPollTimer) {
    clearInterval(validationPollTimer);
    validationPollTimer = null;
  }
}


async function checkFinalLockOnLoad() {
  try {
    const qs = withBust({
      fechaISO: todayISO_AR,
      equipoSlug: mySlug,
      localSlug,
      visitanteSlug
    });

    const res = await fetch(apiUrl('/api/cruces/lock-status?') + qs.toString(), {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return false;

    const btn = document.getElementById('btnValidarGlobal');

    if (data?.tipo === 'validado' || data?.locked) {
      stopValidationPolling();
      autosaveClear();
      clearMismatchVisual();
      lockValidatedMatchUI();
      if (btn) setBtnState('success', data?.mensaje || 'VALIDADO');
      return true;
    }

    if (data?.tipo === 'pendiente') {
      if (btn) {
        setBtnState('pending', data?.mensaje || 'Validado: esperando que valide su rival');
        startValidationPolling(btn);
      }
      return false;
    }

    if (data?.tipo === 'mismatch') {
      if (Array.isArray(data?.diff)) applyMismatchDiff(data.diff);
      if (btn) {
        setBtnState('error', data?.error || 'Los datos no coinciden, consulte con su rival');
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove('success','error','pending','rival-pending','btn');
          btn.classList.add('btn-validate');
          btn.textContent = 'VALIDAR PLANILLA';
        }, 3000);
      }
      return false;
    }

    return false;
  } catch (e) {
    console.warn('checkFinalLockOnLoad', e);
    return false;
  }
}

function startValidationPolling(btn) {
  stopValidationPolling();
  validationPollTimer = setInterval(async () => {
    try {
      const qs = withBust({ fechaISO: todayISO_AR, localSlug, visitanteSlug, equipoSlug: mySlug });
      const res = await fetch(apiUrl('/api/cruces/lock-status?') + qs.toString(), {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) return;

      if (data?.tipo === 'validado' || data?.locked) {
        stopValidationPolling();
        autosaveClear();
        lockValidatedMatchUI();
        clearMismatchVisual();
        setBtnState('success', data?.mensaje || 'VALIDACIÓN EXITOSA');
        showToast('Validación exitosa', 'success');
      } else if (data?.tipo === 'mismatch') {
        stopValidationPolling();
        setBtnState('error', data?.error || 'Los datos no coinciden, verificar con su rival');
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove('success','error','pending','rival-pending','btn');
          btn.classList.add('btn-validate');
          btn.textContent = 'VALIDAR PLANILLA';
        }, 3000);
      }
    } catch (_) {}
  }, 4000);
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
  const leftScoreRows = collectScoreRows('planilla-root-left');
  const rightScoreRows = collectScoreRows('planilla-root-right');
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
    local:     { ...localData,     triangulosTotales: leftT.triangulos,  puntosTotales: leftT.puntosTotales, scoreRows: leftScoreRows },
    visitante: { ...visitanteData, triangulosTotales: rightT.triangulos, puntosTotales: rightT.puntosTotales, scoreRows: rightScoreRows }
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
  const res = await fetch(apiUrl('/api/cruces/match-status'), {
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
      if (ev.target && ev.target.classList && ev.target.classList.contains('pts-select')) {
        clearMismatchVisual();
        scheduleAutosave();
      }
    });
    root.addEventListener('cruces:changed', () => {
      clearMismatchVisual();
      scheduleAutosave();
    });
  });
}

// STATUS autocarga: primero borrador propio, si no existe compartido final
async function tryApplyStatusIfExists(){
  try {
    const qs = withBust({ localSlug, visitanteSlug, fechaISO: todayISO_AR, equipoSlug: mySlug });
    const res = await fetch(apiUrl('/api/cruces/match-status?') + qs.toString(), {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const result = await res.json().catch(() => null);
    if (!res.ok || !result?.ok || !result?.data) return false;

    const data = result.data;
    if (planillaTieneContenido(data.localPlanilla)) {
      applyCollectedPlanilla('planilla-root-left', data.localPlanilla);
    }
    if (planillaTieneContenido(data.visitantePlanilla)) {
      applyCollectedPlanilla('planilla-root-right', data.visitantePlanilla);
    }

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

    const lockRes = await fetch(apiUrl(`/api/cruces/lock-status?fechaISO=${encodeURIComponent(todayISO_AR)}&equipoSlug=${encodeURIComponent(mySlug)}&localSlug=${encodeURIComponent(localSlug)}&visitanteSlug=${encodeURIComponent(visitanteSlug)}`)).catch(()=>null);
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

    clearMismatchVisual();

    const statusForValidate = buildMatchStatus(true);
    const mine = buildValidationSnapshot(statusForValidate);

    const save = await fetch(apiUrl('/api/cruces/validate'), {
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
      startValidationPolling(btn);
      return;
    }

    if (saveData?.tipo === 'mismatch' || saveData?.ok === false) {
      if (Array.isArray(saveData?.diff)) applyMismatchDiff(saveData.diff);
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

    stopValidationPolling();
    autosaveClear();
    clearMismatchVisual();
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
      const category = deriveCategory();
      if (!teamSlug) throw new Error('Falta equipo');
      if (!category) throw new Error('Falta categoría');

      const crucesRaw = await loadCrucesFromDb(category);
      const cruces = extractCruces(crucesRaw);
      if (!cruces.length) throw new Error('No se encontraron cruces en la base de datos para esta categoría.');

      const match = findCruceForTeam(cruces, teamCandidates);
      if (!match) throw new Error('No se encontró un cruce para el equipo logueado.');

      const local = { name: match.local, teamSlug: match.localSlug || normPlanillaSlug(match.local) };
      const visitante = { name: match.visitante, teamSlug: match.visitanteSlug || normPlanillaSlug(match.visitante) };

      const localPlan = await loadFirstExistingPlanilla(local.teamSlug || local.name);
      const visitantePlan = await loadFirstExistingPlanilla(visitante.teamSlug || visitante.name);

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

      setupValidationButtons(local, visitante, match.date || new Date().toISOString().slice(0,10));

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
  const category = deriveCategory();
  const allowed = await checkCrucesEnabled(category);

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