const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../../db');

const ACCESS_TOKEN_TTL = '2h';
const ACCESS_COOKIE_MS = 2 * 60 * 60 * 1000;
const REFRESH_DAYS = {
  admin: 7,
  team: 60,
  sala: 60,
};

let schemaPromise = null;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Falta JWT_SECRET en servidor');
  return secret;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function publicClaims(claims = {}) {
  const clean = { ...claims };
  delete clean.iat;
  delete clean.exp;
  delete clean.nbf;
  delete clean.jti;
  return clean;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS auth_refresh_sessions (
        id BIGSERIAL PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,
        subject_key TEXT NOT NULL,
        claims JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS auth_refresh_sessions_subject_idx
        ON auth_refresh_sessions(role, subject_key);
      CREATE INDEX IF NOT EXISTS auth_refresh_sessions_expiry_idx
        ON auth_refresh_sessions(expires_at);
    `).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function signAccessToken(claims) {
  return jwt.sign(publicClaims(claims), getJwtSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

function sessionDays(role) {
  return REFRESH_DAYS[String(role || '').toLowerCase()] || 7;
}

async function createRenewableSession(claims, subjectKey) {
  await ensureSchema();
  const cleanClaims = publicClaims(claims);
  const role = String(cleanClaims.role || '').toLowerCase();
  const days = sessionDays(role);
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO auth_refresh_sessions(token_hash, role, subject_key, claims, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [hashToken(refreshToken), role, String(subjectKey || role), JSON.stringify(cleanClaims), expiresAt]
  );

  pool.query(
    `DELETE FROM auth_refresh_sessions
      WHERE expires_at < NOW() - INTERVAL '7 days'
         OR revoked_at < NOW() - INTERVAL '7 days'`
  ).catch(() => {});

  return {
    token: signAccessToken(cleanClaims),
    refreshToken,
    sessionExpiresAt: expiresAt.toISOString(),
  };
}

async function refreshRenewableSession(refreshToken) {
  if (!refreshToken) return null;
  await ensureSchema();
  const result = await pool.query(
    `UPDATE auth_refresh_sessions
        SET last_used_at = NOW()
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      RETURNING role, subject_key, claims, expires_at`,
    [hashToken(refreshToken)]
  );
  const row = result.rows[0];
  if (!row) return null;
  const claims = publicClaims(row.claims || {});
  return {
    token: signAccessToken(claims),
    refreshToken,
    sessionExpiresAt: new Date(row.expires_at).toISOString(),
    claims,
    subjectKey: row.subject_key,
  };
}

async function revokeRenewableSession(refreshToken) {
  if (!refreshToken) return false;
  await ensureSchema();
  const result = await pool.query(
    `UPDATE auth_refresh_sessions
        SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE token_hash = $1`,
    [hashToken(refreshToken)]
  );
  return result.rowCount > 0;
}

function setAccessCookie(res, token) {
  res.cookie('lpi_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ACCESS_COOKIE_MS,
  });
}

module.exports = {
  createRenewableSession,
  refreshRenewableSession,
  revokeRenewableSession,
  setAccessCookie,
};
