
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

  async function ensurePlayerTeamDeactivationColumn(client = pool) {
    await client.query(`
      ALTER TABLE jugador_equipos
      ADD COLUMN IF NOT EXISTS inactivado_por_equipo BOOLEAN NOT NULL DEFAULT false
    `);
  }

  async function deactivatePlayersFromInactiveTeams(client, { teamId = null, division = null } = {}) {
    const result = await client.query(
      `UPDATE jugador_equipos je
          SET activo = false,
              hasta = CURRENT_DATE,
              inactivado_por_equipo = true,
              updated_at = NOW()
         FROM equipos e
        WHERE e.id = je.equipo_id
          AND e.activo = false
          AND je.activo = true
          AND ($1::int IS NULL OR e.id = $1::int)
          AND ($2::text IS NULL OR e.division = $2::text)
      RETURNING je.id`,
      [teamId, division]
    );
    return result.rowCount;
  }

  async function reactivatePlayersFromActiveTeams(client, { teamId = null, division = null } = {}) {
    const restored = await client.query(
      `WITH active_counts AS (
         SELECT equipo_id, categoria, COUNT(DISTINCT jugador_id)::int AS total
           FROM jugador_equipos
          WHERE activo = true
          GROUP BY equipo_id, categoria
       ), candidates AS (
         SELECT je.id,
                ROW_NUMBER() OVER (PARTITION BY je.equipo_id, je.categoria ORDER BY je.id) AS position,
                GREATEST(0, 20 - COALESCE(ac.total, 0)) AS available_slots
           FROM jugador_equipos je
           JOIN equipos e ON e.id = je.equipo_id
           LEFT JOIN active_counts ac
             ON ac.equipo_id = je.equipo_id
            AND ac.categoria = je.categoria
          WHERE e.activo = true
            AND je.activo = false
            AND je.inactivado_por_equipo = true
            AND ($1::int IS NULL OR e.id = $1::int)
            AND ($2::text IS NULL OR e.division = $2::text)
            AND NOT EXISTS (
              SELECT 1
                FROM jugador_equipos other
               WHERE other.jugador_id = je.jugador_id
                 AND other.categoria = je.categoria
                 AND other.activo = true
                 AND other.equipo_id <> je.equipo_id
            )
       )
       UPDATE jugador_equipos je
          SET activo = true,
              hasta = NULL,
              inactivado_por_equipo = false,
              updated_at = NOW()
         FROM candidates c
        WHERE je.id = c.id
          AND c.position <= c.available_slots
      RETURNING je.id`,
      [teamId, division]
    );

    const skipped = await client.query(
      `SELECT COUNT(*)::int AS total
         FROM jugador_equipos je
         JOIN equipos e ON e.id = je.equipo_id
        WHERE e.activo = true
          AND je.activo = false
          AND je.inactivado_por_equipo = true
          AND ($1::int IS NULL OR e.id = $1::int)
          AND ($2::text IS NULL OR e.division = $2::text)`,
      [teamId, division]
    );

    return {
      restored: restored.rowCount,
      skipped: Number(skipped.rows[0]?.total || 0),
    };
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
      await ensurePlayerTeamDeactivationColumn(client);

      const processed = teams.map(t => {
        const username = String(t.username || '').trim();
        if (!username) return null;

        const slugBase = buildSlug(username);
        const slugUid = `${slugBase}_${division}`;

        return {
          id: Number.isInteger(Number(t.id)) && Number(t.id) > 0 ? Number(t.id) : null,
          slug_uid: String(t.slug || t.slug_uid || slugUid).trim() || slugUid,
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

      const keepIds = [];
      const defaultHash = await bcrypt.hash(DEFAULT_TEAM_PASSWORD, 10);

      await client.query('BEGIN');

      for (const t of processed) {
        if (t.id) {
          const updated = await client.query(
            `UPDATE equipos
                SET display_name = $1,
                    username = $2,
                    role = $3,
                    captain = $4,
                    subcaptain = $5,
                    phone = $6,
                    email = $7,
                    activo = $8
              WHERE id = $9
                AND division = $10
              RETURNING id`,
            [
              t.display_name,
              t.username,
              t.role,
              t.captain,
              t.subcaptain,
              t.phone,
              t.email,
              t.activo,
              t.id,
              division,
            ]
          );
          if (updated.rowCount !== 1) {
            throw new Error(`No se encontró el equipo ID ${t.id} en ${division}`);
          }
          keepIds.push(updated.rows[0].id);
          continue;
        }

        const inserted = await client.query(
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
             activo = EXCLUDED.activo
           RETURNING id`,
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
        keepIds.push(inserted.rows[0].id);
      }

      if (keepIds.length > 0) {
        await client.query(
          `UPDATE equipos
              SET activo = false
            WHERE division = $1
              AND NOT (id = ANY($2::int[]))`,
          [division, keepIds]
        );
      } else {
        await client.query(`UPDATE equipos SET activo = false WHERE division = $1`, [division]);
      }

      const playersDeactivated = await deactivatePlayersFromInactiveTeams(client, { division });
      const playersReactivated = await reactivatePlayersFromActiveTeams(client, { division });

      await client.query('COMMIT');
      res.json({ ok: true, playersDeactivated, playersReactivated });

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
    const client = await pool.connect();
    try {
      await ensureActivoColumn(client);
      await ensurePlayerTeamDeactivationColumn(client);

      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: 'id inválido' });
      }

      const active = req.body?.activo !== false && req.body?.active !== false;
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE equipos
            SET activo = $1
          WHERE id = $2
          RETURNING id, slug_uid, username, activo`,
        [active, id]
      );

      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: 'equipo no encontrado' });
      }

      const playersDeactivated = active
        ? 0
        : await deactivatePlayersFromInactiveTeams(client, { teamId: id });
      const playersReactivated = active
        ? await reactivatePlayersFromActiveTeams(client, { teamId: id })
        : { restored: 0, skipped: 0 };

      await client.query('COMMIT');
      return res.json({ ok: true, team: result.rows[0], playersDeactivated, playersReactivated });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error(err);
      return res.status(500).json({ ok: false, error: err.message });
    } finally {
      client.release();
    }
  });

  return router;
};
