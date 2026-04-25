const express = require('express');
const pool = require('../../db');

let requireAdmin = (req, res, next) => next();
try {
  const auth = require('../middleware/auth');
  if (typeof auth.requireAdmin === 'function') requireAdmin = auth.requireAdmin;
} catch (_) {}

module.exports = function createLlavesRouter() {
  const router = express.Router();

  const VALID_CATEGORIES = new Set(['segunda', 'tercera']);

  function cleanCategory(value) {
    return String(value || '').trim().toLowerCase();
  }

  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS llaves_data (
        category TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
  }

  async function getLlaves(req, res) {
    try {
      const category = cleanCategory(req.query.category);
      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({ ok: false, error: 'category inválida' });
      }

      await ensureTables();

      const result = await pool.query(
        `SELECT data FROM llaves_data WHERE category = $1 LIMIT 1`,
        [category]
      );

      res.set('Cache-Control', 'no-store');
      res.json({
        ok: true,
        category,
        data: result.rows[0]?.data || null
      });
    } catch (err) {
      console.error('GET /api/llaves', err);
      res.status(500).json({ ok: false, error: 'No se pudieron cargar las llaves' });
    }
  }

  async function saveLlaves(req, res) {
    try {
      const category = cleanCategory(req.body?.category || req.query.category);
      const data = req.body?.data;

      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({ ok: false, error: 'category inválida' });
      }

      if (!data || typeof data !== 'object') {
        return res.status(400).json({ ok: false, error: 'data inválida' });
      }

      await ensureTables();

      await pool.query(
        `INSERT INTO llaves_data (category, data, created_at, updated_at)
         VALUES ($1, $2::jsonb, NOW(), NOW())
         ON CONFLICT (category)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [category, JSON.stringify(data)]
      );

      res.json({ ok: true, category });
    } catch (err) {
      console.error('POST /api/llaves', err);
      res.status(500).json({ ok: false, error: 'No se pudieron guardar las llaves' });
    }
  }


  async function deleteDesempate(req, res) {
    try {
      const category = cleanCategory(req.body?.category || req.query.category);
      const roundId = String(req.body?.roundId || req.query.roundId || '').trim();

      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({ ok: false, error: 'category inválida' });
      }

      if (!roundId) {
        return res.status(400).json({ ok: false, error: 'roundId inválido' });
      }

      await ensureTables();

      const result = await pool.query(
        `SELECT data FROM llaves_data WHERE category = $1 LIMIT 1`,
        [category]
      );

      const data = result.rows[0]?.data || { rounds: [] };
      if (!Array.isArray(data.rounds)) data.rounds = [];

      const round = data.rounds.find(r => r?.id === roundId);
      if (round && Array.isArray(round.legs)) {
        round.legs = round.legs.slice(0, 2);
        round.extraDeleted = true;
      }

      await pool.query(
        `INSERT INTO llaves_data (category, data, created_at, updated_at)
         VALUES ($1, $2::jsonb, NOW(), NOW())
         ON CONFLICT (category)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [category, JSON.stringify(data)]
      );

      res.json({ ok: true, category, roundId });
    } catch (err) {
      console.error('DELETE /api/llaves/desempate', err);
      res.status(500).json({ ok: false, error: 'No se pudo borrar el desempate' });
    }
  }

  // Soporta ambos montajes:
  // router.use(createLlavesRouter()) => /api/llaves
  // router.use('/llaves', createLlavesRouter()) => /api/llaves
  router.get('/llaves', getLlaves);
  router.delete('/llaves/desempate', deleteDesempate);
  router.post('/llaves', requireAdmin, saveLlaves);
  router.get('/', getLlaves);
  router.delete('/desempate', deleteDesempate);
  router.post('/', requireAdmin, saveLlaves);

  return router;
};
