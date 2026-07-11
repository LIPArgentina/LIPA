require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const pool = require('../db');

const APPLY = process.argv.includes('--apply');

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function seasonStartDate(category) {
  const normalized = normalizeText(category);
  if (['segunda', '2da', '2'].includes(normalized)) return '2026-03-16';
  if (['tercera', '3ra', '3'].includes(normalized)) return '2026-03-17';
  return null;
}

function canonicalScore(player) {
  return [
    player.dni ? 1 : 0,
    player.foto_path ? 1 : 0,
    player.fecha_nacimiento ? 1 : 0,
    Number(player.resultados || 0),
    -Number(player.id || 0),
  ];
}

function compareCanonical(a, b) {
  const aa = canonicalScore(a);
  const bb = canonicalScore(b);
  for (let i = 0; i < aa.length; i += 1) {
    if (bb[i] !== aa[i]) return bb[i] - aa[i];
  }
  return Number(a.id || 0) - Number(b.id || 0);
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `SELECT to_regclass($1) AS name`,
    [tableName]
  );
  return Boolean(result.rows[0]?.name);
}

async function mergeDuplicatePlayers(client, summary) {
  const playersWithoutNormalizedName = await client.query(`
    SELECT id, nombre
    FROM jugadores
    WHERE NULLIF(nombre_normalizado, '') IS NULL
  `);
  for (const player of playersWithoutNormalizedName.rows) {
    await client.query(
      `UPDATE jugadores SET nombre_normalizado = $1 WHERE id = $2`,
      [normalizeText(player.nombre), player.id]
    );
  }

  const hasResultados = await tableExists(client, 'jugador_resultados');
  const result = await client.query(`
    SELECT
      j.id,
      j.nombre,
      j.dni,
      j.fecha_nacimiento,
      j.foto_path,
      j.nombre_normalizado,
      ${hasResultados ? 'COUNT(jr.id)::int' : '0'} AS resultados
    FROM jugadores j
    ${hasResultados ? 'LEFT JOIN jugador_resultados jr ON jr.jugador_id = j.id' : ''}
    WHERE NULLIF(j.nombre_normalizado, '') IS NOT NULL
    GROUP BY j.id
    ORDER BY j.nombre_normalizado, j.id
  `);

  const groups = new Map();
  for (const row of result.rows) {
    const key = normalizeText(row.nombre_normalizado || row.nombre);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const [key, players] of groups.entries()) {
    if (players.length < 2) continue;

    const canonical = [...players].sort(compareCanonical)[0];
    const duplicates = players.filter(player => Number(player.id) !== Number(canonical.id));
    summary.mergedPlayers.push({
      name: key,
      canonical: Number(canonical.id),
      removed: duplicates.map(player => Number(player.id)),
    });

    for (const duplicate of duplicates) {
      await client.query(
        `UPDATE jugadores c
            SET dni = COALESCE(NULLIF(c.dni, ''), NULLIF(d.dni, '')),
                fecha_nacimiento = COALESCE(c.fecha_nacimiento, d.fecha_nacimiento),
                foto_path = COALESCE(NULLIF(c.foto_path, ''), NULLIF(d.foto_path, '')),
                updated_at = NOW()
           FROM jugadores d
          WHERE c.id = $1
            AND d.id = $2`,
        [canonical.id, duplicate.id]
      );

      await client.query(
        `UPDATE jugador_equipos
            SET jugador_id = $1,
                updated_at = NOW()
          WHERE jugador_id = $2`,
        [canonical.id, duplicate.id]
      );

      if (hasResultados) {
        await client.query(
          `UPDATE jugador_resultados
              SET jugador_id = $1
            WHERE jugador_id = $2`,
          [canonical.id, duplicate.id]
        );
      }

      await client.query(`DELETE FROM jugadores WHERE id = $1`, [duplicate.id]);
    }
  }
}

async function collapseSameTeamAssociations(client, summary) {
  const groups = await client.query(`
    SELECT jugador_id, categoria, equipo_id, ARRAY_AGG(id ORDER BY activo DESC, desde ASC NULLS LAST, id ASC) AS ids
    FROM jugador_equipos
    GROUP BY jugador_id, categoria, equipo_id
    HAVING COUNT(*) > 1
  `);

  for (const group of groups.rows) {
    const [keep, ...remove] = group.ids.map(Number);
    if (!remove.length) continue;
    summary.removedAssociations.push({ keep, removed: remove });
    await client.query(`DELETE FROM jugador_equipos WHERE id = ANY($1::int[])`, [remove]);
  }
}

async function normalizeCycles(client, summary) {
  const segunda = await client.query(
    `UPDATE jugador_equipos
        SET desde = $1::date,
            hasta = CASE WHEN activo = true THEN NULL ELSE hasta END,
            updated_at = NOW()
      WHERE categoria = 'segunda'`,
    [seasonStartDate('segunda')]
  );
  const tercera = await client.query(
    `UPDATE jugador_equipos
        SET desde = $1::date,
            hasta = CASE WHEN activo = true THEN NULL ELSE hasta END,
            updated_at = NOW()
      WHERE categoria = 'tercera'`,
    [seasonStartDate('tercera')]
  );

  summary.normalizedAssociations = Number(segunda.rowCount || 0) + Number(tercera.rowCount || 0);

  const javier = await client.query(
    `SELECT id FROM jugadores WHERE nombre_normalizado = 'javier martino' ORDER BY id LIMIT 1`
  );
  const javierId = javier.rows[0]?.id || null;
  if (javierId) {
    const closed = await client.query(
      `UPDATE jugador_equipos je
          SET desde = '2026-03-17'::date,
              hasta = '2026-06-25'::date,
              activo = false,
              updated_at = NOW()
         FROM equipos e
        WHERE e.id = je.equipo_id
          AND je.jugador_id = $1
          AND je.categoria = 'tercera'
          AND UPPER(e.display_name) = 'LOS PATOS DEL TREBOL'`,
      [javierId]
    );
    const opened = await client.query(
      `UPDATE jugador_equipos je
          SET desde = '2026-06-26'::date,
              hasta = NULL,
              activo = true,
              updated_at = NOW()
         FROM equipos e
        WHERE e.id = je.equipo_id
          AND je.jugador_id = $1
          AND je.categoria = 'tercera'
          AND LOWER(e.display_name) LIKE 'tako%'`,
      [javierId]
    );
    summary.manualCycles.push({
      player: 'javier martino',
      closedLosPatos: Number(closed.rowCount || 0),
      openedTakos: Number(opened.rowCount || 0),
    });
  }
}

async function assertClean(client) {
  const duplicatePlayers = await client.query(`
    SELECT nombre_normalizado, COUNT(*)::int AS total
    FROM jugadores
    WHERE NULLIF(nombre_normalizado, '') IS NOT NULL
    GROUP BY nombre_normalizado
    HAVING COUNT(*) > 1
  `);

  const duplicateActive = await client.query(`
    SELECT jugador_id, categoria, COUNT(*)::int AS total
    FROM jugador_equipos
    WHERE activo = true
    GROUP BY jugador_id, categoria
    HAVING COUNT(*) > 1
  `);

  return {
    duplicatePlayers: duplicatePlayers.rows,
    duplicateActive: duplicateActive.rows,
  };
}

async function main() {
  const client = await pool.connect();
  const summary = {
    apply: APPLY,
    mergedPlayers: [],
    removedAssociations: [],
    manualCycles: [],
    normalizedAssociations: 0,
  };

  try {
    await client.query('BEGIN');
    await mergeDuplicatePlayers(client, summary);
    await collapseSameTeamAssociations(client, summary);
    await normalizeCycles(client, summary);
    const clean = await assertClean(client);
    summary.clean = clean;

    if (APPLY) {
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_jugador_categoria_activo
          ON jugador_equipos (jugador_id, categoria)
         WHERE activo = true
      `);
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }

    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
