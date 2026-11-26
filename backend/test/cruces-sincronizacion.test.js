const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgres://localhost/lipa_test';
const pool = require('../db');
const { resolveResultMatchContext } = require('../src/routes/cruces.routes.db').__test;

const fechaISO = '2026-11-24';
const localSlug = 'victoria';
const visitanteSlug = 'eltrebol';
const match = { fechaISO, localSlug, visitanteSlug };
const teams = [
  { id: 325, division: 'tercera', slug_uid: 'eltrebol_tercera', display_name: 'EL TREBOL' },
  { id: 337, division: 'segunda', slug_uid: 'victoria_segunda', display_name: 'VICTORIA' },
  { id: 739, division: 'tercera', slug_uid: 'victoria_tercera', display_name: 'VICTORIA' },
  { id: 754, division: 'segunda', slug_uid: 'eltrebol_segunda', display_name: 'EL TREBOL' }
];

function bracket(category, edicion, date = fechaISO) {
  return { category, edicion, data: { rounds: [{ id: 's2', legs: [{
    date, home: { team: 'VICTORIA' }, away: { team: 'EL TRÉBOL' }
  }] }] } };
}

function useSchedule(t, brackets, fixtures = []) {
  t.mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM equipos')) return { rows: teams };
    if (sql.includes('FROM fixtures')) return { rows: fixtures };
    if (sql.includes('FROM llaves_data')) return { rows: brackets };
    throw new Error(`Consulta inesperada: ${sql}`);
  });
}

test('elige la categoría y edición de la llave del partido aunque haya registros históricos en otra división', async t => {
  useSchedule(t, [bracket('segunda', 7, '2026-11-26'), bracket('tercera', 6)]);

  for (const snapshot of [undefined, { category: 'tercera' }, { category: 'segunda' }]) {
    const result = await resolveResultMatchContext({ ...match, snapshot });
    assert.equal(result.category, 'tercera');
    assert.equal(result.edition, 6);
    assert.equal(result.localInfo.slug_uid, 'victoria_tercera');
    assert.equal(result.visitanteInfo.slug_uid, 'eltrebol_tercera');
  }
});

test('si ambas categorías tienen ese mismo partido, exige el contexto y no elige por ID', async t => {
  useSchedule(t, [bracket('segunda', 7), bracket('tercera', 6)]);

  assert.deepEqual(await resolveResultMatchContext(match), { reason: 'ambiguous_scheduled_match' });
  assert.equal((await resolveResultMatchContext({ ...match, snapshot: { category: 'tercera' } })).category, 'tercera');
});

test('reconoce la semifinal cuando los equipos se calculan desde cuartos y todavía figuran como WO', async t => {
  const tercera = bracket('tercera', 6);
  tercera.data.rounds[0].legs[0].home.team = 'WO';
  tercera.data.rounds[0].legs[0].away.team = 'WO';
  for (const [id, team, other] of [['q3', 'VICTORIA', 'RIVAL 1'], ['q4', 'EL TREBOL', 'RIVAL 2']]) {
    tercera.data.rounds.push({ id, legs: [{
      date: '2026-11-17', home: { team, puntos: 7 }, away: { team: other, puntos: 4 }
    }] });
  }
  useSchedule(t, [bracket('segunda', 7, '2026-11-26'), tercera]);
  const result = await resolveResultMatchContext({ ...match, snapshot: { category: 'tercera' } });
  assert.equal(result.category, 'tercera');
  assert.equal(result.edition, 6);
});

test('respeta la edición verificada por el guardado manual, aunque no sea la activa', async t => {
  useSchedule(t, []);

  const result = await resolveResultMatchContext({ ...match, scheduled: { category: 'segunda', edition: 6 } });
  assert.equal(result.category, 'segunda');
  assert.equal(result.edition, 6);
});
