const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../db');

const DEFAULT_SALA_PASSWORD = '1234';

module.exports = function createSalasRouter() {
  const router = express.Router();

  function buildSlug(value = '') {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
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
           ON CONFLICT (slug)
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

  return router;
};
