const test = require('node:test');
const assert = require('node:assert/strict');
const { canViewSecondCategory } = require('../src/middleware/auth');

const allowedTeams = [
  'albapool_segunda',
  'eltrebol_segunda',
  'lospatosdelaliga_segunda',
  'takospro_segunda',
  'victoria_segunda',
  'west_segunda',
];

test('Segunda es publica para administradores y visitantes', () => {
  assert.equal(canViewSecondCategory({ role: 'admin' }), true);
  assert.equal(canViewSecondCategory(null), true);
});

test('todos los equipos pueden consultar Segunda', () => {
  allowedTeams.forEach(slug => {
    assert.equal(canViewSecondCategory({ role: 'team', category: 'segunda', slug }), true, slug);
  });
  assert.equal(canViewSecondCategory({ role: 'team', category: 'segunda', slug: 'oldies_segunda' }), true);
  assert.equal(canViewSecondCategory({ role: 'team', category: 'tercera', slug: 'victoria_segunda' }), true);
});
