const test = require('node:test');
const assert = require('node:assert/strict');
const {collect, phone, vcard} = require('../../frontend/torneos/difusion.js');

test('diffusion excludes missing/invalid phones and deduplicates international/Argentine formats', () => {
  const result = collect([
    {nombre_oficial:'Ana',whatsapp:'+54 9 11 2345-6789'},
    {nombre_oficial:'Repetida',whatsapp:'005491123456789'},
    {nombre_oficial:'Local',whatsapp:'11 2345 6789'},
    {nombre_oficial:'Sin 9',whatsapp:'541123456789'},
    {whatsapp:''}, {whatsapp:'123'}, {whatsapp:'consultar 1123456789'},
    {nombre_oficial:'Otro país',whatsapp:'+34 612 345 678'}
  ]);
  assert.deepEqual(result, {contacts:[{name:'Ana',phone:'+5491123456789'},{name:'Otro país',phone:'+34612345678'}],missing:1,invalid:2,duplicates:3});
  assert.equal(phone('+1 202 555 0123'), '+12025550123');
  assert.equal(phone(''), '');
});

test('contact export preserves Unicode and safely escapes vCard fields', () => {
  const result = vcard([{name:'José; García, Pérez\nTEL:intruso',phone:'+5491123456789'}]);
  assert.ok(result.includes('FN:LIPA · José\\; García\\, Pérez\\nTEL:intruso\r\n'));
  assert.equal((result.match(/\r\nTEL;/g) || []).length, 1);
  const long = vcard([{name:'Á'.repeat(100),phone:'+5491123456789'}]);
  assert.ok(long.split('\r\n').every(line => Buffer.byteLength(line,'utf8') <= 75));
  assert.ok(long.replace(/\r\n /g,'').includes('Á'.repeat(100)));
});
