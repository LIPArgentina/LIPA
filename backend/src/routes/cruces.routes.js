// backend/src/routes/cruces.routes.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { readJSON, writeJSON } = require('../utils/fileStorage');

module.exports = function createCrucesRouter(deps) {
  const { DATA_DIR, FRONTEND_DIR, FRONTEND_FECHA } = deps;

  const router = express.Router();
  const PLANILLAS_DIR = path.join(__dirname, '..', 'data', 'planillas');

  // ====== API: Validar planilla (cruces) — V2-LITE ======
  router.post('/validar-planilla-v2-lite', async (req, res) => {
    try {
      const { slug, validacion } = req.body || {};
      if (!slug || !validacion || typeof validacion !== 'object') {
        return res.status(400).json({ ok: false, error: 'Faltan slug o validacion' });
      }
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ ok: false, error: 'Slug inválido' });
      }
      const { fechaISO, equipo1, equipo2 } = validacion || {};
      const isISO = typeof fechaISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaISO);
      const okE1 = equipo1 && Number.isFinite(equipo1.triangulos) && Number.isFinite(equipo1.puntosTotales);
      const okE2 = equipo2 && Number.isFinite(equipo2.triangulos) && Number.isFinite(equipo2.puntosTotales);
      if (!isISO || !okE1 || !okE2) {
        return res.status(400).json({ ok: false, error: 'Formato inválido' });
      }
      const dir = FRONTEND_FECHA || path.join(FRONTEND_DIR, 'fecha');
      if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${slug}.validacion.js`;
      const filePath = path.join(dir, filename);
      const content =
        `// ${filename} — Validación de planilla\n` +
        `window.LPI_VALIDACION = ${JSON.stringify(validacion, null, 2)};\n`;
      await fs.promises.writeFile(filePath, content, 'utf8');
      console.log(`[VALIDACIÓN v2-lite] Guardado: ${filePath}`);
      return res.json({ ok: true });
    } catch (err) {
      console.error('validar v2-lite', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  // ====== API: Validar planilla (cruces) ======
  router.post('/validar-planilla', async (req, res) => {
    try {
      const { slug, validacion } = req.body || {};

      if (!slug || !validacion || typeof validacion !== 'object') {
        return res.status(400).json({ ok: false, error: 'Faltan slug o validacion' });
      }

      if (!/^[a-z0-9]+$/.test(slug)) {
        return res.status(403).json({ ok: false, error: 'Slug inválido' });
      }

      const crucesDir = path.join(FRONTEND_DIR, 'cruces');
      if (!fs.existsSync(crucesDir)) {
        await fs.promises.mkdir(crucesDir, { recursive: true });
      }

      const filename = `${slug}.validacion.js`;
      const filePath = path.join(crucesDir, filename);

      const content =
        `// ${filename} — Validación de planilla\n` +
        `window.LPI_VALIDACION = ${JSON.stringify(validacion, null, 2)};\n`;

      await fs.promises.writeFile(filePath, content, 'utf8');

      console.log(`[VALIDACIÓN] Guardado: ${filePath}`);
      return res.json({ ok: true, message: 'Validación guardada' });
    } catch (err) {
      console.error('Error al guardar validación', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  // ====== API: Guardar status final del encuentro ======
  router.post('/guardar-status-match', async (req, res) => {
    try {
      const { localSlug, visitanteSlug, fechaISO, status } = req.body || {};
      if (!localSlug || !visitanteSlug || !fechaISO || !status) {
        return res.status(400).json({ ok: false, error: 'faltan campos' });
      }
      if (!/^[a-z0-9-]+$/.test(localSlug) || !/^[a-z0-9-]+$/.test(visitanteSlug)) {
        return res.status(400).json({ ok: false, error: 'slugs inválidos' });
      }
      if (typeof status !== 'object') {
        return res.status(400).json({ ok: false, error: 'status inválido' });
      }
      const dir = path.join(FRONTEND_DIR, 'cruces', 'status');
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${localSlug}.vs.${visitanteSlug}.js`);
      const content =
        `// ${localSlug}.vs.${visitanteSlug}.js — Status del encuentro\n` +
        `window.LPI_STATUS = ${JSON.stringify(status, null, 2)};\n`;
      await fs.promises.writeFile(file, content, 'utf8');
      console.log(`[STATUS] Guardado: ${file}`);
      return res.json({ ok: true });
    } catch (err) {
      console.error('guardar-status-match', err);
      return res.status(500).json({ ok: false, error: 'error interno' });
    }
  });

  // ====== API: Cruces Enable/Status/SSE ======
  const CRUCES_FLAGS_FILE = path.join(DATA_DIR, 'cruces.flags.json');

  function readCrucesFlags() {
    return readJSON(CRUCES_FLAGS_FILE, {});
  }

  function writeCrucesFlags(obj) {
    writeJSON(CRUCES_FLAGS_FILE, obj);
  }

  let CRUCES_FLAGS = readCrucesFlags();

  function keyCruces(team, fechaKey) {
    return `${String(team || '*').toLowerCase().trim()}:${String(fechaKey || 'default')}`;
  }

  function isEnabledNow(entry) {
    if (!entry || !entry.enabled) return false;
    if (entry.expiresAt == null) return !!entry.enabled;
    return Date.now() < Number(entry.expiresAt);
  }

  function ttlMs() { return 48 * 60 * 60 * 1000; }

  const CRUCES_CLIENTS = new Set();

  function notifyCruces(team, fechaKey, enabled) {
    const payload = JSON.stringify({ type: 'cruces', team, fechaKey, enabled: !!enabled });
    for (const client of CRUCES_CLIENTS) {
      try { client.write(`data: ${payload}\n\n`); } catch (e) {}
    }
  }

  function buildStatusFor(team, fechaKey) {
    const t = String(team || '').toLowerCase().trim();
    const fk = String(fechaKey || 'default').trim();

    const kTeamDate = keyCruces(t, fk);
    const kAllDate = keyCruces('*', fk);
    const kTeamAny = keyCruces(t, 'default');

    const cand = [CRUCES_FLAGS[kTeamDate], CRUCES_FLAGS[kAllDate], CRUCES_FLAGS[kTeamAny]];
    let picked = null;
    for (const c of cand) {
      if (c && isEnabledNow(c)) { picked = c; break; }
    }

    const enabled = !!(picked && isEnabledNow(picked));
    const now = Date.now();
    const remainingMs = enabled && picked && picked.expiresAt
      ? Math.max(0, Number(picked.expiresAt) - now)
      : 0;

    return {
      ok: true,
      enabled,
      expiresAt: picked ? (picked.expiresAt || null) : null,
      remainingMs,
    };
  }

  router.post('/cruces/enable', (req, res) => {
    try {
      let { team = '*', fechaKey = 'default', enabled } = req.body || {};
      team = String(team || '*').toLowerCase().trim();
      fechaKey = String(fechaKey || 'default').trim();

      const k = keyCruces(team, fechaKey);
      const current = CRUCES_FLAGS[k] || { enabled: false, expiresAt: null };

      if (typeof enabled === 'undefined' || enabled === null) {
        enabled = isEnabledNow(current) ? false : true;
      } else {
        enabled = !!enabled;
      }

      if (enabled) {
        CRUCES_FLAGS[k] = { enabled: true, expiresAt: Date.now() + ttlMs() };
      } else {
        CRUCES_FLAGS[k] = { enabled: false, expiresAt: null };
      }

      writeCrucesFlags(CRUCES_FLAGS);
      notifyCruces(team, fechaKey, enabled);
      return res.json({ ok: true, enabled, expiresAt: CRUCES_FLAGS[k].expiresAt || null });
    } catch (err) {
      console.error('POST /cruces/enable', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  router.get('/cruces/status', (req, res) => {
    try {
      const { team: teamQuery = '*', fechaKey = 'default' } = req.query || {};

      const authTeamRaw =
        (req.user && (req.user.team || req.user.slug)) ||
        req.team ||
        (req.auth && (req.auth.team || req.auth.slug)) ||
        (req.session && (req.session.team || req.session.slug)) ||
        null;

      const authTeam = authTeamRaw ? String(authTeamRaw).toLowerCase().trim() : null;
      const requestedTeam = String(teamQuery || '*').toLowerCase().trim();

      res.set('Cache-Control', 'no-store');

      // Visor admin/global
      if (!authTeam && requestedTeam === '*') {
        return res.json(buildStatusFor('*', fechaKey));
      }

      // Plantillas/equipos sin contexto auth firme: permitir lectura de estado
      // para el team pedido. Esto mantiene funcionando "ver cruces".
      if (!authTeam && requestedTeam !== '*') {
        return res.json(buildStatusFor(requestedTeam, fechaKey));
      }

      if (requestedTeam !== '*' && requestedTeam !== authTeam) {
        return res.status(403).json({ ok: false, error: 'No autorizade para este equipo' });
      }

      return res.json(buildStatusFor(authTeam, fechaKey));
    } catch (err) {
      console.error('GET /cruces/status', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  router.get('/cruces/stream', (req, res) => {
    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders && res.flushHeaders();
      res.write('retry: 3000\n\n');
      CRUCES_CLIENTS.add(res);
      req.on('close', () => { CRUCES_CLIENTS.delete(res); });
    } catch (err) {
      console.error('GET /cruces/stream', err);
      try { res.status(500).end(); } catch (e) {}
    }
  });

  // ====== API: Leer planilla privada para cruces ======
  // Usa exactamente el mismo origen que el visor admin:
  // backend/src/data/planillas/<equipo>.planilla.json
  router.get('/cruces/planilla', async (req, res) => {
    try {
      const team = String(req.query?.team || '').toLowerCase().trim();

      if (!/^[a-z0-9-]+$/.test(team)) {
        return res.status(400).json({ ok: false, error: 'team_invalido' });
      }

      const filePath = path.join(PLANILLAS_DIR, `${team}.planilla.json`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ ok: false, error: 'planilla_no_encontrada' });
      }

      const raw = await fs.promises.readFile(filePath, 'utf8');
      const json = JSON.parse(raw);

      return res.json({
        team,
        capitan: Array.isArray(json.capitan) ? json.capitan : [],
        individuales: Array.isArray(json.individuales) ? json.individuales : [],
        pareja1: Array.isArray(json.pareja1) ? json.pareja1 : [],
        pareja2: Array.isArray(json.pareja2) ? json.pareja2 : [],
        suplentes: Array.isArray(json.suplentes) ? json.suplentes : []
      });
    } catch (err) {
      console.error('GET /cruces/planilla', err);
      return res.status(500).json({ ok: false, error: 'error_interno' });
    }
  });

  return router;
};
