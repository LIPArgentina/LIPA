const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../../db');
const { requireAdmin } = require('../middleware/auth');

module.exports = function createPlayersAdminRouter(deps = {}) {
  const router = express.Router();
  const playersRoot = path.join(deps.PICTURES_DIR || path.resolve(__dirname, '../../data/pictures'), 'players');
  let schemaReady = false;

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  function normalizeDni(value) {
    return String(value || '').replace(/\D/g, '').trim();
  }

  function normalizeCategory(value) {
    const v = String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (['segunda', '2da', '2'].includes(v)) return 'segunda';
    if (['tercera', '3ra', '3'].includes(v)) return 'tercera';
    if (v === 'primera' || v === '1ra' || v === '1') return 'primera';
    return v;
  }

  function normalizeBirthDate(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }

  function seasonStartDate(category) {
    const normalized = normalizeCategory(category);
    if (normalized === 'segunda') return '2026-03-16';
    if (normalized === 'tercera') return '2026-03-17';
    return null;
  }

  function safeName(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'jugador';
  }

  async function ensureSchema(client = pool) {
    if (schemaReady) return;

    await client.query(`
      CREATE TABLE IF NOT EXISTS jugadores (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        dni TEXT,
        fecha_nacimiento DATE,
        foto_path TEXT,
        nombre_normalizado TEXT,
        equipo_id INTEGER,
        dorsal TEXT,
        orden INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS dni TEXT`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS foto_path TEXT`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS nombre_normalizado TEXT`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS equipo_id INTEGER`);
    await client.query(`ALTER TABLE jugadores ALTER COLUMN equipo_id DROP NOT NULL`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS dorsal TEXT`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS orden INTEGER`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS jugador_equipos (
        id SERIAL PRIMARY KEY,
        jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
        equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
        categoria TEXT NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT true,
        desde DATE DEFAULT CURRENT_DATE,
        hasta DATE,
        orden INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_jugadores_dni ON jugadores (dni)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jugadores_nombre_norm ON jugadores (nombre_normalizado)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jugador_equipos_equipo ON jugador_equipos (equipo_id, categoria, activo)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jugador_equipos_jugador ON jugador_equipos (jugador_id)`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_jugador_categoria_activo
        ON jugador_equipos (jugador_id, categoria)
       WHERE activo = true
    `);

    await migrateLegacyPlayers(client);
    schemaReady = true;
  }

  async function migrateLegacyPlayers(client) {
    const legacy = await client.query(`
      SELECT
        j.id,
        j.equipo_id,
        j.nombre,
        j.dni,
        j.fecha_nacimiento,
        j.orden,
        e.division
      FROM jugadores j
      JOIN equipos e ON e.id = j.equipo_id
      WHERE j.equipo_id IS NOT NULL
        AND (
          NULLIF(j.nombre_normalizado, '') IS NULL
          OR NOT EXISTS (
            SELECT 1
              FROM jugador_equipos je
             WHERE je.jugador_id = j.id
               AND je.equipo_id = j.equipo_id
               AND je.categoria = COALESCE(e.division, 'sin_categoria')
          )
        )
      ORDER BY j.id ASC
    `);

    for (const row of legacy.rows) {
      const name = String(row.nombre || '').trim();
      const normalizedName = normalizeText(name);
      if (!row.id || !row.equipo_id || !name || !normalizedName) continue;

      await client.query(
        `UPDATE jugadores
            SET nombre_normalizado = COALESCE(NULLIF(nombre_normalizado, ''), $1),
                updated_at = NOW()
          WHERE id = $2`,
        [normalizedName, row.id]
      );

      await client.query(
        `INSERT INTO jugador_equipos
           (jugador_id, equipo_id, categoria, activo, desde, orden, created_at, updated_at)
         SELECT $1, $2, $3, true, COALESCE($5::date, CURRENT_DATE), $4, NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1
             FROM jugador_equipos
            WHERE jugador_id = $1
              AND equipo_id = $2
              AND categoria = $3
         )`,
        [row.id, row.equipo_id, row.division || 'sin_categoria', row.orden, seasonStartDate(row.division)]
      );
    }
  }

  async function resolveTeam(rawValue, category = '') {
    const value = String(rawValue || '').trim().toLowerCase();
    const division = normalizeCategory(category);
    if (!value) return null;

    const params = [value];
    let divisionFilter = '';
    if (division) {
      params.push(division);
      divisionFilter = 'AND LOWER(e.division) = $2';
    }

    const result = await pool.query(
      `
      SELECT DISTINCT e.id, e.slug_uid, e.slug_base, e.display_name, e.division
      FROM equipos e
      LEFT JOIN equipo_slug_aliases a ON a.equipo_id = e.id
      WHERE (
        LOWER(e.slug_uid) = $1
        OR LOWER(e.slug_base) = $1
        OR LOWER(e.display_name) = $1
        OR LOWER(a.alias_slug) = $1
      )
      ${divisionFilter}
      ORDER BY e.display_name ASC
      LIMIT 1
      `,
      params
    );

    return result.rows[0] || null;
  }

  function mapPlayer(row = {}) {
    return {
      id: row.id,
      nombre: row.nombre || '',
      name: row.nombre || '',
      dni: row.dni || '',
      fechaNacimiento: row.fecha_nacimiento || '',
      fecha_nacimiento: row.fecha_nacimiento || '',
      fotoPath: row.foto_path || '',
      fotoUrl: row.foto_path ? `/api/players-admin/photo/${encodeURIComponent(row.foto_path)}` : '',
      equipoId: row.equipo_id || null,
      equipo: row.equipo || '',
      teamName: row.equipo || '',
      teamSlug: row.slug_uid || '',
      categoria: row.categoria || '',
      associationId: row.association_id || null,
      activo: row.activo !== false,
    };
  }

  function canonicalPersonKey(row = {}) {
    const name = normalizeText(row.nombre_normalizado || row.nombre || '');
    if (name) return `name:${name}`;
    const dni = normalizeDni(row.dni || '');
    return dni ? `dni:${dni}` : `id:${row.id}`;
  }

  function associationSortValue(row = {}) {
    const desde = row.desde ? new Date(row.desde).getTime() : 0;
    return [
      row.activo === true ? 1 : 0,
      Number.isFinite(desde) ? desde : 0,
      Number(row.association_id || 0),
      Number(row.id || 0)
    ];
  }

  function compareAssociationRows(a = {}, b = {}) {
    const aa = associationSortValue(a);
    const bb = associationSortValue(b);
    for (let i = 0; i < aa.length; i++) {
      if (bb[i] !== aa[i]) return bb[i] - aa[i];
    }
    return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
  }

  function compareRepresentativeRows(a = {}, b = {}) {
    const score = (row) => [
      normalizeDni(row.dni) ? 1 : 0,
      row.foto_path ? 1 : 0,
      row.fecha_nacimiento ? 1 : 0,
      -(Number(row.id || 0))
    ];
    const aa = score(a);
    const bb = score(b);
    for (let i = 0; i < aa.length; i++) {
      if (bb[i] !== aa[i]) return bb[i] - aa[i];
    }
    return 0;
  }

  function canonicalizePlayerRows(rows = [], { category = '', teamId = null, currentByCategory = false } = {}) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = canonicalPersonKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    const out = [];
    for (const groupRows of groups.values()) {
      const representative = [...groupRows].sort(compareRepresentativeRows)[0] || groupRows[0];
      const activeRows = groupRows
        .filter((row) => row.association_id && row.activo !== false)
        .sort(compareAssociationRows);

      let displayAssociation = activeRows[0] || groupRows.find((row) => row.association_id) || representative;

      if (currentByCategory) {
        const normalizedCategory = normalizeCategory(category);
        const current = activeRows
          .filter((row) => normalizeCategory(row.categoria) === normalizedCategory)
          .sort(compareAssociationRows)[0] || null;
        if (!current || (teamId && Number(current.equipo_id) !== Number(teamId))) continue;
        displayAssociation = current;
      }

      out.push(mapPlayer({
        ...representative,
        association_id: displayAssociation.association_id,
        categoria: displayAssociation.categoria,
        activo: displayAssociation.activo,
        equipo_id: displayAssociation.equipo_id,
        equipo: displayAssociation.equipo,
        slug_uid: displayAssociation.slug_uid
      }));
    }

    return out.sort((a, b) =>
      String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es') ||
      String(a.equipo || '').localeCompare(String(b.equipo || ''), 'es')
    );
  }

  function dedupeHistoryRows(rows = []) {
    const map = new Map();
    rows.forEach((row) => {
      const key = [
        normalizeCategory(row.categoria),
        String(row.slug_uid || row.equipo || '').toLowerCase(),
        row.activo ? '1' : '0'
      ].join('::');
      const existing = map.get(key);
      if (!existing || compareAssociationRows(row, existing) < 0) {
        map.set(key, row);
      }
    });
    return Array.from(map.values()).sort(compareAssociationRows);
  }

  async function findPlayerByIdentity(client, { dni = '', normalizedName = '', playerId = null } = {}) {
    const result = await client.query(
      `
      SELECT id
      FROM jugadores
      WHERE ($1 <> '' AND dni = $1)
         OR ($2 <> '' AND nombre_normalizado = $2)
         OR ($3::int IS NOT NULL AND id = $3::int)
      ORDER BY
        CASE WHEN $1 <> '' AND dni = $1 THEN 0 ELSE 1 END,
        CASE WHEN foto_path IS NOT NULL AND foto_path <> '' THEN 0 ELSE 1 END,
        CASE WHEN fecha_nacimiento IS NOT NULL THEN 0 ELSE 1 END,
        id ASC
      LIMIT 1
      `,
      [normalizeDni(dni), normalizeText(normalizedName), playerId]
    );
    return result.rows[0]?.id || null;
  }

  async function validateAssociation(client, { playerId, category, teamId, associationId = null }) {
    const active = await client.query(
      `
      SELECT
        je.id,
        je.categoria,
        je.equipo_id,
        e.display_name AS equipo
      FROM jugador_equipos je
      JOIN equipos e ON e.id = je.equipo_id
      WHERE je.jugador_id = $1
        AND je.activo = true
        AND ($2::int IS NULL OR je.id <> $2::int)
      `,
      [playerId, associationId]
    );

    const current = active.rows.map(row => ({
      ...row,
      categoria: normalizeCategory(row.categoria),
    }));
    const targetCategory = normalizeCategory(category);

    if (current.some(row => row.categoria === targetCategory && Number(row.equipo_id) !== Number(teamId))) {
      throw new Error(`El jugador ya está activo en ${targetCategory} con otro equipo.`);
    }

    if (targetCategory === 'tercera' && current.some(row => row.categoria === 'segunda')) {
      throw new Error('Un jugador de 2da no puede jugar en 3ra.');
    }

  }

  async function upsertAssociation(client, { playerId, teamId, category, associationId = null }) {
    const normalizedCategory = normalizeCategory(category);
    const startDate = seasonStartDate(normalizedCategory) || new Date().toISOString().slice(0, 10);

    if (associationId) {
      const current = await client.query(
        `SELECT equipo_id, categoria
           FROM jugador_equipos
          WHERE id = $1
            AND jugador_id = $2
          LIMIT 1`,
        [associationId, playerId]
      );
      const currentRow = current.rows[0] || null;
      if (
        currentRow &&
        normalizeCategory(currentRow.categoria) === normalizedCategory &&
        Number(currentRow.equipo_id) === Number(teamId)
      ) {
        await validateAssociation(client, { playerId, category: normalizedCategory, teamId, associationId });
      } else {
        associationId = null;
      }
    }

    if (associationId) {
      const updated = await client.query(
        `UPDATE jugador_equipos
            SET equipo_id = $1,
                categoria = $2,
                activo = true,
                hasta = NULL,
                updated_at = NOW()
          WHERE id = $3
            AND jugador_id = $4
          RETURNING id`,
        [teamId, normalizedCategory, associationId, playerId]
      );
      if (updated.rows[0]?.id) return updated.rows[0].id;
    }

    const same = await client.query(
      `SELECT id
         FROM jugador_equipos
        WHERE jugador_id = $1
          AND equipo_id = $2
          AND categoria = $3
          AND activo = true
        ORDER BY id DESC
        LIMIT 1`,
      [playerId, teamId, normalizedCategory]
    );
    if (same.rows[0]?.id) return same.rows[0].id;

    await client.query(
      `UPDATE jugador_equipos
          SET activo = false,
              hasta = ($4::date - INTERVAL '1 day')::date,
              updated_at = NOW()
        WHERE jugador_id = $1
          AND categoria = $2
          AND activo = true
          AND equipo_id <> $3`,
      [playerId, normalizedCategory, teamId, startDate]
    );

    const inserted = await client.query(
      `INSERT INTO jugador_equipos
         (jugador_id, equipo_id, categoria, activo, desde, created_at, updated_at)
       VALUES ($1, $2, $3, true, $4::date, NOW(), NOW())
       RETURNING id`,
      [playerId, teamId, normalizedCategory, startDate]
    );
    return inserted.rows[0]?.id || null;
  }

  async function findPlayerByDni(client, dni) {
    const result = await client.query(`SELECT id FROM jugadores WHERE dni = $1 ORDER BY id ASC LIMIT 1`, [dni]);
    return result.rows[0]?.id || null;
  }

  async function readPlayer(playerId) {
    await ensureSchema();
    const result = await pool.query(
      `
      SELECT
        j.id,
        j.nombre,
        j.dni,
        TO_CHAR(j.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
        j.foto_path,
        je.id AS association_id,
        je.categoria,
        je.activo,
        e.id AS equipo_id,
        e.display_name AS equipo,
        e.slug_uid
      FROM jugadores j
      LEFT JOIN jugador_equipos je
        ON je.jugador_id = j.id
       AND je.activo = true
      LEFT JOIN equipos e ON e.id = je.equipo_id
      WHERE j.id = $1
      ORDER BY je.categoria ASC NULLS LAST, e.display_name ASC NULLS LAST
      `,
      [playerId]
    );
    return result.rows.map(mapPlayer);
  }

  const storage = multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await fs.promises.mkdir(playersRoot, { recursive: true });
        cb(null, playersRoot);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const dni = normalizeDni(req.body?.dni);
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const base = safeName(`${dni || 'jugador'}_${Date.now()}`);
      cb(null, `${base}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const mimetype = String(file.mimetype || '').toLowerCase();
      const ext = path.extname(file.originalname || '').toLowerCase();
      const allowedByMime = mimetype.startsWith('image/');
      const allowedByExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
      if (!allowedByMime && !allowedByExt) return cb(new Error('Solo se permiten imágenes JPG, PNG o WebP'));
      cb(null, true);
    }
  });

  router.get('/players-public/search', async (req, res) => {
    try {
      await ensureSchema();
      const q = String(req.query.q || '').trim();
      const dni = normalizeDni(q);
      const name = normalizeText(q);
      if (!q || q.length < 2) return res.json({ ok: true, players: [] });

      const result = await pool.query(
        `
        SELECT
          j.id,
          j.nombre,
          j.dni,
          TO_CHAR(j.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
          j.foto_path,
          j.nombre_normalizado,
          je.id AS association_id,
          je.categoria,
          je.activo,
          je.desde,
          je.hasta,
          e.id AS equipo_id,
          e.display_name AS equipo,
          e.slug_uid
        FROM jugadores j
        LEFT JOIN jugador_equipos je
          ON je.jugador_id = j.id
         AND je.activo = true
        LEFT JOIN equipos e ON e.id = je.equipo_id
        WHERE
          ($1 <> '' AND j.dni ILIKE $1 || '%')
          OR ($2 <> '' AND j.nombre_normalizado ILIKE '%' || $2 || '%')
          OR ($3 <> '' AND LOWER(j.nombre) ILIKE '%' || LOWER($3) || '%')
        ORDER BY j.nombre ASC, je.categoria ASC NULLS LAST
        LIMIT 80
        `,
        [dni, name, q]
      );

      return res.json({ ok: true, players: canonicalizePlayerRows(result.rows) });
    } catch (err) {
      console.error('players-public/search', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/players-public/by-team', async (req, res) => {
    try {
      await ensureSchema();
      const category = normalizeCategory(req.query.category || '');
      const rawTeam = String(req.query.team || '').trim();
      const team = await resolveTeam(rawTeam, category);
      if (!team) return res.status(404).json({ ok: false, error: 'Equipo no encontrado' });

      const result = await pool.query(
        `
        WITH active_rows AS (
          SELECT
            j.id,
            j.nombre,
            j.dni,
            TO_CHAR(j.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
            j.foto_path,
            j.nombre_normalizado,
            je.id AS association_id,
            je.categoria,
            je.activo,
            je.desde,
            je.hasta,
            e.id AS equipo_id,
            e.display_name AS equipo,
            e.slug_uid,
            'name:' || COALESCE(NULLIF(j.nombre_normalizado, ''), LOWER(j.nombre)) AS person_key
          FROM jugador_equipos je
          JOIN jugadores j ON j.id = je.jugador_id
          JOIN equipos e ON e.id = je.equipo_id
          WHERE je.activo = true
            AND ($2 = '' OR je.categoria = $2)
        ),
        candidate_keys AS (
          SELECT DISTINCT person_key
          FROM active_rows
          WHERE equipo_id = $1
        )
        SELECT
          id, nombre, dni, fecha_nacimiento, foto_path, nombre_normalizado,
          association_id, categoria, activo, desde, hasta, equipo_id, equipo, slug_uid
        FROM active_rows
        WHERE person_key IN (SELECT person_key FROM candidate_keys)
        ORDER BY nombre ASC, desde DESC NULLS LAST, association_id DESC
        `,
        [team.id, category]
      );

      return res.json({
        ok: true,
        team,
        players: canonicalizePlayerRows(result.rows, {
          category,
          teamId: team.id,
          currentByCategory: true
        })
      });
    } catch (err) {
      console.error('players-public/by-team', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/players-public/history/:id', async (req, res) => {
    try {
      await ensureSchema();
      const playerId = Number(req.params.id);
      if (!Number.isFinite(playerId)) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const current = await pool.query(
        `
        SELECT id, dni, nombre_normalizado, nombre
        FROM jugadores
        WHERE id = $1
        LIMIT 1
        `,
        [playerId]
      );

      const player = current.rows[0] || null;
      if (!player) return res.status(404).json({ ok: false, error: 'Jugador no encontrado' });

      const dni = normalizeDni(player.dni || '');
      const normalizedName = normalizeText(player.nombre_normalizado || player.nombre || '');
      const result = await pool.query(
        `
        SELECT
          je.id,
          j.id AS jugador_id,
          j.nombre,
          j.dni,
          j.nombre_normalizado,
          je.categoria,
          je.activo,
          je.desde AS desde_raw,
          TO_CHAR(je.desde, 'YYYY-MM-DD') AS desde,
          TO_CHAR(je.hasta, 'YYYY-MM-DD') AS hasta,
          TO_CHAR(je.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
          TO_CHAR(je.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at,
          e.display_name AS equipo,
          e.slug_uid
        FROM jugador_equipos je
        JOIN jugadores j ON j.id = je.jugador_id
        JOIN equipos e ON e.id = je.equipo_id
        WHERE (
          ($2 <> '' AND j.dni = $2)
          OR ($3 <> '' AND COALESCE(j.nombre_normalizado, '') = $3)
          OR j.id = $1
        )
        ORDER BY je.activo DESC, je.desde DESC NULLS LAST, je.id DESC
        `,
        [playerId, dni, normalizedName]
      );

      return res.json({ ok: true, history: dedupeHistoryRows(result.rows) });
    } catch (err) {
      console.error('players-public/history', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/players-admin/search', requireAdmin, async (req, res) => {
    try {
      await ensureSchema();
      const q = String(req.query.q || '').trim();
      const dni = normalizeDni(q);
      const name = normalizeText(q);
      if (!q || q.length < 2) return res.json({ ok: true, players: [] });

      const result = await pool.query(
        `
        SELECT
          j.id,
          j.nombre,
          j.dni,
          TO_CHAR(j.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
          j.foto_path,
          j.nombre_normalizado,
          je.id AS association_id,
          je.categoria,
          je.activo,
          je.desde,
          je.hasta,
          e.id AS equipo_id,
          e.display_name AS equipo,
          e.slug_uid
        FROM jugadores j
        LEFT JOIN jugador_equipos je
          ON je.jugador_id = j.id
         AND je.activo = true
        LEFT JOIN equipos e ON e.id = je.equipo_id
        WHERE
          ($1 <> '' AND j.dni ILIKE $1 || '%')
          OR ($2 <> '' AND j.nombre_normalizado ILIKE '%' || $2 || '%')
          OR ($3 <> '' AND LOWER(j.nombre) ILIKE '%' || LOWER($3) || '%')
        ORDER BY j.nombre ASC, je.categoria ASC NULLS LAST
        LIMIT 80
        `,
        [dni, name, q]
      );

      return res.json({ ok: true, players: canonicalizePlayerRows(result.rows) });
    } catch (err) {
      console.error('players-admin/search', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/players-admin/by-team', requireAdmin, async (req, res) => {
    try {
      await ensureSchema();
      const category = normalizeCategory(req.query.category || '');
      const rawTeam = String(req.query.team || '').trim();
      const team = await resolveTeam(rawTeam, category);
      if (!team) return res.status(404).json({ ok: false, error: 'Equipo no encontrado' });

      const result = await pool.query(
        `
        WITH active_rows AS (
          SELECT
            j.id,
            j.nombre,
            j.dni,
            TO_CHAR(j.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
            j.foto_path,
            j.nombre_normalizado,
            je.id AS association_id,
            je.categoria,
            je.activo,
            je.desde,
            je.hasta,
            e.id AS equipo_id,
            e.display_name AS equipo,
            e.slug_uid,
            'name:' || COALESCE(NULLIF(j.nombre_normalizado, ''), LOWER(j.nombre)) AS person_key
          FROM jugador_equipos je
          JOIN jugadores j ON j.id = je.jugador_id
          JOIN equipos e ON e.id = je.equipo_id
          WHERE je.activo = true
            AND ($2 = '' OR je.categoria = $2)
        ),
        candidate_keys AS (
          SELECT DISTINCT person_key
          FROM active_rows
          WHERE equipo_id = $1
        )
        SELECT
          id, nombre, dni, fecha_nacimiento, foto_path, nombre_normalizado,
          association_id, categoria, activo, desde, hasta, equipo_id, equipo, slug_uid
        FROM active_rows
        WHERE person_key IN (SELECT person_key FROM candidate_keys)
        ORDER BY nombre ASC, desde DESC NULLS LAST, association_id DESC
        `,
        [team.id, category]
      );

      return res.json({
        ok: true,
        team,
        players: canonicalizePlayerRows(result.rows, {
          category,
          teamId: team.id,
          currentByCategory: true
        })
      });
    } catch (err) {
      console.error('players-admin/by-team', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/players-admin/history/:id', requireAdmin, async (req, res) => {
    try {
      await ensureSchema();
      const playerId = Number(req.params.id);
      if (!Number.isFinite(playerId)) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const current = await pool.query(
        `
        SELECT id, dni, nombre_normalizado, nombre
        FROM jugadores
        WHERE id = $1
        LIMIT 1
        `,
        [playerId]
      );

      const player = current.rows[0] || null;
      if (!player) return res.status(404).json({ ok: false, error: 'Jugador no encontrado' });

      const dni = normalizeDni(player.dni || '');
      const normalizedName = normalizeText(player.nombre_normalizado || player.nombre || '');
      const result = await pool.query(
        `
        SELECT
          je.id,
          j.id AS jugador_id,
          j.nombre,
          j.dni,
          j.nombre_normalizado,
          je.categoria,
          je.activo,
          je.desde AS desde_raw,
          TO_CHAR(je.desde, 'YYYY-MM-DD') AS desde,
          TO_CHAR(je.hasta, 'YYYY-MM-DD') AS hasta,
          TO_CHAR(je.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
          TO_CHAR(je.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at,
          e.display_name AS equipo,
          e.slug_uid
        FROM jugador_equipos je
        JOIN jugadores j ON j.id = je.jugador_id
        JOIN equipos e ON e.id = je.equipo_id
        WHERE (
          ($2 <> '' AND j.dni = $2)
          OR ($3 <> '' AND COALESCE(j.nombre_normalizado, '') = $3)
          OR j.id = $1
        )
        ORDER BY je.activo DESC, je.desde DESC NULLS LAST, je.id DESC
        `,
        [playerId, dni, normalizedName]
      );

      return res.json({ ok: true, history: dedupeHistoryRows(result.rows) });
    } catch (err) {
      console.error('players-admin/history', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/players-admin/save', requireAdmin, (req, res) => {
    upload.single('foto')(req, res, async (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message || 'No se pudo subir la foto' });

      const client = await pool.connect();
      try {
        await ensureSchema();
        const playerId = req.body?.id ? Number(req.body.id) : null;
        const associationId = req.body?.associationId ? Number(req.body.associationId) : null;
        const nombre = String(req.body?.nombre || req.body?.name || '').trim();
        const dni = normalizeDni(req.body?.dni);
        const fechaNacimientoRaw = String(req.body?.fechaNacimiento || req.body?.fecha_nacimiento || '').trim();
        const fechaNacimiento = normalizeBirthDate(fechaNacimientoRaw);
        const categoria = normalizeCategory(req.body?.categoria);
        const teamRaw = String(req.body?.team || req.body?.teamSlug || req.body?.equipo || '').trim();

        if (!nombre) return res.status(400).json({ ok: false, error: 'Falta nombre' });
        if (fechaNacimientoRaw && !fechaNacimiento) return res.status(400).json({ ok: false, error: 'La fecha de nacimiento no es válida' });
        if (teamRaw && !categoria) return res.status(400).json({ ok: false, error: 'Falta categoría' });

        const team = teamRaw ? await resolveTeam(teamRaw, categoria) : null;
        if (teamRaw && !team) return res.status(404).json({ ok: false, error: 'Equipo no encontrado para esa categoría' });

        await client.query('BEGIN');

        let finalPlayerId = Number.isFinite(playerId) ? playerId : null;
        if (dni) {
          const dniOwner = await client.query(
            `SELECT id FROM jugadores WHERE dni = $1 ORDER BY id ASC LIMIT 1`,
            [dni]
          );
          const ownerId = dniOwner.rows[0]?.id || null;
          if (ownerId && finalPlayerId && Number(ownerId) !== Number(finalPlayerId)) {
            throw new Error('Ese DNI ya pertenece a otro jugador.');
          }
          if (ownerId && !finalPlayerId) finalPlayerId = ownerId;
        }

        if (!finalPlayerId) {
          finalPlayerId = await findPlayerByIdentity(client, {
            normalizedName: normalizeText(nombre)
          });
        }

        const fotoPath = req.file?.filename || null;
        if (finalPlayerId) {
          await client.query(
            `UPDATE jugadores
                SET nombre = $1,
                    dni = COALESCE(NULLIF($2, ''), dni),
                    fecha_nacimiento = COALESCE($3::date, fecha_nacimiento),
                    nombre_normalizado = $4,
                    foto_path = COALESCE($5, foto_path),
                    updated_at = NOW()
              WHERE id = $6`,
            [nombre, dni, fechaNacimiento, normalizeText(nombre), fotoPath, finalPlayerId]
          );
        } else {
          const inserted = await client.query(
            `INSERT INTO jugadores
               (nombre, dni, fecha_nacimiento, foto_path, nombre_normalizado, created_at, updated_at)
             VALUES ($1, NULLIF($2, ''), $3::date, $4, $5, NOW(), NOW())
             RETURNING id`,
            [nombre, dni, fechaNacimiento, fotoPath, normalizeText(nombre)]
          );
          finalPlayerId = inserted.rows[0].id;
        }

        if (team) {
          await upsertAssociation(client, {
            playerId: finalPlayerId,
            teamId: team.id,
            category: categoria,
            associationId,
          });
        }

        await client.query('COMMIT');
        const players = await readPlayer(finalPlayerId);
        return res.json({ ok: true, player: players[0] || null, associations: players });
      } catch (saveErr) {
        await client.query('ROLLBACK');
        if (req.file?.path) {
          try { await fs.promises.unlink(req.file.path); } catch (_) {}
        }
        console.error('players-admin/save', saveErr);
        return res.status(400).json({ ok: false, error: saveErr.message || 'No se pudo guardar el jugador' });
      } finally {
        client.release();
      }
    });
  });

  router.post('/players-admin/deactivate-association', requireAdmin, async (req, res) => {
    try {
      await ensureSchema();
      const associationId = Number(req.body?.associationId);
      if (!Number.isFinite(associationId)) return res.status(400).json({ ok: false, error: 'Asociación inválida' });
      await pool.query(
        `UPDATE jugador_equipos
            SET activo = false,
                hasta = CURRENT_DATE,
                updated_at = NOW()
          WHERE id = $1`,
        [associationId]
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('players-admin/deactivate', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/players-admin/photo/:filename', async (req, res) => {
    try {
      const safe = safeName(path.basename(req.params.filename || ''));
      if (!safe) return res.status(400).end();
      const root = path.resolve(playersRoot);
      const fullPath = path.resolve(path.join(root, safe));
      if (!fullPath.startsWith(root + path.sep) && fullPath !== root) return res.status(400).end();
      await fs.promises.access(fullPath, fs.constants.R_OK);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.sendFile(fullPath);
    } catch {
      return res.status(404).end();
    }
  });

  return router;
};
