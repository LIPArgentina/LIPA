const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../../db');

const DEFAULT_ADMIN_PASSWORD = 'admin123';
const LEGACY_ADMIN_STORE = path.join(__dirname, '..', '..', 'data', 'admin_password.json');

async function ensureBaseTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS equipos (
      id SERIAL PRIMARY KEY,
      slug_uid TEXT UNIQUE,
      slug_base TEXT,
      division TEXT,
      display_name TEXT,
      username TEXT,
      role TEXT DEFAULT 'team',
      captain TEXT,
      phone TEXT,
      email TEXT,
      password_hash TEXT,
      must_change_password BOOLEAN DEFAULT false,
      password_updated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE equipos
      ADD COLUMN IF NOT EXISTS slug_uid TEXT,
      ADD COLUMN IF NOT EXISTS slug_base TEXT,
      ADD COLUMN IF NOT EXISTS division TEXT,
      ADD COLUMN IF NOT EXISTS display_name TEXT,
      ADD COLUMN IF NOT EXISTS username TEXT,
      ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'team',
      ADD COLUMN IF NOT EXISTS captain TEXT,
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS password_hash TEXT,
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
  `);

  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS equipos_slug_uid_idx ON equipos (slug_uid);`);
  await client.query(`CREATE INDEX IF NOT EXISTS equipos_division_idx ON equipos (division);`);
  await client.query(`CREATE INDEX IF NOT EXISTS equipos_slug_base_idx ON equipos (slug_base);`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS jugadores (
      id SERIAL PRIMARY KEY,
      equipo_id INTEGER REFERENCES equipos(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      dorsal TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS planillas (
      id SERIAL PRIMARY KEY,
      equipo_id INTEGER REFERENCES equipos(id) ON DELETE CASCADE,
      fecha_clave DATE DEFAULT CURRENT_DATE,
      estado TEXT DEFAULT 'guardada',
      datos JSONB NOT NULL,
      source_file TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE planillas
      ADD COLUMN IF NOT EXISTS fecha_clave DATE DEFAULT CURRENT_DATE,
      ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'guardada',
      ADD COLUMN IF NOT EXISTS source_file TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS planillas_equipo_updated_idx ON planillas (equipo_id, updated_at DESC, id DESC);`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS fixtures (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      category TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(kind, category)
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS fixtures_kind_category_idx ON fixtures (kind, category);`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS banners (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      link_href TEXT,
      link_label TEXT,
      position INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE banners
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      id SERIAL PRIMARY KEY,
      credential_key TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

function readLegacyAdminHash() {
  try {
    if (!fs.existsSync(LEGACY_ADMIN_STORE)) return null;
    const raw = fs.readFileSync(LEGACY_ADMIN_STORE, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.hash === 'string' && parsed.hash.trim() ? parsed.hash.trim() : null;
  } catch (_) {
    return null;
  }
}

async function ensureAdminCredential(client) {
  const existing = await client.query(
    `SELECT id FROM admin_credentials WHERE credential_key = $1 LIMIT 1`,
    ['primary_admin']
  );

  if (existing.rowCount > 0) return;

  const legacyHash = readLegacyAdminHash();
  const passwordHash = legacyHash || await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

  await client.query(
    `INSERT INTO admin_credentials (credential_key, password_hash, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (credential_key) DO NOTHING`,
    ['primary_admin', passwordHash]
  );
}

let bootstrapPromise = null;

async function bootstrapSchema() {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureBaseTables(client);
      await ensureAdminCredential(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })();

  return bootstrapPromise;
}

module.exports = {
  bootstrapSchema,
};
