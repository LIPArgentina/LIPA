const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const pool = require('../db');

const EDITION = 6;
const CATEGORY = 'segunda';
const START_IDA = '2026-07-27';
const START_VUELTA = '2026-08-17';
const APPLY = process.argv.includes('--apply');
const PRODUCTION = process.argv.includes('--production');
const TARGET_DATABASE = PRODUCTION ? 'lipa_db_prod' : 'lipa_db_staging';
const TARGET_LABEL = PRODUCTION ? 'production' : 'staging';

const FOUR_TEAM_GROUP = [
  [
    ['ALBA POOL', 'VICTORIA'],
    ['LOS PATOS DE LA LIGA', 'OLDIES']
  ],
  [
    ['VICTORIA', 'LOS PATOS DE LA LIGA'],
    ['OLDIES', 'ALBA POOL']
  ],
  [
    ['ALBA POOL', 'LOS PATOS DE LA LIGA'],
    ['OLDIES', 'VICTORIA']
  ]
];

const FOUR_TEAM_GROUP_A = [
  [
    ['EL TREBOL', 'WEST'],
    ['TAKOS PRO', 'TOMAS']
  ],
  [
    ['WEST', 'TAKOS PRO'],
    ['TOMAS', 'EL TREBOL']
  ],
  [
    ['TAKOS PRO', 'EL TREBOL'],
    ['TOMAS', 'WEST']
  ]
];

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function team(equipo) {
  return { equipo, puntos: 0, puntosExtra: 0 };
}

function table(grupo, matches) {
  return {
    grupo,
    equipos: matches.flatMap(([local, visitante]) => [team(local), team(visitante)])
  };
}

function buildFixture(startDate, reverse = false) {
  return {
    fechas: Array.from({ length: 3 }, (_, index) => {
      const reverseMatches = matches => reverse
        ? matches.map(([local, visitante]) => [visitante, local])
        : matches;

      return {
        date: addDays(startDate, index * 7),
        tablas: [
          table('A', reverseMatches(FOUR_TEAM_GROUP_A[index])),
          table('B', reverseMatches(FOUR_TEAM_GROUP[index]))
        ]
      };
    })
  };
}

function realPairKey(local, visitante) {
  return [local, visitante].sort((a, b) => a.localeCompare(b, 'es')).join(' <> ');
}

function validateFixture(data, kind) {
  if (!Array.isArray(data?.fechas) || data.fechas.length !== 3) {
    throw new Error(`${kind}: se esperaban 3 fechas`);
  }

  const expectedMatches = { A: 6, B: 6 };
  const seen = { A: new Set(), B: new Set() };

  data.fechas.forEach((fecha, index) => {
    const groupA = fecha.tablas.find(item => item.grupo === 'A');
    const groupB = fecha.tablas.find(item => item.grupo === 'B');

    if (groupA?.equipos?.length !== 4) {
      throw new Error(`${kind}: Grupo A debe tener 2 partidos en fecha ${index + 1}`);
    }
    if (groupB?.equipos?.length !== 4) {
      throw new Error(`${kind}: Grupo B debe tener 2 partidos en fecha ${index + 1}`);
    }

    const allTeams = [...groupA.equipos, ...groupB.equipos].map(item => item.equipo);
    if (allTeams.includes('WO') || allTeams.includes('MALENA')) {
      throw new Error(`${kind}: no debe incluir WO ni MALENA en fecha ${index + 1}`);
    }

    fecha.tablas.forEach(({ grupo, equipos }) => {
      for (let i = 0; i < equipos.length; i += 2) {
        const local = equipos[i]?.equipo;
        const visitante = equipos[i + 1]?.equipo;
        if (!local || !visitante || local === 'WO' || visitante === 'WO') continue;
        const key = realPairKey(local, visitante);
        if (seen[grupo].has(key)) {
          throw new Error(`${kind}: cruce repetido en Grupo ${grupo}: ${key}`);
        }
        seen[grupo].add(key);
      }
    });
  });

  Object.entries(expectedMatches).forEach(([group, expected]) => {
    if (seen[group].size !== expected) {
      throw new Error(`${kind}: Grupo ${group} tiene ${seen[group].size} cruces; se esperaban ${expected}`);
    }
  });
}

async function main() {
  const ida = buildFixture(START_IDA);
  const vuelta = buildFixture(START_VUELTA, true);
  validateFixture(ida, 'ida');
  validateFixture(vuelta, 'vuelta');
  const firstGroupA = ida.fechas[0].tablas.find(item => item.grupo === 'A');
  const takosProVsTomas = firstGroupA.equipos.some((item, index, equipos) =>
    index % 2 === 0 &&
    item.equipo === 'TAKOS PRO' &&
    equipos[index + 1]?.equipo === 'TOMAS'
  );
  if (!takosProVsTomas) {
    throw new Error('La ida debe comenzar con TAKOS PRO como local ante TOMAS');
  }

  if (!APPLY) {
    console.log(JSON.stringify({ ok: true, dryRun: true, ida, vuelta }, null, 2));
    await pool.end();
    return;
  }

  const databaseUrl = String(process.env.DATABASE_URL || '');
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (databaseName !== TARGET_DATABASE) {
    throw new Error(`Se esperaba ${TARGET_DATABASE}, pero DATABASE_URL apunta a ${databaseName}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT kind, category, edicion, data, updated_at
       FROM fixtures
       WHERE category = $1 AND edicion = $2 AND kind IN ('ida', 'vuelta')
       ORDER BY kind`,
      [CATEGORY, EDITION]
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.resolve(
      __dirname,
      '..',
      'exports',
      `fixture-segunda-ed6-${TARGET_LABEL}-before-${timestamp}.json`
    );
    fs.writeFileSync(backupPath, JSON.stringify({
      exportedAt: new Date().toISOString(),
      category: CATEGORY,
      edition: EDITION,
      fixtures: current.rows
    }, null, 2));

    for (const [kind, data] of [['ida', ida], ['vuelta', vuelta]]) {
      await client.query(
        `INSERT INTO fixtures (kind, category, edicion, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
         ON CONFLICT (edicion, category, kind)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [kind, CATEGORY, EDITION, JSON.stringify(data)]
      );
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      ok: true,
      backupPath,
      idaDates: ida.fechas.map(item => item.date),
      vueltaDates: vuelta.fechas.map(item => item.date)
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
  console.error(error);
  process.exitCode = 1;
});
