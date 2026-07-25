const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const pool = require('../db');

const EDITION = 6;
const CATEGORY = 'tercera';
const APPLY = process.argv.includes('--apply');
const GROUP_A_IDA_START = '2026-07-28';
const VUELTA_START = '2026-09-15';

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fixtureTeam(equipo, categoria) {
  return {
    equipo,
    puntos: 0,
    categoria,
    puntosExtra: 0
  };
}

function tableFromMatches(grupo, matches) {
  const ordered = matches.slice().sort((left, right) => {
    const leftHasBye = left.includes('WO') ? 1 : 0;
    const rightHasBye = right.includes('WO') ? 1 : 0;
    return leftHasBye - rightHasBye;
  });

  return {
    grupo,
    equipos: ordered.flatMap(([local, visitante]) => [
      fixtureTeam(local, 'local'),
      fixtureTeam(visitante, 'visitante')
    ])
  };
}

function matchesFromTable(tabla) {
  const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];
  const matches = [];
  for (let index = 0; index < equipos.length; index += 2) {
    const local = String(equipos[index]?.equipo || '').trim();
    const visitante = String(equipos[index + 1]?.equipo || '').trim();
    if (local && visitante) matches.push([local, visitante]);
  }
  return matches;
}

function permutations(values) {
  if (values.length <= 1) return [values.slice()];
  const result = [];
  values.forEach((value, index) => {
    const rest = values.slice(0, index).concat(values.slice(index + 1));
    permutations(rest).forEach(permutation => result.push([value, ...permutation]));
  });
  return result;
}

function buildRoundsFromArrangement(arrangement) {
  let circle = arrangement.slice();
  const rounds = [];
  for (let round = 0; round < circle.length - 1; round++) {
    const matches = [];
    for (let index = 0; index < circle.length / 2; index++) {
      matches.push([circle[index], circle[circle.length - 1 - index]]);
    }
    rounds.push(matches);
    circle = [circle[0], circle[circle.length - 1], ...circle.slice(1, -1)];
  }
  return rounds;
}

function findPairingRounds(firstRound) {
  const indexes = firstRound.map((_, index) => index);

  for (const order of permutations(indexes)) {
    for (let flipMask = 0; flipMask < (1 << firstRound.length); flipMask++) {
      const placedPairs = order.map((pairIndex, position) => {
        const pair = firstRound[pairIndex].slice();
        return (flipMask & (1 << position)) ? pair.reverse() : pair;
      });
      const arrangement = Array(firstRound.length * 2);
      placedPairs.forEach((pair, index) => {
        arrangement[index] = pair[0];
        arrangement[arrangement.length - 1 - index] = pair[1];
      });

      const rounds = buildRoundsFromArrangement(arrangement);
      const academySecondRound = rounds[1].find(pair => pair.includes('ACADEMIA DE POOL'));
      if (academySecondRound && !academySecondRound.includes('WO')) {
        rounds[0] = firstRound.map(pair => pair.slice());
        return rounds;
      }
    }
  }

  throw new Error('No se encontró un calendario válido para ACADEMIA DE POOL');
}

function optimizeLocalities(pairingRounds) {
  const variableMatches = [];
  for (let round = 1; round < pairingRounds.length; round++) {
    pairingRounds[round].forEach((pair, match) => {
      if (!pair.includes('WO')) variableMatches.push([round, match]);
    });
  }

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const combinations = 1 << variableMatches.length;

  for (let mask = 0; mask < combinations; mask++) {
    const rounds = pairingRounds.map(round => round.map(pair => pair.slice()));
    variableMatches.forEach(([round, match], bit) => {
      if (mask & (1 << bit)) rounds[round][match].reverse();
    });

    rounds.forEach((round, roundIndex) => {
      if (roundIndex === 0) return;
      round.forEach(pair => {
        if (pair[0] === 'WO') pair.reverse();
      });
    });

    const academySecondRound = rounds[1].find(pair => pair.includes('ACADEMIA DE POOL'));
    if (!academySecondRound || academySecondRound[1] !== 'ACADEMIA DE POOL') continue;

    const histories = {};
    rounds.forEach(round => {
      round.forEach(([local, visitante]) => {
        if (local !== 'WO' && visitante !== 'WO') {
          (histories[local] ||= []).push('L');
          (histories[visitante] ||= []).push('V');
        }
      });
    });

    let repetitions = 0;
    let imbalance = 0;
    Object.values(histories).forEach(roles => {
      for (let index = 1; index < roles.length; index++) {
        if (roles[index] === roles[index - 1]) repetitions++;
      }
      const locals = roles.filter(role => role === 'L').length;
      const visitors = roles.length - locals;
      imbalance += Math.abs(locals - visitors);
    });

    const score = repetitions * 100 + imbalance;
    if (score < bestScore) {
      bestScore = score;
      best = rounds;
    }
  }

  if (!best) throw new Error('No se pudo orientar el calendario del Grupo A');
  return { rounds: best, score: bestScore };
}

function reverseMatches(rounds) {
  return rounds.map(round => round.map(([local, visitante]) => [visitante, local]));
}

function groupTable(fixture, dateIndex, group) {
  return fixture?.fechas?.[dateIndex]?.tablas?.find(
    tabla => String(tabla?.grupo || '').toUpperCase() === group
  );
}

function buildFixtures(currentIda) {
  const currentFirstA = matchesFromTable(groupTable(currentIda, 0, 'A'));
  if (currentFirstA.length !== 3 && currentFirstA.length !== 4) {
    throw new Error('La primera fecha actual del Grupo A no tiene tres o cuatro partidos');
  }

  const alreadyHasAlbaBye = currentFirstA.some(
    ([local, visitante]) => local === 'ALBA' && visitante === 'WO'
  );
  const firstRoundA = alreadyHasAlbaBye
    ? currentFirstA
    : [...currentFirstA, ['ALBA', 'WO']];
  const pairingRoundsA = findPairingRounds(firstRoundA);
  const optimizedA = optimizeLocalities(pairingRoundsA);
  const idaA = optimizedA.rounds;
  const vueltaA = reverseMatches(idaA);

  const idaB = Array.from({ length: 5 }, (_, index) => {
    const matches = matchesFromTable(groupTable(currentIda, index, 'B'));
    if (matches.length !== 3) {
      throw new Error(`La fecha ${index + 1} actual del Grupo B no tiene tres partidos`);
    }
    return matches;
  });
  const vueltaB = reverseMatches(idaB);

  const ida = {
    fechas: Array.from({ length: 7 }, (_, index) => {
      const tablas = [tableFromMatches('A', idaA[index])];
      if (index < 5) tablas.push(tableFromMatches('B', idaB[index]));
      return {
        date: addDays(GROUP_A_IDA_START, index * 7),
        tablas
      };
    })
  };

  const vueltaDates = Array.from({ length: 7 }, (_, index) =>
    addDays(VUELTA_START, index * 7)
  );
  const vuelta = {
    fechas: vueltaDates.map((date, index) => {
      const tablas = [tableFromMatches('A', vueltaA[index])];
      if (index < 5) tablas.push(tableFromMatches('B', vueltaB[index]));
      return { date, tablas };
    })
  };

  return { ida, vuelta, localityScore: optimizedA.score };
}

function realPairKey(local, visitante) {
  return [local, visitante].sort((a, b) => a.localeCompare(b, 'es')).join(' <> ');
}

function collectGroupRounds(fixture, group) {
  return fixture.fechas
    .map(fecha => fecha.tablas.find(tabla => tabla.grupo === group))
    .filter(Boolean)
    .map(matchesFromTable);
}

function validateFixtures(ida, vuelta, currentIda) {
  const idaA = collectGroupRounds(ida, 'A');
  const idaB = collectGroupRounds(ida, 'B');
  const vueltaA = collectGroupRounds(vuelta, 'A');
  const vueltaB = collectGroupRounds(vuelta, 'B');

  if (idaA.length !== 7 || vueltaA.length !== 7) throw new Error('Grupo A debe tener 7 fechas por tramo');
  if (idaB.length !== 5 || vueltaB.length !== 5) throw new Error('Grupo B debe tener 5 fechas por tramo');
  if (ida.fechas.length !== 7 || vuelta.fechas.length !== 7) throw new Error('Cantidad incorrecta de fechas calendario');

  const currentFirstA = matchesFromTable(groupTable(currentIda, 0, 'A'));
  const expectedFirstA = currentFirstA.some(
    ([local, visitante]) => local === 'ALBA' && visitante === 'WO'
  ) ? currentFirstA : [...currentFirstA, ['ALBA', 'WO']];
  if (JSON.stringify(idaA[0]) !== JSON.stringify(expectedFirstA)) {
    throw new Error('La primera fecha del Grupo A fue modificada');
  }

  const academySecond = idaA[1].find(pair => pair.includes('ACADEMIA DE POOL'));
  if (!academySecond || academySecond[1] !== 'ACADEMIA DE POOL') {
    throw new Error('ACADEMIA DE POOL debe ser visitante en la segunda fecha');
  }

  idaA.forEach((round, index) => {
    if (round.length !== 4 || round.filter(pair => pair.includes('WO')).length !== 1) {
      throw new Error(`Grupo A: WO inválido en fecha ${index + 1}`);
    }
    if (!round[round.length - 1].includes('WO')) {
      throw new Error(`Grupo A: WO no quedó último en fecha ${index + 1}`);
    }
  });

  const seen = { A: new Set(), B: new Set() };
  [['A', idaA, 21], ['B', idaB, 15]].forEach(([group, rounds, expected]) => {
    rounds.forEach(round => round.forEach(([local, visitante]) => {
      if (local === 'WO' || visitante === 'WO') return;
      const key = realPairKey(local, visitante);
      if (seen[group].has(key)) throw new Error(`Cruce repetido en Grupo ${group}: ${key}`);
      seen[group].add(key);
    }));
    if (seen[group].size !== expected) {
      throw new Error(`Grupo ${group}: se esperaban ${expected} cruces`);
    }
  });

  [[idaA, vueltaA, 'A'], [idaB, vueltaB, 'B']].forEach(([outbound, inbound, group]) => {
    outbound.forEach((round, roundIndex) => {
      round.forEach(([local, visitante], matchIndex) => {
        const reversed = inbound[roundIndex][matchIndex];
        if (reversed[0] !== visitante || reversed[1] !== local) {
          throw new Error(`La vuelta no invierte la localía en Grupo ${group}`);
        }
      });
    });
  });

  if (ida.fechas[0].date !== '2026-07-28' || ida.fechas[6].date !== '2026-09-08') {
    throw new Error('Fechas de ida incorrectas');
  }
  if (vuelta.fechas[0].date !== '2026-09-15' || vuelta.fechas[6].date !== '2026-10-27') {
    throw new Error('Fechas de vuelta incorrectas');
  }
  if (!vuelta.fechas[0].tablas.some(tabla => tabla.grupo === 'A') ||
      !vuelta.fechas[0].tablas.some(tabla => tabla.grupo === 'B')) {
    throw new Error('Ambos grupos deben comenzar la vuelta el 15/09');
  }
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '');
  if (!databaseUrl.includes('lipa_db_staging')) {
    throw new Error('Este script solo puede ejecutarse contra lipa_db_staging');
  }

  const client = await pool.connect();
  try {
    const current = await client.query(
      `SELECT kind, category, edicion, data, updated_at
       FROM fixtures
       WHERE category = $1 AND edicion = $2 AND kind IN ('ida', 'vuelta')
       ORDER BY kind`,
      [CATEGORY, EDITION]
    );
    const currentIda = current.rows.find(row => row.kind === 'ida')?.data;
    if (!currentIda) throw new Error('No existe fixture de ida actual para Tercera');

    const { ida, vuelta, localityScore } = buildFixtures(currentIda);
    validateFixtures(ida, vuelta, currentIda);

    if (!APPLY) {
      console.log(JSON.stringify({ ok: true, dryRun: true, localityScore, ida, vuelta }, null, 2));
      return;
    }

    await client.query('BEGIN');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.resolve(
      __dirname,
      '..',
      'exports',
      `fixture-tercera-ed6-staging-before-alba-${timestamp}.json`
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
      localityScore,
      idaDates: ida.fechas.map(fecha => fecha.date),
      vueltaDates: vuelta.fechas.map(fecha => fecha.date)
    }, null, 2));
  } catch (error) {
    if (APPLY) await client.query('ROLLBACK').catch(() => {});
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
