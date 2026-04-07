const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const heicConvert = require('heic-convert');
const pool = require('../../db');
const { requireTeam, requireAdmin } = require('../middleware/auth');

module.exports = function createPicturesRouter(deps) {
  const router = express.Router();
  const picturesRoot = deps.PICTURES_DIR;
  const REQUIRED_PICTURES = 9;
  const HEIC_EXT_RE = /\.(heic|heif)$/i;

  function isHeicLike(file = {}) {
    const original = String(file.originalname || file.filename || '');
    const mime = String(file.mimetype || '').toLowerCase();
    return HEIC_EXT_RE.test(original) || mime === 'image/heic' || mime === 'image/heif' || mime === 'image/heic-sequence' || mime === 'image/heif-sequence';
  }

  async function convertHeicToJpeg(file) {
    console.log('[pictures] convertHeicToJpeg:start', {
      originalname: file?.originalname,
      filename: file?.filename,
      mimetype: file?.mimetype,
      path: file?.path,
      isHeicLike: isHeicLike(file)
    });

    if (!file || !file.path || !isHeicLike(file)) {
      console.log('[pictures] convertHeicToJpeg:skip', {
        reason: !file || !file.path ? 'missing_file_or_path' : 'not_heic_like',
        originalname: file?.originalname,
        filename: file?.filename,
        mimetype: file?.mimetype
      });
      return file;
    }

    const inputBuffer = await fs.promises.readFile(file.path);
    const outputBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.88
    });

    const parsed = path.parse(file.path);
    const jpegPath = path.join(parsed.dir, parsed.name + '.jpg');
    await fs.promises.writeFile(jpegPath, outputBuffer);

    const stat = await fs.promises.stat(jpegPath);
    try { await fs.promises.unlink(file.path); } catch (_) {}

    console.log('[pictures] convertHeicToJpeg:done', {
      from: file.path,
      to: jpegPath,
      outputFilename: path.basename(jpegPath),
      outputSize: stat.size
    });

    return {
      ...file,
      path: jpegPath,
      filename: path.basename(jpegPath),
      originalname: HEIC_EXT_RE.test(String(file.originalname || ''))
        ? String(file.originalname).replace(HEIC_EXT_RE, '.jpg')
        : (String(file.originalname || '') + '.jpg'),
      mimetype: 'image/jpeg',
      size: stat.size
    };
  }

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

  function resolveSafeFullPath(relativePath) {
    const root = path.resolve(picturesRoot);
    const normalized = path.normalize(String(relativePath || '')).replace(/^([.][./\\])+/, '');
    const fullPath = path.resolve(path.join(root, normalized));
    if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
      return null;
    }
    return fullPath;
  }

  function getZipName(fechaISO, teamSlug) {
    return `${safeName(teamSlug)}_${String(fechaISO || '').slice(0, 10)}.zip`;
  }

  function buildAdminThumbUrl(filePath) {
    return `/api/pictures/admin/thumb?file=${encodeURIComponent(filePath)}`;
  }

  const crcTable = new Uint32Array(256).map((_, index) => {
    let c = index;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return c >>> 0;
  });

  function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buffer.length; i += 1) {
      crc = crcTable[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(dateInput) {
    const date = new Date(dateInput || Date.now());
    const year = Math.max(1980, date.getFullYear());
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);
    const dosTime = (hours << 11) | (minutes << 5) | seconds;
    const dosDate = ((year - 1980) << 9) | (month << 5) | day;
    return { dosDate, dosTime };
  }

  function makeZipStore(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBuf = Buffer.from(String(entry.name || 'archivo'), 'utf8');
      const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
      const crc = crc32(dataBuf);
      const { dosDate, dosTime } = dosDateTime(entry.modifiedAt);

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(0, 8);
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(dataBuf.length, 18);
      localHeader.writeUInt32LE(dataBuf.length, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);
      localParts.push(localHeader, nameBuf, dataBuf);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(dosTime, 12);
      centralHeader.writeUInt16LE(dosDate, 14);
      centralHeader.writeUInt32LE(crc, 16);
      centralHeader.writeUInt32LE(dataBuf.length, 20);
      centralHeader.writeUInt32LE(dataBuf.length, 24);
      centralHeader.writeUInt16LE(nameBuf.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);
      centralParts.push(centralHeader, nameBuf);

      offset += localHeader.length + nameBuf.length + dataBuf.length;
    }

    const centralDir = Buffer.concat(centralParts);
    const localDir = Buffer.concat(localParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDir.length, 12);
    end.writeUInt32LE(localDir.length, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([localDir, centralDir, end]);
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
      const originalExt = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const ext = HEIC_EXT_RE.test(originalExt) ? '.heic' : originalExt;
      const base = path.basename(file.originalname || 'imagen', originalExt);
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

      console.log('[pictures] upload:start', {
        fechaISO,
        localSlug,
        visitanteSlug,
        teamSlug,
        filesCount: files.length,
        files: files.map(file => ({
          originalname: file?.originalname,
          filename: file?.filename,
          mimetype: file?.mimetype,
          size: file?.size,
          isHeicLike: isHeicLike(file)
        }))
      });

      if (!fechaISO || !localSlug || !visitanteSlug) {
        return res.status(400).json({ ok: false, error: 'Faltan datos del cruce' });
      }

      if (!files.length) {
        return res.status(400).json({ ok: false, error: 'No se recibieron imágenes' });
      }

      if (files.length !== REQUIRED_PICTURES) {
        for (const file of files) {
          try { await fs.promises.unlink(file.path); } catch (_) {}
        }

        if (files.length < REQUIRED_PICTURES) {
          return res.status(400).json({
            ok: false,
            error: `Faltan ${REQUIRED_PICTURES - files.length} foto${REQUIRED_PICTURES - files.length === 1 ? '' : 's'} para completar las ${REQUIRED_PICTURES} requeridas`
          });
        }

        return res.status(400).json({
          ok: false,
          error: `Solo se permiten ${REQUIRED_PICTURES} fotos por carga`
        });
      }

      const allowed = await isValidatedMatch({ fechaISO, localSlug, visitanteSlug, equipoSlug: teamSlug });
      if (!allowed) {
        for (const file of files) {
          try { await fs.promises.unlink(file.path); } catch (_) {}
        }
        return res.status(403).json({ ok: false, error: 'Solo podés subir fotos cuando el cruce ya esté validado por ambos equipos' });
      }

      const normalizedFiles = [];
      for (const file of files) {
        normalizedFiles.push(await convertHeicToJpeg(file));
      }

      console.log('[pictures] upload:normalized_files', normalizedFiles.map(file => ({
        originalname: file?.originalname,
        filename: file?.filename,
        mimetype: file?.mimetype,
        size: file?.size,
        path: file?.path
      })));

      const result = normalizedFiles.map(file => ({
        teamSlug,
        fechaISO,
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        uploadedAt: new Date().toISOString(),
      }));

      return res.json({ ok: true, files: result });
    } catch (err) {
      const files = Array.isArray(req.files) ? req.files : [];
      for (const file of files) {
        try { await fs.promises.unlink(file.path); } catch (_) {}
        try {
          const jpgCandidate = path.join(path.dirname(file.path), path.parse(file.path).name + '.jpg');
          if (jpgCandidate !== file.path) await fs.promises.unlink(jpgCandidate);
        } catch (_) {}
      }
      console.error('POST /api/pictures/upload', err);
      return res.status(500).json({ ok: false, error: err?.message || 'No se pudieron guardar las fotos' });
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
      const groups = [];

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
          const items = [];

          for (const file of files) {
            if (!file.isFile()) continue;
            if (!/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name)) continue;
            const fullPath = path.join(teamPath, file.name);
            const stat = await fs.promises.stat(fullPath);
            const relFile = `${fechaISO}/${teamSlug}/${file.name}`;
            items.push({
              filename: file.name,
              size: stat.size,
              modifiedAt: stat.mtime.toISOString(),
              thumbUrl: buildAdminThumbUrl(relFile)
            });
          }

          items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
          if (!items.length) continue;

          groups.push({
            fechaISO,
            teamSlug,
            teamName: teamDisplayName,
            zipFilename: getZipName(fechaISO, teamSlug),
            items
          });
        }
      }

      groups.sort((a, b) => `${b.fechaISO} ${b.items[0]?.modifiedAt || ''}`.localeCompare(`${a.fechaISO} ${a.items[0]?.modifiedAt || ''}`));
      return res.json({ ok: true, groups });
    } catch (err) {
      console.error('GET /api/pictures/admin/list', err);
      return res.status(500).json({ ok: false, error: 'No se pudieron listar las fotos' });
    }
  });

  router.get('/admin/thumb', requireAdmin, async (req, res) => {
    try {
      const fullPath = resolveSafeFullPath(req.query?.file || '');
      if (!fullPath) {
        return res.status(400).json({ ok: false, error: 'Ruta inválida' });
      }
      await fs.promises.access(fullPath, fs.constants.R_OK);
      return res.sendFile(fullPath);
    } catch {
      return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
    }
  });

  router.get('/admin/group-download', requireAdmin, async (req, res) => {
    try {
      const fechaISO = String(req.query?.fechaISO || '').slice(0, 10);
      const teamSlug = normalizeSlug(req.query?.teamSlug || '');
      if (!fechaISO || !teamSlug) {
        return res.status(400).json({ ok: false, error: 'Faltan datos' });
      }
      const dir = path.join(picturesRoot, fechaISO, teamSlug);
      await fs.promises.access(dir, fs.constants.R_OK);
      const entries = [];
      const files = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) continue;
        if (!/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name)) continue;
        const fullPath = path.join(dir, file.name);
        const [data, stat] = await Promise.all([
          fs.promises.readFile(fullPath),
          fs.promises.stat(fullPath)
        ]);
        entries.push({ name: file.name, data, modifiedAt: stat.mtime });
      }
      if (!entries.length) {
        return res.status(404).json({ ok: false, error: 'No hay fotos para descargar' });
      }
      const zipBuffer = makeZipStore(entries);
      const zipFilename = getZipName(fechaISO, teamSlug);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
      res.setHeader('Content-Length', zipBuffer.length);
      return res.end(zipBuffer);
    } catch (err) {
      console.error('GET /api/pictures/admin/group-download', err);
      return res.status(500).json({ ok: false, error: 'No se pudo generar el ZIP' });
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
