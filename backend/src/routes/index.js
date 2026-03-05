// backend/src/routes/index.js
const express = require('express');
const createBannerRouter = require('./banner.routes');
const createAdminRouter = require('./admin.routes');
const createEquiposRouter = require('./equipos.routes');
const createFechasRouter = require('./fechas.routes');
const createCrucesRouter = require('./cruces.routes');

module.exports = function createApiRouter(deps) {
  const { DATA_DIR } = deps;

  const router = express.Router();

  // Router de banner (como antes)
  router.use('/', createBannerRouter({ DATA_DIR }));

  // Rutas de admin / auth / gestión de equipos
  router.use('/', createAdminRouter(deps));

  // Rutas específicas de equipos (guardar plantel, etc.)
  router.use('/', createEquiposRouter(deps));

  // Rutas de fechas / fixtures / planillas de fecha
  router.use('/', createFechasRouter(deps));

  // Rutas de cruces (playoffs, status, validaciones)
  router.use('/', createCrucesRouter(deps));

  // Ruta de health-check simple (igual que antes)
  router.get('/health', (req, res) => {
    res.json({ ok: true, variant: 'noauth-hard' });
  });

  return router;
};