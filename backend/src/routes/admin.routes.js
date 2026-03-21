// backend/src/routes/admin.routes.js
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../db');
const { readJSON, writeJSON } = require('../utils/fileStorage');

const DEFAULT_TEAM_PASSWORD = '1234';

module.exports = function createAdminRouter(deps) {
  const { DATA_DIR } = deps;

  const router = express.Router();

  // ----- Admin password store -----
  const ADMIN_STORE = path.join(DATA_DIR, 'admin_password.json');
  let adminPassword = readJSON(ADMIN_STORE, { hash: bcrypt.hashSync('admin123', 10) });

  async function findTeamBySlug(slug) {
    const safeSlug = String(slug || '').trim().toLowerCase();
    if (!safeSlug) return null;

    const result = await pool.query(
      `SELECT id, slug_uid, slug_base, division, username, display_name,
              password_hash, must_change_password, password_updated_at
         FROM equipos
        WHERE LOWER(slug_uid) = $1 OR LOWER(slug_base) = $1
        ORDER BY CASE WHEN LOWER(slug_uid) = $1 THEN 0 ELSE 1 END, id ASC
        LIMIT 1`,
      [safeSlug]
    );

    return result.rows[0] || null;
  }

  async function ensureDbTeamPassword(team) {
    if (!team) return null;
    if (team.password_hash && String(team.password_hash).trim()) return team;

    const hash = await bcrypt.hash(DEFAULT_TEAM_PASSWORD, 10);
    const updated = await pool.query(
      `UPDATE equipos
          SET password_hash = $1,
              must_change_password = true,
              password_updated_at = COALESCE(password_updated_at, NOW())
        WHERE id = $2
      RETURNING id, slug_uid, slug_base, division, username, display_name,
                password_hash, must_change_password, password_updated_at`,
      [hash, team.id]
    );

    return updated.rows[0] || { ...team, password_hash: hash, must_change_password: true };
  }

  // ====== API: Admin ======
  router.post('/admin/login', async (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ ok: false, msg: 'faltan campos' });
    const ok = await bcrypt.compare(password, adminPassword.hash);
    if (!ok) return res.status(401).json({ ok: false });
    return res.json({ ok: true });
  });

  router.post('/admin/change-password', async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ ok: false, msg: 'faltan campos' });
    }
    const ok = await bcrypt.compare(oldPassword, adminPassword.hash);
    if (!ok) return res.status(401).json({ ok: false, msg: 'actual incorrecta' });
    adminPassword.hash = await bcrypt.hash(newPassword, 10);
    writeJSON(ADMIN_STORE, adminPassword);
    return res.json({ ok: true });
  });

  // ====== API: Team Login (DB + JWT) ======
  router.post('/team/login', async (req, res) => {
    const { slug, password } = req.body || {};
    if (!slug || !password) {
      return res.status(400).json({ ok: false, msg: 'faltan campos' });
    }

    let team = await findTeamBySlug(slug);
    if (!team) {
      return res.status(404).json({ ok: false, msg: 'equipo inexistente' });
    }

    team = await ensureDbTeamPassword(team);
    const ok = await bcrypt.compare(password, team.password_hash || '');
    if (!ok) return res.status(401).json({ ok: false, msg: 'contraseña incorrecta' });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ ok:false, msg:'Falta JWT_SECRET en servidor' });

    const token = jwt.sign(
      {
        role: 'team',
        teamId: team.id,
        slug: team.slug_uid,
        slugBase: team.slug_base,
        category: team.division,
      },
      secret,
      { expiresIn: '12h' }
    );

    res.cookie('lpi_auth', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
    });

    return res.json({
      ok: true,
      team: team.slug_uid,
      slug: team.slug_uid,
      category: team.division,
      mustChangePassword: Boolean(team.must_change_password),
      token,
    });
  });

  router.post('/team/change-password', async (req, res) => {
    const { slug, oldPassword, newPassword } = req.body || {};
    if (!slug || !oldPassword || !newPassword) {
      return res.status(400).json({ ok: false, msg: 'faltan campos' });
    }

    let team = await findTeamBySlug(slug);
    if (!team) {
      return res.status(404).json({ ok: false, msg: 'equipo inexistente' });
    }

    team = await ensureDbTeamPassword(team);
    const ok = await bcrypt.compare(oldPassword, team.password_hash || '');
    if (!ok) return res.status(401).json({ ok: false, msg: 'actual incorrecta' });

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE equipos
          SET password_hash = $1,
              must_change_password = false,
              password_updated_at = NOW()
        WHERE id = $2`,
      [newHash, team.id]
    );

    return res.json({ ok: true });
  });

  router.post('/logout', (req,res)=>{
    res.clearCookie('lpi_auth');
    return res.json({ ok:true });
  });

  return router;
};
