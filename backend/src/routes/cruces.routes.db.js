const express = require('express');
const router = express.Router();
const pool = require('../../db');

// =====================
// NUEVOS ENDPOINTS
// =====================

// Guardar estado del cruce (autosave)
router.post('/match-status', async (req, res) => {
  try {
    const { team, data } = req.body || {};
    if (!team || !data) {
      return res.status(400).json({ ok: false, error: 'Faltan datos' });
    }

    await pool.query(
      `INSERT INTO cruces (team, status_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (team)
       DO UPDATE SET status_json = $2, updated_at = NOW()`,
      [team, data]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /match-status', err);
    res.status(500).json({ ok: false, error: 'Error guardando estado' });
  }
});

// Obtener estado del cruce
router.get('/match-status', async (req, res) => {
  try {
    const { team } = req.query;
    if (!team) {
      return res.status(400).json({ ok: false, error: 'Falta team' });
    }

    const result = await pool.query(
      `SELECT status_json FROM cruces WHERE team = $1`,
      [team]
    );

    res.json({ ok: true, data: result.rows[0]?.status_json || null });
  } catch (err) {
    console.error('GET /match-status', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo estado' });
  }
});

// Validar cruce
router.post('/validate', async (req, res) => {
  try {
    const { team, data } = req.body || {};
    if (!team || !data) {
      return res.status(400).json({ ok: false, error: 'Faltan datos' });
    }

    await pool.query(
      `UPDATE cruces
       SET validacion_json = $2, validated = true, updated_at = NOW()
       WHERE team = $1`,
      [team, data]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /validate', err);
    res.status(500).json({ ok: false, error: 'Error validando cruce' });
  }
});

// Estado de bloqueo
router.get('/lock-status', async (req, res) => {
  try {
    const { team } = req.query;
    if (!team) {
      return res.status(400).json({ ok: false, error: 'Falta team' });
    }

    const result = await pool.query(
      `SELECT validated FROM cruces WHERE team = $1`,
      [team]
    );

    res.json({ ok: true, locked: result.rows[0]?.validated || false });
  } catch (err) {
    console.error('GET /lock-status', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo lock' });
  }
});

module.exports = router;
