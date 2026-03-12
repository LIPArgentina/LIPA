const express = require('express');
const pool = require('../../db');

module.exports = function createTeamPlayersRouter() {
  const router = express.Router();

  router.get('/team/players', async (req, res) => {
    try {
      const rawSlug = String(
        (req.user && req.user.slug) ||
        req.query.team ||
        req.query.slug ||
        ''
      ).trim().toLowerCase();

      if (!rawSlug) {
        return res.status(400).json({ ok: false, error: 'Falta team/slug' });
      }

      const teamResult = await pool.query(
        `
          SELECT
            e.id,
            e.slug_uid,
            e.slug_base,
            e.display_name,
            e.division
          FROM equipos e
          LEFT JOIN equipo_slug_aliases a
            ON a.equipo_id = e.id
          WHERE
            e.slug_uid = $1
            OR e.slug_base = $1
            OR a.alias_slug = $1
          ORDER BY
            CASE
              WHEN e.slug_uid = $1 THEN 1
              WHEN e.slug_base = $1 THEN 2
              ELSE 3
            END,
            CASE e.division
              WHEN 'primera' THEN 1
              WHEN 'segunda' THEN 2
              WHEN 'tercera' THEN 3
              ELSE 9
            END
        `,
        [rawSlug]
      );

      if (teamResult.rowCount === 0) {
        return res.status(404).json({ ok: false, error: 'Equipo no encontrado' });
      }

      const exactUid = teamResult.rows.filter(r => r.slug_uid === rawSlug);
      const exactBase = teamResult.rows.filter(r => r.slug_base === rawSlug);

      let teamRow = null;

      if (exactUid.length === 1) {
        teamRow = exactUid[0];
      } else if (exactBase.length === 1) {
        teamRow = exactBase[0];
      } else if (teamResult.rowCount === 1) {
        teamRow = teamResult.rows[0];
      } else {
        return res.status(409).json({
          ok: false,
          error: 'slug_ambiguo',
          message: 'El slug coincide con más de un equipo/división. Hace falta usar slug_uid.',
          matches: teamResult.rows.map(r => ({
            slug_uid: r.slug_uid,
            display_name: r.display_name,
            division: r.division
          }))
        });
      }

      const playersResult = await pool.query(
        `
          SELECT nombre
          FROM jugadores
          WHERE equipo_id = $1
          ORDER BY
            CASE WHEN orden IS NULL THEN 1 ELSE 0 END,
            orden ASC,
            nombre ASC
        `,
        [teamRow.id]
      );

      const players = playersResult.rows
        .map(r => String(r.nombre || '').trim())
        .filter(Boolean);

      res.set('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        slug: teamRow.slug_base,
        slug_uid: teamRow.slug_uid,
        teamName: teamRow.display_name,
        division: teamRow.division,
        players
      });
    } catch (err) {
      console.error('GET /team/players', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  return router;
};