const express = require('express');
const { requireTeam } = require('../middleware/auth');
const pool = require('../../db');

module.exports = function createTeamPlayersRouter() {
  const router = express.Router();

  router.get('/team/players', requireTeam, async (req, res) => {
    try {
      const slug = String((req.user && req.user.slug) || '').trim().toLowerCase();

      if (!slug) {
        return res.status(401).json({ ok: false, error: 'No autenticade' });
      }

      // buscar equipo
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
        return res.status(404).json({ ok: false, error: 'Equipo no encontrado' });
      }

      const team = teamResult.rows[0];

      // traer jugadores
      const playersResult = await pool.query(
        `
        SELECT nombre
        FROM jugadores
        WHERE equipo_id = $1
        ORDER BY orden ASC
        `,
        [team.id]
      );

      const players = playersResult.rows.map(r => r.nombre);

      return res.json({
        ok: true,
        slug: team.slug_base,
        slug_uid: team.slug_uid,
        teamName: team.display_name,
        division: team.division,
        players
      });

    } catch (err) {
      console.error('GET /team/players', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  return router;
};