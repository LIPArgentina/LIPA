// backend/src/routes/fechas.routes.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireTeam } = require('../middleware/auth');

module.exports = function createFechasRouter(deps) {
  const { FRONTEND_DIR, FRONTEND_FECHA, DATA_DIR } = deps;

  const router = express.Router();
  const PRIVATE_PLANILLAS_DIR = path.join(__dirname, '..', 'data', 'planillas');

  async function ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  function normalizePlanillaPayload(input, authSlug) {
    if (!input || typeof input !== 'object') return null;
    return {
      team: String(input.team || authSlug || '').trim().toLowerCase(),
      createdAt: input.createdAt || new Date().toISOString(),
      individuales: Array.isArray(input.individuales) ? input.individuales.map(x => String(x || '').trim()) : [],
      pareja1: Array.isArray(input.pareja1) ? input.pareja1.map(x => String(x || '').trim()) : [],
      pareja2: Array.isArray(input.pareja2) ? input.pareja2.map(x => String(x || '').trim()) : [],
      suplentes: Array.isArray(input.suplentes) ? input.suplentes.map(x => String(x || '').trim()) : [],
      capitan: Array.isArray(input.capitan) ? input.capitan.map(x => String(x || '').trim()) : [],
    };
  }

  function extractPlanFromContent(content) {
    if (typeof content !== 'string' || !content.trim()) return null;
    const m = content.match(/window\.LPI_PLANILLA\s*=\s*([\s\S]*?)\s*;\s*$/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (_) { return null; }
  }


  // ====== API: Validación (fecha/*.validacion.js) ======
  router.post('/validar', async (req, res) => {
    try {
      const { team, triangulos, puntosTotales } = req.body || {};
      if (!team || triangulos === undefined || puntosTotales === undefined) {
        return res.status(400).json({ ok: false, error: 'Faltan campos' });
      }

      const validacionPath = path.join(FRONTEND_FECHA, `${team}.validacion.js`);
      const today = new Date().toISOString().split('T')[0];
      const validacionContent = { team, date: today, triangulos, puntosTotales };

      // Verificar si ya existe hoy
      if (fs.existsSync(validacionPath)) {
        try {
          delete require.cache[require.resolve(validacionPath)];
          const existingModule = require(validacionPath);
          const existingData = existingModule?.window?.LPI_VALIDACION;
          if (existingData && existingData.date === today) {
            return res.status(409).json({ ok: false, error: 'Ya validado hoy' });
          }
        } catch (e) { /* ignore */ }
      }

      // Verificar rival
      const rivalTeam = team === 'local' ? 'visitante' : 'local';
      const rivalValidacionPath = path.join(FRONTEND_FECHA, `${rivalTeam}.validacion.js`);
      if (fs.existsSync(rivalValidacionPath)) {
        try {
          delete require.cache[require.resolve(rivalValidacionPath)];
          const rivalModule = require(rivalValidacionPath);
          const rivalData = rivalModule?.window?.LPI_VALIDACION;
          if (rivalData &&
              (rivalData.triangulos !== triangulos || rivalData.puntosTotales !== puntosTotales)) {
            return res.status(400).json({ ok: false, error: 'Los puntos no coinciden con el rival' });
          }
        } catch (e) { /* ignore */ }
      }

      const content = `window.LPI_VALIDACION = ${JSON.stringify(validacionContent, null, 2)};\n`;
      await fs.promises.writeFile(validacionPath, content, 'utf8');
      return res.json({ ok: true, message: 'Validación guardada para hoy' });
    } catch (err) {
      console.error('Error al guardar la validación', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  // ====== API: Guardar JS/JSON (fixture) ======
  router.post('/save-js', async (req, res) => {
    try {
      const { path: relPath, content } = req.body || {};
      if (!relPath || typeof content !== 'string') {
        return res.status(400).json({ ok: false, error: 'Faltan campos o inválidos (path, content)' });
      }

      if (!/^fixture\/fixture[._](ida|vuelta)[._](primera|segunda|tercera)\.(js|json)$/.test(relPath)) {
        return res.status(403).json({ ok: false, error: 'Path no autorizado' });
      }

      const absPath = path.join(FRONTEND_DIR, relPath);
      const dir = path.dirname(absPath);

      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      await fs.promises.writeFile(absPath, content, 'utf8');
      return res.json({ ok: true, message: 'Archivo guardado' });
    } catch (err) {
      console.error('Error al guardar archivo', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  // ====== API: Guardar PLANILLA (privada, en JSON) ======
  router.post('/save-planilla', requireTeam, async (req, res) => {
    try {
      const { path: relPath, content, team } = req.body || {};
      const authSlug = String((req.user && req.user.slug) || '').trim().toLowerCase();

      const targetSlug = String(
        (typeof team === 'string' && team) ||
        (typeof relPath === 'string'
          ? relPath.replace(/^fecha\//,'').replace(/\.planilla\.(js|json)$/,'')
          : '') ||
        authSlug
      ).trim().toLowerCase();

      if (!authSlug) return res.status(401).json({ ok:false, error:'no autenticade' });
      if (!targetSlug || targetSlug !== authSlug) {
        return res.status(403).json({ ok:false, error:'No podés guardar la planilla de otro equipo' });
      }

      let plan = null;
      if (req.body && typeof req.body.planilla === 'object' && req.body.planilla) {
        plan = req.body.planilla;
      } else if (req.body && typeof req.body.plan === 'object' && req.body.plan) {
        plan = req.body.plan;
      } else if (typeof content === 'string' && content.trim()) {
        plan = extractPlanFromContent(content);
      }

      if (!plan || typeof plan !== 'object') {
        return res.status(400).json({ ok:false, error:'Faltan campos (planilla/plan) o el content es inválido' });
      }

      const finalPlan = normalizePlanillaPayload(plan, authSlug);
      finalPlan.team = authSlug;

      await ensureDir(PRIVATE_PLANILLAS_DIR);

      const filename = `${authSlug}.planilla.json`;
      const absPath = path.join(PRIVATE_PLANILLAS_DIR, filename);
      const dir = path.dirname(absPath);
      await ensureDir(dir);

      const bakPath = absPath + '.bak';
      if (fs.existsSync(absPath)) {
        try { await fs.promises.copyFile(absPath, bakPath); } catch (_) {}
      }

      const tmpPath = absPath + '.tmp';
      await fs.promises.writeFile(tmpPath, JSON.stringify(finalPlan, null, 2), 'utf8');
      await fs.promises.rename(tmpPath, absPath);

      // Intentar borrar la versión pública vieja para no exponer la formación
      const legacyJsPath = path.join(FRONTEND_FECHA, `${authSlug}.planilla.js`);
      const legacyBakPath = legacyJsPath + '.bak';
      const legacyTmpPath = legacyJsPath + '.tmp';
      for (const legacyPath of [legacyJsPath, legacyBakPath, legacyTmpPath]) {
        try {
          if (fs.existsSync(legacyPath)) await fs.promises.unlink(legacyPath);
        } catch (_) {}
      }

     return res.json({
  ok: true,
  message: 'Planilla guardada',
  file: filename,
});
    } catch (err) {
      console.error('Error al guardar planilla:', err);
      res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  // ====== API: Obtener PLANILLA del equipo autenticado ======
  router.get('/team/planilla', requireTeam, async (req, res) => {
    try {
      const authSlug = String((req.user && req.user.slug) || '').trim().toLowerCase();
      if (!authSlug) return res.status(401).json({ ok:false, error:'no autenticade' });

      const absPath = path.join(PRIVATE_PLANILLAS_DIR, `${authSlug}.planilla.json`);
      if (!fs.existsSync(absPath)) {
        return res.status(404).json({ ok:false, error:'No existe planilla guardada' });
      }

      const raw = await fs.promises.readFile(absPath, 'utf8');
      const planilla = JSON.parse(raw);

      res.set('Cache-Control', 'no-store');
      return res.json({ ok:true, planilla });
    } catch (err) {
      console.error('GET /team/planilla', err);
      return res.status(500).json({ ok:false, error:'Error interno' });
    }
  });

// ====== API: Listar planillas existentes (privadas en JSON) ======
router.get('/planillas', async (req, res) => {
  try {
    await ensureDir(PRIVATE_PLANILLAS_DIR);
    const files = await fs.promises.readdir(PRIVATE_PLANILLAS_DIR);

    const planillas = files
      .filter(f => f.endsWith('.planilla.json'))
      .map(f => ({
        file: f,
        team: f.replace('.planilla.json', '')
      }));

    return res.json(planillas);
  } catch (err) {
    console.error('Error al listar planillas:', err);
    return res.status(500).json({ ok: false, error: 'Error interno al listar planillas' });
  }
});


  return router;
};