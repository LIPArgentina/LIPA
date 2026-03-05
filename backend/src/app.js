// backend/src/app.js

const SERVER_VARIANT = 'noauth-hard';
console.log('[server] variant:', SERVER_VARIANT);

const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

// Seguridad
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const createApiRouter = require('./routes');
const { readJSON } = require('./utils/fileStorage'); // usamos helper común

const app = express();

// Confiar en proxy (útil si está detrás de nginx / render / railway, etc.)
app.set('trust proxy', 1);

// Body parser
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ========== SECURITY MIDDLEWARES ==========

// Helmet con Content Security Policy ajustada para Google Fonts
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "style-src-elem": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'self'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// 2) Límite global de la API: 300 requests / 15 minutos por IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,      // 15 minutos
  max: 300,                      // máx 300 requests por ventana
  standardHeaders: true,         // info de rate limit en headers estándar
  legacyHeaders: false,
});

// 3) Límite fuerte en logins: 10 intentos / 5 minutos por IP
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,       // 5 minutos
  max: 10,                       // máx 10 intentos
  message: {
    ok: false,
    error: 'Demasiados intentos de login, probá de nuevo en unos minutos.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Aplicamos límites específicos a logins (rutas definidas en admin.routes.js, montadas bajo /api)
app.use('/api/admin/login', loginLimiter);
app.use('/api/team/login', loginLimiter);

// ----- Directorios -----
const ROOT = path.join(__dirname, '..', '..'); // LIGA/
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const FRONTEND_DATA = path.join(FRONTEND_DIR, 'data');
const FRONTEND_EQUIPOS = path.join(FRONTEND_DIR, 'equipos');
const FRONTEND_TEMPLATES = path.join(FRONTEND_DIR, 'templates');
const FRONTEND_FECHA = path.join(FRONTEND_DIR, 'fecha');

// Asegurar carpetas de frontend
for (const d of [FRONTEND_DIR, FRONTEND_DATA, FRONTEND_EQUIPOS, FRONTEND_TEMPLATES, FRONTEND_FECHA]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ----- Archivos de persistencia (backend/data) -----
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ====== Dynamic ESM: banner.js ======
const bannerModuleHandler = (req, res) => {
  try {
    const data = readJSON(path.join(DATA_DIR, 'banner.json'), {
      text: 'Bienvenidxs a la Liga de Pool Independiente',
      link: null,
    });
    const body = `export const BANNER_CONFIG = ${JSON.stringify(data, null, 2)};\n`;
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    return res.send(body);
  } catch (err) {
    console.error('GET banner module', err);
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    return res.send('export const BANNER_CONFIG = { text: "Error al cargar banner", link: null };');
  }
};

app.get('/templates/banner.js', bannerModuleHandler);
app.get('/frontend/templates/banner.js', bannerModuleHandler);

// === Archivos estáticos ===
app.use('/frontend', express.static(FRONTEND_DIR, { extensions: ['html'] }));
app.use('/templates', express.static(FRONTEND_TEMPLATES, { extensions: ['html'] }));
app.use(express.static(FRONTEND_DIR, { extensions: ['html'] }));

app.get('/:slug.html', (req, res, next) => {
  const slug = (req.params.slug || '').toLowerCase();
  const file = path.join(FRONTEND_EQUIPOS, `${slug}.html`);
  if (fs.existsSync(file)) return res.sendFile(file);
  return next();
});

// Aplicamos el límite global de la API a todo /api
app.use('/api', apiLimiter);

// ====== API (montada en /api) ======
const apiRouter = createApiRouter({
  DATA_DIR,
  FRONTEND_DIR,
  FRONTEND_DATA,
  FRONTEND_EQUIPOS,
  FRONTEND_FECHA,
});

app.use('/api', apiRouter);

module.exports = app;