// cruces.routes.db.js
const express = require('express');
const router = express.Router();
const pool = require('../../db');

function normalizeSlug(value = '') {
  return String(value || '').trim().toLowerCase();
}

function sortMatchSlugs(localSlug, visitanteSlug) {
  const a = normalizeSlug(localSlug);
  const b = normalizeSlug(visitanteSlug);
  return { localSlug: a, visitanteSlug: b };
}

function sameTotalsStrict(a, b) {
  return (
    a?.equipo1?.triangulos === b?.equipo1?.triangulos &&
    a?.equipo1?.puntosTotales === b?.equipo1?.puntosTotales &&
    a?.equipo2?.triangulos === b?.equipo2?.triangulos &&
    a?.equipo2?.puntosTotales === b?.equipo2?.puntosTotales
  );
}

async function getOrCreateMatch(client, fechaISO, localSlug, visitanteSlug) {
  const { rows } = await client.query(
    `
      INSERT INTO cruces_matches (fecha_iso, local_slug, visitante_slug)
      VALUES ($1::date, $2, $3)
      ON CONFLICT (fecha_iso, local_slug, visitante_slug)
      DO UPDATE SET updated_at = NOW()
      RETURNING *;
    `,
    [fechaISO, localSlug, visitanteSlug]
  );
  return rows[0];
}

async function getOrCreateSubmission(client, matchId, equipoSlug) {
  const { rows } = await client.query(
    `
      INSERT INTO cruces_match_submissions (match_id, equipo_slug)
      VALUES ($1, $2)
      ON CONFLICT (match_id, equipo_slug)
      DO UPDATE SET updated_at = NOW()
      RETURNING *;
    `,
    [matchId, equipoSlug]
  );
  return rows[0];
}

async function getMatchAndSubmissions(client, fechaISO, localSlug, visitanteSlug) {
  const { rows } = await client.query(
    `
      SELECT
        m.*,
        ls.id AS local_submission_id,
        ls.status_json AS local_status_json,
        ls.validacion_json AS local_validacion_json,
        ls.validated AS local_validated,
        ls.validated_at AS local_validated_at,
        ls.locked_until AS local_locked_until,
        ls.updated_at AS local_updated_at,
        vs.id AS visitante_submission_id,
        vs.status_json AS visitante_status_json,
        vs.validacion_json AS visitante_validacion_json,
        vs.validated AS visitante_validated,
        vs.validated_at AS visitante_validated_at,
        vs.locked_until AS visitante_locked_until,
        vs.updated_at AS visitante_updated_at
      FROM cruces_matches m
      LEFT JOIN cruces_match_submissions ls
        ON ls.match_id = m.id AND ls.equipo_slug = m.local_slug
      LEFT JOIN cruces_match_submissions vs
        ON vs.match_id = m.id AND vs.equipo_slug = m.visitante_slug
      WHERE m.fecha_iso = $1::date
        AND m.local_slug = $2
        AND m.visitante_slug = $3
      LIMIT 1
    `,
    [fechaISO, localSlug, visitanteSlug]
  );
  return rows[0] || null;
}

function buildResponseFromRow(row) {
  const localStatus = row?.local_status_json || null;
  const visitanteStatus = row?.visitante_status_json || null;

  const localUpdatedAt = row?.local_updated_at ? new Date(row.local_updated_at).getTime() : 0;
  const visitanteUpdatedAt = row?.visitante_updated_at ? new Date(row.visitante_updated_at).getTime() : 0;

  const snapshot = localUpdatedAt >= visitanteUpdatedAt
    ? (localStatus || visitanteStatus || {})
    : (visitanteStatus || localStatus || {});

  return {
    ok: true,
    data: {
      fechaISO: row.fecha_iso,
      validated: !!row.validated_final,
      localSlug: row.local_slug,
      visitanteSlug: row.visitante_slug,
      localPlanilla: snapshot.localPlanilla || null,
      visitantePlanilla: snapshot.visitantePlanilla || null,
      local: snapshot.local || null,
      visitante: snapshot.visitante || null,
      localValidated: !!row.local_validated,
      visitanteValidated: !!row.visitante_validated,
      localLockedUntil: row.local_locked_until || null,
      visitanteLockedUntil: row.visitante_locked_until || null
    }
  };
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

    const match = await getOrCreateMatch(client, fechaISO, localSlug, visitanteSlug);
    await getOrCreateSubmission(client, match.id, equipoSlug);

    await client.query(
      `
        UPDATE cruces_match_submissions
        SET
          status_json = $1::jsonb,
          updated_at = NOW()
        WHERE match_id = $2
          AND equipo_slug = $3
      `,
      [JSON.stringify(status), match.id, equipoSlug]
    );

    const row = await getMatchAndSubmissions(client, fechaISO, localSlug, visitanteSlug);

    await client.query('COMMIT');
    return res.json(buildResponseFromRow(row));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /cruces/match-status', error);
    return res.status(500).json({ ok: false, error: 'No se pudo guardar el status del cruce.' });
  } finally {
    client.release();
  }
});

router.get('/match-status', async (req, res) => {
  const fechaISO = req.query.fechaISO;
  const { localSlug, visitanteSlug } = sortMatchSlugs(req.query.localSlug, req.query.visitanteSlug);

  if (!fechaISO || !localSlug || !visitanteSlug) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros.' });
  }

  try {
    const row = await getMatchAndSubmissions(pool, fechaISO, localSlug, visitanteSlug);
    if (!row) {
      return res.json({ ok: true, data: null });
    }
    return res.json(buildResponseFromRow(row));
  } catch (error) {
    console.error('GET /cruces/match-status', error);
    return res.status(500).json({ ok: false, error: 'No se pudo leer el status del cruce.' });
  }
});

router.post('/validate', async (req, res) => {
  const {
    fechaISO,
    localSlug: rawLocalSlug,
    visitanteSlug: rawVisitanteSlug,
    equipoSlug: rawEquipoSlug,
    validacion,
    status
  } = req.body || {};

  const { localSlug, visitanteSlug } = sortMatchSlugs(rawLocalSlug, rawVisitanteSlug);
  const equipoSlug = normalizeSlug(rawEquipoSlug);
  const rivalSlug = equipoSlug === localSlug ? visitanteSlug : localSlug;

  if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug || !validacion) {
    return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios.' });
  }

  if (![localSlug, visitanteSlug].includes(equipoSlug)) {
    return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const match = await getOrCreateMatch(client, fechaISO, localSlug, visitanteSlug);
    await getOrCreateSubmission(client, match.id, equipoSlug);
    await getOrCreateSubmission(client, match.id, rivalSlug);

    await client.query(
      `
        UPDATE cruces_match_submissions
        SET
          status_json = COALESCE($1::jsonb, status_json),
          validacion_json = $2::jsonb,
          validated = TRUE,
          validated_at = NOW(),
          updated_at = NOW()
        WHERE match_id = $3
          AND equipo_slug = $4
      `,
      [status ? JSON.stringify(status) : null, JSON.stringify(validacion), match.id, equipoSlug]
    );

    const { rows: submissions } = await client.query(
      `
        SELECT equipo_slug, validacion_json, validated
        FROM cruces_match_submissions
        WHERE match_id = $1
          AND equipo_slug IN ($2, $3)
      `,
      [match.id, localSlug, visitanteSlug]
    );

    const mine = submissions.find(x => x.equipo_slug === equipoSlug) || null;
    const rival = submissions.find(x => x.equipo_slug === rivalSlug) || null;

    if (!rival?.validated || !rival?.validacion_json) {
      await client.query('COMMIT');
      return res.json({
        ok: true,
        tipo: 'pendiente',
        mensaje: 'PENDIENTE: tu rival todavía no validó'
      });
    }

    const coincide = sameTotalsStrict(mine.validacion_json, rival.validacion_json);
    if (!coincide) {
      await client.query('COMMIT');
      return res.json({
        ok: false,
        tipo: 'mismatch',
        error: 'Los datos no coinciden, verificar con su rival'
      });
    }

    const lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await client.query(
      `
        UPDATE cruces_matches
        SET
          validated_final = TRUE,
          updated_at = NOW()
        WHERE id = $1
      `,
      [match.id]
    );

    await client.query(
      `
        UPDATE cruces_match_submissions
        SET
          locked_until = $1::timestamptz,
          updated_at = NOW()
        WHERE match_id = $2
      `,
      [lockUntil, match.id]
    );

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
    const row = await getMatchAndSubmissions(pool, fechaISO, localSlug, visitanteSlug);
    if (!row) return res.json({ ok: true, locked: false });

    const lockedUntil =
      equipoSlug === localSlug ? row.local_locked_until :
      equipoSlug === visitanteSlug ? row.visitante_locked_until :
      null;

    const locked = !!(lockedUntil && new Date(lockedUntil) > new Date());

    return res.json({
      ok: true,
      locked,
      lockedUntil: lockedUntil || null,
      validatedFinal: !!row.validated_final
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
  const until = now + (48 * 60 * 60 * 1000); // 48 horas
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

  send();
  const timer = setInterval(send, 10000);

  req.on('close', () => {
    clearInterval(timer);
  });
});

module.exports = router;
