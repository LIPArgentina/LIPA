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
  if (!team || !fechaKey) return res.status(400).json({ ok: false });

  const state = getCrucesEntry(team, fechaKey);
  res.json({ ok: true, enabled: state.enabled });
});

router.post('/enable', (req, res) => {
  const { team, fechaKey } = req.body || {};
  if (!team || !fechaKey) return res.status(400).json({ ok: false });

  const key = normalizeCrucesAdminKey(team, fechaKey);
  crucesEnabledUntilByKey.set(key, Date.now() + (48 * 60 * 60 * 1000));

  res.json({ ok: true, enabled: true });
});

router.post('/disable', (req, res) => {
  const { team, fechaKey } = req.body || {};
  if (!team || !fechaKey) return res.status(400).json({ ok: false });

  const key = normalizeCrucesAdminKey(team, fechaKey);
  crucesEnabledUntilByKey.delete(key);

  res.json({ ok: true, enabled: false });
});

// ===== CRUCES DESDE DB =====

function inferCategoryFromTeamMarker(team = '') {
  const value = String(team || '').trim().toLowerCase();
  if (value === '__categoria_segunda__') return 'segunda';
  if (value === '__categoria_tercera__') return 'tercera';
  return null;
}

function extractCrucesByFecha(data, fechaKey) {
  const fechas = Array.isArray(data?.fechas) ? data.fechas : [];
  const targetFecha = fechas.find(f => String(f?.date || '').slice(0, 10) === String(fechaKey).slice(0, 10));
  if (!targetFecha) return [];

  const tablas = Array.isArray(targetFecha?.tablas) ? targetFecha.tablas : [];
  const cruces = [];

  for (const tabla of tablas) {
    const equipos = tabla?.equipos || [];
    if (equipos.length < 2) continue;

    const local = equipos.find(e => e.categoria === 'local') || equipos[0];
    const visitante = equipos.find(e => e.categoria === 'visitante') || equipos[1];

    if (local?.equipo && visitante?.equipo) {
      cruces.push({ local: local.equipo, visitante: visitante.equipo });
    }
  }

  return cruces;
}

async function fetchCrucesFromDB(team, fechaKey) {
  const category = inferCategoryFromTeamMarker(team);
  if (!category) throw new Error('categoría inválida');

  const { rows } = await pool.query(
    `SELECT data FROM fixtures WHERE kind='ida' AND category=$1 ORDER BY id DESC LIMIT 1`,
    [category]
  );

  if (!rows[0]) return [];
  return extractCrucesByFecha(rows[0].data, fechaKey);
}

router.get('/cruces', async (req, res) => {
  try {
    const cruces = await fetchCrucesFromDB(req.query.team, req.query.fechaKey);
    res.json({ ok: true, cruces });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Error obteniendo cruces.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const cruces = await fetchCrucesFromDB(req.body.team, req.body.fechaKey);
    res.json({ ok: true, cruces });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Error obteniendo cruces.' });
  }
});

module.exports = router;
