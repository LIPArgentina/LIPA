require('dotenv').config();
const { bootstrapSchema } = require('../src/bootstrap/schema');

bootstrapSchema()
  .then(() => {
    console.log('✅ Esquema de base de datos verificado correctamente');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error verificando esquema:', err);
    process.exit(1);
  });
