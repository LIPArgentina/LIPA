const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const { readJSON, writeJSON } = require('../utils/fileStorage');
const pool = require('../../db');

module.exports = function createEquiposRouter(deps) {
  const { DATA_DIR, FRONTEND_DATA } = deps;

  const router = express.Router();

  const TEAM_STORE = path.join(DATA_DIR, 'team_passwords.json');
  let teamPasswords = readJSON(TEAM_STORE, {});

  async function ensureTeam(slug) {
    if (!teamPasswords[slug]) {
      teamPasswords[slug] = await bcrypt.hash('1234', 10);
      writeJSON(TEAM_STORE, teamPasswords);
    }
  }

  // ====== API: Guardar equipos ======
  router.post('/save-teams', async (req, res) => {
    try {
      const { division, teams } = req.body || {};
      if (!division || !Array.isArray(teams)) {
        return res.status(400).json({ ok: false, error: 'Faltan campos (division, teams)' });
      }

      if (!['primera', 'segunda', 'tercera'].includes(division)) {
        return res.status(403).json({ ok: false, error: 'División no autorizada' });
      }

      const processedTeams = await Promise.all(
        teams.map(async (team) => {
          const slug = String(team.username || '')
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]/g, '');

          await ensureTeam(slug);
          return { ...team, slug };
        })
      );

      const jsPath = path.join(FRONTEND_DATA, `usuarios.${division}.js`);
      const jsContent = `window.LPI_USERS = ${JSON.stringify(processedTeams, null, 2)};\n`;
      await fs.promises.writeFile(jsPath, jsContent, 'utf8');

      const jsonPath = path.join(FRONTEND_DATA, `usuarios.${division}.json`);
      await fs.promises.writeFile(jsonPath, JSON.stringify({ users: processedTeams }, null, 2), 'utf8');

      return res.json({ ok: true, message: 'Equipos guardados' });

    } catch (err) {
      console.error('save-teams', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  // ====== API: Guardar plantel en PostgreSQL ======
  router.post('/save-team-assets', async (req, res) => {
    try {
      const { slug, teamName, players } = req.body || {};

      if (!slug || !teamName || !Array.isArray(players)) {
        return res.status(400).json({
          ok: false,
          error: 'Faltan campos (slug, teamName, players)'
        });
      }

      if (!/^[a-z0-9]+$/.test(slug)) {
        return res.status(403).json({ ok: false, error: 'Slug inválido' });
      }

      await ensureTeam(slug);

      await pool.query(
        `
        INSERT INTO team_players (slug, team_name, players)
        VALUES ($1, $2, $3)
        ON CONFLICT (slug)
        DO UPDATE SET
          team_name = EXCLUDED.team_name,
          players = EXCLUDED.players
        `,
        [slug, teamName, JSON.stringify(players)]
      );

      return res.json({
        ok: true,
        message: 'Plantel guardado'
      });

    } catch (err) {
      console.error('save-team-assets', err);
      return res.status(500).json({
        ok: false,
        error: 'Error interno'
      });
    }
  });

  // ====== API: Leer plantel desde PostgreSQL ======
  router.get('/team-assets', async (req, res) => {
    try {
      const { team } = req.query;

      if (!team) {
        return res.status(400).json({
          ok: false,
          error: 'team requerido'
        });
      }

      const result = await pool.query(
        'SELECT players, team_name FROM team_players WHERE slug = $1',
        [team]
      );

      if (result.rowCount === 0) {
        return res.json({
          ok: true,
          players: [],
          teamName: null
        });
      }

      return res.json({
        ok: true,
        players: result.rows[0].players || [],
        teamName: result.rows[0].team_name || null
      });

    } catch (err) {
      console.error('GET /team-assets', err);
      return res.status(500).json({
        ok: false,
        error: 'Error interno'
      });
    }
  });

  return router;
};
