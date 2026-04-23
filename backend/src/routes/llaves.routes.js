
const express = require('express');
const pool = require('../../db');
const { requireAdmin } = require('../middleware/auth');

module.exports = function createLlavesRouter() {
  const router = express.Router();

  const CATEGORY_CONFIG = {
    tercera: { groups: ['A', 'B', 'C', 'D'], extraTrianglesTarget: 5 },
    segunda: { groups: ['A', 'B'], extraTrianglesTarget: 6 }
  };

  const DEFAULT_SERIES = {
    tercera: [
      { phase: 'cuartos', slot: 1, label: 'Cuarto 1', source_home: 'group:A:1', source_away: 'group:B:2' },
      { phase: 'cuartos', slot: 2, label: 'Cuarto 2', source_home: 'group:C:1', source_away: 'group:D:2' },
      { phase: 'cuartos', slot: 3, label: 'Cuarto 3', source_home: 'group:B:1', source_away: 'group:A:2' },
      { phase: 'cuartos', slot: 4, label: 'Cuarto 4', source_home: 'group:D:1', source_away: 'group:C:2' },
      { phase: 'semi', slot: 1, label: 'Semifinal 1', source_home: 'winner:cuartos:1', source_away: 'winner:cuartos:2' },
      { phase: 'semi', slot: 2, label: 'Semifinal 2', source_home: 'winner:cuartos:3', source_away: 'winner:cuartos:4' },
      { phase: 'final', slot: 1, label: 'Final', source_home: 'winner:semi:1', source_away: 'winner:semi:2' },
      { phase: 'tercer_puesto', slot: 1, label: '3er y 4to puesto', source_home: 'loser:semi:1', source_away: 'loser:semi:2' }
    ],
    segunda: [
      { phase: 'semi', slot: 1, label: 'Semifinal 1', source_home: 'group:A:1', source_away: 'group:B:2' },
      { phase: 'semi', slot: 2, label: 'Semifinal 2', source_home: 'group:B:1', source_away: 'group:A:2' },
      { phase: 'final', slot: 1, label: 'Final', source_home: 'winner:semi:1', source_away: 'winner:semi:2' },
      { phase: 'tercer_puesto', slot: 1, label: '3er y 4to puesto', source_home: 'loser:semi:1', source_away: 'loser:semi:2' }
    ]
  };

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' Y ')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function parseIntSafe(value) {
    const n = parseInt(value ?? 0, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function isValidCategory(category) {
    return Object.prototype.hasOwnProperty.call(CATEGORY_CONFIG, category);
  }

  async function getTeamCatalog(category) {
    const result = await pool.query(
      `SELECT id, slug_uid, slug_base, display_name, username
         FROM equipos
        WHERE division = $1
        ORDER BY display_name ASC, username ASC, id ASC`,
      [category]
    );
    return result.rows.map(row => ({
      id: row.id,
      slug: row.slug_uid || row.slug_base,
      slugBase: row.slug_base,
      displayName: row.display_name || row.username || row.slug_base || row.slug_uid
    }));
  }

  async function ensureLlavesTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS llaves_series (
        id SERIAL PRIMARY KEY,
        category TEXT NOT NULL,
        phase TEXT NOT NULL,
        slot INTEGER NOT NULL,
        label TEXT NOT NULL,
        source_home TEXT,
        source_away TEXT,
        manual_home_team TEXT,
        manual_away_team TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(category, phase, slot)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS llaves_matches (
        id SERIAL PRIMARY KEY,
        series_id INTEGER NOT NULL REFERENCES llaves_series(id) ON DELETE CASCADE,
        leg TEXT NOT NULL,
        match_order INTEGER NOT NULL DEFAULT 1,
        date TEXT,
        home_points INTEGER NOT NULL DEFAULT 0,
        away_points INTEGER NOT NULL DEFAULT 0,
        home_triangles INTEGER NOT NULL DEFAULT 0,
        away_triangles INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(series_id, leg)
      );
    `);
  }

  async function ensureDefaults(category) {
    await ensureLlavesTables();
    const defs = DEFAULT_SERIES[category] || [];
    for (const item of defs) {
      await pool.query(
        `INSERT INTO llaves_series
           (category, phase, slot, label, source_home, source_away, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
         ON CONFLICT (category, phase, slot)
         DO UPDATE SET
           label = EXCLUDED.label,
           source_home = EXCLUDED.source_home,
           source_away = EXCLUDED.source_away,
           updated_at = NOW()`,
        [category, item.phase, item.slot, item.label, item.source_home, item.source_away]
      );
    }

    const seriesRes = await pool.query(`SELECT id, phase FROM llaves_series WHERE category = $1`, [category]);
    for (const row of seriesRes.rows) {
      const legs = ['final', 'tercer_puesto'].includes(row.phase) ? ['final'] : ['ida', 'vuelta'];
      for (const leg of legs) {
        await pool.query(
          `INSERT INTO llaves_matches (series_id, leg, match_order, updated_at)
           VALUES ($1,$2,$3,NOW())
           ON CONFLICT (series_id, leg)
           DO NOTHING`,
          [row.id, leg, leg === 'ida' ? 1 : leg === 'vuelta' ? 2 : 1]
        );
      }
    }
  }

  async function getFixtureData(kind, category) {
    const result = await pool.query(`SELECT data FROM fixtures WHERE kind = $1 AND category = $2 LIMIT 1`, [kind, category]);
    return result.rows[0]?.data || null;
  }

  function normalizeNameTercera(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
  }

  function normalizeNameSegunda(s) {
    const raw = String(s || '').trim().replace(/\s+/g, ' ');
    if (!raw) return '';
    const upper = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const aliases = {
      'ANEXO': 'ANEXO 2DA',
      'ANEXO 2DA': 'ANEXO 2DA',
      'ANEXO 2DA.': 'ANEXO 2DA',
      'ANEXO 2DA ': 'ANEXO 2DA'
    };
    return aliases[raw] || aliases[upper] || upper;
  }

  function collectStandingsEntries(feeds) {
    const entries = [];
    (feeds || []).forEach(feed => {
      if (!feed) return;
      const kind = String(feed.kind || '').toLowerCase();
      (feed?.fechas || []).forEach((fecha, idx) => entries.push({ kind, fechaIndex: idx + 1, fecha }));
    });
    return entries;
  }

  function computeStandingsFromFixtures(category, ida, vuelta) {
    const groups = CATEGORY_CONFIG[category].groups;
    const normalizeName = category === 'segunda' ? normalizeNameSegunda : normalizeNameTercera;
    const entries = [
      ...collectStandingsEntries(ida ? [{ ...ida, kind: 'ida' }] : []),
      ...collectStandingsEntries(vuelta ? [{ ...vuelta, kind: 'vuelta' }] : [])
    ];

    const puntos = Object.fromEntries(groups.map(g => [g, Object.create(null)]));
    const ju = Object.fromEntries(groups.map(g => [g, Object.create(null)]));
    const tr = Object.fromEntries(groups.map(g => [g, Object.create(null)]));
    const seen = Object.fromEntries(groups.map(g => [g, new Map()]));

    for (const entry of entries) {
      const fecha = entry?.fecha;
      for (const tabla of (fecha?.tablas || [])) {
        const g = String(tabla?.grupo || '').toUpperCase();
        if (!groups.includes(g)) continue;
        const equipos = (tabla?.equipos || []).map(e => ({
          equipo: e?.equipo || '',
          puntos: parseIntSafe(e?.puntos),
          puntosExtra: parseIntSafe(e?.puntosExtra)
        }));

        for (const item of equipos) {
          const key = normalizeName(item.equipo);
          if (!key || key === 'WO') continue;
          if (!puntos[g][key]) puntos[g][key] = { equipo: category === 'segunda' ? key : item.equipo, pts: 0 };
          puntos[g][key].pts += item.puntos;
          tr[g][key] = (tr[g][key] || 0) + item.puntosExtra;
          if (!seen[g].has(key)) seen[g].set(key, item.equipo);
        }

        for (let i = 0; i < equipos.length; i += 2) {
          const A = equipos[i];
          const B = equipos[i + 1];
          if (!A || !B) continue;
          const aK = normalizeName(A.equipo);
          const bK = normalizeName(B.equipo);
          if (!aK || !bK || aK === 'WO' || bK === 'WO') continue;
          if (A.puntos === 0 && B.puntos === 0 && A.puntosExtra === 0 && B.puntosExtra === 0) continue;
          ju[g][aK] = (ju[g][aK] || 0) + 1;
          ju[g][bK] = (ju[g][bK] || 0) + 1;
        }
      }
    }

    const result = {};
    for (const g of groups) {
      result[g] = Array.from(seen[g].entries()).map(([key, display]) => ({
        key,
        equipo: puntos[g][key]?.equipo || display,
        pts: puntos[g][key]?.pts || 0,
        ju: ju[g][key] || 0,
        tr: tr[g][key] || 0
      }))
      .sort((a, b) => (b.pts - a.pts) || (b.tr - a.tr) || String(a.equipo).localeCompare(String(b.equipo)))
      .map((row, idx) => ({ ...row, pos: idx + 1, group: g }));
    }
    return result;
  }

  async function getStandings(category) {
    const [ida, vuelta] = await Promise.all([getFixtureData('ida', category), getFixtureData('vuelta', category)]);
    return computeStandingsFromFixtures(category, ida, vuelta);
  }

  function entrantsFromStandings(standings) {
    const entrants = {};
    for (const [group, rows] of Object.entries(standings || {})) {
      const list = Array.isArray(rows) ? rows : [];
      entrants[`group:${group}:1`] = list.find(r => r.pos === 1)?.equipo || '';
      entrants[`group:${group}:2`] = list.find(r => r.pos === 2)?.equipo || '';
    }
    return entrants;
  }

  function buildMatchesBySeries(rows) {
    const out = new Map();
    for (const row of rows) {
      if (!out.has(row.series_id)) out.set(row.series_id, {});
      out.get(row.series_id)[row.leg] = {
        id: row.id,
        leg: row.leg,
        date: row.date || '',
        home_points: parseIntSafe(row.home_points),
        away_points: parseIntSafe(row.away_points),
        home_triangles: parseIntSafe(row.home_triangles),
        away_triangles: parseIntSafe(row.away_triangles)
      };
    }
    return out;
  }

  function hasPayload(match) {
    if (!match) return false;
    return [match.home_points, match.away_points, match.home_triangles, match.away_triangles].some(v => parseIntSafe(v) > 0) ||
      String(match.date || '').trim() !== '';
  }

  function decideSingle(homeTeam, awayTeam, match) {
    if (!match || !homeTeam || !awayTeam) return { winner: '', loser: '', requiresExtra: false };
    if (match.home_points > match.away_points) return { winner: homeTeam, loser: awayTeam, requiresExtra: false };
    if (match.away_points > match.home_points) return { winner: awayTeam, loser: homeTeam, requiresExtra: false };
    if (match.home_triangles > match.away_triangles) return { winner: homeTeam, loser: awayTeam, requiresExtra: false };
    if (match.away_triangles > match.home_triangles) return { winner: awayTeam, loser: homeTeam, requiresExtra: false };
    return { winner: '', loser: '', requiresExtra: false };
  }

  function decideSeries(homeTeam, awayTeam, matches) {
    if (!homeTeam || !awayTeam) return { winner: '', loser: '', requiresExtra: false };
    if (matches?.final && !matches?.ida && !matches?.vuelta) {
      return decideSingle(homeTeam, awayTeam, matches.final);
    }

    const ida = matches?.ida || null;
    const vuelta = matches?.vuelta || null;
    const extra = matches?.extra || null;

    const homePoints = parseIntSafe(ida?.home_points) + parseIntSafe(vuelta?.away_points);
    const awayPoints = parseIntSafe(ida?.away_points) + parseIntSafe(vuelta?.home_points);
    const homeTriangles = parseIntSafe(ida?.home_triangles) + parseIntSafe(vuelta?.away_triangles);
    const awayTriangles = parseIntSafe(ida?.away_triangles) + parseIntSafe(vuelta?.home_triangles);

    if (homePoints > awayPoints) return { winner: homeTeam, loser: awayTeam, requiresExtra: false };
    if (awayPoints > homePoints) return { winner: awayTeam, loser: homeTeam, requiresExtra: false };
    if (homeTriangles > awayTriangles) return { winner: homeTeam, loser: awayTeam, requiresExtra: false };
    if (awayTriangles > homeTriangles) return { winner: awayTeam, loser: homeTeam, requiresExtra: false };

    if (hasPayload(extra)) {
      if (extra.home_points > extra.away_points) return { winner: homeTeam, loser: awayTeam, requiresExtra: false };
      if (extra.away_points > extra.home_points) return { winner: awayTeam, loser: homeTeam, requiresExtra: false };
    }

    return { winner: '', loser: '', requiresExtra: hasPayload(ida) && hasPayload(vuelta) };
  }

  async function buildState(category) {
    await ensureDefaults(category);

    const [seriesRes, matchesRes, standings, options] = await Promise.all([
      pool.query(
        `SELECT *
           FROM llaves_series
          WHERE category = $1
          ORDER BY CASE phase WHEN 'cuartos' THEN 1 WHEN 'semi' THEN 2 WHEN 'final' THEN 3 WHEN 'tercer_puesto' THEN 4 ELSE 9 END,
                   slot ASC`,
        [category]
      ),
      pool.query(
        `SELECT m.*, s.phase, s.slot
           FROM llaves_matches m
           JOIN llaves_series s ON s.id = m.series_id
          WHERE s.category = $1
          ORDER BY s.phase ASC, s.slot ASC, m.match_order ASC, m.id ASC`,
        [category]
      ),
      getStandings(category),
      getTeamCatalog(category)
    ]);

    const entrants = entrantsFromStandings(standings);
    const matchesBySeries = buildMatchesBySeries(matchesRes.rows);
    const baseSeries = seriesRes.rows.map(row => ({ ...row, matches: matchesBySeries.get(row.id) || {} }));
    const byKey = new Map(baseSeries.map(row => [`${row.phase}:${row.slot}`, row]));
    const memo = new Map();

    const resolveToken = (token) => {
      const raw = String(token || '').trim();
      if (!raw) return '';
      if (raw.startsWith('group:')) return entrants[raw] || '';
      const [kind, phase, slot] = raw.split(':');
      if (kind === 'winner' || kind === 'loser') {
        const resolved = resolveSeries(byKey.get(`${phase}:${slot}`));
        return kind === 'winner' ? (resolved?.winner || '') : (resolved?.loser || '');
      }
      return raw;
    };

    function resolveSeries(series) {
      if (!series) return { homeTeam: '', awayTeam: '', winner: '', loser: '', requiresExtra: false };
      const key = `${series.phase}:${series.slot}`;
      if (memo.has(key)) return memo.get(key);
      const homeTeam = String(series.manual_home_team || '').trim() || resolveToken(series.source_home);
      const awayTeam = String(series.manual_away_team || '').trim() || resolveToken(series.source_away);
      const outcome = decideSeries(homeTeam, awayTeam, series.matches);
      const resolved = { ...series, homeTeam, awayTeam, winner: outcome.winner, loser: outcome.loser, requiresExtra: outcome.requiresExtra };
      memo.set(key, resolved);
      return resolved;
    }

    const series = baseSeries.map(resolveSeries);
    return { ok: true, category, config: CATEGORY_CONFIG[category], standings, entrants, options, series };
  }

  function serialize(state) {
    return {
      ok: true,
      category: state.category,
      config: state.config,
      standings: state.standings,
      entrants: state.entrants,
      options: state.options,
      series: state.series.map(item => ({
        id: item.id,
        phase: item.phase,
        slot: item.slot,
        label: item.label,
        source_home: item.source_home,
        source_away: item.source_away,
        manual_home_team: item.manual_home_team || '',
        manual_away_team: item.manual_away_team || '',
        homeTeam: item.homeTeam || '',
        awayTeam: item.awayTeam || '',
        winner: item.winner || '',
        loser: item.loser || '',
        requiresExtra: !!item.requiresExtra,
        matches: item.matches || {}
      }))
    };
  }

  router.get('/llaves', async (req, res) => {
    try {
      const category = String(req.query.category || '').trim().toLowerCase();
      if (!isValidCategory(category)) return res.status(400).json({ ok: false, error: 'category inválida' });
      const state = await buildState(category);
      res.set('Cache-Control', 'no-store');
      res.json(serialize(state));
    } catch (err) {
      console.error('GET /api/llaves', err);
      res.status(500).json({ ok: false, error: 'Error leyendo llaves' });
    }
  });

  router.post('/llaves/manual-team', requireAdmin, async (req, res) => {
    try {
      const category = String(req.body?.category || '').trim().toLowerCase();
      const phase = String(req.body?.phase || '').trim().toLowerCase();
      const slot = parseIntSafe(req.body?.slot);
      const side = String(req.body?.side || '').trim().toLowerCase();
      const team = String(req.body?.team || '').trim();
      if (!isValidCategory(category) || !phase || !slot || !['home', 'away'].includes(side)) {
        return res.status(400).json({ ok: false, error: 'payload inválido' });
      }
      await ensureDefaults(category);
      const field = side === 'home' ? 'manual_home_team' : 'manual_away_team';
      const result = await pool.query(
        `UPDATE llaves_series SET ${field} = $1, updated_at = NOW() WHERE category = $2 AND phase = $3 AND slot = $4 RETURNING id`,
        [team || null, category, phase, slot]
      );
      if (!result.rowCount) return res.status(404).json({ ok: false, error: 'serie inexistente' });
      const state = await buildState(category);
      res.json(serialize(state));
    } catch (err) {
      console.error('POST /api/llaves/manual-team', err);
      res.status(500).json({ ok: false, error: 'No se pudo guardar el equipo' });
    }
  });

  router.post('/llaves/match', requireAdmin, async (req, res) => {
    try {
      const category = String(req.body?.category || '').trim().toLowerCase();
      const phase = String(req.body?.phase || '').trim().toLowerCase();
      const slot = parseIntSafe(req.body?.slot);
      const leg = String(req.body?.leg || '').trim().toLowerCase();
      if (!isValidCategory(category) || !phase || !slot || !leg) {
        return res.status(400).json({ ok: false, error: 'payload inválido' });
      }
      await ensureDefaults(category);
      const seriesRes = await pool.query(`SELECT id FROM llaves_series WHERE category = $1 AND phase = $2 AND slot = $3 LIMIT 1`, [category, phase, slot]);
      const seriesId = seriesRes.rows[0]?.id;
      if (!seriesId) return res.status(404).json({ ok: false, error: 'serie inexistente' });
      await pool.query(
        `INSERT INTO llaves_matches (series_id, leg, match_order, date, home_points, away_points, home_triangles, away_triangles, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (series_id, leg)
         DO UPDATE SET
           date = EXCLUDED.date,
           home_points = EXCLUDED.home_points,
           away_points = EXCLUDED.away_points,
           home_triangles = EXCLUDED.home_triangles,
           away_triangles = EXCLUDED.away_triangles,
           updated_at = NOW()`,
        [
          seriesId,
          leg,
          leg === 'ida' ? 1 : leg === 'vuelta' ? 2 : 3,
          String(req.body?.date || '').trim() || null,
          parseIntSafe(req.body?.home_points),
          parseIntSafe(req.body?.away_points),
          parseIntSafe(req.body?.home_triangles),
          parseIntSafe(req.body?.away_triangles)
        ]
      );
      const state = await buildState(category);
      res.json(serialize(state));
    } catch (err) {
      console.error('POST /api/llaves/match', err);
      res.status(500).json({ ok: false, error: 'No se pudo guardar el partido' });
    }
  });

  router.get('/llaves/proximo-cruce', async (req, res) => {
    try {
      const category = String(req.query.category || '').trim().toLowerCase();
      const teamRaw = String(req.query.team || '').trim();
      if (!isValidCategory(category) || !teamRaw) return res.status(400).json({ ok: false, error: 'params inválidos' });
      const state = await buildState(category);
      const needle = normalizeText(teamRaw);
      function toISO(raw) {
        const value = String(raw || '').trim();
        const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        const dmy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      const candidates = [];
      for (const series of state.series) {
        if (![normalizeText(series.homeTeam), normalizeText(series.awayTeam)].includes(needle)) continue;
        for (const match of Object.values(series.matches || {})) {
          if (!match) continue;
          const date = toISO(match.date);
          if (!date) continue;
          let local = series.homeTeam;
          let visitante = series.awayTeam;
          if (match.leg === 'vuelta') {
            local = series.awayTeam;
            visitante = series.homeTeam;
          }
          candidates.push({ phase: series.phase, slot: series.slot, leg: match.leg, local, visitante, date, source: 'llaves' });
        }
      }
      candidates.sort((a, b) => a.date.localeCompare(b.date));
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const chosen = candidates.find(item => item.date >= todayKey) || candidates[candidates.length - 1] || null;
      res.json({ ok: true, match: chosen });
    } catch (err) {
      console.error('GET /api/llaves/proximo-cruce', err);
      res.status(500).json({ ok: false, error: 'No se pudo buscar el cruce' });
    }
  });

  return router;
};
