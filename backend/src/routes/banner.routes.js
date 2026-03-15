// backend/src/routes/banner.routes.js

const express = require("express");
const { getBanner, saveBanner } = require("../services/banner.service");

module.exports = function createBannerRouter() {

  const router = express.Router();

  // GET banner
  router.get("/get-banner", async (req, res) => {
    try {

      const data = await getBanner();

      res.set("Cache-Control", "no-store");
      res.json(data);

    } catch (err) {

      console.error("GET /api/get-banner", err);

      res.status(500).json({
        ok: false,
        error: "Error interno"
      });

    }
  });

  // SAVE banner
  router.post("/save-banner", async (req, res) => {

    try {

      const saved = await saveBanner(req.body || {});

      res.set("Cache-Control", "no-store");

      res.json({
        ok: true,
        saved
      });

    } catch (err) {

      console.error("POST /api/save-banner", err);

      if (err.statusCode) {
        return res.status(err.statusCode).json({
          ok: false,
          error: err.message
        });
      }

      res.status(500).json({
        ok: false,
        error: "Error interno"
      });

    }

  });

  return router;

};