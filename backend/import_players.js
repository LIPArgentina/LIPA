const fs = require("fs");
const path = require("path");
const pool = require("./db");

const DIR = path.join(__dirname, "../frontend/equipos");

async function run() {

  const files = fs.readdirSync(DIR).filter(f => f.endsWith(".players.json"));

  console.log("Archivos encontrados:", files.length);

  for (const file of files) {

    const slug = file.replace(".players.json", "");

    const full = path.join(DIR, file);
    const json = JSON.parse(fs.readFileSync(full, "utf8"));

    let players = Array.isArray(json) ? json : json.players;

    if (!Array.isArray(players)) {
      players = [];
    }

    players = players
      .map(p => String(p || "").trim())
      .filter(p => p !== "");

    await pool.query(
      `
      INSERT INTO team_players (slug, team_name, players)
      VALUES ($1,$2,$3)
      ON CONFLICT (slug)
      DO UPDATE SET players = EXCLUDED.players
      `,
      [slug, slug.toUpperCase(), JSON.stringify(players)]
    );

    console.log("Importado:", slug, "-", players.length, "jugadores");
  }

  console.log("Migración terminada");
  process.exit();
}

run();