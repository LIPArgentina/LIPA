require('dotenv').config();
const { Pool } = require('pg');

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;
const edition = Number(process.env.TOURNAMENT_EDITION || 6);
const write = process.argv.includes('--write');

if (!sourceUrl || !targetUrl) {
  throw new Error('Faltan SOURCE_DATABASE_URL o TARGET_DATABASE_URL');
}

const source = new Pool({ connectionString: sourceUrl, ssl: { rejectUnauthorized: false } });
const target = new Pool({ connectionString: targetUrl, ssl: { rejectUnauthorized: false } });

async function main() {
  const sourceFixtures = await source.query(
    `SELECT kind, category, edicion, data FROM fixtures WHERE edicion = $1 ORDER BY category, kind`,
    [edition]
  );
  const sourceLlaves = await source.query(
    `SELECT category, edicion, data FROM llaves_data WHERE edicion = $1 ORDER BY category`,
    [edition]
  );
  const targetFixtures = await target.query(
    `SELECT kind, category, edicion FROM fixtures WHERE edicion = $1 ORDER BY category, kind`,
    [edition]
  );
  const targetLlaves = await target.query(
    `SELECT category, edicion FROM llaves_data WHERE edicion = $1 ORDER BY category`,
    [edition]
  );

  const report = {
    edition,
    mode: write ? 'write' : 'dry-run',
    sourceFixtures: sourceFixtures.rows.map(row => ({
      category: row.category,
      kind: row.kind,
      dates: Array.isArray(row.data?.fechas) ? row.data.fechas.length : 0
    })),
    sourceLlaves: sourceLlaves.rows.map(row => ({
      category: row.category,
      rounds: Array.isArray(row.data?.rounds) ? row.data.rounds.length : 0,
      publicVisible: row.data?.publicVisible
    })),
    targetFixturesBefore: targetFixtures.rows,
    targetLlavesBefore: targetLlaves.rows
  };

  if (write) {
    const client = await target.connect();
    try {
      await client.query('BEGIN');
      for (const row of sourceFixtures.rows) {
        await client.query(
          `INSERT INTO fixtures (kind, category, edicion, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
           ON CONFLICT (edicion, category, kind)
           DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [row.kind, row.category, row.edicion, JSON.stringify(row.data)]
        );
      }
      for (const row of sourceLlaves.rows) {
        await client.query(
          `INSERT INTO llaves_data (category, edicion, data, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, NOW(), NOW())
           ON CONFLICT (edicion, category)
           DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [row.category, row.edicion, JSON.stringify(row.data)]
        );
      }
      await client.query('COMMIT');
      report.persisted = true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    report.persisted = false;
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([source.end(), target.end()]);
  });
