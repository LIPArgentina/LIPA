// 1️⃣ Cargar dotenv antes que nada
require("dotenv").config();

// 2️⃣ Ahora sí cargar db.js
const pool = require("./db");
const fs = require("fs");
const path = require("path");

// 3️⃣ Leer JSON de equipos
const jsonPath = path.join(__dirname, "data", "team_passwords.json");
const equipos = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

// 4️⃣ Insertar todos los equipos en la DB
(async () => {
  try {
    for (const slug of Object.keys(equipos)) {
      const password_hash = equipos[slug];

      await pool.query(
        `INSERT INTO equipos (slug, password_hash, must_change_password)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO NOTHING`,
        [slug, password_hash, false]
      );
      console.log(`Equipo ${slug} insertado`);
    }
    console.log("Todos los equipos fueron cargados correctamente");
  } catch (err) {
    console.error("Error al insertar equipos:", err);
  } finally {
    pool.end();
  }
})();