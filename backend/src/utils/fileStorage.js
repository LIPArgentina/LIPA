
const fs = require('fs');
const path = require('path');






function readJSON(filePath, fallback = null) {
  try {
    const absPath = path.resolve(filePath);
    const content = fs.readFileSync(absPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {


    return fallback;
  }
}





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
