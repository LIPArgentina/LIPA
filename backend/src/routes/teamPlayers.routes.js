const express = require('express');
const { requireTeam } = require('../middleware/auth');
const pool = require('../../db');

module.exports = function createTeamPlayersRouter() {
  const router = express.Router();

  async function resolveTeamBySlug(rawSlug) {
    const slug = String(rawSlug || '').trim().toLowerCase();

    if (!slug) return null;

    const teamResult = await pool.query(
      `
      SELECT e.id, e.slug_uid, e.slug_base, e.display_name, e.division
      FROM equipos e
      LEFT JOIN equipo_slug_aliases a
        ON a.equipo_id = e.id
      WHERE
        e.slug_uid = $1
        OR e.slug_base = $1
        OR a.alias_slug = $1
      LIMIT 1
      `,
      [slug]
    );

    if (teamResult.rowCount === 0) {
      return null;
    }

    return teamResult.rows[0];
  }

  async function fetchPlayersForTeam(teamId) {
    const playersResult = await pool.query(
      `
      SELECT nombre
      FROM jugadores
      WHERE equipo_id = $1
      ORDER BY orden ASC
      `,
      [teamId]
    );

    return playersResult.rows.map(r => r.nombre);
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

  // Compatibilidad con el admin actual
  // GET /api/team-assets?team=slug_uid|slug_base|alias
  router.get('/team-assets', async (req, res) => {
    try {
      const rawTeam = String(req.query.team || '').trim().toLowerCase();

      if (!rawTeam) {
        return res.status(400).json({ ok: false, error: 'Falta team', players: [] });
      }

      const team = await resolveTeamBySlug(rawTeam);

      if (!team) {
        return res.status(404).json({ ok: false, error: 'Equipo no encontrado', players: [] });
      }

      const players = await fetchPlayersForTeam(team.id);

      return res.json(buildResponse(team, players));
    } catch (err) {
      console.error('GET /team-assets', err);
      return res.status(500).json({ ok: false, error: 'Error interno', players: [] });
    }
  });

  // Ruta autenticada existente
  // GET /api/team/players
  router.get('/team/players', requireTeam, async (req, res) => {
    try {
      const slug = String((req.user && req.user.slug) || '').trim().toLowerCase();

      if (!slug) {
        return res.status(401).json({ ok: false, error: 'No autenticade' });
      }

      const team = await resolveTeamBySlug(slug);

      if (!team) {
        return res.status(404).json({ ok: false, error: 'Equipo no encontrado' });
      }

      const players = await fetchPlayersForTeam(team.id);

      return res.json(buildResponse(team, players));
    } catch (err) {
      console.error('GET /team/players', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  return router;
};
