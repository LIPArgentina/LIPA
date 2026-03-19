const express = require('express');
const { requireTeam } = require('../middleware/auth');
const pool = require('../../db');

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function isCategoryFlag(value) {
  const v = normalizeSlug(value);
  return v.startsWith('__categoria_');
}

function buildSlugVariants(value) {
  const raw = normalizeSlug(value);
  if (!raw) return [];

  const compact = raw.replace(/[_-]/g, '');
  const withUnderscore = raw.replace(/-/g, '_');
  const withDash = raw.replace(/_/g, '-');

  return [...new Set([raw, compact, withUnderscore, withDash].filter(Boolean))];
}

module.exports = function createTeamPlayersRouter() {
  const router = express.Router();

  router.get('/team/players', requireTeam, async (req, res) => {
    try {
      const requestedFromQuery = normalizeSlug(req.query && req.query.team);
      const fallbackFromSession = normalizeSlug(req.user && req.user.slug);

      const lookupKey = requestedFromQuery && !isCategoryFlag(requestedFromQuery)
        ? requestedFromQuery
        : fallbackFromSession;

      if (!lookupKey) {
        return res.status(401).json({ ok: false, error: 'No autenticade' });
      }

      const variants = buildSlugVariants(lookupKey);

      const teamResult = await pool.query(
        `
        SELECT
          e.id,
          e.slug_uid,
          e.slug_base,
          e.display_name,
          e.division,
          CASE
            WHEN lower(e.slug_uid) = ANY($1::text[]) THEN 1
            WHEN replace(replace(lower(e.slug_uid), '_', ''), '-', '') = ANY($2::text[]) THEN 2
            WHEN lower(a.alias_slug) = ANY($1::text[]) THEN 3
            WHEN replace(replace(lower(a.alias_slug), '_', ''), '-', '') = ANY($2::text[]) THEN 4
            WHEN lower(e.slug_base) = ANY($1::text[]) THEN 5
            WHEN replace(replace(lower(e.slug_base), '_', ''), '-', '') = ANY($2::text[]) THEN 6
            ELSE 999
          END AS priority
        FROM equipos e
        LEFT JOIN equipo_slug_aliases a
          ON a.equipo_id = e.id
        WHERE
          lower(e.slug_uid) = ANY($1::text[])
          OR replace(replace(lower(e.slug_uid), '_', ''), '-', '') = ANY($2::text[])
          OR lower(e.slug_base) = ANY($1::text[])
          OR replace(replace(lower(e.slug_base), '_', ''), '-', '') = ANY($2::text[])
          OR lower(a.alias_slug) = ANY($1::text[])
          OR replace(replace(lower(a.alias_slug), '_', ''), '-', '') = ANY($2::text[])
        ORDER BY priority ASC, e.id ASC
        LIMIT 1
        `,
        [variants, variants.map(v => v.replace(/[_-]/g, ''))]
      );

      if (teamResult.rowCount === 0) {
        return res.status(404).json({ ok: false, error: 'Equipo no encontrado', requestedTeam: lookupKey });
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

      const players = playersResult.rows.map(r => r.nombre);

      return res.json({
        ok: true,
        requestedTeam: lookupKey,
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
