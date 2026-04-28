const express = require("express");
const pool = require("../../db");

const ONLINE_WINDOW_MINUTES = 5;
const LOCAL_TIMEZONE = "America/Argentina/Buenos_Aires";

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return String(req.ip || req.socket?.remoteAddress || "");
}

async function ensureSiteStatsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_visitors (
      visitor_id TEXT PRIMARY KEY,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_path TEXT,
      last_referrer TEXT,
      last_user_agent TEXT,
      last_ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_site_visitors_last_seen
    ON site_visitors (last_seen DESC);
  `);
}

module.exports = function createStatsRouter() {
  const router = express.Router();

  router.post("/track-visit", async (req, res) => {
    try {
      const rawVisitorId = String(req.body?.visitorId || "").trim();
      if (!rawVisitorId) {
        return res.status(400).json({ ok: false, error: "visitorId requerido" });
      }

      const visitorId = rawVisitorId.slice(0, 128);
      const lastPath = String(req.body?.path || "").slice(0, 512);
      const lastReferrer = String(req.body?.referrer || "").slice(0, 1024);
      const lastUserAgent = String(req.headers["user-agent"] || "").slice(0, 512);
      const lastIp = getClientIp(req).slice(0, 128);

      await pool.query(
        `
          INSERT INTO site_visitors (
            visitor_id, first_seen, last_seen, last_path, last_referrer, last_user_agent, last_ip, created_at, updated_at
          )
          VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, NOW(), NOW())
          ON CONFLICT (visitor_id) DO UPDATE SET
            last_seen = NOW(),
            last_path = EXCLUDED.last_path,
            last_referrer = EXCLUDED.last_referrer,
            last_user_agent = EXCLUDED.last_user_agent,
            last_ip = EXCLUDED.last_ip,
            updated_at = NOW()
        `,
        [visitorId, lastPath, lastReferrer, lastUserAgent, lastIp]
      );

      return res.json({ ok: true });
    } catch (error) {
      console.error("track-visit error:", error);
      return res.status(500).json({ ok: false, error: "No se pudo registrar la visita" });
    }
  });

  router.get("/public-stats", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `
          SELECT
            COUNT(*) FILTER (
              WHERE last_seen >= NOW() - ($1 || ' minutes')::INTERVAL
            ) AS online,

            COUNT(*) FILTER (
              WHERE last_seen >= (
                DATE_TRUNC('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2
              )
            ) AS today,

            COUNT(*) FILTER (
              WHERE last_seen >= (
                DATE_TRUNC('week', NOW() AT TIME ZONE $2) AT TIME ZONE $2
              )
            ) AS week
          FROM site_visitors
        `,
        [String(ONLINE_WINDOW_MINUTES), LOCAL_TIMEZONE]
      );

      const row = rows[0] || {};
      return res.json({
        ok: true,
        online: Number(row.online || 0),
        today: Number(row.today || 0),
        week: Number(row.week || 0),
      });
    } catch (error) {
      console.error("public-stats error:", error);
      return res.status(500).json({ ok: false, error: "No se pudieron obtener las métricas" });
    }
  });

  router.ensureSiteStatsTable = ensureSiteStatsTable;
  return router;
};

module.exports.ensureSiteStatsTable = ensureSiteStatsTable;
