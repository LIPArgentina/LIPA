const express = require('express');
const router = express.Router();
const pool = require('../../db');

// ===== CRUCES (GET + POST desde DB JSONB) =====

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
    const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];
    if (equipos.length < 2) continue;

    let local = equipos.find(e => String(e?.categoria || '').toLowerCase() === 'local');
    let visitante = equipos.find(e => String(e?.categoria || '').toLowerCase() === 'visitante');

    if (!local && equipos[0]) local = equipos[0];
    if (!visitante && equipos[1]) visitante = equipos[1];

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

async function fetchCrucesFromDB(team, fechaKey) {
  const category = inferCategoryFromTeamMarker(team);

  if (!category) {
    throw new Error(`Team marker inválido: ${team}`);
  }

  const { rows } = await pool.query(
    `
      SELECT data
      FROM fixtures
      WHERE kind = $1
        AND category = $2
      ORDER BY id DESC
      LIMIT 1
    `,
    ['ida', category]
  );

  if (!rows[0]) return [];

  return extractCrucesByFecha(rows[0].data, fechaKey);
}

// GET /api/cruces/cruces
router.get('/cruces', async (req, res) => {
  const team = String(req.query.team || '').trim();
  const fechaKey = String(req.query.fechaKey || '').trim();

  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey.' });
  }

  try {
    const cruces = await fetchCrucesFromDB(team, fechaKey);
    return res.json({ ok: true, team, fechaKey, cruces });
  } catch (e) {
    console.error('GET /cruces', e);
    return res.status(500).json({ ok: false, error: 'Error obteniendo cruces.' });
  }
});

// POST /api/cruces
router.post('/', async (req, res) => {
  const team = String(req.body?.team || '').trim();
  const fechaKey = String(req.body?.fechaKey || '').trim();

  if (!team || !fechaKey) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros team o fechaKey.' });
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
