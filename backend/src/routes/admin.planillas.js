// backend/src/routes/admin.planillas.js
// Endpoint para que el visor admin pueda leer todas las planillas privadas

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Ajustado para estructura backend/src/routes/
const PLANILLAS_DIR = path.join(__dirname, '..', 'data', 'planillas');

// ===== MODO PRUEBA LOCAL =====
// Desactivamos control de admin para probar el visor
function requireAdmin(req, res, next){
  next();
}

// ===== ENDPOINT =====
router.get('/api/admin/planillas', requireAdmin, async (req, res) => {
  try{

    if (!fs.existsSync(PLANILLAS_DIR)) {
      return res.json([]);
    }

    const files = await fs.promises.readdir(PLANILLAS_DIR);
    const planillaFiles = files.filter(f => f.endsWith('.planilla.json'));

    const result = [];

    for (const file of planillaFiles) {

      const fullPath = path.join(PLANILLAS_DIR, file);

      try {

        const raw = await fs.promises.readFile(fullPath, 'utf8');
        const json = JSON.parse(raw);

        const team = file.replace('.planilla.json', '');

        result.push({
          team,
          planilla: {
            individuales: Array.isArray(json.individuales) ? json.individuales : [],
            pareja1: Array.isArray(json.pareja1) ? json.pareja1 : [],
            pareja2: Array.isArray(json.pareja2) ? json.pareja2 : [],
            suplentes: Array.isArray(json.suplentes) ? json.suplentes : []
          }
        });

      } catch(err) {
        console.error('Error leyendo planilla:', file, err);
      }
    }

    // ordenar por nombre de equipo
    result.sort((a,b)=>a.team.localeCompare(b.team,'es'));

    res.json(result);

  } catch(err) {

    console.error('Error GET /api/admin/planillas', err);

    res.status(500).json({
      ok:false,
      error:'no_se_pudieron_leer_las_planillas'
    });

  }
});

module.exports = router;
