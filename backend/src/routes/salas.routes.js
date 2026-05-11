const express = require('express');
const pool = require('../../db');

module.exports = function createSalasRouter() {

  const router = express.Router();

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
  }

  // =========================
  // GET /api/salas
  // =========================
  router.get('/salas', async (req, res) => {

    try {

      await ensureTable();

      const result = await pool.query(`
        SELECT
          id,
          nombre,
          direccion,
          ubicacion,
          orden
        FROM salas
        ORDER BY orden ASC, id ASC
      `);

      return res.json({
        ok: true,
        salas: result.rows
      });

    } catch (err) {

      console.error('GET /api/salas', err);

      return res.status(500).json({
        ok: false,
        error: 'No se pudieron cargar las salas'
      });

    }

  });

  // =========================
  // POST /api/save-salas
  // =========================
  router.post('/save-salas', async (req, res) => {

    const client = await pool.connect();

    try {

      await ensureTable();

      const salas = Array.isArray(req.body?.salas)
        ? req.body.salas
        : [];

      await client.query('BEGIN');

      // borra todo y vuelve a insertar
      await client.query(`DELETE FROM salas`);

      let orden = 1;

      for (const sala of salas) {

        const nombre = String(sala?.nombre || '').trim();
        const direccion = String(sala?.direccion || '').trim();
        const ubicacion = String(sala?.ubicacion || '').trim();

        if (!nombre) continue;

        await client.query(
          `
          INSERT INTO salas (
            nombre,
            direccion,
            ubicacion,
            orden,
            updated_at
          )
          VALUES ($1,$2,$3,$4,NOW())
          `,
          [
            nombre,
            direccion,
            ubicacion,
            orden
          ]
        );

        orden++;

      }

      await client.query('COMMIT');

      return res.json({
        ok: true
      });

    } catch (err) {

      await client.query('ROLLBACK');

      console.error('POST /api/save-salas', err);

      return res.status(500).json({
        ok: false,
        error: 'No se pudieron guardar las salas'
      });

    } finally {

      client.release();

    }

  });

  return router;

};
