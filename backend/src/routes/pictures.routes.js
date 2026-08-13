const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const heicConvert = require('heic-convert');
const sharp = require('sharp');
const pool = require('../../db');
const { requireTeam, requireAdmin } = require('../middleware/auth');

module.exports = function createPicturesRouter(deps) {
  const router = express.Router();
  const picturesRoot = deps.PICTURES_DIR;
  const variantsRoot = path.join(picturesRoot, '.variants');
  const REQUIRED_PICTURES = 11;
  const HEIC_EXT_RE = /\.(heic|heif)$/i;
  const PICTURE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;
  const variantJobs = new Map();

  function uploadErrorId() {
    return crypto.randomBytes(5).toString('hex');
  }

  function logUploadError(req, error, errorId, stage = 'upload') {
    console.error('[pictures-upload-error]', JSON.stringify({
      errorId,
      stage,
      fechaISO: String(req.body?.fechaISO || '').slice(0, 10),
      teamSlug: resolveRequestedTeamSlug(req) || pickUserSlug(req.user),
      receivedFiles: Array.isArray(req.files) ? req.files.length : 0,
      receivedBytes: (Array.isArray(req.files) ? req.files : []).reduce((sum, file) => sum + Number(file?.size || 0), 0),
      message: String(error?.message || error || 'Error desconocido'),
      code: String(error?.code || '')
    }));
  }

  function isHeicLike(file = {}) {
    const original = String(file.originalname || file.filename || '');
    const mime = String(file.mimetype || '').toLowerCase();
    return HEIC_EXT_RE.test(original) || mime === 'image/heic' || mime === 'image/heif' || mime === 'image/heic-sequence' || mime === 'image/heif-sequence';
  }

  async function convertHeicToJpeg(file) {
    if (!file || !file.path || !isHeicLike(file)) return file;
    const inputBuffer = await fs.promises.readFile(file.path);
    const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.88 });
    const parsed = path.parse(file.path);
    const jpegPath = path.join(parsed.dir, parsed.name + '.jpg');
    await fs.promises.writeFile(jpegPath, outputBuffer);
    const stat = await fs.promises.stat(jpegPath);
    try { await fs.promises.unlink(file.path); } catch (_) {}
    return {
      ...file,
      path: jpegPath,
      filename: path.basename(jpegPath),
      originalname: HEIC_EXT_RE.test(String(file.originalname || '')) ? String(file.originalname).replace(HEIC_EXT_RE, '.jpg') : (String(file.originalname || '') + '.jpg'),
      mimetype: 'image/jpeg',
      size: stat.size
    };
  }

  function normalizeSlug(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function safeName(value = '') {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'archivo';
  }

  function buildFechaKey(fechaISO, localSlug, visitanteSlug) {
    return `${String(fechaISO || '').slice(0, 10)}::${normalizeSlug(localSlug)}::${normalizeSlug(visitanteSlug)}`;
  }

  function slugMatchesTeam(teamSlug, matchSlug) {
    const a = normalizeSlug(teamSlug);
    const b = normalizeSlug(matchSlug);
    return a === b || a.startsWith(`${b}_`);
  }

  function normalizeTeamIdentity(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(segunda|tercera|primera|2da|3ra|1ra)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  async function resolveTeamKey(equipoSlug, localSlug, visitanteSlug) {
    const equipoNorm = normalizeSlug(equipoSlug);
    if (slugMatchesTeam(equipoNorm, localSlug)) return normalizeSlug(localSlug);
    if (slugMatchesTeam(equipoNorm, visitanteSlug)) return normalizeSlug(visitanteSlug);

    const teamInfo = await getTeamInfoBySlug(equipoNorm);
    const teamIdentity = normalizeTeamIdentity(teamInfo.displayName);
    if (teamIdentity && teamIdentity === normalizeTeamIdentity(localSlug)) return normalizeSlug(localSlug);
    if (teamIdentity && teamIdentity === normalizeTeamIdentity(visitanteSlug)) return normalizeSlug(visitanteSlug);
    return null;
  }

  function isTruthyFlag(value) {
    const v = String(value || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'si' || v === 'sí';
  }

  function pickUserSlug(user) {
    return normalizeSlug(user?.slug || user?.team || user?.teamSlug || '');
  }

  function isAdminUser(user) {
    const values = [user?.role, user?.tipo, user?.type, user?.userType, user?.kind, ...(Array.isArray(user?.roles) ? user.roles : []), ...(Array.isArray(user?.permissions) ? user.permissions : [])];
    return values.some((value) => {
      const v = String(value || '').trim().toLowerCase();
      return v === 'admin' || v === 'administrator' || v === 'superadmin';
    });
  }

  function resolveRequestedTeamSlug(req) {
    return normalizeSlug(req.body?.teamSlug || req.body?.team || req.query?.teamSlug || req.query?.team || '');
  }

  function isManualAdminUpload(req) {
    return isAdminUser(req.user) && (isTruthyFlag(req.body?.adminUpload) || isTruthyFlag(req.body?.manualUpload));
  }

  function resolveUploadTeamSlug(req) {
    if (isManualAdminUpload(req)) return resolveRequestedTeamSlug(req);
    return pickUserSlug(req.user);
  }

  async function ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  function normalizeCategory(value = '') {
    const v = String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (v === 'segunda' || v === '2da' || v === '2' || v === 'segunda categoria') return 'segunda';
    if (v === 'tercera' || v === '3ra' || v === '3' || v === 'tercera categoria') return 'tercera';
    if (v === 'torneos' || v === 'torneo') return 'torneos';
    return '';
  }

  function inferPicturesGroupCategory(fechaISO, teamInfo = {}, teamSlug = '') {
    const fecha = String(fechaISO || '').trim().toLowerCase();
    if (fecha && !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return 'torneos';

    const division = normalizeCategory(teamInfo?.division);
    if (division) return division;

    const text = `${teamSlug || ''} ${teamInfo?.displayName || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (/(^|[^a-z0-9])(2da|segunda)([^a-z0-9]|$)/.test(text)) return 'segunda';
    if (/(^|[^a-z0-9])(3ra|tercera)([^a-z0-9]|$)/.test(text)) return 'tercera';
    return '';
  }

  async function getTeamInfoBySlug(slug) {
    const safeSlug = normalizeSlug(slug);
    if (!safeSlug) return { displayName: slug, division: '' };

    const result = await pool.query(
      `SELECT display_name, division
         FROM equipos
        WHERE LOWER(slug_uid) = $1 OR LOWER(slug_base) = $1
        ORDER BY CASE WHEN LOWER(slug_uid) = $1 THEN 0 ELSE 1 END, id ASC
        LIMIT 1`,
      [safeSlug]
    );

    return {
      displayName: result.rows[0]?.display_name || slug,
      division: result.rows[0]?.division || ''
    };
  }

  async function getDisplayNameBySlug(slug) {
    const teamInfo = await getTeamInfoBySlug(slug);
    return teamInfo.displayName || slug;
  }

  async function getPictureSlugAliases(teamSlug, teamName = '', category = '') {
    const normalizedSlug = normalizeSlug(teamSlug);
    const normalizedName = String(teamName || '').trim().toLowerCase();
    const normalizedCategory = normalizeCategory(category);
    const aliases = new Set([normalizedSlug].filter(Boolean));
    if (!normalizedSlug && !normalizedName) return [...aliases];

    const { rows } = await pool.query(
      `SELECT display_name, slug_uid, slug_base, division
         FROM equipos
        WHERE ($1 <> '' AND (LOWER(slug_uid) = $1 OR LOWER(slug_base) = $1))
           OR ($2 <> '' AND LOWER(TRIM(display_name)) = $2)`,
      [normalizedSlug, normalizedName]
    );

    rows
      .filter((row) => !normalizedCategory || normalizeCategory(row.division) === normalizedCategory)
      .forEach((row) => {
        const slugUid = normalizeSlug(row.slug_uid);
        const slugBase = normalizeSlug(row.slug_base);
        if (slugUid) aliases.add(slugUid);
        if (slugBase) aliases.add(slugBase);
      });

    return [...aliases];
  }

  async function getTeamOptions() {
    await pool.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true`);
    const { rows } = await pool.query(`SELECT display_name, slug_uid, slug_base, division FROM equipos WHERE activo = true AND COALESCE(display_name, '') <> '' AND (COALESCE(slug_uid, '') <> '' OR COALESCE(slug_base, '') <> '') ORDER BY display_name ASC, id ASC`);
    const seen = new Set();
    const options = [];
    for (const row of rows) {
      const slug = normalizeSlug(row.slug_uid || row.slug_base || '');
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      options.push({ slug, displayName: String(row.display_name || slug).trim(), category: normalizeCategory(row.division) });
    }
    return options;
  }

  async function isValidatedMatch({ fechaISO, localSlug, visitanteSlug, equipoSlug, tipo = '' }) {
    const teamKey = await resolveTeamKey(equipoSlug, localSlug, visitanteSlug);
    if (!teamKey) return false;
    const rivalKey = teamKey === normalizeSlug(localSlug) ? normalizeSlug(visitanteSlug) : normalizeSlug(localSlug);
    const fechaKey = buildFechaKey(fechaISO, localSlug, visitanteSlug) + (String(tipo || '').toLowerCase() === 'desempate' ? '::desempate' : '');
    const { rows } = await pool.query(`SELECT team, validated, status_json, locked_until FROM cruces_validations WHERE fecha_key = $1 AND team IN ($2, $3)`, [fechaKey, normalizeSlug(localSlug), normalizeSlug(visitanteSlug)]);
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
    if (!fullPath.startsWith(root + path.sep) && fullPath !== root) return null;
    return fullPath;
  }

  function getZipName(fechaISO, teamSlug) {
    return `${safeName(teamSlug)}_${String(fechaISO || '').slice(0, 10)}.zip`;
  }

  function buildAdminThumbUrl(filePath, version = '') {
    return `/api/pictures/admin/thumb?file=${encodeURIComponent(filePath)}${version ? `&v=${encodeURIComponent(version)}` : ''}`;
  }

  function buildPublicImageUrl(filePath, version = '') {
    return `/api/pictures/public/view?file=${encodeURIComponent(filePath)}${version ? `&v=${encodeURIComponent(version)}` : ''}`;
  }

  function setPictureCacheHeaders(res) {
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Access-Control-Allow-Origin', '*');
  }

  async function getOptimizedVariant(fullPath, relativePath, { width, quality }) {
    const stat = await fs.promises.stat(fullPath);
    const identity = `${relativePath}|${stat.size}|${stat.mtimeMs}|${width}|${quality}`;
    const cacheName = `${crypto.createHash('sha256').update(identity).digest('hex')}.webp`;
    const variantPath = path.join(variantsRoot, `${width}px`, cacheName);
    try {
      await fs.promises.access(variantPath, fs.constants.R_OK);
      return variantPath;
    } catch (_) {}

    if (!variantJobs.has(variantPath)) {
      variantJobs.set(variantPath, (async () => {
        await ensureDir(path.dirname(variantPath));
        await sharp(fullPath, { failOn: 'none', animated: false })
          .rotate()
          .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
          .webp({ quality, effort: 4 })
          .toFile(variantPath);
        return variantPath;
      })().finally(() => variantJobs.delete(variantPath)));
    }
    return variantJobs.get(variantPath);
  }

  function isTiebreakPicturesFolder(folderSlug) {
    return /(^|_)desempate$/i.test(normalizeSlug(folderSlug));
  }

  async function listTeamPictures(fechaISO, teamSlug, { tipo = '', aliases = [] } = {}) {
    if (!fechaISO || !teamSlug) return [];

    const fechaDir = path.join(picturesRoot, fechaISO);
    let dirEntries = [];
    try {
      dirEntries = await fs.promises.readdir(fechaDir, { withFileTypes: true });
    } catch (_) {
      return [];
    }

    const normalizedAliases = new Set(
      [teamSlug, ...aliases].map(normalizeSlug).filter(Boolean)
    );
    const wantsTiebreak = String(tipo || '').trim().toLowerCase() === 'desempate';

    const candidates = dirEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => {
        const slug = normalizeSlug(name);
        const belongsToTeam = [...normalizedAliases].some((alias) => (
          slug === alias || slug.startsWith(alias + '_')
        ));
        if (!belongsToTeam) return false;

        const isTiebreakFolder = isTiebreakPicturesFolder(slug);
        return wantsTiebreak ? isTiebreakFolder : !isTiebreakFolder;
      });

    const items = [];
    for (const folderName of candidates) {
      const dir = path.join(fechaDir, folderName);
      const files = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile()) continue;
        if (!/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name)) continue;

        const fullPath = path.join(dir, file.name);
        const stat = await fs.promises.stat(fullPath);
        const relFile = `${fechaISO}/${folderName}/${file.name}`;

        items.push({
          filename: file.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          imageUrl: buildPublicImageUrl(relFile, Math.round(stat.mtimeMs)),
          originalUrl: `/api/pictures/public/file?file=${encodeURIComponent(relFile)}&v=${encodeURIComponent(Math.round(stat.mtimeMs))}`,
          sourceTeamSlug: folderName,
          tipo: wantsTiebreak ? 'desempate' : 'cruce'
        });
      }
    }

    items.sort((a, b) => a.filename.localeCompare(b.filename, 'es', { numeric: true, sensitivity: 'base' }));
    return items.slice(0, wantsTiebreak ? 1 : REQUIRED_PICTURES);
  }

  const crcTable = new Uint32Array(256).map((_, index) => {
    let c = index;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  });

  function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buffer.length; i += 1) crc = crcTable[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
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
    return { dosDate: ((year - 1980) << 9) | (month << 5) | day, dosTime: (hours << 11) | (minutes << 5) | seconds };
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
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDir.length, 12);
    end.writeUInt32LE(localDir.length, 16);
    return Buffer.concat([localDir, centralDir, end]);
  }

  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const fechaISO = String(req.body?.fechaISO || '').slice(0, 10);
        const teamSlug = resolveUploadTeamSlug(req) || 'equipo';
        const tipo = String(req.body?.tipo || '').trim().toLowerCase();
        const folderSlug = tipo === 'desempate' ? `${teamSlug}_desempate` : teamSlug;
        const teamDir = path.join(picturesRoot, fechaISO || 'sin-fecha', folderSlug);
        await ensureDir(teamDir);
        cb(null, teamDir);
      } catch (err) { cb(err); }
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
    limits: { fileSize: 10 * 1024 * 1024, files: REQUIRED_PICTURES },
    fileFilter: (_req, file, cb) => {
      const mimetype = String(file.mimetype || '').toLowerCase();
      const ext = path.extname(file.originalname || '').toLowerCase();
      const allowedByMime = mimetype.startsWith('image/');
      const allowedByExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'].includes(ext);
      if (!allowedByMime && !allowedByExt) return cb(new Error('Solo se permiten imágenes'));
      cb(null, true);
    }
  });

  function runUpload(req, res, next) {
    upload.array('pictures', REQUIRED_PICTURES)(req, res, (err) => {
      if (err) {
        const errorId = uploadErrorId();
        logUploadError(req, err, errorId, 'recepcion');
        const friendlyError = err?.code === 'LIMIT_FILE_SIZE'
          ? 'Una de las fotos supera el máximo permitido de 10 MB.'
          : err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE'
            ? `Solo se pueden enviar hasta ${REQUIRED_PICTURES} fotos por carga.`
            : (err.message || 'No se pudieron recibir las fotos.');
        return res.status(400).json({ ok: false, error: friendlyError, errorId });
      }
      next();
    });
  }

  async function fileHash(filePath) {
    const content = await fs.promises.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async function keepUniquePicturesWithinLimit(files, limit) {
    if (!files.length) return { files: [], duplicatesSkipped: 0, excessSkipped: 0, totalPictures: 0 };
    const directory = path.dirname(files[0].path);
    const currentNames = new Set(files.map((file) => path.basename(file.path)));
    const directoryEntries = await fs.promises.readdir(directory, { withFileTypes: true });
    const existingPaths = directoryEntries
      .filter((entry) => entry.isFile() && PICTURE_EXT_RE.test(entry.name) && !currentNames.has(entry.name))
      .map((entry) => path.join(directory, entry.name));
    const knownHashes = new Set();
    for (const existingPath of existingPaths) {
      try { knownHashes.add(await fileHash(existingPath)); } catch (_) {}
    }

    const accepted = [];
    let duplicatesSkipped = 0;
    let excessSkipped = 0;
    for (const file of files) {
      const hash = await fileHash(file.path);
      if (knownHashes.has(hash)) {
        duplicatesSkipped += 1;
        try { await fs.promises.unlink(file.path); } catch (_) {}
        continue;
      }
      if (existingPaths.length + accepted.length >= limit) {
        excessSkipped += 1;
        try { await fs.promises.unlink(file.path); } catch (_) {}
        continue;
      }
      knownHashes.add(hash);
      accepted.push(file);
    }

    return {
      files: accepted,
      duplicatesSkipped,
      excessSkipped,
      totalPictures: Math.min(limit, existingPaths.length + accepted.length)
    };
  }

  async function handleUpload(req, res, { adminMode = false } = {}) {
    try {
      const fechaISO = String(req.body?.fechaISO || '').slice(0, 10);
      const localSlug = normalizeSlug(req.body?.localSlug || '');
      const visitanteSlug = normalizeSlug(req.body?.visitanteSlug || '');
      const teamSlug = resolveUploadTeamSlug(req);
      const tipo = String(req.body?.tipo || '').trim().toLowerCase();
      const requiredPictures = tipo === 'desempate' ? 1 : REQUIRED_PICTURES;
      const files = Array.isArray(req.files) ? req.files : [];
      const manualAdminUpload = adminMode || isManualAdminUpload(req);
      if (!fechaISO) return res.status(400).json({ ok: false, error: 'Falta la fecha de carga' });
      if (!teamSlug) return res.status(400).json({ ok: false, error: manualAdminUpload ? 'Falta el teamSlug para la carga manual' : 'No se pudo identificar el equipo' });
      if (!manualAdminUpload && (!localSlug || !visitanteSlug)) return res.status(400).json({ ok: false, error: 'Faltan datos del cruce' });
      if (!files.length) return res.status(400).json({ ok: false, error: 'No se recibieron imágenes' });
      if (isTiebreakPicturesFolder(tipo) && files.length !== 1) {
        for (const file of files) { try { await fs.promises.unlink(file.path); } catch (_) {} }
        return res.status(400).json({ ok: false, error: 'El desempate admite una sola foto por carga.' });
      }
      if (!manualAdminUpload) {
        const allowed = await isValidatedMatch({ fechaISO, localSlug, visitanteSlug, equipoSlug: teamSlug, tipo });
        if (!allowed) {
          for (const file of files) { try { await fs.promises.unlink(file.path); } catch (_) {} }
          return res.status(403).json({ ok: false, error: 'Solo podés subir fotos cuando el cruce ya esté validado por ambos equipos' });
        }
      }
      const normalizedFiles = [];
      for (const file of files) normalizedFiles.push(await convertHeicToJpeg(file));
      const stored = await keepUniquePicturesWithinLimit(normalizedFiles, requiredPictures);
      const result = stored.files.map(file => ({ teamSlug, tipo, fechaISO, filename: file.filename, originalName: file.originalname, size: file.size, uploadedAt: new Date().toISOString() }));
      return res.json({
        ok: true,
        files: result,
        uploadedCount: result.length,
        duplicatesSkipped: stored.duplicatesSkipped,
        excessSkipped: stored.excessSkipped,
        totalPictures: stored.totalPictures,
        requiredPictures
      });
    } catch (err) {
      const errorId = uploadErrorId();
      logUploadError(req, err, errorId, 'procesamiento');
      const files = Array.isArray(req.files) ? req.files : [];
      for (const file of files) {
        try { await fs.promises.unlink(file.path); } catch (_) {}
        try {
          const jpgCandidate = path.join(path.dirname(file.path), path.parse(file.path).name + '.jpg');
          if (jpgCandidate !== file.path) await fs.promises.unlink(jpgCandidate);
        } catch (_) {}
      }
      return res.status(500).json({ ok: false, error: 'No se pudieron procesar o guardar las fotos.', errorId });
    }
  }

  router.post('/upload', requireTeam, runUpload, async (req, res) => handleUpload(req, res, { adminMode: false }));
  router.post('/admin/upload', requireAdmin, runUpload, async (req, res) => handleUpload(req, res, { adminMode: true }));

  router.get('/admin/teams', requireAdmin, async (_req, res) => {
    try { return res.json({ ok: true, teams: await getTeamOptions() }); }
    catch (err) { return res.status(500).json({ ok: false, error: 'No se pudo listar los equipos' }); }
  });

  router.get('/match', async (req, res) => {
    try {
      const fechaISO = String(req.query?.fechaISO || '').slice(0, 10);
      const localSlug = normalizeSlug(req.query?.localSlug || '');
      const visitanteSlug = normalizeSlug(req.query?.visitanteSlug || '');
      const localName = String(req.query?.localName || '').trim();
      const visitanteName = String(req.query?.visitanteName || '').trim();
      const category = normalizeCategory(req.query?.category || '');
      const tipo = String(req.query?.tipo || '').trim().toLowerCase() === 'desempate' ? 'desempate' : 'cruce';

      if (!fechaISO || !localSlug || !visitanteSlug) return res.status(400).json({ ok: false, error: 'Faltan datos del encuentro' });

      const [localAliases, visitanteAliases] = await Promise.all([
        getPictureSlugAliases(localSlug, localName, category),
        getPictureSlugAliases(visitanteSlug, visitanteName, category)
      ]);
      const localItems = await listTeamPictures(fechaISO, localSlug, { tipo, aliases: localAliases });
      const visitanteItems = await listTeamPictures(fechaISO, visitanteSlug, { tipo, aliases: visitanteAliases });
      const chosen = localItems.length ? { teamSlug: localSlug, items: localItems } : { teamSlug: visitanteSlug, items: visitanteItems };
      return res.json({ ok: true, fechaISO, tipo, teamSlug: chosen.teamSlug, items: chosen.items });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'No se pudieron cargar las fotos del encuentro' });
    }
  });

  router.get('/public/file', async (req, res) => {
    try {
      const fullPath = resolveSafeFullPath(req.query?.file || '');
      if (!fullPath) return res.status(400).json({ ok: false, error: 'Ruta inválida' });
      await fs.promises.access(fullPath, fs.constants.R_OK);
      setPictureCacheHeaders(res);
      return res.sendFile(fullPath);
    } catch {
      return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
    }
  });

  router.get('/public/view', async (req, res) => {
    let fullPath = null;
    try {
      const relativePath = String(req.query?.file || '');
      fullPath = resolveSafeFullPath(relativePath);
      if (!fullPath) return res.status(400).json({ ok: false, error: 'Ruta inválida' });
      await fs.promises.access(fullPath, fs.constants.R_OK);
      const variantPath = await getOptimizedVariant(fullPath, relativePath, { width: 1400, quality: 80 });
      setPictureCacheHeaders(res);
      res.type('image/webp');
      return res.sendFile(variantPath);
    } catch (err) {
      console.error('[picture-variant-error]', String(err?.message || err));
      if (fullPath) {
        try {
          await fs.promises.access(fullPath, fs.constants.R_OK);
          setPictureCacheHeaders(res);
          return res.sendFile(fullPath);
        } catch (_) {}
      }
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
        if (fechaDir.name.startsWith('.')) continue;
        const fechaISO = fechaDir.name;
        const fechaPath = path.join(picturesRoot, fechaISO);
        const teams = await fs.promises.readdir(fechaPath, { withFileTypes: true });
        for (const teamDir of teams) {
          if (!teamDir.isDirectory()) continue;
          const teamSlug = teamDir.name;
          const teamPath = path.join(fechaPath, teamSlug);
          const teamInfo = await getTeamInfoBySlug(teamSlug);
          const teamDisplayName = teamInfo.displayName || teamSlug;
          const category = inferPicturesGroupCategory(fechaISO, teamInfo, teamSlug);
          const files = await fs.promises.readdir(teamPath, { withFileTypes: true });
          const items = [];
          for (const file of files) {
            if (!file.isFile()) continue;
            if (!/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name)) continue;
            const fullPath = path.join(teamPath, file.name);
            const stat = await fs.promises.stat(fullPath);
            const relFile = `${fechaISO}/${teamSlug}/${file.name}`;
            items.push({ filename: file.name, size: stat.size, modifiedAt: stat.mtime.toISOString(), thumbUrl: buildAdminThumbUrl(relFile, Math.round(stat.mtimeMs)) });
          }
          items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
          if (!items.length) continue;
          groups.push({ fechaISO, teamSlug, teamName: teamDisplayName, category, zipFilename: getZipName(fechaISO, teamSlug), items });
        }
      }
      groups.sort((a, b) => `${b.fechaISO} ${b.items[0]?.modifiedAt || ''}`.localeCompare(`${a.fechaISO} ${a.items[0]?.modifiedAt || ''}`));
      return res.json({ ok: true, groups });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'No se pudieron listar las fotos' });
    }
  });

  router.get('/admin/thumb', requireAdmin, async (req, res) => {
    let fullPath = null;
    try {
      const relativePath = String(req.query?.file || '');
      fullPath = resolveSafeFullPath(relativePath);
      if (!fullPath) return res.status(400).json({ ok: false, error: 'Ruta inválida' });
      await fs.promises.access(fullPath, fs.constants.R_OK);
      const variantPath = await getOptimizedVariant(fullPath, relativePath, { width: 480, quality: 72 });
      setPictureCacheHeaders(res);
      res.type('image/webp');
      return res.sendFile(variantPath);
    } catch (err) {
      console.error('[picture-thumbnail-error]', String(err?.message || err));
      if (fullPath) {
        try {
          await fs.promises.access(fullPath, fs.constants.R_OK);
          setPictureCacheHeaders(res);
          return res.sendFile(fullPath);
        } catch (_) {}
      }
      return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
    }
  });

  router.get('/admin/group-download', requireAdmin, async (req, res) => {
    try {
      const fechaISO = String(req.query?.fechaISO || '').slice(0, 10);
      const teamSlug = normalizeSlug(req.query?.teamSlug || '');
      if (!fechaISO || !teamSlug) return res.status(400).json({ ok: false, error: 'Faltan datos' });
      const dir = path.join(picturesRoot, fechaISO, teamSlug);
      await fs.promises.access(dir, fs.constants.R_OK);
      const entries = [];
      const files = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) continue;
        if (!/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name)) continue;
        const fullPath = path.join(dir, file.name);
        const [data, stat] = await Promise.all([fs.promises.readFile(fullPath), fs.promises.stat(fullPath)]);
        entries.push({ name: file.name, data, modifiedAt: stat.mtime });
      }
      if (!entries.length) return res.status(404).json({ ok: false, error: 'No hay fotos para descargar' });
      const zipBuffer = makeZipStore(entries);
      const zipFilename = getZipName(fechaISO, teamSlug);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
      res.setHeader('Content-Length', zipBuffer.length);
      return res.end(zipBuffer);
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'No se pudo generar el ZIP' });
    }
  });

  router.delete('/admin/team-folder', requireAdmin, async (req, res) => {
    try {
      const fechaISO = String(req.body?.fechaISO || '').slice(0, 10);
      const teamSlug = normalizeSlug(req.body?.teamSlug || '');
      if (!fechaISO || !teamSlug) return res.status(400).json({ ok: false, error: 'Faltan datos' });
      const dir = path.join(picturesRoot, fechaISO, teamSlug);
      await fs.promises.rm(dir, { recursive: true, force: true });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message || 'No se pudo vaciar la carpeta' });
    }
  });

  return router;
};
