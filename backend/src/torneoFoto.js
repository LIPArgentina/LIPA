const crypto = require('node:crypto');

const signingKey = process.env.JWT_SECRET || crypto.randomBytes(32);

function signature(id) {
  return crypto.createHmac('sha256', signingKey).update('torneo-foto:' + id).digest('hex');
}

function photoUrl(player) {
  if (!player.foto_path || !player.id) return '';
  return '/api/torneo-foto/' + player.id + '/' + signature(player.id);
}

function validPhoto(id, code) {
  return /^[1-9]\d{0,9}$/.test(id) && /^[a-f0-9]{64}$/.test(code) &&
    crypto.timingSafeEqual(Buffer.from(signature(id)), Buffer.from(code));
}

module.exports = { photoUrl, validPhoto };
