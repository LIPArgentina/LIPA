#!/usr/bin/env node
// Audita y, con --apply, reduce imágenes sin cambiar sus rutas ni extensiones.
// Uso en Render Shell: node scripts/optimize_picture_disk.js --root /ruta/al/disco
// Para aplicar: agregar --apply --confirm-root /ruta/al/disco
// Las variantes son caché regenerable: agregar --purge-variants solo si hace falta espacio.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

const rootArg = option('--root');
const apply = args.includes('--apply');
const purgeVariants = args.includes('--purge-variants');
const confirmedRoot = option('--confirm-root');
const maxFiles = Number(option('--max-files') || 0);

if (!rootArg || !path.isAbsolute(rootArg)) {
  throw new Error('Indicá la ruta absoluta del disco con --root.');
}
const root = path.resolve(rootArg);
if (root === path.parse(root).root) throw new Error('No se admite la raíz del sistema.');
if (apply && path.resolve(confirmedRoot || '') !== root) {
  throw new Error('Para modificar archivos, repetí exactamente --root en --confirm-root.');
}
if (purgeVariants && !apply) throw new Error('--purge-variants requiere --apply.');
if (!Number.isInteger(maxFiles) || maxFiles < 0) throw new Error('--max-files debe ser un entero positivo.');

const policies = {
  encounters: { maxSide: 2200, jpegQuality: 82, webpQuality: 80 },
  players: { maxSide: 1200, jpegQuality: 82, webpQuality: 80 },
  tournaments: { maxSide: 2000, jpegQuality: 88, webpQuality: 86 }
};
const supported = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function area(relativePath) {
  const first = relativePath.split(path.sep)[0]?.toLowerCase();
  if (first === 'players') return 'players';
  if (first === 'torneos') return 'tournaments';
  return 'encounters';
}

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile()) yield fullPath;
  }
}

async function sizeOfDir(dir) {
  let bytes = 0;
  let files = 0;
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) {
        bytes += (await fs.stat(fullPath)).size;
        files += 1;
      }
    }
  }
  try { await visit(dir); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  return { files, bytes };
}

async function clearDerivedVariants() {
  for (const variantDir of [path.join(root, '.variants'), path.join(root, 'players', '.variants')]) {
    const resolved = path.resolve(variantDir);
    if (!resolved.startsWith(root + path.sep)) throw new Error('Ruta de variantes fuera del disco.');
    const size = await sizeOfDir(resolved);
    console.log(JSON.stringify({ type: 'derived_variants', path: resolved, ...size, action: purgeVariants ? 'remove' : 'keep' }));
    if (purgeVariants && size.files) await fs.rm(resolved, { recursive: true, force: true });
  }
}

async function candidateFor(filePath, originalSize, policy) {
  const ext = path.extname(filePath).toLowerCase();
  const image = sharp(filePath, { failOn: 'error', animated: false });
  const meta = await image.metadata();
  if (!meta.width || !meta.height || meta.pages > 1) return null;
  const resized = image.rotate().resize({ width: policy.maxSide, height: policy.maxSide, fit: 'inside', withoutEnlargement: true });
  let output;
  if (ext === '.jpg' || ext === '.jpeg') output = resized.jpeg({ quality: policy.jpegQuality, mozjpeg: true });
  else if (ext === '.webp') output = resized.webp({ quality: policy.webpQuality, effort: 4 });
  else output = resized.png({ compressionLevel: 9, effort: 8 });
  const candidate = await output.toBuffer();
  if (candidate.length >= originalSize * 0.85) return null;
  const decoded = await sharp(candidate, { failOn: 'error' }).metadata();
  const expected = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : ext.slice(1);
  if (decoded.format !== expected || !decoded.width || !decoded.height) throw new Error('La conversión produjo un formato inválido.');
  return candidate;
}

async function replaceVerified(filePath, candidate, originalStat) {
  const temporary = `${filePath}.optimizing-${process.pid}`;
  const backup = `${filePath}.before-optimization-${process.pid}`;
  try {
    await fs.writeFile(temporary, candidate, { flag: 'wx' });
    await sharp(temporary, { failOn: 'error' }).stats();
    await fs.link(filePath, backup);
    try {
      await fs.rename(temporary, filePath);
      await fs.chmod(filePath, originalStat.mode);
      await fs.unlink(backup);
    } catch (err) {
      const backupExists = await fs.stat(backup).catch(() => null);
      if (backupExists) await fs.rename(backup, filePath);
      throw err;
    }
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function main() {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error('--root no es un directorio.');
  const disk = await fs.statfs(root);
  console.log(JSON.stringify({ type: 'disk', root, freeBytes: disk.bavail * disk.bsize, totalBytes: disk.blocks * disk.bsize, mode: apply ? 'apply' : 'audit' }));
  await clearDerivedVariants();

  const summary = { scanned: 0, candidates: 0, optimized: 0, skipped: 0, errors: 0, originalBytes: 0, savedBytes: 0 };
  const byArea = {};
  for await (const filePath of walk(root)) {
    if (maxFiles && summary.scanned >= maxFiles) break;
    const ext = path.extname(filePath).toLowerCase();
    if (!supported.has(ext)) continue;
    const relativePath = path.relative(root, filePath);
    if (relativePath.startsWith('..')) throw new Error('Archivo fuera del disco.');
    const imageArea = area(relativePath);
    byArea[imageArea] ||= { files: 0, originalBytes: 0, potentialSavedBytes: 0 };
    const originalStat = await fs.stat(filePath);
    summary.scanned += 1;
    summary.originalBytes += originalStat.size;
    byArea[imageArea].files += 1;
    byArea[imageArea].originalBytes += originalStat.size;
    try {
      const candidate = await candidateFor(filePath, originalStat.size, policies[imageArea]);
      if (!candidate) { summary.skipped += 1; continue; }
      summary.candidates += 1;
      summary.savedBytes += originalStat.size - candidate.length;
      byArea[imageArea].potentialSavedBytes += originalStat.size - candidate.length;
      if (apply) {
        await replaceVerified(filePath, candidate, originalStat);
        summary.optimized += 1;
      }
      console.log(JSON.stringify({ type: 'image', path: relativePath, before: originalStat.size, after: candidate.length, applied: apply }));
    } catch (err) {
      summary.errors += 1;
      console.error(JSON.stringify({ type: 'error', path: relativePath, message: err.message }));
      if (err.code === 'ENOSPC') break;
    }
  }
  console.log(JSON.stringify({ type: 'areas', ...byArea }));
  console.log(JSON.stringify({ type: 'summary', ...summary, applied: apply }));
  if (summary.errors) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
