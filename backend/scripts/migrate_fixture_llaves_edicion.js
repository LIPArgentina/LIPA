require('dotenv').config();
const pool = require('../db');

async function main() {
  const write = process.argv.includes('--write');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [6052026]);

    await client.query(`ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS edicion INTEGER`);
    await client.query(`UPDATE fixtures SET edicion = 5 WHERE edicion IS NULL`);
    await client.query(`ALTER TABLE fixtures ALTER COLUMN edicion SET DEFAULT 5`);
    await client.query(`ALTER TABLE fixtures ALTER COLUMN edicion SET NOT NULL`);

    await client.query(`
      DO $$
      DECLARE constraint_name TEXT;
      BEGIN
        SELECT c.conname INTO constraint_name
        FROM pg_constraint c
        WHERE c.conrelid = 'fixtures'::regclass
          AND c.contype = 'u'
          AND (
            SELECT array_agg(a.attname::text ORDER BY a.attname::text)
            FROM unnest(c.conkey) AS key(attnum)
            JOIN pg_attribute a
              ON a.attrelid = c.conrelid AND a.attnum = key.attnum
          ) = ARRAY['category', 'kind'];

        IF constraint_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE fixtures DROP CONSTRAINT %I', constraint_name);
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS fixtures_edicion_category_kind_uidx
      ON fixtures (edicion, category, kind)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS fixtures_edicion_category_idx
      ON fixtures (edicion, category)
    `);

    await client.query(`ALTER TABLE llaves_data ADD COLUMN IF NOT EXISTS edicion INTEGER`);
    await client.query(`UPDATE llaves_data SET edicion = 5 WHERE edicion IS NULL`);
    await client.query(`ALTER TABLE llaves_data ALTER COLUMN edicion SET DEFAULT 5`);
    await client.query(`ALTER TABLE llaves_data ALTER COLUMN edicion SET NOT NULL`);

    await client.query(`
      DO $$
      DECLARE constraint_name TEXT;
      BEGIN
        SELECT c.conname INTO constraint_name
        FROM pg_constraint c
        WHERE c.conrelid = 'llaves_data'::regclass
          AND c.contype IN ('p', 'u')
          AND (
            SELECT array_agg(a.attname::text ORDER BY a.attname::text)
            FROM unnest(c.conkey) AS key(attnum)
            JOIN pg_attribute a
              ON a.attrelid = c.conrelid AND a.attnum = key.attnum
          ) = ARRAY['category'];

        IF constraint_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE llaves_data DROP CONSTRAINT %I', constraint_name);
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS llaves_data_edicion_category_uidx
      ON llaves_data (edicion, category)
    `);

    const fixtures = await client.query(`
      SELECT edicion, category, kind, COUNT(*)::int AS rows
      FROM fixtures
      GROUP BY edicion, category, kind
      ORDER BY edicion, category, kind
    `);
    const llaves = await client.query(`
      SELECT edicion, category, COUNT(*)::int AS rows
      FROM llaves_data
      GROUP BY edicion, category
      ORDER BY edicion, category
    `);

    if (write) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
    console.log(JSON.stringify({
      ok: true,
      mode: write ? 'write' : 'dry-run',
      persisted: write,
      fixtures: fixtures.rows,
      llaves: llaves.rows
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
