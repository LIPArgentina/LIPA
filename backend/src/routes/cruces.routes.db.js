const express = require('express');
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
  return {
    ok: true,
    data: {
      fechaISO: row.fecha_iso,
      validated: true,
      localSlug: row.local_slug,
      visitanteSlug: row.visitante_slug,
      localPlanilla: row.datos?.localPlanilla || null,
      visitantePlanilla: row.datos?.visitantePlanilla || null,
      local: row.datos?.local || null,
      visitante: row.datos?.visitante || null,
      localValidated: true,
      visitanteValidated: true,
      localLockedUntil: row.locked_until || null,
      visitanteLockedUntil: row.locked_until || null,
      validatedAt: row.validated_at || null,
    }
  };
}

async function upsertPartial(client, { fechaISO, localSlug, visitanteSlug, equipoSlug, datos, validated = false, validatedAt = null, lockedUntil = null }) {
  const { rows } = await client.query(
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
      ON CONFLICT (fecha_iso, local_slug, visitante_slug, equipo_slug)
      DO UPDATE SET
        datos = EXCLUDED.datos,
        validated = EXCLUDED.validated,
        validated_at = EXCLUDED.validated_at,
        locked_until = EXCLUDED.locked_until,
        updated_at = NOW()
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
  return rows[0];
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
        AND local_slug = $2
        AND visitante_slug = $3
      LIMIT 1
    `,
    [fechaISO, localSlug, visitanteSlug]
  );
  return rows[0] || null;
}

async function upsertFinalValidation(client, { fechaISO, localSlug, visitanteSlug, datos, lockUntil }) {
  const { rows } = await client.query(
    `
      INSERT INTO cruces_validaciones (
        fecha_iso,
        local_slug,
        visitante_slug,
        datos,
        local_equipo_slug,
        visitante_equipo_slug,
        validated_at,
        locked_until
      )
      VALUES ($1::date, $2, $3, $4::jsonb, $5, $6, NOW(), $7::timestamptz)
      ON CONFLICT (fecha_iso, local_slug, visitante_slug)
      DO UPDATE SET
        datos = EXCLUDED.datos,
        validated_at = NOW(),
        locked_until = EXCLUDED.locked_until
      RETURNING *;
    `,
    [
      fechaISO,
      localSlug,
      visitanteSlug,
      JSON.stringify(datos),
      localSlug,
      visitanteSlug,
      lockUntil
    ]
  );
  return rows[0];
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

    if (!mine?.datos) {
      await client.query('COMMIT');
      return res.status(400).json({
        ok: false,
        tipo: 'sin-parcial',
        error: 'Primero tenés que guardar tu carga parcial.'
      });
    }

    if (!rival?.datos) {
      await client.query('COMMIT');
      return res.json({
        ok: true,
        tipo: 'pendiente',
        mensaje: 'PENDIENTE: tu rival todavía no cargó su parcial'
      });
    }

    const coincide = sameTotalsStrict(mine.datos, rival.datos);
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
      datos: mine.datos,
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
let crucesEnabledUntil = null;

router.get('/status', (req, res) => {
  const now = Date.now();
  const enabled = crucesEnabledUntil && crucesEnabledUntil > now;

  res.json({
    enabled,
    remainingMs: enabled ? crucesEnabledUntil - now : 0
  });
});

router.post('/enable', (req, res) => {
  const now = Date.now();
  crucesEnabledUntil = now + (48 * 60 * 60 * 1000);

  res.json({
    ok: true,
    enabled: true,
    remainingMs: crucesEnabledUntil - now
  });
});

router.post('/disable', (req, res) => {
  crucesEnabledUntil = null;
  res.json({
    ok: true,
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

module.exports = router;
