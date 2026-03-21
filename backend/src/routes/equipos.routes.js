// backend/src/routes/equipos.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../db');

const DEFAULT_TEAM_PASSWORD = '1234';

module.exports = function createEquiposRouter() {
  const router = express.Router();

  function buildSlug(value = '') {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  router.post('/save-teams', async (req, res) => {
    const client = await pool.connect();

    try {
      const { division, teams } = req.body || {};
      if (!division || !Array.isArray(teams)) {
        return res.status(400).json({ ok: false, error: 'division y teams son obligatorios' });
      }

      const processed = teams.map(t => {
        const username = String(t.username || '').trim();
        if (!username) return null;

        const slugBase = buildSlug(username);
        const slugUid = `${slugBase}_${division}`;

        return {
          slug_uid: slugUid,
          slug_base: slugBase,
          division,
          display_name: username,
          username,
          role: 'team',
          captain: t.captain || '',
          phone: t.phone || '',
          email: t.email || ''
        };
      }).filter(Boolean);

      const keepSlugs = processed.map(t => t.slug_uid);
      const defaultHash = await bcrypt.hash(DEFAULT_TEAM_PASSWORD, 10);

      await client.query('BEGIN');

      for (const t of processed) {
        await client.query(
          `INSERT INTO equipos
             (slug_uid, slug_base, division, display_name, username, role, captain, phone, email,
              password_hash, must_change_password, password_updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NOW())
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
            t.email,
            defaultHash,
          ]
        );
      }

      if (keepSlugs.length > 0) {
        await client.query(
          `DELETE FROM equipos
            WHERE division = $1
              AND NOT (slug_uid = ANY($2::text[]))`,
          [division, keepSlugs]
        );
      } else {
        await client.query(`DELETE FROM equipos WHERE division = $1`, [division]);
      }

      await client.query('COMMIT');
      res.json({ ok: true });

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
      const { division } = req.query;

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
