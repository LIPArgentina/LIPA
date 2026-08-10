const pool = require('../db');

const APPLY = process.argv.includes('--apply');
const EXPECTED_DATABASE = 'lipa_db_staging';
const CATEGORY = 'tercera';
const EDITION = 6;
const KIND = 'ida';
const EARLY_DATE = '2026-08-11';
const ORIGINAL_DATE = '2026-08-18';
const LOCAL = '8910 BALL';
const VISITOR = 'LOS PATOS DEL TREBOL';

function fixtureTeam(equipo, categoria) {
  return { equipo, puntos: 0, categoria, puntosExtra: 0 };
}

function getGroupTable(data, date, group = 'B') {
  const fecha = (data?.fechas || []).find((item) => String(item?.date || '').slice(0, 10) === date);
  if (!fecha) throw new Error(`No existe la fecha ${date} en el fixture.`);
  const tabla = (fecha?.tablas || []).find((item) => String(item?.grupo || '').toUpperCase() === group);
  if (!tabla) throw new Error(`No existe el Grupo ${group} para ${date}.`);
  return tabla;
}

function listMatches(table) {
  const teams = Array.isArray(table?.equipos) ? table.equipos : [];
  const matches = [];
  for (let index = 0; index + 1 < teams.length; index += 2) {
    matches.push([String(teams[index]?.equipo || ''), String(teams[index + 1]?.equipo || '')]);
  }
  return matches;
}

function isMovedMatch(local, visitor) {
  return local === LOCAL && visitor === VISITOR;
}

function isEmptyWoPair(local, visitor) {
  return local === 'WO' && visitor === 'WO';
}

function applyChange(data) {
  const next = structuredClone(data);
  const earlyTable = getGroupTable(next, EARLY_DATE);
  const originalTable = getGroupTable(next, ORIGINAL_DATE);

  earlyTable.equipos = [fixtureTeam(LOCAL, 'local'), fixtureTeam(VISITOR, 'visitante')];
  delete earlyTable.fechaLibrePorReajuste;

  const remaining = listMatches(originalTable).filter(([local, visitor]) => (
    !isMovedMatch(local, visitor) && !isEmptyWoPair(local, visitor)
  ));
  originalTable.equipos = remaining.flatMap(([local, visitor]) => [
    fixtureTeam(local, 'local'),
    fixtureTeam(visitor, 'visitante')
  ]);
  delete originalTable.fechaLibrePorReajuste;

  return next;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const databaseResult = await client.query('SELECT current_database() AS name');
    const database = databaseResult.rows[0]?.name;
    if (database !== EXPECTED_DATABASE) {
      throw new Error(`Base incorrecta: ${database || 'desconocida'}. Se esperaba ${EXPECTED_DATABASE}.`);
    }

    const fixtureResult = await client.query(
      `SELECT id, data
         FROM fixtures
        WHERE kind = $1 AND category = $2 AND edicion = $3
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE`,
      [KIND, CATEGORY, EDITION]
    );
    if (!fixtureResult.rowCount) throw new Error('No se encontró el fixture solicitado.');

    const row = fixtureResult.rows[0];
    const before = {
      [EARLY_DATE]: listMatches(getGroupTable(row.data, EARLY_DATE)),
      [ORIGINAL_DATE]: listMatches(getGroupTable(row.data, ORIGINAL_DATE))
    };
    const next = applyChange(row.data);
    const after = {
      [EARLY_DATE]: listMatches(getGroupTable(next, EARLY_DATE)),
      [ORIGINAL_DATE]: listMatches(getGroupTable(next, ORIGINAL_DATE))
    };

    if (APPLY) {
      await client.query(
        'UPDATE fixtures SET data = $1::jsonb, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(next), row.id]
      );
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }

    console.log(JSON.stringify({ ok: true, applied: APPLY, database, fixtureId: row.id, before, after }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
