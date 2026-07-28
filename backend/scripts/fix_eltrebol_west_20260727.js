const pool = require('../db');

const WRITE = process.argv.includes('--write');
const DATABASE = 'lipa_db_prod';
const FECHA_KEY = '2026-07-27::eltrebol_segunda::west_segunda';
const LOCAL_SLUG = 'eltrebol_segunda';
const VISITANTE_SLUG = 'west_segunda';
const FECHA_ISO = '2026-07-27';

const OLD_NAMES = [
  'Walter Ciarlitto',
  'Ezequiel Alcocer',
  'Ezequiel Alcocer',
  'Pablo Fernandez',
  'Jorge Haberkorn',
  'Maximiliano Suarez',
  'Mariano Badel',
  'Luis Montenegro',
  'Raul Aguilera',
  'Raul Aguilera',
  'Adrian Barrios'
];

const CORRECT_NAMES = [
  'Jorge Palacios',
  'Walter Ciarlitto',
  'Ezequiel Alcocer',
  'Jorge Haberkorn',
  'Pablo Fernandez',
  'Maximiliano Suarez',
  'Claudia Muñoz',
  'Mariano Badel',
  'Luis Montenegro',
  'Raul Aguilera',
  'Adrian Barrios'
];

const OLD_SCORES = [5, 6, 2, 2, 6, 3, 4, 1, 6, 6, 2];
const CORRECT_SCORES = [5, 6, 2, 2, 6, 3, 4, 4, 6, 6, 2];

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertOriginalStatus(status) {
  if (!same(status?.localPlanilla?.individuales, OLD_NAMES)) {
    throw new Error('Los jugadores originales no coinciden con el estado esperado.');
  }
  if (!same(status?.localPlanilla?.individualesPts, OLD_SCORES)) {
    throw new Error('Los puntajes de la planilla no coinciden con el estado esperado.');
  }
  if (!same(status?.local?.scoreRows, OLD_SCORES)) {
    throw new Error('Los puntajes del cruce no coinciden con el estado esperado.');
  }
  if (Number(status?.local?.triangulosTotales) !== 43) {
    throw new Error('El total original de triángulos no coincide.');
  }
}

function correctedStatus(source) {
  const status = structuredClone(source);
  status.localPlanilla.individuales = CORRECT_NAMES;
  status.localPlanilla.individualesPts = CORRECT_SCORES;
  status.local.jugadores = CORRECT_SCORES;
  status.local.scoreRows = CORRECT_SCORES;
  status.local.triangulosTotales = 46;
  return status;
}

function assertCorrectedStatus(status) {
  if (!same(status?.localPlanilla?.individuales, CORRECT_NAMES)) {
    throw new Error('Falló la verificación de jugadores corregidos.');
  }
  if (!same(status?.localPlanilla?.individualesPts, CORRECT_SCORES)) {
    throw new Error('Falló la verificación de puntajes corregidos.');
  }
  if (!same(status?.local?.scoreRows, CORRECT_SCORES)) {
    throw new Error('Falló la verificación de resultados corregidos.');
  }
  if (Number(status?.local?.triangulosTotales) !== 46) {
    throw new Error('Falló la verificación del total de triángulos.');
  }
  if (Number(status?.local?.puntosTotales) !== 4) {
    throw new Error('El total de encuentros ganados fue alterado.');
  }
}

async function main() {
  const client = await pool.connect();

  try {
    const databaseResult = await client.query('SELECT current_database() AS name');
    if (databaseResult.rows[0]?.name !== DATABASE) {
      throw new Error(`Base incorrecta: ${databaseResult.rows[0]?.name || 'desconocida'}`);
    }

    await client.query('BEGIN');

    const validations = await client.query(
      `
        SELECT team, status_json
        FROM cruces_validations
        WHERE fecha_key = $1
        ORDER BY team
        FOR UPDATE
      `,
      [FECHA_KEY]
    );

    const matchStatuses = await client.query(
      `
        SELECT equipo_slug, status_json
        FROM cruces_match_status
        WHERE local_slug = $1
          AND visitante_slug = $2
          AND fecha_iso = $3::date
        ORDER BY equipo_slug
        FOR UPDATE
      `,
      [LOCAL_SLUG, VISITANTE_SLUG, FECHA_ISO]
    );

    if (validations.rowCount !== 2 || matchStatuses.rowCount !== 2) {
      throw new Error(
        `Cantidad inesperada de filas: validations=${validations.rowCount}, matchStatus=${matchStatuses.rowCount}`
      );
    }

    const allRows = [...validations.rows, ...matchStatuses.rows];
    allRows.forEach((row) => assertOriginalStatus(row.status_json));

    if (!WRITE) {
      await client.query('ROLLBACK');
      console.log(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        database: DATABASE,
        rowsReady: allRows.length,
        correctedNames: CORRECT_NAMES,
        correctedScores: CORRECT_SCORES,
        triangulosTotales: 46,
        puntosTotales: 4
      }));
      return;
    }

    for (const row of validations.rows) {
      await client.query(
        `
          UPDATE cruces_validations
          SET status_json = $1::jsonb,
              updated_at = NOW()
          WHERE fecha_key = $2
            AND team = $3
        `,
        [JSON.stringify(correctedStatus(row.status_json)), FECHA_KEY, row.team]
      );
    }

    for (const row of matchStatuses.rows) {
      await client.query(
        `
          UPDATE cruces_match_status
          SET status_json = $1::jsonb,
              updated_at = NOW()
          WHERE local_slug = $2
            AND visitante_slug = $3
            AND fecha_iso = $4::date
            AND equipo_slug = $5
        `,
        [
          JSON.stringify(correctedStatus(row.status_json)),
          LOCAL_SLUG,
          VISITANTE_SLUG,
          FECHA_ISO,
          row.equipo_slug
        ]
      );
    }

    const verification = await client.query(
      `
        SELECT status_json
        FROM cruces_validations
        WHERE fecha_key = $1
        UNION ALL
        SELECT status_json
        FROM cruces_match_status
        WHERE local_slug = $2
          AND visitante_slug = $3
          AND fecha_iso = $4::date
      `,
      [FECHA_KEY, LOCAL_SLUG, VISITANTE_SLUG, FECHA_ISO]
    );

    if (verification.rowCount !== 4) {
      throw new Error(`La verificación encontró ${verification.rowCount} filas en vez de 4.`);
    }
    verification.rows.forEach((row) => assertCorrectedStatus(row.status_json));

    await client.query('COMMIT');
    console.log(JSON.stringify({
      ok: true,
      mode: 'write',
      database: DATABASE,
      rowsUpdated: verification.rowCount,
      correctedNames: CORRECT_NAMES,
      correctedScores: CORRECT_SCORES,
      triangulosTotales: 46,
      puntosTotales: 4
    }));
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
