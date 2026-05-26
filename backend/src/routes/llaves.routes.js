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


  function getRound(data, id) {
    return (data?.rounds || []).find(round => round?.id === id);
  }

  function setLegTeams(round, legIndex, homeTeam, awayTeam) {
    if (!round || !Array.isArray(round.legs) || !round.legs[legIndex]) return;
    round.legs[legIndex].home = round.legs[legIndex].home || {};
    round.legs[legIndex].away = round.legs[legIndex].away || {};
    round.legs[legIndex].home.team = cleanTeamName(homeTeam) || 'WO';
    round.legs[legIndex].away.team = cleanTeamName(awayTeam) || 'WO';
  }

  function singleWinner(round) {
    const leg = round?.legs?.[0];
    if (!leg || !isRealTeam(leg.home?.team) || !isRealTeam(leg.away?.team) || !legHasScores(leg)) {
      return { winner: 'WO', loser: 'WO', decided: false };
    }

    const hp = Number(leg.home?.puntos || 0);
    const ap = Number(leg.away?.puntos || 0);
    const ht = Number(leg.home?.puntosExtra || 0);
    const at = Number(leg.away?.puntosExtra || 0);

    if (hp > ap) return { winner: leg.home.team, loser: leg.away.team, decided: true };
    if (ap > hp) return { winner: leg.away.team, loser: leg.home.team, decided: true };
    if (ht > at) return { winner: leg.home.team, loser: leg.away.team, decided: true };
    if (at > ht) return { winner: leg.away.team, loser: leg.home.team, decided: true };

    return { winner: 'WO', loser: 'WO', decided: false };
  }

  function seriesWinner(round) {
    if (!round || !Array.isArray(round.legs) || !round.legs.length) {
      return { winner: 'WO', loser: 'WO', decided: false, needsExtra: false };
    }

    if (round.legs.length === 1) return singleWinner(round);

    const ida = round.legs[0];
    const vuelta = round.legs[1];

    if (!ida || !vuelta || !legHasScores(ida) || !legHasScores(vuelta)) {
      return { winner: 'WO', loser: 'WO', decided: false, needsExtra: false };
    }

    const firstTeam = cleanTeamName(vuelta.home?.team || ida.away?.team);
    const secondTeam = cleanTeamName(ida.home?.team || vuelta.away?.team);

    if (!isRealTeam(firstTeam) || !isRealTeam(secondTeam)) {
      return { winner: 'WO', loser: 'WO', decided: false, needsExtra: false };
    }

    const acc = {};
    [firstTeam, secondTeam].forEach(team => {
      acc[normalizeTeam(team)] = { team, pts: 0, tri: 0 };
    });

    [ida, vuelta].forEach(leg => {
      const hKey = normalizeTeam(leg.home?.team);
      const aKey = normalizeTeam(leg.away?.team);
      if (acc[hKey]) {
        acc[hKey].pts += Number(leg.home?.puntos || 0);
        acc[hKey].tri += Number(leg.home?.puntosExtra || 0);
      }
      if (acc[aKey]) {
        acc[aKey].pts += Number(leg.away?.puntos || 0);
        acc[aKey].tri += Number(leg.away?.puntosExtra || 0);
      }
    });

    const a = acc[normalizeTeam(firstTeam)];
    const b = acc[normalizeTeam(secondTeam)];

    if (a.pts > b.pts) return { winner: a.team, loser: b.team, decided: true, needsExtra: false };
    if (b.pts > a.pts) return { winner: b.team, loser: a.team, decided: true, needsExtra: false };
    if (a.tri > b.tri) return { winner: a.team, loser: b.team, decided: true, needsExtra: false };
    if (b.tri > a.tri) return { winner: b.team, loser: a.team, decided: true, needsExtra: false };

    const extra = round.legs[2];
    if (extra && legHasScores(extra)) {
      const hp = Number(extra.home?.puntos || 0);
      const ap = Number(extra.away?.puntos || 0);
      const ht = Number(extra.home?.puntosExtra || 0);
      const at = Number(extra.away?.puntosExtra || 0);
      if (hp > ap) return { winner: extra.home.team, loser: extra.away.team, decided: true, needsExtra: false };
      if (ap > hp) return { winner: extra.away.team, loser: extra.home.team, decided: true, needsExtra: false };
      if (ht > at) return { winner: extra.home.team, loser: extra.away.team, decided: true, needsExtra: false };
      if (at > ht) return { winner: extra.away.team, loser: extra.home.team, decided: true, needsExtra: false };
    }

    return { winner: 'WO', loser: 'WO', decided: false, needsExtra: true };
  }

  function setSeriesTeams(round, teamA, teamB) {
    if (!round || !Array.isArray(round.legs)) return;

    if (round.legs.length === 1) {
      setLegTeams(round, 0, teamA, teamB);
      return;
    }

    // El mejor posicionado (teamA) arranca visitante y define la vuelta de local.
    setLegTeams(round, 0, teamB, teamA);
    setLegTeams(round, 1, teamA, teamB);

    if (round.legs[2]) {
      setLegTeams(round, 2, teamA, teamB);
    }
  }

  function parseScore(value) {
    const n = parseInt(value ?? 0, 10);
    return Number.isFinite(n) ? n : 0;
  }

  async function fetchFixtureData(kind, category) {
    try {
      const result = await pool.query(
        `SELECT data FROM fixtures WHERE kind = $1 AND category = $2 ORDER BY id DESC LIMIT 1`,
        [kind, category]
      );
      return result.rows[0]?.data || null;
    } catch (err) {
      console.warn('No se pudo cargar fixture para ventaja deportiva', { kind, category, err: err?.message });
      return null;
    }
  }

  function collectFixtureEntries(ida, vuelta) {
    const entries = [];
    [
      { kind: 'ida', data: ida },
      { kind: 'vuelta', data: vuelta }
    ].forEach(feed => {
      (feed.data?.fechas || []).forEach((fecha, idx) => {
        entries.push({ kind: feed.kind, fechaIndex: idx + 1, fecha });
      });
    });
    return entries;
  }

  function iterateGroupMatches(entries, callback) {
    (entries || []).forEach(entry => {
      (entry.fecha?.tablas || []).forEach(tabla => {
        const group = String(tabla?.grupo || '').toUpperCase();
        const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];

        for (let i = 0; i < equipos.length; i += 2) {
          const home = equipos[i];
          const away = equipos[i + 1];
          if (!home || !away) continue;

          const homeName = cleanTeamName(home.equipo);
          const awayName = cleanTeamName(away.equipo);
          if (!homeName || !awayName) continue;
          if (normalizeTeam(homeName) === 'WO' || normalizeTeam(awayName) === 'WO') continue;

          callback({
            group,
            home: {
              team: homeName,
              key: normalizeTeam(homeName),
              puntos: parseScore(home.puntos),
              puntosExtra: parseScore(home.puntosExtra)
            },
            away: {
              team: awayName,
              key: normalizeTeam(awayName),
              puntos: parseScore(away.puntos),
              puntosExtra: parseScore(away.puntosExtra)
            }
          });
        }
      });
    });
  }

  function computeHeadToHead(group, tiedKeys, entries) {
    const tied = new Set(tiedKeys);
    const table = Object.create(null);

    tiedKeys.forEach(key => {
      table[key] = { pts: 0, tr: 0 };
    });

    iterateGroupMatches(entries, match => {
      if (match.group !== group) return;
      if (!tied.has(match.home.key) || !tied.has(match.away.key)) return;

      table[match.home.key].pts += match.home.puntos;
      table[match.home.key].tr += match.home.puntosExtra;
      table[match.away.key].pts += match.away.puntos;
      table[match.away.key].tr += match.away.puntosExtra;
    });

    return table;
  }

  function getGroupsForCategory(category) {
    return category === 'segunda' ? ['A', 'B'] : ['A', 'B', 'C', 'D'];
  }

  function computeStandings(category, ida, vuelta) {
    const groups = getGroupsForCategory(category);
    const entries = collectFixtureEntries(ida, vuelta);
    const stats = Object.fromEntries(groups.map(g => [g, Object.create(null)]));

    iterateGroupMatches(entries, match => {
      if (!groups.includes(match.group)) return;

      [match.home, match.away].forEach(team => {
        if (!stats[match.group][team.key]) {
          stats[match.group][team.key] = {
            key: team.key,
            equipo: team.team,
            pts: 0,
            tr: 0,
            ju: 0
          };
        }
      });

      const played = (
        match.home.puntos > 0 ||
        match.away.puntos > 0 ||
        match.home.puntosExtra > 0 ||
        match.away.puntosExtra > 0
      );

      stats[match.group][match.home.key].pts += match.home.puntos;
      stats[match.group][match.home.key].tr += match.home.puntosExtra;
      stats[match.group][match.away.key].pts += match.away.puntos;
      stats[match.group][match.away.key].tr += match.away.puntosExtra;

      if (played) {
        stats[match.group][match.home.key].ju += 1;
        stats[match.group][match.away.key].ju += 1;
      }
    });

    const result = {};

    groups.forEach(group => {
      const rows = Object.values(stats[group]);
      const buckets = new Map();

      rows.forEach(row => {
        const bucketKey = `${row.pts}|${row.tr}`;
        if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
        buckets.get(bucketKey).push(row);
      });

      const bucketKeys = Array.from(buckets.keys()).sort((a, b) => {
        const [ap, at] = a.split('|').map(Number);
        const [bp, bt] = b.split('|').map(Number);
        return (bp - ap) || (bt - at);
      });

      const ordered = [];

      bucketKeys.forEach(bucketKey => {
        const bucket = buckets.get(bucketKey);
        if (bucket.length <= 1) {
          ordered.push(...bucket);
          return;
        }

        const tiedKeys = bucket.map(row => row.key);
        const h2h = computeHeadToHead(group, tiedKeys, entries);

        bucket.sort((a, b) => {
          const hA = h2h[a.key] || { pts: 0, tr: 0 };
          const hB = h2h[b.key] || { pts: 0, tr: 0 };
          return (hB.pts - hA.pts) ||
                 (hB.tr - hA.tr) ||
                 String(a.equipo).localeCompare(String(b.equipo), 'es', { sensitivity: 'base' });
        });

        ordered.push(...bucket);
      });

      result[group] = ordered.map((row, idx) => ({
        ...row,
        pos: idx + 1
      }));
    });

    return result;
  }

  function flattenStandings(standings) {
    const flat = {};
    Object.values(standings || {}).forEach(rows => {
      (rows || []).forEach(row => {
        const key = normalizeTeam(row?.equipo || row?.team || '');
        if (!key) return;
        flat[key] = {
          equipo: row.equipo || row.team || '',
          pts: Number(row.pts || 0),
          tr: Number(row.tr || 0),
          pos: Number(row.pos || 0)
        };
      });
    });
    return flat;
  }

  function collectQuarterStats(data) {
    const stats = {};
    ['q1', 'q2', 'q3', 'q4'].forEach(roundId => {
      const round = getRound(data, roundId);
      const legs = Array.isArray(round?.legs) ? round.legs.slice(0, 2) : [];
      legs.forEach(leg => {
        [
          { team: leg?.home?.team, pts: leg?.home?.puntos, tr: leg?.home?.puntosExtra },
          { team: leg?.away?.team, pts: leg?.away?.puntos, tr: leg?.away?.puntosExtra }
        ].forEach(item => {
          const key = normalizeTeam(item.team || '');
          if (!key || key === 'WO') return;
          if (!stats[key]) stats[key] = { pts: 0, tr: 0 };
          stats[key].pts += Number(item.pts || 0);
          stats[key].tr += Number(item.tr || 0);
        });
      });
    });
    return stats;
  }

  function stableTieSeed(value) {
    const text = normalizeTeam(value || '');
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function compareSportingAdvantage(teamA, teamB, data, standings) {
    const a = cleanTeamName(teamA) || 'WO';
    const b = cleanTeamName(teamB) || 'WO';
    if (!isRealTeam(a) || !isRealTeam(b)) return [a, b];

    const aKey = normalizeTeam(a);
    const bKey = normalizeTeam(b);
    const standingStats = flattenStandings(standings || {});
    const quarterStats = collectQuarterStats(data);
    const sA = standingStats[aKey] || { pts: 0, tr: 0 };
    const sB = standingStats[bKey] || { pts: 0, tr: 0 };
    const qA = quarterStats[aKey] || { pts: 0, tr: 0 };
    const qB = quarterStats[bKey] || { pts: 0, tr: 0 };

    const checks = [
      [Number(sA.pts || 0), Number(sB.pts || 0)],
      [Number(sA.tr || 0), Number(sB.tr || 0)],
      [Number(qA.pts || 0), Number(qB.pts || 0)],
      [Number(qA.tr || 0), Number(qB.tr || 0)]
    ];

    for (const [va, vb] of checks) {
      if (va > vb) return [a, b];
      if (vb > va) return [b, a];
    }

    return stableTieSeed(a) <= stableTieSeed(b) ? [a, b] : [b, a];
  }

  function applyAutomaticAdvance(data, category, standings) {
    if (!data || !Array.isArray(data.rounds)) return data;

    if (category === 'tercera') {
      const q1 = seriesWinner(getRound(data, 'q1'));
      const q2 = seriesWinner(getRound(data, 'q2'));
      const q3 = seriesWinner(getRound(data, 'q3'));
      const q4 = seriesWinner(getRound(data, 'q4'));

      const [s1Best, s1Other] = compareSportingAdvantage(q1.winner, q2.winner, data, standings);
      const [s2Best, s2Other] = compareSportingAdvantage(q3.winner, q4.winner, data, standings);

      setSeriesTeams(getRound(data, 's1'), s1Best, s1Other);
      setSeriesTeams(getRound(data, 's2'), s2Best, s2Other);
    }

    const s1 = seriesWinner(getRound(data, 's1'));
    const s2 = seriesWinner(getRound(data, 's2'));

    setSeriesTeams(getRound(data, 'final'), s1.winner, s2.winner);
    setSeriesTeams(getRound(data, 'third'), s1.loser, s2.loser);

    return data;
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

      const rawData = result.rows[0]?.data || null;
      const data = rawData ? JSON.parse(JSON.stringify(rawData)) : null;

      // El frontend arma semifinales/final dinámicamente a partir de cuartos.
      // Para que /proximo-cruce vea lo mismo que la pantalla de llaves,
      // recalculamos el avance en memoria antes de buscar el partido.
      if (data && Array.isArray(data.rounds)) {
        const [ida, vuelta] = await Promise.all([
          fetchFixtureData('ida', category),
          fetchFixtureData('vuelta', category)
        ]);
        const standings = computeStandings(category, ida, vuelta);
        applyAutomaticAdvance(data, category, standings);
      }

      const rounds = Array.isArray(data?.rounds) ? data.rounds : [];

      const candidates = [];

      rounds.forEach((round, roundIndex) => {
        const legs = Array.isArray(round?.legs) ? round.legs : [];

        legs.forEach((leg, legIndex) => {
          // El desempate (leg 2) no se abre como planilla completa;
          // se gestiona desde el bloque DESEMPATE en cruces_fecha.
          if (legIndex >= 2) return;
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
