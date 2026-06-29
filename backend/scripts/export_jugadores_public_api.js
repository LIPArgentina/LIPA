const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_BASE || 'https://liga-backend-staging.onrender.com';
const CATEGORIES = (process.env.CATEGORIES || 'primera,segunda,tercera')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
  }
  return data;
}

function teamName(team) {
  return String(team?.username || team?.display_name || team?.nombre || team?.name || team?.teamName || '').trim();
}

function teamSlug(team) {
  return String(team?.slug || team?.slug_uid || team?.slug_base || teamName(team)).trim();
}

function playerName(player) {
  return String(player?.nombre || player?.name || '').trim();
}

async function exportCategory(category) {
  const teamsUrl = `${API_BASE}/api/teams?division=${encodeURIComponent(category)}`;
  const teamsData = await fetchJson(teamsUrl);
  const teams = Array.isArray(teamsData?.teams) ? teamsData.teams : [];
  const rows = [];
  const seen = new Set();

  for (const team of teams) {
    const name = teamName(team);
    const slug = teamSlug(team);
    if (!name && !slug) continue;

    const url = `${API_BASE}/api/players-public/by-team?category=${encodeURIComponent(category)}&team=${encodeURIComponent(slug || name)}`;
    const data = await fetchJson(url);
    const players = Array.isArray(data?.players) ? data.players : [];

    for (const player of players) {
      const jugador = playerName(player);
      const equipo = String(player?.teamName || player?.equipo || data?.team?.display_name || name).trim();
      if (!jugador || !equipo) continue;

      const key = `${String(player?.id || jugador).toLowerCase()}::${equipo.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ categoria: category, jugador, equipo });
    }
  }

  rows.sort((a, b) =>
    a.equipo.localeCompare(b.equipo, 'es') ||
    a.jugador.localeCompare(b.jugador, 'es')
  );

  return rows;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'exports');
  fs.mkdirSync(outDir, { recursive: true });

  const allRows = [];
  const summary = {};

  for (const category of CATEGORIES) {
    const rows = await exportCategory(category);
    summary[category] = rows.length;
    allRows.push(...rows);

    const csv = [
      'jugador,equipo',
      ...rows.map((row) => [csvCell(row.jugador), csvCell(row.equipo)].join(','))
    ].join('\n');
    fs.writeFileSync(path.join(outDir, `jugadores_${category}.csv`), csv, 'utf8');
  }

  const allCsv = [
    'categoria,jugador,equipo',
    ...allRows.map((row) => [csvCell(row.categoria), csvCell(row.jugador), csvCell(row.equipo)].join(','))
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'jugadores_todas_las_categorias.csv'), allCsv, 'utf8');
  fs.writeFileSync(path.join(outDir, 'jugadores_todas_las_categorias.json'), JSON.stringify(allRows, null, 2), 'utf8');

  console.log(JSON.stringify({
    api: API_BASE,
    total: allRows.length,
    porCategoria: summary,
    carpeta: outDir
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
