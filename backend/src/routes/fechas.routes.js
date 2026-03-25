const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireTeam } = require('../middleware/auth');
const pool = require('../../db');

module.exports = function createFechasRouter(deps) {
  const { FRONTEND_DIR, FRONTEND_FECHA } = deps;

  const router = express.Router();

  async function resolveEquipoBySlug(rawSlug) {
    const slug = String(rawSlug || '').trim().toLowerCase();
    if (!slug) return null;

    const result = await pool.query(
      `
        SELECT
          e.id,
          e.slug_uid,
          e.slug_base,
          e.display_name,
          e.division
        FROM equipos e
        LEFT JOIN equipo_slug_aliases a
          ON a.equipo_id = e.id
        WHERE
          e.slug_uid = $1
          OR e.slug_base = $1
          OR a.alias_slug = $1
        ORDER BY
          CASE
            WHEN e.slug_uid = $1 THEN 1
            WHEN e.slug_base = $1 THEN 2
            ELSE 3
          END,
          CASE e.division
            WHEN 'primera' THEN 1
            WHEN 'segunda' THEN 2
            WHEN 'tercera' THEN 3
            ELSE 9
          END
      `,
      [slug]
    );

    if (!result.rowCount) return null;

    const exactUid = result.rows.filter(r => r.slug_uid === slug);
    const exactBase = result.rows.filter(r => r.slug_base === slug);

    if (exactUid.length === 1) return exactUid[0];
    if (exactBase.length === 1) return exactBase[0];
    if (result.rowCount === 1) return result.rows[0];
    return result.rows[0];
  }

  async function ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  function normalizePlanillaPayload(input, authSlug) {
    if (!input || typeof input !== 'object') return null;
    return {
      team: String(input.team || authSlug || '').trim().toLowerCase(),
      createdAt: input.createdAt || new Date().toISOString(),
      individuales: Array.isArray(input.individuales) ? input.individuales.map(x => String(x || '').trim()) : [],
      pareja1: Array.isArray(input.pareja1) ? input.pareja1.map(x => String(x || '').trim()) : [],
      pareja2: Array.isArray(input.pareja2) ? input.pareja2.map(x => String(x || '').trim()) : [],
      suplentes: Array.isArray(input.suplentes) ? input.suplentes.map(x => String(x || '').trim()) : [],
      capitan: Array.isArray(input.capitan) ? input.capitan.map(x => String(x || '').trim()) : [],
    };
  }

  function extractPlanFromContent(content) {
    if (typeof content !== 'string' || !content.trim()) return null;
    const m = content.match(/window\.LPI_PLANILLA\s*=\s*([\s\S]*?)\s*;\s*$/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (_) { return null; }
  }

  function isValidFixtureKind(kind) {
    return ['ida', 'vuelta'].includes(String(kind || '').trim().toLowerCase());
  }

  function isValidFixtureCategory(category) {
    return ['primera', 'segunda', 'tercera'].includes(String(category || '').trim().toLowerCase());
  }

  function canonicalTeamName(value) {
    const raw = String(value || '').trim().replace(/\s+/g, ' ');
    if (!raw) return '';

    const upper = raw
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase();

    const aliases = {
      'ANEXO 2DA': 'ANEXO 2DA',
      'ANEXO 2DA.': 'ANEXO 2DA',
      'ANEXO 2DA ': 'ANEXO 2DA',
      'ANEXO 2DA 2DA': 'ANEXO 2DA',
      'ANEXO 2da': 'ANEXO 2DA',
      'SEGUNDA DEL TREBOL': 'SEGUNDA DEL TREBOL'
    };

    return aliases[raw] || aliases[upper] || upper;
  }

  function normalizeFixtureData(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.fechas)) return data;

    return {
      ...data,
      fechas: data.fechas.map((fecha) => ({
        ...fecha,
        tablas: Array.isArray(fecha?.tablas)
          ? fecha.tablas.map((tabla) => ({
              ...tabla,
              grupo: String(tabla?.grupo || '').trim().toUpperCase(),
              equipos: Array.isArray(tabla?.equipos)
                ? tabla.equipos.map((equipo) => ({
                    ...equipo,
                    equipo: canonicalTeamName(equipo?.equipo),
                    puntos: parseInt(equipo?.puntos ?? 0, 10) || 0
                  }))
                : []
            }))
          : []
      }))
    };
  }

  // ====== LEGACY DESCONTINUADO ======
  // Estas rutas escribían archivos en disco y generaban una segunda fuente de verdad.
  // A partir de ahora, cruces/validaciones deben persistirse en DB mediante:
  //   POST /api/cruces/match-status
  //   POST /api/cruces/validate
  // El fixture debe guardarse con:
  //   POST /fixture
  router.post('/validar', async (_req, res) => {
    return res.status(410).json({
      ok: false,
      error: 'Ruta legacy descontinuada',
      migrateTo: '/api/cruces/validate'
    });
  });

  router.post('/save-js', async (_req, res) => {
    return res.status(410).json({
      ok: false,
      error: 'Ruta legacy descontinuada',
      migrateTo: '/fixture'
    });
  });


  // ====== API: Leer/GUARDAR FIXTURE (PostgreSQL con fallback a archivo) ======
  router.get('/fixture', async (req, res) => {
    try {
      const kind = String(req.query.kind || '').trim().toLowerCase();
      const category = String(req.query.category || '').trim().toLowerCase();

      if (!isValidFixtureKind(kind)) {
        return res.status(400).json({ ok: false, error: 'kind inválido' });
      }

      if (!isValidFixtureCategory(category)) {
        return res.status(400).json({ ok: false, error: 'category inválida' });
      }

      const dbResult = await pool.query(
        `
          SELECT data
          FROM fixtures
          WHERE kind = $1 AND category = $2
          LIMIT 1
        `,
        [kind, category]
      );

      if (!dbResult.rowCount) {
        return res.status(404).json({ ok: false, error: 'fixture_no_encontrado_en_db' });
      }

      const normalizedData = normalizeFixtureData(dbResult.rows[0].data);
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, source: 'db', data: normalizedData });
    } catch (err) {
      console.error('Error al leer fixture', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  router.post('/fixture', async (req, res) => {
    try {
      const kind = String(req.body?.kind || '').trim().toLowerCase();
      const category = String(req.body?.category || '').trim().toLowerCase();
      const data = normalizeFixtureData(req.body?.data);

      if (!isValidFixtureKind(kind)) {
        return res.status(400).json({ ok: false, error: 'kind inválido' });
      }

      if (!isValidFixtureCategory(category)) {
        return res.status(400).json({ ok: false, error: 'category inválida' });
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return res.status(400).json({ ok: false, error: 'data inválida' });
      }

      const result = await pool.query(
        `
          INSERT INTO fixtures (kind, category, data, created_at, updated_at)
          VALUES ($1, $2, $3::jsonb, NOW(), NOW())
          ON CONFLICT (kind, category)
          DO UPDATE SET
            data = EXCLUDED.data,
            updated_at = NOW()
          RETURNING id, kind, category, updated_at
        `,
        [kind, category, JSON.stringify(data)]
      );

      return res.json({
        ok: true,
        message: 'Fixture guardado en PostgreSQL',
        fixture: result.rows[0]
      });
    } catch (err) {
      console.error('Error al guardar fixture en DB', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  // ====== API: Guardar PLANILLA (PostgreSQL) ======
  router.post('/save-planilla', requireTeam, async (req, res) => {
    try {
      const { path: relPath, content, team } = req.body || {};
      const authSlug = String((req.user && req.user.slug) || '').trim().toLowerCase();

      const targetSlug = String(
        (typeof team === 'string' && team) ||
        (typeof relPath === 'string'
          ? relPath.replace(/^fecha\//,'').replace(/\.planilla\.(js|json)$/,'')
          : '') ||
        authSlug
      ).trim().toLowerCase();

      if (!authSlug) return res.status(401).json({ ok:false, error:'no autenticade' });
      if (!targetSlug || targetSlug !== authSlug) {
        return res.status(403).json({ ok:false, error:'No podés guardar la planilla de otro equipo' });
      }

      let plan = null;
      if (req.body && typeof req.body.planilla === 'object' && req.body.planilla) {
        plan = req.body.planilla;
      } else if (req.body && typeof req.body.plan === 'object' && req.body.plan) {
        plan = req.body.plan;
      } else if (typeof content === 'string' && content.trim()) {
        plan = extractPlanFromContent(content);
      }

      if (!plan || typeof plan !== 'object') {
        return res.status(400).json({ ok:false, error:'Faltan campos (planilla/plan) o el content es inválido' });
      }

      const finalPlan = normalizePlanillaPayload(plan, authSlug);
      finalPlan.team = authSlug;

      const equipo = await resolveEquipoBySlug(authSlug);
      if (!equipo) {
        return res.status(404).json({ ok:false, error:'equipo_no_encontrado_en_db' });
      }

           const existingPlanilla = await pool.query(
        `
          SELECT id
          FROM planillas
          WHERE equipo_id = $1
            AND estado = 'guardada'
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        `,
        [equipo.id]
      );

      if (existingPlanilla.rowCount > 0) {
        await pool.query(
          `
            UPDATE planillas
            SET
              fecha_clave = CURRENT_DATE,
              datos = $2::jsonb,
              source_file = $3,
              updated_at = NOW()
            WHERE id = $1
          `,
          [
            existingPlanilla.rows[0].id,
            JSON.stringify(finalPlan),
            `${authSlug}.planilla.json`
          ]
        );
      } else {
        await pool.query(
          `
            INSERT INTO planillas (equipo_id, fecha_clave, estado, datos, source_file)
            VALUES ($1, CURRENT_DATE, 'guardada', $2::jsonb, $3)
          `,
          [equipo.id, JSON.stringify(finalPlan), `${authSlug}.planilla.json`]
        );
      }

      try {
        const legacyDir = path.join(__dirname, '..', 'data', 'planillas');
        const legacyPath = path.join(legacyDir, `${authSlug}.planilla.json`);
        const legacyBakPath = legacyPath + '.bak';
        const legacyTmpPath = legacyPath + '.tmp';
        for (const p of [legacyPath, legacyBakPath, legacyTmpPath]) {
          if (fs.existsSync(p)) await fs.promises.unlink(p);
        }
      } catch (_) {}

      return res.json({
        ok: true,
        message: 'Planilla guardada en PostgreSQL',
        team: authSlug,
        source: 'db'
      });
    } catch (err) {
      console.error('Error al guardar planilla:', err);
      res.status(500).json({ ok: false, error: 'Error interno' });
    }
  });

  // ====== API: Obtener PLANILLA del equipo autenticado (PostgreSQL) ======
  router.get('/team/planilla', requireTeam, async (req, res) => {
    try {

    let requested = String(req.query.team || '').trim().toLowerCase();

if (!requested || requested.startsWith('__categoria_')) {
  requested = String((req.user && req.user.slug) || '').trim().toLowerCase();
}

if (!requested) {
  return res.status(401).json({ ok:false, error:'no autenticade' });
}

const equipo = await resolveEquipoBySlug(requested);
      if (!equipo) {
        return res.status(404).json({ ok:false, error:'equipo_no_encontrado_en_db' });
      }

      const result = await pool.query(
        `
          SELECT datos
          FROM planillas
          WHERE equipo_id = $1
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        `,
        [equipo.id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok:false, error:'No existe planilla guardada' });
      }

      const planilla = result.rows[0].datos || {};

      res.set('Cache-Control', 'no-store');
      return res.json({ ok:true, planilla });
    } catch (err) {
      console.error('GET /team/planilla', err);
      return res.status(500).json({ ok:false, error:'Error interno' });
    }
  });


  // ====== API: Obtener planilla de cualquier equipo (para cruces) ======
  router.get('/planilla', async (req, res) => {
    try {

    let requested = String(req.query.team || '').trim().toLowerCase();

if (!requested || requested.startsWith('__categoria_')) {
  return res.status(400).json({ ok:false, error:'team inválido' });
}

const equipo = await resolveEquipoBySlug(requested);
      if (!equipo) {
        return res.status(404).json({ ok:false, error:'equipo_no_encontrado' });
      }

      const result = await pool.query(
        `
          SELECT datos
          FROM planillas
          WHERE equipo_id = $1
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        `,
        [equipo.id]
      );

      if (!result.rowCount) {
        return res.json({ ok:true, planilla:{} });
      }

      return res.json({
        ok:true,
        planilla: result.rows[0].datos || {}
      });

    } catch (err) {
      console.error('GET /planilla', err);
      return res.status(500).json({ ok:false, error:'error interno' });
    }
  });

  // ====== API: Listar planillas existentes (PostgreSQL) ======
  router.get('/planillas', async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            p.id,
            p.updated_at,
            e.slug_uid,
            e.slug_base,
            e.display_name,
            e.division
          FROM planillas p
          JOIN equipos e ON e.id = p.equipo_id
          ORDER BY e.display_name ASC, p.updated_at DESC
        `
      );

      const planillas = result.rows.map(row => ({
        id: row.id,
        team: row.slug_base,
        slug_uid: row.slug_uid,
        teamName: row.display_name,
        division: row.division,
        updatedAt: row.updated_at
      }));

      return res.json(planillas);
    } catch (err) {
      console.error('Error al listar planillas:', err);
      return res.status(500).json({ ok: false, error: 'Error interno al listar planillas' });
    }
  });

  return router;
};
