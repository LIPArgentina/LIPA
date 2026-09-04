
(() => {
  'use strict';
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

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const MATCH_FORMAT = window.LIPA_getMatchFormat?.() || {
    individualCount: 11,
    pairCount: 0,
    pairSize: 2,
    totalPoints: 11,
    captainCount: 2,
    substituteCount: 2
  };
  const INDIVIDUAL_COUNT = Number(MATCH_FORMAT.individualCount || 11);
  const PAIR_COUNT = Number(MATCH_FORMAT.pairCount || 0);
  const PAIR_SIZE = Number(MATCH_FORMAT.pairSize || 2);
  const CAPTAIN_COUNT = Number(MATCH_FORMAT.captainCount || 2);
  const SUBSTITUTE_COUNT = Number(MATCH_FORMAT.substituteCount || 2);
  const TOTAL_POINTS = Number(MATCH_FORMAT.totalPoints || INDIVIDUAL_COUNT + PAIR_COUNT);
  const SCORE_MAX_BY_CATEGORY = MATCH_FORMAT.scoreMaxByCategory || {
    tercera: 5,
    segunda: 6
  };
  const CATEGORY_KEYS = {
    tercera: '__categoria_tercera__',
    segunda: '__categoria_segunda__'
  };
  const teamPlayersCache = new Map();

  const normalizeCategoryValue = (raw) => {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return '';
    if (v.includes('terc')) return 'tercera';
    if (v.includes('seg')) return 'segunda';
    if (v === '3' || v === 'c') return 'tercera';
    if (v === '2' || v === 'b') return 'segunda';
    return '';
  };

  function readStoredJson(...keys){
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_) {}
    }
    return null;
  }

  function getLocationParam(name){
    try {
      return new URLSearchParams(location.search).get(name) || '';
    } catch (_) {
      return '';
    }
  }

  function pushUniqueNormalized(list, value){
    const clean = normPlanillaSlug(value);
    if (clean && !list.includes(clean)) list.push(clean);
  }

  function collectSessionTeamCandidates(sessionLike, out){
    if (!sessionLike || typeof sessionLike !== 'object') return;
    pushUniqueNormalized(out, sessionLike.slug);
    pushUniqueNormalized(out, sessionLike.team);
    pushUniqueNormalized(out, sessionLike.displayName);
    pushUniqueNormalized(out, sessionLike.teamName);
    pushUniqueNormalized(out, sessionLike.name);

    const user = sessionLike.user;
    if (user && typeof user === 'object') {
      pushUniqueNormalized(out, user.slug);
      pushUniqueNormalized(out, user.team);
      pushUniqueNormalized(out, user.displayName);
      pushUniqueNormalized(out, user.teamName);
      pushUniqueNormalized(out, user.name);
    } else {
      pushUniqueNormalized(out, user);
    }
  }

  function persistCrucesTeam(value){
    const clean = normPlanillaSlug(value);
    if (!clean) return;
    try { sessionStorage.setItem('lpi_cruces_team', clean); } catch(_) {}
    try { localStorage.setItem('lpi_cruces_team', clean); } catch(_) {}
    try { sessionStorage.setItem('teamSlug', clean); } catch(_) {}
  }

  function getCrucesTeamContext(){
    const candidates = [];
    const urlTeam = getLocationParam('team');
    if (urlTeam) {
      pushUniqueNormalized(candidates, urlTeam);
      persistCrucesTeam(urlTeam);
    }

    const sessionA = readStoredJson('lpi.session');
    const sessionB = readStoredJson('lpi_team_session');
    collectSessionTeamCandidates(sessionA, candidates);
    collectSessionTeamCandidates(sessionB, candidates);

    try {
      [
        sessionStorage.getItem('lpi_cruces_team'),
        localStorage.getItem('lpi_cruces_team'),
        sessionStorage.getItem('teamSlug'),
        localStorage.getItem('teamSlug'),
        sessionStorage.getItem('team'),
        localStorage.getItem('team')
      ].forEach(value => pushUniqueNormalized(candidates, value));
    } catch(_) {}

    const category =
      normalizeCategoryValue(getLocationParam('cat')) ||
      normalizeCategoryValue(sessionA && (sessionA.category || sessionA.categoria || sessionA.cat || sessionA.division || sessionA['división'] || sessionA.teamCategory || (sessionA.user && (sessionA.user.category || sessionA.user.categoria || sessionA.user.division)))) ||
      normalizeCategoryValue(sessionB && (sessionB.category || sessionB.categoria || sessionB.cat || sessionB.division || sessionB['división'] || sessionB.teamCategory || (sessionB.user && (sessionB.user.category || sessionB.user.categoria || sessionB.user.division)))) ||
      (String(candidates[0] || '').includes('tercera') ? 'tercera' : '') ||
      (String(candidates[0] || '').includes('segunda') ? 'segunda' : '');

    return {
      primaryTeam: candidates[0] || '',
      candidates,
      category
    };
  }


  const TEAM_ALIASES = {
    THEWEST: ['THE WEST', 'WEST'],
    ALBA: ['ALBA', 'ALBA POOL'],
    OLDIES: ['OLDIES', 'OLDIES 3RA', 'OLDIES3RA'],
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

  function isAdminTestMode(){
    try {
      const qs = new URLSearchParams(location.search);
      return qs.get('test') === '1';
    } catch (_) {
      return false;
    }
  }

  const ADMIN_TEST_MODE = isAdminTestMode();

  function setupAdminTestMode(){
    if (!ADMIN_TEST_MODE) return;

    const team = new URLSearchParams(location.search).get('team') || '';
    const category = deriveCategory();
    const title = document.getElementById('headerTitle');
    const banner = document.getElementById('testModeBanner');

    persistCrucesTeam(team);

    if (title) title.textContent = 'CRUCES · MODO PRUEBA';
    if (banner) {
      banner.hidden = false;
      banner.textContent = `MODO PRUEBA: ${team || 'equipo'}${category ? ' · ' + category : ''}. Los cambios quedan solo en tu navegador y no validan en backend.`;
    }
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
    return getCrucesTeamContext().category || '';
  }

  function normalizePlayerName(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function closePlayerPhoto(){
    const modal = document.getElementById('playerPhotoModal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('player-photo-open');
  }

  async function loadTeamPlayers(teamRef){
    const category = deriveCategory();
    const cacheKey = `${category}:${normalizePlayerName(teamRef)}`;
    if (!teamPlayersCache.has(cacheKey)) {
      const params = new URLSearchParams({ category, team: String(teamRef || '') });
      teamPlayersCache.set(cacheKey, fetchJson(apiUrl('/api/players-public/by-team?' + params.toString()), {
        cache: 'no-store',
        credentials: 'same-origin'
      }).then(data => Array.isArray(data?.players) ? data.players : []).catch(err => {
        teamPlayersCache.delete(cacheKey);
        throw err;
      }));
    }
    return teamPlayersCache.get(cacheKey);
  }

  async function findPlayer(playerNameValue, teamRef){
    const wanted = normalizePlayerName(playerNameValue);
    const players = await loadTeamPlayers(teamRef).catch(() => []);
    const teamMatch = players.find(player => normalizePlayerName(player?.nombre || player?.name) === wanted);
    if (teamMatch) return teamMatch;

    const data = await fetchJson(apiUrl('/api/players-public/search?q=' + encodeURIComponent(playerNameValue)), {
      cache: 'no-store',
      credentials: 'same-origin'
    }).catch(() => null);
    const candidates = Array.isArray(data?.players) ? data.players : [];
    const category = deriveCategory();
    return candidates.find(player =>
      normalizePlayerName(player?.nombre || player?.name) === wanted &&
      (!player?.categoria || String(player.categoria).toLowerCase() === category)
    ) || candidates.find(player => normalizePlayerName(player?.nombre || player?.name) === wanted) || null;
  }

  async function openPlayerPhoto(playerNameValue, teamRef){
    const modal = document.getElementById('playerPhotoModal');
    const name = document.getElementById('playerPhotoName');
    const image = document.getElementById('playerPhotoImage');
    const status = document.getElementById('playerPhotoStatus');
    const profileButton = document.getElementById('btnPlayerProfile');
    if (!modal || !name || !image || !status) return;

    name.textContent = String(playerNameValue || 'Jugador');
    if (profileButton) {
      profileButton.dataset.player = String(playerNameValue || '').trim();
      profileButton.dataset.category = deriveCategory();
    }
    image.src = '../logo_liga.png';
    image.alt = `Foto de ${playerNameValue || 'jugador'}`;
    status.textContent = 'Buscando foto…';
    modal.hidden = false;
    document.body.classList.add('player-photo-open');

    const player = await findPlayer(playerNameValue, teamRef);
    if (!player) {
      status.textContent = 'No se encontró la ficha del jugador.';
      return;
    }
    image.src = player?.fotoUrl ? apiUrl(player.fotoUrl) : '../logo_liga.png';
    status.textContent = player?.fotoUrl ? '' : 'Este jugador todavía no tiene una foto cargada.';
  }

  function openPlayerProfile(){
    const button = document.getElementById('btnPlayerProfile');
    const status = document.getElementById('playerPhotoStatus');
    const player = String(button?.dataset.player || '').trim();
    const category = String(button?.dataset.category || deriveCategory()).trim().toLowerCase();
    if (category !== 'tercera') {
      if (status) status.textContent = 'Ficha no disponible por falta de datos para esta categoría. Pedir al capitán que lo complete.';
      return;
    }
    if (!player) {
      if (status) status.textContent = 'No se pudo identificar al jugador.';
      return;
    }
    const params = new URLSearchParams({ mode: 'individual', category, player, auto: '1', edition: '6' });
    const modal = document.getElementById('playerProfileModal');
    const frame = document.getElementById('playerProfileFrame');
    if (!modal || !frame) return;
    frame.src = `../consultas/consultas.html?${params.toString()}`;
    modal.hidden = false;
    document.body.classList.add('player-photo-open');
  }

  function closePlayerProfile(){
    const modal = document.getElementById('playerProfileModal');
    const frame = document.getElementById('playerProfileFrame');
    if (!modal) return;
    modal.hidden = true;
    if (frame) frame.src = 'about:blank';
  }

  function renderSlotContents(slot, playerNameValue){
    const text = String(playerNameValue || '').trim();
    slot.textContent = '';
    if (!text) return;

    const name = document.createElement('span');
    name.className = 'slot-player-name';
    name.textContent = text;

    const photoButton = document.createElement('button');
    photoButton.type = 'button';
    photoButton.className = 'slot-photo-btn';
    photoButton.textContent = '📷';
    photoButton.setAttribute('aria-label', `Ver foto de ${text}`);
    photoButton.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const root = slot.closest('#planilla-root-left, #planilla-root-right');
      openPlayerPhoto(text, root?.dataset?.teamRef || '').catch(() => {
        const status = document.getElementById('playerPhotoStatus');
        if (status) status.textContent = 'No se pudo cargar la foto.';
      });
    });

    slot.append(name, photoButton);
  }

  function getRegulationScoreMax(){
    const configuredMax = Number(SCORE_MAX_BY_CATEGORY[deriveCategory()]);
    return Number.isFinite(configuredMax) ? configuredMax : 6;
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


  function normalizeLlavesTeam(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' Y ')
      .replace(/[._-]+/g, ' ')
      .replace(/\b(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[^A-Z0-9]/gi, '')
      .replace(/(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)$/i, '')
      .toUpperCase();
  }

  function llavesLegHasScores(leg) {
    return [
      leg?.home?.puntos,
      leg?.away?.puntos,
      leg?.home?.puntosExtra,
      leg?.away?.puntosExtra
    ].some(value => Number(value || 0) > 0);
  }

  function buildMatchFromLlavesLeg(leg, roundId, legIndex) {
    const local = String(leg?.home?.team || '').trim();
    const visitante = String(leg?.away?.team || '').trim();
    if (!local || !visitante) return null;
    if (normalizeLlavesTeam(local) === 'WO' || normalizeLlavesTeam(visitante) === 'WO') return null;
    return {
      roundId,
      legIndex,
      date: String(leg?.date || '').trim() || null,
      local,
      visitante,
      localSlug: normPlanillaSlug(local),
      visitanteSlug: normPlanillaSlug(visitante),
      source: 'llaves'
    };
  }

  function findProximoCruceInLlavesData(llavesData, team) {
    const teamKey = normalizeLlavesTeam(team);
    if (!teamKey) return null;

    const rounds = Array.isArray(llavesData?.rounds) ? llavesData.rounds : [];
    const candidates = [];

    rounds.forEach((round, roundIndex) => {
      const legs = Array.isArray(round?.legs) ? round.legs : [];
      legs.forEach((leg, legIndex) => {
        if (legIndex >= 2) return;
        const homeKey = normalizeLlavesTeam(leg?.home?.team);
        const awayKey = normalizeLlavesTeam(leg?.away?.team);
        if (homeKey !== teamKey && awayKey !== teamKey) return;
        const match = buildMatchFromLlavesLeg(leg, round?.id || '', legIndex);
        if (!match) return;
        candidates.push({
          ...match,
          roundIndex,
          played: llavesLegHasScores(leg)
        });
      });
    });

    const pending = candidates
      .filter(item => !item.played)
      .sort((a, b) => {
        const ad = a.date || '9999-12-31';
        const bd = b.date || '9999-12-31';
        return ad.localeCompare(bd) || (a.roundIndex - b.roundIndex) || (a.legIndex - b.legIndex);
      });

    return pending[0] || candidates
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.roundIndex - a.roundIndex) || (b.legIndex - a.legIndex))[0] || null;
  }

  async function loadProximoCruceFromLlaves(category, team){
    const cleanCategory = String(category || '').trim();
    const cleanTeam = String(team || '').trim();
    if (!cleanCategory || !cleanTeam) return null;

    try {
      const qs = new URLSearchParams({
        category: cleanCategory,
        team: cleanTeam
      });

      const llavesData = await fetchJson(apiUrl('/api/llaves/proximo-cruce?') + qs.toString(), {
        cache: 'no-store',
        credentials: 'same-origin'
      });

      const match = llavesData?.match;
      if (match?.local && match?.visitante) {
        return {
          local: match.local,
          visitante: match.visitante,
          localSlug: teamSlugFromRef(match.local) || normPlanillaSlug(match.local),
          visitanteSlug: teamSlugFromRef(match.visitante) || normPlanillaSlug(match.visitante),
          date: match.date || null,
          source: 'llaves'
        };
      }
    } catch (err) {
      console.warn('No se pudo cargar próximo cruce desde /api/llaves/proximo-cruce; pruebo fallback /api/llaves', err);
    }

    try {
      const qs = new URLSearchParams({ category: cleanCategory });
      const data = await fetchJson(apiUrl('/api/llaves?') + qs.toString(), {
        cache: 'no-store',
        credentials: 'same-origin'
      });

      const llavesData = data?.data || data?.llaves || data;
      const match = findProximoCruceInLlavesData(llavesData, cleanTeam);
      if (match?.local && match?.visitante) return match;
    } catch (err) {
      console.warn('No se pudo cargar próximo cruce desde llaves fallback', err);
    }

    return null;
  }

  function extractCrucesFromFecha(fechaNode){
    const tablas = Array.isArray(fechaNode?.tablas) ? fechaNode.tablas : [];
    const cruces = [];

    for (const tabla of tablas) {
      const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];
      if (!equipos.length) continue;

      let pendienteLocal = null;

      for (const item of equipos) {
        const categoria = String(item?.categoria || '').toLowerCase();
        const nombre = String(item?.equipo || '').trim();
        if (!nombre) continue;

        if (categoria === 'local') {
          pendienteLocal = item;
          continue;
        }

        if (categoria === 'visitante') {
          if (pendienteLocal && nombre.toUpperCase() !== 'WO' && String(pendienteLocal?.equipo || '').toUpperCase() !== 'WO') {
            const matchDate = pendienteLocal?.reprogramadoPara || item?.reprogramadoPara ||
              fechaNode?.reprogramadoPara || fechaNode?.date || fechaNode?.fecha || fechaNode?.fechaISO || fechaNode?.fechaKey || null;
            pushCruce(cruces, pendienteLocal, item, matchDate);
          }
          pendienteLocal = null;
        }
      }
    }

    return cruces;
  }

  function findCruceForTeam(cruces, teamCandidates, preferredDate = ''){
    const candidateList = Array.isArray(teamCandidates) ? teamCandidates : [teamCandidates];
    const requestedSlugs = new Set(candidateList.map(v => normPlanillaSlug(v)).filter(Boolean));
    const variants = new Set();

    candidateList.forEach(value => {
      teamKeyVariants(value).forEach(v => variants.add(v));
    });

    const matches = cruces.filter(cruce => {
      const localSlug = normPlanillaSlug(cruce.localSlug);
      const visitanteSlug = normPlanillaSlug(cruce.visitanteSlug);
      if ((localSlug && requestedSlugs.has(localSlug)) || (visitanteSlug && requestedSlugs.has(visitanteSlug))) {
        return true;
      }

      const localVariants = teamKeyVariants(cruce.local);
      const visitanteVariants = teamKeyVariants(cruce.visitante);
      return localVariants.some(v => variants.has(v)) || visitanteVariants.some(v => variants.has(v));
    });

    if (!matches.length) return null;

    const today = new Date();
    today.setHours(0,0,0,0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const toDate = (raw) => {
      if (!raw) return null;
      const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    };

    const scored = matches.map(item => ({
      item,
      d: toDate(item.date)
    }));

    const exactSlugMatches = scored.filter(({ item }) => {
      const localSlug = normPlanillaSlug(item.localSlug);
      const visitanteSlug = normPlanillaSlug(item.visitanteSlug);
      return (localSlug && requestedSlugs.has(localSlug)) || (visitanteSlug && requestedSlugs.has(visitanteSlug));
    });

    const pool = exactSlugMatches.length ? exactSlugMatches : scored;
    const datedPool = pool.filter(x => x.d);
    if (!datedPool.length) return pool[0]?.item || null;

    const activeDateKey = String(preferredDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(activeDateKey)) {
      const activeMatch = datedPool.find(x => String(x.item?.date || '').slice(0, 10) === activeDateKey);
      if (activeMatch) return activeMatch.item;
    }

    const todayMatch = datedPool.find(x => x.d.getTime() === today.getTime());
    if (todayMatch) return todayMatch.item;

    const tomorrowMatch = datedPool.find(x => x.d.getTime() === tomorrow.getTime());
    if (tomorrowMatch) return tomorrowMatch.item;

    const future = datedPool
      .filter(x => x.d >= today)
      .sort((a, b) => a.d - b.d);
    if (future.length) return future[0].item;

    datedPool.sort((a, b) => Math.abs(a.d - today) - Math.abs(b.d - today));
    return datedPool[0]?.item || pool[0]?.item || null;
  }

  async function loadCrucesFromDb(category){
    if (!category) throw new Error('Categoría inválida para cruces');

    const fetchFixtureKind = async (kind) => {
      const data = await fetchJson(apiUrl('/api/fixture?kind=' + encodeURIComponent(kind) + '&category=' + encodeURIComponent(category)), {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const fechas = Array.isArray(data?.data?.fechas) ? data.data.fechas : [];
      return fechas.map((fecha) => ({ ...fecha, __kind: kind }));
    };

    const [idaFechas, vueltaFechas] = await Promise.all([
      fetchFixtureKind('ida').catch(() => []),
      fetchFixtureKind('vuelta').catch(() => [])
    ]);

    const fechas = [...idaFechas, ...vueltaFechas];

    const cruces = fechas.flatMap(extractCrucesFromFecha);
    if (!cruces.length) {
      const ctx = getCrucesTeamContext();
      const match = await loadProximoCruceFromLlaves(category, ctx.primaryTeam || '');
      if (match) {
        return {
          cruces: [match],
          fechaFixture: match.date,
          fixtureKind: 'llaves'
        };
      }
      return { cruces: [], fechaFixture: null, fixtureKind: null };
    }

    const ctx = getCrucesTeamContext();
    const cruceEquipo = findCruceForTeam(cruces, ctx.candidates);

    if (!cruceEquipo) {
      const match = await loadProximoCruceFromLlaves(category, ctx.primaryTeam || '');
      if (match) {
        return {
          cruces: [match],
          fechaFixture: match.date,
          fixtureKind: 'llaves'
        };
      }
    }

    return {
      cruces,
      fechaFixture: cruceEquipo?.date || null,
      fixtureKind: null
    };
  }


  function getStoredCrucesCandidates() {
    return getCrucesTeamContext().candidates.slice();
  }


  async function checkCrucesEnabled(category) {
    if (ADMIN_TEST_MODE) return true;
    const app = document.getElementById('app-root');
    const grid = document.getElementById('crucesGrid');
    const cta = document.getElementById('validateCta');
    const err = document.getElementById('appError');

    const block = (title, msg) => {
      if (grid) grid.innerHTML = '';
      if (cta) cta.hidden = true;
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
      window.__CRUCE_ACTIVE_FIXTURE_DATE = String(j.nextFixtureDate || '').slice(0, 10);
      return true;
    } catch (e) {
      console.error('checkCrucesEnabled', e);
      return block('No se pudo verificar el acceso', 'Probá nuevamente en unos minutos.');
    }
  }


  let __PLANILLAS_CACHE = null;

  function emptyPlanilla(team = '') {
    return {
      team,
      capitan: Array(CAPTAIN_COUNT).fill(''),
      individuales: Array(INDIVIDUAL_COUNT).fill(''),
      pareja1: PAIR_COUNT >= 1 ? Array(PAIR_SIZE).fill('') : [],
      pareja2: PAIR_COUNT >= 2 ? Array(PAIR_SIZE).fill('') : [],
      suplentes: Array(SUBSTITUTE_COUNT).fill('')
    };
  }

  function hasCategoryMarker(value){
    return /(tercera|segunda|primera|3ra|3era|2da|2nda|1ra)/i.test(String(value || ''));
  }

  function buildPlanillaLookupKeys(value){
    const exact = normPlanillaSlug(value);
    const variants = teamKeyVariants(value).map(v => normPlanillaSlug(v)).filter(Boolean);
    const keys = [];
    const push = (k) => {
      const clean = normPlanillaSlug(k);
      if (clean && !keys.includes(clean)) keys.push(clean);
    };

    push(exact);
    variants.forEach(push);

    return {
      exact,
      variants,
      keys,
      hasCategory: hasCategoryMarker(value)
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
          const plan = item?.planilla || item?.plan || item || {};
          const requestedCategory = deriveCategory();
          const itemCategory = normalizeCategoryValue(
            item?.category ||
            item?.division ||
            plan?.category ||
            plan?.categoria
          );
          if (requestedCategory && itemCategory && requestedCategory !== itemCategory) return;

          const rawTeam = item?.slug_uid || item?.team || item?.slug || item?.equipo || item?.nombre || '';
          const planTeam = plan?.team || '';
          const normalizedPlan = {
            team: rawTeam || planTeam || '',
            capitan: Array.isArray(plan.capitan) ? plan.capitan : Array(CAPTAIN_COUNT).fill(''),
            individuales: Array.isArray(plan.individuales) ? plan.individuales : Array(INDIVIDUAL_COUNT).fill(''),
            pareja1: PAIR_COUNT >= 1 && Array.isArray(plan.pareja1) ? plan.pareja1 : [],
            pareja2: PAIR_COUNT >= 2 && Array.isArray(plan.pareja2) ? plan.pareja2 : [],
            suplentes: Array.isArray(plan.suplentes) ? plan.suplentes : Array(SUBSTITUTE_COUNT).fill(''),
            jugadorIds: plan.jugadorIds && typeof plan.jugadorIds === 'object' ? plan.jugadorIds : {}
          };

          const rawLookup = buildPlanillaLookupKeys(rawTeam);
          const planLookup = buildPlanillaLookupKeys(planTeam);

          [rawLookup.exact, planLookup.exact].forEach(key => {
            if (key) map.set(key, normalizedPlan);
          });

          const aliasSources = [
            ...rawLookup.variants,
            ...(planTeam ? planLookup.variants : [])
          ];

          aliasSources.forEach(aliasKey => {
            const normalizedAlias = normPlanillaSlug(aliasKey);
            if (normalizedAlias && !map.has(normalizedAlias)) {
              map.set(normalizedAlias, normalizedPlan);
            }
          });
        });
      }
    } catch (e) {
      console.warn('No se pudo cargar índice global de planillas', e);
    }

    __PLANILLAS_CACHE = map;
    return map;
  }

  async function loadFirstExistingPlanilla(slug) {
    const lookup = buildPlanillaLookupKeys(slug);
    const exactKeys = [lookup.exact].filter(Boolean);
    const fallbackKeys = lookup.hasCategory ? [] : lookup.variants;
    const candidateKeys = [...exactKeys, ...fallbackKeys];

    try {
      const planillas = await loadPlanillasIndex();
      for (const key of candidateKeys) {
        if (planillas && planillas.has(key)) return planillas.get(key);
      }
    } catch (e) {
      console.warn('Índice de planillas no disponible para', slug, e);
    }

    for (const key of candidateKeys) {
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
          capitan: Array.isArray(plan.capitan) ? plan.capitan : Array(CAPTAIN_COUNT).fill(''),
          individuales: Array.isArray(plan.individuales) ? plan.individuales : Array(INDIVIDUAL_COUNT).fill(''),
          pareja1: PAIR_COUNT >= 1 && Array.isArray(plan.pareja1) ? plan.pareja1 : [],
          pareja2: PAIR_COUNT >= 2 && Array.isArray(plan.pareja2) ? plan.pareja2 : [],
          suplentes: Array.isArray(plan.suplentes) ? plan.suplentes : Array(SUBSTITUTE_COUNT).fill(''),
          jugadorIds: plan.jugadorIds && typeof plan.jugadorIds === 'object' ? plan.jugadorIds : {}
        };
      } catch (e) {
        console.warn('No se pudo cargar planilla desde backend para', key, e);
      }
    }

    return emptyPlanilla(slug || lookup.exact);
  }


  function createPtsSelect() {
    const wrap = document.createElement('div');
    wrap.className = 'pts-edit';
    const sel = document.createElement('select');
    sel.className = 'pts-select';
    const maxScore = getRegulationScoreMax();
    for (let v = 0; v <= maxScore; v++) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = String(v);
      if (v === 0) opt.selected = true;
      sel.appendChild(opt);
    }
    wrap.appendChild(sel);
    return wrap;
  }

  function sectionKeyToPlanKey(sectionKey = '') {
    const section = String(sectionKey || '').toUpperCase();
    if (section.includes('CAPIT')) return 'capitan';
    if (section.includes('INDIVIDUALES')) return 'individuales';
    if (section.includes('PAREJA 1')) return 'pareja1';
    if (section.includes('PAREJA 2')) return 'pareja2';
    if (section.includes('SUPLENTES')) return 'suplentes';
    return '';
  }

  function playerIdFromPlanilla(planilla, sectionKey, index) {
    const key = sectionKeyToPlanKey(sectionKey);
    const raw = key ? planilla?.jugadorIds?.[key]?.[index] : null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? String(id) : '';
  }

  function makeRow(num, text, side, includePoints = false, sectionKey = '', playerId = '') {
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
    if (playerId) slot.dataset.playerId = String(playerId);
    if (!isEmpty) {
      slot.setAttribute('data-full', String(text).trim());
      renderSlotContents(slot, text);
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


  function extractCoords(value){
    const text = String(value || '').trim();

    let match = text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (match) return { lat: match[1], lng: match[2] };

    match = text.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (match) return { lat: match[1], lng: match[2] };

    match = text.match(/[?&]ll=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (match) return { lat: match[1], lng: match[2] };

    match = text.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    if (match) return { lat: match[1], lng: match[2] };

    return null;
  }

  function isLikelyUrl(value){
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function buildGoogleMapsUrl(rawLocation, fallbackQuery = ''){
    const location = String(rawLocation || '').trim();
    const fallback = String(fallbackQuery || '').trim();

    if (!location && !fallback) return '';

    const coords = extractCoords(location);
    if (coords) {
      const q = `${coords.lat},${coords.lng}`;
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
    }

    if (isLikelyUrl(location)) return location;

    const query = location || fallback;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function teamMatchesForMaps(a, b){
    const aVariants = teamKeyVariants(a);
    const bVariants = new Set(teamKeyVariants(b));
    return aVariants.some(value => bVariants.has(value));
  }

  async function setupTeamMapButton(button, teamName){
    try {
      const category = deriveCategory();
      if (!button || !category || !teamName) return;

      const data = await fetchJson(apiUrl('/api/teams?division=' + encodeURIComponent(category)), {
        cache: 'no-store',
        credentials: 'same-origin'
      });

      const rawTeams =
        Array.isArray(data) ? data :
        Array.isArray(data?.teams) ? data.teams :
        Array.isArray(data?.users) ? data.users :
        [];

      const team = rawTeams.find(item => {
        const name = item?.username || item?.name || item?.team || item?.teamName || item?.equipo || item?.nombre || '';
        return teamMatchesForMaps(name, teamName);
      });

      if (!team) return;

      const sala = team?.sala || team?.room || team?.email || '';
      const ubicacion = team?.ubicacion || team?.location || team?.maps || team?.phone || '';
      const url = buildGoogleMapsUrl(ubicacion, sala || teamName);

      if (!url) return;

      button.href = url;
      button.hidden = false;
    } catch (err) {
      console.warn('No se pudo cargar ubicación del equipo', teamName, err);
    }
  }

  function renderSide(rootId, planilla, opponent, date, teamName, teamRef = teamName) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML = '';
    root.dataset.teamRef = String(teamRef || teamName || '');

    const card = document.querySelector('#card-template').content.cloneNode(true).querySelector('.card');
    card.querySelector('.title').textContent = teamName.toUpperCase();
    const formattedDate = formatDate(date);
    const meta = card.querySelector('.meta');
    if (meta) {
      meta.innerHTML = '';

      const mapBtn = document.createElement('a');
      mapBtn.className = 'team-map-btn';
      mapBtn.href = '#';
      mapBtn.target = '_blank';
      mapBtn.rel = 'noopener noreferrer';
      mapBtn.textContent = 'UBICACIÓN';
      mapBtn.setAttribute('aria-label', `Abrir ubicación de ${teamName} en Google Maps`);
      mapBtn.hidden = true;

      meta.appendChild(mapBtn);
      setupTeamMapButton(mapBtn, teamName);
    }

    const secs = card.querySelector('.sections');
    const data = {
      'CAPITÁN': Array.from(
        { length: CAPTAIN_COUNT },
        (_, index) => String(planilla?.capitan?.[index] || '').trim()
      ),
      'INDIVIDUALES': planilla.individuales || [],
      'PAREJA 1': planilla.pareja1 || [],
      'PAREJA 2': planilla.pareja2 || [],
      'SUPLENTES': planilla.suplentes || []
    };

    const sections = ['CAPITÁN', 'INDIVIDUALES'];
    if (PAIR_COUNT >= 1) sections.push('PAREJA 1');
    if (PAIR_COUNT >= 2) sections.push('PAREJA 2');
    sections.push('SUPLENTES');
    sections.forEach(sec => {
      const div = document.createElement('div');
      div.className = 'section';
      div.innerHTML = `<h2>${sec}</h2>`;

      const items = data[sec];

      const side = rootId.includes('left') ? 'left' : 'right';
      if (sec.includes('PAREJA') && items.length === 2) {
        div.appendChild(makeRow(1, items[0], side, true, sec, playerIdFromPlanilla(planilla, sec, 0)));
        div.appendChild(makeRow(2, items[1], side, false, sec, playerIdFromPlanilla(planilla, sec, 1)));
      } else {
        const includePts = sec === 'INDIVIDUALES';
        items.forEach((p, i) => {
          div.appendChild(makeRow(i + 1, p, side, includePts, sec, playerIdFromPlanilla(planilla, sec, i)));
        });
      }

      secs.appendChild(div);
    });

    root.appendChild(card);
  }


  function getScoreRows(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return [];

    return Array.from(root.querySelectorAll('.row')).map(row => {
      const sel = row.querySelector('.pts-select');
      if (!sel) return null;

      const val = parseInt(sel.value, 10);
      return {
        row,
        value: Number.isFinite(val) ? val : 0,
        section: String(row.dataset.section || '').toUpperCase()
      };
    }).filter(Boolean);
  }

  function isWinningScore(ownValue, rivalValue) {
    return Number.isFinite(ownValue) && Number.isFinite(rivalValue) && ownValue > rivalValue;
  }

  function updateScoresFor() {
    const leftRows = getScoreRows('planilla-root-left');
    const rightRows = getScoreRows('planilla-root-right');

    let leftTriangles = 0;
    let rightTriangles = 0;
    let leftPoints = 0;
    let rightPoints = 0;

    if (leftRows.length !== rightRows.length) {
      console.warn('updateScoresFor: filas puntuables desalineadas', { left: leftRows.length, right: rightRows.length });
    }

    const totalRows = Math.max(leftRows.length, rightRows.length);

    for (let i = 0; i < totalRows; i++) {
      const left = leftRows[i];
      const right = rightRows[i];

      if (left) leftTriangles += left.value;
      if (right) rightTriangles += right.value;

      const leftValue = left?.value ?? 0;
      const rightValue = right?.value ?? 0;

      if (isWinningScore(leftValue, rightValue)) leftPoints++;
      if (isWinningScore(rightValue, leftValue)) rightPoints++;
    }

    const leftRoot = document.getElementById('planilla-root-left');
    const rightRoot = document.getElementById('planilla-root-right');

    const leftTotalInput = leftRoot?.querySelector('.total-input');
    if (leftTotalInput) leftTotalInput.value = leftTriangles;

    const rightTotalInput = rightRoot?.querySelector('.total-input');
    if (rightTotalInput) rightTotalInput.value = rightTriangles;

    const leftWinsBox = leftRoot?.querySelector('.wins-box');
    if (leftWinsBox) leftWinsBox.textContent = leftPoints;

    const rightWinsBox = rightRoot?.querySelector('.wins-box');
    if (rightWinsBox) rightWinsBox.textContent = rightPoints;
  }



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

      body.nice-confirm-open{
        overflow:hidden;
      }
      .nice-confirm-modal[hidden]{
        display:none !important;
      }
      .nice-confirm-modal{
        position:fixed;
        inset:0;
        z-index:100000;
      }
      .nice-confirm-backdrop{
        position:absolute;
        inset:0;
        background:rgba(0,0,0,.62);
        backdrop-filter:blur(2px);
      }
      .nice-confirm-dialog{
        position:absolute;
        left:50%;
        top:50%;
        transform:translate(-50%, -50%);
        width:min(92vw, 420px);
        background:linear-gradient(180deg, #090d18 0%, #050811 100%);
        color:#e9e9e9;
        border:1px solid rgba(255,230,90,.18);
        border-radius:22px;
        box-shadow:0 28px 80px rgba(0,0,0,.55);
        overflow:hidden;
      }
      .nice-confirm-header{
        padding:18px 22px 12px;
        border-bottom:1px solid rgba(255,255,255,.08);
      }
      .nice-confirm-header h3{
        margin:0;
        color:#ffe65a;
        font-size:18px;
        font-weight:900;
      }
      .nice-confirm-body{
        padding:18px 22px 10px;
      }
      .nice-confirm-body p{
        margin:0;
        color:#f0f0f0;
        font-size:15px;
        line-height:1.55;
      }
      .nice-confirm-actions{
        display:flex;
        justify-content:flex-end;
        gap:12px;
        padding:16px 22px 22px;
      }
      .nice-confirm-btn{
        min-width:96px;
        border-radius:14px;
        padding:12px 18px;
        font-weight:900;
        font-size:15px;
        cursor:pointer;
        transition:transform .16s ease, filter .16s ease;
      }
      .nice-confirm-btn:hover{
        transform:translateY(-1px);
        filter:brightness(1.04);
      }
      .nice-confirm-btn.secondary{
        background:transparent;
        color:#f4f4f4;
        border:1px solid rgba(145,163,196,.30);
      }
      .nice-confirm-btn.primary{
        background:linear-gradient(180deg, #f1d255 0%, #d7af2a 100%);
        color:#111;
        border:1px solid #b28900;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.22);
      }
      .nice-confirm-btn:focus-visible{
        outline:2px solid #9ec5ff;
        outline-offset:2px;
      }
      @media (max-width: 520px){
        .nice-confirm-dialog{
          width:min(94vw, 420px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setSlotValue(slot, value, playerId = ''){
    const txt = String(value || '').trim();
    const id = String(playerId || '').trim();
    if (txt) {
      renderSlotContents(slot, txt);
      slot.setAttribute('data-full', txt);
      slot.classList.remove('is-empty');
    } else {
      slot.textContent = '';
      slot.removeAttribute('data-full');
      slot.classList.add('is-empty');
    }
    if (id) slot.dataset.playerId = id;
    else delete slot.dataset.playerId;
  }

  function getSlotValue(slot){
    return (slot.getAttribute('data-full') || slot.textContent || '').trim();
  }

  function getSlotPlayerId(slot){
    return String(slot?.dataset?.playerId || '').trim();
  }

  function lockValidatedMatchUI(){
    document.querySelectorAll('#planilla-root-left .pts-select, #planilla-root-right .pts-select').forEach(el => {
      el.disabled = true;
    });

    document.querySelectorAll('#planilla-root-left .slot, #planilla-root-right .slot').forEach(slot => {
      slot.style.pointerEvents = 'none';
      slot.style.cursor = 'default';
      slot.classList.remove('slot-selected-sub');
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

  const substitutionsByRoot = new WeakMap();

  function getSectionSlots(root, sectionKey){
    const wanted = String(sectionKey || '').toLowerCase();
    const section = Array.from(root.querySelectorAll('.section')).find(sec =>
      sectionKeyToPlanKey(sec.querySelector('h2')?.textContent || '') === wanted
    );
    return section ? Array.from(section.querySelectorAll('.slot')) : [];
  }

  function normalizeSubstitutions(value){
    if (!Array.isArray(value)) return [];
    return value.slice(0, SUBSTITUTE_COUNT).map(item => {
      const benchIndex = Number(item?.benchIndex);
      const fieldIndex = Number(item?.fieldIndex);
      const fieldSection = sectionKeyToPlanKey(item?.fieldSection || 'INDIVIDUALES');
      if (!Number.isInteger(benchIndex) || benchIndex < 0 || benchIndex >= SUBSTITUTE_COUNT) return null;
      if (!Number.isInteger(fieldIndex) || fieldIndex < 0 || fieldSection !== 'individuales') return null;
      return {
        benchIndex,
        fieldSection,
        fieldIndex,
        substitute: String(item?.substitute || '').trim(),
        substituteId: String(item?.substituteId || '').trim(),
        starter: String(item?.starter || '').trim(),
        starterId: String(item?.starterId || '').trim()
      };
    }).filter(Boolean);
  }

  function getRootSubstitutions(root){
    return substitutionsByRoot.get(root) || [];
  }

  function applySubstitutionMarks(root){
    clearSwapMarks(root);
    const benchSlots = getSectionSlots(root, 'suplentes');
    const fieldSlots = getSectionSlots(root, 'individuales');
    getRootSubstitutions(root).forEach(change => {
      benchSlots[change.benchIndex]?.classList.add('slot-sub-out');
      fieldSlots[change.fieldIndex]?.classList.add('slot-sub-in');
    });
  }

  function setRootSubstitutions(root, substitutions){
    substitutionsByRoot.set(root, normalizeSubstitutions(substitutions));
    applySubstitutionMarks(root);
  }


  function ensureNiceConfirmModal(){
    if (document.getElementById('nice-confirm-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'nice-confirm-modal';
    modal.className = 'nice-confirm-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="nice-confirm-backdrop" data-close="no"></div>
      <div class="nice-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="niceConfirmTitle">
        <div class="nice-confirm-header">
          <h3 id="niceConfirmTitle">Jugador repetido</h3>
        </div>
        <div class="nice-confirm-body">
          <p id="niceConfirmMessage"></p>
        </div>
        <div class="nice-confirm-actions">
          <button type="button" class="nice-confirm-btn secondary" data-answer="no">No</button>
          <button type="button" class="nice-confirm-btn primary" data-answer="yes">Sí</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function niceConfirm(message, title = 'Jugador repetido'){
    ensureNiceConfirmModal();

    return new Promise(resolve => {
      const modal = document.getElementById('nice-confirm-modal');
      const titleNode = modal.querySelector('#niceConfirmTitle');
      const messageNode = modal.querySelector('#niceConfirmMessage');
      const yesBtn = modal.querySelector('[data-answer="yes"]');
      const noBtn = modal.querySelector('button[data-answer="no"]');
      const backdrop = modal.querySelector('.nice-confirm-backdrop');

      const cleanup = (answer) => {
        modal.hidden = true;
        document.body.classList.remove('nice-confirm-open');
        yesBtn.removeEventListener('click', onYes);
        noBtn.removeEventListener('click', onNo);
        backdrop.removeEventListener('click', onNo);
        document.removeEventListener('keydown', onKeyDown);
        resolve(answer);
      };

      const onYes = () => cleanup(true);
      const onNo = () => cleanup(false);
      const onKeyDown = (ev) => {
        if (ev.key === 'Escape') cleanup(false);
        if (ev.key === 'Enter') cleanup(true);
      };

      titleNode.textContent = title;
      messageNode.textContent = message;
      modal.hidden = false;
      document.body.classList.add('nice-confirm-open');

      yesBtn.addEventListener('click', onYes);
      noBtn.addEventListener('click', onNo);
      backdrop.addEventListener('click', onNo);
      document.addEventListener('keydown', onKeyDown);

      setTimeout(() => yesBtn.focus(), 0);
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
    const isSwappableField = (slot) => getSectionName(slot).includes('INDIVIDUALES');

    root.querySelectorAll('.slot').forEach(slot => {
      if (slot.dataset.swapWired === '1') return;
      slot.dataset.swapWired = '1';
      slot.style.cursor = 'pointer';

      slot.addEventListener('click', async () => {
        const slotValue = getSlotValue(slot);
        if (!slotValue) return;

        if (isBenchSlot(slot)) {
          root.querySelectorAll('.slot.slot-selected-sub').forEach(s => s.classList.remove('slot-selected-sub'));
          slot.classList.add('slot-selected-sub');
          selectedBenchSlot = slot;
          return;
        }

        if (!selectedBenchSlot) return;
        if (!isSwappableField(slot)) return;
        if (selectedBenchSlot === slot) return;

        const currentFieldPlayer = getSlotValue(slot);
        const selectedSub = getSlotValue(selectedBenchSlot);
        const currentFieldPlayerId = getSlotPlayerId(slot);
        const selectedSubId = getSlotPlayerId(selectedBenchSlot);
        if (!currentFieldPlayer || !selectedSub) return;

        const benchSlots = getSectionSlots(root, 'suplentes');
        const fieldSlots = getSectionSlots(root, 'individuales');
        const benchIndex = benchSlots.indexOf(selectedBenchSlot);
        const fieldIndex = fieldSlots.indexOf(slot);
        const substitutions = getRootSubstitutions(root);
        const activeChange = substitutions.find(change => change.benchIndex === benchIndex);

        if (activeChange) {
          if (activeChange.fieldIndex !== fieldIndex) {
            showToast('Ese jugador solo puede volver a la posición del suplente que lo reemplazó.', 'info');
            return;
          }
          setSlotValue(slot, activeChange.starter, activeChange.starterId);
          setSlotValue(selectedBenchSlot, activeChange.substitute, activeChange.substituteId);
          setRootSubstitutions(root, substitutions.filter(change => change !== activeChange));
        } else {
          if (substitutions.some(change => change.fieldIndex === fieldIndex)) {
            showToast('Esa posición ya tiene un cambio realizado.', 'info');
            return;
          }
          setSlotValue(slot, selectedSub, selectedSubId);
          setSlotValue(selectedBenchSlot, currentFieldPlayer, currentFieldPlayerId);
          setRootSubstitutions(root, [...substitutions, {
            benchIndex,
            fieldSection: 'individuales',
            fieldIndex,
            substitute: selectedSub,
            substituteId: selectedSubId,
            starter: currentFieldPlayer,
            starterId: currentFieldPlayerId
          }]);
        }

        selectedBenchSlot.classList.remove('slot-selected-sub');
        selectedBenchSlot = null;

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
        const key = sectionKeyToPlanKey(title);
        const playerId = key ? plan?.jugadorIds?.[key]?.[idx] : '';
        setSlotValue(slot, values[idx] || '', playerId || '');
      });
    });

    setRootSubstitutions(root, plan.substitutions || []);
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


  function setupValidationButtons(local, visitante, matchDate) {
    const cta = document.getElementById('validateCta');
    const btn = document.getElementById('btnValidarGlobal');
    if (!cta || !btn) return;

    document.querySelectorAll('.btn-validate').forEach(b => {
      if (b.id !== 'btnValidarGlobal') b.remove();
    });

    cta.hidden = false;



const toDateAR = (d = new Date()) => {
  const z = new Date(d.getTime() - (d.getTimezoneOffset() * 60000));
  const pad = n => String(n).padStart(2, '0');
  return `${z.getFullYear()}-${pad(z.getMonth()+1)}-${pad(z.getDate())}`;
};
const todayISO_AR = toDateAR();
const getCurrentFechaISO = () => window.__CRUCE_FECHA_ISO || todayISO_AR;
const getAutosaveKey = () => `lpi.autosave.${mySlug}.${getCurrentFechaISO()}.${(mySlug===localSlug?visitanteSlug:localSlug)}`;

const getLoggedSlug = () => getCrucesTeamContext().primaryTeam || '';
const mySlug = getLoggedSlug();
const localSlug = local.teamSlug;
const visitanteSlug = visitante.teamSlug;

function readAllSelects(rootId) {
  const root = document.getElementById(rootId);
  return Array.from(root.querySelectorAll('.pts-select')).map(sel => {
    const n = parseInt(sel.value, 10);
    return Number.isFinite(n) ? n : 0;
  });
}
function writeAllSelects(rootId, values) {
  const root = document.getElementById(rootId);
  if (!root) return;
  const selects = Array.from(root.querySelectorAll('.pts-select'));
  const maxScore = getRegulationScoreMax();
  selects.forEach((sel,i) => {
    if (i < values.length) {
      const value = Number(values[i]);
      const safeValue = Number.isFinite(value)
        ? Math.max(0, Math.min(maxScore, Math.trunc(value)))
        : 0;
      sel.value = String(safeValue);
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

function getScorableRowCount(rootId) {
  const root = document.getElementById(rootId);
  if (!root) return 0;
  return root.querySelectorAll('.pts-select').length;
}

function validateRegulationRows() {
  const leftRoot = document.getElementById('planilla-root-left');
  const rightRoot = document.getElementById('planilla-root-right');
  const leftScores = collectScoreRows('planilla-root-left');
  const rightScores = collectScoreRows('planilla-root-right');

  if (leftScores.length !== INDIVIDUAL_COUNT || rightScores.length !== INDIVIDUAL_COUNT) {
    return `La planilla debe tener exactamente ${INDIVIDUAL_COUNT} partidos individuales.`;
  }

  const maxScore = getRegulationScoreMax();
  for (let i = 0; i < INDIVIDUAL_COUNT; i++) {
    if (leftScores[i] < 0 || leftScores[i] > maxScore || rightScores[i] < 0 || rightScores[i] > maxScore) {
      markPtsError('planilla-root-left', i);
      markPtsError('planilla-root-right', i);
      return `Los puntos de cada partido deben estar entre 0 y ${maxScore}.`;
    }
  }

  const leftPlayers = Array.from(leftRoot?.querySelectorAll('.section') || [])
    .find(section => String(section.querySelector('h2')?.textContent || '').toUpperCase().includes('INDIVIDUALES'))
    ?.querySelectorAll('.slot') || [];
  const rightPlayers = Array.from(rightRoot?.querySelectorAll('.section') || [])
    .find(section => String(section.querySelector('h2')?.textContent || '').toUpperCase().includes('INDIVIDUALES'))
    ?.querySelectorAll('.slot') || [];

  if (Array.from(leftPlayers).some(slot => !getSlotValue(slot)) || Array.from(rightPlayers).some(slot => !getSlotValue(slot))) {
    return 'Todos los partidos deben tener un jugador de cada equipo.';
  }

  for (let i = 0; i < INDIVIDUAL_COUNT; i++) {
    if (leftScores[i] === rightScores[i]) {
      markPtsError('planilla-root-left', i);
      markPtsError('planilla-root-right', i);
      return `El partido individual ${i + 1} debe tener un ganador.`;
    }
  }

  return '';
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
  if (ADMIN_TEST_MODE) return false;
  try {
    const qs = withBust({
      fechaISO: getCurrentFechaISO(),
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
      cancelAutosaveTimers();
      autosaveClear();
      clearMismatchVisual();
      lockValidatedMatchUI();
      if (btn) setBtnState('success', data?.mensaje || 'VALIDADO');
      updatePictureButton(true);
      return true;
    }

    if (data?.tipo === 'pendiente') {
      if (btn) {
        if (data?.validated) {
          setBtnState('pending', data?.mensaje || 'Validado: esperando que valide su rival');
          startValidationPolling(btn);
        } else {
          btn.disabled = false;
          btn.classList.remove('success','error','pending','rival-pending','btn');
          btn.classList.add('btn-validate');
          btn.textContent = 'VALIDAR PLANILLA';
        }
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
  if (ADMIN_TEST_MODE) return;
  stopValidationPolling();
  validationPollTimer = setInterval(async () => {
    try {
      const qs = withBust({ fechaISO: getCurrentFechaISO(), localSlug, visitanteSlug, equipoSlug: mySlug });
      const res = await fetch(apiUrl('/api/cruces/lock-status?') + qs.toString(), {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) return;

      if (data?.tipo === 'validado' || data?.locked) {
        stopValidationPolling();
        cancelAutosaveTimers();
        autosaveClear();
        lockValidatedMatchUI();
        clearMismatchVisual();
        setBtnState('success', data?.mensaje || 'VALIDACIÓN EXITOSA');
        updatePictureButton(true);
        refreshTiebreakBlock().catch?.(() => {});
        showToast('Validación exitosa', 'success');
      } else if (data?.tipo === 'mismatch') {
        if (Array.isArray(data?.diff)) applyMismatchDiff(data.diff);

        setBtnState('pending', data?.mensaje || 'Esperando que el rival corrija y valide');
      }
    } catch (_) {}
  }, 4000);
}

function sliceToStatus(values) {
  const jugadores = values.slice(0, INDIVIDUAL_COUNT);
  const pairStart = INDIVIDUAL_COUNT;
  const pareja1 = PAIR_COUNT >= 1 ? { j1: values[pairStart] ?? 0, j2: values[pairStart + 1] ?? 0 } : { j1: 0, j2: 0 };
  const pareja2 = PAIR_COUNT >= 2 ? { j1: values[pairStart + PAIR_SIZE] ?? 0, j2: values[pairStart + PAIR_SIZE + 1] ?? 0 } : { j1: 0, j2: 0 };
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
  const fechaISO = window.__CRUCE_FECHA_ISO || todayISO_AR;
  return {
    fechaISO,
    category: deriveCategory(),
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
  if (ADMIN_TEST_MODE) {
    try {
      localStorage.setItem(`lpi.cruces.test.status.${mySlug}.${getCurrentFechaISO()}`, JSON.stringify(status));
    } catch(_) {}
    return { ok: true, testMode: true, validated: !!validated };
  }
  const body = {
    localSlug,
    visitanteSlug,
    fechaISO: getCurrentFechaISO(),
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


function autosaveSave() {
  try {
    const payload = {
      fechaISO: getCurrentFechaISO(),
      left: readAllSelects('planilla-root-left'),
      right: readAllSelects('planilla-root-right'),
      localPlanilla: collectPlanilla('planilla-root-left'),
      visitantePlanilla: collectPlanilla('planilla-root-right')
    };
    localStorage.setItem(getAutosaveKey(), JSON.stringify(payload));
  } catch {}
}
function autosaveLoad() { try{ const raw=localStorage.getItem(getAutosaveKey()); return raw?JSON.parse(raw):null; }catch{ return null; } }
function autosaveApplyIfAny() {
  const data = autosaveLoad();
  if (!data || data.fechaISO !== getCurrentFechaISO()) return;
  if (data.localPlanilla) applyCollectedPlanilla('planilla-root-left', data.localPlanilla);
  if (data.visitantePlanilla) applyCollectedPlanilla('planilla-root-right', data.visitantePlanilla);
  writeAllSelects('planilla-root-left', data.left||[]);
  writeAllSelects('planilla-root-right', data.right||[]);
}
function autosaveClear(){ try{ localStorage.removeItem(getAutosaveKey());}catch{} }
let autosaveTimer=null;
let serverSaveTimer=null;
function cancelAutosaveTimers(){
  clearTimeout(autosaveTimer);
  clearTimeout(serverSaveTimer);
  autosaveTimer = null;
  serverSaveTimer = null;
}
function scheduleAutosave(){
  if (document.getElementById('btnValidarGlobal')?.classList.contains('success')) return;

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


async function tryApplyStatusIfExists(){
  if (ADMIN_TEST_MODE) return false;
  try {
    const qs = withBust({ localSlug, visitanteSlug, fechaISO: getCurrentFechaISO(), equipoSlug: mySlug });
    const res = await fetch(apiUrl('/api/cruces/match-status?') + qs.toString(), {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const result = await res.json().catch(() => null);
    if (!res.ok || !result?.ok || !result?.data) return false;

    const data = result.data;

    if (data.localPlanilla) applyCollectedPlanilla('planilla-root-left', data.localPlanilla);
    if (data.visitantePlanilla) applyCollectedPlanilla('planilla-root-right', data.visitantePlanilla);
    const L = [...(data.local?.jugadores||[])];
    const R = [...(data.visitante?.jugadores||[])];
    if (PAIR_COUNT >= 1) {
      L.push(data.local?.parejas?.pareja1?.j1 ?? 0, data.local?.parejas?.pareja1?.j2 ?? 0);
      R.push(data.visitante?.parejas?.pareja1?.j1 ?? 0, data.visitante?.parejas?.pareja1?.j2 ?? 0);
    }
    if (PAIR_COUNT >= 2) {
      L.push(data.local?.parejas?.pareja2?.j1 ?? 0, data.local?.parejas?.pareja2?.j2 ?? 0);
      R.push(data.visitante?.parejas?.pareja2?.j1 ?? 0, data.visitante?.parejas?.pareja2?.j2 ?? 0);
    }
    writeAllSelects('planilla-root-left', L);
    writeAllSelects('planilla-root-right', R);
    updateScoresFor();

    if (data.validated === true) {
      cancelAutosaveTimers();
      autosaveClear();
      lockValidatedMatchUI();
      updatePictureButton(true);
    }
    return true;
  } catch { return false; }
}


autosaveApplyIfAny();
autosaveAttachListeners();
tryApplyStatusIfExists();

const btnSubirFotos = document.getElementById('btnSubirFotos');
const btnVolver = document.getElementById('btnVolver');
const volverClass = btnVolver ? btnVolver.className : 'btn';


function updatePictureButton(enabled) {
  if (!btnSubirFotos) return;
  const url = new URL('../pictures/pictures_upload.html', location.href);
  url.searchParams.set('fechaISO', getCurrentFechaISO());
  url.searchParams.set('localSlug', localSlug);
  url.searchParams.set('visitanteSlug', visitanteSlug);
  url.searchParams.set('team', mySlug);

  btnSubirFotos.href = enabled ? url.toString() : '#';
  btnSubirFotos.classList.toggle('disabled', !enabled);
  btnSubirFotos.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

btnSubirFotos?.addEventListener('click', (ev) => {
  if (btnSubirFotos.classList.contains('disabled')) {
    ev.preventDefault();
    showToast('Primero tienen que validar el cruce.', 'error');
  }
});

updatePictureButton(false);



let tiebreakPollTimer = null;
let tiebreakUserDirty = false;

function getAllPlayersFromPlan(plan) {
  const values = [
    ...(Array.isArray(plan?.capitan) ? plan.capitan : []),
    ...(Array.isArray(plan?.individuales) ? plan.individuales : []),
    ...(Array.isArray(plan?.pareja1) ? plan.pareja1 : []),
    ...(Array.isArray(plan?.pareja2) ? plan.pareja2 : []),
    ...(Array.isArray(plan?.suplentes) ? plan.suplentes : [])
  ].map(v => String(v || '').trim()).filter(Boolean);
  return Array.from(new Set(values));
}

function ensureTiebreakMount() {
  let mount = document.getElementById('tiebreakMount');
  if (mount) return mount;
  mount = document.createElement('section');
  mount.id = 'tiebreakMount';
  mount.className = 'tiebreak-card';
  mount.hidden = true;
  const anchor = document.getElementById('validateCta') || document.getElementById('app-root');
  anchor.insertAdjacentElement('afterend', mount);
  return mount;
}

function buildPlayerOptions(players, selected = '') {
  const cleanSelected = String(selected || '').trim();
  const list = Array.from(new Set(['', ...players, cleanSelected].filter(v => v !== null && v !== undefined)));
  return list.map(name => {
    const value = String(name || '').trim();
    const label = value || 'Seleccionar jugador';
    return `<option value="${escapeAttr(value)}" ${value === cleanSelected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(value) { return escapeHtml(value); }

function renderTiebreakBlock(serverState = {}) {
  const mount = ensureTiebreakMount();
  if (!serverState?.needsTiebreak) {
    mount.hidden = true;
    mount.innerHTML = '';
    return;
  }

  const data = window.__CRUCE_EXPORT_DATA__ || {};
  const localPlayers = getAllPlayersFromPlan(data.localPlan);
  const visitantePlayers = getAllPlayersFromPlan(data.visitantePlan);
  const status = serverState?.tiebreak?.status || {};
  const localStatus = status.local || {};
  const visitanteStatus = status.visitante || {};
  const localPair = Array.isArray(localStatus.pareja) ? localStatus.pareja : [];
  const visitantePair = Array.isArray(visitanteStatus.pareja) ? visitanteStatus.pareja : [];
  const locked = !!(serverState?.tiebreak?.validated || serverState?.tiebreak?.locked);
  const mineValidated = !!serverState?.tiebreak?.mineValidated;

  mount.hidden = false;
  mount.innerHTML = `
    <div class="tiebreak-header">
      <div>
        <div class="tiebreak-kicker">SERIE EMPATADA</div>
        <h2>DESEMPATE</h2>
        <p>Cada capitán designa a 2 jugadores de la plantilla completa presentada para la fecha, suplentes incluidos.</p>
      </div>
      <div class="tiebreak-state${locked ? ' success' : ''}" id="tiebreakState">${locked ? 'VALIDADO' : (mineValidated ? 'ESPERANDO RIVAL' : 'PENDIENTE')}</div>
    </div>
    <div class="tiebreak-grid">
      <div class="tiebreak-side left">
        <h3>${escapeHtml(local.name || data.local?.name || 'LOCAL')}</h3>
        <select class="tiebreak-player" data-side="local" data-player="0" ${locked ? 'disabled' : ''}>${buildPlayerOptions(localPlayers, localPair[0] || '')}</select>
        <select class="tiebreak-player" data-side="local" data-player="1" ${locked ? 'disabled' : ''}>${buildPlayerOptions(localPlayers, localPair[1] || '')}</select>
      </div>
      <div class="tiebreak-score">
        <select class="tiebreak-points" data-side="local" ${locked ? 'disabled' : ''}>${buildScoreOptions(localStatus.puntos ?? 0)}</select>
        <span>VS</span>
        <select class="tiebreak-points" data-side="visitante" ${locked ? 'disabled' : ''}>${buildScoreOptions(visitanteStatus.puntos ?? 0)}</select>
      </div>
      <div class="tiebreak-side right">
        <h3>${escapeHtml(visitante.name || data.visitante?.name || 'VISITANTE')}</h3>
        <select class="tiebreak-player" data-side="visitante" data-player="0" ${locked ? 'disabled' : ''}>${buildPlayerOptions(visitantePlayers, visitantePair[0] || '')}</select>
        <select class="tiebreak-player" data-side="visitante" data-player="1" ${locked ? 'disabled' : ''}>${buildPlayerOptions(visitantePlayers, visitantePair[1] || '')}</select>
      </div>
    </div>
    <div class="tiebreak-actions">
      <button type="button" class="btn-validate ${locked ? 'success' : ''}" id="btnValidarDesempate" ${locked ? 'disabled' : ''}>${locked ? 'DESEMPATE VALIDADO' : 'VALIDAR DESEMPATE'}</button>
      <a class="btn disabled" id="btnSubirFotoDesempate" href="#" aria-disabled="true">SUBIR FOTO DESEMPATE</a>
    </div>
    <div class="tiebreak-msg" id="tiebreakMsg"></div>
  `;

  wireTiebreakActions(locked);
  wireTiebreakDirtyGuard(locked);
  updateTiebreakPictureButton(locked);
}

function wireTiebreakDirtyGuard(locked) {
  if (locked) return;

  const markTiebreakEdited = () => {
    tiebreakUserDirty = true;

    if (tiebreakPollTimer) {
      clearInterval(tiebreakPollTimer);
      tiebreakPollTimer = null;
    }

    clearTiebreakDiffVisual();
    setTiebreakMsg('', '');

    const btn = document.getElementById('btnValidarDesempate');
    if (btn && !btn.classList.contains('success')) {
      btn.disabled = false;
      btn.textContent = 'VALIDAR DESEMPATE';
      btn.classList.remove('pending', 'error');
    }

    const state = document.getElementById('tiebreakState');
    if (state && !state.classList.contains('success')) {
      state.textContent = 'PENDIENTE';
      state.classList.remove('success');
    }
  };

  document.querySelectorAll('.tiebreak-player, .tiebreak-points').forEach(el => {
    el.addEventListener('focus', markTiebreakEdited);
    el.addEventListener('change', markTiebreakEdited);
  });
}

function buildScoreOptions(selected) {
  const sel = Number(selected || 0);
  let html = '';
  for (let i = 0; i <= 5; i++) html += `<option value="${i}" ${i === sel ? 'selected' : ''}>${i}</option>`;
  return html;
}

function readTiebreakStatus() {
  const getPlayer = (side, idx) => document.querySelector(`.tiebreak-player[data-side="${side}"][data-player="${idx}"]`)?.value || '';
  const getPts = (side) => Number(document.querySelector(`.tiebreak-points[data-side="${side}"]`)?.value || 0);
  return {
    tipo: 'desempate',
    fechaISO: getCurrentFechaISO(),
    localSlug,
    visitanteSlug,
    local: { pareja: [getPlayer('local', 0), getPlayer('local', 1)], puntos: getPts('local') },
    visitante: { pareja: [getPlayer('visitante', 0), getPlayer('visitante', 1)], puntos: getPts('visitante') }
  };
}

function setTiebreakMsg(text, type = '') {
  const el = document.getElementById('tiebreakMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'tiebreak-msg' + (type ? ' ' + type : '');
}

function validateTiebreakStatus(status) {
  const names = [...status.local.pareja, ...status.visitante.pareja].map(v => String(v || '').trim());
  if (names.some(v => !v)) return 'Tenés que elegir los 4 jugadores del desempate.';
  if (new Set(names.map(v => v.toUpperCase())).size !== names.length) return 'No se puede repetir un jugador en el desempate.';
  const l = Number(status.local.puntos || 0);
  const v = Number(status.visitante.puntos || 0);
  if (!((l === 5 && v >= 0 && v <= 4) || (v === 5 && l >= 0 && l <= 4))) return 'El desempate debe terminar cuando un equipo llega a 5.';
  return '';
}


function clearTiebreakDiffVisual() {
  document.querySelectorAll('.tiebreak-field-error').forEach(el => {
    el.classList.remove('tiebreak-field-error');
  });
}

function applyTiebreakDiffVisual(diffList) {
  clearTiebreakDiffVisual();
  if (!Array.isArray(diffList)) return;

  diffList.forEach(item => {
    if (item?.type !== 'tiebreak') return;
    const side = item.side === 'visitante' ? 'visitante' : 'local';
    if (item.field === 'puntos') {
      const pts = document.querySelector(`.tiebreak-points[data-side="${side}"]`);
      if (pts) pts.classList.add('tiebreak-field-error');
      return;
    }

    const playerIndex = item.field === 'pareja2' ? 1 : 0;
    const player = document.querySelector(`.tiebreak-player[data-side="${side}"][data-player="${playerIndex}"]`);
    if (player) player.classList.add('tiebreak-field-error');
  });
}

function setTiebreakValidatedUi() {
  const btn = document.getElementById('btnValidarDesempate');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'DESEMPATE VALIDADO';
    btn.classList.remove('pending', 'error');
    btn.classList.add('success');
  }
  const state = document.getElementById('tiebreakState');
  if (state) {
    state.textContent = 'VALIDADO';
    state.classList.add('success');
  }
}

function wireTiebreakActions(locked) {
  const btn = document.getElementById('btnValidarDesempate');
  if (!btn || locked) return;
  btn.addEventListener('click', async () => {
    clearTiebreakDiffVisual();
    const status = readTiebreakStatus();
    const error = validateTiebreakStatus(status);
    if (error) { setTiebreakMsg(error, 'error'); return; }
    try {
      tiebreakUserDirty = false;
      btn.disabled = true;
      btn.textContent = 'VALIDANDO...';
      const res = await fetch(apiUrl('/api/cruces/tiebreak-validate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ fechaISO: getCurrentFechaISO(), localSlug, visitanteSlug, equipoSlug: mySlug, status })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error || 'No se pudo validar el desempate');
      if (data.tipo === 'pendiente') {
        clearTiebreakDiffVisual();
        setTiebreakMsg(data.mensaje || 'Esperando validación del rival.', 'info');
        btn.textContent = 'ESPERANDO RIVAL';
        btn.classList.add('pending');
        startTiebreakPolling();
        return;
      }
      if (data.tipo === 'mismatch' || data.ok === false) {
        applyTiebreakDiffVisual(data.diff);
        setTiebreakMsg(data.error || 'Los datos del desempate no coinciden.', 'error');
        btn.disabled = false;
        btn.textContent = 'VALIDAR DESEMPATE';
        return;
      }
      clearTiebreakDiffVisual();
      setTiebreakMsg('Desempate validado correctamente.', 'success');
      await refreshTiebreakBlock();
      setTiebreakValidatedUi();
    } catch (err) {
      setTiebreakMsg(err?.message || 'Error inesperado.', 'error');
      btn.disabled = false;
      btn.textContent = 'VALIDAR DESEMPATE';
    }
  });
}

function updateTiebreakPictureButton(enabled) {
  const btn = document.getElementById('btnSubirFotoDesempate');
  if (!btn) return;
  const url = new URL('../pictures/pictures_upload.html', location.href);
  url.searchParams.set('fechaISO', getCurrentFechaISO());
  url.searchParams.set('localSlug', localSlug);
  url.searchParams.set('visitanteSlug', visitanteSlug);
  url.searchParams.set('team', mySlug);
  url.searchParams.set('tipo', 'desempate');
  btn.href = enabled ? url.toString() : '#';
  btn.classList.toggle('disabled', !enabled);
  btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

async function refreshTiebreakBlock() {
  try {
    const qs = withBust({ fechaISO: getCurrentFechaISO(), localSlug, visitanteSlug, equipoSlug: mySlug });
    const data = await fetchJson(apiUrl('/api/cruces/series-status?') + qs.toString(), { cache: 'no-store', credentials: 'same-origin' });
    const mount = document.getElementById('tiebreakMount');
    const hasEditableBlock = !!(mount && !mount.hidden && mount.querySelector('.tiebreak-player, .tiebreak-points'));
    const finalValidated = !!(data?.tiebreak?.validated || data?.tiebreak?.locked);
    const keepCurrentInputs = hasEditableBlock && !finalValidated && (tiebreakUserDirty || data?.tiebreak?.mismatch);

    if (!keepCurrentInputs) {
      renderTiebreakBlock(data);
    }

    if (data?.tiebreak?.mismatch && !tiebreakUserDirty) {
      applyTiebreakDiffVisual(data.tiebreak.diff);
      setTiebreakMsg('Los datos del desempate no coinciden con tu rival.', 'error');
    }
    if (finalValidated) {
      tiebreakUserDirty = false;
      setTiebreakValidatedUi();
    }
    return data;
  } catch (err) {
    console.warn('series-status', err);
    return null;
  }
}

function startTiebreakPolling() {
  if (tiebreakPollTimer) clearInterval(tiebreakPollTimer);
  tiebreakPollTimer = setInterval(async () => {
    if (tiebreakUserDirty) return;

    const data = await refreshTiebreakBlock();
    if (data?.tiebreak?.validated || data?.tiebreak?.locked || data?.tiebreak?.mismatch) {
      clearInterval(tiebreakPollTimer);
      tiebreakPollTimer = null;
    }
  }, 4000);
}

setTimeout(() => { refreshTiebreakBlock(); }, 0);

function restoreValidateButton() {
  btn.disabled = false;
  btn.classList.remove('success','error','pending','rival-pending','btn');
  btn.classList.add('btn-validate');
  btn.textContent = 'VALIDAR PLANILLA';
}

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

async function hydrateValidatedState() {
  if (ADMIN_TEST_MODE) return false;
  try {
    const qs = withBust({
      fechaISO: getCurrentFechaISO(),
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

    if (data?.tipo === 'validado' || data?.locked) {
      stopValidationPolling();
      cancelAutosaveTimers();
      autosaveClear();
      clearMismatchVisual();
      lockValidatedMatchUI();
      setBtnState('success', 'VALIDADO');
      updatePictureButton(true);
      return true;
    }

    if (data?.tipo === 'pendiente') {
      if (data?.validated) {
        setBtnState('pending', data?.mensaje || 'Validado: esperando que valide su rival');
        startValidationPolling(btn);
      } else {
        restoreValidateButton();
        updatePictureButton(false);
      }
      return false;
    }

    if (data?.tipo === 'mismatch') {
      if (Array.isArray(data?.diff)) applyMismatchDiff(data.diff);
      if (data?.validated) {
        setBtnState('pending', data?.mensaje || 'Esperando que el rival corrija y valide');
        startValidationPolling(btn);
      } else {
        restoreValidateButton();
      }
      updatePictureButton(false);
      return false;
    }

    return false;
  } catch (e) {
    console.warn('hydrateValidatedState', e);
    return false;
  }
}

setTimeout(() => { hydrateValidatedState(); }, 0);

btn.onclick = async () => {

  try {
    btn.disabled = true;
    setBtnState('pending','VALIDANDO...');

    if (!mySlug) throw new Error('No pude determinar el equipo logueado.');

    const lockRes = await fetch(apiUrl(`/api/cruces/lock-status?fechaISO=${encodeURIComponent(getCurrentFechaISO())}&equipoSlug=${encodeURIComponent(mySlug)}&localSlug=${encodeURIComponent(localSlug)}&visitanteSlug=${encodeURIComponent(visitanteSlug)}`)).catch(()=>null);
    if (lockRes && lockRes.ok) {
      const lock = await lockRes.json().catch(()=>null);
      if (lock?.locked || lock?.validatedFinal || lock?.tipo === 'validado') {
        lockValidatedMatchUI();
        setBtnState('success','VALIDADO');
        return;
      }
    }

    updateScoresFor();

    clearMismatchVisual();
    const regulationError = validateRegulationRows();
    if (regulationError) {
      setBtnState('error', `ERROR: ${regulationError}`);
      setTimeout(() => restoreValidateButton(), 3000);
      return;
    }

    const leftCount = getScorableRowCount('planilla-root-left');
    const rightCount = getScorableRowCount('planilla-root-right');
    if (leftCount !== rightCount) {
      console.warn('Cruces desalineado: cantidad de filas puntuables distinta', { leftCount, rightCount });
      setBtnState('error','ERROR: La planilla quedó desalineada');
      setTimeout(() => {
        restoreValidateButton();
      }, 3000);
      return;
    }

    const left  = computeTotalsFrom('planilla-root-left');
    const right = computeTotalsFrom('planilla-root-right');
    if ((left.puntosTotales + right.puntosTotales) !== TOTAL_POINTS) {
    setBtnState('error',`ERROR: La suma de puntos debe ser ${TOTAL_POINTS}`);
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('success','error','pending','rival-pending','btn');
      btn.classList.add('btn-validate');
      btn.textContent = 'VALIDAR PLANILLA';
    }, 3000);
    return;
    }

    if (ADMIN_TEST_MODE) {
      await saveMatchStatus(true);
      clearMismatchVisual();
      setBtnState('success', 'VALIDACIÓN DE PRUEBA');
      updatePictureButton(false);
      showToast('Modo prueba: validación simulada, sin guardar en backend.', 'success');
      return;
    }

    clearMismatchVisual();

    const statusForValidate = buildMatchStatus(true);
    const mine = buildValidationSnapshot(statusForValidate);

    const save = await fetch(apiUrl('/api/cruces/validate'), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        fechaISO: getCurrentFechaISO(),
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
      if (saveData?.validated) {
        setBtnState('pending', saveData?.mensaje || 'Esperando que el rival corrija y valide');
        startValidationPolling(btn);
      } else {
        setBtnState('error', saveData?.error || saveData?.mensaje || 'Los datos no coinciden, revisá la planilla');
      }
      return;
    }

    const statusResult = saveData;

    console.log('VALIDATE RESPONSE:', statusResult);

    if (statusResult?.tipo !== 'validado') {
      setBtnState('pending', statusResult?.mensaje || 'PENDIENTE: falta coincidencia final con tu rival');
      return;
    }

    stopValidationPolling();
    cancelAutosaveTimers();
    autosaveClear();
    clearMismatchVisual();
    lockValidatedMatchUI();

    setBtnState('success','VALIDADO');
    showToast('Validación exitosa','success');
    await hydrateValidatedState();
    updatePictureButton(true);
    await refreshTiebreakBlock();
  } catch (e) {
    console.error(e);
    setBtnState('error', e?.message || 'Error inesperado');
  } finally {
    if (!btn.classList.contains('success')) btn.disabled = false;
  }
};

  }

  function collectPlanilla(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return null;

    const plan = {
      capitan: [],
      individuales: [],
      pareja1: [],
      pareja2: [],
      suplentes: [],
      jugadorIds: {
        capitan: [],
        individuales: [],
        pareja1: [],
        pareja2: [],
        suplentes: []
      },
      substitutions: getRootSubstitutions(root).map(change => ({ ...change }))
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
        if (text) {
          plan[target].push(text);
          const playerId = Number(slot.dataset.playerId || 0) || null;
          plan.jugadorIds[target].push(playerId);
        }
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



function sheetFileNameForMatch(ext){
  const exportData = window.__CRUCE_EXPORT_DATA__ || {};

  const localRaw = exportData.local?.name || exportData.local?.team || 'local';
  const visitanteRaw = exportData.visitante?.name || exportData.visitante?.team || 'visitante';

  const slugify = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  const fechaRaw = String(exportData.date || exportData.fecha || window.__CRUCE_FECHA_ISO || '').trim();
  let fecha = '';
  if (fechaRaw) {
    const m = fechaRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) fecha = `${m[1]}-${m[2]}-${m[3]}`;
  }

  const local = slugify(localRaw);
  const visitante = slugify(visitanteRaw);

  return `${local}-vs-${visitante}${fecha ? '-' + fecha : ''}.${ext}`;
}



function isAndroidAppWebView(){
    return !!(window.AndroidBridge && typeof window.AndroidBridge.saveBase64File === 'function');
  }

  function saveBlobThroughAndroid(blob, fileName, mimeType){
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => {
          try {
            const dataUrl = reader.result;
            if (!dataUrl) {
              reject(new Error('No se pudo convertir el archivo a base64.'));
              return;
            }

            window.AndroidBridge.saveBase64File(
              String(dataUrl),
              String(fileName || 'archivo'),
              String(mimeType || blob?.type || 'application/octet-stream')
            );
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error('Error leyendo el archivo.'));
        reader.readAsDataURL(blob);
      } catch (err) {
        reject(err);
      }
    });
  }

  function notifyAndroidToast(message){
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.showToast === 'function') {
        window.AndroidBridge.showToast(String(message || ''));
      }
    } catch (_) {}
  }

  async function downloadBlob(blob, filename, mimeType){
    if (isAndroidAppWebView()) {
      await saveBlobThroughAndroid(blob, filename, mimeType || blob?.type || 'application/octet-stream');
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function safeText(value){
    return String(value || '').trim();
  }

  function safeArr(value, expected){
    const arr = Array.isArray(value) ? value.map((item) => safeText(item)) : [];
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

  function buildExportIndividualRows(localPlan, visitantePlan){
    const left = safeArr(localPlan?.individuales, INDIVIDUAL_COUNT);
    const right = safeArr(visitantePlan?.individuales, INDIVIDUAL_COUNT);

    return left.map((name, idx) => {
      if (idx === 0) {
        return `<tr>
          <td>${escapeHtml(name)}</td>
          <td></td>
          <td class="export-vs" rowspan="${INDIVIDUAL_COUNT}">VS.</td>
          <td></td>
          <td>${escapeHtml(right[idx])}</td>
        </tr>`;
      }
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td></td>
        <td></td>
        <td>${escapeHtml(right[idx])}</td>
      </tr>`;
    }).join('');
  }

  function buildExportDoublesRows(localPair, visitantePair){
    const l = safeArr(localPair, PAIR_SIZE);
    const r = safeArr(visitantePair, PAIR_SIZE);
    return `<tr>
      <td>${escapeHtml(l[0])}</td>
      <td rowspan="2"></td>
      <td class="export-vs" rowspan="2">VS.</td>
      <td rowspan="2"></td>
      <td>${escapeHtml(r[0])}</td>
    </tr>
    <tr>
      <td>${escapeHtml(l[1])}</td>
      <td>${escapeHtml(r[1])}</td>
    </tr>`;
  }

  function buildExportSubsRows(items){
    return safeArr(items, SUBSTITUTE_COUNT).map((item) => `<tr><td>${escapeHtml(item)}</td></tr>`).join('');
  }

  function buildExportSheetElement(){
    const exportData = window.__CRUCE_EXPORT_DATA__;
    if (!exportData) throw new Error('No hay datos del cruce para exportar.');

    const local = exportData.local || {};
    const visitante = exportData.visitante || {};
    const localPlan = exportData.localPlan || {};
    const visitantePlan = exportData.visitantePlan || {};
    const category = String(exportData.category || '').toUpperCase();
    const formattedDate = formatDate(exportData.date || window.__CRUCE_FECHA_ISO || '');

    const wrapper = document.createElement('section');
    wrapper.className = 'export-a4-sheet';
    wrapper.innerHTML = `
      <div class="export-meta">
        <span>Categoría: ${escapeHtml(category)}</span>
        <span>${formattedDate ? escapeHtml(formattedDate) : 'Planilla'}</span>
      </div>

      <h1 class="export-league-title">L.I.P.A.</h1>
      <div class="export-bar"></div>

      <div class="export-header-grid">
        <div>
          <table class="export-form" aria-label="Datos de sala local">
            <tr>
              <td class="label-cell">SALA</td>
              <td>${escapeHtml(local.name || '')}</td>
            </tr>
            <tr>
              <td class="label-cell">CAPITANÍA</td>
              <td>${escapeHtml(safeArr(localPlan.capitan, CAPTAIN_COUNT).filter(Boolean).join(' / '))}</td>
            </tr>
          </table>
        </div>

        <div class="export-logo">
          <img src="../logo_liga.png" alt="Logo Liga" onerror="this.style.display='none';" />
        </div>

        <div>
          <table class="export-form" aria-label="Datos de sala visitante">
            <tr>
              <td>${escapeHtml(visitante.name || '')}</td>
              <td class="label-cell">SALA</td>
            </tr>
            <tr>
              <td>${escapeHtml(safeArr(visitantePlan.capitan, CAPTAIN_COUNT).filter(Boolean).join(' / '))}</td>
              <td class="label-cell">CAPITANÍA</td>
            </tr>
          </table>
        </div>
      </div>

      <div class="export-section">
        <table aria-label="Partidos individuales">
          <colgroup>
            <col style="width:32.5%">
            <col style="width:5%">
            <col style="width:25%">
            <col style="width:5%">
            <col style="width:32.5%">
          </colgroup>
          <thead class="export-ind-head">
            <tr>
              <th colspan="2">NOMBRE Y APELLIDO</th>
              <th>INDIVIDUALES</th>
              <th colspan="2">NOMBRE Y APELLIDO</th>
            </tr>
          </thead>
          <tbody>${buildExportIndividualRows(localPlan, visitantePlan)}</tbody>
        </table>
      </div>

      ${PAIR_COUNT >= 1 ? `<div class="export-doubles-wrap">
        <div class="export-doubles-label">PAREJAS 1</div>
        <table aria-label="Parejas 1">
          <colgroup>
            <col style="width:32.5%">
            <col style="width:5%">
            <col style="width:25%">
            <col style="width:5%">
            <col style="width:32.5%">
          </colgroup>
          <tbody>${buildExportDoublesRows(localPlan.pareja1, visitantePlan.pareja1)}</tbody>
        </table>
      </div>` : ''}

      ${PAIR_COUNT >= 2 ? `<div class="export-doubles-wrap">
        <div class="export-doubles-label">PAREJAS 2</div>
        <table aria-label="Parejas 2">
          <colgroup>
            <col style="width:32.5%">
            <col style="width:5%">
            <col style="width:25%">
            <col style="width:5%">
            <col style="width:32.5%">
          </colgroup>
          <tbody>${buildExportDoublesRows(localPlan.pareja2, visitantePlan.pareja2)}</tbody>
        </table>
      </div>` : ''}

      <div class="export-section">
        <table class="export-result" aria-label="Resultado final">
          <colgroup>
            <col style="width:42%">
            <col style="width:8%">
            <col style="width:8%">
            <col style="width:42%">
          </colgroup>
          <thead>
            <tr>
              <th>SALA</th>
              <th colspan="2">RESULTADO FINAL</th>
              <th>SALA</th>
            </tr>
          </thead>
          <tbody>
            <tr><td></td><td></td><td></td><td></td></tr>
            <tr>
              <td class="export-tri-left">TRIÁNGULOS TOTALES :</td>
              <td></td>
              <td></td>
              <td class="export-tri-right">: TRIÁNGULOS TOTALES</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="export-subs-grid">
        <div>
          <table class="export-subs-table" aria-label="Suplentes local">
            <thead><tr><th>SUPLENTES</th></tr></thead>
            <tbody>${buildExportSubsRows(localPlan.suplentes)}</tbody>
          </table>
        </div>
        <div>
          <table class="export-subs-table" aria-label="Suplentes visitante">
            <thead><tr><th>SUPLENTES</th></tr></thead>
            <tbody>${buildExportSubsRows(visitantePlan.suplentes)}</tbody>
          </table>
        </div>
      </div>

      <div class="export-signatures">
        <div class="export-signature">
          <div class="export-signature-line"></div>
          <div class="export-signature-label">FIRMA LOCAL</div>
        </div>
        <div class="export-signature">
          <div class="export-signature-line"></div>
          <div class="export-signature-label">FIRMA VISITANTE</div>
        </div>
      </div>
    `;
    return wrapper;
  }

  async function renderExportCanvas(){
    if (!window.html2canvas) throw new Error('Falta html2canvas para exportar.');
    const previousBodyZoom = document.body.style.zoom;
    let sheet = null;

    try {
      // El layout de escritorio usa body { zoom: .8 }. html2canvas hereda ese
      // zoom y comprime la hoja y los glifos. La exportación debe renderizarse
      // siempre en las dimensiones A4 reales.
      document.body.style.zoom = '1';
      sheet = buildExportSheetElement();
      document.body.appendChild(sheet);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      return await window.html2canvas(sheet, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        width: 794,
        height: 1123,
        windowWidth: 794,
        windowHeight: 1123
      });
    } finally {
      sheet?.remove();
      document.body.style.zoom = previousBodyZoom;
    }
  }

  async function exportCurrentSheetAsPdf(){
    if (!window.jspdf?.jsPDF) throw new Error('Falta jsPDF para exportar.');
    const canvas = await renderExportCanvas();
    const imgData = canvas.toDataURL('image/png');
    const pdf = new window.jspdf.jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');

    const filename = sheetFileNameForMatch('pdf');
    if (isAndroidAppWebView()) {
      const pdfBlob = pdf.output('blob');
      await downloadBlob(pdfBlob, filename, 'application/pdf');
      return;
    }

    pdf.save(filename);
  }

  async function exportCurrentSheetAsJpg(){
    const canvas = await renderExportCanvas();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.96));
    if (!blob) throw new Error('No se pudo generar la imagen JPG.');
    await downloadBlob(blob, sheetFileNameForMatch('jpg'), 'image/jpeg');
  }

  function wireExportButtons(){
    const btnPdf = document.getElementById('btnDownloadPdf');
    const btnJpg = document.getElementById('btnDownloadJpg');
    if (!btnPdf || !btnJpg) return;

    const guard = () => {
      if (!window.__CRUCE_EXPORT_DATA__) {
        showToast('Todavía no se cargó la planilla del cruce.', 'error');
        return false;
      }
      return true;
    };

    btnPdf.addEventListener('click', async () => {
      if (!guard()) return;
      try {
        btnPdf.disabled = true;
        await exportCurrentSheetAsPdf();
        showToast(isAndroidAppWebView() ? 'PDF guardado correctamente.' : 'PDF generado correctamente.', 'success');
        notifyAndroidToast(isAndroidAppWebView() ? 'PDF guardado correctamente.' : 'PDF generado correctamente.');
      } catch (e) {
        console.error(e);
        showToast(e?.message || 'No se pudo generar el PDF.', 'error');
      } finally {
        btnPdf.disabled = false;
      }
    });

    btnJpg.addEventListener('click', async () => {
      if (!guard()) return;
      try {
        btnJpg.disabled = true;
        await exportCurrentSheetAsJpg();
        showToast(isAndroidAppWebView() ? 'JPG guardado correctamente.' : 'JPG generado correctamente.', 'success');
        notifyAndroidToast(isAndroidAppWebView() ? 'JPG guardado correctamente.' : 'JPG generado correctamente.');
      } catch (e) {
        console.error(e);
        showToast(e?.message || 'No se pudo generar el JPG.', 'error');
      } finally {
        btnJpg.disabled = false;
      }
    });
  }


  function syncSlotWidths() {
    document.documentElement.style.setProperty('--slot-base-w', '300px');
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

    leftRows.forEach(r => { r.style.height = ''; r.style.minHeight = ''; });
    rightRows.forEach(r => { r.style.height = ''; r.style.minHeight = ''; });

    for (let i = 0; i < max; i++) {
      const l = leftRows[i];
      const r = rightRows[i];
      if (!l || !r) continue;

      const h = Math.max(l.offsetHeight, r.offsetHeight);
      l.style.height = h + 'px';
      r.style.height = h + 'px';
      l.style.minHeight = h + 'px';
      r.style.minHeight = h + 'px';
    }
  }

  function syncSectionHeadingHeights() {
    const leftHeadings = document.querySelectorAll('#planilla-root-left .section h2');
    const rightHeadings = document.querySelectorAll('#planilla-root-right .section h2');
    const max = Math.max(leftHeadings.length, rightHeadings.length);

    leftHeadings.forEach(h => { h.style.minHeight = ''; });
    rightHeadings.forEach(h => { h.style.minHeight = ''; });

    for (let i = 0; i < max; i++) {
      const l = leftHeadings[i];
      const r = rightHeadings[i];
      if (!l || !r) continue;
      const h = Math.max(l.offsetHeight, r.offsetHeight);
      l.style.minHeight = h + 'px';
      r.style.minHeight = h + 'px';
    }
  }

  function syncCardLayout() {
    syncSlotWidths();
    syncHeaderHeights();
    syncSectionStarts();
    syncSectionHeadingHeights();
    syncRowHeights();
  }

  function scheduleSyncCardLayout() {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(syncCardLayout);
  }


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
      const cruces = Array.isArray(crucesRaw?.cruces) ? crucesRaw.cruces : [];

      let match = findCruceForTeam(cruces, teamCandidates, window.__CRUCE_ACTIVE_FIXTURE_DATE || '');

      if (!match) {
        match = await loadProximoCruceFromLlaves(category, teamSlug);
      }

      if (!match) {
        throw new Error('No se encontró un cruce para el equipo logueado ni en fixture ni en llaves.');
      }

      window.__CRUCE_FECHA_ISO = match.date || crucesRaw?.fechaFixture || new Date().toISOString().slice(0,10);

      const local = { name: match.local, teamSlug: match.localSlug || normPlanillaSlug(match.local) };
      const visitante = { name: match.visitante, teamSlug: match.visitanteSlug || normPlanillaSlug(match.visitante) };

      const localPlan = await loadFirstExistingPlanilla(local.teamSlug || local.name);
      const visitantePlan = await loadFirstExistingPlanilla(visitante.teamSlug || visitante.name);

      window.__CRUCE_EXPORT_DATA__ = {
        category,
        date: match.date || crucesRaw?.fechaFixture || window.__CRUCE_FECHA_ISO || '',
        local,
        visitante,
        localPlan,
        visitantePlan
      };

      renderSide('planilla-root-left',  localPlan,     visitante.name, match.date, local.name, local.teamSlug);
      renderSide('planilla-root-right', visitantePlan, local.name,     match.date, visitante.name, visitante.teamSlug);

      document.getElementById('btnClosePlayerPhoto')?.addEventListener('click', closePlayerPhoto);
      document.getElementById('btnPlayerProfile')?.addEventListener('click', openPlayerProfile);
      document.getElementById('btnClosePlayerProfile')?.addEventListener('click', closePlayerProfile);
      document.getElementById('playerProfileModal')?.addEventListener('click', ev => {
        if (ev.target?.matches('[data-close-player-profile]')) closePlayerProfile();
      });
      document.getElementById('playerPhotoModal')?.addEventListener('click', ev => {
        if (ev.target?.matches('[data-close-player-photo]')) closePlayerPhoto();
      });
      document.addEventListener('keydown', ev => {
        const modal = document.getElementById('playerPhotoModal');
        const profileModal = document.getElementById('playerProfileModal');
        if (ev.key === 'Escape' && profileModal && !profileModal.hidden) {
          closePlayerProfile();
        } else if (ev.key === 'Escape' && modal && !modal.hidden) {
          closePlayerPhoto();
        }
      });

      ['planilla-root-left', 'planilla-root-right'].forEach(id => {
        const root = document.getElementById(id);
        root?.addEventListener('change', e => {
          if (e.target?.classList?.contains('pts-select')) updateScoresFor();
        });
      });

      updateScoresFor();

      setupSuplentesSwap('planilla-root-left');
      setupSuplentesSwap('planilla-root-right');

      setupValidationButtons(local, visitante, match.date || new Date().toISOString().slice(0,10));

      requestAnimationFrame(() => {
        syncCardLayout();
        setTimeout(syncCardLayout, 60);
        setTimeout(syncCardLayout, 180);
      });
    } catch (e) {
      console.error(e);
      const err = document.getElementById('appError');
      if (err) { err.style.display = 'block'; err.textContent = e.message || 'Error al cargar'; }
    } finally {
      loading.remove();
    }
  }


window.addEventListener('load', async () => {
  setupAdminTestMode();
  wireExportButtons();
  const category = deriveCategory();
  const allowed = await checkCrucesEnabled(category);

  if (allowed) {
    bootCruces().catch(console.error);
  }

  const volverBtn = document.getElementById('btnVolver');
  if (volverBtn) {
    volverBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.history.back();
    });
  }
});

let resizeRaf = 0;
window.addEventListener('resize', scheduleSyncCardLayout);
window.addEventListener('orientationchange', scheduleSyncCardLayout);

if (document.fonts?.ready) {
  document.fonts.ready.then(() => scheduleSyncCardLayout()).catch(() => {});
}

window.addEventListener('load', () => {
  setTimeout(syncCardLayout, 120);
});

if ('ResizeObserver' in window) {
  const observer = new ResizeObserver(() => scheduleSyncCardLayout());
  window.addEventListener('load', () => {
    const leftCard = document.querySelector('#planilla-root-left .card');
    const rightCard = document.querySelector('#planilla-root-right .card');
    if (leftCard) observer.observe(leftCard);
    if (rightCard) observer.observe(rightCard);
  });
}
})();
