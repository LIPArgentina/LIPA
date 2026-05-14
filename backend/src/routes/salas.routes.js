const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../db');
const { requireSala, requireAdmin } = require('../middleware/auth');

const DEFAULT_SALA_PASSWORD = '1234';
const MAX_TORNEOS_POR_SALA = 6;
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

module.exports = function createSalasRouter(deps = {}) {
  const router = express.Router();
  const picturesRoot = deps.PICTURES_DIR || path.resolve(__dirname, '../../data/pictures');
  const torneosRoot = path.join(picturesRoot, 'torneos');

  function buildSlug(value = '') {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function safeName(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'archivo';
  }

  function generatePassword(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('Falta JWT_SECRET en servidor');
    return secret;
  }

  async function ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  function normalizeCurrency(value) {
    const v = String(value || 'ARS').trim().toUpperCase();
    return v === 'USD' ? 'USD' : 'ARS';
  }

  function normalizeValor(value) {
    const clean = String(value ?? '').replace(/[^0-9]/g, '');
    return clean ? Number(clean) : null;
  }

  function normalizeDateTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    // El input datetime-local llega sin zona horaria: 2026-05-19T19:00.
    // En Render/Node puede interpretarse como UTC y mostrar 3 horas menos.
    // Para la liga lo fijamos como horario Argentina.
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const normalized = hasTimezone ? raw : `${raw}:00-03:00`;

    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  function toPublicTorneo(row) {
    const fileName = row.media_path ? path.basename(row.media_path) : '';

    return {
      id: row.id,
      salaId: row.sala_id,
      salaSlug: row.sala_slug,
      sala: row.sala_nombre,
      slot: row.slot,
      categoria: row.categoria || '',
      fechaHora: row.fecha_hora,
      valor: row.valor,
      moneda: row.moneda || 'ARS',
      mediaType: row.media_type,
      mediaUrl: row.id ? `/api/sala-torneos/media/${encodeURIComponent(row.id)}` : '',
      ubicacion: row.sala_ubicacion || row.ubicacion || '',
      updatedAt: row.updated_at,
      createdAt: row.created_at
    };
  }

  async function ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS salas (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        direccion TEXT DEFAULT '',
        ubicacion TEXT DEFAULT '',
        orden INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      ALTER TABLE salas
      ADD COLUMN IF NOT EXISTS slug TEXT,
      ADD COLUMN IF NOT EXISTS password_hash TEXT,
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_salas_slug_unique
      ON salas (slug)
      WHERE slug IS NOT NULL AND slug <> ''
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sala_torneos (
        id SERIAL PRIMARY KEY,
        sala_id INTEGER NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
        slot INTEGER NOT NULL CHECK (slot >= 1 AND slot <= 6),
        categoria TEXT DEFAULT '',
        fecha_hora TIMESTAMPTZ NOT NULL,
        valor INTEGER,
        moneda TEXT NOT NULL DEFAULT 'ARS',
        media_type TEXT NOT NULL,
        media_path TEXT NOT NULL,
        original_name TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(sala_id, slot)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sala_torneos_fecha_hora
      ON sala_torneos (fecha_hora ASC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sala_torneos_sala_id
      ON sala_torneos (sala_id)
    `);
  }

  async function ensureSalaPassword(sala) {
    if (!sala) return null;
    if (sala.password_hash && String(sala.password_hash).trim()) return sala;

    const hash = await bcrypt.hash(DEFAULT_SALA_PASSWORD, 10);
    const updated = await pool.query(
      `UPDATE salas
          SET password_hash = $1,
              must_change_password = false,
              password_updated_at = COALESCE(password_updated_at, NOW()),
              updated_at = NOW()
        WHERE id = $2
        RETURNING id, nombre, direccion, ubicacion, orden, slug, password_hash,
                  must_change_password, password_updated_at`,
      [hash, sala.id]
    );

    return updated.rows[0] || { ...sala, password_hash: hash, must_change_password: false };
  }

  async function findSala({ id, slug }) {
    await ensureTable();

    const cleanSlug = buildSlug(slug || '');
    const numericId = Number(id);

    if (Number.isFinite(numericId) && numericId > 0) {
      const byId = await pool.query(
        `SELECT id, nombre, direccion, ubicacion, orden, slug, password_hash,
                must_change_password, password_updated_at
           FROM salas
          WHERE id = $1
          LIMIT 1`,
        [numericId]
      );
      if (byId.rowCount) return byId.rows[0];
    }

    if (cleanSlug) {
      const bySlug = await pool.query(
        `SELECT id, nombre, direccion, ubicacion, orden, slug, password_hash,
                must_change_password, password_updated_at
           FROM salas
          WHERE LOWER(slug) = $1
          LIMIT 1`,
        [cleanSlug]
      );
      if (bySlug.rowCount) return bySlug.rows[0];
    }

    return null;
  }

  async function getTorneosBySala(salaId) {
    await ensureTable();
    const { rows } = await pool.query(
      `SELECT
         t.*,
         s.nombre AS sala_nombre,
         s.slug AS sala_slug,
         s.ubicacion AS sala_ubicacion
       FROM sala_torneos t
       JOIN salas s ON s.id = t.sala_id
       WHERE t.sala_id = $1
       ORDER BY t.fecha_hora ASC, t.updated_at DESC, t.id ASC`,
      [salaId]
    );
    return rows;
  }

  async function saveTorneoForSala({ salaId, slot, categoria, fechaHora, valor, moneda, file }) {
    const client = await pool.connect();

    try {
      await ensureTable();

      if (!Number.isFinite(Number(salaId)) || Number(salaId) <= 0) {
        throw new Error('Sala inválida');
      }

      if (!Number.isFinite(Number(slot)) || Number(slot) < 1 || Number(slot) > MAX_TORNEOS_POR_SALA) {
        throw new Error('Slot inválido');
      }

      if (!categoria) throw new Error('Falta categoría');
      if (!fechaHora) throw new Error('Falta fecha y hora del torneo');
      if (valor === null || valor === undefined) throw new Error('Falta valor');
      if (!file) throw new Error('Falta imagen');

      await client.query('BEGIN');

      const old = await client.query(
        `SELECT media_path FROM sala_torneos WHERE sala_id = $1 AND slot = $2 LIMIT 1`,
        [salaId, slot]
      );

      await client.query(
        `INSERT INTO sala_torneos (
           sala_id, slot, categoria, fecha_hora, valor, moneda,
           media_type, media_path, original_name, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (sala_id, slot)
         DO UPDATE SET
           categoria = EXCLUDED.categoria,
           fecha_hora = EXCLUDED.fecha_hora,
           valor = EXCLUDED.valor,
           moneda = EXCLUDED.moneda,
           media_type = EXCLUDED.media_type,
           media_path = EXCLUDED.media_path,
           original_name = EXCLUDED.original_name,
           updated_at = NOW()`,
        [salaId, slot, categoria, fechaHora, valor, moneda, file.mimetype, file.path, file.originalname || '']
      );

      await reorderSalaTorneos(salaId, client);
      await client.query('COMMIT');

      if (old.rows[0]?.media_path && old.rows[0].media_path !== file.path) {
        await removeFileIfExists(old.rows[0].media_path);
      }

      const rows = await getTorneosBySala(salaId);
      return rows.map(toPublicTorneo);
    } catch (err) {
      await client.query('ROLLBACK');
      if (file?.path) await removeFileIfExists(file.path);
      throw err;
    } finally {
      client.release();
    }
  }

  async function reorderSalaTorneos(salaId, client = pool) {
    const { rows } = await client.query(
      `SELECT
         sala_id,
         categoria,
         fecha_hora,
         valor,
         moneda,
         media_type,
         media_path,
         original_name,
         created_at,
         updated_at,
         id
       FROM sala_torneos
       WHERE sala_id = $1
       ORDER BY fecha_hora ASC, updated_at DESC, id ASC`,
      [salaId]
    );

    const ordered = rows.slice(0, MAX_TORNEOS_POR_SALA);

    await client.query(
      `DELETE FROM sala_torneos
       WHERE sala_id = $1`,
      [salaId]
    );

    let slot = 1;
    for (const row of ordered) {
      await client.query(
        `INSERT INTO sala_torneos (
           sala_id,
           slot,
           categoria,
           fecha_hora,
           valor,
           moneda,
           media_type,
           media_path,
           original_name,
           created_at,
           updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [
          row.sala_id,
          slot,
          row.categoria,
          row.fecha_hora,
          row.valor,
          row.moneda,
          row.media_type,
          row.media_path,
          row.original_name,
          row.created_at || new Date()
        ]
      );
      slot += 1;
    }
  }

  async function removeFileIfExists(filePath) {
    if (!filePath) return;
    const root = path.resolve(picturesRoot);
    const fullPath = path.resolve(filePath);
    if (!fullPath.startsWith(root + path.sep) && fullPath !== root) return;
    try { await fs.promises.unlink(fullPath); } catch (_) {}
  }

  const storage = multer.diskStorage({
    async destination(req, _file, cb) {
      try {
        const salaSlug = buildSlug(req.user?.slug || req.body?.slug || 'sala');
        const dir = path.join(torneosRoot, salaSlug || 'sala');
        await ensureDir(dir);
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ALLOWED_IMAGE_EXTS.has(ext) ? ext : '.jpg';
      const base = safeName(path.basename(file.originalname || 'torneo', ext));
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${base}${safeExt}`);
    }
  });

  const uploadTorneoImage = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const mime = String(file.mimetype || '').toLowerCase();
      if (ALLOWED_IMAGE_MIMES.has(mime) && ALLOWED_IMAGE_EXTS.has(ext)) return cb(null, true);
      return cb(new Error('Solo se permiten imágenes JPG, PNG, WEBP o GIF.'));
    }
  });

  // GET /api/salas
  router.get('/salas', async (_req, res) => {
    try {
      await ensureTable();

      const result = await pool.query(`
        SELECT
          id,
          nombre,
          direccion,
          ubicacion,
          orden,
          COALESCE(slug, '') AS slug,
          COALESCE(must_change_password, false) AS must_change_password
        FROM salas
        ORDER BY orden ASC, id ASC
      `);

      return res.json({ ok: true, salas: result.rows });
    } catch (err) {
      console.error('GET /api/salas', err);
      return res.status(500).json({ ok: false, error: 'No se pudieron cargar las salas' });
    }
  });

  // POST /api/save-salas
  router.post('/save-salas', async (req, res) => {
    const client = await pool.connect();

    try {
      await ensureTable();

      const salas = Array.isArray(req.body?.salas) ? req.body.salas : [];
      const processed = salas
        .map((sala, idx) => {
          const nombre = String(sala?.nombre || '').trim();
          const direccion = String(sala?.direccion || '').trim();
          const ubicacion = String(sala?.ubicacion || '').trim();
          const slug = buildSlug(sala?.slug || nombre);
          const id = Number(sala?.id || 0) || null;

          if (!nombre || !slug) return null;
          return { id, nombre, direccion, ubicacion, slug, orden: idx + 1 };
        })
        .filter(Boolean);

      const keepSlugs = processed.map(s => s.slug);
      const defaultHash = await bcrypt.hash(DEFAULT_SALA_PASSWORD, 10);

      await client.query('BEGIN');

      for (const sala of processed) {
        await client.query(
          `INSERT INTO salas (
             nombre, direccion, ubicacion, slug, orden,
             password_hash, must_change_password, password_updated_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, false, NOW(), NOW())
           ON CONFLICT (slug) WHERE slug IS NOT NULL AND slug <> ''
           DO UPDATE SET
             nombre = EXCLUDED.nombre,
             direccion = EXCLUDED.direccion,
             ubicacion = EXCLUDED.ubicacion,
             orden = EXCLUDED.orden,
             password_hash = COALESCE(salas.password_hash, EXCLUDED.password_hash),
             must_change_password = COALESCE(salas.must_change_password, false),
             password_updated_at = COALESCE(salas.password_updated_at, EXCLUDED.password_updated_at),
             updated_at = NOW()`,
          [sala.nombre, sala.direccion, sala.ubicacion, sala.slug, sala.orden, defaultHash]
        );
      }

      if (keepSlugs.length > 0) {
        await client.query(
          `DELETE FROM salas
            WHERE COALESCE(slug, '') <> ALL($1::text[])`,
          [keepSlugs]
        );
      } else {
        await client.query('DELETE FROM salas');
      }

      await client.query('COMMIT');
      return res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/save-salas', err);
      return res.status(500).json({ ok: false, error: 'No se pudieron guardar las salas' });
    } finally {
      client.release();
    }
  });

  // POST /api/sala/login
  router.post('/sala/login', async (req, res) => {
    try {
      const { slug, salaId, password } = req.body || {};
      if ((!slug && !salaId) || !password) {
        return res.status(400).json({ ok: false, msg: 'faltan campos' });
      }

      let sala = await findSala({ id: salaId, slug });
      if (!sala) return res.status(404).json({ ok: false, msg: 'sala inexistente' });

      sala = await ensureSalaPassword(sala);
      const ok = await bcrypt.compare(password, sala.password_hash || '');
      if (!ok) return res.status(401).json({ ok: false, msg: 'contraseña incorrecta' });

      const token = jwt.sign(
        {
          role: 'sala',
          salaId: sala.id,
          slug: sala.slug,
          displayName: sala.nombre
        },
        getJwtSecret(),
        { expiresIn: '12h' }
      );

      res.cookie('lpi_auth', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 12 * 60 * 60 * 1000,
      });

      return res.json({
        ok: true,
        role: 'sala',
        salaId: sala.id,
        slug: sala.slug,
        displayName: sala.nombre,
        token
      });
    } catch (err) {
      console.error('POST /api/sala/login', err);
      return res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión de sala' });
    }
  });

  // POST /api/sala/change-password
  router.post('/sala/change-password', async (req, res) => {
    try {
      const { slug, salaId, oldPassword, newPassword } = req.body || {};
      if ((!slug && !salaId) || !oldPassword || !newPassword) {
        return res.status(400).json({ ok: false, msg: 'faltan campos' });
      }

      let sala = await findSala({ id: salaId, slug });
      if (!sala) return res.status(404).json({ ok: false, msg: 'sala inexistente' });

      sala = await ensureSalaPassword(sala);
      const ok = await bcrypt.compare(oldPassword, sala.password_hash || '');
      if (!ok) return res.status(401).json({ ok: false, msg: 'actual incorrecta' });

      const newHash = await bcrypt.hash(newPassword, 10);
      await pool.query(
        `UPDATE salas
            SET password_hash = $1,
                must_change_password = false,
                password_updated_at = NOW(),
                updated_at = NOW()
          WHERE id = $2`,
        [newHash, sala.id]
      );

      return res.json({ ok: true });
    } catch (err) {
      console.error('POST /api/sala/change-password', err);
      return res.status(500).json({ ok: false, error: 'No se pudo actualizar la contraseña' });
    }
  });

  // POST /api/admin/reset-sala-password/:id
  router.post('/admin/reset-sala-password/:id', async (req, res) => {
    try {
      const salaId = Number(req.params.id);
      if (!Number.isFinite(salaId) || salaId <= 0) {
        return res.status(400).json({ ok: false, error: 'Se requiere el ID de la sala' });
      }

      await ensureTable();
      const newPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      const result = await pool.query(
        `UPDATE salas
            SET password_hash = $1,
                must_change_password = false,
                password_updated_at = NOW(),
                updated_at = NOW()
          WHERE id = $2
        RETURNING id, nombre, slug`,
        [hashedPassword, salaId]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: 'Sala no encontrada' });
      }

      return res.json({
        ok: true,
        message: 'Contraseña reseteada correctamente',
        sala: result.rows[0],
        newPassword
      });
    } catch (err) {
      console.error('POST /api/admin/reset-sala-password/:id', err);
      return res.status(500).json({ ok: false, error: 'Error al resetear la contraseña' });
    }
  });

  // GET /api/sala/torneos
  router.get('/sala/torneos', requireSala, async (req, res) => {
    try {
      const salaId = Number(req.user.salaId);
      const rows = await getTorneosBySala(salaId);
      return res.json({ ok: true, torneos: rows.map(toPublicTorneo) });
    } catch (err) {
      console.error('GET /api/sala/torneos', err);
      return res.status(500).json({ ok: false, error: 'No se pudieron cargar los torneos de la sala' });
    }
  });

  // POST /api/sala/torneos/:slot
  router.post('/sala/torneos/:slot', requireSala, uploadTorneoImage.single('imagen'), async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureTable();

      const salaId = Number(req.user.salaId);
      const slot = Number(req.params.slot);
      if (!Number.isFinite(slot) || slot < 1 || slot > MAX_TORNEOS_POR_SALA) {
        return res.status(400).json({ ok: false, error: 'Slot inválido' });
      }

      const categoria = String(req.body?.categoria || '').trim();
      const fechaHora = normalizeDateTime(req.body?.fechaHora || req.body?.fecha_hora);
      const valor = normalizeValor(req.body?.valor);
      const moneda = normalizeCurrency(req.body?.moneda);

      if (!categoria) return res.status(400).json({ ok: false, error: 'Falta categoría' });
      if (!fechaHora) return res.status(400).json({ ok: false, error: 'Falta fecha y hora del torneo' });
      if (valor === null) return res.status(400).json({ ok: false, error: 'Falta valor' });
      if (!req.file) return res.status(400).json({ ok: false, error: 'Falta imagen' });

      await client.query('BEGIN');

      const old = await client.query(
        `SELECT media_path FROM sala_torneos WHERE sala_id = $1 AND slot = $2 LIMIT 1`,
        [salaId, slot]
      );

      await client.query(
        `INSERT INTO sala_torneos (
           sala_id, slot, categoria, fecha_hora, valor, moneda,
           media_type, media_path, original_name, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (sala_id, slot)
         DO UPDATE SET
           categoria = EXCLUDED.categoria,
           fecha_hora = EXCLUDED.fecha_hora,
           valor = EXCLUDED.valor,
           moneda = EXCLUDED.moneda,
           media_type = EXCLUDED.media_type,
           media_path = EXCLUDED.media_path,
           original_name = EXCLUDED.original_name,
           updated_at = NOW()`,
        [salaId, slot, categoria, fechaHora, valor, moneda, req.file.mimetype, req.file.path, req.file.originalname || '']
      );

      await reorderSalaTorneos(salaId, client);
      await client.query('COMMIT');

      if (old.rows[0]?.media_path && old.rows[0].media_path !== req.file.path) {
        await removeFileIfExists(old.rows[0].media_path);
      }

      const rows = await getTorneosBySala(salaId);
      return res.json({ ok: true, torneos: rows.map(toPublicTorneo) });
    } catch (err) {
      await client.query('ROLLBACK');
      if (req.file?.path) await removeFileIfExists(req.file.path);
      console.error('POST /api/sala/torneos/:slot', err);
      return res.status(500).json({ ok: false, error: err?.message || 'No se pudo guardar el torneo' });
    } finally {
      client.release();
    }
  });

  // DELETE /api/sala/torneos/:slot
  router.delete('/sala/torneos/:slot', requireSala, async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureTable();
      const salaId = Number(req.user.salaId);
      const slot = Number(req.params.slot);
      if (!Number.isFinite(slot) || slot < 1 || slot > MAX_TORNEOS_POR_SALA) {
        return res.status(400).json({ ok: false, error: 'Slot inválido' });
      }

      await client.query('BEGIN');
      const old = await client.query(
        `DELETE FROM sala_torneos
         WHERE sala_id = $1 AND slot = $2
         RETURNING media_path`,
        [salaId, slot]
      );
      await reorderSalaTorneos(salaId, client);
      await client.query('COMMIT');

      if (old.rows[0]?.media_path) await removeFileIfExists(old.rows[0].media_path);

      const rows = await getTorneosBySala(salaId);
      return res.json({ ok: true, torneos: rows.map(toPublicTorneo) });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('DELETE /api/sala/torneos/:slot', err);
      return res.status(500).json({ ok: false, error: 'No se pudo eliminar el torneo' });
    } finally {
      client.release();
    }
  });

  // GET /api/admin/sala-torneos/:salaId
  router.get('/admin/sala-torneos/:salaId', requireAdmin, async (req, res) => {
    try {
      const salaId = Number(req.params.salaId);

      if (!Number.isFinite(salaId) || salaId <= 0) {
        return res.status(400).json({ ok: false, error: 'Sala inválida' });
      }

      const rows = await getTorneosBySala(salaId);
      return res.json({ ok: true, torneos: rows.map(toPublicTorneo) });
    } catch (err) {
      console.error('GET /api/admin/sala-torneos/:salaId', err);
      return res.status(500).json({ ok: false, error: 'No se pudieron cargar los torneos de la sala' });
    }
  });

  // POST /api/admin/sala-torneos/:salaId/:slot
  router.post('/admin/sala-torneos/:salaId/:slot', requireAdmin, uploadTorneoImage.single('imagen'), async (req, res) => {
    try {
      const salaId = Number(req.params.salaId);
      const slot = Number(req.params.slot);
      const categoria = String(req.body?.categoria || '').trim();
      const fechaHora = normalizeDateTime(req.body?.fechaHora || req.body?.fecha_hora);
      const valor = normalizeValor(req.body?.valor);
      const moneda = normalizeCurrency(req.body?.moneda);

      const torneos = await saveTorneoForSala({
        salaId,
        slot,
        categoria,
        fechaHora,
        valor,
        moneda,
        file: req.file
      });

      return res.json({ ok: true, torneos });
    } catch (err) {
      console.error('POST /api/admin/sala-torneos/:salaId/:slot', err);
      return res.status(500).json({ ok: false, error: err?.message || 'No se pudo guardar el torneo manual' });
    }
  });

  // GET /api/torneos
  router.get('/torneos', async (_req, res) => {
    try {
      await ensureTable();
      const { rows } = await pool.query(
        `SELECT
           t.*,
           s.nombre AS sala_nombre,
           s.slug AS sala_slug,
           s.ubicacion AS sala_ubicacion
         FROM sala_torneos t
         JOIN salas s ON s.id = t.sala_id
         WHERE t.fecha_hora >= DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires'
         ORDER BY t.fecha_hora ASC, t.updated_at DESC, t.id ASC`
      );
      return res.json({ ok: true, torneos: rows.map(toPublicTorneo) });
    } catch (err) {
      console.error('GET /api/torneos', err);
      return res.status(500).json({ ok: false, error: 'No se pudieron cargar los torneos' });
    }
  });

  // GET /api/sala-torneos/media/:id
  router.get('/sala-torneos/media/:id', async (req, res) => {
    try {
      await ensureTable();
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(404).end();

      const { rows } = await pool.query(
        `SELECT media_path, media_type FROM sala_torneos WHERE id = $1 LIMIT 1`,
        [id]
      );
      const row = rows[0];
      if (!row?.media_path) return res.status(404).end();

      const fullPath = row.media_path;

      if (!fullPath || !fs.existsSync(fullPath)) {
        return res.status(404).end();
      }

      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Access-Control-Allow-Origin', 'https://lipa-frontend-staging.onrender.com');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');

      if (row.media_type) res.type(row.media_type);

      return res.sendFile(fullPath);
    } catch (err) {
      console.error('GET /api/sala-torneos/media/:id', err);
      return res.status(500).end();
    }
  });

  return router;
};
