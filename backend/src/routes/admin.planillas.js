const express = require('express');
const router = express.Router();
const pool = require('../../db');

// GET /api/admin/planillas
router.get('/planillas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.slug_base AS team,
        p.datos,
        p.updated_at
      FROM planillas p
      JOIN equipos e ON e.id = p.equipo_id
      ORDER BY e.display_name ASC
    `);

    const out = result.rows.map(r => ({
      team: r.team,
      planilla: r.datos,
      updatedAt: r.updated_at
    }));

    res.json(out);
  } catch (err) {
    console.error('Error admin planillas:', err);
    res.status(500).json({ ok: false, error: 'error leyendo planillas' });
  }
});

module.exports = router;
