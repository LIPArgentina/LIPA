// backend/src/routes/banner.routes.js

const express = require('express');
const { getBanner, saveBanner } = require('../services/banner.service');

module.exports = function createBannerRouter({ DATA_DIR }) {
  const router = express.Router();

  // GET /api/get-banner
  router.get('/get-banner', (req, res) => {
    try {
      const data = getBanner(DATA_DIR);
      res.set('Cache-Control', 'no-store');
      return res.json(data);
    } catch (err) {
      console.error('GET /api/get-banner', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  // POST /api/save-banner
  router.post('/save-banner', (req, res) => {
    try {
      const saved = saveBanner(DATA_DIR, req.body || {});
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, saved });
    } catch (err) {
      console.error('POST /api/save-banner', err);

      if (err.statusCode) {
        return res.status(err.statusCode).json({ ok: false, error: err.message });
      }

      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  return router;
};
