const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const script = path.resolve(__dirname, '../scripts/optimize_picture_disk.js');

test('audita sin cambios y optimiza conservando la ruta, extensión y decodificación', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lipa-picture-optimize-'));
  try {
    const folder = path.join(root, '2026-08-01', 'test-team');
    await fs.mkdir(folder, { recursive: true });
    const photo = path.join(folder, 'old-photo.jpg');
    await sharp({ create: { width: 3200, height: 2400, channels: 3, background: '#8f634d' } })
      .jpeg({ quality: 100 })
      .toFile(photo);
    const before = await fs.readFile(photo);

    const audit = execFileSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
    assert.match(audit, /"mode":"audit"/);
    assert.deepEqual(await fs.readFile(photo), before);

    const applied = execFileSync(process.execPath, [script, '--root', root, '--apply', '--confirm-root', root], { encoding: 'utf8' });
    assert.match(applied, /"optimized":1/);
    const after = await fs.readFile(photo);
    assert.ok(after.length < before.length);
    const metadata = await sharp(photo).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.ok(Math.max(metadata.width, metadata.height) <= 2200);
    assert.deepEqual(await fs.readdir(folder), ['old-photo.jpg']);
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      throw new Error('Directorio temporal fuera de la ruta esperada.');
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
