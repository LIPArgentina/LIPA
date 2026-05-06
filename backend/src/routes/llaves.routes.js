const express = require('express');
const pool = require('../../db');

module.exports = function createLlavesRouter() {
  const router = express.Router();

  const VALID_CATEGORIES = new Set(['segunda', 'tercera']);

  function cleanCategory(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeTeam(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' Y ')
      .replace(/[._-]+/g, ' ')
      .replace(/\b(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[^A-Z0-9]/gi, '')
      .replace(/(TERCERA|SEGUNDA|PRIMERA|3RA|3ERA|2DA|2NDA|1RA)$/i, '')
      .toUpperCase();
  }

  function cleanTeamName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function isRealTeam(value) {
    const team = cleanTeamName(value);
    return team && normalizeTeam(team) !== 'WO';
  }

  function legHasScores(leg) {
    return [
      leg?.home?.puntos,
      leg?.away?.puntos,
      leg?.home?.puntosExtra,
      leg?.away?.puntosExtra
    ].some(value => Number(value || 0) > 0);
  }

  function legContainsTeam(leg, teamKey) {
    return normalizeTeam(leg?.home?.team) === teamKey ||
           normalizeTeam(leg?.away?.team) === teamKey;
  }

  function buildMatchFromLeg(leg, roundId, legIndex) {
    const local = cleanTeamName(leg?.home?.team);
    const visitante = cleanTeamName(leg?.away?.team);

    if (!isRealTeam(local) || !isRealTeam(visitante)) return null;

    return {
      roundId,
      legIndex,
      date: String(leg?.date || '').trim() || null,
      local,
      visitante
    };
  }

  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS llaves_data (
        category TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
  }

  async function getLlaves(req, res) {
    try {
      const category = cleanCategory(req.query.category);

      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({ ok: false, error: 'category inválida' });
      }

      await ensureTables();

      const result = await pool.query(
        `SELECT data FROM llaves_data WHERE category = $1 LIMIT 1`,
        [category]
      );

      res.set('Cache-Control', 'no-store');
      res.json({
        ok: true,
        category,
        data: result.rows[0]?.data || null
      });
    } catch (err) {
      console.error('GET /api/llaves', err);
      res.status(500).json({ ok: false, error: 'No se pudieron cargar las llaves' });
    }
  }

  async function saveLlaves(req, res) {
    try {
      const category = cleanCategory(req.body?.category || req.query.category);
      const data = req.body?.data;

      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({ ok: false, error: 'category inválida' });
      }

      if (!data || typeof data !== 'object') {
        return res.status(400).json({ ok: false, error: 'data inválida' });
      }

      await ensureTables();

      await pool.query(
        `INSERT INTO llaves_data (category, data, created_at, updated_at)
         VALUES ($1, $2::jsonb, NOW(), NOW())
         ON CONFLICT (category)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [category, JSON.stringify(data)]
      );

      res.json({ ok: true, category });
    } catch (err) {
      console.error('POST /api/llaves', err);
      res.status(500).json({ ok: false, error: 'No se pudieron guardar las llaves' });
    }
  }

  async function getProximoCruce(req, res) {
    try {
      const category = cleanCategory(req.query.category);
      const team = cleanTeamName(req.query.team);
      const teamKey = normalizeTeam(team);

      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({ ok: false, error: 'category inválida' });
      }

      if (!teamKey) {
        return res.status(400).json({ ok: false, error: 'team inválido' });
      }

      await ensureTables();

      const result = await pool.query(
        `SELECT data FROM llaves_data WHERE category = $1 LIMIT 1`,
        [category]
      );

      const data = result.rows[0]?.data || null;
      const rounds = Array.isArray(data?.rounds) ? data.rounds : [];

      const candidates = [];

      rounds.forEach((round, roundIndex) => {
        const legs = Array.isArray(round?.legs) ? round.legs : [];

        legs.forEach((leg, legIndex) => {
          if (!legContainsTeam(leg, teamKey)) return;

          const match = buildMatchFromLeg(leg, round?.id || '', legIndex);
          if (!match) return;

          candidates.push({
            ...match,
            roundIndex,
            played: legHasScores(leg)
          });
        });
      });

      const pending = candidates
        .filter(item => !item.played)
        .sort((a, b) => {
          const ad = a.date || '9999-12-31';
          const bd = b.date || '9999-12-31';
          return ad.localeCompare(bd) || (a.roundIndex - b.roundIndex) || (a.legIndex - b.legIndex);
        });

      const match = pending[0] || candidates
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.roundIndex - a.roundIndex) || (b.legIndex - a.legIndex))[0] || null;

      res.set('Cache-Control', 'no-store');
      res.json({
        ok: true,
        category,
        team,
        match
      });
    } catch (err) {
      console.error('GET /api/llaves/proximo-cruce', err);
      res.status(500).json({ ok: false, error: 'No se pudo cargar el próximo cruce de llaves' });
    }
  }


  async function deleteDesempate(req, res) {
    try {
      const category = cleanCategory(req.body?.category || req.query.category);
      const roundId = String(req.body?.roundId || req.query.roundId || '').trim();

      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({ ok: false, error: 'category inválida' });
      }

      if (!roundId) {
        return res.status(400).json({ ok: false, error: 'roundId inválido' });
      }

      await ensureTables();

      const result = await pool.query(
        `SELECT data FROM llaves_data WHERE category = $1 LIMIT 1`,
        [category]
      );

      const data = result.rows[0]?.data || { rounds: [] };
      if (!Array.isArray(data.rounds)) data.rounds = [];

      const round = data.rounds.find(r => r?.id === roundId);
      if (round) {
        if (Array.isArray(round.legs)) {
          round.legs = round.legs.slice(0, 2);
        } else {
          round.legs = [];
        }

        // Marca para que el frontend no lo regenere automáticamente
        // hasta que vuelvan a guardar valores distintos en ida/vuelta.
        round.extraDeleted = true;
      }

      await pool.query(
        `INSERT INTO llaves_data (category, data, created_at, updated_at)
         VALUES ($1, $2::jsonb, NOW(), NOW())
         ON CONFLICT (category)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [category, JSON.stringify(data)]
      );

      res.json({ ok: true, category, roundId });
    } catch (err) {
      console.error('DELETE /api/llaves/desempate', err);
      res.status(500).json({ ok: false, error: 'No se pudo borrar el desempate' });
    }
  }

  // Soporta ambos montajes:
  // router.use(createLlavesRouter()) => /api/llaves
  // router.use('/llaves', createLlavesRouter()) => /api/llaves
  router.get('/llaves/proximo-cruce', getProximoCruce);
  router.get('/proximo-cruce', getProximoCruce);

  router.get('/llaves', getLlaves);
  router.post('/llaves', saveLlaves);
  router.delete('/llaves/desempate', deleteDesempate);

  router.get('/', getLlaves);
  router.post('/', saveLlaves);
  router.delete('/desempate', deleteDesempate);

  return router;
};
