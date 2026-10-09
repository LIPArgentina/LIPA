const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { requireAdmin } = require('../middleware/auth');

const EDITABLE_SECTIONS = ['capitan', 'individuales', 'pareja1', 'pareja2', 'suplentes'];

function normalizePlayerKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function fetchPlayerIdentityMap(equipoIds) {
  const ids = (Array.isArray(equipoIds) ? equipoIds : [equipoIds]).map(Number).filter(Number.isFinite);
  const result = await pool.query(
    `
      SELECT DISTINCT j.id, j.nombre, je.orden
      FROM jugador_equipos je
      JOIN jugadores j ON j.id = je.jugador_id
      WHERE je.equipo_id = ANY($1::int[])
        AND je.activo = true
        AND TRIM(COALESCE(j.nombre, '')) <> ''
      ORDER BY je.orden ASC NULLS LAST, j.id ASC
    `,
    [ids]
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

async function enrichPlanillaWithPlayerIds(planilla, equipoId, additionalTeamIds = []) {
  const cleanPlanilla = planilla && typeof planilla === 'object' ? planilla : {};
  const identityMap = await fetchPlayerIdentityMap([equipoId, ...additionalTeamIds]);
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
        first_team.id AS first_team_id,
        first_team.captain AS first_captain,
        first_team.subcaptain AS first_subcaptain,
        p.datos,
        p.updated_at,
        TO_CHAR(
          p.updated_at AT TIME ZONE 'America/Argentina/Buenos_Aires',
          'YYYY-MM-DD HH24:MI'
        ) AS received_at_local
      FROM planillas p
      JOIN equipos e ON e.id = p.equipo_id
      LEFT JOIN LATERAL (
        SELECT e1.id, e1.captain, e1.subcaptain
          FROM equipos e1
         WHERE e.division = 'segunda'
           AND e1.division = 'primera'
           AND LOWER(e1.slug_base) = LOWER(e.slug_base)
         ORDER BY e1.activo DESC, e1.id ASC
         LIMIT 1
      ) first_team ON true
      ORDER BY e.display_name ASC
    `);

    const out = await Promise.all(result.rows.map(async (r) => ({
      team: r.team,
      team_base: r.team_base,
      slug_uid: r.slug_uid,
      teamName: r.display_name,
      division: r.division,
      category: r.division,
      planilla: await enrichPlanillaWithPlayerIds(r.datos, r.equipo_id, r.first_team_id ? [r.first_team_id] : []),
      sourceCaptains: [r.first_captain, r.first_subcaptain].filter(Boolean),
      updatedAt: r.updated_at,
      receivedAtLocal: r.received_at_local
    })));

    res.json(out);
  } catch (err) {
    console.error('Error admin planillas:', err);
    res.status(500).json({ ok: false, error: 'error leyendo planillas' });
  }
});

router.put('/planillas/:team', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const teamRef = String(req.params.team || '').trim().toLowerCase();
    const incoming = req.body?.planilla;
    if (!teamRef || !incoming || typeof incoming !== 'object') {
      return res.status(400).json({ ok: false, error: 'Falta la planilla o el equipo.' });
    }

    await client.query('BEGIN');
    const teamResult = await client.query(
      `SELECT e.id, e.slug_uid, e.slug_base, e.display_name, e.division,
              first_team.id AS first_team_id,
              first_team.captain AS first_captain,
              first_team.subcaptain AS first_subcaptain
         FROM equipos e
         LEFT JOIN LATERAL (
           SELECT e1.id, e1.captain, e1.subcaptain
             FROM equipos e1
            WHERE e.division = 'segunda'
              AND e1.division = 'primera'
              AND LOWER(e1.slug_base) = LOWER(e.slug_base)
            ORDER BY e1.activo DESC, e1.id ASC
            LIMIT 1
         ) first_team ON true
        WHERE LOWER(slug_uid) = $1
           OR LOWER(e.slug_base) = $1
           OR LOWER(e.display_name) = $1
        ORDER BY CASE WHEN LOWER(e.slug_uid) = $1 THEN 0 ELSE 1 END, e.id ASC
        LIMIT 1`,
      [teamRef]
    );
    const team = teamResult.rows[0];
    if (!team) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Equipo no encontrado.' });
    }

    const isSecond = String(team.division || '').toLowerCase() === 'segunda';
    const allowedTeamIds = [team.id, ...(isSecond && team.first_team_id ? [team.first_team_id] : [])];
    const playersResult = await client.query(
      `SELECT j.id, j.nombre, LOWER(je.categoria) AS categoria, je.equipo_id
         FROM jugador_equipos je
         JOIN jugadores j ON j.id = je.jugador_id
        WHERE je.equipo_id = ANY($1::int[])
          AND je.activo = true
          AND TRIM(COALESCE(j.nombre, '')) <> ''
        ORDER BY COALESCE(j.orden, 2147483647), j.nombre ASC, j.id ASC`,
      [allowedTeamIds]
    );
    const playersById = new Map();
    const playersByName = new Map();
    playersResult.rows.forEach((row) => {
      const id = Number(row.id);
      const key = normalizePlayerKey(row.nombre);
      let player = playersById.get(id);
      if (!player) {
        player = { id, nombre:row.nombre, categories:new Set() };
        playersById.set(id, player);
      }
      player.categories.add(String(row.categoria || '').toLowerCase());
      if (key) {
        const namedPlayer = playersByName.get(key);
        if (namedPlayer && namedPlayer !== player) {
          player.categories.forEach(category => namedPlayer.categories.add(category));
        } else {
          playersByName.set(key, player);
        }
      }
    });
    const sourceCaptains = new Set([team.first_captain, team.first_subcaptain].map(normalizePlayerKey).filter(Boolean));
    const cleaned = {};
    const jugadorIds = {};

    for (const section of EDITABLE_SECTIONS) {
      const names = Array.isArray(incoming[section]) ? incoming[section] : [];
      const ids = Array.isArray(incoming?.jugadorIds?.[section]) ? incoming.jugadorIds[section] : [];
      cleaned[section] = [];
      jugadorIds[section] = [];

      for (let index = 0; index < names.length; index += 1) {
        const requestedName = String(names[index] || '').trim();
        const requestedId = Number(ids[index] || 0);
        if (!requestedName && !requestedId) {
          cleaned[section].push('');
          jugadorIds[section].push(null);
          continue;
        }

        let player = playersById.has(requestedId)
          ? playersById.get(requestedId)
          : playersByName.get(normalizePlayerKey(requestedName));
        if (!player && isSecond && section === 'capitan' && sourceCaptains.has(normalizePlayerKey(requestedName))) {
          player = { id:null, nombre:requestedName, categories:new Set(['capitan']) };
        }
        if (!player) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: `El jugador "${requestedName}" no pertenece al plantel activo.` });
        }
        const secondOnly = isSecond && (
          (section === 'individuales' && index >= 2)
          || (section === 'suplentes' && index >= 1)
          || section === 'pareja1'
          || section === 'pareja2'
        );
        if (secondOnly && !player.categories.has('segunda')) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: `El jugador "${requestedName}" no pertenece al plantel de Segunda.` });
        }
        cleaned[section].push(player.nombre);
        jugadorIds[section].push(Number(player.id) || null);
      }
    }

    if (isSecond) {
      const requiredGroups = [
        ['Individuales - Primeras', cleaned.individuales.slice(0, 2)],
        ['Individuales - Segundas', cleaned.individuales.slice(2, 11)],
        ['Suplentes - Primeras', cleaned.suplentes.slice(0, 1)],
        ['Suplentes - Segundas', cleaned.suplentes.slice(1, 3)]
      ];
      const emptyGroup = requiredGroups.find(([, values]) => !values.some(value => normalizePlayerKey(value)));
      if (emptyGroup) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok:false, error:`La tabla ${emptyGroup[0]} no puede quedar completamente vacía.` });
      }
    }

    const assigned = [...cleaned.individuales, ...cleaned.pareja1, ...cleaned.pareja2, ...cleaned.suplentes]
      .map(normalizePlayerKey)
      .filter(Boolean);
    if (new Set(assigned).size !== assigned.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Un jugador no puede ocupar más de un puesto de juego.' });
    }

    const currentResult = await client.query(
      `SELECT id, datos FROM planillas WHERE equipo_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [team.id]
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'El equipo todavía no tiene una planilla guardada.' });
    }

    const savedPlanilla = {
      ...(current.datos && typeof current.datos === 'object' ? current.datos : {}),
      ...cleaned,
      jugadorIds,
      team: team.slug_uid,
      category: team.division
    };
    const updated = await client.query(
      `UPDATE planillas
          SET datos = $2::jsonb, updated_at = NOW()
        WHERE id = $1
        RETURNING updated_at`,
      [current.id, JSON.stringify(savedPlanilla)]
    );
    await client.query('COMMIT');
    return res.json({
      ok: true,
      planilla: savedPlanilla,
      updatedAt: updated.rows[0]?.updated_at || null
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error actualizando planilla desde visor:', err);
    return res.status(500).json({ ok: false, error: 'No se pudo actualizar la planilla.' });
  } finally {
    client.release();
  }
});

module.exports = router;
