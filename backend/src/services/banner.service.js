const path = require('path');
const { readJSON, writeJSON } = require('../utils/fileStorage');

const DEFAULT_BANNERS = [
  { text: 'Bienvenidxs a la Liga de Pool Independiente', link: null }
];

function validateLink(linkObj) {
  if (!linkObj || typeof linkObj !== 'object') return null;

  const href = String(linkObj.href || '').trim();
  const label = String(linkObj.label || '').trim();

  if (!href || !label) return null;
  if (!/^https?:\/\//i.test(href)) return null;

  return { href, label };
}

function normalizeStoredBanner(data) {
  if (!data) return [...DEFAULT_BANNERS];

  // Formato viejo: { text, link }
  if (typeof data === 'object' && !Array.isArray(data) && data.text) {
    return [
      {
        text: String(data.text || '').trim(),
        link: validateLink(data.link)
      }
    ];
  }

  // Formato nuevo: { banners: [ ... ] }
  if (typeof data === 'object' && Array.isArray(data.banners)) {
    const cleaned = data.banners
      .map((b) => ({
        text: String(b.text || '').trim(),
        link: validateLink(b.link),
      }))
      .filter((b) => b.text || b.link);

    return cleaned.length ? cleaned : [...DEFAULT_BANNERS];
  }

  return [...DEFAULT_BANNERS];
}

function getBanner(DATA_DIR) {
  const filePath = path.join(DATA_DIR, 'banner.json');
  const stored = readJSON(filePath, null);
  return { banners: normalizeStoredBanner(stored) };
}

function saveAsLegacy(DATA_DIR, payload) {
  const text = String(payload.text || '').trim();
  if (!text) {
    const err = new Error('Campo text inválido');
    err.statusCode = 400;
    throw err;
  }

  const finalBanner = {
    banners: [
      {
        text,
        link: validateLink(payload.link),
      },
    ],
  };

  const filePath = path.join(DATA_DIR, 'banner.json');
  writeJSON(filePath, finalBanner);

  return finalBanner;
}

function saveBanner(DATA_DIR, payload) {
  if (!payload || typeof payload !== 'object') {
    const err = new Error('Payload inválido');
    err.statusCode = 400;
    throw err;
  }

  // Compatibilidad con el formato viejo: { text, link }
  if (payload.text) {
    return saveAsLegacy(DATA_DIR, payload);
  }

  if (!Array.isArray(payload.banners)) {
    const err = new Error('Se esperaba un array banners');
    err.statusCode = 400;
    throw err;
  }

  const cleaned = payload.banners
    .map((b) => ({
      text: String(b.text || '').trim(),
      link: validateLink(b.link),
    }))
    .filter((b) => b.text || b.link);

  if (cleaned.length === 0) {
    cleaned.push(DEFAULT_BANNERS[0]);
  }

  const filePath = path.join(DATA_DIR, 'banner.json');
  writeJSON(filePath, { banners: cleaned });

  return { banners: cleaned };
}

module.exports = {
  getBanner,
  saveBanner,
};
