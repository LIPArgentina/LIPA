require("dotenv").config();   // cargar variables primero

const pool = require("./db");
const app = require("./src/app");

const PORT = process.env.PORT || 3000;

// endpoint de prueba de la base
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      ok: true,
      now: result.rows[0].now
    });
  } catch (err) {
    console.error("Error DB:", err);
    res.status(500).json({
      ok: false,
      error: "DB error"
    });
  }
});

app.get("/api/init-reset-password-fields", async (req, res) => {
  try {

    await pool.query(`
      ALTER TABLE equipos
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMP;
    `);

    res.json({
      ok: true,
      message: "Campos de reset de contraseña agregados"
    });

  } catch (err) {
    console.error("Error agregando campos:", err);
    res.status(500).json({
      ok: false,
      error: "No se pudieron agregar los campos"
    });
  }
});

app.listen(PORT, () => {
  console.log(`LPI listo en http://localhost:${PORT}`);
  console.log("Static FRONTEND -> /frontend/**");
});