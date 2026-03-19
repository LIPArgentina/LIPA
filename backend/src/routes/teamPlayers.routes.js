const express = require('express');
const { requireTeam } = require('../middleware/auth');
const pool = require('../../db');

module.exports = function createTeamPlayersRouter() {
  const router = express.Router();

  function normalizeCompact(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  function normalizeLoose(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '');
  }

  router.get('/team/players', requireTeam, async (req, res) => {
    try {
      const requestedTeam = String(
        (req.query && req.query.team) ||
        (req.user && req.user.slug) ||
        ''
      ).trim().toLowerCase();

      if (!requestedTeam) {
        return res.status(401).json({ ok: false, error: 'No autenticade' });
      }

      const requestedCompact = normalizeCompact(requestedTeam);
      const requestedLoose = normalizeLoose(requestedTeam);

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
          lower(e.slug_uid) = $1
          OR lower(e.slug_base) = $1
          OR lower(COALESCE(a.alias_slug, '')) = $1
          OR regexp_replace(lower(e.slug_uid), '[^a-z0-9]+', '', 'g') = $2
          OR regexp_replace(lower(e.slug_base), '[^a-z0-9]+', '', 'g') = $2
          OR regexp_replace(lower(COALESCE(a.alias_slug, '')), '[^a-z0-9]+', '', 'g') = $2
          OR replace(lower(e.slug_uid), '_', '') = $3
          OR replace(lower(COALESCE(a.alias_slug, '')), '_', '') = $3
        ORDER BY
          CASE
            WHEN lower(e.slug_uid) = $1 THEN 1
            WHEN lower(COALESCE(a.alias_slug, '')) = $1 THEN 2
            WHEN lower(e.slug_base) = $1 THEN 3
            WHEN regexp_replace(lower(e.slug_uid), '[^a-z0-9]+', '', 'g') = $2 THEN 4
            WHEN regexp_replace(lower(COALESCE(a.alias_slug, '')), '[^a-z0-9]+', '', 'g') = $2 THEN 5
            WHEN regexp_replace(lower(e.slug_base), '[^a-z0-9]+', '', 'g') = $2 THEN 6
            WHEN replace(lower(e.slug_uid), '_', '') = $3 THEN 7
            WHEN replace(lower(COALESCE(a.alias_slug, '')), '_', '') = $3 THEN 8
            ELSE 99
          END,
          e.id ASC
        LIMIT 1
        `,
        [requestedTeam, requestedCompact, requestedLoose]
      );

      if (teamResult.rowCount === 0) {
        return res.status(404).json({ ok: false, error: 'Equipo no encontrado' });
      }

      const team = teamResult.rows[0];

      const playersResult = await pool.query(
        `
        SELECT nombre
        FROM jugadores
        WHERE equipo_id = $1
        ORDER BY orden ASC, id ASC
        `,
        [team.id]
      );

      const players = playersResult.rows
        .map((r) => String(r.nombre || '').trim())
        .filter(Boolean);

      return res.json({
        ok: true,
        requestedTeam,
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
