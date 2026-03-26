const express = require('express');
const router = express.Router();
const pool = require('../../db');

// ===== ADMIN CRUCES (sin fecha / compat legacy) =====
const crucesEnabledByTeam = new Map();

function normalizeCrucesAdminKey(team) {
  return String(team || '').trim().toLowerCase();
}

function getCrucesEntry(team) {
  const key = normalizeCrucesAdminKey(team);
  const enabled = crucesEnabledByTeam.get(key);
  return { enabled: enabled !== false };
}

router.get('/status', (req, res) => {
  const { team } = req.query;
  if (!team) {
    return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
  }

  const state = getCrucesEntry(team);
  res.json({ ok: true, enabled: state.enabled });
});

router.post('/enable', (req, res) => {
  const { team } = req.body || {};
  if (!team) {
    return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
  }

  const key = normalizeCrucesAdminKey(team);
  crucesEnabledByTeam.set(key, true);

  res.json({ ok: true, enabled: true });
});

router.post('/disable', (req, res) => {
  const { team } = req.body || {};
  if (!team) {
    return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
  }

  const key = normalizeCrucesAdminKey(team);
  crucesEnabledByTeam.set(key, false);

  res.json({ ok: true, enabled: false });
});

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = () => {
    res.write(`data: ping\n\n`);
  };

  const timer = setInterval(send, 10000);

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
      equipoSlug,
      status
    } = req.body || {};

    if (!localSlug || !visitanteSlug || !fechaISO || !equipoSlug) {
      return res.status(400).json({ ok: false, error: 'Faltan datos' });
    }

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
      [
        localSlug,
        visitanteSlug,
        fechaISO,
        equipoSlug,
        JSON.stringify(status || {})
      ]
    );

    return res.json({ ok: true, saved: result.rows[0] });
  } catch (err) {
    console.error('POST /match-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo guardar el status del cruce' });
  }
});

router.get('/match-status', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const localSlug = String(req.query.localSlug || '').trim();
    const visitanteSlug = String(req.query.visitanteSlug || '').trim();
    const fechaISO = String(req.query.fechaISO || '').trim();
    const equipoSlug = String(req.query.equipoSlug || '').trim();

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
      equipoSlug,
      validacion,
      status
    } = req.body || {};

    if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug || validacion === undefined) {
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
        mensaje: 'Validado: esperando que valide su rival'
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
      mensaje: 'Validación exitosa'
    });
  } catch (err) {
    console.error('POST /validate', err);
    return res.status(500).json({ ok: false, error: 'No se pudo validar el cruce' });
  }
});

router.get('/lock-status', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const fechaISO = String(req.query.fechaISO || '').trim();
    const equipoSlug = String(req.query.equipoSlug || '').trim();
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
        validated: true,
        mensaje: 'Validado: esperando que valide su rival'
      });
    }

    const diff = compareFullStatus(mine?.status_json || {}, rival?.status_json || {});
    if (diff.length) {
      return res.json({
        ok: true,
        tipo: 'mismatch',
        locked: false,
        validated: false,
        error: 'Los datos no son correctos, consulte con su rival'
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

module.exports = router;
