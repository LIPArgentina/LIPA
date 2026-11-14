(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LipaDifusion = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function phone(value) {
    const raw = String(value || '').trim();
    if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return '';
    let digits = raw.replace(/\D/g, '');
    const international = raw.startsWith('+') || digits.startsWith('00');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (!international && digits.length === 10) digits = '549' + digits;
    if (digits.startsWith('54') && digits.length === 12) digits = '549' + digits.slice(2);
    return /^[1-9]\d{9,14}$/.test(digits) ? '+' + digits : '';
  }
  function collect(rows) {
    const contacts = [], seen = new Set();
    let missing = 0, invalid = 0, duplicates = 0;
    for (const row of rows) {
      if (!String(row.whatsapp || '').trim()) { missing++; continue; }
      const number = phone(row.whatsapp);
      if (!number) { invalid++; continue; }
      if (seen.has(number)) { duplicates++; continue; }
      seen.add(number);
      contacts.push({ name: row.nombre_oficial || row.nombre_ingresado || 'Jugador', phone: number });
    }
    return { contacts, missing, invalid, duplicates };
  }
  function vcard(contacts) {
    const escape = value => String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
    // Fold by UTF-8 bytes, without splitting accented characters.
    const fold = value => {
      let result = '', size = 0;
      for (const char of value) {
        const bytes = new TextEncoder().encode(char).length;
        if (size + bytes > 75) { result += '\r\n '; size = 1; }
        result += char; size += bytes;
      }
      return result;
    };
    return contacts.map(contact => [
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:' + escape('LIPA · ' + contact.name),
      'N:;' + escape('LIPA · ' + contact.name) + ';;;',
      'TEL;TYPE=CELL:' + contact.phone, 'END:VCARD'
    ].map(fold).join('\r\n')).join('\r\n') + '\r\n';
  }
  return { phone, collect, vcard };
});
