// backend/src/routes/teamPlayers.routes.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireTeam } = require('../middleware/auth');

module.exports = function createTeamPlayersRouter(deps) {
  const { FRONTEND_DIR } = deps;
  const router = express.Router();

  router.get('/team/players', requireTeam, async (req, res) => {
    try {
      const slug = String((req.user && req.user.slug) || '').trim().toLowerCase();
      if (!slug) {
        return res.status(401).json({ ok: false, error: 'No autenticade' });
      }

      const filePath = path.join(FRONTEND_DIR, 'equipos', `${slug}.players.json`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ ok: false, error: 'No existe el plantel del equipo' });
      }

      const raw = await fs.promises.readFile(filePath, 'utf8');
      const data = JSON.parse(raw);

      let players = [];
      let teamName = null;

      if (Array.isArray(data)) {
        players = data;
      } else if (data && Array.isArray(data.players)) {
        players = data.players;
        teamName = data.teamName || data.name || data.team || null;
      } else if (data && Array.isArray(data.jugadores)) {
        players = data.jugadores;
        teamName = data.teamName || data.name || data.team || null;
      } else if (data && typeof data === 'object') {
        if (Array.isArray(data[slug])) {
          players = data[slug];
        } else {
          for (const value of Object.values(data)) {
            if (Array.isArray(value)) {
              players = value;
              break;
            }
          }
        }
        teamName = data.teamName || data.name || data.team || null;
      }

      players = players.map(x => String(x || '').trim()).filter(Boolean);

      res.set('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        slug,
        teamName,
        players
      });
    } catch (err) {
      console.error('GET /team/players', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  return router;
};
