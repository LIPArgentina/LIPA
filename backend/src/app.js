const pool = require("../db");
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const cors = require('cors');

// Seguridad
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const createApiRouter = require('./routes');
const { readJSON } = require('./utils/fileStorage');
const adminPlanillasRouter = require('./routes/admin.planillas');

const app = express();

app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/* =========================================================
   CORS PARA FRONTEND SEPARADO
========================================================= */

const allowedOrigins = [
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origen no permitido por CORS: ' + origin));
    },
    credentials: true,
  })
);

/* =========================================================
   SEGURIDAD
========================================================= */

app.use(helmet());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

app.use('/api', limiter);

/* =========================================================
   PATHS DEL PROYECTO
========================================================= */

const ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(ROOT, 'backend', 'data');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const FRONTEND_DATA = path.join(FRONTEND_DIR, 'data');
const FRONTEND_EQUIPOS = path.join(FRONTEND_DIR, 'equipos');
const FRONTEND_TEMPLATES = path.join(FRONTEND_DIR, 'templates');
const FRONTEND_FECHA = path.join(FRONTEND_DIR, 'fecha');

/* =========================================================
   ASEGURAR DIRECTORIOS
========================================================= */

[
  DATA_DIR,
  FRONTEND_DIR,
  FRONTEND_DATA,
  FRONTEND_EQUIPOS,
  FRONTEND_TEMPLATES,
  FRONTEND_FECHA,
].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/* =========================================================
   API
========================================================= */

app.use(
  '/api',
  createApiRouter({
    ROOT,
    DATA_DIR,
    FRONTEND_DIR,
    FRONTEND_DATA,
    FRONTEND_EQUIPOS,
    FRONTEND_TEMPLATES,
    FRONTEND_FECHA,
  })
);

app.use(adminPlanillasRouter);

/* =========================================================
   FRONTEND ESTÁTICO (temporal, hasta separar del todo)
========================================================= */

app.use(express.static(FRONTEND_DIR));
app.use('/frontend', express.static(FRONTEND_DIR));
app.use('/templates', express.static(FRONTEND_TEMPLATES));
app.use('/fecha', express.static(FRONTEND_FECHA));

/* =========================================================
   TEST DB
========================================================= */

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      ok: true,
      now: result.rows[0].now
    });
  } catch (err) {
    console.error("Error DB:", err);
    res.status(500).json({
      ok: false,
      error: "DB error"
    });
  }
});

/* =========================================================
   INIT DB (TEMPORAL)
========================================================= */

app.get("/init-db", async (req, res) => {
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
        equipo_id INTEGER REFERENCES equipos(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        dorsal TEXT,
        created_at TIMESTAMP DEFAULT NOW()
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

    res.json({
      ok: true,
      message: "Base de datos inicializada correctamente"
    });
  } catch (err) {
    console.error("Error init-db:", err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* =========================================================
   FALLBACK
========================================================= */

app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

module.exports = app;