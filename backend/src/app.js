const pool = require("../db");
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const cors = require('cors');

// Seguridad
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');



const createApiRouter = require('./routes/index');
const crucesDbRouter = require('./routes/cruces.routes.db');
const { bootstrapSchema } = require('./bootstrap/schema');

const app = express();

bootstrapSchema().then(() => {
  console.log('Esquema DB verificado');
}).catch((err) => {
  console.error('Error verificando esquema DB:', err);
});

app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/* =========================================================
   CORS PARA FRONTEND SEPARADO / LOCAL
========================================================= */

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'https://lipa.ar',
  'https://www.lipa.ar',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Origen no permitido por CORS: ' + origin));
    },
    credentials: true,
  })
);

/* =========================================================
   SEGURIDAD
========================================================= */

app.use(helmet());

const isLocalRequest = (req) => {
  const ip = String(req.ip || '');
  const host = String(req.hostname || '');
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip === '::ffff:127.0.0.1'
  );
};

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: (req) => {
    if (isLocalRequest(req)) return true;

    // Login de equipos y auth no se limitan para evitar bloquear pruebas locales
    if (req.path.startsWith('/team/')) return true;
    if (req.path.startsWith('/auth/')) return true;

    return false;
  },
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
const PICTURES_DIR = process.env.PICTURES_DIR
  ? path.resolve(process.env.PICTURES_DIR)
  : path.join(ROOT, 'backend', 'data', 'pictures');

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
  PICTURES_DIR,
].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/* =========================================================
   API
========================================================= */

app.get('/api/health-direct', (req, res) => {
  res.json({ ok: true, source: 'app.js-direct' });
});

app.use('/api/cruces', crucesDbRouter);

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
    PICTURES_DIR,
  })
);

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
   INIT DB / SCHEMA BOOTSTRAP
========================================================= */

app.get("/init-db", async (req, res) => {
  try {
    await bootstrapSchema();
    res.json({
      ok: true,
      message: "Esquema de base de datos verificado correctamente"
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
