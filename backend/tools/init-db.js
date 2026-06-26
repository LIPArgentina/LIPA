require("dotenv").config();
const pool = require("../db");

async function initDB() {
  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS equipos (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        password_hash TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS jugadores (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        dni TEXT,
        fecha_nacimiento DATE,
        nombre_normalizado TEXT,
        equipo_id INTEGER REFERENCES equipos(id) ON DELETE SET NULL,
        dorsal TEXT,
        orden INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS jugador_equipos (
        id SERIAL PRIMARY KEY,
        jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
        equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
        categoria TEXT NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT true,
        desde DATE DEFAULT CURRENT_DATE,
        hasta DATE,
        orden INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS planillas (
        id SERIAL PRIMARY KEY,
        equipo_id INTEGER REFERENCES equipos(id) ON DELETE CASCADE,
        datos JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log("✅ Base de datos inicializada correctamente");
    process.exit();

  } catch (err) {
    console.error("❌ Error creando tablas:", err);
    process.exit(1);
  }
}

initDB();
