
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../db');
const { requireAdmin } = require('../middleware/auth');

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

  async function ensureActivoColumn(client = pool) {
    await client.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true`);
  }

  router.post('/save-teams', requireAdmin, async (req, res) => {
    const client = await pool.connect();

    try {
      const { division, teams } = req.body || {};
      if (!division || !Array.isArray(teams)) {
        return res.status(400).json({ ok: false, error: 'division y teams son obligatorios' });
      }

      await client.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS subcaptain TEXT`);
      await ensureActivoColumn(client);

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
          subcaptain: t.subcaptain || t.subcapitan || '',
          phone: t.phone || '',
          email: t.email || '',
          activo: t.activo !== false
        };
      }).filter(Boolean);

      const keepSlugs = processed.map(t => t.slug_uid);
      const defaultHash = await bcrypt.hash(DEFAULT_TEAM_PASSWORD, 10);

      await client.query('BEGIN');

      for (const t of processed) {
        await client.query(
          `INSERT INTO equipos
             (slug_uid, slug_base, division, display_name, username, role, captain, subcaptain, phone, email,
              activo, password_hash, must_change_password, password_updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,NOW())
           ON CONFLICT (slug_uid)
           DO UPDATE SET
             slug_base = EXCLUDED.slug_base,
             division = EXCLUDED.division,
             display_name = EXCLUDED.display_name,
             username = EXCLUDED.username,
             role = EXCLUDED.role,
             captain = EXCLUDED.captain,
             subcaptain = EXCLUDED.subcaptain,
             phone = EXCLUDED.phone,
             email = EXCLUDED.email,
             activo = EXCLUDED.activo`,
          [
            t.slug_uid,
            t.slug_base,
            t.division,
            t.display_name,
            t.username,
            t.role,
            t.captain,
            t.subcaptain,
            t.phone,
            t.email,
            t.activo,
            defaultHash,
          ]
        );
      }

      if (keepSlugs.length > 0) {
        await client.query(
          `UPDATE equipos
              SET activo = false
            WHERE division = $1
              AND NOT (slug_uid = ANY($2::text[]))`,
          [division, keepSlugs]
        );
      } else {
        await client.query(`UPDATE equipos SET activo = false WHERE division = $1`, [division]);
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
      const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
      await pool.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS subcaptain TEXT`);
      await ensureActivoColumn();

      const result = await pool.query(
        `SELECT id, slug_uid, username, role, captain, subcaptain, email, phone, activo
           FROM equipos
          WHERE division = $1
            AND ($2::boolean = true OR activo = true)
          ORDER BY username`,
        [division, includeInactive]
      );

      res.json({
        ok: true,
        teams: result.rows.map(r => ({
          id: r.id,
          username: r.username,
          slug: r.slug_uid,
          role: r.role || 'team',
          captain: r.captain || '',
          subcaptain: r.subcaptain || '',
          email: r.email || '',
          phone: r.phone || '',
          activo: r.activo !== false
        }))
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.patch('/teams/:id/active', requireAdmin, async (req, res) => {
    try {
      await ensureActivoColumn();

      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: 'id inválido' });
      }

      const active = req.body?.activo !== false && req.body?.active !== false;
      const result = await pool.query(
        `UPDATE equipos
            SET activo = $1
          WHERE id = $2
          RETURNING id, slug_uid, username, activo`,
        [active, id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: 'equipo no encontrado' });
      }

      return res.json({ ok: true, team: result.rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
};
