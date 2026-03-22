const express = require('express');
const router = express.Router();
const pool = require('../../db');

// ===== ADMIN CRUCES (restaurado) =====
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
    return { enabled: false };
  }

  return { enabled: !!(until && until > now) };
}

router.get('/status', (req, res) => {
  const { team, fechaKey } = req.query;
  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey.' });
  }

  const state = getCrucesEntry(team, fechaKey);
  res.json({ ok: true, enabled: state.enabled });
});

router.post('/enable', (req, res) => {
  const { team, fechaKey } = req.body || {};
  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey.' });
  }

  const key = normalizeCrucesAdminKey(team, fechaKey);
  crucesEnabledUntilByKey.set(key, Date.now() + (48 * 60 * 60 * 1000));

  res.json({ ok: true, enabled: true });
});

router.post('/disable', (req, res) => {
  const { team, fechaKey } = req.body || {};
  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey.' });
  }

  const key = normalizeCrucesAdminKey(team, fechaKey);
  crucesEnabledUntilByKey.delete(key);

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

  if (!normalized.length) {
    return null;
  }

  const todayKey = new Date().toISOString().slice(0, 10);

  const nextFutureOrToday = normalized.find((item) => item.dateKey >= todayKey);
  if (nextFutureOrToday) {
    return nextFutureOrToday.raw;
  }

  return normalized[normalized.length - 1].raw;
}

function extractCrucesFromFecha(fechaNode) {
  const tablas = Array.isArray(fechaNode?.tablas) ? fechaNode.tablas : [];
  const cruces = [];

  for (const tabla of tablas) {
    const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];
    if (equipos.length < 2) continue;

    const local = equipos.find((e) => String(e?.categoria || '').toLowerCase() === 'local') || equipos[0];
    const visitante = equipos.find((e) => String(e?.categoria || '').toLowerCase() === 'visitante') || equipos[1];

    const localName = String(local?.equipo || '').trim();
    const visitanteName = String(visitante?.equipo || '').trim();

    if (!localName || !visitanteName) continue;

    cruces.push({
      local: localName,
      visitante: visitanteName
    });
  }

  return cruces;
}

async function fetchCrucesFromDB(team) {
  const category = inferCategoryFromTeamMarker(team);
  if (!category) {
    throw new Error(`Categoría inválida para team: ${team}`);
  }

  const { rows } = await pool.query(
    `SELECT data FROM fixtures WHERE kind = 'ida' AND category = $1 ORDER BY id DESC LIMIT 1`,
    [category]
  );

  if (!rows[0]?.data) {
    return { cruces: [], fechaFixture: null };
  }

  const fechas = Array.isArray(rows[0].data?.fechas) ? rows[0].data.fechas : [];
  const selectedFecha = pickFixtureFecha(fechas);

  if (!selectedFecha) {
    return { cruces: [], fechaFixture: null };
  }

  return {
    cruces: extractCrucesFromFecha(selectedFecha),
    fechaFixture: normalizeDateOnly(selectedFecha?.date)
  };
}

router.get('/cruces', async (req, res) => {
  const team = String(req.query.team || '').trim();
  const fechaKey = String(req.query.fechaKey || '').trim();

  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey.' });
  }

  try {
    const result = await fetchCrucesFromDB(team);
    return res.json({
      ok: true,
      team,
      fechaKey,
      fechaFixture: result.fechaFixture,
      cruces: result.cruces
    });
  } catch (e) {
    console.error('GET /cruces', e);
    return res.status(500).json({ ok: false, error: 'Error obteniendo cruces.' });
  }
});

router.post('/', async (req, res) => {
  const team = String(req.body?.team || '').trim();
  const fechaKey = String(req.body?.fechaKey || '').trim();

  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey.' });
  }

  try {
    const result = await fetchCrucesFromDB(team);
    return res.json({
      ok: true,
      team,
      fechaKey,
      fechaFixture: result.fechaFixture,
      cruces: result.cruces
    });
  } catch (e) {
    console.error('POST /cruces', e);
    return res.status(500).json({ ok: false, error: 'Error obteniendo cruces.' });
  }
});

module.exports = router;
