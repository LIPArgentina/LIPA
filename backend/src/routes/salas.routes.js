const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../db');
const adminFirebase = require('../../firebase');
const { requireSala, requireAdmin } = require('../middleware/auth');
const { createRenewableSession, setAccessCookie } = require('../utils/authSessions');

const DEFAULT_SALA_PASSWORD = '1234';
const MAX_TORNEOS_POR_SALA = 6;
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

module.exports = function createSalasRouter(deps = {}) {
  const router = express.Router();
  const picturesRoot = deps.PICTURES_DIR || path.resolve(__dirname, '../../data/pictures');
  const torneosRoot = path.join(picturesRoot, 'torneos');
  const EXPIRED_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
  let expiredCleanupPromise = null;
  let lastExpiredCleanupAt = 0;

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

  function setImageCorsHeaders(req, res) {
    const allowedOrigins = new Set([
      'https://lipa.ar',
      'https://www.lipa.ar',
      'https://lipa-frontend-staging.onrender.com'
    ]);

    const origin = req.get('Origin');
    if (origin && allowedOrigins.has(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    } else {
      res.set('Access-Control-Allow-Origin', '*');
    }

    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  function normalizeCurrency(value) {
    const v = String(value || 'ARS').trim().toUpperCase();
    return v === 'USD' ? 'USD' : 'ARS';
  }

  function normalizeValor(value) {
    const clean = String(value ?? '').trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '');
    if (!clean) return null;
    const parsed = Number(clean);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed > 0 && parsed < 1000 ? parsed * 1000 : parsed);
  }

  function normalizeCategorias(value, monedaFallback = 'ARS') {
    let raw = value;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (_) { raw = []; }
    }
    if (!Array.isArray(raw)) return [];
    const allowed = new Set(['1ra', '2da', '3ra']);
    return raw
      .map((item) => ({
        categoria: String(item?.categoria || '').trim().toLowerCase(),
        hora: String(item?.hora || '').trim(),
        valor: normalizeValor(item?.valor),
        moneda: normalizeCurrency(item?.moneda || monedaFallback)
      }))
      .filter((item) => allowed.has(item.categoria) && /^\d{2}:\d{2}$/.test(item.hora) && item.valor !== null);
  }

  function normalizeDateTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;




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
      modalidad: row.categoria || '',
      estilo: row.estilo || '',
      fechaHora: row.fecha_hora,
      valor: row.valor,
      moneda: row.moneda || 'ARS',
      categorias: Array.isArray(row.categorias) ? row.categorias : [],
      valorMesa: row.valor_mesa,
      mediaType: row.media_type,
      mediaUrl: row.id ? `/api/sala-torneos/media/${encodeURIComponent(row.id)}` : '',
      ubicacion: row.sala_ubicacion || row.ubicacion || '',
      contacto: row.sala_contacto || row.contacto || '',
      contacto2: row.sala_contacto_2 || row.contacto_2 || '',
      updatedAt: row.updated_at,
      createdAt: row.created_at
    };
  }


  async function sendTorneoPushNotification({ salaId, action = 'created', categoria = '' } = {}) {
    if (!adminFirebase || typeof adminFirebase.messaging !== 'function') return;

    try {
      const sala = await findSala({ id: salaId });
      const salaNombre = String(sala?.nombre || 'Una sala').trim() || 'Una sala';
      const verbo = action === 'updated' ? 'modificó' : 'publicó';
      const body = `${salaNombre} ${verbo} un nuevo torneo`;

      await adminFirebase.messaging().send({
        topic: 'torneos',
        notification: {
          title: 'RANKING LIPA',
          body
        },
        data: {
          type: 'torneo',
          action: String(action || 'created'),
          salaId: String(salaId || ''),
          sala: salaNombre,
          categoria: String(categoria || ''),
          url: 'https://lipa.ar/torneos/torneos.html?app=true'
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'lipa_torneos',
            clickAction: 'OPEN_TORNEOS'
          }
        }
      });
    } catch (err) {
      console.error('FCM torneo notification error:', err?.message || err);
    }
  }

  async function ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS salas (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        direccion TEXT DEFAULT '',
        ubicacion TEXT DEFAULT '',
        contacto TEXT DEFAULT '',
        orden INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      ALTER TABLE salas
      ADD COLUMN IF NOT EXISTS contacto TEXT DEFAULT '',
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
        estilo TEXT DEFAULT '',
        fecha_hora TIMESTAMPTZ NOT NULL,
        valor INTEGER,
        moneda TEXT NOT NULL DEFAULT 'ARS',
        categorias JSONB NOT NULL DEFAULT '[]'::jsonb,
        valor_mesa INTEGER,
        media_type TEXT NOT NULL,
        media_path TEXT NOT NULL,
        original_name TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(sala_id, slot)
      )
    `);

    await pool.query(`
      ALTER TABLE salas
      ADD COLUMN IF NOT EXISTS contacto_2 TEXT DEFAULT ''
    `);

    await pool.query(`
      ALTER TABLE sala_torneos
      ADD COLUMN IF NOT EXISTS categorias JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS valor_mesa INTEGER,
      ADD COLUMN IF NOT EXISTS estilo TEXT DEFAULT ''
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
        RETURNING id, nombre, direccion, ubicacion, contacto, orden, slug, password_hash,
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
        `SELECT id, nombre, direccion, ubicacion, contacto, orden, slug, password_hash,
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
        `SELECT id, nombre, direccion, ubicacion, contacto, orden, slug, password_hash,
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
    await cleanupExpiredTorneos();
    const { rows } = await pool.query(
      `SELECT
         t.*,
         s.nombre AS sala_nombre,
         s.slug AS sala_slug,
         s.ubicacion AS sala_ubicacion,
         s.contacto AS sala_contacto,
         s.contacto_2 AS sala_contacto_2
       FROM sala_torneos t
       JOIN salas s ON s.id = t.sala_id
       WHERE t.sala_id = $1
       ORDER BY t.fecha_hora ASC, t.updated_at DESC, t.id ASC`,
      [salaId]
    );
    return rows;
  }

  async function saveTorneoForSala({ salaId, slot, categoria, estilo = '', fechaHora, valor, moneda, categorias = [], valorMesa = null, file }) {
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
        `SELECT id, media_path FROM sala_torneos WHERE sala_id = $1 AND slot = $2 LIMIT 1`,
        [salaId, slot]
      );

      await client.query(
        `INSERT INTO sala_torneos (
           sala_id, slot, categoria, estilo, fecha_hora, valor, moneda, categorias, valor_mesa,
           media_type, media_path, original_name, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, NOW(), NOW())
         ON CONFLICT (sala_id, slot)
         DO UPDATE SET
           categoria = EXCLUDED.categoria,
           estilo = EXCLUDED.estilo,
           fecha_hora = EXCLUDED.fecha_hora,
           valor = EXCLUDED.valor,
           moneda = EXCLUDED.moneda,
           categorias = EXCLUDED.categorias,
           valor_mesa = EXCLUDED.valor_mesa,
           media_type = EXCLUDED.media_type,
           media_path = EXCLUDED.media_path,
           original_name = EXCLUDED.original_name,
           updated_at = NOW()`,
        [salaId, slot, categoria, estilo, fechaHora, valor, moneda, JSON.stringify(categorias), valorMesa, file.mimetype, file.path, file.originalname || '']
      );

      await reorderSalaTorneos(salaId, client);
      await client.query('COMMIT');

      if (old.rows[0]?.media_path && old.rows[0].media_path !== file.path) {
        await removeFileIfExists(old.rows[0].media_path);
      }

      await sendTorneoPushNotification({
        salaId,
        action: old.rowCount ? 'updated' : 'created',
        categoria
      });

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
         estilo,
         fecha_hora,
         valor,
         moneda,
         categorias,
         valor_mesa,
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
           estilo,
           fecha_hora,
           valor,
           moneda,
           categorias,
           valor_mesa,
           media_type,
           media_path,
           original_name,
           created_at,
           updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,NOW())`,
        [
          row.sala_id,
          slot,
          row.categoria,
          row.estilo,
          row.fecha_hora,
          row.valor,
          row.moneda,
          JSON.stringify(row.categorias || []),
          row.valor_mesa,
          row.media_type,
          row.media_path,
          row.original_name,
          row.created_at || new Date()
        ]
      );
      slot += 1;
    }
  }

  async function cleanupExpiredTorneos({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - lastExpiredCleanupAt < EXPIRED_CLEANUP_INTERVAL_MS) return 0;
    if (expiredCleanupPromise) return expiredCleanupPromise;

    expiredCleanupPromise = (async () => {
      const client = await pool.connect();
      let expiredRows = [];
      try {
        await ensureTable();
        await client.query('BEGIN');
        const deleted = await client.query(
          `DELETE FROM sala_torneos
            WHERE fecha_hora < DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')
                              AT TIME ZONE 'America/Argentina/Buenos_Aires'
          RETURNING sala_id, media_path`,
        );
        expiredRows = deleted.rows;

        const affectedSalaIds = [...new Set(expiredRows.map((row) => Number(row.sala_id)).filter(Number.isFinite))];
        for (const salaId of affectedSalaIds) {
          await reorderSalaTorneos(salaId, client);
        }

        await client.query('COMMIT');
        lastExpiredCleanupAt = Date.now();

        await Promise.allSettled(
          expiredRows
            .map((row) => row.media_path)
            .filter(Boolean)
            .map((mediaPath) => removeFileIfExists(mediaPath))
        );

        if (expiredRows.length) {
          console.info(`[sala-torneos-cleanup] ${expiredRows.length} torneo(s) vencido(s) eliminado(s)`);
        }
        return expiredRows.length;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[sala-torneos-cleanup]', err);
        throw err;
      } finally {
        client.release();
      }
    })();

    try {
      return await expiredCleanupPromise;
    } finally {
      expiredCleanupPromise = null;
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


  router.get('/salas', async (_req, res) => {
    try {
      await ensureTable();

      const result = await pool.query(`
        SELECT
          id,
          nombre,
          direccion,
          ubicacion,
          contacto,
          contacto_2,
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


  router.post('/save-salas', requireAdmin, async (req, res) => {
    const client = await pool.connect();

    try {
      await ensureTable();

      const salas = Array.isArray(req.body?.salas) ? req.body.salas : [];
      const processed = salas
        .map((sala, idx) => {
          const nombre = String(sala?.nombre || '').trim();
          const direccion = String(sala?.direccion || '').trim();
          const ubicacion = String(sala?.ubicacion || '').trim();
          const contacto = String(sala?.contacto || '').trim();
          const contacto2 = String(sala?.contacto2 || sala?.contacto_2 || '').trim();
          const slug = buildSlug(sala?.slug || nombre);
          const id = Number(sala?.id || 0) || null;

          if (!nombre || !slug) return null;
          return { id, nombre, direccion, ubicacion, contacto, contacto2, slug, orden: idx + 1 };
        })
        .filter(Boolean);

      const keepSlugs = processed.map(s => s.slug);
      const defaultHash = await bcrypt.hash(DEFAULT_SALA_PASSWORD, 10);

      await client.query('BEGIN');

      for (const sala of processed) {
        await client.query(
          `INSERT INTO salas (
             nombre, direccion, ubicacion, contacto, contacto_2, slug, orden,
             password_hash, must_change_password, password_updated_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, NOW(), NOW())
           ON CONFLICT (slug) WHERE slug IS NOT NULL AND slug <> ''
           DO UPDATE SET
             nombre = EXCLUDED.nombre,
             direccion = EXCLUDED.direccion,
             ubicacion = EXCLUDED.ubicacion,
             contacto = EXCLUDED.contacto,
             contacto_2 = EXCLUDED.contacto_2,
             orden = EXCLUDED.orden,
             password_hash = COALESCE(salas.password_hash, EXCLUDED.password_hash),
             must_change_password = COALESCE(salas.must_change_password, false),
             password_updated_at = COALESCE(salas.password_updated_at, EXCLUDED.password_updated_at),
             updated_at = NOW()`,
          [sala.nombre, sala.direccion, sala.ubicacion, sala.contacto, sala.contacto2, sala.slug, sala.orden, defaultHash]
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


  router.post('/sala/login', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
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

      const session = await createRenewableSession({
        role: 'sala',
        salaId: sala.id,
        slug: sala.slug,
        displayName: sala.nombre
      }, `sala:${sala.id}`);
      setAccessCookie(res, session.token);

      return res.json({
        ok: true,
        role: 'sala',
        salaId: sala.id,
        slug: sala.slug,
        displayName: sala.nombre,
        ...session
      });
    } catch (err) {
      console.error('POST /api/sala/login', err);
      return res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión de sala' });
    }
  });


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

  router.post('/admin/impersonate-sala', requireAdmin, async (req, res) => {
    try {
      const salaId = Number(req.body?.salaId);
      if (!Number.isFinite(salaId) || salaId <= 0) {
        return res.status(400).json({ ok: false, error: 'Se requiere el ID de la sala' });
      }

      const sala = await findSala({ id: salaId });
      if (!sala) return res.status(404).json({ ok: false, error: 'Sala no encontrada' });

      const token = jwt.sign(
        {
          role: 'sala',
          salaId: sala.id,
          slug: sala.slug,
          displayName: sala.nombre,
          impersonatedBy: 'admin'
        },
        getJwtSecret(),
        { expiresIn: '45m' }
      );

      return res.json({
        ok: true,
        session: {
          role: 'sala',
          salaId: sala.id,
          slug: sala.slug,
          displayName: sala.nombre,
          category: 'salas',
          token,
          isTestSession: true,
          ts: Date.now()
        }
      });
    } catch (err) {
      console.error('POST /api/admin/impersonate-sala', err);
      return res.status(500).json({ ok: false, error: 'No se pudo generar la sesión temporal de la sala.' });
    }
  });


  router.post('/admin/reset-sala-password/:id', requireAdmin, async (req, res) => {
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


  router.post('/sala/torneos/:slot', requireSala, uploadTorneoImage.single('imagen'), async (req, res) => {
    try {
      await ensureTable();

      const salaId = Number(req.user.salaId);
      const slot = Number(req.params.slot);
      if (!Number.isFinite(slot) || slot < 1 || slot > MAX_TORNEOS_POR_SALA) {
        return res.status(400).json({ ok: false, error: 'Slot inválido' });
      }

      const categoria = String(req.body?.categoria || '').trim();
      const estilo = String(req.body?.estilo || '').trim();
      const moneda = normalizeCurrency(req.body?.moneda);
      const categorias = normalizeCategorias(req.body?.categorias, moneda);
      const fecha = String(req.body?.fecha || '').trim();
      const fechaHora = normalizeDateTime(req.body?.fechaHora || req.body?.fecha_hora || (fecha && categorias[0] ? `${fecha}T${categorias[0].hora}` : ''));
      const valor = categorias[0]?.valor ?? normalizeValor(req.body?.valor);
      const valorMesa = normalizeValor(req.body?.valorMesa ?? req.body?.valor_mesa);

      if (!categoria) return res.status(400).json({ ok: false, error: 'Falta categoría' });
      if (!fechaHora) return res.status(400).json({ ok: false, error: 'Falta fecha y hora del torneo' });
      if (valor === null) return res.status(400).json({ ok: false, error: 'Falta valor' });
      if (!req.file) return res.status(400).json({ ok: false, error: 'Falta imagen' });

      const torneos = await saveTorneoForSala({
        salaId,
        slot,
        categoria,
        estilo,
        fechaHora,
        valor,
        moneda,
        categorias,
        valorMesa,
        file: req.file
      });

      return res.json({ ok: true, torneos });
    } catch (err) {
      if (req.file?.path) await removeFileIfExists(req.file.path);
      console.error('POST /api/sala/torneos/:slot', err);
      return res.status(500).json({ ok: false, error: err?.message || 'No se pudo guardar el torneo' });
    }
  });


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


  router.post('/admin/sala-torneos/:salaId/:slot', requireAdmin, uploadTorneoImage.single('imagen'), async (req, res) => {
    try {
      const salaId = Number(req.params.salaId);
      const slot = Number(req.params.slot);
      const categoria = String(req.body?.categoria || '').trim();
      const estilo = String(req.body?.estilo || '').trim();
      const moneda = normalizeCurrency(req.body?.moneda);
      const categorias = normalizeCategorias(req.body?.categorias, moneda);
      const fecha = String(req.body?.fecha || '').trim();
      const fechaHora = normalizeDateTime(req.body?.fechaHora || req.body?.fecha_hora || (fecha && categorias[0] ? `${fecha}T${categorias[0].hora}` : ''));
      const valor = categorias[0]?.valor ?? normalizeValor(req.body?.valor);
      const valorMesa = normalizeValor(req.body?.valorMesa ?? req.body?.valor_mesa);

      const torneos = await saveTorneoForSala({
        salaId,
        slot,
        categoria,
        estilo,
        fechaHora,
        valor,
        moneda,
        categorias,
        valorMesa,
        file: req.file
      });

      return res.json({ ok: true, torneos });
    } catch (err) {
      console.error('POST /api/admin/sala-torneos/:salaId/:slot', err);
      return res.status(500).json({ ok: false, error: err?.message || 'No se pudo guardar el torneo manual' });
    }
  });


  router.get('/torneos', async (_req, res) => {
    try {
      await ensureTable();
      await cleanupExpiredTorneos();
      const { rows } = await pool.query(
        `SELECT
           t.*,
           s.nombre AS sala_nombre,
           s.slug AS sala_slug,
           s.ubicacion AS sala_ubicacion,
           s.contacto AS sala_contacto,
           s.contacto_2 AS sala_contacto_2
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


  router.options('/sala-torneos/media/:id', async (req, res) => {
    setImageCorsHeaders(req, res);
    return res.status(204).end();
  });


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
      setImageCorsHeaders(req, res);

      if (row.media_type) res.type(row.media_type);

      return res.sendFile(fullPath);
    } catch (err) {
      console.error('GET /api/sala-torneos/media/:id', err);
      return res.status(500).end();
    }
  });

  setTimeout(() => {
    cleanupExpiredTorneos({ force: true }).catch(() => {});
  }, 5000).unref?.();

  const expiredCleanupTimer = setInterval(() => {
    cleanupExpiredTorneos({ force: true }).catch(() => {});
  }, 60 * 60 * 1000);
  expiredCleanupTimer.unref?.();

  return router;
};
