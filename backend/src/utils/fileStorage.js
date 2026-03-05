// backend/src/utils/fileStorage.js
const fs = require('fs');
const path = require('path');

/**
 * Lee un JSON desde disco.
 * - filePath: ruta absoluta o relativa
 * - fallback: valor por defecto si falla la lectura/parseo
 */
function readJSON(filePath, fallback = null) {
  try {
    const absPath = path.resolve(filePath);
    const content = fs.readFileSync(absPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    // Podés loguear si querés:
    // console.error('[readJSON] error leyendo', filePath, err.message);
    return fallback;
  }
}

/**
 * Escribe un objeto como JSON en disco.
 * - Crea directorios intermedios si hacen falta.
 */
function writeJSON(filePath, data) {
  const absPath = path.resolve(filePath);
  const dir = path.dirname(absPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(absPath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  readJSON,
  writeJSON,
};
