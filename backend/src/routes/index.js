const express = require('express');
const createBannerRouter = require('./banner.routes');
const createAdminRouter = require('./admin.routes');
const createEquiposRouter = require('./equipos.routes');
const createFechasRouter = require('./fechas.routes');
// const createCrucesRouter = require('./cruces.routes');
// const createTeamPlayersRouter = require('./teamPlayers.routes');
const adminPlanillas = require('./admin.planillas');

module.exports = function createApiRouter(deps) {
  const { DATA_DIR } = deps;

  const router = express.Router();

  // Visor admin de planillas
  router.use('/admin', adminPlanillas);

  // Router de banner
  router.use('/', createBannerRouter({ DATA_DIR }));

  // Rutas de admin / auth / gestión de equipos
  router.use('/', createAdminRouter(deps));

  // Rutas específicas de equipos
  router.use('/', createEquiposRouter(deps));

  // Rutas de fechas / fixtures / planillas de fecha
  router.use('/', createFechasRouter(deps));

  // Rutas de cruces
  //  router.use('/', createCrucesRouter(deps));

  // Health-check
  router.get('/health', (req, res) => {
    res.json({ ok: true, variant: 'noauth-fhard' });
  });

  // router.use(createTeamPlayersRouter(deps));

  return router;
};