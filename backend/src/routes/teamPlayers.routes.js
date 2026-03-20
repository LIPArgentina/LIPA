const express = require('express');
const { requireTeam } = require('../middleware/auth');
const pool = require('../../db');

module.exports = function createTeamPlayersRouter() {
  const router = express.Router();

  async function resolveTeamBySlug(rawSlug) {
    const slug = String(rawSlug || '').trim().toLowerCase();
    if (!slug) return null;

    const result = await pool.query(`
      SELECT id, slug_uid, slug_base, display_name, division
      FROM equipos
      WHERE slug_uid = $1 OR slug_base = $1
      LIMIT 1
    `, [slug]);

    if (result.rowCount === 0) return null;
    return result.rows[0];
  }

  async function fetchPlayersFromDB(teamId) {
    const result = await pool.query(`
      SELECT nombre
      FROM jugadores
      WHERE equipo_id = $1
      ORDER BY orden ASC
    `, [teamId]);

    return result.rows.map(r => r.nombre);
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
      const raw = String(req.query.team || '').trim().toLowerCase();
      if (!raw) {
        return res.status(400).json({ ok: false, players: [] });
      }

      const team = await resolveTeamBySlug(raw);
      if (!team) {
        return res.status(404).json({ ok: false, players: [] });
      }

      const players = await fetchPlayersFromDB(team.id);

      return res.json(buildResponse(team, players));

    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, players: [] });
    }
  });

  router.get('/team/players', requireTeam, async (req, res) => {
    try {
      const slug = req.user.slug;
      const team = await resolveTeamBySlug(slug);

      if (!team) {
        return res.status(404).json({ ok: false });
      }

      const players = await fetchPlayersFromDB(team.id);

      return res.json(buildResponse(team, players));

    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false });
    }
  });

  return router;
};
