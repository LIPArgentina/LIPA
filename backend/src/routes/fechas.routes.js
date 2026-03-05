// backend/src/routes/fechas.routes.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireTeam } = require('../middleware/auth');

module.exports = function createFechasRouter(deps) {
  const { FRONTEND_DIR, FRONTEND_FECHA } = deps;

  const router = express.Router();

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

  // ====== API: Guardar PLANILLA ======
  router.post('/save-planilla', requireTeam, async (req, res) => {
    try {
      const { path: relPath, content, team } = req.body || {};

      // El equipo autenticado manda
      const authSlug = req.user && req.user.slug;

      // Permitimos que el frontend mande path o team, pero siempre validamos
      const targetSlug =
        (typeof team === 'string' && team) ||
        (typeof relPath === 'string' ? relPath.replace(/^fecha\//,'').replace(/\.planilla\.js$/,'') : null);

      if (!authSlug) return res.status(401).json({ ok:false, error:'no autenticade' });
      if (!targetSlug || targetSlug !== authSlug) {
        return res.status(403).json({ ok:false, error:'No podés guardar la planilla de otro equipo' });
      }

      // Si te mandan "content" lo usamos. Si te mandan "plan" (JSON), generamos el JS.
      let finalContent = null;
      if (typeof content === 'string' && content.trim()) {
        finalContent = content;
      } else if (req.body && typeof req.body.plan === 'object' && req.body.plan) {
        finalContent = 'window.LPI_PLANILLA = ' + JSON.stringify(req.body.plan, null, 2) + ';\n';
      } else {
        return res.status(400).json({ ok:false, error:'Faltan campos (content o plan)' });
      }

      // Guardamos en frontend/fecha/<slug>.planilla.js (para que el visor lo cargue por <script>)
      const filename = `${authSlug}.planilla.js`;
      const absPath = path.join(FRONTEND_FECHA, filename);
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Backup simple
      const bakPath = absPath + '.bak';
      if (fs.existsSync(absPath)) {
        try { await fs.promises.copyFile(absPath, bakPath); } catch (_) {}
      }

      // Escritura atómica: tmp -> rename
      const tmpPath = absPath + '.tmp';
      await fs.promises.writeFile(tmpPath, finalContent, 'utf8');
      await fs.promises.rename(tmpPath, absPath);

      return res.json({ ok: true, message: 'Planilla guardada', file: filename });
    } catch (err) {
      console.error('Error al guardar planilla:', err);
      res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

// ====== API: Listar planillas existentes ======
router.get('/planillas', async (req, res) => {
  try {
    const files = await fs.promises.readdir(FRONTEND_FECHA);

    // Filtrar solo archivos .planilla.js
    const planillas = files
      .filter(f => f.endsWith('.planilla.js'))
      .map(f => ({
        file: f,
        team: f.replace('.planilla.js', '') // opcional, para que el frontend lo use como nombre
      }));

    return res.json(planillas);
  } catch (err) {
    console.error('Error al listar planillas:', err);
    return res.status(500).json({ ok: false, error: 'Error interno al listar planillas' });
  }
});


  return router;
};