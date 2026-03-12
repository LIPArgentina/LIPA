// backend/src/routes/equipos.routes.js
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const { readJSON, writeJSON } = require('../utils/fileStorage');

module.exports = function createEquiposRouter(deps) {
  const { DATA_DIR, FRONTEND_DATA, FRONTEND_EQUIPOS } = deps;

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
        return res.status(400).json({ ok: false, error: 'Faltan campos o inválidos (division, teams)' });
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
      console.error('Error al guardar equipos', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  // ====== API: Guardar plantel ======
  router.post('/save-team-assets', async (req, res) => {
    try {
      const { slug, teamName, players } = req.body || {};
      if (!slug || !teamName || !Array.isArray(players)) {
        return res.status(400).json({ ok: false, error: 'Faltan campos o inválidos (slug, teamName, players)' });
      }

      if (!/^[a-z0-9]+$/.test(slug)) {
        return res.status(403).json({ ok: false, error: 'Slug no autorizado' });
      }

      await ensureTeam(slug);

      const jsPath = path.join(FRONTEND_EQUIPOS, `${slug}.players.js`);
      const jsContent =
        `window.LPI_TEAM_PLAYERS = window.LPI_TEAM_PLAYERS || {};\n` +
        `window.LPI_TEAM_PLAYERS["${slug}"] = ${JSON.stringify(players, null, 2)};\n`;
      await fs.promises.writeFile(jsPath, jsContent, 'utf8');

      const jsonPath = path.join(FRONTEND_EQUIPOS, `${slug}.players.json`);
      await fs.promises.writeFile(jsonPath, JSON.stringify({ players }, null, 2), 'utf8');

      return res.json({ ok: true, message: 'Plantel guardado' });
    } catch (err) {
      console.error('Error al guardar plantel', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });
      // ====== API: Obtener jugadores de un equipo ======
router.get('/team/players', async (req, res) => {
  try {
    const slug = String(req.query.team || req.query.slug || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    if (!slug) {
      return res.status(400).json({ ok: false, error: 'Falta slug del equipo' });
    }

    const jsonPath = path.join(FRONTEND_EQUIPOS, `${slug}.players.json`);

    if (!fs.existsSync(jsonPath)) {
      return res.json({
        ok: true,
        slug,
        teamName: null,
        players: []
      });
    }

    const data = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));

    return res.json({
      ok: true,
      slug,
      teamName: slug,
      players: data.players || []
    });

  } catch (err) {
    console.error('Error cargando jugadores', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});
  return router;
};