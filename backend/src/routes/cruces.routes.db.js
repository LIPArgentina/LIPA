const express = require('express');
const router = express.Router();
const pool = require('../../db');

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

router.post('/', async (req, res) => {
  const team = String(req.body?.team || '').trim();
  if (!team) return res.status(400).json({ error: 'team requerido' });

  try {
    const result = await fetchCrucesFromDB(team);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: 'error cruces' });
  }
});

module.exports = router;
