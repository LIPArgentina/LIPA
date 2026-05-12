// backend/src/middleware/auth.js
const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('Falta JWT_SECRET en .env');
  return s;
}

function getToken(req) {
  const bearer =
    req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;

  return bearer || (req.cookies && req.cookies.lpi_auth) || null;
}

function requireTeam(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ ok: false, msg: 'no autenticade' });

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.role !== 'team' || !payload.slug) {
      return res.status(403).json({ ok: false, msg: 'sin permisos' });
    }
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, msg: 'token inválido' });
  }
}

function requireSala(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ ok: false, msg: 'no autenticade' });

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.role !== 'sala' || !payload.salaId) {
      return res.status(403).json({ ok: false, msg: 'sin permisos' });
    }
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, msg: 'token inválido' });
  }
}

function requireAdmin(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ ok: false, msg: 'no autenticade' });

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.role !== 'admin') {
      return res.status(403).json({ ok: false, msg: 'sin permisos' });
    }
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, msg: 'token inválido' });
  }
}

module.exports = { requireTeam, requireSala, requireAdmin };
