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

// Corrección puntual y reversible en staging: conservar el Oldies original
// (ID 319, con plantel) y retirar el duplicado vacío (ID 1126).
(async () => {
  const client = await pool.connect();
  const fixKey = "2026-07-31-oldies-staging-canonical-319";
  const canonicalId = 319;
  const duplicateId = 1126;

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS codex_team_fix_backups (
        fix_key TEXT PRIMARY KEY,
        teams_json JSONB NOT NULL,
        reference_counts_json JSONB NOT NULL,
        backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const teamsResult = await client.query(
      `SELECT *
         FROM equipos
        WHERE id IN ($1, $2)
        ORDER BY id
        FOR UPDATE`,
      [canonicalId, duplicateId]
    );

    const canonical = teamsResult.rows.find((row) => Number(row.id) === canonicalId);
    const duplicate = teamsResult.rows.find((row) => Number(row.id) === duplicateId);

    if (canonical && !duplicate && canonical.activo === true) {
      await client.query("ROLLBACK");
      console.log(`Corrección ya aplicada: ${fixKey}`);
      return;
    }

    if (!canonical || !duplicate) {
      throw new Error("No se encontraron exactamente los dos registros esperados de Oldies");
    }

    for (const team of [canonical, duplicate]) {
      if (String(team.division || "").toLowerCase() !== "tercera" ||
          String(team.username || "").trim().toUpperCase() !== "OLDIES") {
        throw new Error(`El equipo ID ${team.id} no coincide con Oldies de tercera`);
      }
    }

    const referencesResult = await client.query(`
      SELECT tc.table_schema, tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
         AND kcu.constraint_schema = tc.constraint_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.constraint_schema = tc.constraint_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND ccu.table_name = 'equipos'
         AND ccu.column_name = 'id'
         AND tc.table_schema = 'public'
    `);

    const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const referenceCounts = {};
    for (const reference of referencesResult.rows) {
      const tableName = `${quoteIdentifier(reference.table_schema)}.${quoteIdentifier(reference.table_name)}`;
      const columnName = quoteIdentifier(reference.column_name);
      const counts = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE ${columnName} = $1)::int AS canonical_count,
           COUNT(*) FILTER (WHERE ${columnName} = $2)::int AS duplicate_count
         FROM ${tableName}`,
        [canonicalId, duplicateId]
      );
      referenceCounts[`${reference.table_schema}.${reference.table_name}.${reference.column_name}`] = counts.rows[0];
    }

    const duplicateReferences = Object.entries(referenceCounts)
      .filter(([, counts]) => Number(counts.duplicate_count) > 0);
    if (duplicateReferences.length) {
      throw new Error(`El duplicado ID ${duplicateId} tiene referencias: ${JSON.stringify(duplicateReferences)}`);
    }

    const canonicalPlayers = Object.entries(referenceCounts)
      .find(([key]) => key.endsWith("jugador_equipos.equipo_id"))?.[1]?.canonical_count || 0;
    if (Number(canonicalPlayers) < 1) {
      throw new Error(`El Oldies original ID ${canonicalId} no tiene asociaciones de jugadores`);
    }

    await client.query(
      `INSERT INTO codex_team_fix_backups (fix_key, teams_json, reference_counts_json)
       VALUES ($1, $2::jsonb, $3::jsonb)
       ON CONFLICT (fix_key) DO NOTHING`,
      [fixKey, JSON.stringify(teamsResult.rows), JSON.stringify(referenceCounts)]
    );

    await client.query(
      `UPDATE equipos
          SET activo = true,
              display_name = 'OLDIES',
              username = 'OLDIES'
        WHERE id = $1`,
      [canonicalId]
    );
    await client.query(`DELETE FROM equipos WHERE id = $1`, [duplicateId]);

    await client.query("COMMIT");
    console.log(`Corrección aplicada: ${fixKey}; jugadores asociados: ${canonicalPlayers}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("No se pudo unificar Oldies en staging:", err);
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
