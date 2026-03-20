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

  function normalizePlayers(input) {
    if (!Array.isArray(input)) return [];
    return input
      .map(x => String(x || '').trim())
      .filter(Boolean);
  }

  async function replacePlayers(teamId, players, client = pool) {
    await client.query(
      `DELETE FROM jugadores WHERE equipo_id = $1`,
      [teamId]
    );

    let orden = 1;
    for (const nombre of players) {
      await client.query(
        `
        INSERT INTO jugadores (equipo_id, nombre, orden)
        VALUES ($1, $2, $3)
        `,
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

  // GET /api/team-assets?team=slug_uid|slug_base
  router.get('/team-assets', async (req, res) => {
    try {
      const raw = String(req.query.team || '').trim().toLowerCase();
      if (!raw) {
        return res.status(400).json({ ok: false, players: [], error: 'Falta team' });
      }

      const team = await resolveTeamBySlug(raw);
      if (!team) {
        return res.status(404).json({ ok: false, players: [], error: 'Equipo no encontrado' });
      }

      const players = await fetchPlayersFromDB(team.id);
      return res.json(buildResponse(team, players));

    } catch (err) {
      console.error('GET /team-assets', err);
      return res.status(500).json({ ok: false, players: [], error: 'Error interno' });
    }
  });

  // POST /api/save-team-assets
  // Compatibilidad con admin.html/admin.js
  router.post('/save-team-assets', async (req, res) => {
    const client = await pool.connect();

    try {
      const rawTeam = String(
        req.body?.team ||
        req.body?.slug ||
        req.body?.slug_uid ||
        req.body?.teamName ||
        ''
      ).trim().toLowerCase();

      const players = normalizePlayers(
        req.body?.players ||
        req.body?.jugadores ||
        req.body?.roster ||
        []
      );

      if (!rawTeam) {
        return res.status(400).json({ ok: false, error: 'Falta team' });
      }

      const team = await resolveTeamBySlug(rawTeam);
      if (!team) {
        return res.status(404).json({ ok: false, error: 'Equipo no encontrado' });
      }

      await client.query('BEGIN');
      await replacePlayers(team.id, players, client);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        slug: team.slug_base,
        slug_uid: team.slug_uid,
        teamName: team.display_name,
        division: team.division,
        players
      });

    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /save-team-assets', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    } finally {
      client.release();
    }
  });

  // GET /api/team/players (ruta autenticada existente)
  router.get('/team/players', requireTeam, async (req, res) => {
    try {
      const slug = String(req.user?.slug || '').trim().toLowerCase();
      if (!slug) {
        return res.status(401).json({ ok: false, error: 'No autenticade' });
      }

      const team = await resolveTeamBySlug(slug);
      if (!team) {
        return res.status(404).json({ ok: false, error: 'Equipo no encontrado' });
      }

      const players = await fetchPlayersFromDB(team.id);
      return res.json(buildResponse(team, players));

    } catch (err) {
      console.error('GET /team/players', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  return router;
};
