// backend/src/routes/admin.routes.js
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { readJSON, writeJSON } = require('../utils/fileStorage');

module.exports = function createAdminRouter(deps) {
  const { DATA_DIR } = deps;

  const router = express.Router();

  // ----- Password stores -----
  const TEAM_STORE = path.join(DATA_DIR, 'team_passwords.json');
  const ADMIN_STORE = path.join(DATA_DIR, 'admin_password.json');

  let teamPasswords = readJSON(TEAM_STORE, {});
  let adminPassword = readJSON(ADMIN_STORE, { hash: bcrypt.hashSync('admin123', 10) });

  async function ensureTeam(slug) {
    if (!teamPasswords[slug]) {
      teamPasswords[slug] = await bcrypt.hash('1234', 10);
      writeJSON(TEAM_STORE, teamPasswords);
    }
  }

  // ====== API: Admin / Passwords ======
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

  // ====== API: Team Login (DEVUELVE TOKEN) ======
  router.post('/team/login', async (req, res) => {
    const { slug, password } = req.body || {};
    if (!slug || !password) {
      return res.status(400).json({ ok: false, msg: 'faltan campos' });
    }
    await ensureTeam(slug);
    const ok = await bcrypt.compare(password, teamPasswords[slug]);
    if (!ok) return res.status(401).json({ ok: false, msg: 'contraseña incorrecta' });

    // JWT (recomendado): no devolvemos hashes
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ ok:false, msg:'Falta JWT_SECRET en servidor' });

    const token = jwt.sign({ role: 'team', slug }, secret, { expiresIn: '12h' });

    // Cookie httpOnly (ideal en producción con HTTPS)
    res.cookie('lpi_auth', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
    });

    return res.json({ ok: true, team: slug, token });
  });

  router.post('/team/change-password', async (req, res) => {
    const { slug, oldPassword, newPassword } = req.body || {};
    if (!slug || !oldPassword || !newPassword) {
      return res.status(400).json({ ok: false, msg: 'faltan campos' });
    }
    await ensureTeam(slug);
    const ok = await bcrypt.compare(oldPassword, teamPasswords[slug]);
    if (!ok) return res.status(401).json({ ok: false, msg: 'actual incorrecta' });
    teamPasswords[slug] = await bcrypt.hash(newPassword, 10);
    writeJSON(TEAM_STORE, teamPasswords);
    return res.json({ ok: true });
  });

  router.post('/logout', (req,res)=>{
    res.clearCookie('lpi_auth');
    return res.json({ ok:true });
  });

  return router;
};