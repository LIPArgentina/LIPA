const fs = require('fs');
const path = require('path');

const API_BASE = 'https://liga-backend-staging.onrender.com/api';
const CATEGORIES = ['primera', 'segunda', 'tercera'];
const KINDS = ['ida', 'vuelta'];

async function readJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = { raw: text };
  }
  return { status: response.status, ok: response.ok, body };
}

async function main() {
  const resources = [];

  for (const category of CATEGORIES) {
    for (const kind of KINDS) {
      const url = `${API_BASE}/fixture?kind=${kind}&category=${category}`;
      resources.push({ type: 'fixture', category, kind, url, ...(await readJson(url)) });
    }

    const url = `${API_BASE}/llaves?category=${category}`;
    resources.push({ type: 'llaves', category, url, ...(await readJson(url)) });
  }

  const backup = {
    source: 'staging',
    apiBase: API_BASE,
    capturedAt: new Date().toISOString(),
    assumedEdition: 5,
    resources
  };

  const outputDir = path.join(__dirname, '..', 'exports', 'tournament-history');
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(outputDir, `staging-edition-5-${stamp}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');

  const summary = resources.map((item) => ({
    type: item.type,
    category: item.category,
    kind: item.kind || null,
    status: item.status,
    found: Boolean(item.ok && item.body?.ok && item.body?.data),
    bytes: Buffer.byteLength(JSON.stringify(item.body || null), 'utf8'),
    dates: Array.isArray(item.body?.data?.fechas) ? item.body.data.fechas.length : null,
    rounds: Array.isArray(item.body?.data?.rounds) ? item.body.data.rounds.length : null
  }));

  console.log(JSON.stringify({ outputPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
