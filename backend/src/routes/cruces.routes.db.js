const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { requireAdmin } = require('../middleware/auth');



const CATEGORY_KEYS = {
  tercera: '__categoria_tercera__',
  segunda: '__categoria_segunda__'
};

const ARG_TZ_OFFSET = '-03:00';
const CURRENT_EDITION = 6;
const DEFAULT_HISTORIC_EDITION = 5;
let ensureCrucesAdminStoragePromise = null;
let ensureJugadorResultadosEditionPromise = null;
let ensureJugadorResultadosIdentityPromise = null;
let ensureJugadorCurrentCategoryPromise = null;
const RAD_RANKING_CACHE_TTL_MS = 15_000;
const radRankingCache = new Map();
const VALIDATED_CRUCES_CACHE_TTL_MS = 15_000;
const validatedCrucesCache = new Map();

function invalidateValidatedStatsCache() {
  validatedCrucesCache.clear();
  radRankingCache.clear();
}

function invalidateManualCrucesCaches() {
  radRankingCache.clear();
  if (typeof validatedCrucesCache !== 'undefined' && validatedCrucesCache?.clear) {
    validatedCrucesCache.clear();
  }
}

function requireAdminForPrivateCategory(req, res, next) {
  const category = String(req.query.category || '').trim().toLowerCase();
  if (category !== 'segunda') return next();
  return requireAdmin(req, res, next);
}

function normalizeEdition(value, options = {}) {
  const allowTotal = !!options.allowTotal;
  const defaultEdition = options.defaultEdition ?? CURRENT_EDITION;
  const raw = String(value ?? '').trim().toLowerCase();
  if (allowTotal && (raw === 'total' || raw === 'todos' || raw === 'all')) return 'total';
  const num = Number(raw || defaultEdition);
  if (Number.isInteger(num) && num > 0) return num;
  return defaultEdition;
}

function getEditionLabel(edition) {
  if (edition === 'total') return 'TOTAL';
  return `${Number(edition || CURRENT_EDITION)}TA EDICIÓN`;
}

async function getEditionStartDate(edition = CURRENT_EDITION, category = '') {
  const params = [Number(edition)];
  const categoryFilter = category ? 'AND category = $2' : '';
  if (category) params.push(String(category).trim().toLowerCase());
  const { rows } = await pool.query(
    `SELECT data FROM fixtures WHERE edicion = $1 ${categoryFilter}`,
    params
  );
  const dates = [];
  rows.forEach(row => {
    const fechas = Array.isArray(row?.data?.fechas) ? row.data.fechas : [];
    fechas.forEach(fecha => {
      const dateKey = normalizeDateOnly(fecha?.date);
      if (dateKey) dates.push(dateKey);
    });
  });
  return dates.sort()[0] || null;
}

async function inferEditionFromDate(dateValue, category = '') {
  const dateKey = normalizeDateOnly(dateValue);
  const currentEditionStart = await getEditionStartDate(CURRENT_EDITION, category);
  if (dateKey && currentEditionStart && dateKey >= currentEditionStart) return CURRENT_EDITION;
  return DEFAULT_HISTORIC_EDITION;
}

async function filterItemsByEdition(items = [], edition = CURRENT_EDITION, category = '') {
  if (edition === 'total') return items;
  const currentEditionStart = await getEditionStartDate(CURRENT_EDITION, category);
  return items.filter((item) => {
    const dateKey = normalizeDateOnly(item?.fechaISO || item?.fecha_iso || item?.date);
    const itemEdition = dateKey && currentEditionStart && dateKey >= currentEditionStart
      ? CURRENT_EDITION
      : DEFAULT_HISTORIC_EDITION;
    return itemEdition === Number(edition);
  });
}

async function ensureJugadorResultadosEditionColumn() {
  if (!ensureJugadorResultadosEditionPromise) {
    ensureJugadorResultadosEditionPromise = (async () => {
      await pool.query(`ALTER TABLE jugador_resultados ADD COLUMN IF NOT EXISTS edicion INTEGER NOT NULL DEFAULT 5`);
      await pool.query(`UPDATE jugador_resultados SET edicion = 5 WHERE edicion IS NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_jugador_resultados_edicion ON jugador_resultados (edicion)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_jugador_resultados_categoria_edicion ON jugador_resultados (categoria, edicion)`);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_jugador_resultados_match_slot
        ON jugador_resultados (
          categoria,
          edicion,
          fecha_iso,
          modalidad,
          slot,
          equipo_slug,
          rival_slug
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_jugador_resultados_match_pair
        ON jugador_resultados (
          categoria,
          edicion,
          fecha_iso,
          modalidad,
          (COALESCE(pareja_index, slot)),
          equipo_slug,
          rival_slug
        )
      `);
    })().catch((err) => {
      ensureJugadorResultadosEditionPromise = null;
      throw err;
    });
  }
  return ensureJugadorResultadosEditionPromise;
}

async function ensureJugadorResultadosIdentityLinks() {
  if (!ensureJugadorResultadosIdentityPromise) {
    ensureJugadorResultadosIdentityPromise = (async () => {
      await pool.query(`
        WITH unique_players AS (
          SELECT
            LOWER(TRIM(nombre)) AS normalized_name,
            MIN(id)::int AS jugador_id
          FROM jugadores
          WHERE TRIM(COALESCE(nombre, '')) <> ''
          GROUP BY LOWER(TRIM(nombre))
          HAVING COUNT(DISTINCT id) = 1
        ),
        team_players AS (
          SELECT
            jr.id AS resultado_id,
            MIN(j.id)::int AS jugador_id
          FROM jugador_resultados jr
          INNER JOIN jugadores j
            ON LOWER(TRIM(j.nombre)) = LOWER(TRIM(jr.jugador_nombre))
          INNER JOIN jugador_equipos je
            ON je.jugador_id = j.id
           AND LOWER(je.categoria) = LOWER(jr.categoria)
          INNER JOIN equipos e ON e.id = je.equipo_id
          WHERE jr.jugador_id IS NULL
            AND REGEXP_REPLACE(LOWER(jr.equipo_slug), '_(primera|segunda|tercera)$', '') IN (
              REGEXP_REPLACE(LOWER(COALESCE(e.slug_uid, '')), '_(primera|segunda|tercera)$', ''),
              REGEXP_REPLACE(LOWER(COALESCE(e.slug_base, '')), '_(primera|segunda|tercera)$', ''),
              REGEXP_REPLACE(LOWER(COALESCE(e.username, '')), '_(primera|segunda|tercera)$', '')
            )
          GROUP BY jr.id
          HAVING COUNT(DISTINCT j.id) = 1
        ),
        resolved_ids AS (
          SELECT
            jr.id AS resultado_id,
            COALESCE(team_players.jugador_id, unique_players.jugador_id) AS jugador_id
          FROM jugador_resultados jr
          LEFT JOIN team_players ON team_players.resultado_id = jr.id
          LEFT JOIN unique_players
            ON LOWER(TRIM(jr.jugador_nombre)) = unique_players.normalized_name
          WHERE jr.jugador_id IS NULL
            AND COALESCE(team_players.jugador_id, unique_players.jugador_id) IS NOT NULL
        )
        UPDATE jugador_resultados jr
           SET jugador_id = resolved_ids.jugador_id,
               updated_at = NOW()
          FROM resolved_ids
         WHERE jr.id = resolved_ids.resultado_id
      `);
    })().catch((err) => {
      ensureJugadorResultadosIdentityPromise = null;
      throw err;
    });
  }
  return ensureJugadorResultadosIdentityPromise;
}

function normalizeCrucesAdminKey(team) {
  return String(team || '').trim().toLowerCase();
}

async function ensureCrucesAdminStorage() {
  if (!ensureCrucesAdminStoragePromise) {
    ensureCrucesAdminStoragePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cruces_admin_config (
          team TEXT PRIMARY KEY,
          manual_enabled BOOLEAN NOT NULL DEFAULT false,
          automation_enabled BOOLEAN NOT NULL DEFAULT true,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((err) => {
      ensureCrucesAdminStoragePromise = null;
      throw err;
    });
  }
  return ensureCrucesAdminStoragePromise;
}

async function getOrCreateCrucesAdminConfig(team) {
  await ensureCrucesAdminStorage();
  const key = normalizeCrucesAdminKey(team);

  await pool.query(
    `
      INSERT INTO cruces_admin_config (team)
      VALUES ($1)
      ON CONFLICT (team) DO NOTHING
    `,
    [key]
  );

  const { rows } = await pool.query(
    `
      SELECT team, manual_enabled, automation_enabled, updated_at
      FROM cruces_admin_config
      WHERE team = $1
      LIMIT 1
    `,
    [key]
  );

  return rows[0] || {
    team: key,
    manual_enabled: false,
    automation_enabled: true,
    updated_at: null
  };
}

async function updateCrucesAdminConfig(team, patch = {}) {
  const current = await getOrCreateCrucesAdminConfig(team);
  const manualEnabled = typeof patch.manual_enabled === 'boolean'
    ? patch.manual_enabled
    : !!current.manual_enabled;
  const automationEnabled = typeof patch.automation_enabled === 'boolean'
    ? patch.automation_enabled
    : !!current.automation_enabled;

  const { rows } = await pool.query(
    `
      INSERT INTO cruces_admin_config (team, manual_enabled, automation_enabled, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (team)
      DO UPDATE SET
        manual_enabled = EXCLUDED.manual_enabled,
        automation_enabled = EXCLUDED.automation_enabled,
        updated_at = NOW()
      RETURNING team, manual_enabled, automation_enabled, updated_at
    `,
    [normalizeCrucesAdminKey(team), manualEnabled, automationEnabled]
  );

  return rows[0];
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function parseArgDateAt(dateKey, hour = 0, minute = 0, second = 0) {
  return new Date(`${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${ARG_TZ_OFFSET}`);
}

function addDaysToDateKey(dateKey, days) {
  const base = parseArgDateAt(dateKey, 12, 0, 0);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function nowInArgentina() {
  return new Date();
}

function computeFixtureWindow(dateKey) {
  const startKey = addDaysToDateKey(dateKey, -1);
  const nextDayKey = addDaysToDateKey(dateKey, 1);
  return {
    fixtureDate: dateKey,
    scheduledAt: parseArgDateAt(startKey, 20, 0, 0),
    closesAt: parseArgDateAt(nextDayKey, 12, 0, 0)
  };
}

function computeNextAutomation(fixtures = []) {
  const dateKeys = [...new Set(
    fixtures
      .map((item) => String(item?.date || '').slice(0, 10))
      .filter(isDateKey)
  )].sort();

  if (!dateKeys.length) {
    return {
      nextFixtureDate: null,
      scheduledAt: null,
      closesAt: null,
      scheduledEnabled: false,
      remainingMs: 0,
      reason: 'fixture_missing'
    };
  }

  const now = nowInArgentina();

  for (const dateKey of dateKeys) {
    const window = computeFixtureWindow(dateKey);
    if (now < window.closesAt) {
      const scheduledEnabled = now >= window.scheduledAt && now < window.closesAt;
      return {
        nextFixtureDate: dateKey,
        scheduledAt: window.scheduledAt.toISOString(),
        closesAt: window.closesAt.toISOString(),
        scheduledEnabled,
        remainingMs: scheduledEnabled ? Math.max(0, window.closesAt.getTime() - now.getTime()) : 0,
        reason: scheduledEnabled ? 'scheduled_open' : 'scheduled_pending'
      };
    }
  }

  const lastWindow = computeFixtureWindow(dateKeys[dateKeys.length - 1]);
  return {
    nextFixtureDate: dateKeys[dateKeys.length - 1],
    scheduledAt: lastWindow.scheduledAt.toISOString(),
    closesAt: lastWindow.closesAt.toISOString(),
    scheduledEnabled: false,
    remainingMs: 0,
    reason: 'fixture_past'
  };
}


function parseLlavesDateKey(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function collectLlavesAutomationDates(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((item) => collectLlavesAutomationDates(item, out));
    return out;
  }
  if (typeof node !== 'object') return out;

  const possibleDate = node.date || node.fecha || node.fechaISO || node.fechaKey || node.scheduledAt;
  const hasMatchShape = !!(
    node.local || node.visitante || node.localSlug || node.visitanteSlug ||
    node.home || node.away || node.teamA || node.teamB || node.equipoA || node.equipoB ||
    node.player1 || node.player2
  );
  const dateKey = parseLlavesDateKey(possibleDate);
  if (dateKey && hasMatchShape) out.push({ date: dateKey, kind: 'llaves' });

  Object.values(node).forEach((value) => collectLlavesAutomationDates(value, out));
  return out;
}

async function fetchAutomationLlavesInfo(category) {
  if (!category) return [];
  try {
    const { rows } = await pool.query(
      `SELECT data FROM llaves_data WHERE category = $1 AND edicion = $2 LIMIT 1`,
      [category, CURRENT_EDITION]
    );
    return collectLlavesAutomationDates(rows?.[0]?.data || null, []);
  } catch (err) {
    console.warn('No se pudieron cargar fechas de llaves para automatización', { category, err: err?.message });
    return [];
  }
}

async function fetchAutomationFixtureInfo(team) {
  const category = inferCategoryFromTeamMarker(team);
  if (!category) {
    return {
      category: null,
      fixtures: [],
      nextFixtureDate: null,
      scheduledAt: null,
      closesAt: null,
      scheduledEnabled: false,
      remainingMs: 0,
      reason: 'invalid_category'
    };
  }

  const { rows } = await pool.query(
    `
      SELECT kind, data, updated_at, id
      FROM fixtures
      WHERE category = $1 AND edicion = $2
      ORDER BY
        CASE kind WHEN 'ida' THEN 0 WHEN 'vuelta' THEN 1 ELSE 9 END,
        updated_at DESC,
        id DESC
    `,
    [category, CURRENT_EDITION]
  );

  const fixtures = [];
  for (const row of rows) {
    const fechas = Array.isArray(row?.data?.fechas) ? row.data.fechas : [];
    for (const fecha of fechas) {
      const dateKey = String(fecha?.date || '').slice(0, 10);
      if (!isDateKey(dateKey)) continue;
      fixtures.push({ date: dateKey, kind: row.kind });
    }
  }



  const llavesFixtures = await fetchAutomationLlavesInfo(category);
  const automationFixtures = [...fixtures, ...llavesFixtures];
  const automation = computeNextAutomation(automationFixtures);

  return {
    category,
    fixtures: automationFixtures,
    ...automation,
    source: llavesFixtures.some(item => item.date === automation.nextFixtureDate) ? 'llaves' : 'fixture'
  };
}

function planillaHasAssignedPlayers(planilla = {}) {
  const individuales = Array.isArray(planilla?.individuales) ? planilla.individuales : [];
  const suplentes = Array.isArray(planilla?.suplentes) ? planilla.suplentes : [];
  return [...individuales, ...suplentes].some((name) => String(name || '').trim());
}

async function repairDuckHunterPlanillaFromAutomaticOverwrite() {
  const restoredPlanilla = {
    capitan: ['Guillermo Ortega', 'Julian Alcaraz'],
    individuales: [
      'Guillermo Ortega',
      'Eduardo Gomez',
      'Emiliano Rincon',
      'Lucas Gomez',
      'Federico Alcaraz',
      'Gustavo Iraiman',
      'Maximiliano Beñacar',
      'Raggio Norberto Daniel',
      'Diego Moron',
      'Julian Alcaraz',
      'Dylan Gomez'
    ],
    suplentes: ['Gustavo Alcaraz', 'Esteban Rincon'],
    pareja1: [],
    pareja2: [],
    pendingAutomaticGeneration: false,
    generatedAutomatically: false,
    jugadorIds: {
      capitan: [1384, 1388],
      individuales: [1384, 1392, 1389, 1400, 1386, 1394, 1391, 2758, 1395, 1388, 1393],
      suplentes: [1387, 1390],
      pareja1: [],
      pareja2: []
    }
  };

  const { rows } = await pool.query(
    `
      UPDATE planillas p
      SET datos = (p.datos || $1::jsonb) - 'generatedAt', updated_at = NOW()
      FROM equipos e
      WHERE p.equipo_id = e.id
        AND e.slug_uid = 'duckhunter_tercera'
        AND p.estado = 'guardada'
        AND p.datos->>'generatedAt' = '2026-08-05T00:41:09.317Z'
      RETURNING p.id
    `,
    [JSON.stringify(restoredPlanilla)]
  );
  return rows.length > 0;
}

async function repairDuckHunterTemporaryMatchStatus() {
  const capitan = ['Guillermo Ortega', 'Julian Alcaraz'];
  const individuales = [
    'Guillermo Ortega',
    'Eduardo Gomez',
    'Emiliano Rincon',
    'Lucas Gomez',
    'Federico Alcaraz',
    'Gustavo Iraiman',
    'Maximiliano Beñacar',
    'Raggio Norberto Daniel',
    'Diego Moron',
    'Julian Alcaraz',
    'Dylan Gomez'
  ];
  const suplentes = ['Gustavo Alcaraz', 'Esteban Rincon'];
  const jugadorIds = {
    capitan: [1384, 1388],
    individuales: [1384, 1392, 1389, 1400, 1386, 1394, 1391, 2758, 1395, 1388, 1393],
    suplentes: [1387, 1390],
    pareja1: [],
    pareja2: []
  };

  const { rows } = await pool.query(
    `
      UPDATE cruces_match_status
      SET status_json = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  status_json,
                  '{localPlanilla,capitan}', $1::jsonb, true
                ),
                '{localPlanilla,individuales}', $2::jsonb, true
              ),
              '{localPlanilla,suplentes}', $3::jsonb, true
            ),
            '{localPlanilla,jugadorIds}', $4::jsonb, true
          ),
          updated_at = NOW()
      WHERE fecha_iso = DATE '2026-08-04'
        AND status_json->'localPlanilla'->'individuales' @>
            '["Guillermo Ortega", "Federico Alcaraz", "Gustavo Alcaraz"]'::jsonb
        AND status_json->'visitantePlanilla'->'individuales' @> '["Julio Molina"]'::jsonb
      RETURNING local_slug, visitante_slug, equipo_slug
    `,
    [
      JSON.stringify(capitan),
      JSON.stringify(individuales),
      JSON.stringify(suplentes),
      JSON.stringify(jugadorIds)
    ]
  );
  return rows;
}

async function generateEmptyPlanillasForCategory(category) {
  const division = String(category || '').trim().toLowerCase();
  if (!['segunda', 'tercera'].includes(division)) return [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: emptyPlanillas } = await client.query(
      `
        SELECT p.id, p.equipo_id, p.datos, e.slug_uid, e.slug_base
        FROM planillas p
        JOIN equipos e ON e.id = p.equipo_id
        WHERE LOWER(e.division) = $1
          AND COALESCE(e.activo, true) = true
          AND p.estado = 'guardada'
          AND p.id = (
            SELECT latest.id
            FROM planillas latest
            WHERE latest.equipo_id = p.equipo_id
              AND latest.estado = 'guardada'
            ORDER BY latest.updated_at DESC, latest.id DESC
            LIMIT 1
          )
        ORDER BY p.id ASC
        FOR UPDATE OF p
      `,
      [division]
    );

    const generated = [];
    for (const row of emptyPlanillas) {
      if (row.datos?.pendingAutomaticGeneration !== true) continue;
      if (planillaHasAssignedPlayers(row.datos || {}) || row.datos?.generatedAutomatically === true) continue;

      const { rows: players } = await client.query(
        `
          SELECT j.id, TRIM(j.nombre) AS nombre
          FROM jugador_equipos je
          JOIN jugadores j ON j.id = je.jugador_id
          WHERE je.equipo_id = $1
            AND je.activo = true
            AND LOWER(je.categoria) = $2
            AND TRIM(COALESCE(j.nombre, '')) <> ''
          ORDER BY je.orden ASC NULLS LAST, j.orden ASC NULLS LAST, je.id ASC, j.id ASC
          LIMIT 13
        `,
        [row.equipo_id, division]
      );

      const titulares = players.slice(0, 11);
      const suplentes = players.slice(11, 13);
      const generatedAt = new Date().toISOString();
      const current = row.datos && typeof row.datos === 'object' ? row.datos : {};
      const planilla = {
        ...current,
        team: current.team || row.slug_uid || row.slug_base || '',
        category: division,
        categoria: division,
        individuales: titulares.map((player) => player.nombre),
        pareja1: [],
        pareja2: [],
        suplentes: suplentes.map((player) => player.nombre),
        pendingAutomaticGeneration: false,
        generatedAutomatically: true,
        generatedAt,
        jugadorIds: {
          ...(current.jugadorIds || {}),
          individuales: titulares.map((player) => Number(player.id)),
          pareja1: [],
          pareja2: [],
          suplentes: suplentes.map((player) => Number(player.id))
        }
      };

      await client.query(
        `UPDATE planillas SET datos = $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [row.id, JSON.stringify(planilla)]
      );
      generated.push({ planillaId: row.id, equipoId: row.equipo_id, players: players.length });
    }

    await client.query('COMMIT');
    return generated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function buildCrucesAdminStatus(team) {
  await repairDuckHunterPlanillaFromAutomaticOverwrite();
  await repairDuckHunterTemporaryMatchStatus();
  const config = await getOrCreateCrucesAdminConfig(team);
  const automation = await fetchAutomationFixtureInfo(team);
  const manualEnabled = !!config.manual_enabled;
  const automationEnabled = !!config.automation_enabled;
  const scheduledEnabled = automationEnabled && !!automation.scheduledEnabled;
  const enabled = manualEnabled || scheduledEnabled;
  if (enabled && automation.category) {
    await generateEmptyPlanillasForCategory(automation.category);
  }
  const remainingMs = enabled
    ? Math.max(Number(automation.remainingMs || 0), 0)
    : 0;

  return {
    ok: true,
    team: normalizeCrucesAdminKey(team),
    enabled,
    remainingMs,
    manualEnabled,
    automationEnabled,
    automationReason: automation.reason,
    nextFixtureDate: automation.nextFixtureDate,
    scheduledAt: automation.scheduledAt,
    closesAt: automation.closesAt,
    category: automation.category
  };
}

router.get('/status', async (req, res) => {
  try {
    const { team } = req.query;
    if (!team) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
    }

    const state = await buildCrucesAdminStatus(team);
    return res.json(state);
  } catch (err) {
    console.error('GET /api/cruces/status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo obtener el estado de cruces.' });
  }
});

router.post('/enable', requireAdmin, async (req, res) => {
  try {
    const { team } = req.body || {};
    if (!team) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
    }

    await updateCrucesAdminConfig(team, { manual_enabled: true });
    return res.json(await buildCrucesAdminStatus(team));
  } catch (err) {
    console.error('POST /api/cruces/enable', err);
    return res.status(500).json({ ok: false, error: 'No se pudo habilitar cruces.' });
  }
});

router.post('/disable', requireAdmin, async (req, res) => {
  try {
    const { team } = req.body || {};
    if (!team) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro team.' });
    }

    await updateCrucesAdminConfig(team, { manual_enabled: false });
    return res.json(await buildCrucesAdminStatus(team));
  } catch (err) {
    console.error('POST /api/cruces/disable', err);
    return res.status(500).json({ ok: false, error: 'No se pudo deshabilitar cruces.' });
  }
});

router.post('/automation', requireAdmin, async (req, res) => {
  try {
    const { team, enabled } = req.body || {};
    if (!team || typeof enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros team/enabled.' });
    }

    await updateCrucesAdminConfig(team, { automation_enabled: enabled });
    return res.json(await buildCrucesAdminStatus(team));
  } catch (err) {
    console.error('POST /api/cruces/automation', err);
    return res.status(500).json({ ok: false, error: 'No se pudo actualizar la automatización.' });
  }
});

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = () => {
    res.write(`data: ping\n\n`);
  };

  const timer = setInterval(send, 10000);
  send();

  req.on('close', () => {
    clearInterval(timer);
  });
});



function normalizeSlug(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeTeamIdentity(value = '') {
  const compact = normalizeSlug(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/(primera|segunda|tercera|1ra|2da|3ra|3era)$/g, '');

  const aliases = {
    west: 'thewest',
    thewest: 'thewest',
    albapool: 'alba',
    alba: 'alba',
    oldies3ra: 'oldies',
    oldies: 'oldies'
  };

  return aliases[compact] || compact;
}

function slugMatchesTeam(teamSlug, matchSlug) {
  const a = normalizeSlug(teamSlug);
  const b = normalizeSlug(matchSlug);
  return a === b || a.startsWith(`${b}_`) || normalizeTeamIdentity(a) === normalizeTeamIdentity(b);
}


function getAuthorizedTeamSlug(req) {
  const primary = normalizeSlug(req.user?.slug || '');
  const secondary = normalizeSlug(req.user?.slugBase || '');
  return { primary, secondary };
}

function ensureAuthorizedTeam(req, incomingTeamSlug) {
  const incoming = normalizeSlug(incomingTeamSlug);
  const { primary, secondary } = getAuthorizedTeamSlug(req);
  if (!primary) return '';
  if (!incoming) return primary;
  if (incoming === primary || (secondary && incoming === secondary)) return primary;
  return '';
}


function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}



function inferCategoryFromTeamMarker(team = '') {
  const value = String(team || '').trim().toLowerCase();
  if (value === '__categoria_segunda__') return 'segunda';
  if (value === '__categoria_tercera__') return 'tercera';
  return null;
}

function normalizeDateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
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
    "SELECT data FROM fixtures WHERE kind='ida' AND category=$1 AND edicion=$2 ORDER BY id DESC LIMIT 1",
    [category, CURRENT_EDITION]
  );

  const fechas = rows[0]?.data?.fechas || [];
  const fecha = pickFixtureFecha(fechas);

  if (!fecha) return { cruces: [], fechaFixture: null };

  return {
    cruces: extractCrucesFromFecha(fecha),
    fechaFixture: normalizeDateOnly(fecha.date)
  };
}

function resolveTeamKey(equipoSlug, localSlug, visitanteSlug) {
  const equipoNorm = normalizeSlug(equipoSlug);
  if (slugMatchesTeam(equipoNorm, localSlug)) return normalizeSlug(localSlug);
  if (slugMatchesTeam(equipoNorm, visitanteSlug)) return normalizeSlug(visitanteSlug);
  return null;
}

function buildFechaKey(fechaISO, localSlug, visitanteSlug) {
  return `${fechaISO}::${normalizeSlug(localSlug)}::${normalizeSlug(visitanteSlug)}`;
}

function buildTiebreakFechaKey(fechaISO, localSlug, visitanteSlug) {
  return `${buildFechaKey(fechaISO, localSlug, visitanteSlug)}::desempate`;
}

function normalizeTiebreakStatus(status = {}) {
  const localPair = Array.isArray(status?.local?.pareja) ? status.local.pareja : [];
  const visitantePair = Array.isArray(status?.visitante?.pareja) ? status.visitante.pareja : [];
  return {
    tipo: 'desempate',
    fechaISO: normalizeDateOnly(status?.fechaISO || ''),
    localSlug: normalizeSlug(status?.localSlug || ''),
    visitanteSlug: normalizeSlug(status?.visitanteSlug || ''),
    local: {
      pareja: localPair.map(v => String(v || '').trim()).slice(0, 2),
      puntos: Number(status?.local?.puntos || 0)
    },
    visitante: {
      pareja: visitantePair.map(v => String(v || '').trim()).slice(0, 2),
      puntos: Number(status?.visitante?.puntos || 0)
    }
  };
}

function compareTiebreakStatus(a = {}, b = {}) {
  const A = normalizeTiebreakStatus(a);
  const B = normalizeTiebreakStatus(b);
  const diffs = [];
  if (!valuesEqual(A.local.pareja[0], B.local.pareja[0])) diffs.push({ type: 'tiebreak', side: 'local', field: 'pareja1' });
  if (!valuesEqual(A.local.pareja[1], B.local.pareja[1])) diffs.push({ type: 'tiebreak', side: 'local', field: 'pareja2' });
  if (!valuesEqual(A.visitante.pareja[0], B.visitante.pareja[0])) diffs.push({ type: 'tiebreak', side: 'visitante', field: 'pareja1' });
  if (!valuesEqual(A.visitante.pareja[1], B.visitante.pareja[1])) diffs.push({ type: 'tiebreak', side: 'visitante', field: 'pareja2' });
  if (Number(A.local.puntos || 0) !== Number(B.local.puntos || 0)) diffs.push({ type: 'tiebreak', side: 'local', field: 'puntos' });
  if (Number(A.visitante.puntos || 0) !== Number(B.visitante.puntos || 0)) diffs.push({ type: 'tiebreak', side: 'visitante', field: 'puntos' });
  return diffs;
}

function isValidTiebreakScore(localPts, visitantePts) {
  const l = Number(localPts || 0);
  const v = Number(visitantePts || 0);
  return ((l === 5 && v >= 0 && v <= 4) || (v === 5 && l >= 0 && l <= 4));
}

function valuesEqual(a, b) {
  return normalizeText(a) === normalizeText(b);
}

function arrayDiffs(side, section, a = [], b = []) {
  const max = Math.max(a.length, b.length);
  const diffs = [];
  for (let i = 0; i < max; i++) {
    if (!valuesEqual(a[i], b[i])) {
      diffs.push({ type: 'slot', side, section, index: i });
    }
  }
  return diffs;
}

function scoreDiffs(side, arrA = [], arrB = []) {
  const max = Math.max(arrA.length, arrB.length);
  const diffs = [];
  for (let i = 0; i < max; i++) {
    const a = Number(arrA[i] ?? 0);
    const b = Number(arrB[i] ?? 0);
    if (a !== b) {
      diffs.push({ type: 'score', side, scoreIndex: i });
    }
  }
  return diffs;
}

const CURRENT_INDIVIDUAL_COUNT = 11;

function validateCurrentMatchStatus(status = {}) {
  const localScores = Array.isArray(status?.local?.scoreRows) ? status.local.scoreRows.map(Number) : [];
  const visitanteScores = Array.isArray(status?.visitante?.scoreRows) ? status.visitante.scoreRows.map(Number) : [];
  const localPlayers = Array.isArray(status?.localPlanilla?.individuales) ? status.localPlanilla.individuales : [];
  const visitantePlayers = Array.isArray(status?.visitantePlanilla?.individuales) ? status.visitantePlanilla.individuales : [];

  if (localScores.length !== CURRENT_INDIVIDUAL_COUNT || visitanteScores.length !== CURRENT_INDIVIDUAL_COUNT) {
    return `La planilla debe tener exactamente ${CURRENT_INDIVIDUAL_COUNT} partidos individuales.`;
  }
  if (localPlayers.slice(0, CURRENT_INDIVIDUAL_COUNT).some(player => !String(player || '').trim()) ||
      visitantePlayers.slice(0, CURRENT_INDIVIDUAL_COUNT).some(player => !String(player || '').trim()) ||
      localPlayers.length < CURRENT_INDIVIDUAL_COUNT || visitantePlayers.length < CURRENT_INDIVIDUAL_COUNT) {
    return 'Todos los partidos deben tener un jugador de cada equipo.';
  }
  for (let i = 0; i < CURRENT_INDIVIDUAL_COUNT; i++) {
    if (!Number.isFinite(localScores[i]) || !Number.isFinite(visitanteScores[i]) || localScores[i] < 0 || visitanteScores[i] < 0) {
      return `El resultado del partido individual ${i + 1} no es válido.`;
    }
    if (localScores[i] === visitanteScores[i]) {
      return `El partido individual ${i + 1} debe tener un ganador.`;
    }
  }
  const localPoints = localScores.filter((score, index) => score > visitanteScores[index]).length;
  const visitantePoints = visitanteScores.filter((score, index) => score > localScores[index]).length;
  if (localPoints + visitantePoints !== CURRENT_INDIVIDUAL_COUNT) {
    return `La suma de puntos debe ser ${CURRENT_INDIVIDUAL_COUNT}.`;
  }
  if (Number(status?.local?.puntosTotales ?? -1) !== localPoints || Number(status?.visitante?.puntosTotales ?? -1) !== visitantePoints) {
    return 'Los puntos totales no coinciden con los resultados individuales.';
  }
  return '';
}

function validateManualMatchStatus(status = {}, edition = CURRENT_EDITION) {
  if (Number(edition) !== 5) return validateCurrentMatchStatus(status);

  const individualCount = 7;
  const pairCount = 2;
  const expectedScoreRows = individualCount + pairCount;
  const localScores = Array.isArray(status?.local?.scoreRows) ? status.local.scoreRows.map(Number) : [];
  const visitanteScores = Array.isArray(status?.visitante?.scoreRows) ? status.visitante.scoreRows.map(Number) : [];
  const localPlanilla = status?.localPlanilla || {};
  const visitantePlanilla = status?.visitantePlanilla || {};
  const requiredSections = [
    ['individuales', individualCount],
    ['pareja1', 2],
    ['pareja2', 2]
  ];

  if (localScores.length !== expectedScoreRows || visitanteScores.length !== expectedScoreRows) {
    return 'La planilla de 5TA edición debe tener 7 individuales y 2 partidos de parejas.';
  }
  for (const [section, expectedPlayers] of requiredSections) {
    const localPlayers = Array.isArray(localPlanilla?.[section]) ? localPlanilla[section] : [];
    const visitantePlayers = Array.isArray(visitantePlanilla?.[section]) ? visitantePlanilla[section] : [];
    if (localPlayers.length < expectedPlayers || visitantePlayers.length < expectedPlayers ||
        localPlayers.slice(0, expectedPlayers).some(player => !String(player || '').trim()) ||
        visitantePlayers.slice(0, expectedPlayers).some(player => !String(player || '').trim())) {
      return `Faltan jugadores en ${section === 'individuales' ? 'los individuales' : section.replace('pareja', 'la pareja ')}.`;
    }
  }
  for (let index = 0; index < expectedScoreRows; index++) {
    if (!Number.isFinite(localScores[index]) || !Number.isFinite(visitanteScores[index]) ||
        localScores[index] < 0 || visitanteScores[index] < 0) {
      return `El resultado del partido ${index + 1} no es válido.`;
    }
    if (localScores[index] === visitanteScores[index]) {
      return `El partido ${index + 1} debe tener un ganador.`;
    }
  }
  const localPoints = localScores.filter((score, index) => score > visitanteScores[index]).length;
  const visitantePoints = visitanteScores.filter((score, index) => score > localScores[index]).length;
  if (localPoints + visitantePoints !== expectedScoreRows) {
    return `La suma de puntos debe ser ${expectedScoreRows}.`;
  }
  if (Number(status?.local?.puntosTotales ?? -1) !== localPoints ||
      Number(status?.visitante?.puntosTotales ?? -1) !== visitantePoints) {
    return 'Los puntos totales no coinciden con los resultados cargados.';
  }
  return '';
}

function compareFullStatus(mine = {}, rival = {}) {
  const diffs = [];

  const localA = mine?.localPlanilla || {};
  const localB = rival?.localPlanilla || {};
  const visA = mine?.visitantePlanilla || {};
  const visB = rival?.visitantePlanilla || {};

  diffs.push(...arrayDiffs('local', 'CAPITÁN', localA.capitan, localB.capitan));
  diffs.push(...arrayDiffs('local', 'INDIVIDUALES', localA.individuales, localB.individuales));
  diffs.push(...arrayDiffs('local', 'PAREJA 1', localA.pareja1, localB.pareja1));
  diffs.push(...arrayDiffs('local', 'PAREJA 2', localA.pareja2, localB.pareja2));
  diffs.push(...arrayDiffs('local', 'SUPLENTES', localA.suplentes, localB.suplentes));

  diffs.push(...arrayDiffs('visitante', 'CAPITÁN', visA.capitan, visB.capitan));
  diffs.push(...arrayDiffs('visitante', 'INDIVIDUALES', visA.individuales, visB.individuales));
  diffs.push(...arrayDiffs('visitante', 'PAREJA 1', visA.pareja1, visB.pareja1));
  diffs.push(...arrayDiffs('visitante', 'PAREJA 2', visA.pareja2, visB.pareja2));
  diffs.push(...arrayDiffs('visitante', 'SUPLENTES', visA.suplentes, visB.suplentes));

  const localScoreA = Array.isArray(mine?.local?.scoreRows) ? mine.local.scoreRows : [];
  const localScoreB = Array.isArray(rival?.local?.scoreRows) ? rival.local.scoreRows : [];
  const visScoreA = Array.isArray(mine?.visitante?.scoreRows) ? mine.visitante.scoreRows : [];
  const visScoreB = Array.isArray(rival?.visitante?.scoreRows) ? rival.visitante.scoreRows : [];

  diffs.push(...scoreDiffs('local', localScoreA, localScoreB));
  diffs.push(...scoreDiffs('visitante', visScoreA, visScoreB));

  const localTriA = Number(mine?.local?.triangulosTotales ?? mine?.local?.triangulos ?? 0);
  const localTriB = Number(rival?.local?.triangulosTotales ?? rival?.local?.triangulos ?? 0);
  const localPtsA = Number(mine?.local?.puntosTotales ?? 0);
  const localPtsB = Number(rival?.local?.puntosTotales ?? 0);

  const visTriA = Number(mine?.visitante?.triangulosTotales ?? mine?.visitante?.triangulos ?? 0);
  const visTriB = Number(rival?.visitante?.triangulosTotales ?? rival?.visitante?.triangulos ?? 0);
  const visPtsA = Number(mine?.visitante?.puntosTotales ?? 0);
  const visPtsB = Number(rival?.visitante?.puntosTotales ?? 0);

  if (localTriA !== localTriB) diffs.push({ type: 'total', side: 'local', metric: 'triangulos' });
  if (localPtsA !== localPtsB) diffs.push({ type: 'total', side: 'local', metric: 'puntos' });
  if (visTriA !== visTriB) diffs.push({ type: 'total', side: 'visitante', metric: 'triangulos' });
  if (visPtsA !== visPtsB) diffs.push({ type: 'total', side: 'visitante', metric: 'puntos' });

  return diffs;
}

function setNoCache(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
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



router.post('/match-status', async (req, res) => {
  try {
    const {
      localSlug,
      visitanteSlug,
      fechaISO,
      equipoSlug: rawEquipoSlug,
      status
    } = req.body || {};
    const equipoSlug = normalizeSlug(rawEquipoSlug || '');

    if (!localSlug || !visitanteSlug || !fechaISO || !equipoSlug) {
      return res.status(400).json({ ok: false, error: 'Faltan datos' });
    }

    const localKey = normalizeSlug(localSlug);
    const visitanteKey = normalizeSlug(visitanteSlug);
    const equipoKey = normalizeSlug(equipoSlug);

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
      [localKey, visitanteKey, fechaISO, equipoKey, JSON.stringify(status || {})]
    );

    return res.json({ ok: true, saved: result.rows[0] });
  } catch (err) {
    console.error('POST /match-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo guardar el status del cruce' });
  }
});

router.get('/match-status', async (req, res) => {
  setNoCache(res);
  try {
    const localSlug = normalizeSlug(req.query.localSlug || '');
    const visitanteSlug = normalizeSlug(req.query.visitanteSlug || '');
    const fechaISO = String(req.query.fechaISO || '').trim();
    const equipoSlug = normalizeSlug(req.query.equipoSlug || '');

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
    const {
      fechaISO,
      localSlug,
      visitanteSlug,
      equipoSlug: rawEquipoSlug,
      validacion,
      status
    } = req.body || {};
    const equipoSlug = normalizeSlug(rawEquipoSlug || '');

    if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug || !status) {
      return res.status(400).json({ ok: false, error: 'Faltan datos' });
    }

    const statusError = validateCurrentMatchStatus(status);
    if (statusError) {
      return res.status(400).json({ ok: false, error: statusError });
    }

    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) {
      return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
    }

    const rivalKey = teamKey === normalizeSlug(localSlug)
      ? normalizeSlug(visitanteSlug)
      : normalizeSlug(localSlug);

    const fechaKey = buildFechaKey(fechaISO, localSlug, visitanteSlug);

    await pool.query(
      `
      INSERT INTO cruces_validations (
        team,
        fecha_key,
        validacion_json,
        status_json,
        validated,
        locked_until,
        updated_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, true, NULL, NOW())
      ON CONFLICT (team, fecha_key)
      DO UPDATE SET
        validacion_json = EXCLUDED.validacion_json,
        status_json = EXCLUDED.status_json,
        validated = true,
        locked_until = NULL,
        updated_at = NOW()
      `,
      [
        teamKey,
        fechaKey,
        JSON.stringify(validacion || {}),
        JSON.stringify(status || {})
      ]
    );

    const { rows } = await pool.query(
      `
      SELECT team, validacion_json, status_json, validated, locked_until, updated_at
      FROM cruces_validations
      WHERE fecha_key = $1
        AND team IN ($2, $3)
      `,
      [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );

    const mine = rows.find(r => r.team === teamKey) || null;
    const rival = rows.find(r => r.team === rivalKey) || null;

    if (!rival?.validated || !rival?.status_json) {
      return res.json({
        ok: true,
        tipo: 'pendiente',
        mensaje: 'PENDIENTE: tu rival todavía no validó'
      });
    }

    const diff = compareFullStatus(mine?.status_json || {}, rival?.status_json || {});
    if (diff.length) {
      await pool.query(
        `
        UPDATE cruces_validations
        SET locked_until = NULL, updated_at = NOW()
        WHERE fecha_key = $1
          AND team IN ($2, $3)
        `,
        [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
      );

      return res.json({
        ok: false,
        tipo: 'mismatch',
        error: 'Los datos no son correctos, consulte con su rival',
        diff
      });
    }

    const lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await pool.query(
      `
      UPDATE cruces_validations
      SET locked_until = $1::timestamptz, updated_at = NOW()
      WHERE fecha_key = $2
        AND team IN ($3, $4)
      `,
      [lockUntil, fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );

    const mineUpdatedAt = mine?.updated_at ? new Date(mine.updated_at).getTime() : 0;
    const rivalUpdatedAt = rival?.updated_at ? new Date(rival.updated_at).getTime() : 0;
    const validatedSnapshot = mineUpdatedAt >= rivalUpdatedAt
      ? (mine?.status_json || rival?.status_json || {})
      : (rival?.status_json || mine?.status_json || {});

    const fixtureSync = await syncValidatedMatchIntoFixture({
      fechaISO,
      localSlug,
      visitanteSlug,
      snapshot: validatedSnapshot
    });

    const llavesSync = await syncValidatedMatchIntoLlaves({
      fechaISO,
      localSlug,
      visitanteSlug,
      snapshot: validatedSnapshot
    });

    invalidateValidatedStatsCache();

    return res.json({
      ok: true,
      tipo: 'validado',
      mensaje: 'Validación exitosa',
      locked: true,
      validated: true,
      lockedUntil: lockUntil,
      fixtureSync,
      llavesSync
    });
  } catch (err) {
    console.error('POST /validate', err);
    return res.status(500).json({ ok: false, error: 'No se pudo validar el cruce' });
  }
});

router.get('/lock-status', async (req, res) => {
  setNoCache(res);
  try {
    const fechaISO = String(req.query.fechaISO || '').trim();
    const equipoSlug = normalizeSlug(req.query.equipoSlug || '');
    const localSlug = String(req.query.localSlug || '').trim();
    const visitanteSlug = String(req.query.visitanteSlug || '').trim();

    if (!fechaISO || !equipoSlug || !localSlug || !visitanteSlug) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    }

    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) {
      return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
    }

    const rivalKey = teamKey === normalizeSlug(localSlug)
      ? normalizeSlug(visitanteSlug)
      : normalizeSlug(localSlug);

    const fechaKey = buildFechaKey(fechaISO, localSlug, visitanteSlug);

    const { rows } = await pool.query(
      `
      SELECT team, validacion_json, status_json, validated, locked_until, updated_at
      FROM cruces_validations
      WHERE fecha_key = $1
        AND team IN ($2, $3)
      `,
      [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );

    const mine = rows.find(r => r.team === teamKey) || null;
    const rival = rows.find(r => r.team === rivalKey) || null;

    if (!mine?.validated) {
      return res.json({ ok: true, tipo: 'pendiente', locked: false, validated: false, lockedUntil: null });
    }

    if (!rival?.validated || !rival?.status_json) {
      return res.json({
        ok: true,
        tipo: 'pendiente',
        locked: false,
        validated: false,
        mensaje: 'PENDIENTE: tu rival todavía no validó'
      });
    }

    const diff = compareFullStatus(mine?.status_json || {}, rival?.status_json || {});
    if (diff.length) {
      return res.json({
        ok: true,
        tipo: 'mismatch',
        locked: false,
        validated: false,
        error: 'Los datos no son correctos, consulte con su rival',
        diff
      });
    }

    const lockedUntil = mine?.locked_until || rival?.locked_until || null;
    const locked = !!(lockedUntil && new Date(lockedUntil).getTime() > Date.now());

    return res.json({
      ok: true,
      tipo: 'validado',
      locked,
      validated: true,
      lockedUntil: lockedUntil || null,
      mensaje: 'Validación exitosa'
    });
  } catch (err) {
    console.error('GET /lock-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo obtener el lock del cruce' });
  }
});


async function findLlavesSeriesForMatch({ fechaISO, localSlug, visitanteSlug }) {
  const dateKey = normalizeDateOnly(fechaISO);
  const { category, localInfo, visitanteInfo } = await inferCategoryFromMatch(localSlug, visitanteSlug);
  if (!category) return { found: false, reason: 'category_not_found' };

  const localCandidates = buildLlavesTeamCandidates(localInfo, localSlug);
  const visitanteCandidates = buildLlavesTeamCandidates(visitanteInfo, visitanteSlug);
  const edition = await inferEditionFromDate(dateKey, category);
  const { rows } = await pool.query(
    `SELECT data FROM llaves_data WHERE category = $1 AND edicion = $2 LIMIT 1`,
    [category, edition]
  );
  const data = rows[0]?.data && typeof rows[0].data === 'object' ? rows[0].data : null;
  const rounds = Array.isArray(data?.rounds) ? data.rounds : [];

  for (const round of rounds) {
    const legs = Array.isArray(round?.legs) ? round.legs : [];
    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      const leg = legs[legIndex];
      if (!leg || normalizeDateOnly(leg?.date) !== dateKey) continue;
      const homeIsLocal = llavesTeamMatches(leg?.home?.team, localCandidates);
      const awayIsVisitante = llavesTeamMatches(leg?.away?.team, visitanteCandidates);
      const homeIsVisitante = llavesTeamMatches(leg?.home?.team, visitanteCandidates);
      const awayIsLocal = llavesTeamMatches(leg?.away?.team, localCandidates);
      if ((homeIsLocal && awayIsVisitante) || (homeIsVisitante && awayIsLocal)) {
        return { found: true, category, data, round, legs, leg, legIndex, localCandidates, visitanteCandidates, localInfo, visitanteInfo };
      }
    }
  }
  return { found: false, reason: 'match_not_found', category, date: dateKey };
}

function computeLlavesSeriesTie(round) {
  const legs = Array.isArray(round?.legs) ? round.legs : [];
  if (legs.length < 2) return { needsTiebreak: false, reason: 'series_incomplete' };
  const ida = legs[0];
  const vuelta = legs[1];
  if (!legHasAnyScore(ida) || !legHasAnyScore(vuelta)) return { needsTiebreak: false, reason: 'legs_not_played' };
  const teams = [ida?.home?.team, ida?.away?.team, vuelta?.home?.team, vuelta?.away?.team].map(v => normalizeLlavesTeamKey(v || '')).filter(Boolean);
  const uniq = [...new Set(teams)];
  if (uniq.length < 2) return { needsTiebreak: false, reason: 'teams_missing' };
  const totals = Object.fromEntries(uniq.slice(0, 2).map(k => [k, { puntos: 0, triangulos: 0 }]));
  [ida, vuelta].forEach(leg => {
    const h = normalizeLlavesTeamKey(leg?.home?.team || '');
    const a = normalizeLlavesTeamKey(leg?.away?.team || '');
    if (totals[h]) { totals[h].puntos += Number(leg?.home?.puntos || 0); totals[h].triangulos += Number(leg?.home?.puntosExtra || 0); }
    if (totals[a]) { totals[a].puntos += Number(leg?.away?.puntos || 0); totals[a].triangulos += Number(leg?.away?.puntosExtra || 0); }
  });
  const values = Object.values(totals);
  const needsTiebreak = values.length === 2 && values[0].puntos === values[1].puntos && values[0].triangulos === values[1].triangulos;
  return { needsTiebreak, totals };
}

function legHasAnyScore(leg) {
  return [leg?.home?.puntos, leg?.away?.puntos, leg?.home?.puntosExtra, leg?.away?.puntosExtra].some(v => Number(v || 0) > 0);
}

async function getTiebreakRows(fechaISO, localSlug, visitanteSlug) {
  const fechaKey = buildTiebreakFechaKey(fechaISO, localSlug, visitanteSlug);
  const { rows } = await pool.query(
    `SELECT team, status_json, validated, locked_until, updated_at
     FROM cruces_validations
     WHERE fecha_key = $1 AND team IN ($2, $3)`,
    [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
  );
  return { fechaKey, rows };
}

router.get('/series-status', async (req, res) => {
  setNoCache(res);
  try {
    const fechaISO = normalizeDateOnly(req.query.fechaISO || '');
    const localSlug = String(req.query.localSlug || '').trim();
    const visitanteSlug = String(req.query.visitanteSlug || '').trim();
    const equipoSlug = normalizeSlug(req.query.equipoSlug || '');
    if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug) return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });

    const found = await findLlavesSeriesForMatch({ fechaISO, localSlug, visitanteSlug });
    if (!found.found) return res.json({ ok: true, needsTiebreak: false, reason: found.reason || 'not_found' });
    const tie = computeLlavesSeriesTie(found.round);
    const { rows } = await getTiebreakRows(fechaISO, localSlug, visitanteSlug);
    const localKey = normalizeSlug(localSlug);
    const visitanteKey = normalizeSlug(visitanteSlug);
    const mine = rows.find(r => r.team === teamKey) || null;
    const localRow = rows.find(r => r.team === localKey) || null;
    const visitanteRow = rows.find(r => r.team === visitanteKey) || null;
    const bothValidated = !!(localRow?.validated && visitanteRow?.validated && localRow?.status_json && visitanteRow?.status_json);
    const diff = bothValidated ? compareTiebreakStatus(localRow.status_json, visitanteRow.status_json) : [];
    const lockedUntil = localRow?.locked_until || visitanteRow?.locked_until || null;
    const locked = !!(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
    const status = bothValidated && !diff.length ? (localRow.status_json || visitanteRow.status_json) : (mine?.status_json || localRow?.status_json || visitanteRow?.status_json || null);
    return res.json({
      ok: true,
      needsTiebreak: !!tie.needsTiebreak,
      totals: tie.totals || null,
      roundId: found.round?.id || null,
      legIndex: found.legIndex,
      tiebreak: {
        validated: bothValidated && !diff.length,
        locked,
        lockedUntil: lockedUntil || null,
        mineValidated: !!mine?.validated,
        localValidated: !!localRow?.validated,
        visitanteValidated: !!visitanteRow?.validated,
        mismatch: !!diff.length,
        diff,
        status
      }
    });
  } catch (err) {
    console.error('GET /series-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo obtener el estado de la serie' });
  }
});

router.get('/tiebreak-lock-status', async (req, res) => {
  setNoCache(res);
  try {
    const fechaISO = normalizeDateOnly(req.query.fechaISO || '');
    const localSlug = String(req.query.localSlug || '').trim();
    const visitanteSlug = String(req.query.visitanteSlug || '').trim();
    const equipoSlug = normalizeSlug(req.query.equipoSlug || '');
    if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug) return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
    const { rows } = await getTiebreakRows(fechaISO, localSlug, visitanteSlug);
    const localRow = rows.find(r => r.team === normalizeSlug(localSlug)) || null;
    const visitanteRow = rows.find(r => r.team === normalizeSlug(visitanteSlug)) || null;
    const bothValidated = !!(localRow?.validated && visitanteRow?.validated && localRow?.status_json && visitanteRow?.status_json);
    const diff = bothValidated ? compareTiebreakStatus(localRow.status_json, visitanteRow.status_json) : [];
    const lockedUntil = localRow?.locked_until || visitanteRow?.locked_until || null;
    const locked = !!(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
    return res.json({ ok: true, tipo: bothValidated && !diff.length ? 'validado' : 'pendiente', locked, validated: bothValidated && !diff.length, lockedUntil: lockedUntil || null });
  } catch (err) {
    console.error('GET /tiebreak-lock-status', err);
    return res.status(500).json({ ok: false, error: 'No se pudo obtener el estado del desempate' });
  }
});

router.post('/tiebreak-validate', async (req, res) => {
  try {
    const { fechaISO, localSlug, visitanteSlug, equipoSlug: rawEquipoSlug, status } = req.body || {};
    const equipoSlug = normalizeSlug(rawEquipoSlug || '');
    if (!fechaISO || !localSlug || !visitanteSlug || !equipoSlug || !status) return res.status(400).json({ ok: false, error: 'Faltan datos' });
    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) return res.status(400).json({ ok: false, error: 'El equipo no pertenece a este cruce.' });
    const cleanStatus = normalizeTiebreakStatus({ ...status, fechaISO, localSlug, visitanteSlug });
    if (!cleanStatus.local.pareja[0] || !cleanStatus.local.pareja[1] || !cleanStatus.visitante.pareja[0] || !cleanStatus.visitante.pareja[1]) {
      return res.status(400).json({ ok: false, error: 'Faltan jugadores en las parejas del desempate' });
    }
    if (!isValidTiebreakScore(cleanStatus.local.puntos, cleanStatus.visitante.puntos)) {
      return res.status(400).json({ ok: false, error: 'El desempate debe terminar cuando un equipo llega a 5, con el rival entre 0 y 4' });
    }
    const found = await findLlavesSeriesForMatch({ fechaISO, localSlug, visitanteSlug });
    if (!found.found) return res.status(404).json({ ok: false, error: 'No se encontró la serie de llaves para este desempate' });
    const tie = computeLlavesSeriesTie(found.round);
    if (!tie.needsTiebreak) return res.status(400).json({ ok: false, error: 'La serie no requiere desempate' });

    const fechaKey = buildTiebreakFechaKey(fechaISO, localSlug, visitanteSlug);
    await pool.query(
      `INSERT INTO cruces_validations (team, fecha_key, validacion_json, status_json, validated, locked_until, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, true, NULL, NOW())
       ON CONFLICT (team, fecha_key)
       DO UPDATE SET validacion_json = EXCLUDED.validacion_json, status_json = EXCLUDED.status_json, validated = true, locked_until = NULL, updated_at = NOW()`,
      [teamKey, fechaKey, JSON.stringify(cleanStatus), JSON.stringify(cleanStatus)]
    );

    const rivalKey = teamKey === normalizeSlug(localSlug) ? normalizeSlug(visitanteSlug) : normalizeSlug(localSlug);
    const { rows } = await pool.query(
      `SELECT team, status_json, validated, updated_at
       FROM cruces_validations
       WHERE fecha_key = $1 AND team IN ($2, $3)`,
      [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );
    const mine = rows.find(r => r.team === teamKey) || null;
    const rival = rows.find(r => r.team === rivalKey) || null;
    if (!rival?.validated || !rival?.status_json) {
      return res.json({ ok: true, tipo: 'pendiente', mensaje: 'PENDIENTE: tu rival todavía no validó el desempate' });
    }
    const diff = compareTiebreakStatus(mine?.status_json || {}, rival?.status_json || {});
    if (diff.length) return res.json({ ok: false, tipo: 'mismatch', error: 'Los datos del desempate no coinciden con tu rival', diff });

    const lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `UPDATE cruces_validations SET locked_until = $1::timestamptz, updated_at = NOW()
       WHERE fecha_key = $2 AND team IN ($3, $4)`,
      [lockUntil, fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );
    const latest = (new Date(mine.updated_at).getTime() >= new Date(rival.updated_at).getTime()) ? mine.status_json : rival.status_json;
    const llavesSync = await syncTiebreakIntoLlaves({ fechaISO, localSlug, visitanteSlug, snapshot: latest });
    invalidateValidatedStatsCache();
    return res.json({ ok: true, tipo: 'validado', mensaje: 'Desempate validado', locked: true, validated: true, lockedUntil: lockUntil, llavesSync });
  } catch (err) {
    console.error('POST /tiebreak-validate', err);
    return res.status(500).json({ ok: false, error: 'No se pudo validar el desempate' });
  }
});


async function resolveEquipoInfoBySlug(slug, categoryHint = '', dateHint = '') {
  const slugNorm = normalizeSlug(slug);
  if (!slugNorm) return null;
  const dateKey = normalizeDateOnly(dateHint);
  const hasDateHint = /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
  const categoryNorm = String(categoryHint || '').trim().toLowerCase();

  const { rows } = await pool.query(
    `
    SELECT id, slug_uid, slug_base, display_name, division
    FROM equipos
    WHERE ($1::date IS NULL OR created_at::date <= $1::date)
    `,
    [hasDateHint ? dateKey : null]
  );

  const matches = rows.filter((row) => [row.slug_uid, row.slug_base, row.display_name]
    .some((value) => normalizeTeamIdentity(value) === normalizeTeamIdentity(slugNorm)));

  matches.sort((a, b) => {
    const aUidExact = normalizeSlug(a.slug_uid) === slugNorm ? 0 : 1;
    const bUidExact = normalizeSlug(b.slug_uid) === slugNorm ? 0 : 1;
    const aBaseExact = normalizeSlug(a.slug_base) === slugNorm ? 0 : 1;
    const bBaseExact = normalizeSlug(b.slug_base) === slugNorm ? 0 : 1;
    const aCategory = categoryNorm && normalizeSlug(a.division) === categoryNorm ? 0 : 1;
    const bCategory = categoryNorm && normalizeSlug(b.division) === categoryNorm ? 0 : 1;
    return (aCategory - bCategory) || (aUidExact - bUidExact) || (aBaseExact - bBaseExact) || (Number(a.id) - Number(b.id));
  });

  return matches[0] || null;
}

async function resolveEquipoInfosBySlug(slug) {
  const slugNorm = normalizeSlug(slug);
  if (!slugNorm) return [];

  const { rows } = await pool.query(
    `
    SELECT id, slug_uid, slug_base, display_name, division
    FROM equipos
    ORDER BY id ASC
    `
  );

  return rows.filter((row) => [row.slug_uid, row.slug_base, row.display_name]
    .some((value) => normalizeTeamIdentity(value) === normalizeTeamIdentity(slugNorm)));
}


function buildTeamMatchCandidates(teamInfo = null, fallbackSlug = '') {
  const values = [
    teamInfo?.display_name,
    teamInfo?.slug_base,
    teamInfo?.slug_uid,
    fallbackSlug
  ];

  return [...new Set(
    values
      .map((value) => normalizeText(value || ''))
      .filter(Boolean)
  )];
}

function fixtureTeamMatches(item = {}, candidates = []) {
  const equipo = normalizeText(item?.equipo || '');
  return !!equipo && candidates.includes(equipo);
}

async function inferCategoryFromMatch(localSlug, visitanteSlug, categoryHint = '') {
  const [localOptions, visitanteOptions] = await Promise.all([
    resolveEquipoInfosBySlug(localSlug),
    resolveEquipoInfosBySlug(visitanteSlug)
  ]);

  const localDivisions = new Set(
    localOptions.map(item => String(item?.division || '').trim().toLowerCase()).filter(Boolean)
  );
  const commonDivisions = [...new Set(
    visitanteOptions
      .map(item => String(item?.division || '').trim().toLowerCase())
      .filter(division => division && localDivisions.has(division))
  )];

  const normalizedHint = String(categoryHint || '').trim().toLowerCase();
  const category = normalizedHint && commonDivisions.includes(normalizedHint)
    ? normalizedHint
    : (commonDivisions.length === 1 ? commonDivisions[0] : null);
  const localInfo = category
    ? localOptions.find(item => String(item?.division || '').trim().toLowerCase() === category)
    : (localOptions[0] || null);
  const visitanteInfo = category
    ? visitanteOptions.find(item => String(item?.division || '').trim().toLowerCase() === category)
    : (visitanteOptions[0] || null);

  const localDivision = String(localInfo?.division || '').trim().toLowerCase();
  const visitanteDivision = String(visitanteInfo?.division || '').trim().toLowerCase();
  const inferredCategory = category || localDivision || visitanteDivision || null;

  return { category: inferredCategory, localInfo, visitanteInfo };
}

async function syncValidatedMatchIntoFixture({
  fechaISO,
  localSlug,
  visitanteSlug,
  snapshot
}) {
  const dateKey = normalizeDateOnly(fechaISO);
  if (!dateKey || !snapshot) {
    return { updated: false, reason: 'missing_data' };
  }

  const categoryHint = snapshot?.category || snapshot?.categoria || '';
  const { category, localInfo, visitanteInfo } = await inferCategoryFromMatch(
    localSlug,
    visitanteSlug,
    categoryHint
  );
  if (!category) {
    return { updated: false, reason: 'category_not_found' };
  }
  const edition = await inferEditionFromDate(dateKey, category);

  const localCandidates = buildTeamMatchCandidates(localInfo, localSlug);
  const visitanteCandidates = buildTeamMatchCandidates(visitanteInfo, visitanteSlug);

  const localPuntos = Number(snapshot?.local?.puntosTotales ?? 0);
  const localExtra = Number(snapshot?.local?.triangulosTotales ?? snapshot?.local?.triangulos ?? 0);
  const visitantePuntos = Number(snapshot?.visitante?.puntosTotales ?? 0);
  const visitanteExtra = Number(snapshot?.visitante?.triangulosTotales ?? snapshot?.visitante?.triangulos ?? 0);

  const { rows } = await pool.query(
    `
    SELECT id, kind, category, data
    FROM fixtures
    WHERE category = $1 AND edicion = $2
    ORDER BY
      CASE kind WHEN 'ida' THEN 0 WHEN 'vuelta' THEN 1 ELSE 9 END,
      updated_at DESC,
      id DESC
    `,
    [category, edition]
  );

  for (const row of rows) {
    const data = row?.data && typeof row.data === 'object' ? row.data : {};
    const fechas = Array.isArray(data?.fechas) ? data.fechas : [];
    let touched = false;
    let updatedGroup = null;

    for (const fecha of fechas) {
      if (normalizeDateOnly(fecha?.date) !== dateKey) continue;

      const tablas = Array.isArray(fecha?.tablas) ? fecha.tablas : [];
      for (const tabla of tablas) {
        const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];
        for (let i = 0; i < equipos.length - 1; i++) {
          const localItem = equipos[i];
          const visitanteItem = equipos[i + 1];
          const localCategoria = String(localItem?.categoria || '').trim().toLowerCase();
          const visitanteCategoria = String(visitanteItem?.categoria || '').trim().toLowerCase();

          if (localCategoria !== 'local' || visitanteCategoria !== 'visitante') continue;
          if (!fixtureTeamMatches(localItem, localCandidates)) continue;
          if (!fixtureTeamMatches(visitanteItem, visitanteCandidates)) continue;

          localItem.puntos = localPuntos;
          localItem.puntosExtra = localExtra;
          visitanteItem.puntos = visitantePuntos;
          visitanteItem.puntosExtra = visitanteExtra;

          touched = true;
          updatedGroup = tabla?.grupo || null;
          break;
        }
        if (touched) break;
      }
      if (touched) break;
    }

    if (touched) {
      await pool.query(
        `
        UPDATE fixtures
        SET data = $1::jsonb,
            updated_at = NOW()
        WHERE id = $2
        `,
        [JSON.stringify(data), row.id]
      );

      return {
        updated: true,
        fixtureId: row.id,
        kind: row.kind,
        category,
        group: updatedGroup,
        date: dateKey
      };
    }
  }

  return { updated: false, reason: 'match_not_found', category, date: dateKey };
}


function normalizeLlavesTeamKey(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' Y ')
    .replace(/\b(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)\b/gi, ' ')
    .replace(/[^A-Z0-9]/gi, '')
    .replace(/(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)$/i, '')
    .toUpperCase();
}

function buildLlavesTeamCandidates(teamInfo = null, fallbackSlug = '') {
  const values = [
    teamInfo?.display_name,
    teamInfo?.slug_base,
    teamInfo?.slug_uid,
    fallbackSlug
  ];

  return [...new Set(
    values
      .map((value) => normalizeLlavesTeamKey(value || ''))
      .filter(Boolean)
  )];
}

function llavesTeamMatches(teamName, candidates = []) {
  const key = normalizeLlavesTeamKey(teamName || '');
  return !!key && candidates.includes(key);
}


function llavesAutoCleanTeamName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function llavesAutoIsRealTeam(value) {
  const team = llavesAutoCleanTeamName(value);
  return !!team && normalizeLlavesTeamKey(team) !== 'WO';
}

function llavesAutoGetRound(data, id) {
  return (data?.rounds || []).find(round => round?.id === id);
}

function llavesAutoSetLegTeams(round, legIndex, homeTeam, awayTeam) {
  if (!round || !Array.isArray(round.legs) || !round.legs[legIndex]) return;
  round.legs[legIndex].home = round.legs[legIndex].home || {};
  round.legs[legIndex].away = round.legs[legIndex].away || {};
  round.legs[legIndex].home.team = llavesAutoCleanTeamName(homeTeam) || 'WO';
  round.legs[legIndex].away.team = llavesAutoCleanTeamName(awayTeam) || 'WO';
}

function llavesAutoSingleWinner(round) {
  const leg = round?.legs?.[0];
  if (!leg || !llavesAutoIsRealTeam(leg.home?.team) || !llavesAutoIsRealTeam(leg.away?.team) || !legHasAnyScore(leg)) {
    return { winner: 'WO', loser: 'WO', decided: false };
  }

  const hp = Number(leg.home?.puntos || 0);
  const ap = Number(leg.away?.puntos || 0);
  const ht = Number(leg.home?.puntosExtra || 0);
  const at = Number(leg.away?.puntosExtra || 0);

  if (hp > ap) return { winner: leg.home.team, loser: leg.away.team, decided: true };
  if (ap > hp) return { winner: leg.away.team, loser: leg.home.team, decided: true };
  if (ht > at) return { winner: leg.home.team, loser: leg.away.team, decided: true };
  if (at > ht) return { winner: leg.away.team, loser: leg.home.team, decided: true };

  return { winner: 'WO', loser: 'WO', decided: false };
}

function llavesAutoSeriesWinner(round) {
  if (!round || !Array.isArray(round.legs) || !round.legs.length) {
    return { winner: 'WO', loser: 'WO', decided: false, needsExtra: false };
  }

  if (round.legs.length === 1) return llavesAutoSingleWinner(round);

  const ida = round.legs[0];
  const vuelta = round.legs[1];

  if (!ida || !vuelta || !legHasAnyScore(ida) || !legHasAnyScore(vuelta)) {
    return { winner: 'WO', loser: 'WO', decided: false, needsExtra: false };
  }

  const firstTeam = llavesAutoCleanTeamName(vuelta.home?.team || ida.away?.team);
  const secondTeam = llavesAutoCleanTeamName(ida.home?.team || vuelta.away?.team);

  if (!llavesAutoIsRealTeam(firstTeam) || !llavesAutoIsRealTeam(secondTeam)) {
    return { winner: 'WO', loser: 'WO', decided: false, needsExtra: false };
  }

  const acc = {};
  [firstTeam, secondTeam].forEach(team => {
    acc[normalizeLlavesTeamKey(team)] = { team, pts: 0, tri: 0 };
  });

  [ida, vuelta].forEach(leg => {
    const hKey = normalizeLlavesTeamKey(leg.home?.team);
    const aKey = normalizeLlavesTeamKey(leg.away?.team);
    if (acc[hKey]) {
      acc[hKey].pts += Number(leg.home?.puntos || 0);
      acc[hKey].tri += Number(leg.home?.puntosExtra || 0);
    }
    if (acc[aKey]) {
      acc[aKey].pts += Number(leg.away?.puntos || 0);
      acc[aKey].tri += Number(leg.away?.puntosExtra || 0);
    }
  });

  const a = acc[normalizeLlavesTeamKey(firstTeam)];
  const b = acc[normalizeLlavesTeamKey(secondTeam)];

  if (a.pts > b.pts) return { winner: a.team, loser: b.team, decided: true, needsExtra: false };
  if (b.pts > a.pts) return { winner: b.team, loser: a.team, decided: true, needsExtra: false };
  if (a.tri > b.tri) return { winner: a.team, loser: b.team, decided: true, needsExtra: false };
  if (b.tri > a.tri) return { winner: b.team, loser: a.team, decided: true, needsExtra: false };

  const extra = round.legs[2];
  if (extra && legHasAnyScore(extra)) {
    const hp = Number(extra.home?.puntos || 0);
    const ap = Number(extra.away?.puntos || 0);
    const ht = Number(extra.home?.puntosExtra || 0);
    const at = Number(extra.away?.puntosExtra || 0);
    if (hp > ap) return { winner: extra.home.team, loser: extra.away.team, decided: true, needsExtra: false };
    if (ap > hp) return { winner: extra.away.team, loser: extra.home.team, decided: true, needsExtra: false };
    if (ht > at) return { winner: extra.home.team, loser: extra.away.team, decided: true, needsExtra: false };
    if (at > ht) return { winner: extra.away.team, loser: extra.home.team, decided: true, needsExtra: false };
  }

  return { winner: 'WO', loser: 'WO', decided: false, needsExtra: true };
}

function llavesAutoSetSeriesTeams(round, teamA, teamB) {
  if (!round || !Array.isArray(round.legs)) return;

  if (round.legs.length === 1) {
    llavesAutoSetLegTeams(round, 0, teamA, teamB);
    return;
  }


  llavesAutoSetLegTeams(round, 0, teamB, teamA);
  llavesAutoSetLegTeams(round, 1, teamA, teamB);

  if (round.legs[2]) {
    llavesAutoSetLegTeams(round, 2, teamA, teamB);
  }
}

function llavesAutoParseScore(value) {
  const n = parseInt(value ?? 0, 10);
  return Number.isFinite(n) ? n : 0;
}

async function llavesAutoFetchFixtureData(kind, category, edition = CURRENT_EDITION) {
  try {
    const result = await pool.query(
      `SELECT data FROM fixtures WHERE kind = $1 AND category = $2 AND edicion = $3 ORDER BY id DESC LIMIT 1`,
      [kind, category, edition]
    );
    return result.rows[0]?.data || null;
  } catch (err) {
    console.warn('No se pudo cargar fixture para sincronizar llaves', { kind, category, err: err?.message });
    return null;
  }
}

function llavesAutoCollectFixtureEntries(ida, vuelta) {
  const entries = [];
  [
    { kind: 'ida', data: ida },
    { kind: 'vuelta', data: vuelta }
  ].forEach(feed => {
    (feed.data?.fechas || []).forEach((fecha, idx) => {
      entries.push({ kind: feed.kind, fechaIndex: idx + 1, fecha });
    });
  });
  return entries;
}

function llavesAutoIterateGroupMatches(entries, callback) {
  (entries || []).forEach(entry => {
    (entry.fecha?.tablas || []).forEach(tabla => {
      const group = String(tabla?.grupo || '').toUpperCase();
      const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];

      for (let i = 0; i < equipos.length; i += 2) {
        const home = equipos[i];
        const away = equipos[i + 1];
        if (!home || !away) continue;

        const homeName = llavesAutoCleanTeamName(home.equipo);
        const awayName = llavesAutoCleanTeamName(away.equipo);
        if (!homeName || !awayName) continue;
        if (normalizeLlavesTeamKey(homeName) === 'WO' || normalizeLlavesTeamKey(awayName) === 'WO') continue;

        callback({
          group,
          home: {
            team: homeName,
            key: normalizeLlavesTeamKey(homeName),
            puntos: llavesAutoParseScore(home.puntos),
            puntosExtra: llavesAutoParseScore(home.puntosExtra)
          },
          away: {
            team: awayName,
            key: normalizeLlavesTeamKey(awayName),
            puntos: llavesAutoParseScore(away.puntos),
            puntosExtra: llavesAutoParseScore(away.puntosExtra)
          }
        });
      }
    });
  });
}

function llavesAutoGetGroupsForCategory(category, edition) {
  return category === 'segunda' || (category === 'tercera' && Number(edition) >= 6)
    ? ['A', 'B']
    : ['A', 'B', 'C', 'D'];
}

function llavesAutoComputeStandings(category, ida, vuelta, edition) {
  const groups = llavesAutoGetGroupsForCategory(category, edition);
  const entries = llavesAutoCollectFixtureEntries(ida, vuelta);
  const stats = Object.fromEntries(groups.map(g => [g, Object.create(null)]));

  llavesAutoIterateGroupMatches(entries, match => {
    if (!groups.includes(match.group)) return;

    [match.home, match.away].forEach(team => {
      if (!stats[match.group][team.key]) {
        stats[match.group][team.key] = {
          key: team.key,
          equipo: team.team,
          pts: 0,
          tr: 0,
          trContra: 0,
          ju: 0
        };
      }
    });

    const played = (
      match.home.puntos > 0 ||
      match.away.puntos > 0 ||
      match.home.puntosExtra > 0 ||
      match.away.puntosExtra > 0
    );

    stats[match.group][match.home.key].pts += match.home.puntos;
    stats[match.group][match.home.key].tr += match.home.puntosExtra;
    stats[match.group][match.home.key].trContra += match.away.puntosExtra;
    stats[match.group][match.away.key].pts += match.away.puntos;
    stats[match.group][match.away.key].tr += match.away.puntosExtra;
    stats[match.group][match.away.key].trContra += match.home.puntosExtra;

    if (played) {
      stats[match.group][match.home.key].ju += 1;
      stats[match.group][match.away.key].ju += 1;
    }
  });

  const result = {};

  groups.forEach(group => {
    const ordered = Object.values(stats[group]).sort((a, b) =>
      (b.pts - a.pts) ||
      (b.tr - a.tr) ||
      (a.trContra - b.trContra) ||
      String(a.equipo).localeCompare(String(b.equipo), 'es', { sensitivity: 'base' })
    );

    result[group] = ordered.map((row, idx) => ({
      ...row,
      pos: idx + 1
    }));
  });

  return result;
}

function llavesAutoFlattenStandings(standings) {
  const flat = {};
  Object.values(standings || {}).forEach(rows => {
    (rows || []).forEach(row => {
      const key = normalizeLlavesTeamKey(row?.equipo || row?.team || '');
      if (!key) return;
      flat[key] = {
        equipo: row.equipo || row.team || '',
        pts: Number(row.pts || 0),
        tr: Number(row.tr || 0),
        pos: Number(row.pos || 0)
      };
    });
  });
  return flat;
}

function llavesAutoCollectQuarterStats(data) {
  const stats = {};
  ['q1', 'q2', 'q3', 'q4'].forEach(roundId => {
    const round = llavesAutoGetRound(data, roundId);
    const legs = Array.isArray(round?.legs) ? round.legs.slice(0, 2) : [];
    legs.forEach(leg => {
      [
        { team: leg?.home?.team, pts: leg?.home?.puntos, tr: leg?.home?.puntosExtra },
        { team: leg?.away?.team, pts: leg?.away?.puntos, tr: leg?.away?.puntosExtra }
      ].forEach(item => {
        const key = normalizeLlavesTeamKey(item.team || '');
        if (!key || key === 'WO') return;
        if (!stats[key]) stats[key] = { pts: 0, tr: 0 };
        stats[key].pts += Number(item.pts || 0);
        stats[key].tr += Number(item.tr || 0);
      });
    });
  });
  return stats;
}

function llavesAutoStableTieSeed(value) {
  const text = normalizeLlavesTeamKey(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function llavesAutoCompareSportingAdvantage(teamA, teamB, data, standings) {
  const a = llavesAutoCleanTeamName(teamA) || 'WO';
  const b = llavesAutoCleanTeamName(teamB) || 'WO';
  if (!llavesAutoIsRealTeam(a) || !llavesAutoIsRealTeam(b)) return [a, b];

  const aKey = normalizeLlavesTeamKey(a);
  const bKey = normalizeLlavesTeamKey(b);
  const standingStats = llavesAutoFlattenStandings(standings || {});
  const quarterStats = llavesAutoCollectQuarterStats(data);
  const sA = standingStats[aKey] || { pts: 0, tr: 0 };
  const sB = standingStats[bKey] || { pts: 0, tr: 0 };
  const qA = quarterStats[aKey] || { pts: 0, tr: 0 };
  const qB = quarterStats[bKey] || { pts: 0, tr: 0 };

  const checks = [
    [Number(sA.pts || 0), Number(sB.pts || 0)],
    [Number(sA.tr || 0), Number(sB.tr || 0)],
    [Number(qA.pts || 0), Number(qB.pts || 0)],
    [Number(qA.tr || 0), Number(qB.tr || 0)]
  ];

  for (const [va, vb] of checks) {
    if (va > vb) return [a, b];
    if (vb > va) return [b, a];
  }

  return llavesAutoStableTieSeed(a) <= llavesAutoStableTieSeed(b) ? [a, b] : [b, a];
}

function llavesAutoApplyAutomaticAdvance(data, category, standings, edition) {
  if (!data || !Array.isArray(data.rounds)) return data;

  if (category === 'tercera') {
    const q1 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 'q1'));
    const q2 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 'q2'));
    const q3 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 'q3'));
    const q4 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 'q4'));

    const [s1Best, s1Other] = llavesAutoCompareSportingAdvantage(q1.winner, q2.winner, data, standings);
    const [s2Best, s2Other] = llavesAutoCompareSportingAdvantage(q3.winner, q4.winner, data, standings);

    llavesAutoSetSeriesTeams(llavesAutoGetRound(data, 's1'), s1Best, s1Other);
    llavesAutoSetSeriesTeams(llavesAutoGetRound(data, 's2'), s2Best, s2Other);
  }

  const s1 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 's1'));
  const s2 = llavesAutoSeriesWinner(llavesAutoGetRound(data, 's2'));

  llavesAutoSetSeriesTeams(llavesAutoGetRound(data, 'final'), s1.winner, s2.winner);
  llavesAutoSetSeriesTeams(llavesAutoGetRound(data, 'third'), s1.loser, s2.loser);

  return data;
}

async function buildLlavesAutoData(data, category, edition = CURRENT_EDITION) {
  const autoData = JSON.parse(JSON.stringify(data || {}));
  if (!autoData || !Array.isArray(autoData.rounds)) return null;

  const [ida, vuelta] = await Promise.all([
    llavesAutoFetchFixtureData('ida', category, edition),
    llavesAutoFetchFixtureData('vuelta', category, edition)
  ]);
  const standings = llavesAutoComputeStandings(category, ida, vuelta, edition);
  return llavesAutoApplyAutomaticAdvance(autoData, category, standings, edition);
}

function findLlavesLegInData(data, { dateKey, localCandidates, visitanteCandidates }) {
  const rounds = Array.isArray(data?.rounds) ? data.rounds : [];

  for (const round of rounds) {
    const legs = Array.isArray(round?.legs) ? round.legs : [];

    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      const leg = legs[legIndex];
      if (!leg || normalizeDateOnly(leg?.date) !== dateKey) continue;

      const homeIsLocal = llavesTeamMatches(leg?.home?.team, localCandidates);
      const awayIsVisitante = llavesTeamMatches(leg?.away?.team, visitanteCandidates);
      const homeIsVisitante = llavesTeamMatches(leg?.home?.team, visitanteCandidates);
      const awayIsLocal = llavesTeamMatches(leg?.away?.team, localCandidates);

      if (homeIsLocal && awayIsVisitante) {
        return { found: true, roundId: round?.id || null, legIndex, leg, orientation: 'direct' };
      }

      if (homeIsVisitante && awayIsLocal) {
        return { found: true, roundId: round?.id || null, legIndex, leg, orientation: 'swapped' };
      }
    }
  }

  return { found: false };
}

function findLlavesRoundById(data, roundId) {
  return (data?.rounds || []).find(round => round?.id === roundId) || null;
}

async function syncValidatedMatchIntoLlaves({
  fechaISO,
  localSlug,
  visitanteSlug,
  snapshot
}) {
  const dateKey = normalizeDateOnly(fechaISO);
  if (!dateKey || !snapshot) {
    return { updated: false, reason: 'missing_data' };
  }

  const { category, localInfo, visitanteInfo } = await inferCategoryFromMatch(localSlug, visitanteSlug);
  if (!category) {
    return { updated: false, reason: 'category_not_found' };
  }
  const edition = await inferEditionFromDate(dateKey, category);

  const localCandidates = buildLlavesTeamCandidates(localInfo, localSlug);
  const visitanteCandidates = buildLlavesTeamCandidates(visitanteInfo, visitanteSlug);

  const localPuntos = Number(snapshot?.local?.puntosTotales ?? 0);
  const localExtra = Number(snapshot?.local?.triangulosTotales ?? snapshot?.local?.triangulos ?? 0);
  const visitantePuntos = Number(snapshot?.visitante?.puntosTotales ?? 0);
  const visitanteExtra = Number(snapshot?.visitante?.triangulosTotales ?? snapshot?.visitante?.triangulos ?? 0);

  const { rows } = await pool.query(
    `SELECT data FROM llaves_data WHERE category = $1 AND edicion = $2 LIMIT 1`,
    [category, edition]
  );

  const data = rows[0]?.data && typeof rows[0].data === 'object'
    ? rows[0].data
    : null;

  const rounds = Array.isArray(data?.rounds) ? data.rounds : [];
  if (!rounds.length) {
    return { updated: false, reason: 'llaves_missing', category, date: dateKey };
  }

  const localDisplayName = localInfo?.display_name || localInfo?.slug_base || localSlug;
  const visitanteDisplayName = visitanteInfo?.display_name || visitanteInfo?.slug_base || visitanteSlug;

  const persistLlavesSync = async ({ round, legIndex, mode }) => {
    await pool.query(
      `INSERT INTO llaves_data (category, edicion, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (edicion, category)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [category, edition, JSON.stringify(data)]
    );

    return {
      updated: true,
      category,
      roundId: round?.id || null,
      legIndex,
      date: dateKey,
      mode
    };
  };

  const applyLlavesScore = (leg, orientation) => {
    if (!leg.home) leg.home = { team: 'WO', puntos: 0, puntosExtra: 0 };
    if (!leg.away) leg.away = { team: 'WO', puntos: 0, puntosExtra: 0 };

    if (orientation === 'direct') {
      leg.home.puntos = localPuntos;
      leg.home.puntosExtra = localExtra;
      leg.away.puntos = visitantePuntos;
      leg.away.puntosExtra = visitanteExtra;
      return;
    }

    leg.home.puntos = visitantePuntos;
    leg.home.puntosExtra = visitanteExtra;
    leg.away.puntos = localPuntos;
    leg.away.puntosExtra = localExtra;
  };


  for (const round of rounds) {
    const legs = Array.isArray(round?.legs) ? round.legs : [];

    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      const leg = legs[legIndex];
      if (!leg || normalizeDateOnly(leg?.date) !== dateKey) continue;

      const homeIsLocal = llavesTeamMatches(leg?.home?.team, localCandidates);
      const awayIsVisitante = llavesTeamMatches(leg?.away?.team, visitanteCandidates);
      const homeIsVisitante = llavesTeamMatches(leg?.home?.team, visitanteCandidates);
      const awayIsLocal = llavesTeamMatches(leg?.away?.team, localCandidates);

      if (homeIsLocal && awayIsVisitante) {
        applyLlavesScore(leg, 'direct');
        return persistLlavesSync({ round, legIndex, mode: 'exact' });
      }

      if (homeIsVisitante && awayIsLocal) {
        applyLlavesScore(leg, 'swapped');
        return persistLlavesSync({ round, legIndex, mode: 'exact_swapped' });
      }
    }
  }





  const autoData = await buildLlavesAutoData(data, category, edition);
  const autoFound = findLlavesLegInData(autoData, { dateKey, localCandidates, visitanteCandidates });

  if (autoFound.found && autoFound.roundId) {
    const round = findLlavesRoundById(data, autoFound.roundId);
    const legs = Array.isArray(round?.legs) ? round.legs : [];
    const leg = legs[autoFound.legIndex];

    if (round && leg) {
      if (!leg.home) leg.home = { team: 'WO', puntos: 0, puntosExtra: 0 };
      if (!leg.away) leg.away = { team: 'WO', puntos: 0, puntosExtra: 0 };



      leg.home.team = autoFound.leg?.home?.team || leg.home.team || 'WO';
      leg.away.team = autoFound.leg?.away?.team || leg.away.team || 'WO';
      applyLlavesScore(leg, autoFound.orientation || 'direct');
      return persistLlavesSync({ round, legIndex: autoFound.legIndex, mode: 'auto_exact' });
    }
  }



  const fallbackCandidates = [];

  for (const round of rounds) {
    const legs = Array.isArray(round?.legs) ? round.legs : [];

    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      const leg = legs[legIndex];
      if (!leg || normalizeDateOnly(leg?.date) !== dateKey) continue;
      if (legIndex >= 2) continue;
      if (legHasAnyScore(leg)) continue;

      const homeKey = normalizeLlavesTeamKey(leg?.home?.team || '');
      const awayKey = normalizeLlavesTeamKey(leg?.away?.team || '');
      const homeIsReal = !!homeKey && homeKey !== 'WO';
      const awayIsReal = !!awayKey && awayKey !== 'WO';


      if (homeIsReal && awayIsReal) continue;

      const homeIsLocal = llavesTeamMatches(leg?.home?.team, localCandidates);
      const awayIsVisitante = llavesTeamMatches(leg?.away?.team, visitanteCandidates);
      const homeIsVisitante = llavesTeamMatches(leg?.home?.team, visitanteCandidates);
      const awayIsLocal = llavesTeamMatches(leg?.away?.team, localCandidates);

      let orientation = null;
      if (homeIsLocal || awayIsVisitante) orientation = 'direct';
      if (homeIsVisitante || awayIsLocal) orientation = 'swapped';
      if (!homeIsReal && !awayIsReal) orientation = 'direct';

      if (orientation) {
        fallbackCandidates.push({ round, legIndex, leg, orientation });
      }
    }
  }

  if (fallbackCandidates.length === 1) {
    const candidate = fallbackCandidates[0];
    const { round, legIndex, leg, orientation } = candidate;

    if (!leg.home) leg.home = { team: 'WO', puntos: 0, puntosExtra: 0 };
    if (!leg.away) leg.away = { team: 'WO', puntos: 0, puntosExtra: 0 };

    if (orientation === 'swapped') {
      leg.home.team = visitanteDisplayName;
      leg.away.team = localDisplayName;
      applyLlavesScore(leg, 'swapped');
      return persistLlavesSync({ round, legIndex, mode: 'single_date_fallback_swapped' });
    }

    leg.home.team = localDisplayName;
    leg.away.team = visitanteDisplayName;
    applyLlavesScore(leg, 'direct');
    return persistLlavesSync({ round, legIndex, mode: 'single_date_fallback' });
  }

  if (fallbackCandidates.length > 1) {
    return {
      updated: false,
      reason: 'ambiguous_date_fallback',
      category,
      date: dateKey,
      candidates: fallbackCandidates.map(item => ({
        roundId: item.round?.id || null,
        legIndex: item.legIndex
      }))
    };
  }

  return { updated: false, reason: 'match_not_found', category, date: dateKey };
}


async function syncTiebreakIntoLlaves({ fechaISO, localSlug, visitanteSlug, snapshot }) {
  const dateKey = normalizeDateOnly(fechaISO);
  if (!dateKey || !snapshot) return { updated: false, reason: 'missing_data' };
  const found = await findLlavesSeriesForMatch({ fechaISO, localSlug, visitanteSlug });
  if (!found.found) return { updated: false, reason: found.reason || 'match_not_found' };

  const round = found.round;
  const legs = Array.isArray(round.legs) ? round.legs : (round.legs = []);
  while (legs.length < 3) {
    legs.push({ date: dateKey, home: { team: 'WO', puntos: 0, puntosExtra: 0 }, away: { team: 'WO', puntos: 0, puntosExtra: 0 } });
  }

  const extra = legs[2];
  extra.date = extra.date || dateKey;
  const localPts = Number(snapshot?.local?.puntos || 0);
  const visitantePts = Number(snapshot?.visitante?.puntos || 0);
  const localPair = Array.isArray(snapshot?.local?.pareja) ? snapshot.local.pareja : [];
  const visitantePair = Array.isArray(snapshot?.visitante?.pareja) ? snapshot.visitante.pareja : [];

  const homeIsLocal = llavesTeamMatches(extra?.home?.team, found.localCandidates);
  const awayIsVisitante = llavesTeamMatches(extra?.away?.team, found.visitanteCandidates);
  const homeIsVisitante = llavesTeamMatches(extra?.home?.team, found.visitanteCandidates);
  const awayIsLocal = llavesTeamMatches(extra?.away?.team, found.localCandidates);

  if (!(homeIsLocal && awayIsVisitante) && !(homeIsVisitante && awayIsLocal)) {

    extra.home.team = found.legs?.[1]?.home?.team || found.leg?.home?.team || localSlug;
    extra.away.team = found.legs?.[1]?.away?.team || found.leg?.away?.team || visitanteSlug;
  }

  if (llavesTeamMatches(extra.home.team, found.localCandidates)) {
    extra.home.puntos = localPts;
    extra.home.puntosExtra = 0;
    extra.home.pareja = localPair;
    extra.away.puntos = visitantePts;
    extra.away.puntosExtra = 0;
    extra.away.pareja = visitantePair;
  } else {
    extra.home.puntos = visitantePts;
    extra.home.puntosExtra = 0;
    extra.home.pareja = visitantePair;
    extra.away.puntos = localPts;
    extra.away.puntosExtra = 0;
    extra.away.pareja = localPair;
  }

  await pool.query(
    `INSERT INTO llaves_data (category, edicion, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     ON CONFLICT (edicion, category)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [found.category, await inferEditionFromDate(dateKey, found.category), JSON.stringify(found.data)]
  );

  return { updated: true, category: found.category, roundId: round?.id || null, legIndex: 2, date: dateKey };
}

router.get('/results', async (req, res) => {
  setNoCache(res);
  try {
    const fechaISO = normalizeDateOnly(req.query.fechaISO || req.query.date || '');
    const category = String(req.query.category || '').trim().toLowerCase();

    if (!fechaISO) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro fechaISO.' });
    }

    const { rows } = await pool.query(
      `
      SELECT fecha_key, team, status_json, validated, updated_at
      FROM cruces_validations
      WHERE split_part(fecha_key, '::', 1) = $1
      ORDER BY updated_at DESC
      `,
      [fechaISO]
    );

    const grouped = new Map();
    for (const row of rows) {
      const key = String(row.fecha_key || '');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }

    const teamCache = new Map();
    const resolveCached = async (slug) => {
      const key = `${String(category || '').toLowerCase()}::${normalizeSlug(slug)}`;
      if (teamCache.has(key)) return teamCache.get(key);
      const info = await resolveEquipoInfoBySlug(slug, category);
      teamCache.set(key, info);
      return info;
    };

    const results = [];

    for (const [fechaKey, entries] of grouped.entries()) {
      const parts = String(fechaKey).split('::');
      const matchDate = parts[0] || fechaISO;
      const localSlug = normalizeSlug(parts[1] || '');
      const visitanteSlug = normalizeSlug(parts[2] || '');
      const isTiebreakResult = String(parts[3] || '').trim().toLowerCase() === 'desempate';

      if (!localSlug || !visitanteSlug) continue;

      const localEntry = entries.find((row) => normalizeSlug(row.team) === localSlug) || null;
      const visitanteEntry = entries.find((row) => normalizeSlug(row.team) === visitanteSlug) || null;

      if (!localEntry || !visitanteEntry) continue;
      if (!localEntry.validated || !visitanteEntry.validated) continue;

      const diff = isTiebreakResult
        ? compareTiebreakStatus(localEntry.status_json || {}, visitanteEntry.status_json || {})
        : compareFullStatus(localEntry.status_json || {}, visitanteEntry.status_json || {});
      if (diff.length) continue;

      const [localInfo, visitanteInfo] = await Promise.all([
        resolveCached(localSlug),
        resolveCached(visitanteSlug)
      ]);

      if (category) {
        const localDivision = String(localInfo?.division || '').trim().toLowerCase();
        const visitanteDivision = String(visitanteInfo?.division || '').trim().toLowerCase();
        const hasKnownDivision = !!(localDivision || visitanteDivision);

        if (hasKnownDivision && (localDivision !== category || visitanteDivision !== category)) {
          continue;
        }
      }

      const localUpdatedAt = localEntry?.updated_at ? new Date(localEntry.updated_at).getTime() : 0;
      const visitanteUpdatedAt = visitanteEntry?.updated_at ? new Date(visitanteEntry.updated_at).getTime() : 0;
      const snapshot = localUpdatedAt >= visitanteUpdatedAt
        ? (localEntry.status_json || visitanteEntry.status_json || {})
        : (visitanteEntry.status_json || localEntry.status_json || {});

      const localStatus = snapshot?.local || {};
      const visitanteStatus = snapshot?.visitante || {};

      if (isTiebreakResult) {
        const cleanTiebreak = normalizeTiebreakStatus(snapshot || {});
        results.push({
          tipo: 'desempate',
          fechaISO: matchDate,
          category: category || localInfo?.division || visitanteInfo?.division || null,
          localSlug,
          visitanteSlug,
          localName: localInfo?.display_name || localSlug,
          visitanteName: visitanteInfo?.display_name || visitanteSlug,
          local: {
            pareja: Array.isArray(cleanTiebreak.local?.pareja) ? cleanTiebreak.local.pareja : [],
            puntos: Number(cleanTiebreak.local?.puntos || 0)
          },
          visitante: {
            pareja: Array.isArray(cleanTiebreak.visitante?.pareja) ? cleanTiebreak.visitante.pareja : [],
            puntos: Number(cleanTiebreak.visitante?.puntos || 0)
          },
          updatedAt: localEntry?.updated_at || visitanteEntry?.updated_at || null,
          validated: true
        });
        continue;
      }

      results.push({
        tipo: 'cruce',
        fechaISO: matchDate,
        category: category || localInfo?.division || visitanteInfo?.division || null,
        localSlug,
        visitanteSlug,
        localName: localInfo?.display_name || localSlug,
        visitanteName: visitanteInfo?.display_name || visitanteSlug,
        localPlanilla: snapshot?.localPlanilla || null,
        visitantePlanilla: snapshot?.visitantePlanilla || null,
        local: {
          scoreRows: Array.isArray(localStatus?.scoreRows) ? localStatus.scoreRows : [],
          triangulosTotales: Number(localStatus?.triangulosTotales ?? localStatus?.triangulos ?? 0),
          puntosTotales: Number(localStatus?.puntosTotales ?? 0)
        },
        visitante: {
          scoreRows: Array.isArray(visitanteStatus?.scoreRows) ? visitanteStatus.scoreRows : [],
          triangulosTotales: Number(visitanteStatus?.triangulosTotales ?? visitanteStatus?.triangulos ?? 0),
          puntosTotales: Number(visitanteStatus?.puntosTotales ?? 0)
        },
        updatedAt: localEntry?.updated_at || visitanteEntry?.updated_at || null,
        validated: true
      });
    }

    results.sort((a, b) => {
      const byDate = String(a.fechaISO || '').localeCompare(String(b.fechaISO || ''));
      if (byDate !== 0) return byDate;
      const byLocal = String(a.localName || '').localeCompare(String(b.localName || ''));
      if (byLocal !== 0) return byLocal;
      return String(a.visitanteName || '').localeCompare(String(b.visitanteName || ''));
    });

    return res.json({
      ok: true,
      fechaISO,
      category: category || null,
      total: results.length,
      results
    });
  } catch (err) {
    console.error('GET /results', err);
    return res.status(500).json({ ok: false, error: 'No se pudieron obtener los resultados validados.' });
  }
});

function fixtureHasScheduledMatch(rows = [], { fechaISO, localSlug, visitanteSlug } = {}) {
  const dateKey = normalizeDateOnly(fechaISO);
  const localKey = normalizeTeamIdentity(localSlug);
  const visitanteKey = normalizeTeamIdentity(visitanteSlug);
  if (!dateKey || !localKey || !visitanteKey) return false;

  return rows.some((row) => {
    const fechas = Array.isArray(row?.data?.fechas) ? row.data.fechas : [];
    return fechas.some((fecha) => {
      if (normalizeDateOnly(fecha?.date) !== dateKey) return false;
      const tablas = Array.isArray(fecha?.tablas) ? fecha.tablas : [];
      return tablas.some((tabla) => {
        const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];
        for (let index = 0; index < equipos.length - 1; index += 2) {
          const local = equipos[index];
          const visitante = equipos[index + 1];
          if (String(local?.categoria || '').toLowerCase() !== 'local') continue;
          if (String(visitante?.categoria || '').toLowerCase() !== 'visitante') continue;
          if (normalizeTeamIdentity(local?.equipo) !== localKey) continue;
          if (normalizeTeamIdentity(visitante?.equipo) !== visitanteKey) continue;
          return true;
        }
        return false;
      });
    });
  });
}

router.post('/manual-save', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    const category = String(req.body?.category || '').trim().toLowerCase();
    const edition = normalizeEdition(req.body?.edition, { defaultEdition: CURRENT_EDITION });
    const status = req.body?.status || {};
    const fechaISO = normalizeDateOnly(status?.fechaISO || '');
    const localSlug = normalizeSlug(status?.localSlug || '');
    const visitanteSlug = normalizeSlug(status?.visitanteSlug || '');

    if (!['primera', 'segunda', 'tercera'].includes(category)) {
      return res.status(400).json({ ok: false, error: 'Categoría inválida.' });
    }
    if (!fechaISO || !localSlug || !visitanteSlug || localSlug === visitanteSlug) {
      return res.status(400).json({ ok: false, error: 'El cruce seleccionado no es válido.' });
    }

    const statusError = validateManualMatchStatus(status, edition);
    if (statusError) {
      return res.status(400).json({ ok: false, error: statusError });
    }

    const fixtureResult = await client.query(
      `SELECT kind, data
       FROM fixtures
       WHERE category = $1 AND edicion = $2 AND kind IN ('ida', 'vuelta')`,
      [category, edition]
    );
    if (!fixtureHasScheduledMatch(fixtureResult.rows, { fechaISO, localSlug, visitanteSlug })) {
      return res.status(400).json({
        ok: false,
        error: 'Ese partido no existe en el fixture de la categoría, edición y fecha seleccionadas.'
      });
    }

    const normalizedStatus = {
      ...status,
      category,
      categoria: category,
      fechaISO,
      localSlug,
      visitanteSlug,
      validated: true
    };
    const validacion = {
      fechaISO,
      localSlug,
      visitanteSlug,
      local: {
        scoreRows: normalizedStatus?.local?.scoreRows || [],
        triangulos: Number(normalizedStatus?.local?.triangulosTotales || 0),
        puntosTotales: Number(normalizedStatus?.local?.puntosTotales || 0)
      },
      visitante: {
        scoreRows: normalizedStatus?.visitante?.scoreRows || [],
        triangulos: Number(normalizedStatus?.visitante?.triangulosTotales || 0),
        puntosTotales: Number(normalizedStatus?.visitante?.puntosTotales || 0)
      },
      localPlanilla: normalizedStatus.localPlanilla,
      visitantePlanilla: normalizedStatus.visitantePlanilla
    };
    const fechaKey = buildFechaKey(fechaISO, localSlug, visitanteSlug);
    const lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const statusJson = JSON.stringify(normalizedStatus);
    const validationJson = JSON.stringify(validacion);

    await client.query('BEGIN');
    transactionOpen = true;

    for (const team of [localSlug, visitanteSlug]) {
      await client.query(
        `INSERT INTO cruces_match_status (
           local_slug, visitante_slug, fecha_iso, equipo_slug, status_json, updated_at
         ) VALUES ($1, $2, $3::date, $4, $5::jsonb, NOW())
         ON CONFLICT (local_slug, visitante_slug, fecha_iso, equipo_slug)
         DO UPDATE SET status_json = EXCLUDED.status_json, updated_at = NOW()`,
        [localSlug, visitanteSlug, fechaISO, team, statusJson]
      );

      await client.query(
        `INSERT INTO cruces_validations (
           team, fecha_key, validacion_json, status_json, validated, locked_until, updated_at
         ) VALUES ($1, $2, $3::jsonb, $4::jsonb, true, $5::timestamptz, NOW())
         ON CONFLICT (team, fecha_key)
         DO UPDATE SET
           validacion_json = EXCLUDED.validacion_json,
           status_json = EXCLUDED.status_json,
           validated = true,
           locked_until = EXCLUDED.locked_until,
           updated_at = NOW()`,
        [team, fechaKey, validationJson, statusJson, lockUntil]
      );
    }

    await client.query('COMMIT');
    transactionOpen = false;

    const syncResults = await Promise.allSettled([
      syncValidatedMatchIntoFixture({ fechaISO, localSlug, visitanteSlug, snapshot: normalizedStatus }),
      syncValidatedMatchIntoLlaves({ fechaISO, localSlug, visitanteSlug, snapshot: normalizedStatus })
    ]);
    const fixtureSync = syncResults[0].status === 'fulfilled'
      ? syncResults[0].value
      : { updated: false, reason: 'sync_error' };
    const llavesSync = syncResults[1].status === 'fulfilled'
      ? syncResults[1].value
      : { updated: false, reason: 'sync_error' };
    const warnings = syncResults
      .filter((result) => result.status === 'rejected')
      .map((result) => String(result.reason?.message || result.reason || 'Error de sincronización'));
    invalidateManualCrucesCaches();

    return res.json({
      ok: true,
      saved: true,
      updated: true,
      fechaISO,
      category,
      edition,
      localSlug,
      visitanteSlug,
      fixtureSync,
      llavesSync,
      warnings
    });
  } catch (err) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    console.error('POST /manual-save', err);
    return res.status(500).json({ ok: false, error: 'No se pudo guardar el cruce manual.' });
  } finally {
    client.release();
  }
});

function includesNormalizedName(name, query) {
  const a = normalizeText(name || '');
  const q = normalizeText(query || '');
  return !!q && a.includes(q);
}

function sameNormalizedName(a, b) {
  return normalizeText(a || '') === normalizeText(b || '');
}

function canonicalPlayerTeamSlug(value = "") {
  return normalizeSlug(value)
    .replace(/_(primera|segunda|tercera)$/i, "")
    .replace(/-(primera|segunda|tercera)$/i, "");
}

function samePlayerTeamSlug(a, b) {
  const aa = normalizeSlug(a);
  const bb = normalizeSlug(b);
  if (!aa || !bb) return false;
  return aa === bb || canonicalPlayerTeamSlug(aa) === canonicalPlayerTeamSlug(bb) || slugMatchesTeam(aa, bb);
}

function getPlanillaPlayerId(planilla = {}, section = '', index = 0) {
  const raw = planilla?.jugadorIds?.[section]?.[index];
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function getPlanillaPlayerRefs(planilla = {}, section = '') {
  return Array.isArray(planilla?.[section])
    ? planilla[section].map((name, index) => ({
        id: getPlanillaPlayerId(planilla, section, index),
        name: String(name || '').trim()
      }))
    : [];
}

function getIndividualPlayerRefs(planilla = {}) {
  return getPlanillaPlayerRefs(planilla, 'individuales');
}

function getIndividualPlayers(planilla = {}) {
  return getIndividualPlayerRefs(planilla).map((player) => player.name);
}

function uniquePlayerNames(names = []) {
  const seen = new Set();
  const out = [];
  names.forEach((name) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const key = normalizeText(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function getPairPlayers(planilla = {}, pairIndex = 0) {
  const key = pairIndex === 0 ? 'pareja1' : 'pareja2';
  return getPlanillaPlayerRefs(planilla, key).map((player) => player.name);
}

function getPairPlayerRefs(planilla = {}, pairIndex = 0) {
  const key = pairIndex === 0 ? 'pareja1' : 'pareja2';
  return getPlanillaPlayerRefs(planilla, key);
}

function getSearchablePlayers(planilla = {}) {
  return uniquePlayerNames([
    ...getIndividualPlayers(planilla),
    ...getPairPlayers(planilla, 0),
    ...getPairPlayers(planilla, 1)
  ]);
}

function getSearchablePlayerRefs(planilla = {}) {
  const seen = new Set();
  const out = [];
  [
    ...getIndividualPlayerRefs(planilla),
    ...getPairPlayerRefs(planilla, 0),
    ...getPairPlayerRefs(planilla, 1)
  ].forEach((player) => {
    const name = String(player?.name || '').trim();
    if (!name) return;
    const id = Number(player?.id || 0) || null;
    const key = id ? `id:${id}` : `name:${normalizeText(name)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, name });
  });
  return out;
}

function getPairScore(scoreRows = [], planilla = {}, pairIndex = 0) {
  const scoreIndex = 7 + pairIndex;
  const fromScoreRows = Array.isArray(scoreRows) ? scoreRows[scoreIndex] : undefined;
  if (fromScoreRows !== undefined && fromScoreRows !== null && fromScoreRows !== '') {
    return Number(fromScoreRows) || 0;
  }

  const ptsKey = pairIndex === 0 ? 'pareja1Pts' : 'pareja2Pts';
  const fromPlanilla = Array.isArray(planilla?.[ptsKey]) ? planilla[ptsKey][0] : undefined;
  return Number(fromPlanilla ?? 0) || 0;
}

async function buildAllValidatedCrucesForPlayerQueryUncached(category = '') {
  const [{ rows }, { rows: teamRows }, { rows: fixtureRows }, { rows: historicMatchRows }] = await Promise.all([
    pool.query(
      `
      SELECT fecha_key, team, status_json, validated, updated_at
      FROM cruces_validations
      ORDER BY updated_at DESC
      `
    ),
    pool.query(
      `
      SELECT id, slug_uid, slug_base, display_name, division, created_at
      FROM equipos
      ORDER BY id ASC
      `
    ),
    category
      ? pool.query(`SELECT data FROM fixtures WHERE category = $1`, [String(category).trim().toLowerCase()])
      : Promise.resolve({ rows: [] }),
    category
      ? pool.query(
          `SELECT DISTINCT fecha_key FROM jugador_resultados WHERE categoria = $1`,
          [String(category).trim().toLowerCase()]
        )
      : Promise.resolve({ rows: [] })
  ]);

  const categoryMatchKeys = new Set();
  for (const fixtureRow of fixtureRows) {
    const fechas = Array.isArray(fixtureRow?.data?.fechas) ? fixtureRow.data.fechas : [];
    for (const fecha of fechas) {
      const dateKey = normalizeDateOnly(fecha?.date);
      const tablas = Array.isArray(fecha?.tablas) ? fecha.tablas : [];
      for (const tabla of tablas) {
        const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];
        for (let index = 0; index + 1 < equipos.length; index += 2) {
          const pair = [
            normalizeTeamIdentity(equipos[index]?.equipo),
            normalizeTeamIdentity(equipos[index + 1]?.equipo)
          ].filter(Boolean).sort();
          if (dateKey && pair.length === 2) categoryMatchKeys.add(`${dateKey}::${pair.join('::')}`);
        }
      }
    }
  }
  for (const historicRow of historicMatchRows) {
    const parts = String(historicRow?.fecha_key || '').split('::');
    const dateKey = normalizeDateOnly(parts[0]);
    const pair = [normalizeTeamIdentity(parts[1]), normalizeTeamIdentity(parts[2])]
      .filter(Boolean)
      .sort();
    if (dateKey && pair.length === 2) categoryMatchKeys.add(`${dateKey}::${pair.join('::')}`);
  }

  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.fecha_key || '');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const teamCache = new Map();
  const resolveCached = (slug, dateHint = '') => {
    const key = `${String(category || '').toLowerCase()}::${normalizeDateOnly(dateHint)}::${normalizeSlug(slug)}`;
    if (teamCache.has(key)) return teamCache.get(key);
    const slugNorm = normalizeSlug(slug);
    const dateKey = normalizeDateOnly(dateHint);
    const categoryNorm = String(category || '').trim().toLowerCase();
    const matches = teamRows.filter((row) => {
      if (dateKey && row.created_at && normalizeDateOnly(row.created_at) > dateKey) return false;
      return [row.slug_uid, row.slug_base, row.display_name]
        .some((value) => normalizeTeamIdentity(value) === normalizeTeamIdentity(slugNorm));
    });
    matches.sort((a, b) => {
      const aUidExact = normalizeSlug(a.slug_uid) === slugNorm ? 0 : 1;
      const bUidExact = normalizeSlug(b.slug_uid) === slugNorm ? 0 : 1;
      const aBaseExact = normalizeSlug(a.slug_base) === slugNorm ? 0 : 1;
      const bBaseExact = normalizeSlug(b.slug_base) === slugNorm ? 0 : 1;
      const aCategory = categoryNorm && normalizeSlug(a.division) === categoryNorm ? 0 : 1;
      const bCategory = categoryNorm && normalizeSlug(b.division) === categoryNorm ? 0 : 1;
      return (aCategory - bCategory) || (aUidExact - bUidExact) || (aBaseExact - bBaseExact) || (Number(a.id) - Number(b.id));
    });
    const info = matches[0] || null;
    teamCache.set(key, info);
    return info;
  };

  const results = [];

  for (const [fechaKey, entries] of grouped.entries()) {
    const parts = String(fechaKey).split('::');
    const matchDate = parts[0] || '';
    const localSlug = normalizeSlug(parts[1] || '');
    const visitanteSlug = normalizeSlug(parts[2] || '');

    if (!localSlug || !visitanteSlug) continue;
    if (category && categoryMatchKeys.size) {
      const pair = [normalizeTeamIdentity(localSlug), normalizeTeamIdentity(visitanteSlug)].sort();
      if (!categoryMatchKeys.has(`${matchDate}::${pair.join('::')}`)) continue;
    }

    const localEntry = entries.find((row) => normalizeSlug(row.team) === localSlug) || null;
    const visitanteEntry = entries.find((row) => normalizeSlug(row.team) === visitanteSlug) || null;

    if (!localEntry || !visitanteEntry) continue;
    if (!localEntry.validated || !visitanteEntry.validated) continue;

    const diff = compareFullStatus(localEntry.status_json || {}, visitanteEntry.status_json || {});
    if (diff.length) continue;

    const localInfo = resolveCached(localSlug, matchDate);
    const visitanteInfo = resolveCached(visitanteSlug, matchDate);

    if (category) {
      const localDivision = String(localInfo?.division || '').trim().toLowerCase();
      const visitanteDivision = String(visitanteInfo?.division || '').trim().toLowerCase();
      const hasKnownDivision = !!(localDivision || visitanteDivision);

      if (hasKnownDivision && (localDivision !== category || visitanteDivision !== category)) {
        continue;
      }
    }

    const localUpdatedAt = localEntry?.updated_at ? new Date(localEntry.updated_at).getTime() : 0;
    const visitanteUpdatedAt = visitanteEntry?.updated_at ? new Date(visitanteEntry.updated_at).getTime() : 0;
    const snapshot = localUpdatedAt >= visitanteUpdatedAt
      ? (localEntry.status_json || visitanteEntry.status_json || {})
      : (visitanteEntry.status_json || localEntry.status_json || {});

    const localStatus = snapshot?.local || {};
    const visitanteStatus = snapshot?.visitante || {};

    results.push({
      fechaISO: matchDate,
      category: category || localInfo?.division || visitanteInfo?.division || null,
      localSlug,
      visitanteSlug,
      localName: localInfo?.display_name || localSlug,
      visitanteName: visitanteInfo?.display_name || visitanteSlug,
      localPlanilla: snapshot?.localPlanilla || null,
      visitantePlanilla: snapshot?.visitantePlanilla || null,
      local: {
        scoreRows: Array.isArray(localStatus?.scoreRows) ? localStatus.scoreRows : [],
        triangulosTotales: Number(localStatus?.triangulosTotales ?? localStatus?.triangulos ?? 0),
        puntosTotales: Number(localStatus?.puntosTotales ?? 0)
      },
      visitante: {
        scoreRows: Array.isArray(visitanteStatus?.scoreRows) ? visitanteStatus.scoreRows : [],
        triangulosTotales: Number(visitanteStatus?.triangulosTotales ?? visitanteStatus?.triangulos ?? 0),
        puntosTotales: Number(visitanteStatus?.puntosTotales ?? 0)
      }
    });
  }

  return results;
}

async function buildAllValidatedCrucesForPlayerQuery(category = '') {
  const key = String(category || '').trim().toLowerCase() || '__all__';
  const now = Date.now();
  const cached = validatedCrucesCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = buildAllValidatedCrucesForPlayerQueryUncached(category);
  validatedCrucesCache.set(key, {
    expiresAt: now + VALIDATED_CRUCES_CACHE_TTL_MS,
    value
  });

  try {
    return await value;
  } catch (err) {
    if (validatedCrucesCache.get(key)?.value === value) {
      validatedCrucesCache.delete(key);
    }
    throw err;
  }
}

async function findRegisteredPlayerSuggestionsByCategory(category = '', q = '') {
  const division = String(category || '').trim().toLowerCase();
  const query = parsePlayerQuery(q).name;
  if (!division || normalizeText(query).length < 2) return [];
  await pool.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true`);

  const { rows } = await pool.query(
    `
    WITH active_links AS (
      SELECT DISTINCT ON (je.jugador_id, je.categoria)
        je.jugador_id,
        je.categoria,
        je.equipo_id
      FROM jugador_equipos je
      WHERE je.activo = true
        AND LOWER(je.categoria) = $1
      ORDER BY je.jugador_id, je.categoria, je.desde DESC NULLS LAST, je.id DESC
    )
    SELECT
      j.id,
      TRIM(j.nombre) AS name,
      e.slug_uid,
      e.slug_base,
      e.display_name AS team_name
    FROM jugadores j
    INNER JOIN active_links al ON al.jugador_id = j.id
    INNER JOIN equipos e ON e.id = al.equipo_id
    WHERE LOWER(al.categoria) = $1
      AND COALESCE(e.activo, true) = true
      AND TRIM(COALESCE(j.nombre, '')) <> ''
    ORDER BY j.nombre ASC, e.display_name ASC, j.id ASC
    `,
    [division]
  );

  return rows
    .filter((row) => includesNormalizedName(row.name, query))
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name || '').trim(),
      teamSlug: row.slug_uid || row.slug_base,
      teamName: row.team_name,
      label: `${String(row.name || '').trim()} · ${row.team_name}`
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))
    .slice(0, 12);
}

function buildValidatedPlayerSuggestions(results = [], q = '') {
  const parsed = parsePlayerQuery(q);
  const suggestionsMap = new Map();

  for (const item of results) {
    const sides = [
      { teamSlug: item.localSlug, teamName: item.localName, players: getSearchablePlayerRefs(item.localPlanilla) },
      { teamSlug: item.visitanteSlug, teamName: item.visitanteName, players: getSearchablePlayerRefs(item.visitantePlanilla) }
    ];

    for (const side of sides) {
      side.players.forEach((player) => {
        if (!player?.name || !includesNormalizedName(player.name, parsed.name)) return;
        if (parsed.team && !sameNormalizedName(side.teamName, parsed.team) && !samePlayerTeamSlug(side.teamSlug, parsed.team)) return;
        const playerId = Number(player.id || 0) || null;
        const key = playerId ? `id:${playerId}` : `${normalizeText(player.name)}::${canonicalPlayerTeamSlug(side.teamSlug)}`;
        if (!suggestionsMap.has(key)) {
          suggestionsMap.set(key, {
            id: playerId,
            name: player.name,
            teamSlug: side.teamSlug,
            teamName: side.teamName,
            label: `${player.name} · ${side.teamName}`
          });
        }
      });
    }
  }

  return Array.from(suggestionsMap.values())
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))
    .slice(0, 12);
}

function playerSuggestionTeamsMatch(a = {}, b = {}) {
  const aSlug = a?.teamSlug || a?.teamName;
  const bSlug = b?.teamSlug || b?.teamName;
  const aTeamName = String(a?.teamName || '').trim();
  const bTeamName = String(b?.teamName || '').trim();
  return (
    samePlayerTeamSlug(aSlug, bSlug)
    || (!!aTeamName && !!bTeamName && sameNormalizedName(aTeamName, bTeamName))
    || samePlayerTeamSlug(a?.teamSlug, b?.teamName)
    || samePlayerTeamSlug(a?.teamName, b?.teamSlug)
  );
}

function mergePlayerSuggestions(primary = [], fallback = [], { hideTeam = false } = {}) {
  const merged = [];

  [...primary, ...fallback].forEach((rawItem) => {
    const name = String(rawItem?.name || '').trim();
    if (!name) return;

    const item = {
      ...rawItem,
      id: Number(rawItem?.id || 0) || null,
      name
    };
    const normalizedName = canonicalTeamPlayerNameKey(name);
    let existingIndex = merged.findIndex((existing) => {
      const existingId = Number(existing?.id || 0) || null;
      if (item.id && existingId) return item.id === existingId;
      if (canonicalTeamPlayerNameKey(existing?.name) !== normalizedName) return false;
      return playerSuggestionTeamsMatch(existing, item);
    });

    if (existingIndex < 0) {
      const sameIdentityIndexes = merged
        .map((existing, index) => (
          canonicalTeamPlayerNameKey(existing?.name) === normalizedName ? index : -1
        ))
        .filter((index) => index >= 0);
      const knownIds = new Set(
        sameIdentityIndexes
          .map((index) => Number(merged[index]?.id || 0) || null)
          .filter(Boolean)
      );
      const itemHasTeam = !!String(item?.teamSlug || item?.teamName || '').trim();
      const sameIdentityWithTeam = sameIdentityIndexes.filter((index) => (
        !!String(merged[index]?.teamSlug || merged[index]?.teamName || '').trim()
      ));

      if (!item.id && itemHasTeam && knownIds.size === 1) {
        existingIndex = sameIdentityWithTeam.find((index) => Number(merged[index]?.id || 0)) ?? -1;
      } else if (item.id && itemHasTeam && knownIds.size === 0 && sameIdentityWithTeam.length === 1) {
        existingIndex = sameIdentityWithTeam[0];
      }
    }

    if (existingIndex < 0) {
      merged.push(item);
      return;
    }

    // La sugerencia con ID siempre prevalece sobre referencias historicas
    // provenientes de planillas antiguas que solo conservan nombre y equipo.
    if (!merged[existingIndex].id && item.id) {
      merged[existingIndex] = item;
    }
  });

  return merged
    .map((item) => ({
      ...item,
      label: hideTeam || !item.teamName
        ? item.name
        : `${item.name} · ${item.teamName}`
    }))
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'es'))
    .slice(0, 12);
}

function parsePlayerQuery(value = '') {
  const raw = String(value || '').trim();
  const parts = raw.split(/\s+[·-]\s+/);
  return {
    raw,
    name: String(parts[0] || raw).trim(),
    team: String(parts.slice(1).join(' - ') || '').trim()
  };
}

function suggestionMatchesQuery(item = {}, query = '') {
  const parsed = parsePlayerQuery(query);
  if (sameNormalizedName(item.label, parsed.raw)) return true;
  if (!parsed.team) return sameNormalizedName(item.name, parsed.name);
  return sameNormalizedName(item.name, parsed.name) && (
    sameNormalizedName(item.teamName, parsed.team) ||
    samePlayerTeamSlug(item.teamSlug, parsed.team)
  );
}

function resolveExactPlayerSuggestion(suggestions = [], query = '') {
  const parsed = parsePlayerQuery(query);
  const exact = suggestions.find((item) => suggestionMatchesQuery(item, query));
  if (exact) return exact;
  if (parsed.team && suggestions.length === 1) return suggestions[0];
  return null;
}

function samePlayerRef(player, exact, teamSlug = '') {
  const playerId = Number(player?.id || 0) || null;
  const exactId = Number(exact?.id || 0) || null;
  if (playerId && exactId) return playerId === exactId;
  return sameNormalizedName(player?.name, exact?.name) && samePlayerTeamSlug(teamSlug, exact?.teamSlug);
}

function samePlayerIdentity(player, exact) {
  const playerId = Number(player?.id || 0) || null;
  const exactId = Number(exact?.id || 0) || null;
  if (playerId && exactId) return playerId === exactId;
  return sameCanonicalPlayerName(player?.name, exact?.name);
}

function sortPlayerMatchByDateAndRow(a = {}, b = {}) {
  return String(b.fechaISO || '').localeCompare(String(a.fechaISO || ''))
    || Number(a.row || a.pairNumber || 0) - Number(b.row || b.pairNumber || 0);
}

function resultFromScores(ownScore, opponentScore) {
  const own = Number(ownScore || 0);
  const opponent = Number(opponentScore || 0);
  if (own > opponent) return 'ganado';
  if (own < opponent) return 'perdido';
  return 'empatado';
}

function buildPlayerMatchesFromValidatedResults(results = [], exact = {}) {
  const matches = [];
  const pairMatches = [];

  for (const item of results) {
    const localPlayers = getIndividualPlayerRefs(item.localPlanilla);
    const visitantePlayers = getIndividualPlayerRefs(item.visitantePlanilla);
    const localScores = Array.isArray(item.local?.scoreRows) ? item.local.scoreRows : [];
    const visitanteScores = Array.isArray(item.visitante?.scoreRows) ? item.visitante.scoreRows : [];
    const maxIndividual = Math.max(localPlayers.length, visitantePlayers.length, 7);

    for (let idx = 0; idx < maxIndividual; idx++) {
      const localPlayer = localPlayers[idx] || { id: null, name: '' };
      const visitantePlayer = visitantePlayers[idx] || { id: null, name: '' };
      const localScore = Number(localScores[idx] ?? 0) || 0;
      const visitanteScore = Number(visitanteScores[idx] ?? 0) || 0;

      if (localPlayer.name && samePlayerIdentity(localPlayer, exact)) {
        matches.push({
          fechaISO: item.fechaISO,
          category: item.category,
          playerId: localPlayer.id,
          playerName: localPlayer.name,
          teamSlug: item.localSlug,
          teamName: item.localName,
          opponentSlug: item.visitanteSlug,
          opponentName: item.visitanteName,
          opponentPlayerName: visitantePlayer.name || '',
          row: idx + 1,
          triangulosFavor: localScore,
          triangulosContra: visitanteScore,
          result: resultFromScores(localScore, visitanteScore)
        });
      }

      if (visitantePlayer.name && samePlayerIdentity(visitantePlayer, exact)) {
        matches.push({
          fechaISO: item.fechaISO,
          category: item.category,
          playerId: visitantePlayer.id,
          playerName: visitantePlayer.name,
          teamSlug: item.visitanteSlug,
          teamName: item.visitanteName,
          opponentSlug: item.localSlug,
          opponentName: item.localName,
          opponentPlayerName: localPlayer.name || '',
          row: idx + 1,
          triangulosFavor: visitanteScore,
          triangulosContra: localScore,
          result: resultFromScores(visitanteScore, localScore)
        });
      }
    }

    for (let pairIndex = 0; pairIndex < 2; pairIndex++) {
      const section = pairIndex === 0 ? 'pareja1' : 'pareja2';
      const localPair = getPlanillaPlayerRefs(item.localPlanilla, section);
      const visitantePair = getPlanillaPlayerRefs(item.visitantePlanilla, section);
      const localScore = getPairScore(localScores, item.localPlanilla, pairIndex);
      const visitanteScore = getPairScore(visitanteScores, item.visitantePlanilla, pairIndex);
      const localHit = localPair.find((player) => samePlayerIdentity(player, exact));
      const visitanteHit = visitantePair.find((player) => samePlayerIdentity(player, exact));

      if (localHit) {
        pairMatches.push({
          fechaISO: item.fechaISO,
          category: item.category,
          playerId: localHit.id,
          playerName: localHit.name,
          teamSlug: item.localSlug,
          teamName: item.localName,
          opponentSlug: item.visitanteSlug,
          opponentName: item.visitanteName,
          companionName: localPair.find((player) => !samePlayerIdentity(player, exact))?.name || '',
          opponentPairPlayers: visitantePair.map((player) => player.name).filter(Boolean),
          pairNumber: pairIndex + 1,
          triangulosFavor: localScore,
          triangulosContra: visitanteScore,
          result: resultFromScores(localScore, visitanteScore)
        });
      }

      if (visitanteHit) {
        pairMatches.push({
          fechaISO: item.fechaISO,
          category: item.category,
          playerId: visitanteHit.id,
          playerName: visitanteHit.name,
          teamSlug: item.visitanteSlug,
          teamName: item.visitanteName,
          opponentSlug: item.localSlug,
          opponentName: item.localName,
          companionName: visitantePair.find((player) => !samePlayerIdentity(player, exact))?.name || '',
          opponentPairPlayers: localPair.map((player) => player.name).filter(Boolean),
          pairNumber: pairIndex + 1,
          triangulosFavor: visitanteScore,
          triangulosContra: localScore,
          result: resultFromScores(visitanteScore, localScore)
        });
      }
    }
  }

  return { matches, pairMatches };
}

async function normalizePlayerMatchTeamNames(entries = [], category = '') {
  const slugs = Array.from(new Set(
    entries.flatMap((item) => [item?.teamSlug, item?.opponentSlug])
      .map((slug) => String(slug || '').trim())
      .filter(Boolean)
  ));
  const displayNames = new Map();

  await Promise.all(slugs.map(async (slug) => {
    try {
      const info = await resolveEquipoInfoBySlug(slug, category);
      if (info?.display_name) displayNames.set(canonicalPlayerTeamSlug(slug), info.display_name);
    } catch (err) {
      console.warn('No se pudo normalizar el nombre de equipo del jugador', slug, err?.code || err?.message || err);
    }
  }));

  return entries.map((item) => ({
    ...item,
    teamName: displayNames.get(canonicalPlayerTeamSlug(item?.teamSlug)) || item?.teamName,
    opponentName: displayNames.get(canonicalPlayerTeamSlug(item?.opponentSlug)) || item?.opponentName
  }));
}

router.get('/player-query', requireAdminForPrivateCategory, async (req, res) => {
  setNoCache(res);
  try {
    const category = String(req.query.category || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim();
    const suggestOnly = String(req.query.suggest || '') === '1';
    const edition = normalizeEdition(req.query.edition, { allowTotal: true, defaultEdition: CURRENT_EDITION });

    if (!category) {
      return res.status(400).json({ ok: false, error: 'Seleccioná una categoría.' });
    }

    if (!q || normalizeText(q).length < 2) {
      return res.json({ ok: true, category, q, edition, editionLabel: getEditionLabel(edition), suggestions: [], player: null, total: 0, pairTotal: 0, matches: [], pairMatches: [] });
    }

    const [registeredSuggestions, resultadoSuggestions] = await Promise.all([
      findRegisteredPlayerSuggestionsByCategory(category, q),
      findJugadorResultadoSuggestionsByCategory(category, q, edition)
    ]);
    const mergeOptions = { hideTeam: edition === 'total' };
    const suggestions = Number(edition) === CURRENT_EDITION
      ? mergePlayerSuggestions(registeredSuggestions, resultadoSuggestions, mergeOptions)
      : mergePlayerSuggestions(resultadoSuggestions, registeredSuggestions, mergeOptions);
    if (suggestOnly) {
      return res.json({ ok: true, category, q, edition, editionLabel: getEditionLabel(edition), suggestions, player: null, total: 0, pairTotal: 0, matches: [], pairMatches: [] });
    }

    const exact = resolveExactPlayerSuggestion(suggestions, q);
    if (!exact) {
      return res.json({ ok: true, category, q, edition, editionLabel: getEditionLabel(edition), suggestions, player: null, total: 0, pairTotal: 0, matches: [], pairMatches: [] });
    }

    const [
      { ranking: categoryRanking, radContext },
      { ranking: totalCategoryRanking }
    ] = await Promise.all([
      buildRadRankingForCategory(category, edition),
      buildRadRankingForCategory(category, 'total')
    ]);
    const playerRadRow = categoryRanking.find((item) =>
      Number(item.id || 0) && Number(item.id) === Number(exact.id)
    ) || categoryRanking.find((item) =>
      sameNormalizedName(item.name, exact.name) && samePlayerTeamSlug(item.teamSlug, exact.teamSlug)
    ) || categoryRanking.find((item) =>
      sameCanonicalPlayerName(item.name, exact.name) && samePlayerTeamSlug(item.teamSlug, exact.teamSlug)
    ) || categoryRanking.find((item) =>
      sameNormalizedName(item.name, exact.name)
    ) || categoryRanking.find((item) =>
      sameCanonicalPlayerName(item.name, exact.name)
    ) || null;
    const promoted = await getPromotedPlayerKeys(category);
    const eligibleTotalRows = excludePromotedPlayers(totalCategoryRanking, promoted);
    const { ranking: eligibleTotalRanking } = buildRadRankingFromPlayerRows(eligibleTotalRows);
    const totalRankingIndex = eligibleTotalRanking.findIndex((item) =>
      Number(item.id || 0) && Number(item.id) === Number(exact.id)
    );
    const totalTeamRankingIndex = eligibleTotalRanking.findIndex((item) =>
      sameNormalizedName(item.name, exact.name) && samePlayerTeamSlug(item.teamSlug, exact.teamSlug)
    );
    const totalNameRankingIndexes = eligibleTotalRanking
      .map((item, index) => sameCanonicalPlayerName(item.name, exact.name) ? index : -1)
      .filter((index) => index >= 0);
    const totalRankingFallbackIndex = totalRankingIndex >= 0
      ? totalRankingIndex
      : (totalTeamRankingIndex >= 0
          ? totalTeamRankingIndex
          : (totalNameRankingIndexes.length === 1 ? totalNameRankingIndexes[0] : -1));
    const totalRankingPosition = totalRankingFallbackIndex >= 0
      ? totalRankingFallbackIndex + 1
      : null;
    const validatedResults = await filterItemsByEdition(
      await buildAllValidatedCrucesForPlayerQuery(category),
      edition,
      category
    );
    const liveDetail = buildPlayerMatchesFromValidatedResults(validatedResults, {
      id: exact.id || playerRadRow?.id || null,
      name: exact.name || playerRadRow?.name || ''
    });
    const storedDetail = (liveDetail.matches.length || liveDetail.pairMatches.length)
      ? null
      : await getJugadorResultadoMatches(category, {
          id: exact.id || playerRadRow?.id || null,
          name: exact.name || playerRadRow?.name || '',
          names: [exact.name, playerRadRow?.name].filter(Boolean)
        }, edition);
    const rawDetail = storedDetail || liveDetail;
    const [matches, pairMatches] = await Promise.all([
      normalizePlayerMatchTeamNames(rawDetail.matches, category),
      normalizePlayerMatchTeamNames(rawDetail.pairMatches, category)
    ]);

    matches.sort(sortPlayerMatchByDateAndRow);
    pairMatches.sort(sortPlayerMatchByDateAndRow);
    const playerDisplayTeamName = matches.find((match) =>
      samePlayerTeamSlug(match?.teamSlug, playerRadRow?.teamSlug || exact.teamSlug)
    )?.teamName || playerRadRow?.teamName || exact.teamName;

    return res.json({
      ok: true,
      category,
      q,
      edition,
      editionLabel: getEditionLabel(edition),
      suggestions,
      player: playerRadRow ? {
        ...playerRadRow,
        id: exact.id || playerRadRow.id,
        name: exact.name || playerRadRow.name,
        teamSlug: playerRadRow.teamSlug || exact.teamSlug,
        teamName: playerDisplayTeamName,
        label: `${exact.name || playerRadRow.name} Â· ${playerDisplayTeamName}`,
        totalRankingPosition
      } : {
        ...exact,
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        triangulosFavor: 0,
        triangulosContra: 0,
        diff: 0,
        effectiveness: 0,
        rad: 0,
        radPenalty: 0,
        totalRankingPosition
      },
      rad: playerRadRow?.rad ?? null,
      radPenalty: playerRadRow?.radPenalty ?? null,
      radContext,
      total: matches.length,
      pairTotal: pairMatches.length,
      matches,
      pairMatches
    });
  } catch (err) {
    console.error('GET /player-query', err);
    return res.status(500).json({ ok: false, error: 'No se pudo consultar el jugador.' });
  }
});


function ensureRankingRow(map, playerName, teamSlug, teamName) {
  return ensureRankingRowForPlayer(map, { name: playerName, id: null }, teamSlug, teamName);
}

function ensureRankingRowForPlayer(map, player, teamSlug, teamName, options = {}) {
  const playerId = Number(player?.id || 0) || null;
  const playerName = String(player?.name || '').trim();
  const mergeHistoricalIdentities = !!options.mergeHistoricalIdentities;
  const canonicalName = canonicalTeamPlayerNameKey(playerName);
  const canonicalTeam = canonicalPlayerTeamSlug(teamSlug);
  const key = playerId
    ? `id:${playerId}`
    : (mergeHistoricalIdentities && playerName
        ? (isKnownHistoricPlayerIdentity(playerName)
            ? `historic:${canonicalName}`
            : `historic:${canonicalName}::${canonicalTeam}`)
        : `${normalizeText(playerName)}::${canonicalTeam}`);

  if (!map.has(key) && playerName) {
    const compatibleRows = Array.from(map.values()).filter((row) => (
      canonicalTeamPlayerNameKey(row.name) === canonicalName &&
      canonicalPlayerTeamSlug(row.teamSlug) === canonicalTeam &&
      (!playerId || !row.id || Number(row.id) === playerId)
    ));
    if (compatibleRows.length === 1) {
      const existing = compatibleRows[0];
      if (playerId && !existing.id) existing.id = playerId;
      return existing;
    }
  }

  if (!map.has(key)) {
    map.set(key, {
      id: playerId,
      name: playerName,
      teamSlug,
      teamName,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      triangulosFavor: 0,
      triangulosContra: 0,
      diff: 0,
      effectiveness: 0
    });
  } else if (playerId && !map.get(key).id) {
    map.get(key).id = playerId;
  }
  return map.get(key);
}




function radNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function radRound1(value) {
  return Math.round(radNumber(value) * 10) / 10;
}

function buildRadContextFromRows(rows = []) {
  const playedValues = rows
    .map((item) => radNumber(item.played))
    .filter((played) => played > 0);

  const maxPlayed = playedValues.length ? Math.max(...playedValues) : 0;
  const avgPlayed = playedValues.length
    ? playedValues.reduce((acc, played) => acc + played, 0) / playedValues.length
    : 0;
  const spread = maxPlayed > 0 ? (maxPlayed - avgPlayed) / maxPlayed : 0;
  const force = 1 + spread;

  return { maxPlayed, avgPlayed, spread, force };
}

function applyRadToPlayerRow(item = {}, context = null) {
  const played = radNumber(item.played);
  const wins = radNumber(item.wins);
  const triangulosFavor = radNumber(item.triangulosFavor);
  const triangulosContra = radNumber(item.triangulosContra);
  const effectiveness = played > 0 ? (wins / played) * 100 : 0;

  const maxPlayed = radNumber(context?.maxPlayed);
  const avgPlayed = radNumber(context?.avgPlayed);
  const spread = maxPlayed > 0 ? (maxPlayed - avgPlayed) / maxPlayed : 0;
  const force = 1 + spread;

  const penalty = maxPlayed > 0 && played > 0
    ? 1 + ((maxPlayed - played) / maxPlayed) * force
    : 1;

  const rad = penalty > 0 ? effectiveness / penalty : 0;

  return {
    ...item,
    triangulosFavor,
    triangulosContra,
    diff: triangulosFavor - triangulosContra,
    effectiveness: radRound1(effectiveness),
    rad: radRound1(rad),
    radPenalty: radRound1(penalty)
  };
}

function sortPlayerRadRows(a, b) {
  const aPlayed = radNumber(a.played);
  const bPlayed = radNumber(b.played);

  if (aPlayed === 0 && bPlayed > 0) return 1;
  if (bPlayed === 0 && aPlayed > 0) return -1;

  if (radNumber(b.rad) !== radNumber(a.rad)) return radNumber(b.rad) - radNumber(a.rad);
  if (radNumber(b.diff) !== radNumber(a.diff)) return radNumber(b.diff) - radNumber(a.diff);
  if (radNumber(b.triangulosFavor) !== radNumber(a.triangulosFavor)) return radNumber(b.triangulosFavor) - radNumber(a.triangulosFavor);
  if (radNumber(b.wins) !== radNumber(a.wins)) return radNumber(b.wins) - radNumber(a.wins);
  if (bPlayed !== aPlayed) return bPlayed - aPlayed;
  return String(a.name || '').localeCompare(String(b.name || ''), 'es');
}

function buildPlayerRowsFromResults(results = [], options = {}) {
  const rankingMap = new Map();
  const idsByCanonicalName = new Map();

  if (options.mergeHistoricalIdentities) {
    for (const item of results) {
      const players = [
        ...getIndividualPlayerRefs(item.localPlanilla),
        ...getIndividualPlayerRefs(item.visitantePlanilla)
      ];
      for (const player of players) {
        const playerId = Number(player?.id || 0) || null;
        const canonicalName = canonicalTeamPlayerNameKey(player?.name);
        if (!playerId || !canonicalName) continue;
        if (!idsByCanonicalName.has(canonicalName)) idsByCanonicalName.set(canonicalName, new Set());
        idsByCanonicalName.get(canonicalName).add(playerId);
      }
    }
  }

  const resolveHistoricalPlayer = (player = {}) => {
    if (!options.mergeHistoricalIdentities || Number(player?.id || 0)) return player;
    const ids = idsByCanonicalName.get(canonicalTeamPlayerNameKey(player?.name));
    if (!ids || ids.size !== 1) return player;
    return { ...player, id: Array.from(ids)[0] };
  };

  for (const item of results) {
    const localPlayers = getIndividualPlayerRefs(item.localPlanilla);
    const visitantePlayers = getIndividualPlayerRefs(item.visitantePlanilla);
    const localScores = Array.isArray(item.local?.scoreRows) ? item.local.scoreRows : [];
    const visitanteScores = Array.isArray(item.visitante?.scoreRows) ? item.visitante.scoreRows : [];
    const max = Math.max(localPlayers.length, visitantePlayers.length, 7);

    for (let idx = 0; idx < max; idx++) {
      const localPlayer = resolveHistoricalPlayer(localPlayers[idx] || { id: null, name: '' });
      const visitantePlayer = resolveHistoricalPlayer(visitantePlayers[idx] || { id: null, name: '' });
      const localScore = Number(localScores[idx] ?? 0) || 0;
      const visitanteScore = Number(visitanteScores[idx] ?? 0) || 0;

      if (localPlayer.name) {
        const row = ensureRankingRowForPlayer(rankingMap, localPlayer, item.localSlug, item.localName, options);
        row.played += 1;
        row.triangulosFavor += localScore;
        row.triangulosContra += visitanteScore;
        if (localScore > visitanteScore) row.wins += 1;
        else if (localScore < visitanteScore) row.losses += 1;
        else row.draws += 1;
      }

      if (visitantePlayer.name) {
        const row = ensureRankingRowForPlayer(rankingMap, visitantePlayer, item.visitanteSlug, item.visitanteName, options);
        row.played += 1;
        row.triangulosFavor += visitanteScore;
        row.triangulosContra += localScore;
        if (visitanteScore > localScore) row.wins += 1;
        else if (visitanteScore < localScore) row.losses += 1;
        else row.draws += 1;
      }
    }
  }

  return Array.from(rankingMap.values())
    .map((item) => ({
      ...item,
      diff: Number(item.triangulosFavor || 0) - Number(item.triangulosContra || 0),
      effectiveness: Number(item.played || 0) > 0 ? Math.round((Number(item.wins || 0) / Number(item.played || 0)) * 100) : 0
    }));
}

function buildRadRankingFromPlayerRows(baseRows = []) {
  const activeRows = baseRows.filter((item) => radNumber(item.played) > 0);
  const rawContext = buildRadContextFromRows(activeRows);

  const ranking = baseRows
    .map((item) => applyRadToPlayerRow(item, rawContext))
    .sort(sortPlayerRadRows);

  return {
    ranking,
    radContext: {
      maxPlayed: radRound1(rawContext.maxPlayed),
      avgPlayed: radRound1(rawContext.avgPlayed),
      spread: radRound1(rawContext.spread),
      force: radRound1(rawContext.force)
    }
  };
}

function buildRadRankingFromResults(results = [], options = {}) {
  return buildRadRankingFromPlayerRows(buildPlayerRowsFromResults(results, options));
}

async function getPromotedPlayerKeys(category = '') {
  const division = String(category || '').trim().toLowerCase();
  const higherCategories = division === 'tercera'
    ? ['segunda', 'primera']
    : (division === 'segunda' ? ['primera'] : []);

  if (!higherCategories.length) {
    return { ids: new Set(), names: new Set() };
  }

  if (!ensureJugadorCurrentCategoryPromise) {
    ensureJugadorCurrentCategoryPromise = (async () => {
      await pool.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS categoria_actual TEXT`);
      await pool.query(`
        UPDATE jugadores j
           SET categoria_actual = current_team.categoria,
               updated_at = NOW()
          FROM (
            SELECT DISTINCT ON (je.jugador_id)
              je.jugador_id,
              LOWER(je.categoria) AS categoria
            FROM jugador_equipos je
            WHERE je.activo = true
            ORDER BY
              je.jugador_id,
              CASE LOWER(je.categoria)
                WHEN 'primera' THEN 3
                WHEN 'segunda' THEN 2
                WHEN 'tercera' THEN 1
                ELSE 0
              END DESC,
              je.desde DESC NULLS LAST,
              je.id DESC
          ) current_team
         WHERE j.id = current_team.jugador_id
           AND NULLIF(TRIM(COALESCE(j.categoria_actual, '')), '') IS NULL
      `);
    })().catch((err) => {
      ensureJugadorCurrentCategoryPromise = null;
      throw err;
    });
  }
  await ensureJugadorCurrentCategoryPromise;

  const { rows } = await pool.query(
    `
    SELECT DISTINCT promoted.id, promoted.nombre
    FROM (
      SELECT j.id, j.nombre
      FROM jugadores j
      WHERE LOWER(COALESCE(j.categoria_actual, '')) = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM jugador_equipos current_division
          WHERE current_division.jugador_id = j.id
            AND current_division.activo = true
            AND LOWER(current_division.categoria) = $2
        )

      UNION

      SELECT j.id, j.nombre
      FROM jugador_equipos je
      INNER JOIN jugadores j ON j.id = je.jugador_id
      WHERE je.activo = true
        AND LOWER(je.categoria) = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM jugador_equipos current_division
          WHERE current_division.jugador_id = j.id
            AND current_division.activo = true
            AND LOWER(current_division.categoria) = $2
        )
    ) promoted
    `,
    [higherCategories, division]
  );

  return {
    ids: new Set(rows.map((row) => Number(row.id || 0)).filter((id) => id > 0)),
    names: new Set(rows.map((row) => normalizeText(row.nombre)).filter(Boolean))
  };
}

function excludePromotedPlayers(rows = [], promoted = {}) {
  const ids = promoted?.ids instanceof Set ? promoted.ids : new Set();
  const names = promoted?.names instanceof Set ? promoted.names : new Set();

  return rows.filter((row) => {
    const id = Number(row?.id || 0);
    if (id > 0) return !ids.has(id);
    return !names.has(normalizeText(row?.name || ''));
  });
}

async function buildPlayerRowsFromJugadorResultados(category = '', edition = CURRENT_EDITION) {
  const division = String(category || '').trim().toLowerCase();
  if (!division) return [];
  await ensureJugadorResultadosEditionColumn();
  await ensureJugadorResultadosIdentityLinks();

  const normalizedEdition = normalizeEdition(edition, { allowTotal: true, defaultEdition: CURRENT_EDITION });
  const editionFilter = normalizedEdition === 'total' ? '' : 'AND edicion = $2';
  const params = normalizedEdition === 'total' ? [division] : [division, Number(normalizedEdition)];

  const { rows } = await pool.query(
    `
    WITH unique_players AS (
      SELECT
        LOWER(TRIM(nombre)) AS normalized_name,
        MIN(id)::int AS jugador_id
      FROM jugadores
      WHERE TRIM(COALESCE(nombre, '')) <> ''
      GROUP BY LOWER(TRIM(nombre))
      HAVING COUNT(DISTINCT id) = 1
    ),
    team_players AS (
      SELECT
        jr.id AS resultado_id,
        MIN(j.id)::int AS jugador_id
      FROM jugador_resultados jr
      INNER JOIN jugadores j
        ON LOWER(TRIM(j.nombre)) = LOWER(TRIM(jr.jugador_nombre))
      INNER JOIN jugador_equipos je
        ON je.jugador_id = j.id
       AND LOWER(je.categoria) = LOWER(jr.categoria)
      INNER JOIN equipos e ON e.id = je.equipo_id
      WHERE jr.jugador_id IS NULL
        AND REGEXP_REPLACE(LOWER(jr.equipo_slug), '_(primera|segunda|tercera)$', '') IN (
          REGEXP_REPLACE(LOWER(COALESCE(e.slug_uid, '')), '_(primera|segunda|tercera)$', ''),
          REGEXP_REPLACE(LOWER(COALESCE(e.slug_base, '')), '_(primera|segunda|tercera)$', ''),
          REGEXP_REPLACE(LOWER(COALESCE(e.username, '')), '_(primera|segunda|tercera)$', '')
        )
      GROUP BY jr.id
      HAVING COUNT(DISTINCT j.id) = 1
    ),
    resolved AS (
      SELECT
        jr.*,
        COALESCE(jr.jugador_id, team_players.jugador_id, unique_players.jugador_id) AS resolved_jugador_id
      FROM jugador_resultados jr
      LEFT JOIN unique_players
        ON jr.jugador_id IS NULL
       AND LOWER(TRIM(jr.jugador_nombre)) = unique_players.normalized_name
      LEFT JOIN team_players
        ON jr.jugador_id IS NULL
       AND team_players.resultado_id = jr.id
      WHERE jr.categoria = $1
        AND jr.modalidad = 'individual'
        AND TRIM(COALESCE(jr.jugador_nombre, '')) <> ''
        ${editionFilter.replaceAll('edicion', 'jr.edicion')}
    ),
    agg AS (
      SELECT
        COALESCE(resolved_jugador_id::text, 'name:' || LOWER(TRIM(jugador_nombre))) AS player_key,
        MAX(resolved_jugador_id) AS jugador_id,
        categoria,
        MAX(jugador_nombre) AS name,
        COUNT(*)::int AS played,
        SUM(CASE WHEN resultado = 'ganado' THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN resultado = 'perdido' THEN 1 ELSE 0 END)::int AS losses,
        SUM(CASE WHEN resultado = 'empatado' THEN 1 ELSE 0 END)::int AS draws,
        SUM(triangulos_favor)::int AS triangulos_favor,
        SUM(triangulos_contra)::int AS triangulos_contra
      FROM resolved
      GROUP BY COALESCE(resolved_jugador_id::text, 'name:' || LOWER(TRIM(jugador_nombre))), categoria
    ),
    latest AS (
      SELECT DISTINCT ON (COALESCE(resolved_jugador_id::text, 'name:' || LOWER(TRIM(jugador_nombre))), categoria)
        COALESCE(resolved_jugador_id::text, 'name:' || LOWER(TRIM(jugador_nombre))) AS player_key,
        resolved_jugador_id AS jugador_id,
        categoria,
        equipo_slug,
        equipo_nombre
      FROM resolved
      ORDER BY COALESCE(resolved_jugador_id::text, 'name:' || LOWER(TRIM(jugador_nombre))), categoria, fecha_iso DESC, id DESC
    ),
    active_team AS (
      SELECT DISTINCT ON (je.jugador_id, je.categoria)
        je.jugador_id,
        je.categoria,
        e.slug_uid AS equipo_slug,
        e.display_name AS equipo_nombre
      FROM jugador_equipos je
      INNER JOIN equipos e ON e.id = je.equipo_id
      WHERE LOWER(je.categoria) = $1
        AND je.activo = true
      ORDER BY je.jugador_id, je.categoria, je.desde DESC NULLS LAST, je.id DESC
    )
    SELECT
      agg.jugador_id AS id,
      agg.name,
      COALESCE(active_team.equipo_slug, latest.equipo_slug) AS equipo_slug,
      COALESCE(active_team.equipo_nombre, latest.equipo_nombre) AS equipo_nombre,
      agg.played,
      agg.wins,
      agg.losses,
      agg.draws,
      agg.triangulos_favor,
      agg.triangulos_contra
    FROM agg
    LEFT JOIN latest
      ON latest.player_key = agg.player_key
     AND latest.categoria = agg.categoria
    LEFT JOIN active_team
      ON active_team.jugador_id = agg.jugador_id
     AND LOWER(active_team.categoria) = LOWER(agg.categoria)
    ORDER BY agg.name ASC
    `,
    params
  );

  return rows.map((row) => ({
    id: Number(row.id || 0) || null,
    name: String(row.name || '').trim(),
    teamSlug: row.equipo_slug,
    teamName: row.equipo_nombre,
    played: Number(row.played || 0),
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    draws: Number(row.draws || 0),
    triangulosFavor: Number(row.triangulos_favor || 0),
    triangulosContra: Number(row.triangulos_contra || 0),
    diff: Number(row.triangulos_favor || 0) - Number(row.triangulos_contra || 0),
    effectiveness: Number(row.played || 0) > 0
      ? Math.round((Number(row.wins || 0) / Number(row.played || 0)) * 100)
      : 0
  }));
}

async function buildRadRankingFromJugadorResultados(category = '', edition = CURRENT_EDITION) {
  const baseRows = await buildPlayerRowsFromJugadorResultados(category, edition);
  return buildRadRankingFromPlayerRows(baseRows);
}

async function buildRadRankingForCategory(category = '', edition = CURRENT_EDITION) {
  const division = String(category || '').trim().toLowerCase();
  const normalizedEdition = normalizeEdition(edition, { allowTotal: true, defaultEdition: CURRENT_EDITION });
  const cacheKey = `${division}:${normalizedEdition}`;
  const now = Date.now();
  const cached = radRankingCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = (async () => {
    try {
      const results = await filterItemsByEdition(
        await buildAllValidatedCrucesForPlayerQuery(division),
        normalizedEdition,
        division
      );
      const rankingData = buildRadRankingFromResults(results, {
        mergeHistoricalIdentities: normalizedEdition === 'total'
      });
      if (Array.isArray(rankingData.ranking) && rankingData.ranking.length > 0) {
        return rankingData;
      }
    } catch (err) {
      console.warn('Falling back to jugador_resultados for player ranking', err?.code || err?.message || err);
    }

    return buildRadRankingFromJugadorResultados(division, normalizedEdition);
  })();

  radRankingCache.set(cacheKey, {
    expiresAt: now + RAD_RANKING_CACHE_TTL_MS,
    value
  });

  try {
    return await value;
  } catch (err) {
    if (radRankingCache.get(cacheKey)?.value === value) {
      radRankingCache.delete(cacheKey);
    }
    throw err;
  }
}

async function findJugadorResultadoSuggestionsByCategory(category = '', q = '', edition = CURRENT_EDITION) {
  const division = String(category || '').trim().toLowerCase();
  const query = parsePlayerQuery(q).name;
  if (!division || normalizeText(query).length < 2) return [];
  const normalizedEdition = normalizeEdition(edition, { allowTotal: true, defaultEdition: CURRENT_EDITION });
  const editionFilter = normalizedEdition === 'total' ? '' : 'AND jr.edicion = $2';
  const params = normalizedEdition === 'total' ? [division] : [division, Number(normalizedEdition)];

  let rows = [];
  try {
    await ensureJugadorResultadosEditionColumn();
    const result = await pool.query(
      `
      SELECT DISTINCT ON (COALESCE(jr.jugador_id::text, 'name:' || LOWER(TRIM(jr.jugador_nombre))))
        jr.jugador_id AS id,
        jr.jugador_nombre AS name,
        jr.equipo_slug,
        jr.equipo_nombre
      FROM jugador_resultados jr
      WHERE jr.categoria = $1
        AND TRIM(COALESCE(jr.jugador_nombre, '')) <> ''
        ${editionFilter}
      ORDER BY COALESCE(jr.jugador_id::text, 'name:' || LOWER(TRIM(jr.jugador_nombre))), jr.fecha_iso DESC, jr.id DESC
      `,
      params
    );
    rows = result.rows;
  } catch (err) {
    console.warn('Falling back to cruces_validations for player suggestions', err?.code || err?.message || err);
  }

  const storedSuggestions = rows
    .filter((row) => includesNormalizedName(row.name, query))
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name || '').trim(),
      teamSlug: row.equipo_slug,
      teamName: row.equipo_nombre,
      label: `${String(row.name || '').trim()} · ${row.equipo_nombre}`
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))
    .slice(0, 12);

  const validatedResults = await filterItemsByEdition(
    await buildAllValidatedCrucesForPlayerQuery(division),
    normalizedEdition,
    division
  );
  return mergePlayerSuggestions(
    storedSuggestions,
    buildValidatedPlayerSuggestions(validatedResults, q),
    { hideTeam: normalizedEdition === 'total' }
  );
}

async function getJugadorResultadoMatches(category = '', player = {}, edition = CURRENT_EDITION) {
  const division = String(category || '').trim().toLowerCase();
  const id = Number(player?.id || player || 0);
  const playerName = String(player?.name || '').trim();
  const playerNames = Array.from(new Set([
    playerName,
    ...(Array.isArray(player?.names) ? player.names : [])
  ].map((name) => String(name || '').trim()).filter((name) => normalizeText(name).length >= 2)));
  if (!division || (!id && !playerNames.length)) return { matches: [], pairMatches: [] };
  const normalizedEdition = normalizeEdition(edition, { allowTotal: true, defaultEdition: CURRENT_EDITION });
  const clauses = ['categoria = $1'];
  const params = [division];
  const playerClauses = [];
  if (id) {
    params.push(id);
    playerClauses.push(`jugador_id = $${params.length}`);
  }
  for (const name of playerNames) {
    const rawWords = String(name || '').trim().toLowerCase().split(/\s+/);
    const normalizedWords = normalizeText(name).split(' ');
    const wordVariants = rawWords
      .map((word, index) => Array.from(new Set([word, normalizedWords[index]].filter(Boolean))))
      .map((variants) => variants.map((token) => token.trim()).filter((token) => token.length >= 2))
      .filter((variants) => variants.length)
      .slice(0, 4);
    if (!wordVariants.length) continue;
    const tokenClauses = wordVariants.map((variants) => {
      const variantClauses = variants.map((token) => {
        params.push(`%${token}%`);
        return `LOWER(TRIM(jugador_nombre)) LIKE $${params.length}`;
      });
      return `(${variantClauses.join(' OR ')})`;
    });
    playerClauses.push(`(${tokenClauses.join(' AND ')})`);
  }
  clauses.push(`(${playerClauses.join(' OR ')})`);
  if (normalizedEdition !== 'total') {
    params.push(Number(normalizedEdition));
    clauses.push(`edicion = $${params.length}`);
  }

  let rows = [];
  try {
    await ensureJugadorResultadosEditionColumn();
    const result = await pool.query(
      `
      SELECT
        to_char(fecha_iso, 'YYYY-MM-DD') AS fecha_iso,
        categoria,
        jugador_id,
        jugador_nombre,
        equipo_slug,
        equipo_nombre,
        rival_slug,
        rival_nombre,
        (
          SELECT opponent.jugador_nombre
          FROM jugador_resultados opponent
          WHERE opponent.id <> jugador_resultados.id
            AND opponent.fecha_iso = jugador_resultados.fecha_iso
            AND opponent.categoria = jugador_resultados.categoria
            AND opponent.edicion = jugador_resultados.edicion
            AND opponent.modalidad = 'individual'
            AND opponent.modalidad = jugador_resultados.modalidad
            AND opponent.slot = jugador_resultados.slot
            AND opponent.equipo_slug = jugador_resultados.rival_slug
            AND opponent.rival_slug = jugador_resultados.equipo_slug
          ORDER BY opponent.id ASC
          LIMIT 1
        ) AS rival_jugador_nombre,
        (
          SELECT companion.jugador_nombre
          FROM jugador_resultados companion
          WHERE companion.id <> jugador_resultados.id
            AND companion.fecha_iso = jugador_resultados.fecha_iso
            AND companion.categoria = jugador_resultados.categoria
            AND companion.edicion = jugador_resultados.edicion
            AND companion.modalidad = 'pareja'
            AND companion.modalidad = jugador_resultados.modalidad
            AND COALESCE(companion.pareja_index, companion.slot) = COALESCE(jugador_resultados.pareja_index, jugador_resultados.slot)
            AND companion.equipo_slug = jugador_resultados.equipo_slug
            AND companion.rival_slug = jugador_resultados.rival_slug
          ORDER BY companion.id ASC
          LIMIT 1
        ) AS companero_jugador_nombre,
        ARRAY(
          SELECT opponent.jugador_nombre
          FROM jugador_resultados opponent
          WHERE opponent.fecha_iso = jugador_resultados.fecha_iso
            AND opponent.categoria = jugador_resultados.categoria
            AND opponent.edicion = jugador_resultados.edicion
            AND opponent.modalidad = 'pareja'
            AND opponent.modalidad = jugador_resultados.modalidad
            AND COALESCE(opponent.pareja_index, opponent.slot) = COALESCE(jugador_resultados.pareja_index, jugador_resultados.slot)
            AND opponent.equipo_slug = jugador_resultados.rival_slug
            AND opponent.rival_slug = jugador_resultados.equipo_slug
          ORDER BY opponent.id ASC
        ) AS rival_jugadores_nombres,
        modalidad,
        slot,
        pareja_index,
        triangulos_favor,
        triangulos_contra,
        resultado
      FROM jugador_resultados
      WHERE ${clauses.join('\n        AND ')}
      ORDER BY fecha_iso ASC, modalidad ASC, slot ASC, id ASC
      `,
      params
    );
    rows = result.rows;
  } catch (err) {
    console.warn('Skipping jugador_resultados matches', err?.code || err?.message || err);
    return { matches: [], pairMatches: [] };
  }

  const toItem = (row) => ({
    fechaISO: normalizeDateOnly(row.fecha_iso),
    category: row.categoria,
    playerId: Number(row.jugador_id || 0) || null,
    playerName: row.jugador_nombre,
    teamSlug: row.equipo_slug,
    teamName: row.equipo_nombre,
    opponentSlug: row.rival_slug,
    opponentName: row.rival_nombre,
    opponentPlayerName: String(row.rival_jugador_nombre || '').trim(),
    companionName: String(row.companero_jugador_nombre || '').trim(),
    opponentPairPlayers: Array.isArray(row.rival_jugadores_nombres)
      ? row.rival_jugadores_nombres.map((name) => String(name || '').trim()).filter(Boolean)
      : [],
    row: Number(row.slot || 0),
    pairNumber: Number(row.pareja_index || row.slot || 0),
    triangulosFavor: Number(row.triangulos_favor || 0),
    triangulosContra: Number(row.triangulos_contra || 0),
    result: row.resultado
  });

  return {
    matches: rows.filter((row) => row.modalidad === 'individual').map(toItem),
    pairMatches: rows.filter((row) => row.modalidad === 'pareja').map(toItem)
  };
}


async function countRegisteredIndividualPlayersByCategory(category = '') {
  const division = String(category || '').trim().toLowerCase();
  if (!division) return 0;

  const { rows } = await pool.query(
    `
    SELECT COUNT(DISTINCT j.id)::int AS total
    FROM jugadores j
    LEFT JOIN jugador_equipos je ON je.jugador_id = j.id
    LEFT JOIN equipos e ON e.id = COALESCE(je.equipo_id, j.equipo_id)
    WHERE LOWER(COALESCE(je.categoria, e.division, '')) = $1
      AND TRIM(COALESCE(j.nombre, '')) <> ''
    `,
    [division]
  );

  return Number(rows?.[0]?.total || 0);
}

router.get('/player-ranking', requireAdminForPrivateCategory, async (req, res) => {
  setNoCache(res);
  try {
    const category = String(req.query.category || '').trim().toLowerCase();
    const rawLimit = Number(req.query.limit || 10);
    const limit = [10, 20, 50].includes(rawLimit) ? rawLimit : 10;
    const edition = normalizeEdition(req.query.edition, { allowTotal: true, defaultEdition: 'total' });

    if (!category) {
      return res.status(400).json({ ok: false, error: 'Seleccioná una categoría.' });
    }

    let [{ ranking: fullRanking, radContext }, totalRegisteredPlayers] = await Promise.all([
      buildRadRankingForCategory(category, edition),
      countRegisteredIndividualPlayersByCategory(category)
    ]);

    let promotedPlayersExcluded = 0;
    if (edition === 'total') {
      const promoted = await getPromotedPlayerKeys(category);
      const eligibleRows = excludePromotedPlayers(fullRanking, promoted);
      promotedPlayersExcluded = fullRanking.length - eligibleRows.length;
      ({ ranking: fullRanking, radContext } = buildRadRankingFromPlayerRows(eligibleRows));
    }

    const totalActivePlayers = fullRanking.filter((item) => Number(item.played || 0) > 0).length;
    const ranking = fullRanking.slice(0, limit);

    return res.json({
      ok: true,
      category,
      edition,
      editionLabel: getEditionLabel(edition),
      limit,
      total: ranking.length,
      totalRegisteredPlayers,
      totalActivePlayers,
      promotedPlayersExcluded,
      radContext,
      ranking
    });
  } catch (err) {
    console.error('GET /player-ranking', err);
    return res.status(500).json({ ok: false, error: 'No se pudo armar el ranking.' });
  }
});



function ensureTeamRankingRow(map, teamSlug, teamName) {
  const key = canonicalPlayerTeamSlug(teamSlug || teamName || 'sin-equipo');
  if (!map.has(key)) {
    map.set(key, {
      teamSlug,
      teamName: String(teamName || 'Sin equipo').trim(),
      played: 0,
      puntosFavor: 0,
      puntosContra: 0,
      diffPuntos: 0,
      triangulosFavor: 0,
      triangulosContra: 0,
      diffTriangulos: 0
    });
  }
  return map.get(key);
}

router.get('/team-ranking', requireAdminForPrivateCategory, async (req, res) => {
  setNoCache(res);
  try {
    const category = String(req.query.category || '').trim().toLowerCase();
    const rawLimit = Number(req.query.limit || 10);
    const limit = [10, 20, 50].includes(rawLimit) ? rawLimit : 10;
    const edition = normalizeEdition(req.query.edition, { allowTotal: false, defaultEdition: CURRENT_EDITION });

    if (!category) {
      return res.status(400).json({ ok: false, error: 'Seleccioná una categoría.' });
    }

    const results = await filterItemsByEdition(await buildAllValidatedCrucesForPlayerQuery(category), edition, category);
    const rankingMap = new Map();
    const countedMatches = new Set();

    for (const item of results) {


      const matchTeamsKey = [canonicalPlayerTeamSlug(item.localSlug), canonicalPlayerTeamSlug(item.visitanteSlug)]
        .sort()
        .join('::');
      const matchKey = `${String(item.fechaISO || '')}::${matchTeamsKey}`;
      if (countedMatches.has(matchKey)) continue;
      countedMatches.add(matchKey);

      const localScores = Array.isArray(item.local?.scoreRows) ? item.local.scoreRows : [];
      const visitanteScores = Array.isArray(item.visitante?.scoreRows) ? item.visitante.scoreRows : [];




      const localPF = item.local?.puntosTotales !== undefined && item.local?.puntosTotales !== null
        ? Number(item.local.puntosTotales) || 0
        : localScores.filter((n) => Number(n || 0) > 0).length;
      const visitantePF = item.visitante?.puntosTotales !== undefined && item.visitante?.puntosTotales !== null
        ? Number(item.visitante.puntosTotales) || 0
        : visitanteScores.filter((n) => Number(n || 0) > 0).length;

      const localTF = (item.local?.triangulosTotales !== undefined && item.local?.triangulosTotales !== null)
        ? Number(item.local.triangulosTotales) || 0
        : ((item.local?.triangulos !== undefined && item.local?.triangulos !== null)
          ? Number(item.local.triangulos) || 0
          : localScores.reduce((acc, n) => acc + (Number(n) || 0), 0));
      const visitanteTF = (item.visitante?.triangulosTotales !== undefined && item.visitante?.triangulosTotales !== null)
        ? Number(item.visitante.triangulosTotales) || 0
        : ((item.visitante?.triangulos !== undefined && item.visitante?.triangulos !== null)
          ? Number(item.visitante.triangulos) || 0
          : visitanteScores.reduce((acc, n) => acc + (Number(n) || 0), 0));

      const localRow = ensureTeamRankingRow(rankingMap, item.localSlug, item.localName);
      localRow.played += 1;
      localRow.puntosFavor += localPF;
      localRow.puntosContra += visitantePF;
      localRow.triangulosFavor += localTF;
      localRow.triangulosContra += visitanteTF;

      const visitanteRow = ensureTeamRankingRow(rankingMap, item.visitanteSlug, item.visitanteName);
      visitanteRow.played += 1;
      visitanteRow.puntosFavor += visitantePF;
      visitanteRow.puntosContra += localPF;
      visitanteRow.triangulosFavor += visitanteTF;
      visitanteRow.triangulosContra += localTF;
    }

    const ranking = Array.from(rankingMap.values())
      .map((item) => ({
        ...item,
        diffPuntos: Number(item.puntosFavor || 0) - Number(item.puntosContra || 0),
        diffTriangulos: Number(item.triangulosFavor || 0) - Number(item.triangulosContra || 0)
      }))
      .sort((a, b) => {
        if (b.puntosFavor !== a.puntosFavor) return b.puntosFavor - a.puntosFavor;
        if (b.diffPuntos !== a.diffPuntos) return b.diffPuntos - a.diffPuntos;
        if (b.diffTriangulos !== a.diffTriangulos) return b.diffTriangulos - a.diffTriangulos;
        if (b.triangulosFavor !== a.triangulosFavor) return b.triangulosFavor - a.triangulosFavor;
        if (a.puntosContra !== b.puntosContra) return a.puntosContra - b.puntosContra;
        return String(a.teamName || '').localeCompare(String(b.teamName || ''), 'es');
      })
      .slice(0, limit);

    return res.json({
      ok: true,
      category,
      edition,
      editionLabel: getEditionLabel(edition),
      limit,
      total: ranking.length,
      ranking
    });
  } catch (err) {
    console.error('GET /team-ranking', err);
    return res.status(500).json({ ok: false, error: 'No se pudo armar el ranking de equipos.' });
  }
});

async function findTeamsByCategory(category = '', { includeInactive = false } = {}) {
  const division = String(category || '').trim().toLowerCase();
  if (!division) return [];

  await pool.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true`);

  const { rows } = await pool.query(
    `
    SELECT id, slug_uid, slug_base, display_name, division
    FROM equipos
    WHERE LOWER(division) = $1
      AND ($2::boolean = true OR activo = true)
    ORDER BY display_name ASC, id ASC
    `,
    [division, includeInactive]
  );

  return rows;
}

async function getRegisteredPlayersForTeam(teamId, { includeInactive = false } = {}) {
  if (!teamId) return [];

  const { rows } = await pool.query(
    `
    SELECT DISTINCT ON (j.id)
      j.id,
      TRIM(j.nombre) AS name,
      COALESCE(je.orden, j.orden) AS orden
    FROM jugadores j
    LEFT JOIN jugador_equipos je ON je.jugador_id = j.id
    WHERE COALESCE(je.equipo_id, j.equipo_id) = $1
      AND ($2::boolean = true OR COALESCE(je.activo, true) = true)
      AND TRIM(COALESCE(j.nombre, '')) <> ''
    ORDER BY j.id, COALESCE(je.orden, j.orden) ASC, j.nombre ASC
    `,
    [teamId, includeInactive]
  );

  return rows
    .map((row) => ({ id: Number(row.id), name: String(row.name || '').trim() }))
    .filter((row) => row.name);
}

function buildPairPlayerStatsFromValidatedResults(results = [], teamInfo = {}) {
  const statsMap = new Map();
  const ensurePlayer = (player, teamSlug, teamName) => {
    const id = Number(player?.id || 0) || null;
    const name = String(player?.name || '').trim();
    const key = id ? `id:${id}` : normalizeText(name);
    if (!key || !name) return null;
    if (!statsMap.has(key)) {
      statsMap.set(key, {
        id,
        name,
        teamSlug,
        teamName,
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        triangulosFavor: 0,
        triangulosContra: 0,
        diff: 0,
        effectiveness: 0
      });
    }
    return statsMap.get(key);
  };

  results.forEach((item) => {
    const isLocal = teamInfoMatchesSide(teamInfo, item.localSlug, item.localName);
    const isVisitor = teamInfoMatchesSide(teamInfo, item.visitanteSlug, item.visitanteName);
    if (!isLocal && !isVisitor) return;

    const ownPlanilla = isLocal ? item.localPlanilla : item.visitantePlanilla;
    const opponentPlanilla = isLocal ? item.visitantePlanilla : item.localPlanilla;
    const ownScores = isLocal ? item.local?.scoreRows : item.visitante?.scoreRows;
    const opponentScores = isLocal ? item.visitante?.scoreRows : item.local?.scoreRows;
    const teamSlug = isLocal ? item.localSlug : item.visitanteSlug;
    const teamName = isLocal ? item.localName : item.visitanteName;

    for (let pairIndex = 0; pairIndex < 2; pairIndex++) {
      const section = pairIndex === 0 ? 'pareja1' : 'pareja2';
      const players = getPlanillaPlayerRefs(ownPlanilla, section);
      const ownScore = getPairScore(ownScores, ownPlanilla, pairIndex);
      const opponentScore = getPairScore(opponentScores, opponentPlanilla, pairIndex);
      const result = resultFromScores(ownScore, opponentScore);

      players.forEach((player) => {
        const row = ensurePlayer(player, teamSlug, teamName);
        if (!row) return;
        row.played += 1;
        row.triangulosFavor += Number(ownScore || 0);
        row.triangulosContra += Number(opponentScore || 0);
        if (result === 'ganado') row.wins += 1;
        else if (result === 'perdido') row.losses += 1;
        else row.draws += 1;
      });
    }
  });

  return Array.from(statsMap.values()).map((row) => ({
    ...row,
    diff: Number(row.triangulosFavor || 0) - Number(row.triangulosContra || 0),
    effectiveness: Number(row.played || 0) > 0
      ? (Number(row.wins || 0) / Number(row.played)) * 100
      : 0
  }));
}

async function getPairPlayerStatsForTeam(category = '', edition = CURRENT_EDITION, teamInfo = {}) {
  const division = String(category || '').trim().toLowerCase();
  const normalizedEdition = normalizeEdition(edition, {
    allowTotal: false,
    defaultEdition: CURRENT_EDITION
  });
  if (!division) return [];

  try {
    const results = await filterItemsByEdition(
      await buildAllValidatedCrucesForPlayerQuery(division),
      normalizedEdition,
      division
    );
    const liveRows = buildPairPlayerStatsFromValidatedResults(results, teamInfo);
    if (liveRows.length) return liveRows;
  } catch (err) {
    console.warn('Falling back to jugador_resultados for pair player stats', err?.code || err?.message || err);
  }

  let rows = [];
  try {
    await ensureJugadorResultadosEditionColumn();
    const result = await pool.query(
      `
      SELECT
        jugador_id AS id,
        MAX(jugador_nombre) AS name,
        equipo_slug,
        MAX(equipo_nombre) AS team_name,
        COUNT(*)::int AS played,
        SUM(CASE WHEN resultado = 'ganado' THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN resultado = 'perdido' THEN 1 ELSE 0 END)::int AS losses,
        SUM(CASE WHEN resultado = 'empatado' THEN 1 ELSE 0 END)::int AS draws,
        SUM(triangulos_favor)::int AS triangulos_favor,
        SUM(triangulos_contra)::int AS triangulos_contra
      FROM jugador_resultados
      WHERE categoria = $1
        AND edicion = $2
        AND modalidad = 'pareja'
        AND TRIM(COALESCE(jugador_nombre, '')) <> ''
      GROUP BY jugador_id, equipo_slug
      ORDER BY MAX(jugador_nombre) ASC
      `,
      [division, Number(normalizedEdition)]
    );
    rows = result.rows;
  } catch (err) {
    console.warn('Unable to read jugador_resultados for pair player stats', err?.code || err?.message || err);
    return [];
  }

  return rows
    .filter((row) => teamInfoMatchesSide(teamInfo, row.equipo_slug, row.team_name))
    .map((row) => {
      const played = Number(row.played || 0);
      const wins = Number(row.wins || 0);
      const triangulosFavor = Number(row.triangulos_favor || 0);
      const triangulosContra = Number(row.triangulos_contra || 0);
      return {
        id: Number(row.id || 0) || null,
        name: String(row.name || '').trim(),
        teamSlug: row.equipo_slug,
        teamName: row.team_name,
        played,
        wins,
        losses: Number(row.losses || 0),
        draws: Number(row.draws || 0),
        triangulosFavor,
        triangulosContra,
        diff: triangulosFavor - triangulosContra,
        effectiveness: played > 0 ? (wins / played) * 100 : 0
      };
    });
}

function teamInfoMatchesSide(teamInfo = {}, sideSlug = '', sideName = '') {
  const candidates = [teamInfo.slug_uid, teamInfo.slug_base, teamInfo.display_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return candidates.some((candidate) => (
    samePlayerTeamSlug(sideSlug, candidate) || normalizeText(sideName) === normalizeText(candidate)
  ));
}

function sortPlayerStatsRows(a, b) {
  const aPlayed = Number(a.played || 0);
  const bPlayed = Number(b.played || 0);
  if (aPlayed === 0 && bPlayed > 0) return 1;
  if (bPlayed === 0 && aPlayed > 0) return -1;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.diff !== a.diff) return b.diff - a.diff;
  if (a.losses !== b.losses) return a.losses - b.losses;
  if (b.triangulosFavor !== a.triangulosFavor) return b.triangulosFavor - a.triangulosFavor;
  return String(a.name || '').localeCompare(String(b.name || ''), 'es');
}

const HISTORIC_PLAYER_NAME_ALIASES = new Map([
  ['NAUEL AROVI', 'NAHUEL AROVI'],
  ['EDUARDO LOPEZ', 'JUAN EDUARDO LOPEZ'],
  ['VARGAS, CLAUDIO', 'CLAUDIO VARGAS'],
  ['BENITEZ, CRISTIAN JOAQUIN', 'CRISTIAN JOAQUIN BENITEZ'],
  ['BENITEZ CRISTIAN JOAQUIN', 'CRISTIAN JOAQUIN BENITEZ'],
  ['CRISTIAN BENITEZ', 'CRISTIAN JOAQUIN BENITEZ']
]);

const HISTORIC_PLAYER_CANONICAL_NAMES = new Set(HISTORIC_PLAYER_NAME_ALIASES.values());

function canonicalTeamPlayerNameKey(value = '') {
  const normalized = normalizeText(value);
  return HISTORIC_PLAYER_NAME_ALIASES.get(normalized) || normalized;
}

function sameCanonicalPlayerName(left = '', right = '') {
  const leftKey = canonicalTeamPlayerNameKey(left);
  return !!leftKey && leftKey === canonicalTeamPlayerNameKey(right);
}

function isKnownHistoricPlayerIdentity(value = '') {
  const normalized = normalizeText(value);
  return HISTORIC_PLAYER_NAME_ALIASES.has(normalized) || HISTORIC_PLAYER_CANONICAL_NAMES.has(normalized);
}

router.get('/team-query', requireAdminForPrivateCategory, async (req, res) => {
  setNoCache(res);
  try {
    const category = String(req.query.category || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim();
    const edition = normalizeEdition(req.query.edition, { allowTotal: false, defaultEdition: CURRENT_EDITION });

    if (!category) {
      return res.status(400).json({ ok: false, error: 'Seleccioná una categoría.' });
    }

    if (!q || normalizeText(q).length < 2) {
      return res.json({ ok: true, category, q, edition, editionLabel: getEditionLabel(edition), suggestions: [], team: null, players: [], totalRegisteredPlayers: 0, totalActivePlayers: 0 });
    }

    const teams = await findTeamsByCategory(category, {
      includeInactive: Number(edition) !== CURRENT_EDITION
    });
    const suggestions = teams
      .filter((team) => (
        includesNormalizedName(team.display_name, q) ||
        includesNormalizedName(team.slug_uid, q) ||
        includesNormalizedName(team.slug_base, q)
      ))
      .map((team) => ({
        name: team.display_name,
        teamSlug: team.slug_uid || team.slug_base,
        teamBase: team.slug_base,
        label: team.display_name,
        id: team.id
      }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
      .slice(0, 12);

    const exactSuggestion = suggestions.find((item) => sameNormalizedName(item.name, q));
    const exactTeam = exactSuggestion
      ? teams.find((team) => Number(team.id) === Number(exactSuggestion.id))
      : null;

    if (!exactTeam) {
      return res.json({ ok: true, category, q, edition, editionLabel: getEditionLabel(edition), suggestions, team: null, players: [], totalRegisteredPlayers: 0, totalActivePlayers: 0 });
    }

    const includeHistoricRoster = Number(edition) !== CURRENT_EDITION;
    const [registeredPlayers, rankingData, pairStats] = await Promise.all([
      getRegisteredPlayersForTeam(exactTeam.id, { includeInactive: includeHistoricRoster }),
      buildRadRankingForCategory(category, edition),
      getPairPlayerStatsForTeam(category, edition, exactTeam)
    ]);

    const { ranking: categoryRanking, radContext } = rankingData;
    const categoryPlayersByKey = new Map();

    categoryRanking.forEach((item) => {
      if (Number(item.id || 0)) {
        categoryPlayersByKey.set(`id:${Number(item.id)}`, item);
      }
      categoryPlayersByKey.set(`${normalizeText(item.name)}::${canonicalPlayerTeamSlug(item.teamSlug)}`, item);
    });

    const playersMap = new Map();
    const playerKeyById = new Map();
    const playerKeyByName = new Map();
    const ensureTeamPlayer = (playerInfo) => {
      const playerId = Number(playerInfo?.id || 0) || null;
      const playerName = String(playerInfo?.name || playerInfo || '').trim();
      const normalizedName = normalizeText(playerName);
      const identityName = canonicalTeamPlayerNameKey(playerName);
      if (!normalizedName) return null;
      const knownKey = (playerId ? playerKeyById.get(playerId) : null)
        || playerKeyByName.get(identityName)
        || null;
      const key = knownKey || (playerId ? `id:${playerId}` : `name:${identityName}`);
      const categoryNameKey = `${normalizedName}::${canonicalPlayerTeamSlug(exactTeam.slug_uid || exactTeam.slug_base)}`;
      const idCategoryRow = playerId ? categoryPlayersByKey.get(`id:${playerId}`) : null;
      const categoryRow = categoryPlayersByKey.get(categoryNameKey)
        || (idCategoryRow && teamInfoMatchesSide(exactTeam, idCategoryRow.teamSlug, idCategoryRow.teamName)
          ? idCategoryRow
          : null)
        || (Number(playerInfo?.played || 0) > 0 ? playerInfo : null);
      if (!playersMap.has(key)) {
        playersMap.set(key, categoryRow ? { ...categoryRow } : {
          id: playerId,
          name: playerName,
          teamSlug: exactTeam.slug_uid || exactTeam.slug_base,
          teamName: exactTeam.display_name,
          played: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          triangulosFavor: 0,
          triangulosContra: 0,
          diff: 0,
          effectiveness: 0,
          rad: 0,
          radPenalty: 0
        });
      } else if (categoryRow && Number(categoryRow.played || 0) > Number(playersMap.get(key).played || 0)) {
        const existing = playersMap.get(key);
        playersMap.set(key, {
          ...categoryRow,
          id: Number(existing?.id || categoryRow.id || 0) || null,
          name: String(existing?.name || categoryRow.name || '').trim()
        });
      }
      if (playerId) playerKeyById.set(playerId, key);
      playerKeyByName.set(identityName, key);
      return playersMap.get(key);
    };

    // La ficha actual del equipo no representa necesariamente su plantel en
    // ediciones anteriores. Para una edición histórica, la nómina se reconstruye
    // únicamente con quienes tienen resultados de esa edición.
    if (!includeHistoricRoster) {
      registeredPlayers.forEach(ensureTeamPlayer);
    }
    categoryRanking
      .filter((item) => teamInfoMatchesSide(exactTeam, item.teamSlug, item.teamName))
      .forEach(ensureTeamPlayer);

    const players = Array.from(playersMap.values()).sort(sortPlayerRadRows);
    const totalActivePlayers = players.filter((item) => Number(item.played || 0) > 0).length;
    const pairStatsById = new Map();
    const pairStatsByName = new Map();
    pairStats.forEach((item) => {
      if (Number(item.id || 0)) pairStatsById.set(Number(item.id), item);
      pairStatsByName.set(canonicalTeamPlayerNameKey(item.name), item);
    });
    const pairPlayers = players.map((player) => {
      const stats = pairStatsById.get(Number(player.id || 0))
        || pairStatsByName.get(canonicalTeamPlayerNameKey(player.name))
        || null;
      return stats ? {
        ...stats,
        id: Number(player.id || stats.id || 0) || null,
        name: player.name
      } : {
        id: Number(player.id || 0) || null,
        name: player.name,
        teamSlug: exactTeam.slug_uid || exactTeam.slug_base,
        teamName: exactTeam.display_name,
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        triangulosFavor: 0,
        triangulosContra: 0,
        diff: 0,
        effectiveness: 0
      };
    });
    pairStats.forEach((item) => {
      const exists = pairPlayers.some((player) => (
        (Number(player.id || 0) && Number(player.id) === Number(item.id))
        || canonicalTeamPlayerNameKey(player.name) === canonicalTeamPlayerNameKey(item.name)
      ));
      if (!exists) pairPlayers.push(item);
    });
    pairPlayers.sort(sortPlayerStatsRows);
    const totalActivePairPlayers = pairPlayers.filter((item) => Number(item.played || 0) > 0).length;

    return res.json({
      ok: true,
      category,
      q,
      edition,
      editionLabel: getEditionLabel(edition),
      suggestions,
      team: {
        id: exactTeam.id,
        name: exactTeam.display_name,
        teamSlug: exactTeam.slug_uid || exactTeam.slug_base,
        teamBase: exactTeam.slug_base
      },
      totalRegisteredPlayers: registeredPlayers.length,
      totalTeamPlayers: players.length,
      totalActivePlayers,
      totalActivePairPlayers,
      radContext,
      players,
      pairPlayers
    });
  } catch (err) {
    console.error('GET /team-query', err);
    return res.status(500).json({ ok: false, error: 'No se pudo consultar el equipo.' });
  }
});


module.exports = router;
module.exports.__test = {
  mergePlayerSuggestions,
  playerSuggestionTeamsMatch,
  samePlayerIdentity,
  sortPlayerMatchByDateAndRow,
  ensureRankingRowForPlayer,
  buildPlayerRowsFromResults
};
