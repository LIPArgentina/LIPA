const express = require('express');
const router = express.Router();
const pool = require('../../db');

function normalizePlayerKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function fetchPlayerIdentityMap(equipoId) {
  const result = await pool.query(
    `
      SELECT id, nombre
      FROM jugadores
      WHERE equipo_id = $1
        AND TRIM(COALESCE(nombre, '')) <> ''
      ORDER BY orden ASC, id ASC
    `,
    [equipoId]
  );

  const map = new Map();
  result.rows.forEach((row) => {
    const key = normalizePlayerKey(row.nombre);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(Number(row.id));
  });
  return map;
}

async function enrichPlanillaWithPlayerIds(planilla, equipoId) {
  const cleanPlanilla = planilla && typeof planilla === 'object' ? planilla : {};
  const identityMap = await fetchPlayerIdentityMap(equipoId);
  const used = new Set();
  const sections = ['capitan', 'individuales', 'pareja1', 'pareja2', 'suplentes'];
  const jugadorIds = {};

  sections.forEach((section) => {
    const names = Array.isArray(cleanPlanilla[section]) ? cleanPlanilla[section] : [];
    const existingIds = Array.isArray(cleanPlanilla?.jugadorIds?.[section])
      ? cleanPlanilla.jugadorIds[section]
      : [];

    jugadorIds[section] = names.map((name, index) => {
      const existingId = Number(existingIds[index] || 0);
      if (Number.isFinite(existingId) && existingId > 0) {
        used.add(existingId);
        return existingId;
      }

      const candidates = identityMap.get(normalizePlayerKey(name)) || [];
      const availableId = candidates.find((id) => !used.has(id)) || candidates[0] || null;
      if (availableId) used.add(availableId);
      return availableId;
    });
  });

  return {
    ...cleanPlanilla,
    jugadorIds
  };
}

router.get('/planillas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.id AS equipo_id,
        e.slug_uid AS team,
        e.slug_base AS team_base,
        e.slug_uid,
        e.display_name,
        e.division,
        p.datos,
        p.updated_at,
        TO_CHAR(
          p.updated_at AT TIME ZONE current_setting('TIMEZONE')
            AT TIME ZONE 'America/Argentina/Buenos_Aires',
          'YYYY-MM-DD HH24:MI'
        ) AS received_at_local
      FROM planillas p
      JOIN equipos e ON e.id = p.equipo_id
      ORDER BY e.display_name ASC
    `);

    const out = await Promise.all(result.rows.map(async (r) => ({
      team: r.team,
      team_base: r.team_base,
      slug_uid: r.slug_uid,
      teamName: r.display_name,
      division: r.division,
      category: r.division,
      planilla: await enrichPlanillaWithPlayerIds(r.datos, r.equipo_id),
      updatedAt: r.updated_at,
      receivedAtLocal: r.received_at_local
    })));

    res.json(out);
  } catch (err) {
    console.error('Error admin planillas:', err);
    res.status(500).json({ ok: false, error: 'error leyendo planillas' });
  }
});

module.exports = router;
