// backend/src/services/banner.service.js

const path = require('path');
const { readJSON, writeJSON } = require('../utils/fileStorage');

const DEFAULT_BANNER = {
  text: 'Bienvenidxs a la Liga de Pool Independiente',
  link: null,
};

function getBanner(DATA_DIR) {
  const filePath = path.join(DATA_DIR, 'banner.json');
  return readJSON(filePath, DEFAULT_BANNER);
}

function saveBanner(DATA_DIR, payload) {
  const { text, link } = payload || {};

  if (typeof text !== 'string') {
    const err = new Error('Campo text inválido');
    err.statusCode = 400;
    throw err;
  }

  let cleanLink = null;
  if (link && typeof link === 'object') {
    const href = String(link.href || '').trim();
    const label = String(link.label || '').trim();
    if (href && label && /^https?:\/\//i.test(href)) {
      cleanLink = { href, label };
    }
  }

  const finalBanner = {
    text: text.trim(),
    link: cleanLink,
  };

  const filePath = path.join(DATA_DIR, 'banner.json');
  writeJSON(filePath, finalBanner);

  return finalBanner;
}

module.exports = {
  getBanner,
  saveBanner,
};
