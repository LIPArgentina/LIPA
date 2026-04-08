require("dotenv").config();

const bcrypt = require('bcryptjs');
const pool = require("./db");
const app = require("./src/app");

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await pool.query(`
      ALTER TABLE equipos
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMP;
    `);
    console.log("Campos de reset de contraseña verificados");
  } catch (err) {
    console.error("Error creando campos de reset:", err);
  }
})();

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, now: result.rows[0].now });
  } catch (err) {
    console.error("Error DB:", err);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

app.post("/api/admin/reset-team-password/:id", async (req, res) => {
  const teamId = req.params.id;

  if (!teamId) {
    return res.status(400).json({ ok: false, error: "Se requiere el ID del equipo" });
  }

  const generatePassword = (length = 6) => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let password = "";
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const newPassword = generatePassword();

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const result = await pool.query(
      `UPDATE equipos
          SET password_hash = $1,
              must_change_password = true,
              password_updated_at = NOW()
        WHERE id = $2
      RETURNING id`,
      [hashedPassword, teamId]
    );

    if (!result.rowCount) {
      return res.status(404).json({ ok: false, error: "Equipo no encontrado" });
    }

    res.json({
      ok: true,
      message: "Contraseña reseteada correctamente",
      newPassword
    });

  } catch (err) {
    console.error("Error reset password:", err);
    res.status(500).json({ ok: false, error: "Error al resetear la contraseña" });
  }
});

app.listen(PORT, () => {
  console.log(`LPI listo en http://localhost:${PORT}`);
  console.log("Static FRONTEND -> /frontend/**");
});
