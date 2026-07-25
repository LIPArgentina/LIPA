const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const pool = require('../db');

const EDITION = 6;
const CATEGORY = 'segunda';
const START_IDA = '2026-07-27';
const START_VUELTA = '2026-08-31';
const APPLY = process.argv.includes('--apply');

const FOUR_TEAM_GROUP = [
  [
    ['ALBA POOL', 'VICTORIA'],
    ['LOS PATOS DE LA LIGA', 'OLDIES']
  ],
  [
    ['ALBA POOL', 'LOS PATOS DE LA LIGA'],
    ['VICTORIA', 'OLDIES']
  ],
  [
    ['OLDIES', 'ALBA POOL'],
    ['LOS PATOS DE LA LIGA', 'VICTORIA']
  ]
];

const FIVE_TEAM_GROUP = [
  [
    ['EL TREBOL', 'WEST'],
    ['TAKOS PRO', 'WO'],
    ['MALENA', 'TOMAS']
  ],
  [
    ['EL TREBOL', 'WO'],
    ['WEST', 'MALENA'],
    ['TOMAS', 'TAKOS PRO']
  ],
  [
    ['MALENA', 'EL TREBOL'],
    ['WO', 'TOMAS'],
    ['TAKOS PRO', 'WEST']
  ],
  [
    ['TOMAS', 'EL TREBOL'],
    ['TAKOS PRO', 'MALENA'],
    ['WO', 'WEST']
  ],
  [
    ['EL TREBOL', 'TAKOS PRO'],
    ['WEST', 'TOMAS'],
    ['MALENA', 'WO']
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
  const orderedMatches = matches.slice().sort((left, right) => {
    const leftHasBye = left.includes('WO') ? 1 : 0;
    const rightHasBye = right.includes('WO') ? 1 : 0;
    return leftHasBye - rightHasBye;
  });

  return {
    grupo,
    equipos: orderedMatches.flatMap(([local, visitante]) => [team(local), team(visitante)])
  };
}

function buildFixture(startDate, reverse = false) {
  return {
    fechas: Array.from({ length: 5 }, (_, index) => {
      const reverseMatches = matches => reverse
        ? matches.map(([local, visitante]) => [visitante, local])
        : matches;
      const tablas = [];

      tablas.push(table('A', reverseMatches(FIVE_TEAM_GROUP[index])));
      if (FOUR_TEAM_GROUP[index]) tablas.push(table('B', reverseMatches(FOUR_TEAM_GROUP[index])));

      return {
        date: addDays(startDate, index * 7),
        tablas
      };
    })
  };
}

function realPairKey(local, visitante) {
  return [local, visitante].sort((a, b) => a.localeCompare(b, 'es')).join(' <> ');
}

function validateFixture(data, kind) {
  if (!Array.isArray(data?.fechas) || data.fechas.length !== 5) {
    throw new Error(`${kind}: se esperaban 5 fechas`);
  }

  const expectedMatches = { A: 10, B: 6 };
  const seen = { A: new Set(), B: new Set() };

  data.fechas.forEach((fecha, index) => {
    const groupA = fecha.tablas.find(item => item.grupo === 'A');
    const groupB = fecha.tablas.find(item => item.grupo === 'B');

    if (groupA?.equipos?.length !== 6) {
      throw new Error(`${kind}: Grupo A debe tener 3 cruces en fecha ${index + 1}`);
    }
    if (index < 3 && groupB?.equipos?.length !== 4) {
      throw new Error(`${kind}: Grupo B debe tener 2 partidos en fecha ${index + 1}`);
    }
    if (index >= 3 && groupB) {
      throw new Error(`${kind}: Grupo B no debe jugar en fecha ${index + 1}`);
    }

    const woCount = groupA.equipos.filter(item => item.equipo === 'WO').length;
    if (woCount !== 1) {
      throw new Error(`${kind}: Grupo A debe tener exactamente un WO en fecha ${index + 1}`);
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

  if (!APPLY) {
    console.log(JSON.stringify({ ok: true, dryRun: true, ida, vuelta }, null, 2));
    await pool.end();
    return;
  }

  const databaseUrl = String(process.env.DATABASE_URL || '');
  if (!databaseUrl.includes('lipa_db_staging')) {
    throw new Error('Este script solo puede ejecutarse contra lipa_db_staging');
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
      `fixture-segunda-ed6-staging-before-${timestamp}.json`
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
