const express = require('express');
const router = express.Router();
const pool = require('../../db');

// ===== ADMIN CRUCES (sin fecha) =====
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

// ===== CRUCES DESDE DB =====

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
    const { team, fechaKey, data } = req.body || {};
    if (!team || !fechaKey || data === undefined) {
      return res.status(400).json({ ok: false, error: 'Faltan datos' });
    }

    const result = await pool.query(
      `
      INSERT INTO cruces_validations (team, fecha_key, validacion_json, validated, locked_until, updated_at)
      VALUES ($1, $2, $3::jsonb, true, NOW() + interval '24 hours', NOW())
      ON CONFLICT (team, fecha_key)
      DO UPDATE SET
        validacion_json = EXCLUDED.validacion_json,
        validated = true,
        locked_until = NOW() + interval '24 hours',
        updated_at = NOW()
      RETURNING team, fecha_key, validated, locked_until, updated_at
      `,
      [team, fechaKey, JSON.stringify(data)]
    );

    return res.json({ ok: true, validation: result.rows[0] });
  } catch (err) {
    console.error('POST /validate', err);
    return res.status(500).json({ ok: false, error: 'No se pudo validar el cruce' });
  }
});

router.get('/lock-status', async (req, res) => {
  try {
    const team = String(req.query.team || '').trim();
    const fechaKey = String(req.query.fechaKey || '').trim();

    if (!team || !fechaKey) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey' });
    }

    const result = await pool.query(
      `
      SELECT validated, locked_until, updated_at
      FROM cruces_validations
      WHERE team = $1 AND fecha_key = $2
      LIMIT 1
      `,
      [team, fechaKey]
    );

    if (!result.rows.length) {
      return res.json({ ok: true, locked: false, validated: false, lockedUntil: null });
    }

    const row = result.rows[0];
    const locked = !!row.locked_until && new Date(row.locked_until).getTime() > Date.now();

    return res.json({
      ok: true,
      locked,
      validated: !!row.validated,
      lockedUntil: row.locked_until,
      updatedAt: row.updated_at
    });
  } catch (err) {
    console.error('GET /lock-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo obtener el lock del cruce' });
  }
});

module.exports = router;
