const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { requireAdmin } = require('../middleware/auth');

const EDITABLE_SECTIONS = ['capitan', 'individuales', 'pareja1', 'pareja2', 'suplentes'];
const PLANILLA_ACCESS_ACTIONS = new Set(['view', 'edit']);
let accessLogSchemaPromise = null;

function ensureAccessLogSchema() {
  if (!accessLogSchemaPromise) {
    accessLogSchemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS planilla_access_logs (
        id BIGSERIAL PRIMARY KEY,
        planilla_id BIGINT NOT NULL,
        equipo_id BIGINT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('view', 'edit')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS planilla_access_logs_equipo_created_idx
        ON planilla_access_logs(equipo_id, created_at DESC);
    `).catch((error) => {
      accessLogSchemaPromise = null;
      throw error;
    });
  }
  return accessLogSchemaPromise;
}

function maskPlanillaNames(planilla) {
  const source = planilla && typeof planilla === 'object' ? planilla : {};
  const masked = { ...source };
  EDITABLE_SECTIONS.forEach((section) => {
    const values = Array.isArray(source[section]) ? source[section] : [];
    masked[section] = values.map((value) => String(value || '').trim() ? '********' : '');
  });
  delete masked.jugadorIds;
  return masked;
}

function accessEvent(row) {
  if (!row?.access_action || !row?.access_created_at) return null;
  return {
    action: row.access_action,
    at: row.access_created_at
  };
}

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

async function listPlanillas({ masked = false } = {}) {
  if (masked) await ensureAccessLogSchema();
  const auditSelect = masked
    ? `, access_log.action AS access_action, access_log.created_at AS access_created_at`
    : '';
  const auditJoin = masked
    ? `LEFT JOIN LATERAL (
         SELECT pal.action, pal.created_at
           FROM planilla_access_logs pal
          WHERE pal.equipo_id = e.id
          ORDER BY pal.created_at DESC, pal.id DESC
          LIMIT 1
       ) access_log ON true`
    : '';
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
        ${auditSelect}
      FROM planillas p
      JOIN equipos e ON e.id = p.equipo_id
      LEFT JOIN LATERAL (
        SELECT e1.id, e1.captain, e1.subcaptain
          FROM equipos e1
         WHERE e.division = 'segunda'
           AND e1.division = 'primera'
           AND (
             LOWER(e1.slug_base) = LOWER(e.slug_base)
             OR LOWER(e1.display_name) = LOWER(e.display_name)
           )
         ORDER BY CASE WHEN LOWER(e1.slug_base) = LOWER(e.slug_base) THEN 0 ELSE 1 END,
                  e1.activo DESC, e1.id ASC
         LIMIT 1
      ) first_team ON true
      ${auditJoin}
      WHERE e.activo = true
      ORDER BY e.display_name ASC
    `);

  return Promise.all(result.rows.map(async (r) => {
    const planilla = masked
      ? maskPlanillaNames(r.datos)
      : await enrichPlanillaWithPlayerIds(r.datos, r.equipo_id, r.first_team_id ? [r.first_team_id] : []);
    return {
      team: r.team,
      team_base: r.team_base,
      slug_uid: r.slug_uid,
      teamName: r.display_name,
      division: r.division,
      category: r.division,
      planilla,
      sourceCaptains: masked ? [] : [r.first_captain, r.first_subcaptain].filter(Boolean),
      updatedAt: r.updated_at,
      receivedAtLocal: r.received_at_local,
      lastAccess: masked ? accessEvent(r) : null
    };
  }));
}

router.get('/planillas', async (req, res) => {
  try {
    res.json(await listPlanillas());
  } catch (err) {
    console.error('Error admin planillas:', err);
    res.status(500).json({ ok: false, error: 'error leyendo planillas' });
  }
});

router.get('/planillas-secure', requireAdmin, async (req, res) => {
  try {
    return res.json(await listPlanillas({ masked: true }));
  } catch (err) {
    console.error('Error leyendo planillas protegidas:', err);
    return res.status(500).json({ ok: false, error: 'No se pudieron cargar las planillas protegidas.' });
  }
});

router.post('/planillas/:team/access', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const teamRef = String(req.params.team || '').trim().toLowerCase();
    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!teamRef || !PLANILLA_ACCESS_ACTIONS.has(action)) {
      return res.status(400).json({ ok: false, error: 'Solicitud de acceso inválida.' });
    }
    await ensureAccessLogSchema();
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT e.id AS equipo_id, e.slug_uid, e.slug_base, e.display_name, e.division,
              p.id AS planilla_id, p.datos,
              first_team.id AS first_team_id,
              first_team.captain AS first_captain,
              first_team.subcaptain AS first_subcaptain
         FROM equipos e
         JOIN LATERAL (
           SELECT p1.id, p1.datos
             FROM planillas p1
            WHERE p1.equipo_id = e.id
            ORDER BY p1.updated_at DESC, p1.id DESC
            LIMIT 1
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT e1.id, e1.captain, e1.subcaptain
             FROM equipos e1
            WHERE e.division = 'segunda'
              AND e1.division = 'primera'
              AND (LOWER(e1.slug_base) = LOWER(e.slug_base) OR LOWER(e1.display_name) = LOWER(e.display_name))
            ORDER BY CASE WHEN LOWER(e1.slug_base) = LOWER(e.slug_base) THEN 0 ELSE 1 END,
                     e1.activo DESC, e1.id ASC
            LIMIT 1
         ) first_team ON true
        WHERE (LOWER(e.slug_uid) = $1 OR LOWER(e.slug_base) = $1 OR LOWER(e.display_name) = $1)
          AND e.activo = true
        ORDER BY CASE WHEN LOWER(e.slug_uid) = $1 THEN 0 ELSE 1 END, e.id ASC
        LIMIT 1`,
      [teamRef]
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Planilla no encontrada.' });
    }
    const inserted = await client.query(
      `INSERT INTO planilla_access_logs(planilla_id, equipo_id, action)
       VALUES ($1, $2, $3)
       RETURNING action, created_at`,
      [row.planilla_id, row.equipo_id, action]
    );
    await client.query('COMMIT');
    const planilla = await enrichPlanillaWithPlayerIds(
      row.datos,
      row.equipo_id,
      row.first_team_id ? [row.first_team_id] : []
    );
    return res.json({
      ok: true,
      planilla,
      sourceCaptains: [row.first_captain, row.first_subcaptain].filter(Boolean),
      access: {
        action: inserted.rows[0].action,
        at: inserted.rows[0].created_at
      }
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error registrando acceso a planilla:', err);
    return res.status(500).json({ ok: false, error: 'No se pudo registrar el acceso a la planilla.' });
  } finally {
    client.release();
  }
});

router.get('/planillas/:team/access-log', requireAdmin, async (req, res) => {
  try {
    const teamRef = String(req.params.team || '').trim().toLowerCase();
    await ensureAccessLogSchema();
    const result = await pool.query(
      `SELECT pal.action, pal.created_at
         FROM planilla_access_logs pal
         JOIN equipos e ON e.id = pal.equipo_id
        WHERE (LOWER(e.slug_uid) = $1 OR LOWER(e.slug_base) = $1 OR LOWER(e.display_name) = $1)
        ORDER BY pal.created_at DESC, pal.id DESC
        LIMIT 200`,
      [teamRef]
    );
    return res.json({
      ok: true,
      events: result.rows.map((row) => ({ action: row.action, at: row.created_at }))
    });
  } catch (err) {
    console.error('Error leyendo historial de accesos:', err);
    return res.status(500).json({ ok: false, error: 'No se pudo cargar el historial.' });
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
              AND (
                LOWER(e1.slug_base) = LOWER(e.slug_base)
                OR LOWER(e1.display_name) = LOWER(e.display_name)
              )
            ORDER BY CASE WHEN LOWER(e1.slug_base) = LOWER(e.slug_base) THEN 0 ELSE 1 END,
                     e1.activo DESC, e1.id ASC
            LIMIT 1
         ) first_team ON true
        WHERE (
              LOWER(e.slug_uid) = $1
           OR LOWER(e.slug_base) = $1
           OR LOWER(e.display_name) = $1
        )
          AND e.activo = true
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
