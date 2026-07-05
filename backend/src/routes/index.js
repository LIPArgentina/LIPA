const express = require('express');
const createBannerRouter = require('./banner.routes');
const createAdminRouter = require('./admin.routes');
const createEquiposRouter = require('./equipos.routes');
const createSalasRouter = require('./salas.routes');
const createFechasRouter = require('./fechas.routes');
const createTeamPlayersRouter = require('./teamPlayers.routes');
const adminPlanillas = require('./admin.planillas');
const createPicturesRouter = require('./pictures.routes');
const createStatsRouter = require('./stats.routes');
const createLlavesRouter = require('./llaves.routes');
const reglamentoRouter = require('./reglamento.routes');
const createVideosRouter = require('./videos.routes');
const createPlayersAdminRouter = require('./playersAdmin.routes');

module.exports = function createApiRouter(deps) {
  const { DATA_DIR } = deps;

  const router = express.Router();


  router.get('/health', (req, res) => {
    res.json({ ok: true, variant: 'noauth-fhard' });
  });


  router.use('/', createEquiposRouter(deps));


  router.use('/', createSalasRouter(deps));


  router.use('/admin', adminPlanillas);


  router.use('/', createAdminRouter(deps));


  router.use('/', createBannerRouter({ DATA_DIR }));


  router.use('/', createFechasRouter(deps));


  router.use('/', createTeamPlayersRouter(deps));
  router.use('/', createPlayersAdminRouter(deps));


  router.use('/pictures', createPicturesRouter(deps));


  router.use('/', createVideosRouter(deps));


  router.use('/', createStatsRouter(deps));


  router.use('/', createLlavesRouter(deps));


  router.use('/', reglamentoRouter);

  return router;
};
