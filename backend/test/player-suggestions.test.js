const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mergePlayerSuggestions,
  samePlayerIdentity,
  sortPlayerMatchByDateAndRow,
  ensureRankingRowForPlayer
} = require('../src/routes/cruces.routes.db').__test;

test('conserva personas distintas aunque compartan apellido', () => {
  const result = mergePlayerSuggestions([
    { id: 2423, name: 'Javier Martino', teamSlug: 'takos', teamName: "TAKO'S" },
    { id: 2424, name: 'Thiago Martino', teamSlug: 'takos', teamName: "TAKO'S" }
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.id), [2423, 2424]);
});

test('unifica una referencia antigua sin ID con la ficha real de Thiago', () => {
  const result = mergePlayerSuggestions(
    [{ id: 2424, name: 'Thiago Martino', teamSlug: 'lospatosdeltrebol', teamName: 'LOS PATOS DEL TREBOL' }],
    [{ id: null, name: 'Thiago Martino', teamSlug: 'lospatosdeltrebol_tercera', teamName: 'lospatosdeltrebol_tercera' }]
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 2424);
  assert.equal(result[0].label, 'Thiago Martino · LOS PATOS DEL TREBOL');
});

test('unifica los tres alias historicos de Oldies para Dario', () => {
  const result = mergePlayerSuggestions(
    [{ id: 1004, name: 'Darío Vicente Sierra', teamSlug: 'oldies3ra', teamName: 'OLDIES' }],
    [
      { id: null, name: 'Dario Vicente Sierra', teamSlug: 'oldies', teamName: 'OLDIES' },
      { id: null, name: 'Darío Vicente Sierra', teamSlug: 'oldies3ra_tercera', teamName: 'oldies3ra_tercera' }
    ]
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1004);
  assert.equal(result[0].label, 'Darío Vicente Sierra · OLDIES');
});

test('en Total conserva la identidad pero oculta el equipo', () => {
  const result = mergePlayerSuggestions(
    [{ id: 1004, name: 'Darío Vicente Sierra', teamSlug: 'oldies3ra', teamName: 'OLDIES' }],
    [{ id: null, name: 'Dario Vicente Sierra', teamSlug: 'oldies', teamName: 'OLDIES' }],
    { hideTeam: true }
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1004);
  assert.equal(result[0].label, 'Darío Vicente Sierra');
});

test('no une dos IDs diferentes aunque tengan exactamente el mismo nombre', () => {
  const result = mergePlayerSuggestions(
    [{ id: 10, name: 'Juan Perez', teamSlug: 'equipo-a', teamName: 'EQUIPO A' }],
    [{ id: 20, name: 'Juan Perez', teamSlug: 'equipo-a', teamName: 'EQUIPO A' }],
    { hideTeam: true }
  );

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.id), [10, 20]);
  assert.deepEqual(result.map((item) => item.label), ['Juan Perez', 'Juan Perez']);
});

test('no adivina una identidad cuando la referencia historica no tiene equipo', () => {
  const result = mergePlayerSuggestions(
    [{ id: 10, name: 'Juan Perez', teamSlug: '', teamName: '' }],
    [{ id: null, name: 'Juan Perez', teamSlug: '', teamName: '' }],
    { hideTeam: true }
  );

  assert.equal(result.length, 2);
});

test('unifica Vargas, Claudio con la ficha oficial de Claudio Vargas', () => {
  const result = mergePlayerSuggestions(
    [{ id: 1180, name: 'Claudio Vargas', teamSlug: 'takos', teamName: "TAKO'S" }],
    [{ id: null, name: 'Vargas, Claudio', teamSlug: 'takos_tercera', teamName: "TAKO'S" }]
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1180);
  assert.equal(result[0].label, "Claudio Vargas · TAKO'S");
});

test('conserva una sola ficha aunque el alias historico tenga otro equipo', () => {
  const result = mergePlayerSuggestions(
    [{ id: 1180, name: 'Claudio Vargas', teamSlug: 'takos', teamName: "TAKO'S" }],
    [{ id: null, name: 'Vargas, Claudio', teamSlug: 'takospro', teamName: 'TAKOS PRO' }]
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1180);
  assert.equal(result[0].label, "Claudio Vargas · TAKO'S");
});

test('reconoce Vargas, Claudio dentro del detalle total de Claudio Vargas', () => {
  assert.equal(
    samePlayerIdentity(
      { id: null, name: 'Vargas, Claudio' },
      { id: 1180, name: 'Claudio Vargas' }
    ),
    true
  );
});

test('ordena los partidos desde el mas reciente hacia el mas antiguo', () => {
  const matches = [
    { fechaISO: '2026-03-17', row: 1 },
    { fechaISO: '2026-08-04', row: 1 },
    { fechaISO: '2026-07-28', row: 1 }
  ];

  matches.sort(sortPlayerMatchByDateAndRow);

  assert.deepEqual(matches.map((item) => item.fechaISO), [
    '2026-08-04',
    '2026-07-28',
    '2026-03-17'
  ]);
});

test('el ranking Total suma el mismo ID aunque haya cambiado de equipo', () => {
  const ranking = new Map();
  const oldTeam = ensureRankingRowForPlayer(
    ranking,
    { id: 1757, name: 'Eduardo Mendez' },
    'whynot',
    'WHY NOT',
    { mergeHistoricalIdentities: true }
  );
  oldTeam.played += 6;

  const newTeam = ensureRankingRowForPlayer(
    ranking,
    { id: 1757, name: 'Eduardo Mendez' },
    '8910ball',
    '8910 BALL',
    { mergeHistoricalIdentities: true }
  );
  newTeam.played += 2;

  assert.equal(ranking.size, 1);
  assert.equal(oldTeam, newTeam);
  assert.equal(newTeam.played, 8);
});
