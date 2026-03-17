const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { readJSON, writeJSON } = require('../utils/fileStorage');
const pool = require('../../db');

module.exports = function createEquiposRouter(deps) {
  const { DATA_DIR } = deps;

  const router = express.Router();

  const TEAM_STORE = path.join(DATA_DIR, 'team_passwords.json');
  let teamPasswords = readJSON(TEAM_STORE, {});

  async function ensureTeam(slug) {
    if (!teamPasswords[slug]) {
      teamPasswords[slug] = await bcrypt.hash('1234', 10);
      writeJSON(TEAM_STORE, teamPasswords);
    }
  }

  async function ensureEquiposTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS equipos (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        division TEXT NOT NULL,
        role TEXT DEFAULT 'team',
        captain TEXT DEFAULT '',
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
  }

  function buildSlug(value = '') {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  // ====== GUARDAR EQUIPOS EN POSTGRES ======
  router.post('/save-teams', async (req, res) => {
    const client = await pool.connect();

    try {
      const { division, teams } = req.body || {};

      if (!division || !Array.isArray(teams)) {
        return res.status(400).json({ ok: false });
      }

      await ensureEquiposTable();

      const processedTeams = await Promise.all(
        teams.map(async (team) => {
          const username = String(team.username || '').trim();
          const slug = buildSlug(username);

          await ensureTeam(slug);

          return {
            username,
            slug,
            role: 'team',
            captain: '',
            email: '',
            phone: ''
          };
        })
      );

      await client.query('BEGIN');

      await client.query(
        `DELETE FROM equipos WHERE division = $1`,
        [division]
      );

      for (const team of processedTeams) {
        await client.query(
          `INSERT INTO equipos (slug, nombre, division)
           VALUES ($1, $2, $3)
           ON CONFLICT (slug)
           DO UPDATE SET
             nombre = EXCLUDED.nombre,
             division = EXCLUDED.division`,
          [team.slug, team.username, division]
        );
      }

      await client.query('COMMIT');

      res.json({ ok: true });

    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ ok: false });
    } finally {
      client.release();
    }
  });

  // ====== LEER EQUIPOS DESDE POSTGRES ======
  router.get('/teams', async (req, res) => {
    try {
      const { division } = req.query;

      const result = await pool.query(
        `SELECT slug, nombre FROM equipos WHERE division = $1 ORDER BY nombre`,
        [division]
      );

      res.json({
        ok: true,
        teams: result.rows.map(r => ({
          username: r.nombre,
          slug: r.slug,
          role: 'team'
        }))
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false });
    }
  });

  // ====== PLANTEL (esto ya lo tenías bien) ======
  router.post('/save-team-assets', async (req, res) => {
    try {
      const { slug, teamName, players } = req.body || {};

      await pool.query(
        `INSERT INTO team_players (slug, team_name, players)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug)
         DO UPDATE SET
           team_name = EXCLUDED.team_name,
           players = EXCLUDED.players`,
        [slug, teamName, JSON.stringify(players)]
      );

      res.json({ ok: true });

    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false });
    }
  });

  router.get('/team-assets', async (req, res) => {
    try {
      const { team } = req.query;

      const result = await pool.query(
        'SELECT players, team_name FROM team_players WHERE slug = $1',
        [team]
      );

      if (!result.rowCount) {
        return res.json({ ok: true, players: [] });
      }

      res.json({
        ok: true,
        players: result.rows[0].players
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false });
    }
  });

  return router;
};