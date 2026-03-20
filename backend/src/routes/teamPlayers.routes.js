const express = require('express');
const { requireTeam } = require('../middleware/auth');
const pool = require('../../db');

module.exports = function createTeamPlayersRouter() {
  const router = express.Router();

  async function resolveTeam(rawValue) {
    const value = String(rawValue || '').trim();
    const lower = value.toLowerCase();
    if (!lower) return null;

    const result = await pool.query(
      `
      SELECT DISTINCT e.id, e.slug_uid, e.slug_base, e.display_name, e.division
      FROM equipos e
      LEFT JOIN equipo_slug_aliases a
        ON a.equipo_id = e.id
      WHERE
        LOWER(e.slug_uid) = $1
        OR LOWER(e.slug_base) = $1
        OR LOWER(e.display_name) = $1
        OR LOWER(a.alias_slug) = $1
      LIMIT 1
      `,
      [lower]
    );

    return result.rows[0] || null;
  }

  async function fetchPlayersFromDB(teamId) {
    const result = await pool.query(
      `
      SELECT nombre
      FROM jugadores
      WHERE equipo_id = $1
      ORDER BY orden ASC, id ASC
      `,
      [teamId]
    );

    return result.rows.map(r => r.nombre);
  }

  function normalizePlayers(input) {
    if (!Array.isArray(input)) return [];
    return input.map(x => String(x || '').trim()).filter(Boolean);
  }

  async function replacePlayers(teamId, players, client = pool) {
    await client.query(`DELETE FROM jugadores WHERE equipo_id = $1`, [teamId]);

    let orden = 1;
    for (const nombre of players) {
      await client.query(
        `INSERT INTO jugadores (equipo_id, nombre, orden)
         VALUES ($1, $2, $3)`,
        [teamId, nombre, orden]
      );
      orden++;
    }
  }

  function buildResponse(team, players) {
    return {
      ok: true,
      slug: team.slug_base,
      slug_uid: team.slug_uid,
      teamName: team.display_name,
      division: team.division,
      players
    };
  }

  router.get('/team-assets', async (req, res) => {
    try {
      const raw = String(req.query.team || '').trim();
      if (!raw) return res.status(400).json({ ok: false, players: [] });

      const team = await resolveTeam(raw);
      if (!team) return res.status(404).json({ ok: false, players: [] });

      const players = await fetchPlayersFromDB(team.id);
      return res.json(buildResponse(team, players));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/save-team-assets', async (req, res) => {
    const client = await pool.connect();

    try {
      const rawTeam =
        req.body?.team ??
        req.body?.slug ??
        req.body?.slug_uid ??
        req.body?.teamName ??
        '';

      const players = normalizePlayers(
        req.body?.players ??
        req.body?.jugadores ??
        req.body?.roster ??
        []
      );

      if (!rawTeam) {
        return res.status(400).json({ ok: false, error: 'Falta team' });
      }

      const team = await resolveTeam(rawTeam);
      if (!team) {
        return res.status(404).json({ ok: false, error: rawTeam });
      }

      await client.query('BEGIN');
      await replacePlayers(team.id, players, client);
      await client.query('COMMIT');

      return res.json(buildResponse(team, players));
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      return res.status(500).json({ ok: false, error: err.message });
    } finally {
      client.release();
    }
  });

  router.get('/team/players', requireTeam, async (req, res) => {
    try {
      const slug = req.user.slug;
      const team = await resolveTeam(slug);

      if (!team) return res.status(404).json({ ok: false });

      const players = await fetchPlayersFromDB(team.id);
      return res.json(buildResponse(team, players));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false });
    }
  });

  return router;
};
