const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { readJSON, writeJSON } = require('../utils/fileStorage');
const pool = require('../../db');

module.exports = function createEquiposRouter(deps) {
  const { DATA_DIR } = deps;
  const router = express.Router();

  const TEAM_STORE = path.join(DATA_DIR, 'team_passwords.json');
  let teamPasswords = readJSON(TEAM_STORE, {});

  async function ensureTeam(slug) {
    if (!teamPasswords[slug]) {
      teamPasswords[slug] = await bcrypt.hash('1234', 10);
      writeJSON(TEAM_STORE, teamPasswords);
    }
  }

  function buildSlug(value = '') {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function normalizeDivision(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  router.post('/save-teams', async (req, res) => {
    const client = await pool.connect();

    try {
      const { division, teams } = req.body || {};
      const normalizedDivision = normalizeDivision(division);

      if (!normalizedDivision || !Array.isArray(teams)) {
        return res.status(400).json({ ok: false, error: 'division o teams inválidos' });
      }

      const processed = teams.map(t => {
        const username = String(t.username || '').trim();
        if (!username) return null;

        const explicitSlug = String(t.slug || '').trim().toLowerCase();
        const slugBase = buildSlug(explicitSlug || username);
        const slugUid = explicitSlug || `${slugBase}_${normalizedDivision}`;

        return {
          slug_uid: slugUid,
          slug_base: slugBase,
          division: normalizedDivision,
          display_name: username,
          username,
          role: String(t.role || 'team').trim() || 'team',
          captain: String(t.captain || '').trim(),
          phone: String(t.phone || '').trim(),
          email: String(t.email || '').trim()
        };
      }).filter(Boolean);

      await client.query('BEGIN');

      for (const t of processed) {
        await ensureTeam(t.slug_uid);

        await client.query(
          `INSERT INTO equipos
           (slug_uid, slug_base, division, display_name, username, role, captain, phone, email)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (slug_uid)
           DO UPDATE SET
             slug_base = EXCLUDED.slug_base,
             division = EXCLUDED.division,
             display_name = EXCLUDED.display_name,
             username = EXCLUDED.username,
             role = EXCLUDED.role,
             captain = EXCLUDED.captain,
             phone = EXCLUDED.phone,
             email = EXCLUDED.email`,
          [
            t.slug_uid,
            t.slug_base,
            t.division,
            t.display_name,
            t.username,
            t.role,
            t.captain,
            t.phone,
            t.email
          ]
        );
      }

      // IMPORTANTE:
      // No borramos equipos existentes de la división, para no cambiar sus IDs y
      // romper relaciones con jugadores/planillas. La limpieza de equipos viejos
      // conviene hacerla con una migración controlada.

      await client.query('COMMIT');
      res.json({ ok: true, saved: processed.length, preservedIds: true });

    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ ok: false, error: err.message });
    } finally {
      client.release();
    }
  });

  router.get('/teams', async (req, res) => {
    try {
      const division = normalizeDivision(req.query.division);

      const result = await pool.query(
        `SELECT slug_uid, username, role, captain, email, phone
         FROM equipos
         WHERE division = $1
         ORDER BY username`,
        [division]
      );

      res.json({
        ok: true,
        teams: result.rows.map(r => ({
          username: r.username,
          slug: r.slug_uid,
          role: r.role || 'team',
          captain: r.captain || '',
          email: r.email || '',
          phone: r.phone || ''
        }))
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
};
