require("dotenv").config();

const express = require("express");

const bcrypt = require('bcryptjs');
const pool = require("./db");
const app = require("./src/app");
const { requireAdmin } = require("./src/middleware/auth");

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === "production") {
  const jwtSecret = String(process.env.JWT_SECRET || "");
  const looksWeak =
    jwtSecret.length < 32 ||
    /changeme|change-me|secret|admin123|password/i.test(jwtSecret);

  if (looksWeak) {
    throw new Error("JWT_SECRET inseguro o no configurado para producción");
  }
}

const PICTURES_DIR = process.env.PICTURES_DIR || "/opt/render/project/src/persistent/pictures";
app.use("/pictures", express.static(PICTURES_DIR, {
  maxAge: "1d",
  setHeaders: (res) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
}));


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

// Corrección puntual y reversible del encuentro del 27/07/2026:
// Los Patos de la Liga vs Alba. Se elimina después de ejecutarse en producción.
(async () => {
  const client = await pool.connect();
  const fixKey = "2026-07-27-lospatos-alba-suplente-gaston-duperre";
  const fechaKey = "2026-07-27::lospatosdelaliga::albapool";
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS codex_data_fix_backups (
        fix_key TEXT NOT NULL,
        team TEXT NOT NULL,
        fecha_key TEXT NOT NULL,
        validacion_json JSONB,
        status_json JSONB,
        validated BOOLEAN,
        locked_until TIMESTAMPTZ,
        original_updated_at TIMESTAMPTZ,
        backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (fix_key, team, fecha_key)
      )
    `);

    const playerResult = await client.query(
      `SELECT id, nombre
       FROM jugadores
       WHERE id = $1
         AND LOWER(nombre) = LOWER($2)
       LIMIT 1`,
      [2625, "Gastón Duperre"]
    );
    if (playerResult.rowCount !== 1) {
      throw new Error("No se encontró la ficha exacta de Gastón Duperre (ID 2625)");
    }

    const validationResult = await client.query(
      `SELECT team, fecha_key, validacion_json, status_json, validated, locked_until, updated_at
       FROM cruces_validations
       WHERE fecha_key = $1
         AND team IN ($2, $3)
       ORDER BY team
       FOR UPDATE`,
      [fechaKey, "lospatosdelaliga", "albapool"]
    );
    if (validationResult.rowCount !== 2) {
      throw new Error(`Se esperaban 2 validaciones y se encontraron ${validationResult.rowCount}`);
    }

    for (const row of validationResult.rows) {
      const status = row.status_json && typeof row.status_json === "object"
        ? structuredClone(row.status_json)
        : null;
      const suplentes = status?.localPlanilla?.suplentes;
      if (!Array.isArray(suplentes) || !suplentes.length) {
        throw new Error(`La validación de ${row.team} no contiene suplentes locales`);
      }

      const currentName = String(suplentes[0] || "").trim();
      if (!["Jorge Oscar Gonzalez", "Gastón Duperre"].includes(currentName)) {
        throw new Error(`Suplente inesperado en ${row.team}: ${currentName}`);
      }

      await client.query(
        `INSERT INTO codex_data_fix_backups (
           fix_key, team, fecha_key, validacion_json, status_json,
           validated, locked_until, original_updated_at
         )
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)
         ON CONFLICT (fix_key, team, fecha_key) DO NOTHING`,
        [
          fixKey,
          row.team,
          row.fecha_key,
          JSON.stringify(row.validacion_json || {}),
          JSON.stringify(row.status_json || {}),
          row.validated,
          row.locked_until,
          row.updated_at
        ]
      );

      suplentes[0] = "Gastón Duperre";
      status.localPlanilla.jugadorIds = status.localPlanilla.jugadorIds || {};
      status.localPlanilla.jugadorIds.suplentes = Array.isArray(status.localPlanilla.jugadorIds.suplentes)
        ? status.localPlanilla.jugadorIds.suplentes
        : [];
      status.localPlanilla.jugadorIds.suplentes[0] = 2625;

      await client.query(
        `UPDATE cruces_validations
         SET status_json = $1::jsonb,
             updated_at = NOW()
         WHERE team = $2
           AND fecha_key = $3`,
        [JSON.stringify(status), row.team, row.fecha_key]
      );
    }

    await client.query("COMMIT");
    console.log(`Corrección aplicada: ${fixKey}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("No se pudo aplicar la corrección puntual del suplente:", err);
  } finally {
    client.release();
  }
})();

app.get("/test-db", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, now: result.rows[0].now });
  } catch (err) {
    console.error("Error DB:", err);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

app.post("/api/admin/reset-team-password/:id", requireAdmin, async (req, res) => {
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

const server = app.listen(PORT, () => {
  console.log(`LPI listo en http://localhost:${PORT}`);
  console.log("Static FRONTEND -> /frontend/**");
});

server.requestTimeout = 60 * 60 * 1000;
server.headersTimeout = 60 * 60 * 1000 + 5000;
