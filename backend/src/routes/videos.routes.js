const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAdmin } = require('../middleware/auth');

module.exports = function createVideosRouter(deps = {}) {
  const router = express.Router();
  const videosRoot = path.join(deps.PICTURES_DIR || path.resolve(__dirname, '../../data/pictures'), 'videos');

  function safeName(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._ -]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleFromFilename(filename = '') {
    return path.basename(filename, path.extname(filename)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function resolveVideoPath(filename = '') {
    const safe = safeName(path.basename(filename));
    if (!safe || !/\.(mp4|webm|mov|m4v)$/i.test(safe)) return null;
    const root = path.resolve(videosRoot);
    const fullPath = path.resolve(path.join(root, safe));
    if (!fullPath.startsWith(root + path.sep) && fullPath !== root) return null;
    return fullPath;
  }

  router.get('/videos', async (_req, res) => {
    try {
      await fs.promises.mkdir(videosRoot, { recursive: true });
      const entries = await fs.promises.readdir(videosRoot, { withFileTypes: true });
      const videos = [];

      for (const entry of entries) {
        if (!entry.isFile() || !/\.(mp4|webm|mov|m4v)$/i.test(entry.name)) continue;
        const fullPath = path.join(videosRoot, entry.name);
        const stat = await fs.promises.stat(fullPath);
        videos.push({
          filename: entry.name,
          title: titleFromFilename(entry.name),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          url: `/api/videos/file/${encodeURIComponent(entry.name)}`
        });
      }

      videos.sort((a, b) => a.title.localeCompare(b.title, 'es'));
      return res.json({ ok: true, videos });
    } catch (err) {
      console.error('GET /api/videos', err);
      return res.status(500).json({ ok: false, error: 'No se pudieron cargar los videos' });
    }
  });

  const storage = multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await fs.promises.mkdir(videosRoot, { recursive: true });
        cb(null, videosRoot);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const originalExt = path.extname(file.originalname || '').toLowerCase() || '.mp4';
      const base = path.basename(file.originalname || 'video', originalExt);
      const cleanBase = safeName(base) || 'video';
      let candidate = `${cleanBase}${originalExt}`;
      let counter = 2;
      while (fs.existsSync(path.join(videosRoot, candidate))) {
        candidate = `${cleanBase}_${counter}${originalExt}`;
        counter += 1;
      }
      cb(null, candidate);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 4 },
    fileFilter: (_req, file, cb) => {
      const mimetype = String(file.mimetype || '').toLowerCase();
      const ext = path.extname(file.originalname || '').toLowerCase();
      const allowedByMime = mimetype.startsWith('video/');
      const allowedByExt = ['.mp4', '.webm', '.mov', '.m4v'].includes(ext);
      if (!allowedByMime && !allowedByExt) return cb(new Error('Solo se permiten videos MP4, WebM, MOV o M4V'));
      cb(null, true);
    }
  });

  router.post('/videos/admin/upload', requireAdmin, (req, res) => {
    upload.array('videos', 4)(req, res, (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message || 'No se pudieron subir los videos' });
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ ok: false, error: 'No se recibieron videos' });
      return res.json({
        ok: true,
        videos: files.map((file) => ({
          filename: file.filename,
          title: titleFromFilename(file.filename),
          size: file.size,
          url: `/api/videos/file/${encodeURIComponent(file.filename)}`
        }))
      });
    });
  });

  router.get('/videos/file/:filename', async (req, res) => {
    try {
      const fullPath = resolveVideoPath(req.params.filename);
      if (!fullPath) return res.status(400).json({ ok: false, error: 'Video inválido' });
      await fs.promises.access(fullPath, fs.constants.R_OK);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.sendFile(fullPath);
    } catch {
      return res.status(404).json({ ok: false, error: 'Video no encontrado' });
    }
  });

  return router;
};
