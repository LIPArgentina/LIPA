const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const pool = require('../../db');
const { requireAdmin } = require('../middleware/auth');

async function ensureSorteoTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sorteo_inscriptos (
      id BIGSERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      dni TEXT NOT NULL UNIQUE,
      device_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE sorteo_inscriptos ADD COLUMN IF NOT EXISTS device_hash TEXT`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_inscriptos_device_hash
    ON sorteo_inscriptos (device_hash)
    WHERE device_hash IS NOT NULL
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

function cleanDeviceId(value) {
  const deviceId = String(value || '').trim().slice(0, 160);
  return /^[a-zA-Z0-9._:-]{16,160}$/.test(deviceId) ? deviceId : '';
}

function hashDeviceId(deviceId) {
  return crypto.createHash('sha256').update(`lipa-sorteo:${deviceId}`).digest('hex');
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
      const deviceId = cleanDeviceId(req.body?.deviceId);

      if (nombre.length < 4 || !nombre.includes(' ')) {
        return res.status(400).json({ ok: false, error: 'Ingresá tu nombre y apellido.' });
      }
      if (!/^\d{7,9}$/.test(dni)) {
        return res.status(400).json({ ok: false, error: 'Ingresá un DNI válido, solo con números.' });
      }
      if (!deviceId) {
        return res.status(400).json({ ok: false, error: 'No pudimos identificar este dispositivo. Abrí el sorteo nuevamente desde la app de LIPA.' });
      }

      await ensureSorteoTable();
      const deviceHash = hashDeviceId(deviceId);

      const existingDni = await pool.query(
        'SELECT id, device_hash FROM sorteo_inscriptos WHERE dni = $1 LIMIT 1',
        [dni]
      );
      if (existingDni.rowCount) {
        if (!existingDni.rows[0].device_hash) {
          await pool.query(
            `UPDATE sorteo_inscriptos
             SET device_hash = $1
             WHERE id = $2
               AND device_hash IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM sorteo_inscriptos WHERE device_hash = $1
               )`,
            [deviceHash, existingDni.rows[0].id]
          );
        }
        return res.json({ ok: true, alreadyRegistered: true, reason: 'dni', message: '¡Usted ya estaba registrado!' });
      }

      const existingDevice = await pool.query(
        'SELECT id FROM sorteo_inscriptos WHERE device_hash = $1 LIMIT 1',
        [deviceHash]
      );
      if (existingDevice.rowCount) {
        return res.json({
          ok: true,
          alreadyRegistered: true,
          reason: 'device',
          message: 'Este dispositivo ya fue utilizado para participar.',
        });
      }

      const result = await pool.query(
        `
          INSERT INTO sorteo_inscriptos (nombre, dni, device_hash)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
          RETURNING id
        `,
        [nombre, dni, deviceHash]
      );

      if (!result.rowCount) {
        const duplicate = await pool.query(
          `SELECT CASE WHEN dni = $1 THEN 'dni' ELSE 'device' END AS reason
           FROM sorteo_inscriptos
           WHERE dni = $1 OR device_hash = $2
           ORDER BY CASE WHEN dni = $1 THEN 0 ELSE 1 END
           LIMIT 1`,
          [dni, deviceHash]
        );
        const reason = duplicate.rows[0]?.reason || 'device';
        return res.json({
          ok: true,
          alreadyRegistered: true,
          reason,
          message: reason === 'dni'
            ? '¡Usted ya estaba registrado!'
            : 'Este dispositivo ya fue utilizado para participar.',
        });
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
