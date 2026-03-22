hacé const express = require('express');
const router = express.Router();
const pool = require('../../db');

function normalizeSlug(value = '') {
  return String(value || '').trim().toLowerCase();
}

function sortMatchSlugs(localSlug, visitanteSlug) {
  return {
    localSlug: normalizeSlug(localSlug),
    visitanteSlug: normalizeSlug(visitanteSlug),
  };
}

function buildScopeSlug(localSlug, visitanteSlug) {
  return `${localSlug}__${visitanteSlug}`;
}

function buildFechaClave(fechaISO, localSlug, visitanteSlug) {
  return String(fechaISO).slice(0, 10);
}

function sameTotalsStrict(a, b) {
  return (
    a?.local?.triangulosTotales === b?.local?.triangulosTotales &&
    a?.local?.puntosTotales === b?.local?.puntosTotales &&
    a?.visitante?.triangulosTotales === b?.visitante?.triangulosTotales &&
    a?.visitante?.puntosTotales === b?.visitante?.puntosTotales
  );
}

function buildPartialResponse(row) {
  return {
    ok: true,
    data: {
      fechaISO: row.fecha_iso,
      validated: !!row.validated,
      localSlug: row.local_slug,
      visitanteSlug: row.visitante_slug,
      localPlanilla: row.datos?.localPlanilla || null,
      visitantePlanilla: row.datos?.visitantePlanilla || null,
      local: row.datos?.local || null,
      visitante: row.datos?.visitante || null,
      lockedUntil: row.locked_until || null,
      updatedAt: row.updated_at || null,
      equipoSlug: row.equipo_slug,
    }
  };
}

function buildFinalResponse(row) {
  const payload = row.payload || {};
  return {
    ok: true,
    data: {
      fechaISO: row.fecha_iso,
      validated: true,
      localSlug: row.local_equipo_slug,
      visitanteSlug: row.visitante_equipo_slug,
      localPlanilla: payload?.localPlanilla || null,
      visitantePlanilla: payload?.visitantePlanilla || null,
      local: payload?.local || null,
      visitante: payload?.visitante || null,
      localValidated: true,
      visitanteValidated: true,
      localLockedUntil: row.locked_until || null,
      visitanteLockedUntil: row.locked_until || null,
      validatedAt: row.validated_at || null,
    }
  };
}

async function upsertPartial(client, { fechaISO, localSlug, visitanteSlug, equipoSlug, datos, validated = false, validatedAt = null, lockedUntil = null }) {
  const updated = await client.query(
    `
      UPDATE cruces_parciales
      SET
        datos = $5::jsonb,
        validated = $6,
        validated_at = $7::timestamptz,
        locked_until = $8::timestamptz,
        updated_at = NOW()
      WHERE fecha_iso = $1::date
        AND local_slug = $2
        AND visitante_slug = $3
        AND equipo_slug = $4
      RETURNING *;
    `,
    [
      fechaISO,
      localSlug,
      visitanteSlug,
      equipoSlug,
      JSON.stringify(datos),
      !!validated,
      validatedAt,
      lockedUntil
    ]
  );

  if (updated.rows[0]) return updated.rows[0];

  const inserted = await client.query(
    `
      INSERT INTO cruces_parciales (
        fecha_iso,
        local_slug,
        visitante_slug,
        equipo_slug,
        datos,
        validated,
        validated_at,
        locked_until,
        updated_at
      )
      VALUES ($1::date, $2, $3, $4, $5::jsonb, $6, $7::timestamptz, $8::timestamptz, NOW())
      RETURNING *;
    `,
    [
      fechaISO,
      localSlug,
      visitanteSlug,
      equipoSlug,
      JSON.stringify(datos),
      !!validated,
      validatedAt,
      lockedUntil
    ]
  );

  return inserted.rows[0];
}

async function getPartial(client, { fechaISO, localSlug, visitanteSlug, equipoSlug }) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM cruces_parciales
      WHERE fecha_iso = $1::date
        AND local_slug = $2
        AND visitante_slug = $3
        AND equipo_slug = $4
      LIMIT 1
    `,
    [fechaISO, localSlug, visitanteSlug, equipoSlug]
  );
  return rows[0] || null;
}

async function getBothPartials(client, { fechaISO, localSlug, visitanteSlug }) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM cruces_parciales
      WHERE fecha_iso = $1::date
        AND local_slug = $2
        AND visitante_slug = $3
        AND equipo_slug IN ($4, $5)
      ORDER BY equipo_slug
    `,
    [fechaISO, localSlug, visitanteSlug, localSlug, visitanteSlug]
  );
  return rows;
}

async function getFinalValidation(client, { fechaISO, localSlug, visitanteSlug }) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM cruces_validaciones
      WHERE fecha_iso = $1::date
        AND local_equipo_slug = $2
        AND visitante_equipo_slug = $3
      ORDER BY validated_at DESC NULLS LAST, id DESC
      LIMIT 1
    `,
    [fechaISO, localSlug, visitanteSlug]
  );
  return rows[0] || null;
}

async function upsertFinalValidation(client, { fechaISO, localSlug, visitanteSlug, datos, lockUntil }) {
  const fechaClave = buildFechaClave(fechaISO, localSlug, visitanteSlug);
  const scopeSlug = buildScopeSlug(localSlug, visitanteSlug);

  const updated = await client.query(
    `
      UPDATE cruces_validaciones
      SET
        payload = $4::jsonb,
        validated_at = NOW(),
        locked_until = $5::timestamptz,
        updated_at = NOW(),
        fecha_clave = $6,
        scope_slug = $7
      WHERE fecha_iso = $1::date
        AND local_equipo_slug = $2
        AND visitante_equipo_slug = $3
      RETURNING *;
    `,
    [
      fechaISO,
      localSlug,
      visitanteSlug,
      JSON.stringify(datos),
      lockUntil,
      fechaClave,
      scopeSlug
    ]
  );

  if (updated.rows[0]) return updated.rows[0];

  const inserted = await client.query(
    `
      INSERT INTO cruces_validaciones (
        fecha_iso,
        payload,
        local_equipo_slug,
        visitante_equipo_slug,
        validated_at,
        locked_until,
        updated_at,
        created_at,
        fecha_clave,
        scope_slug,
        source_file
      )
      VALUES ($1::date, $2::jsonb, $3, $4, NOW(), $5::timestamptz, NOW(), NOW(), $6, $7, $8)
      RETURNING *;
    `,
    [
      fechaISO,
      JSON.stringify(datos),
      localSlug,
      visitanteSlug,
      lockUntil,
      fechaClave,
      scopeSlug,
      'postgres'
    ]
  );

  return inserted.rows[0];
}

async function lockBothPartials(client, { fechaISO, localSlug, visitanteSlug, lockUntil }) {
  await client.query(
    `
      UPDATE cruces_parciales
      SET
        validated = TRUE,
        validated_at = NOW(),
        locked_until = $4::timestamptz,
        updated_at = NOW()
      WHERE fecha_iso = $1::date
        AND local_slug = $2
        AND visitante_slug = $3
    `,
    [fechaISO, localSlug, visitanteSlug, lockUntil]
  );
}

router.post('/match-status', async (req, res) => {
  const {
    fechaISO,
    localSlug: rawLocalSlug,
    visitanteSlug: rawVisitanteSlug,
    equipoSlug: rawEquipoSlug,
    status
  } = req.body || {};

  const { localSlug, visitanteSlug } = sortMatchSlugs(rawLocalSlug, rawVisitanteSlug);
  const equipoSlug = normalizeSlug(rawEquipoSlug);

  if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug || !status) {
    return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios.' });
  }

  if (![localSlug, visitanteSlug].includes(equipoSlug)) {
    return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const final = await getFinalValidation(client, { fechaISO, localSlug, visitanteSlug });
    if (final) {
      await client.query('COMMIT');
      return res.json(buildFinalResponse(final));
    }

    const partial = await upsertPartial(client, {
      fechaISO,
      localSlug,
      visitanteSlug,
      equipoSlug,
      datos: status
    });

    await client.query('COMMIT');
    return res.json(buildPartialResponse(partial));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /cruces/match-status', error);
    return res.status(500).json({ ok: false, error: 'No se pudo guardar el parcial del cruce.' });
  } finally {
    client.release();
  }
});

router.get('/match-status', async (req, res) => {
  const fechaISO = req.query.fechaISO;
  const equipoSlug = normalizeSlug(req.query.equipoSlug);
  const { localSlug, visitanteSlug } = sortMatchSlugs(req.query.localSlug, req.query.visitanteSlug);

  if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros.' });
  }

  if (![localSlug, visitanteSlug].includes(equipoSlug)) {
    return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
  }

  try {
    const final = await getFinalValidation(pool, { fechaISO, localSlug, visitanteSlug });
    if (final) {
      return res.json(buildFinalResponse(final));
    }

    const partial = await getPartial(pool, { fechaISO, localSlug, visitanteSlug, equipoSlug });
    if (!partial) {
      return res.json({ ok: true, data: null });
    }

    return res.json(buildPartialResponse(partial));
  } catch (error) {
    console.error('GET /cruces/match-status', error);
    return res.status(500).json({ ok: false, error: 'No se pudo leer el parcial del cruce.' });
  }
});

router.post('/validate', async (req, res) => {
  const {
    fechaISO,
    localSlug: rawLocalSlug,
    visitanteSlug: rawVisitanteSlug,
    equipoSlug: rawEquipoSlug,
  } = req.body || {};

  const { localSlug, visitanteSlug } = sortMatchSlugs(rawLocalSlug, rawVisitanteSlug);
  const equipoSlug = normalizeSlug(rawEquipoSlug);
  const rivalSlug = equipoSlug === localSlug ? visitanteSlug : localSlug;

  if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug) {
    return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios.' });
  }

  if (![localSlug, visitanteSlug].includes(equipoSlug)) {
    return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingFinal = await getFinalValidation(client, { fechaISO, localSlug, visitanteSlug });
    if (existingFinal) {
      await client.query('COMMIT');
      return res.json({
        ok: true,
        tipo: 'validado',
        mensaje: 'Validación exitosa'
      });
    }

    const partials = await getBothPartials(client, { fechaISO, localSlug, visitanteSlug });
    const mine = partials.find(r => r.equipo_slug === equipoSlug) || null;
    const rival = partials.find(r => r.equipo_slug === rivalSlug) || null;

    if (!rival?.datos) {
      await client.query('COMMIT');
      return res.json({
        ok: true,
        tipo: 'pendiente',
        mensaje: 'PENDIENTE: tu rival todavía no cargó su parcial'
      });
    }

    const coincide = sameTotalsStrict(mine?.datos, rival?.datos);
    if (!coincide) {
      await client.query('COMMIT');
      return res.json({
        ok: false,
        tipo: 'mismatch',
        error: 'Los datos no coinciden, verificar con su rival'
      });
    }

    const lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await upsertFinalValidation(client, {
      fechaISO,
      localSlug,
      visitanteSlug,
      datos: mine?.datos || rival?.datos,
      lockUntil
    });

    await lockBothPartials(client, {
      fechaISO,
      localSlug,
      visitanteSlug,
      lockUntil
    });

    await client.query('COMMIT');
    return res.json({
      ok: true,
      tipo: 'validado',
      mensaje: 'Validación exitosa'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /cruces/validate', error);
    return res.status(500).json({ ok: false, error: 'No se pudo validar el cruce.' });
  } finally {
    client.release();
  }
});

router.get('/lock-status', async (req, res) => {
  const fechaISO = req.query.fechaISO;
  const equipoSlug = normalizeSlug(req.query.equipoSlug);
  const { localSlug, visitanteSlug } = sortMatchSlugs(req.query.localSlug, req.query.visitanteSlug);

  if (!fechaISO || !equipoSlug || !localSlug || !visitanteSlug) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros.' });
  }

  try {
    const final = await getFinalValidation(pool, { fechaISO, localSlug, visitanteSlug });
    if (final) {
      const locked = !!(final.locked_until && new Date(final.locked_until) > new Date());
      return res.json({
        ok: true,
        locked,
        lockedUntil: final.locked_until || null,
        validatedFinal: true
      });
    }

    const partial = await getPartial(pool, { fechaISO, localSlug, visitanteSlug, equipoSlug });
    const locked = !!(partial?.locked_until && new Date(partial?.locked_until) > new Date());

    return res.json({
      ok: true,
      locked,
      lockedUntil: partial?.locked_until || null,
      validatedFinal: false
    });
  } catch (error) {
    console.error('GET /cruces/lock-status', error);
    return res.status(500).json({ ok: false, error: 'No se pudo leer el lock.' });
  }
});

// ===== ADMIN CRUCES (compatibilidad con frontend) =====
const crucesEnabledUntilByKey = new Map();

function normalizeCrucesAdminKey(team, fechaKey) {
  const normalizedTeam = String(team || '').trim().toLowerCase();
  const normalizedFecha = String(fechaKey || '').trim();
  return `${normalizedTeam}::${normalizedFecha}`;
}

function getCrucesEntry(team, fechaKey) {
  const now = Date.now();
  const key = normalizeCrucesAdminKey(team, fechaKey);
  const until = crucesEnabledUntilByKey.get(key) || null;

  if (until && until <= now) {
    crucesEnabledUntilByKey.delete(key);
    return { key, enabled: false, remainingMs: 0, until: null };
  }

  return {
    key,
    enabled: !!(until && until > now),
    remainingMs: until ? Math.max(0, until - now) : 0,
    until
  };
}

router.get('/status', (req, res) => {
  const team = req.query.team;
  const fechaKey = req.query.fechaKey;

  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey.' });
  }

  const state = getCrucesEntry(team, fechaKey);

  res.json({
    ok: true,
    team: String(team),
    fechaKey: String(fechaKey),
    enabled: state.enabled,
    remainingMs: state.remainingMs
  });
});

router.post('/enable', (req, res) => {
  const team = req.body?.team;
  const fechaKey = req.body?.fechaKey;

  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey.' });
  }

  const now = Date.now();
  const key = normalizeCrucesAdminKey(team, fechaKey);
  const until = now + (48 * 60 * 60 * 1000);
  crucesEnabledUntilByKey.set(key, until);

  res.json({
    ok: true,
    team: String(team),
    fechaKey: String(fechaKey),
    enabled: true,
    remainingMs: until - now
  });
});

router.post('/disable', (req, res) => {
  const team = req.body?.team;
  const fechaKey = req.body?.fechaKey;

  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey.' });
  }

  const key = normalizeCrucesAdminKey(team, fechaKey);
  crucesEnabledUntilByKey.delete(key);

  res.json({
    ok: true,
    team: String(team),
    fechaKey: String(fechaKey),
    enabled: false,
    remainingMs: 0
  });
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


// ===== CRUCES (GET + POST desde DB) =====

async function getFixturesColumns() {
  const { rows } = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fixtures'
  `);
  return rows.map(r => r.column_name);
}

function pickExistingColumn(columns, candidates) {
  return candidates.find(name => columns.includes(name)) || null;
}

function inferCategoryFromFechaKey(fechaKey = '') {
  const value = String(fechaKey || '').toLowerCase();
  if (value.includes('tercera')) return 'tercera';
  if (value.includes('segunda')) return 'segunda';
  return null;
}

async function fetchCrucesFromDB(team, fechaKey) {
  const columns = await getFixturesColumns();

  const localCol = pickExistingColumn(columns, [
    'local_slug', 'equipo_local_slug', 'home_slug', 'local'
  ]);

  const visitanteCol = pickExistingColumn(columns, [
    'visitante_slug', 'equipo_visitante_slug', 'away_slug', 'visitante'
  ]);

  const fechaKeyCol = pickExistingColumn(columns, [
    'fecha_key', 'fecha_clave', 'fecha'
  ]);

  const kindCol = pickExistingColumn(columns, ['kind']);
  const categoryCol = pickExistingColumn(columns, ['category']);

  if (!localCol || !visitanteCol) {
    throw new Error('Columnas de local/visitante no encontradas');
  }

  const where = [];
  const params = [];
  let i = 1;

  if (kindCol) {
    where.push(`${kindCol} = $${i++}`);
    params.push('ida');
  }

  const inferredCategory = inferCategoryFromFechaKey(fechaKey);
  if (categoryCol && inferredCategory) {
    where.push(`${categoryCol} = $${i++}`);
    params.push(inferredCategory);
  }

  if (fechaKeyCol) {
    where.push(`${fechaKeyCol} = $${i++}`);
    params.push(fechaKey);
  }

  where.push(`(
    LOWER(TRIM(CAST(${localCol} AS text))) = $${i}
    OR LOWER(TRIM(CAST(${visitanteCol} AS text))) = $${i}
  )`);
  params.push(team);

  const sql = `
    SELECT
      ${localCol} AS local,
      ${visitanteCol} AS visitante
    FROM fixtures
    WHERE ${where.join(' AND ')}
  `;

  const { rows } = await pool.query(sql, params);

  return rows.map(r => ({
    local: r.local,
    visitante: r.visitante
  }));
}

// GET (compatibilidad)
router.get('/cruces', async (req, res) => {
  const team = normalizeSlug(req.query.team);
  const fechaKey = String(req.query.fechaKey || '').trim();

  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros.' });
  }

  try {
    const cruces = await fetchCrucesFromDB(team, fechaKey);
    return res.json({ ok: true, team, fechaKey, cruces });
  } catch (e) {
    console.error('GET /cruces', e);
    return res.status(500).json({ ok: false, error: 'Error obteniendo cruces.' });
  }
});

// POST principal
router.post('/', async (req, res) => {
  const team = normalizeSlug(req.body?.team);
  const fechaKey = String(req.body?.fechaKey || '').trim();

  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros.' });
  }

  try {
    const cruces = await fetchCrucesFromDB(team, fechaKey);
    return res.json({ ok: true, team, fechaKey, cruces });
  } catch (e) {
    console.error('POST /cruces', e);
    return res.status(500).json({ ok: false, error: 'Error obteniendo cruces.' });
  }
});

module.exports = router;
