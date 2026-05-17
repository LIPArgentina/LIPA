const admin = require('firebase-admin');

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !String(raw).trim()) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido:', err?.message || err);
    return null;
  }
}

const serviceAccount = loadServiceAccount();

if (serviceAccount && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

module.exports = serviceAccount ? admin : null;
