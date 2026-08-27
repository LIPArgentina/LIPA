const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../../db');
const { requireAdmin } = require('../middleware/auth');

async function ensureSorteoTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sorteo_inscriptos (
      id BIGSERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      dni TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sorteo_inscriptos_created_at
    ON sorteo_inscriptos (created_at DESC)
  `);
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function cleanDni(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 9);
}

module.exports = function createSorteoRouter() {
  const router = express.Router();
  const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Demasiados intentos. Esperá unos minutos y volvé a intentar.' },
  });

  router.post('/sorteo/inscripcion', registerLimiter, async (req, res) => {
    try {
      const nombre = cleanName(req.body?.nombre);
      const dni = cleanDni(req.body?.dni);

      if (nombre.length < 4 || !nombre.includes(' ')) {
        return res.status(400).json({ ok: false, error: 'Ingresá tu nombre y apellido.' });
      }
      if (!/^\d{7,9}$/.test(dni)) {
        return res.status(400).json({ ok: false, error: 'Ingresá un DNI válido, solo con números.' });
      }

      await ensureSorteoTable();

      const result = await pool.query(
        `
          INSERT INTO sorteo_inscriptos (nombre, dni)
          VALUES ($1, $2)
          ON CONFLICT (dni) DO NOTHING
          RETURNING id
        `,
        [nombre, dni]
      );

      if (!result.rowCount) {
        return res.json({ ok: true, alreadyRegistered: true, message: '¡Usted ya estaba registrado!' });
      }
      return res.status(201).json({ ok: true, alreadyRegistered: false, message: '¡Ya estás participando! ¡Mucha suerte!' });
    } catch (error) {
      console.error('sorteo registration error:', error);
      return res.status(500).json({ ok: false, error: 'No pudimos completar la inscripción. Intentá nuevamente.' });
    }
  });

  router.get('/sorteo/admin/inscriptos', requireAdmin, async (_req, res) => {
    try {
      await ensureSorteoTable();
      const { rows } = await pool.query(`
        SELECT id, nombre, dni, created_at
        FROM sorteo_inscriptos
        ORDER BY created_at DESC, id DESC
      `);
      return res.json({ ok: true, total: rows.length, inscriptos: rows });
    } catch (error) {
      console.error('sorteo admin list error:', error);
      return res.status(500).json({ ok: false, error: 'No se pudo cargar el listado de inscriptos.' });
    }
  });

  return router;
};

module.exports.ensureSorteoTable = ensureSorteoTable;
