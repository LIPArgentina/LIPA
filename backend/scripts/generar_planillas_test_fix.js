const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ROOT = path.join(__dirname, "..", "..");
const EQUIPOS_DIR = path.join(ROOT, "frontend", "equipos");
const FECHA_CLAVE = process.env.FECHA_CLAVE || new Date().toISOString().slice(0, 10);

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeName(value) {
  return String(value || "").trim();
}

function uniqueNonEmptyPlayers(players) {
  const seen = new Set();
  const out = [];
  for (const raw of players || []) {
    const name = normalizeName(raw);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function parsePlayersFile(content) {
  const m = content.match(/window\.LPI_TEAM_PLAYERS\["([^"]+)"\]\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return { team: null, jugadores: [] };

  const team = m[1];
  let jugadores = [];
  try {
    jugadores = JSON.parse(m[2]);
  } catch (e) {
    jugadores = [];
  }
  return {
    team,
    jugadores: uniqueNonEmptyPlayers(jugadores)
  };
}

function inferCategoryFromSlug(slug) {
  const s = String(slug || "").toLowerCase();
  if (s.includes("2da") || s.includes("segunda")) return "segunda";
  if (s.includes("3ra") || s.includes("tercera")) return "tercera";
  return null;
}

function buildTeamValue(slug) {
  const category = inferCategoryFromSlug(slug);
  return category ? `${slug}_${category}` : slug;
}

function generarPlanilla(team, jugadores) {
  if (jugadores.length < 15) return null;
  const mix = shuffle(jugadores);
  return {
    team,
    capitan: [mix[0], mix[1]],
    individuales: mix.slice(2, 9),
    pareja1: mix.slice(9, 11),
    pareja2: mix.slice(11, 13),
    suplentes: mix.slice(13, 15),
    createdAt: new Date().toISOString()
  };
}

async function main() {
  if (!fs.existsSync(EQUIPOS_DIR)) {
    console.error("❌ No existe la carpeta:", EQUIPOS_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(EQUIPOS_DIR).filter(f => f.endsWith(".players.js"));
  console.log("📁 Carpeta:", EQUIPOS_DIR);
  console.log("📦 Archivos .players.js encontrados:", files.length);

  let ok = 0;
  let fail = 0;

  for (const file of files) {
    const filePath = path.join(EQUIPOS_DIR, file);
    const content = fs.readFileSync(filePath, "utf8");
    const { team: slug, jugadores } = parsePlayersFile(content);

    if (!slug) {
      console.log(`❌ No se pudo parsear: ${file}`);
      fail++;
      continue;
    }

    const team = buildTeamValue(slug);
    const planilla = generarPlanilla(team, jugadores);

    if (!planilla) {
      console.log(`❌ No alcanza jugadores: ${slug} (${jugadores.length})`);
      fail++;
      continue;
    }

    try {
      await pool.query(
        `INSERT INTO planillas (equipo_id, fecha_clave, estado, datos)
         VALUES ($1, $2, 'guardada_test', $3::jsonb)`,
        [
          Math.floor(Math.random() * 1000000) + 1,
          FECHA_CLAVE,
          JSON.stringify(planilla)
        ]
      );
      console.log(`✅ Generada: ${planilla.team} (${jugadores.length} jugadores)`);
      ok++;
    } catch (e) {
      console.log(`❌ Error insertando ${planilla.team}: ${e.message}`);
      fail++;
    }
  }

  await pool.end();
  console.log(`\n🏁 Listo. OK: ${ok} | Fallidas: ${fail}`);
}

main().catch(async (e) => {
  console.error("❌ Error general:", e);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
