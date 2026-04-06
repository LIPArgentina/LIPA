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
    scheduledAt: parseArgDateAt(startKey, 11, 20, 0),
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

  return {
    category,
    fixtures,
    ...computeNextAutomation(fixtures)
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

    return res.json({
      ok: true,
      tipo: 'validado',
      mensaje: 'Validación exitosa',
      locked: true,
      validated: true,
      lockedUntil: lockUntil
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

module.exports = router;
