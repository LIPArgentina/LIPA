// backend/src/routes/admin.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../db');
const { requireAdmin } = require('../middleware/auth');

const DEFAULT_TEAM_PASSWORD = '1234';

module.exports = function createAdminRouter(deps) {
  const router = express.Router();

  async function getAdminCredential() {
    const result = await pool.query(
      `SELECT id, password_hash
         FROM admin_credentials
        WHERE credential_key = $1
        LIMIT 1`,
      ['primary_admin']
    );

    return result.rows[0] || null;
  }

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

  async function findTeamById(teamId) {
    const id = Number(teamId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const result = await pool.query(
      `SELECT id, slug_uid, slug_base, division, username, display_name,
              password_hash, must_change_password, password_updated_at
         FROM equipos
        WHERE id = $1
        LIMIT 1`,
      [id]
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
    const adminCredential = await getAdminCredential();
    if (!adminCredential) return res.status(500).json({ ok: false, msg: 'Admin no configurado en DB' });

    const ok = await bcrypt.compare(password, adminCredential.password_hash);
    if (!ok) return res.status(401).json({ ok: false });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ ok:false, msg:'Falta JWT_SECRET en servidor' });

    const token = jwt.sign(
      { role: 'admin' },
      secret,
      { expiresIn: '12h' }
    );

    res.cookie('lpi_auth', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
    });

    return res.json({ ok: true, token });
  });

  router.post('/admin/change-password', async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ ok: false, msg: 'faltan campos' });
    }
    const adminCredential = await getAdminCredential();
    if (!adminCredential) return res.status(500).json({ ok: false, msg: 'Admin no configurado en DB' });

    const ok = await bcrypt.compare(oldPassword, adminCredential.password_hash);
    if (!ok) return res.status(401).json({ ok: false, msg: 'actual incorrecta' });

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE admin_credentials
          SET password_hash = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [newHash, adminCredential.id]
    );

    return res.json({ ok: true, source: 'db' });
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


  router.post('/admin/impersonate-team', requireAdmin, async (req, res) => {
    try {
      const teamId = req.body?.teamId;
      const rawSlug = req.body?.slug;

      let team = null;
      if (teamId != null && teamId !== '') {
        team = await findTeamById(teamId);
      }
      if (!team && rawSlug) {
        team = await findTeamBySlug(rawSlug);
      }

      if (!team) {
        return res.status(404).json({ ok: false, error: 'equipo inexistente' });
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) return res.status(500).json({ ok:false, msg:'Falta JWT_SECRET en servidor' });

      const token = jwt.sign(
        {
          role: 'team',
          teamId: team.id,
          slug: team.slug_uid,
          slugBase: team.slug_base,
          category: team.division,
          impersonatedBy: 'admin'
        },
        secret,
        { expiresIn: '45m' }
      );

      return res.json({
        ok: true,
        session: {
          role: 'team',
          displayName: team.display_name || team.username || team.slug_uid,
          team: team.slug_uid,
          slug: team.slug_uid,
          category: team.division,
          token,
          isTestSession: true,
          ts: Date.now()
        }
      });
    } catch (err) {
      console.error('POST /admin/impersonate-team', err);
      return res.status(500).json({ ok: false, error: 'No se pudo generar la sesión de prueba.' });
    }
  });

  router.post('/logout', (req,res)=>{
    res.clearCookie('lpi_auth');
    return res.json({ ok:true });
  });

  return router;
};
