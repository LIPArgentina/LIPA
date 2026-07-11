const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireTeam, requireAdmin } = require('../middleware/auth');
const pool = require('../../db');

module.exports = function createTeamPlayersRouter(deps = {}) {
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

  function normalizeBirthDate(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }

  function safeName(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'jugador';
  }

  async function ensurePlayerSchema(client = pool) {
    if (schemaReady) return;

    await client.query(`
      CREATE TABLE IF NOT EXISTS jugadores (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        dni TEXT,
        fecha_nacimiento DATE,
        foto_path TEXT,
        nombre_normalizado TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS equipo_id INTEGER`);
    await client.query(`ALTER TABLE jugadores ALTER COLUMN equipo_id DROP NOT NULL`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS dorsal TEXT`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS orden INTEGER`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS dni TEXT`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS foto_path TEXT`);
    await client.query(`ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS nombre_normalizado TEXT`);
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
    await client.query(`ALTER TABLE jugador_equipos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true`);
    await client.query(`ALTER TABLE jugador_equipos ADD COLUMN IF NOT EXISTS desde DATE DEFAULT CURRENT_DATE`);
    await client.query(`ALTER TABLE jugador_equipos ADD COLUMN IF NOT EXISTS hasta DATE`);
    await client.query(`ALTER TABLE jugador_equipos ADD COLUMN IF NOT EXISTS orden INTEGER`);
    await client.query(`ALTER TABLE jugador_equipos ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await client.query(`ALTER TABLE jugador_equipos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_jugadores_dni ON jugadores (dni)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jugadores_nombre_norm ON jugadores (nombre_normalizado)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jugador_equipos_equipo ON jugador_equipos (equipo_id, categoria, activo)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jugador_equipos_jugador ON jugador_equipos (jugador_id)`);

    await migrateLegacyPlayers(client);
    schemaReady = true;
  }

  async function migrateLegacyPlayers(client) {
    const associationCount = await client.query(`SELECT COUNT(*)::int AS total FROM jugador_equipos`);
    if (Number(associationCount.rows[0]?.total || 0) > 0) return;

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
      LEFT JOIN equipos e ON e.id = j.equipo_id
      WHERE j.equipo_id IS NOT NULL
      ORDER BY j.id ASC
    `);

    const canonicalByKey = new Map();
    const duplicateIds = [];
    const canonicalIds = new Set();

    for (const row of legacy.rows) {
      const name = String(row.nombre || '').trim();
      const dni = normalizeDni(row.dni);
      const normalizedName = normalizeText(name);
      const key = dni ? `dni:${dni}` : `name:${normalizedName}`;
      if (!name || !normalizedName || !row.equipo_id) continue;

      let jugadorId = canonicalByKey.get(key);
      if (!jugadorId) {
        jugadorId = row.id;
        canonicalByKey.set(key, jugadorId);
        canonicalIds.add(jugadorId);
        await client.query(
          `UPDATE jugadores
              SET nombre = $1,
                  dni = NULLIF($2, ''),
                  fecha_nacimiento = COALESCE($3::date, fecha_nacimiento),
                  nombre_normalizado = $4,
                  updated_at = NOW()
            WHERE id = $5`,
          [name, dni, normalizeBirthDate(row.fecha_nacimiento), normalizedName, jugadorId]
        );
      } else if (jugadorId !== row.id) {
        duplicateIds.push(row.id);
      }

      await client.query(
        `INSERT INTO jugador_equipos
           (jugador_id, equipo_id, categoria, activo, orden, created_at, updated_at)
         VALUES ($1, $2, $3, true, $4, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [jugadorId, row.equipo_id, row.division || 'sin_categoria', row.orden]
      );
    }

    if (canonicalIds.size) {
      await client.query(
        `UPDATE jugadores
            SET equipo_id = NULL,
                orden = NULL,
                updated_at = NOW()
          WHERE id = ANY($1::int[])`,
        [Array.from(canonicalIds)]
      );
    }

    if (duplicateIds.length) {
      await client.query(`DELETE FROM jugadores WHERE id = ANY($1::int[])`, [duplicateIds]);
    }
  }

  async function resolveTeam(rawValue) {
    const value = String(rawValue || '').trim();
    const lower = value.toLowerCase();
    if (!lower) return null;

    await pool.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS subcaptain TEXT`);

    const result = await pool.query(
      `
      SELECT DISTINCT e.id, e.slug_uid, e.slug_base, e.display_name, e.division, e.captain, e.subcaptain
      FROM equipos e
      LEFT JOIN equipo_slug_aliases a
        ON a.equipo_id = e.id
      WHERE
        LOWER(e.slug_uid) = $1
        OR LOWER(e.slug_base) = $1
        OR LOWER(e.display_name) = $1
        OR LOWER(a.alias_slug) = $1
      LIMIT 1
      `,
      [lower]
    );

    return result.rows[0] || null;
  }

  async function fetchPlayerDetailsForTeam(teamId) {
    await ensurePlayerSchema();

    const result = await pool.query(
      `
      SELECT
        j.id,
        j.nombre,
        j.dni,
        TO_CHAR(j.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
        j.foto_path,
        je.orden
      FROM jugador_equipos je
      JOIN jugadores j ON j.id = je.jugador_id
      WHERE je.equipo_id = $1
        AND je.activo = true
      ORDER BY je.orden ASC NULLS LAST, j.nombre ASC, j.id ASC
      `,
      [teamId]
    );

    return result.rows.map(r => ({
      id: r.id,
      name: r.nombre,
      nombre: r.nombre,
      dni: r.dni || '',
      birthDate: r.fecha_nacimiento || '',
      fechaNacimiento: r.fecha_nacimiento || '',
      fecha_nacimiento: r.fecha_nacimiento || '',
      fotoPath: r.foto_path || '',
      fotoUrl: r.foto_path ? `/api/players-admin/photo/${encodeURIComponent(r.foto_path)}` : '',
      orden: r.orden || null,
    }));
  }

  function normalizePlayers(input) {
    if (!Array.isArray(input)) return [];

    return input
      .map(item => {
        if (typeof item === 'string') {
          return { name: item.trim(), dni: '', birthDate: null };
        }

        const name = String(item?.name || item?.nombre || '').trim();
        return {
          id: item?.id || null,
          name,
          dni: normalizeDni(item?.dni),
          birthDate: normalizeBirthDate(
            item?.birthDate ||
            item?.fechaNacimiento ||
            item?.fecha_nacimiento
          ),
        };
      })
      .filter(item => item.name);
  }

  async function findOrCreatePlayer(client, player) {
    const name = String(player.name || '').trim();
    const dni = normalizeDni(player.dni);
    const normalizedName = normalizeText(name);
    const birthDate = normalizeBirthDate(player.birthDate);

    if (!name || !normalizedName) return null;

    let existing;
    if (dni) {
      existing = await client.query(
        `SELECT id FROM jugadores WHERE dni = $1 ORDER BY id ASC LIMIT 1`,
        [dni]
      );
    } else {
      existing = await client.query(
        `SELECT id
           FROM jugadores
          WHERE dni IS NULL
            AND nombre_normalizado = $1
          ORDER BY id ASC
          LIMIT 1`,
        [normalizedName]
      );
    }

    const foundId = existing.rows[0]?.id;
    if (foundId) {
      await client.query(
        `UPDATE jugadores
            SET nombre = $1,
                dni = COALESCE(NULLIF($2, ''), dni),
                fecha_nacimiento = COALESCE($3::date, fecha_nacimiento),
                nombre_normalizado = $4,
                updated_at = NOW()
          WHERE id = $5`,
        [name, dni, birthDate, normalizedName, foundId]
      );
      return foundId;
    }

    const inserted = await client.query(
      `INSERT INTO jugadores
         (nombre, dni, fecha_nacimiento, nombre_normalizado, created_at, updated_at)
       VALUES ($1, NULLIF($2, ''), $3::date, $4, NOW(), NOW())
       RETURNING id`,
      [name, dni, birthDate, normalizedName]
    );

    return inserted.rows[0]?.id || null;
  }

  async function replacePlayers(team, players, client = pool) {
    await ensurePlayerSchema();

    await client.query(
      `DELETE FROM jugador_equipos WHERE equipo_id = $1 AND categoria = $2`,
      [team.id, team.division || 'sin_categoria']
    );

    let orden = 1;
    for (const player of players) {
      const jugadorId = await findOrCreatePlayer(client, player);
      if (!jugadorId) continue;

      await client.query(
        `INSERT INTO jugador_equipos
           (jugador_id, equipo_id, categoria, activo, orden, created_at, updated_at)
         VALUES ($1, $2, $3, true, $4, NOW(), NOW())`,
        [jugadorId, team.id, team.division || 'sin_categoria', orden]
      );
      orden++;
    }
  }

  function buildResponse(team, playerDetails) {
    const details = Array.isArray(playerDetails) ? playerDetails : [];
    return {
      ok: true,
      slug: team.slug_base,
      slug_uid: team.slug_uid,
      teamName: team.display_name,
      division: team.division,
      captain: team.captain || '',
      subcaptain: team.subcaptain || '',
      captains: [team.captain || '', team.subcaptain || ''].filter(Boolean),
      players: details.map(item => item.name || item.nombre).filter(Boolean),
      playerDetails: details,
    };
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

  router.get('/team-assets', async (req, res) => {
    try {
      const raw = String(req.query.team || '').trim();
      if (!raw) return res.status(400).json({ ok: false, players: [] });

      const team = await resolveTeam(raw);
      if (!team) return res.status(404).json({ ok: false, players: [] });

      const players = await fetchPlayerDetailsForTeam(team.id);
      return res.json(buildResponse(team, players));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/save-team-assets', requireAdmin, async (req, res) => {
    const client = await pool.connect();

    try {
      const rawTeam =
        req.body?.team ??
        req.body?.slug ??
        req.body?.slug_uid ??
        req.body?.teamName ??
        '';

      const players = normalizePlayers(
        req.body?.players ??
        req.body?.jugadores ??
        req.body?.roster ??
        []
      );

      if (!rawTeam) {
        return res.status(400).json({ ok: false, error: 'Falta team' });
      }

      const team = await resolveTeam(rawTeam);
      if (!team) {
        return res.status(404).json({ ok: false, error: rawTeam });
      }

      await ensurePlayerSchema();
      await client.query('BEGIN');
      await replacePlayers(team, players, client);
      await client.query('COMMIT');

      const savedPlayers = await fetchPlayerDetailsForTeam(team.id);
      return res.json(buildResponse(team, savedPlayers));
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      return res.status(500).json({ ok: false, error: err.message });
    } finally {
      client.release();
    }
  });

  router.get('/team/players', requireTeam, async (req, res) => {
    try {
      const slug = req.user.slug;
      const team = await resolveTeam(slug);

      if (!team) return res.status(404).json({ ok: false });

      const players = await fetchPlayerDetailsForTeam(team.id);
      return res.json(buildResponse(team, players));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false });
    }
  });

  router.post('/team/player-profile', requireTeam, (req, res) => {
    upload.single('foto')(req, res, async (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message || 'No se pudo subir la foto' });

      try {
        await ensurePlayerSchema();
        const playerId = Number(req.body?.id);
        const dni = normalizeDni(req.body?.dni);
        const fechaNacimiento = normalizeBirthDate(req.body?.fechaNacimiento || req.body?.fecha_nacimiento);

        if (!Number.isFinite(playerId) || playerId <= 0) {
          return res.status(400).json({ ok: false, error: 'Jugador inválido' });
        }
        if (!dni) return res.status(400).json({ ok: false, error: 'El DNI es obligatorio' });
        if (!fechaNacimiento) return res.status(400).json({ ok: false, error: 'La fecha de nacimiento es obligatoria' });

        const team = await resolveTeam(req.user.slug);
        if (!team) return res.status(404).json({ ok: false, error: 'Equipo no encontrado' });

        const belongs = await pool.query(
          `SELECT 1
             FROM jugador_equipos
            WHERE jugador_id = $1
              AND equipo_id = $2
              AND activo = true
            LIMIT 1`,
          [playerId, team.id]
        );
        if (!belongs.rows.length) {
          return res.status(403).json({ ok: false, error: 'Ese jugador no pertenece a tu equipo' });
        }

        const dniOwner = await pool.query(
          `SELECT id FROM jugadores WHERE dni = $1 AND id <> $2 LIMIT 1`,
          [dni, playerId]
        );
        if (dniOwner.rows.length) {
          return res.status(400).json({ ok: false, error: 'Ese DNI ya pertenece a otro jugador' });
        }

        const fotoPath = req.file?.filename || null;
        await pool.query(
          `UPDATE jugadores
              SET dni = $1,
                  fecha_nacimiento = $2::date,
                  foto_path = COALESCE($3, foto_path),
                  updated_at = NOW()
            WHERE id = $4`,
          [dni, fechaNacimiento, fotoPath, playerId]
        );

        const players = await fetchPlayerDetailsForTeam(team.id);
        const player = players.find(item => Number(item.id) === playerId) || null;
        return res.json({ ok: true, player, players, ...buildResponse(team, players) });
      } catch (saveErr) {
        if (req.file?.path) {
          try { await fs.promises.unlink(req.file.path); } catch (_) {}
        }
        console.error('POST /team/player-profile', saveErr);
        return res.status(400).json({ ok: false, error: saveErr.message || 'No se pudo guardar la ficha' });
      }
    });
  });

  return router;
};
