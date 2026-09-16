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

test('administradores pueden consultar Segunda', () => {
  assert.equal(canViewSecondCategory({ role: 'admin' }), true);
});

test('solo los seis equipos seleccionados de Segunda tienen acceso', () => {
  allowedTeams.forEach(slug => {
    assert.equal(canViewSecondCategory({ role: 'team', category: 'segunda', slug }), true, slug);
  });
  assert.equal(canViewSecondCategory({ role: 'team', category: 'segunda', slug: 'oldies_segunda' }), false);
  assert.equal(canViewSecondCategory({ role: 'team', category: 'tercera', slug: 'victoria_segunda' }), false);
  assert.equal(canViewSecondCategory(null), false);
});
