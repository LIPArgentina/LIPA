const express = require('express');
const router = express.Router();
const pool = require('../../db');

// ===== ADMIN CRUCES (persistido + automatización por fixture) =====

const CATEGORY_KEYS = {
  tercera: '__categoria_tercera__',
  segunda: '__categoria_segunda__'
};

const ARG_TZ_OFFSET = '-03:00';
let ensureCrucesAdminStoragePromise = null;

function normalizeCrucesAdminKey(team) {
  return String(team || '').trim().toLowerCase();
}

async function ensureCrucesAdminStorage() {
  if (!ensureCrucesAdminStoragePromise) {
    ensureCrucesAdminStoragePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cruces_admin_config (
          team TEXT PRIMARY KEY,
          manual_enabled BOOLEAN NOT NULL DEFAULT false,
          automation_enabled BOOLEAN NOT NULL DEFAULT true,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((err) => {
      ensureCrucesAdminStoragePromise = null;
      throw err;
    });
  }
  return ensureCrucesAdminStoragePromise;
}

async function getOrCreateCrucesAdminConfig(team) {
  await ensureCrucesAdminStorage();
  const key = normalizeCrucesAdminKey(team);

  await pool.query(
    `
      INSERT INTO cruces_admin_config (team)
      VALUES ($1)
      ON CONFLICT (team) DO NOTHING
    `,
    [key]
  );

  const { rows } = await pool.query(
    `
      SELECT team, manual_enabled, automation_enabled, updated_at
      FROM cruces_admin_config
      WHERE team = $1
      LIMIT 1
    `,
    [key]
  );

  return rows[0] || {
    team: key,
    manual_enabled: false,
    automation_enabled: true,
    updated_at: null
  };
}

async function updateCrucesAdminConfig(team, patch = {}) {
  const current = await getOrCreateCrucesAdminConfig(team);
  const manualEnabled = typeof patch.manual_enabled === 'boolean'
    ? patch.manual_enabled
    : !!current.manual_enabled;
  const automationEnabled = typeof patch.automation_enabled === 'boolean'
    ? patch.automation_enabled
    : !!current.automation_enabled;

  const { rows } = await pool.query(
    `
      INSERT INTO cruces_admin_config (team, manual_enabled, automation_enabled, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (team)
      DO UPDATE SET
        manual_enabled = EXCLUDED.manual_enabled,
        automation_enabled = EXCLUDED.automation_enabled,
        updated_at = NOW()
      RETURNING team, manual_enabled, automation_enabled, updated_at
    `,
    [normalizeCrucesAdminKey(team), manualEnabled, automationEnabled]
  );

  return rows[0];
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function parseArgDateAt(dateKey, hour = 0, minute = 0, second = 0) {
  return new Date(`${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${ARG_TZ_OFFSET}`);
}

function addDaysToDateKey(dateKey, days) {
  const base = parseArgDateAt(dateKey, 12, 0, 0);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function nowInArgentina() {
  return new Date();
}

function computeFixtureWindow(dateKey) {
  const startKey = addDaysToDateKey(dateKey, -1);
  const nextDayKey = addDaysToDateKey(dateKey, 1);
  return {
    fixtureDate: dateKey,
    scheduledAt: parseArgDateAt(startKey, 20, 0, 0),
    closesAt: parseArgDateAt(nextDayKey, 12, 0, 0)
  };
}

function computeNextAutomation(fixtures = []) {
  const dateKeys = [...new Set(
    fixtures
      .map((item) => String(item?.date || '').slice(0, 10))
      .filter(isDateKey)
  )].sort();

  if (!dateKeys.length) {
    return {
      nextFixtureDate: null,
      scheduledAt: null,
      closesAt: null,
      scheduledEnabled: false,
      remainingMs: 0,
      reason: 'fixture_missing'
    };
  }

  const now = nowInArgentina();

  for (const dateKey of dateKeys) {
    const window = computeFixtureWindow(dateKey);
    if (now < window.closesAt) {
      const scheduledEnabled = now >= window.scheduledAt && now < window.closesAt;
      return {
        nextFixtureDate: dateKey,
        scheduledAt: window.scheduledAt.toISOString(),
        closesAt: window.closesAt.toISOString(),
        scheduledEnabled,
        remainingMs: scheduledEnabled ? Math.max(0, window.closesAt.getTime() - now.getTime()) : 0,
        reason: scheduledEnabled ? 'scheduled_open' : 'scheduled_pending'
      };
    }
  }

  const lastWindow = computeFixtureWindow(dateKeys[dateKeys.length - 1]);
  return {
    nextFixtureDate: dateKeys[dateKeys.length - 1],
    scheduledAt: lastWindow.scheduledAt.toISOString(),
    closesAt: lastWindow.closesAt.toISOString(),
    scheduledEnabled: false,
    remainingMs: 0,
    reason: 'fixture_past'
  };
}


function parseLlavesDateKey(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function collectLlavesAutomationDates(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((item) => collectLlavesAutomationDates(item, out));
    return out;
  }
  if (typeof node !== 'object') return out;

  const possibleDate = node.date || node.fecha || node.fechaISO || node.fechaKey || node.scheduledAt;
  const hasMatchShape = !!(
    node.local || node.visitante || node.localSlug || node.visitanteSlug ||
    node.home || node.away || node.teamA || node.teamB || node.equipoA || node.equipoB ||
    node.player1 || node.player2
  );
  const dateKey = parseLlavesDateKey(possibleDate);
  if (dateKey && hasMatchShape) out.push({ date: dateKey, kind: 'llaves' });

  Object.values(node).forEach((value) => collectLlavesAutomationDates(value, out));
  return out;
}

async function fetchAutomationLlavesInfo(category) {
  if (!category) return [];
  try {
    const { rows } = await pool.query(
      `SELECT data FROM llaves_data WHERE category = $1 LIMIT 1`,
      [category]
    );
    return collectLlavesAutomationDates(rows?.[0]?.data || null, []);
  } catch (err) {
    console.warn('No se pudieron cargar fechas de llaves para automatización', { category, err: err?.message });
    return [];
  }
}

async function fetchAutomationFixtureInfo(team) {
  const category = inferCategoryFromTeamMarker(team);
  if (!category) {
    return {
      category: null,
      fixtures: [],
      nextFixtureDate: null,
      scheduledAt: null,
      closesAt: null,
      scheduledEnabled: false,
      remainingMs: 0,
      reason: 'invalid_category'
    };
  }

  const { rows } = await pool.query(
    `
      SELECT kind, data, updated_at, id
      FROM fixtures
      WHERE category = $1
      ORDER BY
        CASE kind WHEN 'ida' THEN 0 WHEN 'vuelta' THEN 1 ELSE 9 END,
        updated_at DESC,
        id DESC
    `,
    [category]
  );

  const fixtures = [];
  for (const row of rows) {
    const fechas = Array.isArray(row?.data?.fechas) ? row.data.fechas : [];
    for (const fecha of fechas) {
      const dateKey = String(fecha?.date || '').slice(0, 10);
      if (!isDateKey(dateKey)) continue;
      fixtures.push({ date: dateKey, kind: row.kind });
    }
  }

  // En fase de llaves puede no existir una próxima fecha útil en fixture.
  // Para que la habilitación automática siga el cruce real, sumamos las fechas cargadas en llaves_data.
  const llavesFixtures = await fetchAutomationLlavesInfo(category);
  const automationFixtures = [...fixtures, ...llavesFixtures];
  const automation = computeNextAutomation(automationFixtures);

  return {
    category,
    fixtures: automationFixtures,
    ...automation,
    source: llavesFixtures.some(item => item.date === automation.nextFixtureDate) ? 'llaves' : 'fixture'
  };
}

async function buildCrucesAdminStatus(team) {
  const config = await getOrCreateCrucesAdminConfig(team);
  const automation = await fetchAutomationFixtureInfo(team);
  const manualEnabled = !!config.manual_enabled;
  const automationEnabled = !!config.automation_enabled;
  const scheduledEnabled = automationEnabled && !!automation.scheduledEnabled;
  const enabled = manualEnabled || scheduledEnabled;
  const remainingMs = enabled
    ? Math.max(Number(automation.remainingMs || 0), 0)
    : 0;

  return {
    ok: true,
    team: normalizeCrucesAdminKey(team),
    enabled,
    remainingMs,
    manualEnabled,
    automationEnabled,
    automationReason: automation.reason,
    nextFixtureDate: automation.nextFixtureDate,
    scheduledAt: automation.scheduledAt,
    closesAt: automation.closesAt,
    category: automation.category
  };
}

router.get('/status', async (req, res) => {
  try {
    const { team } = req.query;
    if (!team) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
    }

    const state = await buildCrucesAdminStatus(team);
    return res.json(state);
  } catch (err) {
    console.error('GET /api/cruces/status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo obtener el estado de cruces.' });
  }
});

router.post('/enable', async (req, res) => {
  try {
    const { team } = req.body || {};
    if (!team) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
    }

    await updateCrucesAdminConfig(team, { manual_enabled: true });
    return res.json(await buildCrucesAdminStatus(team));
  } catch (err) {
    console.error('POST /api/cruces/enable', err);
    return res.status(500).json({ ok: false, error: 'No se pudo habilitar cruces.' });
  }
});

router.post('/disable', async (req, res) => {
  try {
    const { team } = req.body || {};
    if (!team) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
    }

    await updateCrucesAdminConfig(team, { manual_enabled: false });
    return res.json(await buildCrucesAdminStatus(team));
  } catch (err) {
    console.error('POST /api/cruces/disable', err);
    return res.status(500).json({ ok: false, error: 'No se pudo deshabilitar cruces.' });
  }
});

router.post('/automation', async (req, res) => {
  try {
    const { team, enabled } = req.body || {};
    if (!team || typeof enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros team/enabled.' });
    }

    await updateCrucesAdminConfig(team, { automation_enabled: enabled });
    return res.json(await buildCrucesAdminStatus(team));
  } catch (err) {
    console.error('POST /api/cruces/automation', err);
    return res.status(500).json({ ok: false, error: 'No se pudo actualizar la automatización.' });
  }
});

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = () => {
    res.write(`data: ping\n\n`);
  };

  const timer = setInterval(send, 10000);
  send();

  req.on('close', () => {
    clearInterval(timer);
  });
});

// ===== HELPERS =====

function normalizeSlug(value = '') {
  return String(value || '').trim().toLowerCase();
}

function slugMatchesTeam(teamSlug, matchSlug) {
  const a = normalizeSlug(teamSlug);
  const b = normalizeSlug(matchSlug);
  return a === b || a.startsWith(`${b}_`);
}


function getAuthorizedTeamSlug(req) {
  const primary = normalizeSlug(req.user?.slug || '');
  const secondary = normalizeSlug(req.user?.slugBase || '');
  return { primary, secondary };
}

function ensureAuthorizedTeam(req, incomingTeamSlug) {
  const incoming = normalizeSlug(incomingTeamSlug);
  const { primary, secondary } = getAuthorizedTeamSlug(req);
  if (!primary) return '';
  if (!incoming) return primary;
  if (incoming === primary || (secondary && incoming === secondary)) return primary;
  return '';
}


function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}



function inferCategoryFromTeamMarker(team = '') {
  const value = String(team || '').trim().toLowerCase();
  if (value === '__categoria_segunda__') return 'segunda';
  if (value === '__categoria_tercera__') return 'tercera';
  return null;
}

function normalizeDateOnly(value) {
  return String(value || '').slice(0, 10);
}

function pickFixtureFecha(fechas = []) {
  const normalized = fechas
    .map((fecha) => ({
      raw: fecha,
      dateKey: normalizeDateOnly(fecha?.date)
    }))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.dateKey))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  if (!normalized.length) return null;

  const todayKey = new Date().toISOString().slice(0, 10);
  return normalized.find((f) => f.dateKey >= todayKey)?.raw || normalized[normalized.length - 1].raw;
}

function extractCrucesFromFecha(fechaNode) {
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
        pendienteLocal = nombre;
        continue;
      }

      if (categoria === 'visitante') {
        if (pendienteLocal && nombre.toUpperCase() !== 'WO' && pendienteLocal.toUpperCase() !== 'WO') {
          cruces.push({ local: pendienteLocal, visitante: nombre });
        }
        pendienteLocal = null;
      }
    }
  }

  return cruces;
}

async function fetchCrucesFromDB(team) {
  const category = inferCategoryFromTeamMarker(team);
  if (!category) throw new Error('Categoría inválida');

  const { rows } = await pool.query(
    "SELECT data FROM fixtures WHERE kind='ida' AND category=$1 ORDER BY id DESC LIMIT 1",
    [category]
  );

  const fechas = rows[0]?.data?.fechas || [];
  const fecha = pickFixtureFecha(fechas);

  if (!fecha) return { cruces: [], fechaFixture: null };

  return {
    cruces: extractCrucesFromFecha(fecha),
    fechaFixture: normalizeDateOnly(fecha.date)
  };
}

function resolveTeamKey(equipoSlug, localSlug, visitanteSlug) {
  const equipoNorm = normalizeSlug(equipoSlug);
  if (slugMatchesTeam(equipoNorm, localSlug)) return normalizeSlug(localSlug);
  if (slugMatchesTeam(equipoNorm, visitanteSlug)) return normalizeSlug(visitanteSlug);
  return null;
}

function buildFechaKey(fechaISO, localSlug, visitanteSlug) {
  return `${fechaISO}::${normalizeSlug(localSlug)}::${normalizeSlug(visitanteSlug)}`;
}

function buildTiebreakFechaKey(fechaISO, localSlug, visitanteSlug) {
  return `${buildFechaKey(fechaISO, localSlug, visitanteSlug)}::desempate`;
}

function normalizeTiebreakStatus(status = {}) {
  const localPair = Array.isArray(status?.local?.pareja) ? status.local.pareja : [];
  const visitantePair = Array.isArray(status?.visitante?.pareja) ? status.visitante.pareja : [];
  return {
    tipo: 'desempate',
    fechaISO: normalizeDateOnly(status?.fechaISO || ''),
    localSlug: normalizeSlug(status?.localSlug || ''),
    visitanteSlug: normalizeSlug(status?.visitanteSlug || ''),
    local: {
      pareja: localPair.map(v => String(v || '').trim()).slice(0, 2),
      puntos: Number(status?.local?.puntos || 0)
    },
    visitante: {
      pareja: visitantePair.map(v => String(v || '').trim()).slice(0, 2),
      puntos: Number(status?.visitante?.puntos || 0)
    }
  };
}

function compareTiebreakStatus(a = {}, b = {}) {
  const A = normalizeTiebreakStatus(a);
  const B = normalizeTiebreakStatus(b);
  const diffs = [];
  if (!valuesEqual(A.local.pareja[0], B.local.pareja[0])) diffs.push({ type: 'tiebreak', side: 'local', field: 'pareja1' });
  if (!valuesEqual(A.local.pareja[1], B.local.pareja[1])) diffs.push({ type: 'tiebreak', side: 'local', field: 'pareja2' });
  if (!valuesEqual(A.visitante.pareja[0], B.visitante.pareja[0])) diffs.push({ type: 'tiebreak', side: 'visitante', field: 'pareja1' });
  if (!valuesEqual(A.visitante.pareja[1], B.visitante.pareja[1])) diffs.push({ type: 'tiebreak', side: 'visitante', field: 'pareja2' });
  if (Number(A.local.puntos || 0) !== Number(B.local.puntos || 0)) diffs.push({ type: 'tiebreak', side: 'local', field: 'puntos' });
  if (Number(A.visitante.puntos || 0) !== Number(B.visitante.puntos || 0)) diffs.push({ type: 'tiebreak', side: 'visitante', field: 'puntos' });
  return diffs;
}

function isValidTiebreakScore(localPts, visitantePts) {
  const l = Number(localPts || 0);
  const v = Number(visitantePts || 0);
  return ((l === 5 && v >= 0 && v <= 4) || (v === 5 && l >= 0 && l <= 4));
}

function valuesEqual(a, b) {
  return normalizeText(a) === normalizeText(b);
}

function arrayDiffs(side, section, a = [], b = []) {
  const max = Math.max(a.length, b.length);
  const diffs = [];
  for (let i = 0; i < max; i++) {
    if (!valuesEqual(a[i], b[i])) {
      diffs.push({ type: 'slot', side, section, index: i });
    }
  }
  return diffs;
}

function scoreDiffs(side, arrA = [], arrB = []) {
  const max = Math.max(arrA.length, arrB.length);
  const diffs = [];
  for (let i = 0; i < max; i++) {
    const a = Number(arrA[i] ?? 0);
    const b = Number(arrB[i] ?? 0);
    if (a !== b) {
      diffs.push({ type: 'score', side, scoreIndex: i });
    }
  }
  return diffs;
}

function compareFullStatus(mine = {}, rival = {}) {
  const diffs = [];

  const localA = mine?.localPlanilla || {};
  const localB = rival?.localPlanilla || {};
  const visA = mine?.visitantePlanilla || {};
  const visB = rival?.visitantePlanilla || {};

  diffs.push(...arrayDiffs('local', 'CAPITÁN', localA.capitan, localB.capitan));
  diffs.push(...arrayDiffs('local', 'INDIVIDUALES', localA.individuales, localB.individuales));
  diffs.push(...arrayDiffs('local', 'PAREJA 1', localA.pareja1, localB.pareja1));
  diffs.push(...arrayDiffs('local', 'PAREJA 2', localA.pareja2, localB.pareja2));
  diffs.push(...arrayDiffs('local', 'SUPLENTES', localA.suplentes, localB.suplentes));

  diffs.push(...arrayDiffs('visitante', 'CAPITÁN', visA.capitan, visB.capitan));
  diffs.push(...arrayDiffs('visitante', 'INDIVIDUALES', visA.individuales, visB.individuales));
  diffs.push(...arrayDiffs('visitante', 'PAREJA 1', visA.pareja1, visB.pareja1));
  diffs.push(...arrayDiffs('visitante', 'PAREJA 2', visA.pareja2, visB.pareja2));
  diffs.push(...arrayDiffs('visitante', 'SUPLENTES', visA.suplentes, visB.suplentes));

  const localScoreA = Array.isArray(mine?.local?.scoreRows) ? mine.local.scoreRows : [];
  const localScoreB = Array.isArray(rival?.local?.scoreRows) ? rival.local.scoreRows : [];
  const visScoreA = Array.isArray(mine?.visitante?.scoreRows) ? mine.visitante.scoreRows : [];
  const visScoreB = Array.isArray(rival?.visitante?.scoreRows) ? rival.visitante.scoreRows : [];

  diffs.push(...scoreDiffs('local', localScoreA, localScoreB));
  diffs.push(...scoreDiffs('visitante', visScoreA, visScoreB));

  const localTriA = Number(mine?.local?.triangulosTotales ?? mine?.local?.triangulos ?? 0);
  const localTriB = Number(rival?.local?.triangulosTotales ?? rival?.local?.triangulos ?? 0);
  const localPtsA = Number(mine?.local?.puntosTotales ?? 0);
  const localPtsB = Number(rival?.local?.puntosTotales ?? 0);

  const visTriA = Number(mine?.visitante?.triangulosTotales ?? mine?.visitante?.triangulos ?? 0);
  const visTriB = Number(rival?.visitante?.triangulosTotales ?? rival?.visitante?.triangulos ?? 0);
  const visPtsA = Number(mine?.visitante?.puntosTotales ?? 0);
  const visPtsB = Number(rival?.visitante?.puntosTotales ?? 0);

  if (localTriA !== localTriB) diffs.push({ type: 'total', side: 'local', metric: 'triangulos' });
  if (localPtsA !== localPtsB) diffs.push({ type: 'total', side: 'local', metric: 'puntos' });
  if (visTriA !== visTriB) diffs.push({ type: 'total', side: 'visitante', metric: 'triangulos' });
  if (visPtsA !== visPtsB) diffs.push({ type: 'total', side: 'visitante', metric: 'puntos' });

  return diffs;
}

function setNoCache(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

// ===== CRUCES DESDE DB =====

router.get('/cruces', async (req, res) => {
  const team = String(req.query.team || '').trim();
  if (!team) {
    return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
  }

  try {
    const result = await fetchCrucesFromDB(team);
    return res.json({ ok: true, team, ...result });
  } catch (e) {
    console.error('GET /cruces', e);
    return res.status(500).json({ ok: false, error: 'Error obteniendo cruces.' });
  }
});

router.post('/', async (req, res) => {
  const team = String(req.body?.team || '').trim();
  if (!team) {
    return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
  }

  try {
    const result = await fetchCrucesFromDB(team);
    return res.json({ ok: true, team, ...result });
  } catch (e) {
    console.error('POST /cruces', e);
    return res.status(500).json({ ok: false, error: 'Error obteniendo cruces.' });
  }
});

// ===== AUTOSAVE / VALIDACIÓN CRUCES =====

router.post('/match-status', async (req, res) => {
  try {
    const {
      localSlug,
      visitanteSlug,
      fechaISO,
      equipoSlug: rawEquipoSlug,
      status
    } = req.body || {};
    const equipoSlug = normalizeSlug(rawEquipoSlug || '');

    if (!localSlug || !visitanteSlug || !fechaISO || !equipoSlug) {
      return res.status(400).json({ ok: false, error: 'Faltan datos' });
    }

    const localKey = normalizeSlug(localSlug);
    const visitanteKey = normalizeSlug(visitanteSlug);
    const equipoKey = normalizeSlug(equipoSlug);

    const result = await pool.query(
      `
      INSERT INTO cruces_match_status (
        local_slug,
        visitante_slug,
        fecha_iso,
        equipo_slug,
        status_json,
        updated_at
      )
      VALUES ($1, $2, $3::date, $4, $5::jsonb, NOW())
      ON CONFLICT (local_slug, visitante_slug, fecha_iso, equipo_slug)
      DO UPDATE SET
        status_json = EXCLUDED.status_json,
        updated_at = NOW()
      RETURNING local_slug, visitante_slug, fecha_iso, equipo_slug, updated_at
      `,
      [localKey, visitanteKey, fechaISO, equipoKey, JSON.stringify(status || {})]
    );

    return res.json({ ok: true, saved: result.rows[0] });
  } catch (err) {
    console.error('POST /match-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo guardar el status del cruce' });
  }
});

router.get('/match-status', async (req, res) => {
  setNoCache(res);
  try {
    const localSlug = normalizeSlug(req.query.localSlug || '');
    const visitanteSlug = normalizeSlug(req.query.visitanteSlug || '');
    const fechaISO = String(req.query.fechaISO || '').trim();
    const equipoSlug = normalizeSlug(req.query.equipoSlug || '');

    if (!localSlug || !visitanteSlug || !fechaISO || !equipoSlug) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    }

    const result = await pool.query(
      `
      SELECT local_slug, visitante_slug, fecha_iso, equipo_slug, status_json, updated_at
      FROM cruces_match_status
      WHERE local_slug = $1
        AND visitante_slug = $2
        AND fecha_iso = $3::date
        AND equipo_slug = $4
      LIMIT 1
      `,
      [localSlug, visitanteSlug, fechaISO, equipoSlug]
    );

    if (!result.rows.length) {
      return res.json({ ok: true, data: null });
    }

    return res.json({
      ok: true,
      data: result.rows[0].status_json,
      updatedAt: result.rows[0].updated_at
    });
  } catch (err) {
    console.error('GET /match-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo obtener el status del cruce' });
  }
});

router.post('/validate', async (req, res) => {
  try {
    const {
      fechaISO,
      localSlug,
      visitanteSlug,
      equipoSlug: rawEquipoSlug,
      validacion,
      status
    } = req.body || {};
    const equipoSlug = normalizeSlug(rawEquipoSlug || '');

    if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug || !status) {
      return res.status(400).json({ ok: false, error: 'Faltan datos' });
    }

    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) {
      return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
    }

    const rivalKey = teamKey === normalizeSlug(localSlug)
      ? normalizeSlug(visitanteSlug)
      : normalizeSlug(localSlug);

    const fechaKey = buildFechaKey(fechaISO, localSlug, visitanteSlug);

    await pool.query(
      `
      INSERT INTO cruces_validations (
        team,
        fecha_key,
        validacion_json,
        status_json,
        validated,
        locked_until,
        updated_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, true, NULL, NOW())
      ON CONFLICT (team, fecha_key)
      DO UPDATE SET
        validacion_json = EXCLUDED.validacion_json,
        status_json = EXCLUDED.status_json,
        validated = true,
        locked_until = NULL,
        updated_at = NOW()
      `,
      [
        teamKey,
        fechaKey,
        JSON.stringify(validacion || {}),
        JSON.stringify(status || {})
      ]
    );

    const { rows } = await pool.query(
      `
      SELECT team, validacion_json, status_json, validated, locked_until, updated_at
      FROM cruces_validations
      WHERE fecha_key = $1
        AND team IN ($2, $3)
      `,
      [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );

    const mine = rows.find(r => r.team === teamKey) || null;
    const rival = rows.find(r => r.team === rivalKey) || null;

    if (!rival?.validated || !rival?.status_json) {
      return res.json({
        ok: true,
        tipo: 'pendiente',
        mensaje: 'PENDIENTE: tu rival todavía no validó'
      });
    }

    const diff = compareFullStatus(mine?.status_json || {}, rival?.status_json || {});
    if (diff.length) {
      await pool.query(
        `
        UPDATE cruces_validations
        SET locked_until = NULL, updated_at = NOW()
        WHERE fecha_key = $1
          AND team IN ($2, $3)
        `,
        [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
      );

      return res.json({
        ok: false,
        tipo: 'mismatch',
        error: 'Los datos no son correctos, consulte con su rival',
        diff
      });
    }

    const lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await pool.query(
      `
      UPDATE cruces_validations
      SET locked_until = $1::timestamptz, updated_at = NOW()
      WHERE fecha_key = $2
        AND team IN ($3, $4)
      `,
      [lockUntil, fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );

    const mineUpdatedAt = mine?.updated_at ? new Date(mine.updated_at).getTime() : 0;
    const rivalUpdatedAt = rival?.updated_at ? new Date(rival.updated_at).getTime() : 0;
    const validatedSnapshot = mineUpdatedAt >= rivalUpdatedAt
      ? (mine?.status_json || rival?.status_json || {})
      : (rival?.status_json || mine?.status_json || {});

    const fixtureSync = await syncValidatedMatchIntoFixture({
      fechaISO,
      localSlug,
      visitanteSlug,
      snapshot: validatedSnapshot
    });

    const llavesSync = await syncValidatedMatchIntoLlaves({
      fechaISO,
      localSlug,
      visitanteSlug,
      snapshot: validatedSnapshot
    });

    return res.json({
      ok: true,
      tipo: 'validado',
      mensaje: 'Validación exitosa',
      locked: true,
      validated: true,
      lockedUntil: lockUntil,
      fixtureSync,
      llavesSync
    });
  } catch (err) {
    console.error('POST /validate', err);
    return res.status(500).json({ ok: false, error: 'No se pudo validar el cruce' });
  }
});

router.get('/lock-status', async (req, res) => {
  setNoCache(res);
  try {
    const fechaISO = String(req.query.fechaISO || '').trim();
    const equipoSlug = normalizeSlug(req.query.equipoSlug || '');
    const localSlug = String(req.query.localSlug || '').trim();
    const visitanteSlug = String(req.query.visitanteSlug || '').trim();

    if (!fechaISO || !equipoSlug || !localSlug || !visitanteSlug) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    }

    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) {
      return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
    }

    const rivalKey = teamKey === normalizeSlug(localSlug)
      ? normalizeSlug(visitanteSlug)
      : normalizeSlug(localSlug);

    const fechaKey = buildFechaKey(fechaISO, localSlug, visitanteSlug);

    const { rows } = await pool.query(
      `
      SELECT team, validacion_json, status_json, validated, locked_until, updated_at
      FROM cruces_validations
      WHERE fecha_key = $1
        AND team IN ($2, $3)
      `,
      [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );

    const mine = rows.find(r => r.team === teamKey) || null;
    const rival = rows.find(r => r.team === rivalKey) || null;

    if (!mine?.validated) {
      return res.json({ ok: true, tipo: 'pendiente', locked: false, validated: false, lockedUntil: null });
    }

    if (!rival?.validated || !rival?.status_json) {
      return res.json({
        ok: true,
        tipo: 'pendiente',
        locked: false,
        validated: false,
        mensaje: 'PENDIENTE: tu rival todavía no validó'
      });
    }

    const diff = compareFullStatus(mine?.status_json || {}, rival?.status_json || {});
    if (diff.length) {
      return res.json({
        ok: true,
        tipo: 'mismatch',
        locked: false,
        validated: false,
        error: 'Los datos no son correctos, consulte con su rival',
        diff
      });
    }

    const lockedUntil = mine?.locked_until || rival?.locked_until || null;
    const locked = !!(lockedUntil && new Date(lockedUntil).getTime() > Date.now());

    return res.json({
      ok: true,
      tipo: 'validado',
      locked,
      validated: true,
      lockedUntil: lockedUntil || null,
      mensaje: 'Validación exitosa'
    });
  } catch (err) {
    console.error('GET /lock-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo obtener el lock del cruce' });
  }
});


async function findLlavesSeriesForMatch({ fechaISO, localSlug, visitanteSlug }) {
  const dateKey = normalizeDateOnly(fechaISO);
  const { category, localInfo, visitanteInfo } = await inferCategoryFromMatch(localSlug, visitanteSlug);
  if (!category) return { found: false, reason: 'category_not_found' };

  const localCandidates = buildLlavesTeamCandidates(localInfo, localSlug);
  const visitanteCandidates = buildLlavesTeamCandidates(visitanteInfo, visitanteSlug);
  const { rows } = await pool.query(`SELECT data FROM llaves_data WHERE category = $1 LIMIT 1`, [category]);
  const data = rows[0]?.data && typeof rows[0].data === 'object' ? rows[0].data : null;
  const rounds = Array.isArray(data?.rounds) ? data.rounds : [];

  for (const round of rounds) {
    const legs = Array.isArray(round?.legs) ? round.legs : [];
    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      const leg = legs[legIndex];
      if (!leg || normalizeDateOnly(leg?.date) !== dateKey) continue;
      const homeIsLocal = llavesTeamMatches(leg?.home?.team, localCandidates);
      const awayIsVisitante = llavesTeamMatches(leg?.away?.team, visitanteCandidates);
      const homeIsVisitante = llavesTeamMatches(leg?.home?.team, visitanteCandidates);
      const awayIsLocal = llavesTeamMatches(leg?.away?.team, localCandidates);
      if ((homeIsLocal && awayIsVisitante) || (homeIsVisitante && awayIsLocal)) {
        return { found: true, category, data, round, legs, leg, legIndex, localCandidates, visitanteCandidates, localInfo, visitanteInfo };
      }
    }
  }
  return { found: false, reason: 'match_not_found', category, date: dateKey };
}

function computeLlavesSeriesTie(round) {
  const legs = Array.isArray(round?.legs) ? round.legs : [];
  if (legs.length < 2) return { needsTiebreak: false, reason: 'series_incomplete' };
  const ida = legs[0];
  const vuelta = legs[1];
  if (!legHasAnyScore(ida) || !legHasAnyScore(vuelta)) return { needsTiebreak: false, reason: 'legs_not_played' };
  const teams = [ida?.home?.team, ida?.away?.team, vuelta?.home?.team, vuelta?.away?.team].map(v => normalizeLlavesTeamKey(v || '')).filter(Boolean);
  const uniq = [...new Set(teams)];
  if (uniq.length < 2) return { needsTiebreak: false, reason: 'teams_missing' };
  const totals = Object.fromEntries(uniq.slice(0, 2).map(k => [k, { puntos: 0, triangulos: 0 }]));
  [ida, vuelta].forEach(leg => {
    const h = normalizeLlavesTeamKey(leg?.home?.team || '');
    const a = normalizeLlavesTeamKey(leg?.away?.team || '');
    if (totals[h]) { totals[h].puntos += Number(leg?.home?.puntos || 0); totals[h].triangulos += Number(leg?.home?.puntosExtra || 0); }
    if (totals[a]) { totals[a].puntos += Number(leg?.away?.puntos || 0); totals[a].triangulos += Number(leg?.away?.puntosExtra || 0); }
  });
  const values = Object.values(totals);
  const needsTiebreak = values.length === 2 && values[0].puntos === values[1].puntos && values[0].triangulos === values[1].triangulos;
  return { needsTiebreak, totals };
}

function legHasAnyScore(leg) {
  return [leg?.home?.puntos, leg?.away?.puntos, leg?.home?.puntosExtra, leg?.away?.puntosExtra].some(v => Number(v || 0) > 0);
}

async function getTiebreakRows(fechaISO, localSlug, visitanteSlug) {
  const fechaKey = buildTiebreakFechaKey(fechaISO, localSlug, visitanteSlug);
  const { rows } = await pool.query(
    `SELECT team, status_json, validated, locked_until, updated_at
     FROM cruces_validations
     WHERE fecha_key = $1 AND team IN ($2, $3)`,
    [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
  );
  return { fechaKey, rows };
}

router.get('/series-status', async (req, res) => {
  setNoCache(res);
  try {
    const fechaISO = normalizeDateOnly(req.query.fechaISO || '');
    const localSlug = String(req.query.localSlug || '').trim();
    const visitanteSlug = String(req.query.visitanteSlug || '').trim();
    const equipoSlug = normalizeSlug(req.query.equipoSlug || '');
    if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug) return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });

    const found = await findLlavesSeriesForMatch({ fechaISO, localSlug, visitanteSlug });
    if (!found.found) return res.json({ ok: true, needsTiebreak: false, reason: found.reason || 'not_found' });
    const tie = computeLlavesSeriesTie(found.round);
    const { rows } = await getTiebreakRows(fechaISO, localSlug, visitanteSlug);
    const localKey = normalizeSlug(localSlug);
    const visitanteKey = normalizeSlug(visitanteSlug);
    const mine = rows.find(r => r.team === teamKey) || null;
    const localRow = rows.find(r => r.team === localKey) || null;
    const visitanteRow = rows.find(r => r.team === visitanteKey) || null;
    const bothValidated = !!(localRow?.validated && visitanteRow?.validated && localRow?.status_json && visitanteRow?.status_json);
    const diff = bothValidated ? compareTiebreakStatus(localRow.status_json, visitanteRow.status_json) : [];
    const lockedUntil = localRow?.locked_until || visitanteRow?.locked_until || null;
    const locked = !!(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
    const status = bothValidated && !diff.length ? (localRow.status_json || visitanteRow.status_json) : (mine?.status_json || localRow?.status_json || visitanteRow?.status_json || null);
    return res.json({
      ok: true,
      needsTiebreak: !!tie.needsTiebreak,
      totals: tie.totals || null,
      roundId: found.round?.id || null,
      legIndex: found.legIndex,
      tiebreak: {
        validated: bothValidated && !diff.length,
        locked,
        lockedUntil: lockedUntil || null,
        mineValidated: !!mine?.validated,
        localValidated: !!localRow?.validated,
        visitanteValidated: !!visitanteRow?.validated,
        mismatch: !!diff.length,
        diff,
        status
      }
    });
  } catch (err) {
    console.error('GET /series-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo obtener el estado de la serie' });
  }
});

router.get('/tiebreak-lock-status', async (req, res) => {
  setNoCache(res);
  try {
    const fechaISO = normalizeDateOnly(req.query.fechaISO || '');
    const localSlug = String(req.query.localSlug || '').trim();
    const visitanteSlug = String(req.query.visitanteSlug || '').trim();
    const equipoSlug = normalizeSlug(req.query.equipoSlug || '');
    if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug) return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
    const { rows } = await getTiebreakRows(fechaISO, localSlug, visitanteSlug);
    const localRow = rows.find(r => r.team === normalizeSlug(localSlug)) || null;
    const visitanteRow = rows.find(r => r.team === normalizeSlug(visitanteSlug)) || null;
    const bothValidated = !!(localRow?.validated && visitanteRow?.validated && localRow?.status_json && visitanteRow?.status_json);
    const diff = bothValidated ? compareTiebreakStatus(localRow.status_json, visitanteRow.status_json) : [];
    const lockedUntil = localRow?.locked_until || visitanteRow?.locked_until || null;
    const locked = !!(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
    return res.json({ ok: true, tipo: bothValidated && !diff.length ? 'validado' : 'pendiente', locked, validated: bothValidated && !diff.length, lockedUntil: lockedUntil || null });
  } catch (err) {
    console.error('GET /tiebreak-lock-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo obtener el estado del desempate' });
  }
});

router.post('/tiebreak-validate', async (req, res) => {
  try {
    const { fechaISO, localSlug, visitanteSlug, equipoSlug: rawEquipoSlug, status } = req.body || {};
    const equipoSlug = normalizeSlug(rawEquipoSlug || '');
    if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug || !status) return res.status(400).json({ ok: false, error: 'Faltan datos' });
    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
    const cleanStatus = normalizeTiebreakStatus({ ...status, fechaISO, localSlug, visitanteSlug });
    if (!cleanStatus.local.pareja[0] || !cleanStatus.local.pareja[1] || !cleanStatus.visitante.pareja[0] || !cleanStatus.visitante.pareja[1]) {
      return res.status(400).json({ ok: false, error: 'Faltan jugadores en las parejas del desempate' });
    }
    if (!isValidTiebreakScore(cleanStatus.local.puntos, cleanStatus.visitante.puntos)) {
      return res.status(400).json({ ok: false, error: 'El desempate debe terminar cuando un equipo llega a 5, con el rival entre 0 y 4' });
    }
    const found = await findLlavesSeriesForMatch({ fechaISO, localSlug, visitanteSlug });
    if (!found.found) return res.status(404).json({ ok: false, error: 'No se encontró la serie de llaves para este desempate' });
    const tie = computeLlavesSeriesTie(found.round);
    if (!tie.needsTiebreak) return res.status(400).json({ ok: false, error: 'La serie no requiere desempate' });

    const fechaKey = buildTiebreakFechaKey(fechaISO, localSlug, visitanteSlug);
    await pool.query(
      `INSERT INTO cruces_validations (team, fecha_key, validacion_json, status_json, validated, locked_until, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, true, NULL, NOW())
       ON CONFLICT (team, fecha_key)
       DO UPDATE SET validacion_json = EXCLUDED.validacion_json, status_json = EXCLUDED.status_json, validated = true, locked_until = NULL, updated_at = NOW()`,
      [teamKey, fechaKey, JSON.stringify(cleanStatus), JSON.stringify(cleanStatus)]
    );

    const rivalKey = teamKey === normalizeSlug(localSlug) ? normalizeSlug(visitanteSlug) : normalizeSlug(localSlug);
    const { rows } = await pool.query(
      `SELECT team, status_json, validated, updated_at
       FROM cruces_validations
       WHERE fecha_key = $1 AND team IN ($2, $3)`,
      [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );
    const mine = rows.find(r => r.team === teamKey) || null;
    const rival = rows.find(r => r.team === rivalKey) || null;
    if (!rival?.validated || !rival?.status_json) {
      return res.json({ ok: true, tipo: 'pendiente', mensaje: 'PENDIENTE: tu rival todavía no validó el desempate' });
    }
    const diff = compareTiebreakStatus(mine?.status_json || {}, rival?.status_json || {});
    if (diff.length) return res.json({ ok: false, tipo: 'mismatch', error: 'Los datos del desempate no coinciden con tu rival', diff });

    const lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `UPDATE cruces_validations SET locked_until = $1::timestamptz, updated_at = NOW()
       WHERE fecha_key = $2 AND team IN ($3, $4)`,
      [lockUntil, fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );
    const latest = (new Date(mine.updated_at).getTime() >= new Date(rival.updated_at).getTime()) ? mine.status_json : rival.status_json;
    const llavesSync = await syncTiebreakIntoLlaves({ fechaISO, localSlug, visitanteSlug, snapshot: latest });
    return res.json({ ok: true, tipo: 'validado', mensaje: 'Desempate validado', locked: true, validated: true, lockedUntil: lockUntil, llavesSync });
  } catch (err) {
    console.error('POST /tiebreak-validate', err);
    return res.status(500).json({ ok: false, error: 'No se pudo validar el desempate' });
  }
});


async function resolveEquipoInfoBySlug(slug, categoryHint = '') {
  const slugNorm = normalizeSlug(slug);
  if (!slugNorm) return null;

  const { rows } = await pool.query(
    `
    SELECT slug_uid, slug_base, display_name, division
    FROM equipos
    WHERE LOWER(slug_uid) = $1 OR LOWER(slug_base) = $1
    ORDER BY
      CASE WHEN LOWER(slug_uid) = $1 THEN 0 ELSE 1 END,
      CASE WHEN LOWER(division) = $2 THEN 0 ELSE 1 END,
      id ASC
    LIMIT 1
    `,
    [slugNorm, String(categoryHint || '').trim().toLowerCase()]
  );

  return rows[0] || null;
}


function buildTeamMatchCandidates(teamInfo = null, fallbackSlug = '') {
  const values = [
    teamInfo?.display_name,
    teamInfo?.slug_base,
    teamInfo?.slug_uid,
    fallbackSlug
  ];

  return [...new Set(
    values
      .map((value) => normalizeText(value || ''))
      .filter(Boolean)
  )];
}

function fixtureTeamMatches(item = {}, candidates = []) {
  const equipo = normalizeText(item?.equipo || '');
  return !!equipo && candidates.includes(equipo);
}

async function inferCategoryFromMatch(localSlug, visitanteSlug) {
  const [localInfo, visitanteInfo] = await Promise.all([
    resolveEquipoInfoBySlug(localSlug),
    resolveEquipoInfoBySlug(visitanteSlug)
  ]);

  const localDivision = String(localInfo?.division || '').trim().toLowerCase();
  const visitanteDivision = String(visitanteInfo?.division || '').trim().toLowerCase();
  const category = localDivision || visitanteDivision || null;

  return { category, localInfo, visitanteInfo };
}

async function syncValidatedMatchIntoFixture({
  fechaISO,
  localSlug,
  visitanteSlug,
  snapshot
}) {
  const dateKey = normalizeDateOnly(fechaISO);
  if (!dateKey || !snapshot) {
    return { updated: false, reason: 'missing_data' };
  }

  const { category, localInfo, visitanteInfo } = await inferCategoryFromMatch(localSlug, visitanteSlug);
  if (!category) {
    return { updated: false, reason: 'category_not_found' };
  }

  const localCandidates = buildTeamMatchCandidates(localInfo, localSlug);
  const visitanteCandidates = buildTeamMatchCandidates(visitanteInfo, visitanteSlug);

  const localPuntos = Number(snapshot?.local?.puntosTotales ?? 0);
  const localExtra = Number(snapshot?.local?.triangulosTotales ?? snapshot?.local?.triangulos ?? 0);
  const visitantePuntos = Number(snapshot?.visitante?.puntosTotales ?? 0);
  const visitanteExtra = Number(snapshot?.visitante?.triangulosTotales ?? snapshot?.visitante?.triangulos ?? 0);

  const { rows } = await pool.query(
    `
    SELECT id, kind, category, data
    FROM fixtures
    WHERE category = $1
    ORDER BY
      CASE kind WHEN 'ida' THEN 0 WHEN 'vuelta' THEN 1 ELSE 9 END,
      updated_at DESC,
      id DESC
    `,
    [category]
  );

  for (const row of rows) {
    const data = row?.data && typeof row.data === 'object' ? row.data : {};
    const fechas = Array.isArray(data?.fechas) ? data.fechas : [];
    let touched = false;
    let updatedGroup = null;

    for (const fecha of fechas) {
      if (normalizeDateOnly(fecha?.date) !== dateKey) continue;

      const tablas = Array.isArray(fecha?.tablas) ? fecha.tablas : [];
      for (const tabla of tablas) {
        const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];
        for (let i = 0; i < equipos.length - 1; i++) {
          const localItem = equipos[i];
          const visitanteItem = equipos[i + 1];
          const localCategoria = String(localItem?.categoria || '').trim().toLowerCase();
          const visitanteCategoria = String(visitanteItem?.categoria || '').trim().toLowerCase();

          if (localCategoria !== 'local' || visitanteCategoria !== 'visitante') continue;
          if (!fixtureTeamMatches(localItem, localCandidates)) continue;
          if (!fixtureTeamMatches(visitanteItem, visitanteCandidates)) continue;

          localItem.puntos = localPuntos;
          localItem.puntosExtra = localExtra;
          visitanteItem.puntos = visitantePuntos;
          visitanteItem.puntosExtra = visitanteExtra;

          touched = true;
          updatedGroup = tabla?.grupo || null;
          break;
        }
        if (touched) break;
      }
      if (touched) break;
    }

    if (touched) {
      await pool.query(
        `
        UPDATE fixtures
        SET data = $1::jsonb,
            updated_at = NOW()
        WHERE id = $2
        `,
        [JSON.stringify(data), row.id]
      );

      return {
        updated: true,
        fixtureId: row.id,
        kind: row.kind,
        category,
        group: updatedGroup,
        date: dateKey
      };
    }
  }

  return { updated: false, reason: 'match_not_found', category, date: dateKey };
}


function normalizeLlavesTeamKey(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' Y ')
    .replace(/\b(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)\b/gi, ' ')
    .replace(/[^A-Z0-9]/gi, '')
    .replace(/(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)$/i, '')
    .toUpperCase();
}

function buildLlavesTeamCandidates(teamInfo = null, fallbackSlug = '') {
  const values = [
    teamInfo?.display_name,
    teamInfo?.slug_base,
    teamInfo?.slug_uid,
    fallbackSlug
  ];

  return [...new Set(
    values
      .map((value) => normalizeLlavesTeamKey(value || ''))
      .filter(Boolean)
  )];
}

function llavesTeamMatches(teamName, candidates = []) {
  const key = normalizeLlavesTeamKey(teamName || '');
  return !!key && candidates.includes(key);
}


function llavesAutoCleanTeamName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function llavesAutoIsRealTeam(value) {
  const team = llavesAutoCleanTeamName(value);
  return !!team && normalizeLlavesTeamKey(team) !== 'WO';
}

function llavesAutoGetRound(data, id) {
  return (data?.rounds || []).find(round => round?.id === id);
}

function llavesAutoSetLegTeams(round, legIndex, homeTeam, awayTeam) {
  if (!round || !Array.isArray(round.legs) || !round.legs[legIndex]) return;
  round.legs[legIndex].home = round.legs[legIndex].home || {};
  round.legs[legIndex].away = round.legs[legIndex].away || {};
  round.legs[legIndex].home.team = llavesAutoCleanTeamName(homeTeam) || 'WO';
  round.legs[legIndex].away.team = llavesAutoCleanTeamName(awayTeam) || 'WO';
}

function llavesAutoSingleWinner(round) {
  const leg = round?.legs?.[0];
  if (!leg || !llavesAutoIsRealTeam(leg.home?.team) || !llavesAutoIsRealTeam(leg.away?.team) || !legHasAnyScore(leg)) {
    return { winner: 'WO', loser: 'WO', decided: false };
  }

  const hp = Number(leg.home?.puntos || 0);
  const ap = Number(leg.away?.puntos || 0);
  const ht = Number(leg.home?.puntosExtra || 0);
  const at = Number(leg.away?.puntosExtra || 0);

  if (hp > ap) return { winner: leg.home.team, loser: leg.away.team, decided: true };
  if (ap > hp) return { winner: leg.away.team, loser: leg.home.team, decided: true };
  if (ht > at) return { winner: leg.home.team, loser: leg.away.team, decided: true };
  if (at > ht) return { winner: leg.away.team, loser: leg.home.team, decided: true };

  return { winner: 'WO', loser: 'WO', decided: false };
}

function llavesAutoSeriesWinner(round) {
  if (!round || !Array.isArray(round.legs) || !round.legs.length) {
    return { winner: 'WO', loser: 'WO', decided: false, needsExtra: false };
  }

  if (round.legs.length === 1) return llavesAutoSingleWinner(round);

  const ida = round.legs[0];
  const vuelta = round.legs[1];

  if (!ida || !vuelta || !legHasAnyScore(ida) || !legHasAnyScore(vuelta)) {
    return { winner: 'WO', loser: 'WO', decided: false, needsExtra: false };
  }

  const firstTeam = llavesAutoCleanTeamName(vuelta.home?.team || ida.away?.team);
  const secondTeam = llavesAutoCleanTeamName(ida.home?.team || vuelta.away?.team);

  if (!llavesAutoIsRealTeam(firstTeam) || !llavesAutoIsRealTeam(secondTeam)) {
    return { winner: 'WO', loser: 'WO', decided: false, needsExtra: false };
  }

  const acc = {};
  [firstTeam, secondTeam].forEach(team => {
    acc[normalizeLlavesTeamKey(team)] = { team, pts: 0, tri: 0 };
  });

  [ida, vuelta].forEach(leg => {
    const hKey = normalizeLlavesTeamKey(leg.home?.team);
    const aKey = normalizeLlavesTeamKey(leg.away?.team);
    if (acc[hKey]) {
      acc[hKey].pts += Number(leg.home?.puntos || 0);
      acc[hKey].tri += Number(leg.home?.puntosExtra || 0);
    }
    if (acc[aKey]) {
      acc[aKey].pts += Number(leg.away?.puntos || 0);
      acc[aKey].tri += Number(leg.away?.puntosExtra || 0);
    }
  });

  const a = acc[normalizeLlavesTeamKey(firstTeam)];
  const b = acc[normalizeLlavesTeamKey(secondTeam)];

  if (a.pts > b.pts) return { winner: a.team, loser: b.team, decided: true, needsExtra: false };
  if (b.pts > a.pts) return { winner: b.team, loser: a.team, decided: true, needsExtra: false };
  if (a.tri > b.tri) return { winner: a.team, loser: b.team, decided: true, needsExtra: false };
  if (b.tri > a.tri) return { winner: b.team, loser: a.team, decided: true, needsExtra: false };

  const extra = round.legs[2];
  if (extra && legHasAnyScore(extra)) {
    const hp = Number(extra.home?.puntos || 0);
    const ap = Number(extra.away?.puntos || 0);
    const ht = Number(extra.home?.puntosExtra || 0);
    const at = Number(extra.away?.puntosExtra || 0);
    if (hp > ap) return { winner: extra.home.team, loser: extra.away.team, decided: true, needsExtra: false };
    if (ap > hp) return { winner: extra.away.team, loser: extra.home.team, decided: true, needsExtra: false };
    if (ht > at) return { winner: extra.home.team, loser: extra.away.team, decided: true, needsExtra: false };
    if (at > ht) return { winner: extra.away.team, loser: extra.home.team, decided: true, needsExtra: false };
  }

  return { winner: 'WO', loser: 'WO', decided: false, needsExtra: true };
}

function llavesAutoSetSeriesTeams(round, teamA, teamB) {
  if (!round || !Array.isArray(round.legs)) return;

  if (round.legs.length === 1) {
    llavesAutoSetLegTeams(round, 0, teamA, teamB);
    return;
  }

  // El mejor posicionado (teamA) arranca visitante y define la vuelta de local.
  llavesAutoSetLegTeams(round, 0, teamB, teamA);
  llavesAutoSetLegTeams(round, 1, teamA, teamB);

  if (round.legs[2]) {
    llavesAutoSetLegTeams(round, 2, teamA, teamB);
  }
}

function llavesAutoParseScore(value) {
  const n = parseInt(value ?? 0, 10);
  return Number.isFinite(n) ? n : 0;
}

async function llavesAutoFetchFixtureData(kind, category) {
  try {
    const result = await pool.query(
      `SELECT data FROM fixtures WHERE kind = $1 AND category = $2 ORDER BY id DESC LIMIT 1`,
      [kind, category]
    );
    return result.rows[0]?.data || null;
  } catch (err) {
    console.warn('No se pudo cargar fixture para sincronizar llaves', { kind, category, err: err?.message });
    return null;
  }
}

function llavesAutoCollectFixtureEntries(ida, vuelta) {
  const entries = [];
  [
    { kind: 'ida', data: ida },
    { kind: 'vuelta', data: vuelta }
  ].forEach(feed => {
    (feed.data?.fechas || []).forEach((fecha, idx) => {
      entries.push({ kind: feed.kind, fechaIndex: idx + 1, fecha });
    });
  });
  return entries;
}

function llavesAutoIterateGroupMatches(entries, callback) {
  (entries || []).forEach(entry => {
    (entry.fecha?.tablas || []).forEach(tabla => {
      const group = String(tabla?.grupo || '').toUpperCase();
      const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];

      for (let i = 0; i < equipos.length; i += 2) {
        const home = equipos[i];
        const away = equipos[i + 1];
        if (!home || !away) continue;

        const homeName = llavesAutoCleanTeamName(home.equipo);
        const awayName = llavesAutoCleanTeamName(away.equipo);
        if (!homeName || !awayName) continue;
        if (normalizeLlavesTeamKey(homeName) === 'WO' || normalizeLlavesTeamKey(awayName) === 'WO') continue;

        callback({
          group,
          home: {
            team: homeName,
            key: normalizeLlavesTeamKey(homeName),
            puntos: llavesAutoParseScore(home.puntos),
            puntosExtra: llavesAutoParseScore(home.puntosExtra)
          },
          away: {
            team: awayName,
            key: normalizeLlavesTeamKey(awayName),
            puntos: llavesAutoParseScore(away.puntos),
            puntosExtra: llavesAutoParseScore(away.puntosExtra)
          }
        });
      }
    });
  });
}

function llavesAutoComputeHeadToHead(group, tiedKeys, entries) {
  const tied = new Set(tiedKeys);
  const table = Object.create(null);

  tiedKeys.forEach(key => {
    table[key] = { pts: 0, tr: 0 };
  });

  llavesAutoIterateGroupMatches(entries, match => {
    if (match.group !== group) return;
    if (!tied.has(match.home.key) || !tied.has(match.away.key)) return;

    table[match.home.key].pts += match.home.puntos;
    table[match.home.key].tr += match.home.puntosExtra;
    table[match.away.key].pts += match.away.puntos;
    table[match.away.key].tr += match.away.puntosExtra;
  });

  return table;
}

function llavesAutoGetGroupsForCategory(category) {
  return category === 'segunda' ? ['A', 'B'] : ['A', 'B', 'C', 'D'];
}

function llavesAutoComputeStandings(category, ida, vuelta) {
  const groups = llavesAutoGetGroupsForCategory(category);
  const entries = llavesAutoCollectFixtureEntries(ida, vuelta);
  const stats = Object.fromEntries(groups.map(g => [g, Object.create(null)]));

  llavesAutoIterateGroupMatches(entries, match => {
    if (!groups.includes(match.group)) return;

    [match.home, match.away].forEach(team => {
      if (!stats[match.group][team.key]) {
        stats[match.group][team.key] = {
          key: team.key,
          equipo: team.team,
          pts: 0,
          tr: 0,
          ju: 0
        };
      }
    });

    const played = (
      match.home.puntos > 0 ||
      match.away.puntos > 0 ||
      match.home.puntosExtra > 0 ||
      match.away.puntosExtra > 0
    );

    stats[match.group][match.home.key].pts += match.home.puntos;
    stats[match.group][match.home.key].tr += match.home.puntosExtra;
    stats[match.group][match.away.key].pts += match.away.puntos;
    stats[match.group][match.away.key].tr += match.away.puntosExtra;

    if (played) {
      stats[match.group][match.home.key].ju += 1;
      stats[match.group][match.away.key].ju += 1;
    }
  });

  const result = {};

  groups.forEach(group => {
    const rows = Object.values(stats[group]);
    const buckets = new Map();

    rows.forEach(row => {
      const bucketKey = `${row.pts}|${row.tr}`;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey).push(row);
    });

    const bucketKeys = Array.from(buckets.keys()).sort((a, b) => {
      const [ap, at] = a.split('|').map(Number);
      const [bp, bt] = b.split('|').map(Number);
      return (bp - ap) || (bt - at);
    });

    const ordered = [];

    bucketKeys.forEach(bucketKey => {
      const bucket = buckets.get(bucketKey);
      if (bucket.length <= 1) {
        ordered.push(...bucket);
        return;
      }

      const tiedKeys = bucket.map(row => row.key);
      const h2h = llavesAutoComputeHeadToHead(group, tiedKeys, entries);

      bucket.sort((a, b) => {
        const hA = h2h[a.key] || { pts: 0, tr: 0 };
        const hB = h2h[b.key] || { pts: 0, tr: 0 };
        return (hB.pts - hA.pts) ||
               (hB.tr - hA.tr) ||
               String(a.equipo).localeCompare(String(b.equipo), 'es', { sensitivity: 'base' });
      });

      ordered.push(...bucket);
    });

    result[group] = ordered.map((row, idx) => ({
      ...row,
      pos: idx + 1
    }));
  });

  return result;
}

function llavesAutoFlattenStandings(standings) {
  const flat = {};
  Object.values(standings || {}).forEach(rows => {
    (rows || []).forEach(row => {
      const key = normalizeLlavesTeamKey(row?.equipo || row?.team || '');
      if (!key) return;
      flat[key] = {
        equipo: row.equipo || row.team || '',
        pts: Number(row.pts || 0),
        tr: Number(row.tr || 0),
        pos: Number(row.pos || 0)
      };
    });
  });
  return flat;
}

function llavesAutoCollectQuarterStats(data) {
  const stats = {};
  ['q1', 'q2', 'q3', 'q4'].forEach(roundId => {
    const round = llavesAutoGetRound(data, roundId);
    const legs = Array.isArray(round?.legs) ? round.legs.slice(0, 2) : [];
    legs.forEach(leg => {
      [
        { team: leg?.home?.team, pts: leg?.home?.puntos, tr: leg?.home?.puntosExtra },
        { team: leg?.away?.team, pts: leg?.away?.puntos, tr: leg?.away?.puntosExtra }
      ].forEach(item => {
        const key = normalizeLlavesTeamKey(item.team || '');
        if (!key || key === 'WO') return;
        if (!stats[key]) stats[key] = { pts: 0, tr: 0 };
        stats[key].pts += Number(item.pts || 0);
        stats[key].tr += Number(item.tr || 0);
      });
    });
  });
  return stats;
}

function llavesAutoStableTieSeed(value) {
  const text = normalizeLlavesTeamKey(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function llavesAutoCompareSportingAdvantage(teamA, teamB, data, standings) {
  const a = llavesAutoCleanTeamName(teamA) || 'WO';
  const b = llavesAutoCleanTeamName(teamB) || 'WO';
  if (!llavesAutoIsRealTeam(a) || !llavesAutoIsRealTeam(b)) return [a, b];

  const aKey = normalizeLlavesTeamKey(a);
  const bKey = normalizeLlavesTeamKey(b);
  const standingStats = llavesAutoFlattenStandings(standings || {});
  const quarterStats = llavesAutoCollectQuarterStats(data);
  const sA = standingStats[aKey] || { pts: 0, tr: 0 };
  const sB = standingStats[bKey] || { pts: 0, tr: 0 };
  const qA = quarterStats[aKey] || { pts: 0, tr: 0 };
  const qB = quarterStats[bKey] || { pts: 0, tr: 0 };

  const checks = [
    [Number(sA.pts || 0), Number(sB.pts || 0)],
    [Number(sA.tr || 0), Number(sB.tr || 0)],
    [Number(qA.pts || 0), Number(qB.pts || 0)],
    [Number(qA.tr || 0), Number(qB.tr || 0)]
  ];

  for (const [va, vb] of checks) {
    if (va > vb) return [a, b];
    if (vb > va) return [b, a];
  }

  return llavesAutoStableTieSeed(a) <= llavesAutoStableTieSeed(b) ? [a, b] : [b, a];
}

function llavesAutoApplyAutomaticAdvance(data, category, standings) {
  if (!data || !Array.isArray(data.rounds)) return data;

  if (category === 'tercera') {
    const q1 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 'q1'));
    const q2 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 'q2'));
    const q3 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 'q3'));
    const q4 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 'q4'));

    const [s1Best, s1Other] = llavesAutoCompareSportingAdvantage(q1.winner, q2.winner, data, standings);
    const [s2Best, s2Other] = llavesAutoCompareSportingAdvantage(q3.winner, q4.winner, data, standings);

    llavesAutoSetSeriesTeams(llavesAutoGetRound(data, 's1'), s1Best, s1Other);
    llavesAutoSetSeriesTeams(llavesAutoGetRound(data, 's2'), s2Best, s2Other);
  }

  const s1 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 's1'));
  const s2 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 's2'));

  llavesAutoSetSeriesTeams(llavesAutoGetRound(data, 'final'), s1.winner, s2.winner);
  llavesAutoSetSeriesTeams(llavesAutoGetRound(data, 'third'), s1.loser, s2.loser);

  return data;
}

async function buildLlavesAutoData(data, category) {
  const autoData = JSON.parse(JSON.stringify(data || {}));
  if (!autoData || !Array.isArray(autoData.rounds)) return null;

  const [ida, vuelta] = await Promise.all([
    llavesAutoFetchFixtureData('ida', category),
    llavesAutoFetchFixtureData('vuelta', category)
  ]);
  const standings = llavesAutoComputeStandings(category, ida, vuelta);
  return llavesAutoApplyAutomaticAdvance(autoData, category, standings);
}

function findLlavesLegInData(data, { dateKey, localCandidates, visitanteCandidates }) {
  const rounds = Array.isArray(data?.rounds) ? data.rounds : [];

  for (const round of rounds) {
    const legs = Array.isArray(round?.legs) ? round.legs : [];

    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      const leg = legs[legIndex];
      if (!leg || normalizeDateOnly(leg?.date) !== dateKey) continue;

      const homeIsLocal = llavesTeamMatches(leg?.home?.team, localCandidates);
      const awayIsVisitante = llavesTeamMatches(leg?.away?.team, visitanteCandidates);
      const homeIsVisitante = llavesTeamMatches(leg?.home?.team, visitanteCandidates);
      const awayIsLocal = llavesTeamMatches(leg?.away?.team, localCandidates);

      if (homeIsLocal && awayIsVisitante) {
        return { found: true, roundId: round?.id || null, legIndex, leg, orientation: 'direct' };
      }

      if (homeIsVisitante && awayIsLocal) {
        return { found: true, roundId: round?.id || null, legIndex, leg, orientation: 'swapped' };
      }
    }
  }

  return { found: false };
}

function findLlavesRoundById(data, roundId) {
  return (data?.rounds || []).find(round => round?.id === roundId) || null;
}

async function syncValidatedMatchIntoLlaves({
  fechaISO,
  localSlug,
  visitanteSlug,
  snapshot
}) {
  const dateKey = normalizeDateOnly(fechaISO);
  if (!dateKey || !snapshot) {
    return { updated: false, reason: 'missing_data' };
  }

  const { category, localInfo, visitanteInfo } = await inferCategoryFromMatch(localSlug, visitanteSlug);
  if (!category) {
    return { updated: false, reason: 'category_not_found' };
  }

  const localCandidates = buildLlavesTeamCandidates(localInfo, localSlug);
  const visitanteCandidates = buildLlavesTeamCandidates(visitanteInfo, visitanteSlug);

  const localPuntos = Number(snapshot?.local?.puntosTotales ?? 0);
  const localExtra = Number(snapshot?.local?.triangulosTotales ?? snapshot?.local?.triangulos ?? 0);
  const visitantePuntos = Number(snapshot?.visitante?.puntosTotales ?? 0);
  const visitanteExtra = Number(snapshot?.visitante?.triangulosTotales ?? snapshot?.visitante?.triangulos ?? 0);

  const { rows } = await pool.query(
    `SELECT data FROM llaves_data WHERE category = $1 LIMIT 1`,
    [category]
  );

  const data = rows[0]?.data && typeof rows[0].data === 'object'
    ? rows[0].data
    : null;

  const rounds = Array.isArray(data?.rounds) ? data.rounds : [];
  if (!rounds.length) {
    return { updated: false, reason: 'llaves_missing', category, date: dateKey };
  }

  const localDisplayName = localInfo?.display_name || localInfo?.slug_base || localSlug;
  const visitanteDisplayName = visitanteInfo?.display_name || visitanteInfo?.slug_base || visitanteSlug;

  const persistLlavesSync = async ({ round, legIndex, mode }) => {
    await pool.query(
      `INSERT INTO llaves_data (category, data, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())
       ON CONFLICT (category)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [category, JSON.stringify(data)]
    );

    return {
      updated: true,
      category,
      roundId: round?.id || null,
      legIndex,
      date: dateKey,
      mode
    };
  };

  const applyLlavesScore = (leg, orientation) => {
    if (!leg.home) leg.home = { team: 'WO', puntos: 0, puntosExtra: 0 };
    if (!leg.away) leg.away = { team: 'WO', puntos: 0, puntosExtra: 0 };

    if (orientation === 'direct') {
      leg.home.puntos = localPuntos;
      leg.home.puntosExtra = localExtra;
      leg.away.puntos = visitantePuntos;
      leg.away.puntosExtra = visitanteExtra;
      return;
    }

    leg.home.puntos = visitantePuntos;
    leg.home.puntosExtra = visitanteExtra;
    leg.away.puntos = localPuntos;
    leg.away.puntosExtra = localExtra;
  };

  // 1) Camino normal: la llave guardada ya tiene ambos equipos reales.
  for (const round of rounds) {
    const legs = Array.isArray(round?.legs) ? round.legs : [];

    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      const leg = legs[legIndex];
      if (!leg || normalizeDateOnly(leg?.date) !== dateKey) continue;

      const homeIsLocal = llavesTeamMatches(leg?.home?.team, localCandidates);
      const awayIsVisitante = llavesTeamMatches(leg?.away?.team, visitanteCandidates);
      const homeIsVisitante = llavesTeamMatches(leg?.home?.team, visitanteCandidates);
      const awayIsLocal = llavesTeamMatches(leg?.away?.team, localCandidates);

      if (homeIsLocal && awayIsVisitante) {
        applyLlavesScore(leg, 'direct');
        return persistLlavesSync({ round, legIndex, mode: 'exact' });
      }

      if (homeIsVisitante && awayIsLocal) {
        applyLlavesScore(leg, 'swapped');
        return persistLlavesSync({ round, legIndex, mode: 'exact_swapped' });
      }
    }
  }

  // 2) Camino correcto para fases que el frontend arma dinámicamente.
  // Recalculamos una copia en memoria con la misma lógica de /api/llaves/proximo-cruce,
  // buscamos allí el cruce exacto por equipos, y recién entonces escribimos en el round/leg
  // equivalente de la DB. Esto evita meter un resultado en el primer hueco de la fecha.
  const autoData = await buildLlavesAutoData(data, category);
  const autoFound = findLlavesLegInData(autoData, { dateKey, localCandidates, visitanteCandidates });

  if (autoFound.found && autoFound.roundId) {
    const round = findLlavesRoundById(data, autoFound.roundId);
    const legs = Array.isArray(round?.legs) ? round.legs : [];
    const leg = legs[autoFound.legIndex];

    if (round && leg) {
      if (!leg.home) leg.home = { team: 'WO', puntos: 0, puntosExtra: 0 };
      if (!leg.away) leg.away = { team: 'WO', puntos: 0, puntosExtra: 0 };

      // Copiamos el orden de equipos calculado en memoria para mantener la llave igual
      // a lo que ve el frontend, pero no reconstruimos toda la llave.
      leg.home.team = autoFound.leg?.home?.team || leg.home.team || 'WO';
      leg.away.team = autoFound.leg?.away?.team || leg.away.team || 'WO';
      applyLlavesScore(leg, autoFound.orientation || 'direct');
      return persistLlavesSync({ round, legIndex: autoFound.legIndex, mode: 'auto_exact' });
    }
  }

  // 3) Fallback final y seguro: solo por fecha si existe un único candidato posible.
  // Si hay dos semifinales en la misma fecha, no se sincroniza por fecha para no cruzar resultados.
  const fallbackCandidates = [];

  for (const round of rounds) {
    const legs = Array.isArray(round?.legs) ? round.legs : [];

    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      const leg = legs[legIndex];
      if (!leg || normalizeDateOnly(leg?.date) !== dateKey) continue;
      if (legIndex >= 2) continue;
      if (legHasAnyScore(leg)) continue;

      const homeKey = normalizeLlavesTeamKey(leg?.home?.team || '');
      const awayKey = normalizeLlavesTeamKey(leg?.away?.team || '');
      const homeIsReal = !!homeKey && homeKey !== 'WO';
      const awayIsReal = !!awayKey && awayKey !== 'WO';

      // No pisar un partido real distinto.
      if (homeIsReal && awayIsReal) continue;

      const homeIsLocal = llavesTeamMatches(leg?.home?.team, localCandidates);
      const awayIsVisitante = llavesTeamMatches(leg?.away?.team, visitanteCandidates);
      const homeIsVisitante = llavesTeamMatches(leg?.home?.team, visitanteCandidates);
      const awayIsLocal = llavesTeamMatches(leg?.away?.team, localCandidates);

      let orientation = null;
      if (homeIsLocal || awayIsVisitante) orientation = 'direct';
      if (homeIsVisitante || awayIsLocal) orientation = 'swapped';
      if (!homeIsReal && !awayIsReal) orientation = 'direct';

      if (orientation) {
        fallbackCandidates.push({ round, legIndex, leg, orientation });
      }
    }
  }

  if (fallbackCandidates.length === 1) {
    const candidate = fallbackCandidates[0];
    const { round, legIndex, leg, orientation } = candidate;

    if (!leg.home) leg.home = { team: 'WO', puntos: 0, puntosExtra: 0 };
    if (!leg.away) leg.away = { team: 'WO', puntos: 0, puntosExtra: 0 };

    if (orientation === 'swapped') {
      leg.home.team = visitanteDisplayName;
      leg.away.team = localDisplayName;
      applyLlavesScore(leg, 'swapped');
      return persistLlavesSync({ round, legIndex, mode: 'single_date_fallback_swapped' });
    }

    leg.home.team = localDisplayName;
    leg.away.team = visitanteDisplayName;
    applyLlavesScore(leg, 'direct');
    return persistLlavesSync({ round, legIndex, mode: 'single_date_fallback' });
  }

  if (fallbackCandidates.length > 1) {
    return {
      updated: false,
      reason: 'ambiguous_date_fallback',
      category,
      date: dateKey,
      candidates: fallbackCandidates.map(item => ({
        roundId: item.round?.id || null,
        legIndex: item.legIndex
      }))
    };
  }

  return { updated: false, reason: 'match_not_found', category, date: dateKey };
}


async function syncTiebreakIntoLlaves({ fechaISO, localSlug, visitanteSlug, snapshot }) {
  const dateKey = normalizeDateOnly(fechaISO);
  if (!dateKey || !snapshot) return { updated: false, reason: 'missing_data' };
  const found = await findLlavesSeriesForMatch({ fechaISO, localSlug, visitanteSlug });
  if (!found.found) return { updated: false, reason: found.reason || 'match_not_found' };

  const round = found.round;
  const legs = Array.isArray(round.legs) ? round.legs : (round.legs = []);
  while (legs.length < 3) {
    legs.push({ date: dateKey, home: { team: 'WO', puntos: 0, puntosExtra: 0 }, away: { team: 'WO', puntos: 0, puntosExtra: 0 } });
  }

  const extra = legs[2];
  extra.date = extra.date || dateKey;
  const localPts = Number(snapshot?.local?.puntos || 0);
  const visitantePts = Number(snapshot?.visitante?.puntos || 0);
  const localPair = Array.isArray(snapshot?.local?.pareja) ? snapshot.local.pareja : [];
  const visitantePair = Array.isArray(snapshot?.visitante?.pareja) ? snapshot.visitante.pareja : [];

  const homeIsLocal = llavesTeamMatches(extra?.home?.team, found.localCandidates);
  const awayIsVisitante = llavesTeamMatches(extra?.away?.team, found.visitanteCandidates);
  const homeIsVisitante = llavesTeamMatches(extra?.home?.team, found.visitanteCandidates);
  const awayIsLocal = llavesTeamMatches(extra?.away?.team, found.localCandidates);

  if (!(homeIsLocal && awayIsVisitante) && !(homeIsVisitante && awayIsLocal)) {
    // Regla visual de LIPA para desempate: se toma el orden de la vuelta si existe.
    extra.home.team = found.legs?.[1]?.home?.team || found.leg?.home?.team || localSlug;
    extra.away.team = found.legs?.[1]?.away?.team || found.leg?.away?.team || visitanteSlug;
  }

  if (llavesTeamMatches(extra.home.team, found.localCandidates)) {
    extra.home.puntos = localPts;
    extra.home.puntosExtra = 0;
    extra.home.pareja = localPair;
    extra.away.puntos = visitantePts;
    extra.away.puntosExtra = 0;
    extra.away.pareja = visitantePair;
  } else {
    extra.home.puntos = visitantePts;
    extra.home.puntosExtra = 0;
    extra.home.pareja = visitantePair;
    extra.away.puntos = localPts;
    extra.away.puntosExtra = 0;
    extra.away.pareja = localPair;
  }

  await pool.query(
    `INSERT INTO llaves_data (category, data, created_at, updated_at)
     VALUES ($1, $2::jsonb, NOW(), NOW())
     ON CONFLICT (category)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [found.category, JSON.stringify(found.data)]
  );

  return { updated: true, category: found.category, roundId: round?.id || null, legIndex: 2, date: dateKey };
}

router.get('/results', async (req, res) => {
  setNoCache(res);
  try {
    const fechaISO = normalizeDateOnly(req.query.fechaISO || req.query.date || '');
    const category = String(req.query.category || '').trim().toLowerCase();

    if (!fechaISO) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro fechaISO.' });
    }

    const { rows } = await pool.query(
      `
      SELECT fecha_key, team, status_json, validated, updated_at
      FROM cruces_validations
      WHERE split_part(fecha_key, '::', 1) = $1
      ORDER BY updated_at DESC
      `,
      [fechaISO]
    );

    const grouped = new Map();
    for (const row of rows) {
      const key = String(row.fecha_key || '');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }

    const teamCache = new Map();
    const resolveCached = async (slug) => {
      const key = `${String(category || '').toLowerCase()}::${normalizeSlug(slug)}`;
      if (teamCache.has(key)) return teamCache.get(key);
      const info = await resolveEquipoInfoBySlug(slug, category);
      teamCache.set(key, info);
      return info;
    };

    const results = [];

    for (const [fechaKey, entries] of grouped.entries()) {
      const parts = String(fechaKey).split('::');
      const matchDate = parts[0] || fechaISO;
      const localSlug = normalizeSlug(parts[1] || '');
      const visitanteSlug = normalizeSlug(parts[2] || '');
      const isTiebreakResult = String(parts[3] || '').trim().toLowerCase() === 'desempate';

      if (!localSlug || !visitanteSlug) continue;

      const localEntry = entries.find((row) => normalizeSlug(row.team) === localSlug) || null;
      const visitanteEntry = entries.find((row) => normalizeSlug(row.team) === visitanteSlug) || null;

      if (!localEntry || !visitanteEntry) continue;
      if (!localEntry.validated || !visitanteEntry.validated) continue;

      const diff = isTiebreakResult
        ? compareTiebreakStatus(localEntry.status_json || {}, visitanteEntry.status_json || {})
        : compareFullStatus(localEntry.status_json || {}, visitanteEntry.status_json || {});
      if (diff.length) continue;

      const [localInfo, visitanteInfo] = await Promise.all([
        resolveCached(localSlug),
        resolveCached(visitanteSlug)
      ]);

      if (category) {
        const localDivision = String(localInfo?.division || '').trim().toLowerCase();
        const visitanteDivision = String(visitanteInfo?.division || '').trim().toLowerCase();
        const hasKnownDivision = !!(localDivision || visitanteDivision);

        if (hasKnownDivision && (localDivision !== category || visitanteDivision !== category)) {
          continue;
        }
      }

      const localUpdatedAt = localEntry?.updated_at ? new Date(localEntry.updated_at).getTime() : 0;
      const visitanteUpdatedAt = visitanteEntry?.updated_at ? new Date(visitanteEntry.updated_at).getTime() : 0;
      const snapshot = localUpdatedAt >= visitanteUpdatedAt
        ? (localEntry.status_json || visitanteEntry.status_json || {})
        : (visitanteEntry.status_json || localEntry.status_json || {});

      const localStatus = snapshot?.local || {};
      const visitanteStatus = snapshot?.visitante || {};

      if (isTiebreakResult) {
        const cleanTiebreak = normalizeTiebreakStatus(snapshot || {});
        results.push({
          tipo: 'desempate',
          fechaISO: matchDate,
          category: category || localInfo?.division || visitanteInfo?.division || null,
          localSlug,
          visitanteSlug,
          localName: localInfo?.display_name || localSlug,
          visitanteName: visitanteInfo?.display_name || visitanteSlug,
          local: {
            pareja: Array.isArray(cleanTiebreak.local?.pareja) ? cleanTiebreak.local.pareja : [],
            puntos: Number(cleanTiebreak.local?.puntos || 0)
          },
          visitante: {
            pareja: Array.isArray(cleanTiebreak.visitante?.pareja) ? cleanTiebreak.visitante.pareja : [],
            puntos: Number(cleanTiebreak.visitante?.puntos || 0)
          },
          updatedAt: localEntry?.updated_at || visitanteEntry?.updated_at || null,
          validated: true
        });
        continue;
      }

      results.push({
        tipo: 'cruce',
        fechaISO: matchDate,
        category: category || localInfo?.division || visitanteInfo?.division || null,
        localSlug,
        visitanteSlug,
        localName: localInfo?.display_name || localSlug,
        visitanteName: visitanteInfo?.display_name || visitanteSlug,
        localPlanilla: snapshot?.localPlanilla || null,
        visitantePlanilla: snapshot?.visitantePlanilla || null,
        local: {
          scoreRows: Array.isArray(localStatus?.scoreRows) ? localStatus.scoreRows : [],
          triangulosTotales: Number(localStatus?.triangulosTotales ?? localStatus?.triangulos ?? 0),
          puntosTotales: Number(localStatus?.puntosTotales ?? 0)
        },
        visitante: {
          scoreRows: Array.isArray(visitanteStatus?.scoreRows) ? visitanteStatus.scoreRows : [],
          triangulosTotales: Number(visitanteStatus?.triangulosTotales ?? visitanteStatus?.triangulos ?? 0),
          puntosTotales: Number(visitanteStatus?.puntosTotales ?? 0)
        },
        updatedAt: localEntry?.updated_at || visitanteEntry?.updated_at || null,
        validated: true
      });
    }

    results.sort((a, b) => {
      const byDate = String(a.fechaISO || '').localeCompare(String(b.fechaISO || ''));
      if (byDate !== 0) return byDate;
      const byLocal = String(a.localName || '').localeCompare(String(b.localName || ''));
      if (byLocal !== 0) return byLocal;
      return String(a.visitanteName || '').localeCompare(String(b.visitanteName || ''));
    });

    return res.json({
      ok: true,
      fechaISO,
      category: category || null,
      total: results.length,
      results
    });
  } catch (err) {
    console.error('GET /results', err);
    return res.status(500).json({ ok: false, error: 'No se pudieron obtener los resultados validados.' });
  }
});

function includesNormalizedName(name, query) {
  const a = normalizeText(name || '');
  const q = normalizeText(query || '');
  return !!q && a.includes(q);
}

function sameNormalizedName(a, b) {
  return normalizeText(a || '') === normalizeText(b || '');
}

function canonicalPlayerTeamSlug(value = "") {
  return normalizeSlug(value)
    .replace(/_(primera|segunda|tercera)$/i, "")
    .replace(/-(primera|segunda|tercera)$/i, "");
}

function samePlayerTeamSlug(a, b) {
  const aa = normalizeSlug(a);
  const bb = normalizeSlug(b);
  if (!aa || !bb) return false;
  return aa === bb || canonicalPlayerTeamSlug(aa) === canonicalPlayerTeamSlug(bb) || slugMatchesTeam(aa, bb);
}

function getIndividualPlayers(planilla = {}) {
  return Array.isArray(planilla?.individuales)
    ? planilla.individuales.map((name) => String(name || '').trim())
    : [];
}

function uniquePlayerNames(names = []) {
  const seen = new Set();
  const out = [];
  names.forEach((name) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const key = normalizeText(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function getPairPlayers(planilla = {}, pairIndex = 0) {
  const key = pairIndex === 0 ? 'pareja1' : 'pareja2';
  return Array.isArray(planilla?.[key])
    ? planilla[key].map((name) => String(name || '').trim())
    : [];
}

function getSearchablePlayers(planilla = {}) {
  return uniquePlayerNames([
    ...getIndividualPlayers(planilla),
    ...getPairPlayers(planilla, 0),
    ...getPairPlayers(planilla, 1)
  ]);
}

function getPairScore(scoreRows = [], planilla = {}, pairIndex = 0) {
  const scoreIndex = 7 + pairIndex;
  const fromScoreRows = Array.isArray(scoreRows) ? scoreRows[scoreIndex] : undefined;
  if (fromScoreRows !== undefined && fromScoreRows !== null && fromScoreRows !== '') {
    return Number(fromScoreRows) || 0;
  }

  const ptsKey = pairIndex === 0 ? 'pareja1Pts' : 'pareja2Pts';
  const fromPlanilla = Array.isArray(planilla?.[ptsKey]) ? planilla[ptsKey][0] : undefined;
  return Number(fromPlanilla ?? 0) || 0;
}

async function buildAllValidatedCrucesForPlayerQuery(category = '') {
  const { rows } = await pool.query(
    `
    SELECT fecha_key, team, status_json, validated, updated_at
    FROM cruces_validations
    ORDER BY updated_at DESC
    `
  );

  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.fecha_key || '');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const teamCache = new Map();
  const resolveCached = async (slug) => {
    const key = `${String(category || '').toLowerCase()}::${normalizeSlug(slug)}`;
    if (teamCache.has(key)) return teamCache.get(key);
    const info = await resolveEquipoInfoBySlug(slug, category);
    teamCache.set(key, info);
    return info;
  };

  const results = [];

  for (const [fechaKey, entries] of grouped.entries()) {
    const parts = String(fechaKey).split('::');
    const matchDate = parts[0] || '';
    const localSlug = normalizeSlug(parts[1] || '');
    const visitanteSlug = normalizeSlug(parts[2] || '');

    if (!localSlug || !visitanteSlug) continue;

    const localEntry = entries.find((row) => normalizeSlug(row.team) === localSlug) || null;
    const visitanteEntry = entries.find((row) => normalizeSlug(row.team) === visitanteSlug) || null;

    if (!localEntry || !visitanteEntry) continue;
    if (!localEntry.validated || !visitanteEntry.validated) continue;

    const diff = compareFullStatus(localEntry.status_json || {}, visitanteEntry.status_json || {});
    if (diff.length) continue;

    const [localInfo, visitanteInfo] = await Promise.all([
      resolveCached(localSlug),
      resolveCached(visitanteSlug)
    ]);

    if (category) {
      const localDivision = String(localInfo?.division || '').trim().toLowerCase();
      const visitanteDivision = String(visitanteInfo?.division || '').trim().toLowerCase();
      const hasKnownDivision = !!(localDivision || visitanteDivision);

      if (hasKnownDivision && (localDivision !== category || visitanteDivision !== category)) {
        continue;
      }
    }

    const localUpdatedAt = localEntry?.updated_at ? new Date(localEntry.updated_at).getTime() : 0;
    const visitanteUpdatedAt = visitanteEntry?.updated_at ? new Date(visitanteEntry.updated_at).getTime() : 0;
    const snapshot = localUpdatedAt >= visitanteUpdatedAt
      ? (localEntry.status_json || visitanteEntry.status_json || {})
      : (visitanteEntry.status_json || localEntry.status_json || {});

    const localStatus = snapshot?.local || {};
    const visitanteStatus = snapshot?.visitante || {};

    results.push({
      fechaISO: matchDate,
      category: category || localInfo?.division || visitanteInfo?.division || null,
      localSlug,
      visitanteSlug,
      localName: localInfo?.display_name || localSlug,
      visitanteName: visitanteInfo?.display_name || visitanteSlug,
      localPlanilla: snapshot?.localPlanilla || null,
      visitantePlanilla: snapshot?.visitantePlanilla || null,
      local: {
        scoreRows: Array.isArray(localStatus?.scoreRows) ? localStatus.scoreRows : [],
        triangulosTotales: Number(localStatus?.triangulosTotales ?? localStatus?.triangulos ?? 0),
        puntosTotales: Number(localStatus?.puntosTotales ?? 0)
      },
      visitante: {
        scoreRows: Array.isArray(visitanteStatus?.scoreRows) ? visitanteStatus.scoreRows : [],
        triangulosTotales: Number(visitanteStatus?.triangulosTotales ?? visitanteStatus?.triangulos ?? 0),
        puntosTotales: Number(visitanteStatus?.puntosTotales ?? 0)
      }
    });
  }

  return results;
}

router.get('/player-query', async (req, res) => {
  setNoCache(res);
  try {
    const category = String(req.query.category || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim();

    if (!category) {
      return res.status(400).json({ ok: false, error: 'Seleccioná una categoría.' });
    }

    if (!q || normalizeText(q).length < 2) {
      return res.json({ ok: true, category, q, suggestions: [], player: null, total: 0, pairTotal: 0, matches: [], pairMatches: [] });
    }

    const results = await buildAllValidatedCrucesForPlayerQuery(category);
    const suggestionsMap = new Map();

    for (const item of results) {
      const sides = [
        { teamSlug: item.localSlug, teamName: item.localName, players: getSearchablePlayers(item.localPlanilla) },
        { teamSlug: item.visitanteSlug, teamName: item.visitanteName, players: getSearchablePlayers(item.visitantePlanilla) }
      ];

      for (const side of sides) {
        side.players.forEach((playerName) => {
          if (!playerName || !includesNormalizedName(playerName, q)) return;
          const key = `${normalizeText(playerName)}::${canonicalPlayerTeamSlug(side.teamSlug)}`;
          if (!suggestionsMap.has(key)) {
            suggestionsMap.set(key, {
              name: playerName,
              teamSlug: side.teamSlug,
              teamName: side.teamName,
              label: `${playerName} · ${side.teamName}`
            });
          }
        });
      }
    }

    const suggestions = Array.from(suggestionsMap.values())
      .sort((a, b) => a.label.localeCompare(b.label, 'es'))
      .slice(0, 12);

    const exact = suggestions.find((item) => sameNormalizedName(item.name, q));
    if (!exact) {
      return res.json({ ok: true, category, q, suggestions, player: null, total: 0, pairTotal: 0, matches: [], pairMatches: [] });
    }

    const { ranking: categoryRanking, radContext } = buildRadRankingFromResults(results);
    const playerRadRow = categoryRanking.find((item) =>
      sameNormalizedName(item.name, exact.name) &&
      samePlayerTeamSlug(item.teamSlug, exact.teamSlug)
    ) || null;

    const matches = [];
    const pairMatches = [];

    for (const item of results) {
      const localPlayers = getIndividualPlayers(item.localPlanilla);
      const visitantePlayers = getIndividualPlayers(item.visitantePlanilla);
      const localScores = Array.isArray(item.local?.scoreRows) ? item.local.scoreRows : [];
      const visitanteScores = Array.isArray(item.visitante?.scoreRows) ? item.visitante.scoreRows : [];

      const scan = [
        {
          players: localPlayers,
          scoreRows: localScores,
          opponentScoreRows: visitanteScores,
          opponentPlayers: visitantePlayers,
          teamSlug: item.localSlug,
          teamName: item.localName,
          opponentSlug: item.visitanteSlug,
          opponentName: item.visitanteName
        },
        {
          players: visitantePlayers,
          scoreRows: visitanteScores,
          opponentScoreRows: localScores,
          opponentPlayers: localPlayers,
          teamSlug: item.visitanteSlug,
          teamName: item.visitanteName,
          opponentSlug: item.localSlug,
          opponentName: item.localName
        }
      ];

      for (const side of scan) {
        if (!samePlayerTeamSlug(side.teamSlug, exact.teamSlug)) continue;
        side.players.forEach((playerName, idx) => {
          if (!sameNormalizedName(playerName, exact.name)) return;
          const triangulosFavor = Number(side.scoreRows[idx] ?? 0) || 0;
          const triangulosContra = Number(side.opponentScoreRows[idx] ?? 0) || 0;
          const opponentPlayerName = String(side.opponentPlayers?.[idx] || '').trim();
          matches.push({
            fechaISO: item.fechaISO,
            category: item.category || category,
            playerName,
            teamSlug: side.teamSlug,
            teamName: side.teamName,
            opponentSlug: side.opponentSlug,
            opponentName: side.opponentName,
            opponentPlayerName,
            row: idx + 1,
            triangulosFavor,
            triangulosContra,
            result: triangulosFavor > triangulosContra ? 'ganado' : (triangulosFavor < triangulosContra ? 'perdido' : 'empatado')
          });
        });
      }

      const pairScan = [
        {
          planilla: item.localPlanilla,
          scoreRows: localScores,
          opponentPlanilla: item.visitantePlanilla,
          opponentScoreRows: visitanteScores,
          teamSlug: item.localSlug,
          teamName: item.localName,
          opponentSlug: item.visitanteSlug,
          opponentName: item.visitanteName
        },
        {
          planilla: item.visitantePlanilla,
          scoreRows: visitanteScores,
          opponentPlanilla: item.localPlanilla,
          opponentScoreRows: localScores,
          teamSlug: item.visitanteSlug,
          teamName: item.visitanteName,
          opponentSlug: item.localSlug,
          opponentName: item.localName
        }
      ];

      for (const side of pairScan) {
        if (!samePlayerTeamSlug(side.teamSlug, exact.teamSlug)) continue;

        for (let pairIndex = 0; pairIndex < 2; pairIndex++) {
          const pairPlayers = getPairPlayers(side.planilla, pairIndex);
          const matchedIndex = pairPlayers.findIndex((playerName) => sameNormalizedName(playerName, exact.name));
          if (matchedIndex === -1) continue;

          const playerName = String(pairPlayers[matchedIndex] || exact.name || '').trim();
          const companionName = String(pairPlayers[matchedIndex === 0 ? 1 : 0] || '').trim();
          const opponentPairPlayers = getPairPlayers(side.opponentPlanilla, pairIndex);
          const triangulosFavor = getPairScore(side.scoreRows, side.planilla, pairIndex);
          const triangulosContra = getPairScore(side.opponentScoreRows, side.opponentPlanilla, pairIndex);

          pairMatches.push({
            fechaISO: item.fechaISO,
            category: item.category || category,
            playerName,
            companionName,
            teamSlug: side.teamSlug,
            teamName: side.teamName,
            opponentSlug: side.opponentSlug,
            opponentName: side.opponentName,
            opponentPairPlayers,
            pairNumber: pairIndex + 1,
            triangulosFavor,
            triangulosContra,
            result: triangulosFavor > triangulosContra ? 'ganado' : (triangulosFavor < triangulosContra ? 'perdido' : 'empatado')
          });
        }
      }
    }

    const sortByDateAndRow = (a, b) =>
      String(a.fechaISO || '').localeCompare(String(b.fechaISO || '')) ||
      Number(a.row || a.pairNumber || 0) - Number(b.row || b.pairNumber || 0);

    matches.sort(sortByDateAndRow);
    pairMatches.sort(sortByDateAndRow);

    return res.json({
      ok: true,
      category,
      q,
      suggestions,
      player: playerRadRow ? { ...exact, ...playerRadRow } : exact,
      rad: playerRadRow?.rad ?? null,
      radPenalty: playerRadRow?.radPenalty ?? null,
      radContext,
      total: matches.length,
      pairTotal: pairMatches.length,
      matches,
      pairMatches
    });
  } catch (err) {
    console.error('GET /player-query', err);
    return res.status(500).json({ ok: false, error: 'No se pudo consultar el jugador.' });
  }
});


function ensureRankingRow(map, playerName, teamSlug, teamName) {
  const key = `${normalizeText(playerName)}::${canonicalPlayerTeamSlug(teamSlug)}`;
  if (!map.has(key)) {
    map.set(key, {
      name: String(playerName || '').trim(),
      teamSlug,
      teamName,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      triangulosFavor: 0,
      triangulosContra: 0,
      diff: 0,
      effectiveness: 0
    });
  }
  return map.get(key);
}




function radNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function radRound1(value) {
  return Math.round(radNumber(value) * 10) / 10;
}

function buildRadContextFromRows(rows = []) {
  const playedValues = rows
    .map((item) => radNumber(item.played))
    .filter((played) => played > 0);

  const maxPlayed = playedValues.length ? Math.max(...playedValues) : 0;
  const avgPlayed = playedValues.length
    ? playedValues.reduce((acc, played) => acc + played, 0) / playedValues.length
    : 0;
  const spread = maxPlayed > 0 ? (maxPlayed - avgPlayed) / maxPlayed : 0;
  const force = 1 + spread;

  return { maxPlayed, avgPlayed, spread, force };
}

function applyRadToPlayerRow(item = {}, context = null) {
  const played = radNumber(item.played);
  const wins = radNumber(item.wins);
  const triangulosFavor = radNumber(item.triangulosFavor);
  const triangulosContra = radNumber(item.triangulosContra);
  const effectiveness = played > 0 ? (wins / played) * 100 : 0;

  const maxPlayed = radNumber(context?.maxPlayed);
  const avgPlayed = radNumber(context?.avgPlayed);
  const spread = maxPlayed > 0 ? (maxPlayed - avgPlayed) / maxPlayed : 0;
  const force = 1 + spread;

  const penalty = maxPlayed > 0 && played > 0
    ? 1 + ((maxPlayed - played) / maxPlayed) * force
    : 1;

  const rad = penalty > 0 ? effectiveness / penalty : 0;

  return {
    ...item,
    triangulosFavor,
    triangulosContra,
    diff: triangulosFavor - triangulosContra,
    effectiveness: radRound1(effectiveness),
    rad: radRound1(rad),
    radPenalty: radRound1(penalty)
  };
}

function sortPlayerRadRows(a, b) {
  const aPlayed = radNumber(a.played);
  const bPlayed = radNumber(b.played);

  if (aPlayed === 0 && bPlayed > 0) return 1;
  if (bPlayed === 0 && aPlayed > 0) return -1;

  if (radNumber(b.rad) !== radNumber(a.rad)) return radNumber(b.rad) - radNumber(a.rad);
  if (radNumber(b.diff) !== radNumber(a.diff)) return radNumber(b.diff) - radNumber(a.diff);
  if (radNumber(b.triangulosFavor) !== radNumber(a.triangulosFavor)) return radNumber(b.triangulosFavor) - radNumber(a.triangulosFavor);
  if (radNumber(b.wins) !== radNumber(a.wins)) return radNumber(b.wins) - radNumber(a.wins);
  if (bPlayed !== aPlayed) return bPlayed - aPlayed;
  return String(a.name || '').localeCompare(String(b.name || ''), 'es');
}

function buildPlayerRowsFromResults(results = []) {
  const rankingMap = new Map();

  for (const item of results) {
    const localPlayers = getIndividualPlayers(item.localPlanilla);
    const visitantePlayers = getIndividualPlayers(item.visitantePlanilla);
    const localScores = Array.isArray(item.local?.scoreRows) ? item.local.scoreRows : [];
    const visitanteScores = Array.isArray(item.visitante?.scoreRows) ? item.visitante.scoreRows : [];
    const max = Math.max(localPlayers.length, visitantePlayers.length, 7);

    for (let idx = 0; idx < max; idx++) {
      const localPlayer = String(localPlayers[idx] || '').trim();
      const visitantePlayer = String(visitantePlayers[idx] || '').trim();
      const localScore = Number(localScores[idx] ?? 0) || 0;
      const visitanteScore = Number(visitanteScores[idx] ?? 0) || 0;

      if (localPlayer) {
        const row = ensureRankingRow(rankingMap, localPlayer, item.localSlug, item.localName);
        row.played += 1;
        row.triangulosFavor += localScore;
        row.triangulosContra += visitanteScore;
        if (localScore > visitanteScore) row.wins += 1;
        else if (localScore < visitanteScore) row.losses += 1;
        else row.draws += 1;
      }

      if (visitantePlayer) {
        const row = ensureRankingRow(rankingMap, visitantePlayer, item.visitanteSlug, item.visitanteName);
        row.played += 1;
        row.triangulosFavor += visitanteScore;
        row.triangulosContra += localScore;
        if (visitanteScore > localScore) row.wins += 1;
        else if (visitanteScore < localScore) row.losses += 1;
        else row.draws += 1;
      }
    }
  }

  return Array.from(rankingMap.values())
    .map((item) => ({
      ...item,
      diff: Number(item.triangulosFavor || 0) - Number(item.triangulosContra || 0),
      effectiveness: Number(item.played || 0) > 0 ? Math.round((Number(item.wins || 0) / Number(item.played || 0)) * 100) : 0
    }));
}

function buildRadRankingFromResults(results = []) {
  const baseRows = buildPlayerRowsFromResults(results);
  const activeRows = baseRows.filter((item) => radNumber(item.played) > 0);
  const rawContext = buildRadContextFromRows(activeRows);

  const ranking = baseRows
    .map((item) => applyRadToPlayerRow(item, rawContext))
    .sort(sortPlayerRadRows);

  return {
    ranking,
    radContext: {
      maxPlayed: radRound1(rawContext.maxPlayed),
      avgPlayed: radRound1(rawContext.avgPlayed),
      spread: radRound1(rawContext.spread),
      force: radRound1(rawContext.force)
    }
  };
}


async function countRegisteredIndividualPlayersByCategory(category = '') {
  const division = String(category || '').trim().toLowerCase();
  if (!division) return 0;

  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM jugadores j
    INNER JOIN equipos e ON e.id = j.equipo_id
    WHERE LOWER(e.division) = $1
      AND TRIM(COALESCE(j.nombre, '')) <> ''
    `,
    [division]
  );

  return Number(rows?.[0]?.total || 0);
}

router.get('/player-ranking', async (req, res) => {
  setNoCache(res);
  try {
    const category = String(req.query.category || '').trim().toLowerCase();
    const rawLimit = Number(req.query.limit || 10);
    const limit = [10, 20, 50].includes(rawLimit) ? rawLimit : 10;

    if (!category) {
      return res.status(400).json({ ok: false, error: 'Seleccioná una categoría.' });
    }

    const [results, totalRegisteredPlayers] = await Promise.all([
      buildAllValidatedCrucesForPlayerQuery(category),
      countRegisteredIndividualPlayersByCategory(category)
    ]);

    // Primero calcula RAD usando TODA la categoría; recién después corta Top 10/20/50.
    const { ranking: fullRanking, radContext } = buildRadRankingFromResults(results);
    const totalActivePlayers = fullRanking.filter((item) => Number(item.played || 0) > 0).length;
    const ranking = fullRanking.slice(0, limit);

    return res.json({
      ok: true,
      category,
      limit,
      total: ranking.length,
      totalRegisteredPlayers,
      totalActivePlayers,
      radContext,
      ranking
    });
  } catch (err) {
    console.error('GET /player-ranking', err);
    return res.status(500).json({ ok: false, error: 'No se pudo armar el ranking.' });
  }
});



function ensureTeamRankingRow(map, teamSlug, teamName) {
  const key = canonicalPlayerTeamSlug(teamSlug || teamName || 'sin-equipo');
  if (!map.has(key)) {
    map.set(key, {
      teamSlug,
      teamName: String(teamName || 'Sin equipo').trim(),
      played: 0,
      puntosFavor: 0,
      puntosContra: 0,
      diffPuntos: 0,
      triangulosFavor: 0,
      triangulosContra: 0,
      diffTriangulos: 0
    });
  }
  return map.get(key);
}

router.get('/team-ranking', async (req, res) => {
  setNoCache(res);
  try {
    const category = String(req.query.category || '').trim().toLowerCase();
    const rawLimit = Number(req.query.limit || 10);
    const limit = [10, 20, 50].includes(rawLimit) ? rawLimit : 10;

    if (!category) {
      return res.status(400).json({ ok: false, error: 'Seleccioná una categoría.' });
    }

    const results = await buildAllValidatedCrucesForPlayerQuery(category);
    const rankingMap = new Map();
    const countedMatches = new Set();

    for (const item of results) {
      // Evita contar dos veces el mismo cruce si en la DB quedó guardado
      // también con el orden invertido de equipos. La fecha separa ida/vuelta.
      const matchTeamsKey = [canonicalPlayerTeamSlug(item.localSlug), canonicalPlayerTeamSlug(item.visitanteSlug)]
        .sort()
        .join('::');
      const matchKey = `${String(item.fechaISO || '')}::${matchTeamsKey}`;
      if (countedMatches.has(matchKey)) continue;
      countedMatches.add(matchKey);

      const localScores = Array.isArray(item.local?.scoreRows) ? item.local.scoreRows : [];
      const visitanteScores = Array.isArray(item.visitante?.scoreRows) ? item.visitante.scoreRows : [];

      // Puntos = puntosTotales de la planilla.
      // Triángulos = triangulosTotales de la planilla.
      // Fallbacks para planillas viejas que no tengan esos campos.
      const localPF = item.local?.puntosTotales !== undefined && item.local?.puntosTotales !== null
        ? Number(item.local.puntosTotales) || 0
        : localScores.filter((n) => Number(n || 0) > 0).length;
      const visitantePF = item.visitante?.puntosTotales !== undefined && item.visitante?.puntosTotales !== null
        ? Number(item.visitante.puntosTotales) || 0
        : visitanteScores.filter((n) => Number(n || 0) > 0).length;

      const localTF = (item.local?.triangulosTotales !== undefined && item.local?.triangulosTotales !== null)
        ? Number(item.local.triangulosTotales) || 0
        : ((item.local?.triangulos !== undefined && item.local?.triangulos !== null)
          ? Number(item.local.triangulos) || 0
          : localScores.reduce((acc, n) => acc + (Number(n) || 0), 0));
      const visitanteTF = (item.visitante?.triangulosTotales !== undefined && item.visitante?.triangulosTotales !== null)
        ? Number(item.visitante.triangulosTotales) || 0
        : ((item.visitante?.triangulos !== undefined && item.visitante?.triangulos !== null)
          ? Number(item.visitante.triangulos) || 0
          : visitanteScores.reduce((acc, n) => acc + (Number(n) || 0), 0));

      const localRow = ensureTeamRankingRow(rankingMap, item.localSlug, item.localName);
      localRow.played += 1;
      localRow.puntosFavor += localPF;
      localRow.puntosContra += visitantePF;
      localRow.triangulosFavor += localTF;
      localRow.triangulosContra += visitanteTF;

      const visitanteRow = ensureTeamRankingRow(rankingMap, item.visitanteSlug, item.visitanteName);
      visitanteRow.played += 1;
      visitanteRow.puntosFavor += visitantePF;
      visitanteRow.puntosContra += localPF;
      visitanteRow.triangulosFavor += visitanteTF;
      visitanteRow.triangulosContra += localTF;
    }

    const ranking = Array.from(rankingMap.values())
      .map((item) => ({
        ...item,
        diffPuntos: Number(item.puntosFavor || 0) - Number(item.puntosContra || 0),
        diffTriangulos: Number(item.triangulosFavor || 0) - Number(item.triangulosContra || 0)
      }))
      .sort((a, b) => {
        if (b.puntosFavor !== a.puntosFavor) return b.puntosFavor - a.puntosFavor;
        if (b.diffPuntos !== a.diffPuntos) return b.diffPuntos - a.diffPuntos;
        if (b.diffTriangulos !== a.diffTriangulos) return b.diffTriangulos - a.diffTriangulos;
        if (b.triangulosFavor !== a.triangulosFavor) return b.triangulosFavor - a.triangulosFavor;
        if (a.puntosContra !== b.puntosContra) return a.puntosContra - b.puntosContra;
        return String(a.teamName || '').localeCompare(String(b.teamName || ''), 'es');
      })
      .slice(0, limit);

    return res.json({
      ok: true,
      category,
      limit,
      total: ranking.length,
      ranking
    });
  } catch (err) {
    console.error('GET /team-ranking', err);
    return res.status(500).json({ ok: false, error: 'No se pudo armar el ranking de equipos.' });
  }
});

async function findTeamsByCategory(category = '') {
  const division = String(category || '').trim().toLowerCase();
  if (!division) return [];

  const { rows } = await pool.query(
    `
    SELECT id, slug_uid, slug_base, display_name, division
    FROM equipos
    WHERE LOWER(division) = $1
    ORDER BY display_name ASC, id ASC
    `,
    [division]
  );

  return rows;
}

async function getRegisteredPlayersForTeam(teamId) {
  if (!teamId) return [];

  const { rows } = await pool.query(
    `
    SELECT TRIM(nombre) AS name
    FROM jugadores
    WHERE equipo_id = $1
      AND TRIM(COALESCE(nombre, '')) <> ''
    ORDER BY nombre ASC
    `,
    [teamId]
  );

  return rows.map((row) => String(row.name || '').trim()).filter(Boolean);
}

function teamInfoMatchesSide(teamInfo = {}, sideSlug = '', sideName = '') {
  const candidates = [teamInfo.slug_uid, teamInfo.slug_base, teamInfo.display_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return candidates.some((candidate) => (
    samePlayerTeamSlug(sideSlug, candidate) || normalizeText(sideName) === normalizeText(candidate)
  ));
}

function sortPlayerStatsRows(a, b) {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.diff !== a.diff) return b.diff - a.diff;
  if (a.losses !== b.losses) return a.losses - b.losses;
  if (b.triangulosFavor !== a.triangulosFavor) return b.triangulosFavor - a.triangulosFavor;
  return String(a.name || '').localeCompare(String(b.name || ''), 'es');
}

router.get('/team-query', async (req, res) => {
  setNoCache(res);
  try {
    const category = String(req.query.category || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim();

    if (!category) {
      return res.status(400).json({ ok: false, error: 'Seleccioná una categoría.' });
    }

    if (!q || normalizeText(q).length < 2) {
      return res.json({ ok: true, category, q, suggestions: [], team: null, players: [], totalRegisteredPlayers: 0, totalActivePlayers: 0 });
    }

    const teams = await findTeamsByCategory(category);
    const suggestions = teams
      .filter((team) => (
        includesNormalizedName(team.display_name, q) ||
        includesNormalizedName(team.slug_uid, q) ||
        includesNormalizedName(team.slug_base, q)
      ))
      .map((team) => ({
        name: team.display_name,
        teamSlug: team.slug_uid || team.slug_base,
        teamBase: team.slug_base,
        label: team.display_name,
        id: team.id
      }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
      .slice(0, 12);

    const exactSuggestion = suggestions.find((item) => sameNormalizedName(item.name, q));
    const exactTeam = exactSuggestion
      ? teams.find((team) => Number(team.id) === Number(exactSuggestion.id))
      : null;

    if (!exactTeam) {
      return res.json({ ok: true, category, q, suggestions, team: null, players: [], totalRegisteredPlayers: 0, totalActivePlayers: 0 });
    }

    const [registeredPlayers, results] = await Promise.all([
      getRegisteredPlayersForTeam(exactTeam.id),
      buildAllValidatedCrucesForPlayerQuery(category)
    ]);

    const { ranking: categoryRanking, radContext } = buildRadRankingFromResults(results);
    const categoryPlayersByKey = new Map();

    categoryRanking.forEach((item) => {
      categoryPlayersByKey.set(`${normalizeText(item.name)}::${canonicalPlayerTeamSlug(item.teamSlug)}`, item);
    });

    const playersMap = new Map();
    const ensureTeamPlayer = (playerName) => {
      const key = normalizeText(playerName);
      if (!key) return null;
      if (!playersMap.has(key)) {
        const categoryKey = `${key}::${canonicalPlayerTeamSlug(exactTeam.slug_uid || exactTeam.slug_base)}`;
        const categoryRow = categoryPlayersByKey.get(categoryKey) || null;
        playersMap.set(key, categoryRow ? { ...categoryRow } : {
          name: String(playerName || '').trim(),
          teamSlug: exactTeam.slug_uid || exactTeam.slug_base,
          teamName: exactTeam.display_name,
          played: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          triangulosFavor: 0,
          triangulosContra: 0,
          diff: 0,
          effectiveness: 0,
          rad: 0,
          radPenalty: 0
        });
      }
      return playersMap.get(key);
    };

    registeredPlayers.forEach(ensureTeamPlayer);

    const players = Array.from(playersMap.values()).sort(sortPlayerRadRows);
    const totalActivePlayers = players.filter((item) => Number(item.played || 0) > 0).length;

    return res.json({
      ok: true,
      category,
      q,
      suggestions,
      team: {
        id: exactTeam.id,
        name: exactTeam.display_name,
        teamSlug: exactTeam.slug_uid || exactTeam.slug_base,
        teamBase: exactTeam.slug_base
      },
      totalRegisteredPlayers: registeredPlayers.length,
      totalActivePlayers,
      radContext,
      players
    });
  } catch (err) {
    console.error('GET /team-query', err);
    return res.status(500).json({ ok: false, error: 'No se pudo consultar el equipo.' });
  }
});


module.exports = router;
