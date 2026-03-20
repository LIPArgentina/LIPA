const express = require('express');
const { requireTeam } = require('../middleware/auth');
const pool = require('../../db');
const fs = require('fs');
const path = require('path');

module.exports = function createTeamPlayersRouter() {
  const router = express.Router();

  const EQUIPOS_DIR = path.join(__dirname, '../../../frontend/equipos');

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

  function tryReadJSON(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(data) ? data : (data.players || []);
    } catch {
      return null;
    }
  }

  function tryReadJS(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      delete require.cache[require.resolve(filePath)];
      const mod = require(filePath);
      if (Array.isArray(mod)) return mod;
      if (mod && Array.isArray(mod.players)) return mod.players;
      return null;
    } catch {
      return null;
    }
  }

  function fetchPlayersFromFiles(team) {
    const candidates = [
      team.slug_base,
      team.slug_uid
    ];

    for (const name of candidates) {
      const jsonPath = path.join(EQUIPOS_DIR, `${name}.players.json`);
      const jsPath = path.join(EQUIPOS_DIR, `${name}.players.js`);

      let players = tryReadJSON(jsonPath);
      if (players && players.length) return players;

      players = tryReadJS(jsPath);
      if (players && players.length) return players;
    }

    return [];
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

      let players = await fetchPlayersFromDB(team.id);

      if (!players.length) {
        players = fetchPlayersFromFiles(team);
      }

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

      let players = await fetchPlayersFromDB(team.id);

      if (!players.length) {
        players = fetchPlayersFromFiles(team);
      }

      return res.json(buildResponse(team, players));

    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false });
    }
  });

  return router;
};
