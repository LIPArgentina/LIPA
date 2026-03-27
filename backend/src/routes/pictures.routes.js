const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../../db');
const { requireTeam, requireAdmin } = require('../middleware/auth');

module.exports = function createPicturesRouter(deps) {
  const router = express.Router();
  const picturesRoot = deps.PICTURES_DIR;

  function normalizeSlug(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function safeName(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'archivo';
  }

  function buildFechaKey(fechaISO, localSlug, visitanteSlug) {
    return `${String(fechaISO || '').slice(0, 10)}::${normalizeSlug(localSlug)}::${normalizeSlug(visitanteSlug)}`;
  }

  function slugMatchesTeam(teamSlug, matchSlug) {
    const a = normalizeSlug(teamSlug);
    const b = normalizeSlug(matchSlug);
    return a === b || a.startsWith(`${b}_`);
  }

  function resolveTeamKey(equipoSlug, localSlug, visitanteSlug) {
    const equipoNorm = normalizeSlug(equipoSlug);
    if (slugMatchesTeam(equipoNorm, localSlug)) return normalizeSlug(localSlug);
    if (slugMatchesTeam(equipoNorm, visitanteSlug)) return normalizeSlug(visitanteSlug);
    return null;
  }

  async function ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  async function getDisplayNameBySlug(slug) {
    const result = await pool.query(
      `SELECT display_name FROM equipos WHERE LOWER(slug_uid) = $1 OR LOWER(slug_base) = $1 ORDER BY id ASC LIMIT 1`,
      [normalizeSlug(slug)]
    );
    return result.rows[0]?.display_name || slug;
  }

  async function isValidatedMatch({ fechaISO, localSlug, visitanteSlug, equipoSlug }) {
    const teamKey = resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) return false;

    const rivalKey = teamKey === normalizeSlug(localSlug)
      ? normalizeSlug(visitanteSlug)
      : normalizeSlug(localSlug);

    const fechaKey = buildFechaKey(fechaISO, localSlug, visitanteSlug);

    const { rows } = await pool.query(
      `
      SELECT team, validated, status_json, locked_until
      FROM cruces_validations
      WHERE fecha_key = $1 AND team IN ($2, $3)
      `,
      [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]
    );

    const mine = rows.find(r => r.team === teamKey) || null;
    const rival = rows.find(r => r.team === rivalKey) || null;
    const lockedUntil = mine?.locked_until || rival?.locked_until || null;
    const locked = !!(lockedUntil && new Date(lockedUntil).getTime() > Date.now());

    return Boolean(mine?.validated && rival?.validated && mine?.status_json && rival?.status_json && locked);
  }

  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const fechaISO = String(req.body?.fechaISO || '').slice(0, 10);
        const teamSlug = normalizeSlug(req.user?.slug || req.body?.teamSlug || 'equipo');
        const teamDir = path.join(picturesRoot, fechaISO || 'sin-fecha', teamSlug);
        await ensureDir(teamDir);
        cb(null, teamDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const base = path.basename(file.originalname || 'imagen', ext);
      const random = crypto.randomBytes(6).toString('hex');
      cb(null, `${Date.now()}__${random}__${safeName(base)}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 10
    },
    fileFilter: (_req, file, cb) => {
      if (!String(file.mimetype || '').startsWith('image/')) {
        return cb(new Error('Solo se permiten imágenes'));
      }
      cb(null, true);
    }
  });

  function buildAdminDownloadUrl(filePath) {
    return `/api/pictures/admin/download?file=${encodeURIComponent(filePath)}`;
  }

  router.post('/upload', requireTeam, (req, res, next) => {
    upload.array('pictures', 10)(req, res, (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message || 'No se pudo subir el archivo' });
      next();
    });
  }, async (req, res) => {
    try {
      const fechaISO = String(req.body?.fechaISO || '').slice(0, 10);
      const localSlug = normalizeSlug(req.body?.localSlug || '');
      const visitanteSlug = normalizeSlug(req.body?.visitanteSlug || '');
      const teamSlug = normalizeSlug(req.user?.slug || '');
      const files = Array.isArray(req.files) ? req.files : [];

      if (!fechaISO || !localSlug || !visitanteSlug) {
        return res.status(400).json({ ok: false, error: 'Faltan datos del cruce' });
      }

      if (!files.length) {
        return res.status(400).json({ ok: false, error: 'No se recibieron imágenes' });
      }

      const allowed = await isValidatedMatch({ fechaISO, localSlug, visitanteSlug, equipoSlug: teamSlug });
      if (!allowed) {
        for (const file of files) {
          try { await fs.promises.unlink(file.path); } catch (_) {}
        }
        return res.status(403).json({ ok: false, error: 'Solo podés subir fotos cuando el cruce ya esté validado por ambos equipos' });
      }

      const result = files.map(file => ({
        teamSlug,
        fechaISO,
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        uploadedAt: new Date().toISOString(),
      }));

      return res.json({ ok: true, files: result });
    } catch (err) {
      console.error('POST /api/pictures/upload', err);
      return res.status(500).json({ ok: false, error: 'No se pudieron guardar las fotos' });
    }
  });

  router.get('/my', requireTeam, async (req, res) => {
    try {
      const fechaISO = String(req.query?.fechaISO || '').slice(0, 10);
      const teamSlug = normalizeSlug(req.user?.slug || '');
      const dir = path.join(picturesRoot, fechaISO || 'sin-fecha', teamSlug);
      await ensureDir(dir);
      const names = (await fs.promises.readdir(dir, { withFileTypes: true }))
        .filter(d => d.isFile())
        .map(d => d.name)
        .filter(name => /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(name))
        .sort((a, b) => b.localeCompare(a));

      return res.json({
        ok: true,
        files: names.map(name => ({
          filename: name,
          teamSlug,
          fechaISO,
        }))
      });
    } catch (err) {
      console.error('GET /api/pictures/my', err);
      return res.status(500).json({ ok: false, error: 'No se pudieron listar tus fotos' });
    }
  });

  router.get('/team/download', requireTeam, async (req, res) => {
    try {
      const fechaISO = String(req.query?.fechaISO || '').slice(0, 10);
      const filename = path.basename(String(req.query?.filename || ''));
      const teamSlug = normalizeSlug(req.user?.slug || '');
      const fullPath = path.join(picturesRoot, fechaISO || 'sin-fecha', teamSlug, filename);
      await fs.promises.access(fullPath, fs.constants.R_OK);
      return res.download(fullPath, filename);
    } catch {
      return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
    }
  });

  router.get('/admin/list', requireAdmin, async (_req, res) => {
    try {
      await ensureDir(picturesRoot);
      const fechas = await fs.promises.readdir(picturesRoot, { withFileTypes: true });
      const items = [];

      for (const fechaDir of fechas) {
        if (!fechaDir.isDirectory()) continue;
        const fechaISO = fechaDir.name;
        const fechaPath = path.join(picturesRoot, fechaISO);
        const teams = await fs.promises.readdir(fechaPath, { withFileTypes: true });

        for (const teamDir of teams) {
          if (!teamDir.isDirectory()) continue;
          const teamSlug = teamDir.name;
          const teamPath = path.join(fechaPath, teamSlug);
          const teamDisplayName = await getDisplayNameBySlug(teamSlug);
          const files = await fs.promises.readdir(teamPath, { withFileTypes: true });

          for (const file of files) {
            if (!file.isFile()) continue;
            if (!/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name)) continue;
            const fullPath = path.join(teamPath, file.name);
            const stat = await fs.promises.stat(fullPath);
            const relFile = `${fechaISO}/${teamSlug}/${file.name}`;
            items.push({
              fechaISO,
              teamSlug,
              teamName: teamDisplayName,
              filename: file.name,
              size: stat.size,
              modifiedAt: stat.mtime.toISOString(),
              downloadUrl: buildAdminDownloadUrl(relFile)
            });
          }
        }
      }

      items.sort((a, b) => `${b.fechaISO} ${b.modifiedAt}`.localeCompare(`${a.fechaISO} ${a.modifiedAt}`));
      return res.json({ ok: true, items });
    } catch (err) {
      console.error('GET /api/pictures/admin/list', err);
      return res.status(500).json({ ok: false, error: 'No se pudieron listar las fotos' });
    }
  });

  router.get('/admin/download', requireAdmin, async (req, res) => {
    try {
      const rel = String(req.query?.file || '');
      const normalized = path.normalize(rel).replace(/^([.][./\\])+/, '');
      const fullPath = path.join(picturesRoot, normalized);
      if (!fullPath.startsWith(path.resolve(picturesRoot))) {
        return res.status(400).json({ ok: false, error: 'Ruta inválida' });
      }
      await fs.promises.access(fullPath, fs.constants.R_OK);
      return res.download(fullPath, path.basename(fullPath));
    } catch {
      return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
    }
  });

  router.delete('/admin/file', requireAdmin, async (req, res) => {
    try {
      const rel = String(req.body?.file || '');
      const normalized = path.normalize(rel).replace(/^([.][./\\])+/, '');
      const fullPath = path.join(picturesRoot, normalized);
      if (!fullPath.startsWith(path.resolve(picturesRoot))) {
        return res.status(400).json({ ok: false, error: 'Ruta inválida' });
      }
      await fs.promises.unlink(fullPath);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(404).json({ ok: false, error: err?.message || 'No se pudo eliminar el archivo' });
    }
  });

  router.delete('/admin/team-folder', requireAdmin, async (req, res) => {
    try {
      const fechaISO = String(req.body?.fechaISO || '').slice(0, 10);
      const teamSlug = normalizeSlug(req.body?.teamSlug || '');
      if (!fechaISO || !teamSlug) {
        return res.status(400).json({ ok: false, error: 'Faltan datos' });
      }
      const dir = path.join(picturesRoot, fechaISO, teamSlug);
      await fs.promises.rm(dir, { recursive: true, force: true });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message || 'No se pudo vaciar la carpeta' });
    }
  });

  return router;
};
