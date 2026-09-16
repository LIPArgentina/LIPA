
const jwt = require('jsonwebtoken');

const SECOND_CATEGORY_ALLOWED_TEAMS = new Set([
  'albapool_segunda',
  'eltrebol_segunda',
  'lospatosdelaliga_segunda',
  'takospro_segunda',
  'victoria_segunda',
  'west_segunda',
]);

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

function authFailure(res, err) {
  if (err && err.name === 'TokenExpiredError') {
    return res.status(401).json({ ok: false, code: 'TOKEN_EXPIRED', msg: 'La sesión venció' });
  }
  return res.status(401).json({ ok: false, code: 'TOKEN_INVALID', msg: 'token inválido' });
}

function readOptionalUser(req) {
  try {
    const token = getToken(req);
    return token ? jwt.verify(token, getJwtSecret()) : null;
  } catch (_) {
    return null;
  }
}

function canViewSecondCategory(user) {
  const role = String(user?.role || '').trim().toLowerCase();
  if (role === 'admin') return true;
  const slug = String(user?.slug || '').trim().toLowerCase();
  const category = String(user?.category || '').trim().toLowerCase();
  return role === 'team' && category === 'segunda' && SECOND_CATEGORY_ALLOWED_TEAMS.has(slug);
}

function requireSecondCategoryAccess(req, res, next) {
  const user = readOptionalUser(req);
  if (!canViewSecondCategory(user)) return res.status(403).json({ ok: false, msg: 'sin permisos para consultar segunda' });
  req.user = user;
  return next();
}

function requireTeam(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ ok: false, code: 'AUTH_MISSING', msg: 'no autenticade' });

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.role !== 'team' || !payload.slug) {
      return res.status(403).json({ ok: false, msg: 'sin permisos' });
    }
    req.user = payload;
    return next();
  } catch (err) {
    return authFailure(res, err);
  }
}

function requireSala(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ ok: false, code: 'AUTH_MISSING', msg: 'no autenticade' });

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.role !== 'sala' || !payload.salaId) {
      return res.status(403).json({ ok: false, msg: 'sin permisos' });
    }
    req.user = payload;
    return next();
  } catch (err) {
    return authFailure(res, err);
  }
}

function requireAdmin(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ ok: false, code: 'AUTH_MISSING', msg: 'no autenticade' });

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.role !== 'admin') {
      return res.status(403).json({ ok: false, msg: 'sin permisos' });
    }
    req.user = payload;
    return next();
  } catch (err) {
    return authFailure(res, err);
  }
}

module.exports = {
  requireTeam,
  requireSala,
  requireAdmin,
  requireSecondCategoryAccess,
  readOptionalUser,
  canViewSecondCategory,
};
