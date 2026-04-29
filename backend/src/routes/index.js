const express = require('express');
const createBannerRouter = require('./banner.routes');
const createAdminRouter = require('./admin.routes');
const createEquiposRouter = require('./equipos.routes');
const createFechasRouter = require('./fechas.routes');
const createTeamPlayersRouter = require('./teamPlayers.routes');
const adminPlanillas = require('./admin.planillas');
const createPicturesRouter = require('./pictures.routes');
const createStatsRouter = require('./stats.routes');
const createLlavesRouter = require('./llaves.routes');

module.exports = function createApiRouter(deps) {
  const { DATA_DIR } = deps;

  const router = express.Router();

  // Health-check primero
  router.get('/health', (req, res) => {
    res.json({ ok: true, variant: 'noauth-fhard' });
  });

  // Equipos primero para que /teams y /save-teams no queden tapados
  router.use('/', createEquiposRouter(deps));

  // Visor admin de planillas
  router.use('/admin', adminPlanillas);

  // Admin / auth
  router.use('/', createAdminRouter(deps));

  // Banner
  router.use('/', createBannerRouter({ DATA_DIR }));

  // Fechas / fixtures / planillas
  router.use('/', createFechasRouter(deps));

  // Players
  router.use('/', createTeamPlayersRouter(deps));

  // Pictures
  router.use('/pictures', createPicturesRouter(deps));

  // Stats públicas: /api/track-visit y /api/public-stats
  router.use('/', createStatsRouter(deps));

  // Llaves públicas/admin: /api/llaves y /api/llaves/proximo-cruce
  router.use('/', createLlavesRouter(deps));

  return router;
};
