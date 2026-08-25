require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('../db');

const CATEGORY = 'segunda';
const EDITION = 6;
const TARGET_DATABASE = 'lipa_db_prod';

function groupTeams(data, date) {
  const fecha = (data?.fechas || []).find(item => String(item?.date || '').slice(0, 10) === date);
  if (!fecha) throw new Error(`No existe la fecha ${date}`);
  const tabla = (fecha?.tablas || []).find(item => String(item?.grupo || '').toUpperCase() === 'B');
  if (!tabla || !Array.isArray(tabla.equipos)) throw new Error(`No existe el grupo B en ${date}`);
  return tabla.equipos;
}

function names(items) {
  return items.map(item => String(item?.equipo || '').trim());
}

function assertNames(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: se esperaba ${JSON.stringify(expected)}, pero existe ${JSON.stringify(actual)}`);
  }
}

async function main() {
  if (!process.argv.includes('--apply')) {
    throw new Error('Ejecutar con --apply para confirmar la corrección');
  }

  const databaseUrl = String(process.env.DATABASE_URL || '');
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (databaseName !== TARGET_DATABASE) {
    throw new Error(`DATABASE_URL debe apuntar a ${TARGET_DATABASE}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, kind, category, edicion, data, updated_at
         FROM fixtures
        WHERE category = $1 AND edicion = $2 AND kind IN ('ida', 'vuelta')
        ORDER BY kind
        FOR UPDATE`,
      [CATEGORY, EDITION]
    );
    if (result.rowCount !== 2) throw new Error(`Se esperaban 2 fixtures y se encontraron ${result.rowCount}`);

    const byKind = Object.fromEntries(result.rows.map(row => [row.kind, row]));
    const idaTeams = groupTeams(byKind.ida.data, '2026-08-10');
    const vueltaTeams = groupTeams(byKind.vuelta.data, '2026-09-07');

    assertNames(
      names(idaTeams),
      ['OLDIES', 'VICTORIA', 'ALBA', 'LOS PATOS DEL TREBOL'],
      'Fixture de ida 10/08'
    );
    assertNames(
      names(vueltaTeams),
      ['LOS PATOS DE LA LIGA', 'ALBA', 'VICTORIA', 'OLDIES'],
      'Fixture de vuelta 07/09'
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.resolve(
      __dirname,
      '..',
      'exports',
      `fixture-segunda-ed6-prod-before-group-b-fix-${timestamp}.json`
    );
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify({
      exportedAt: new Date().toISOString(),
      fixtures: result.rows
    }, null, 2));

    idaTeams[1].equipo = 'LOS PATOS DE LA LIGA';
    idaTeams[3].equipo = 'VICTORIA';
    vueltaTeams[1].equipo = 'OLDIES';
    vueltaTeams[3].equipo = 'ALBA';

    assertNames(names(idaTeams), ['OLDIES', 'LOS PATOS DE LA LIGA', 'ALBA', 'VICTORIA'], 'Ida corregida');
    assertNames(names(vueltaTeams), ['LOS PATOS DE LA LIGA', 'OLDIES', 'VICTORIA', 'ALBA'], 'Vuelta corregida');

    for (const row of result.rows) {
      await client.query(
        `UPDATE fixtures SET data = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(row.data), row.id]
      );
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      ok: true,
      backupPath,
      ida: names(idaTeams),
      vuelta: names(vueltaTeams)
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
