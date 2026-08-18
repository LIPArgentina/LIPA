const path = require('path');
const fs = require('fs');

const WRITE = process.argv.includes('--write');
const EXPORT_UNRESOLVED = process.argv.includes('--export-unresolved');
const CATEGORY_FILTER = readArg('--category');
const APPEND_SINCE = readArg('--append-since');
const EDITION_OVERRIDE = Number(readArg('--edition')) || null;
const OVERRIDES = loadOverrides();

function readArg(name) {
  const prefix = `${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? String(item.slice(prefix.length)).trim().toLowerCase() : '';
}

function normalizeText(value = '') {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeSlug(value = '') {
  return String(value || '').trim().toLowerCase();
}

function loadOverrides() {
  const filePath = path.join(__dirname, 'player_resolution_overrides.json');
  if (!fs.existsSync(filePath)) {
    return { flexibleNames: [], aliases: [], exclude: [] };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function overrideKey(category = '', team = '', name = '') {
  return `${String(category || '').trim().toLowerCase()}::${normalizeSlug(team)}::${normalizeText(name)}`;
}

function makeOverrideIndexes(overrides = {}) {
  const flexibleNames = new Set((overrides.flexibleNames || []).map((name) => normalizeText(name)));
  const aliases = new Map();
  const exclude = new Map();

  for (const item of overrides.aliases || []) {
    aliases.set(overrideKey(item.category, item.team, item.fromName), item);
  }

  for (const item of overrides.exclude || []) {
    exclude.set(overrideKey(item.category, item.team, item.name), item);
  }

  return { flexibleNames, aliases, exclude };
}

function valuesEqual(a, b) {
  return normalizeText(a) === normalizeText(b);
}

function arrayDiffs(side, section, a = [], b = []) {
  const max = Math.max(a.length, b.length);
  const diffs = [];
  for (let i = 0; i < max; i++) {
    if (!valuesEqual(a[i], b[i])) {
      diffs.push({ type: 'slot', side, section, index: i });
    }
  }
  return diffs;
}

function scoreDiffs(side, arrA = [], arrB = []) {
  const max = Math.max(arrA.length, arrB.length);
  const diffs = [];
  for (let i = 0; i < max; i++) {
    const a = Number(arrA[i] ?? 0);
    const b = Number(arrB[i] ?? 0);
    if (a !== b) {
      diffs.push({ type: 'score', side, scoreIndex: i });
    }
  }
  return diffs;
}

function compareFullStatus(mine = {}, rival = {}) {
  const diffs = [];
  const localA = mine?.localPlanilla || {};
  const localB = rival?.localPlanilla || {};
  const visA = mine?.visitantePlanilla || {};
  const visB = rival?.visitantePlanilla || {};

  diffs.push(...arrayDiffs('local', 'CAPITAN', localA.capitan, localB.capitan));
  diffs.push(...arrayDiffs('local', 'INDIVIDUALES', localA.individuales, localB.individuales));
  diffs.push(...arrayDiffs('local', 'PAREJA 1', localA.pareja1, localB.pareja1));
  diffs.push(...arrayDiffs('local', 'PAREJA 2', localA.pareja2, localB.pareja2));
  diffs.push(...arrayDiffs('local', 'SUPLENTES', localA.suplentes, localB.suplentes));

  diffs.push(...arrayDiffs('visitante', 'CAPITAN', visA.capitan, visB.capitan));
  diffs.push(...arrayDiffs('visitante', 'INDIVIDUALES', visA.individuales, visB.individuales));
  diffs.push(...arrayDiffs('visitante', 'PAREJA 1', visA.pareja1, visB.pareja1));
  diffs.push(...arrayDiffs('visitante', 'PAREJA 2', visA.pareja2, visB.pareja2));
  diffs.push(...arrayDiffs('visitante', 'SUPLENTES', visA.suplentes, visB.suplentes));

  const localScoreA = Array.isArray(mine?.local?.scoreRows) ? mine.local.scoreRows : [];
  const localScoreB = Array.isArray(rival?.local?.scoreRows) ? rival.local.scoreRows : [];
  const visScoreA = Array.isArray(mine?.visitante?.scoreRows) ? mine.visitante.scoreRows : [];
  const visScoreB = Array.isArray(rival?.visitante?.scoreRows) ? rival.visitante.scoreRows : [];

  diffs.push(...scoreDiffs('local', localScoreA, localScoreB));
  diffs.push(...scoreDiffs('visitante', visScoreA, visScoreB));

  const localTriA = Number(mine?.local?.triangulosTotales ?? mine?.local?.triangulos ?? 0);
  const localTriB = Number(rival?.local?.triangulosTotales ?? rival?.local?.triangulos ?? 0);
  const localPtsA = Number(mine?.local?.puntosTotales ?? 0);
  const localPtsB = Number(rival?.local?.puntosTotales ?? 0);
  const visTriA = Number(mine?.visitante?.triangulosTotales ?? mine?.visitante?.triangulos ?? 0);
  const visTriB = Number(rival?.visitante?.triangulosTotales ?? rival?.visitante?.triangulos ?? 0);
  const visPtsA = Number(mine?.visitante?.puntosTotales ?? 0);
  const visPtsB = Number(rival?.visitante?.puntosTotales ?? 0);

  if (localTriA !== localTriB) diffs.push({ type: 'total', side: 'local', metric: 'triangulos' });
  if (localPtsA !== localPtsB) diffs.push({ type: 'total', side: 'local', metric: 'puntos' });
  if (visTriA !== visTriB) diffs.push({ type: 'total', side: 'visitante', metric: 'triangulos' });
  if (visPtsA !== visPtsB) diffs.push({ type: 'total', side: 'visitante', metric: 'puntos' });

  return diffs;
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS jugador_resultados (
      id BIGSERIAL PRIMARY KEY,
      fecha_key TEXT NOT NULL,
      fecha_iso DATE NOT NULL,
      edicion INTEGER NOT NULL DEFAULT 5,
      categoria TEXT,
      jugador_id INTEGER REFERENCES jugadores(id) ON DELETE SET NULL,
      jugador_key TEXT NOT NULL,
      jugador_nombre TEXT NOT NULL,
      equipo_slug TEXT NOT NULL,
      equipo_nombre TEXT,
      rival_slug TEXT NOT NULL,
      rival_nombre TEXT,
      modalidad TEXT NOT NULL,
      slot INTEGER NOT NULL,
      pareja_index INTEGER,
      triangulos_favor INTEGER NOT NULL DEFAULT 0,
      triangulos_contra INTEGER NOT NULL DEFAULT 0,
      resultado TEXT NOT NULL,
      source_updated_at TIMESTAMPTZ,
      snapshot_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (fecha_key, equipo_slug, modalidad, slot, jugador_key)
    )
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_jugador_resultados_jugador_id ON jugador_resultados (jugador_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_jugador_resultados_categoria ON jugador_resultados (categoria)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_jugador_resultados_equipo ON jugador_resultados (equipo_slug)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_jugador_resultados_edicion ON jugador_resultados (edicion)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_jugador_resultados_categoria_edicion ON jugador_resultados (categoria, edicion)`);
}

async function loadTeams(client) {
  const { rows } = await client.query(`
    SELECT
      id,
      slug_uid,
      slug_base,
      username,
      COALESCE(display_name, username, slug_uid, slug_base) AS name,
      LOWER(COALESCE(division, '')) AS category
    FROM equipos
  `);

  const bySlug = new Map();
  for (const row of rows) {
    const keys = [
      row.slug_uid,
      row.slug_base,
      row.username,
      normalizeSlug(row.slug),
      normalizeSlug(row.slug_uid),
      normalizeSlug(row.slug_base),
      normalizeSlug(row.username),
      normalizeSlug(row.name)
    ].filter(Boolean);
    for (const key of keys) {
      if (!bySlug.has(key)) bySlug.set(key, row);
    }
  }
  return bySlug;
}

async function loadPlayers(client) {
  const { rows } = await client.query(`
    SELECT
      j.id,
      TRIM(j.nombre) AS name,
      LOWER(COALESCE(je.categoria, e.division, '')) AS category,
      e.slug_uid,
      e.slug_base,
      e.username,
      COALESCE(e.slug_uid, e.slug_base, e.username, e.display_name) AS team_slug,
      COALESCE(e.display_name, e.username, e.slug_uid, e.slug_base) AS team_name,
      je.activo
    FROM jugadores j
    LEFT JOIN jugador_equipos je ON je.jugador_id = j.id
    LEFT JOIN equipos e ON e.id = COALESCE(je.equipo_id, j.equipo_id)
    WHERE TRIM(COALESCE(j.nombre, '')) <> ''
  `);

  const byKey = new Map();
  const byTeamName = new Map();
  const byName = new Map();
  const ambiguous = new Set();
  const ambiguousTeamName = new Set();
  const ambiguousName = new Set();
  const validIds = new Set(rows.map((row) => Number(row.id)).filter((id) => id > 0));

  function putIndexed(map, ambiguousSet, key, row) {
    if (!key) return;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      return;
    }
    if (Number(existing.id) === Number(row.id)) return;

    const existingActive = existing.activo === true;
    const rowActive = row.activo === true;
    if (!existingActive && rowActive) {
      map.set(key, row);
      return;
    }
    if (existingActive && !rowActive) return;

    ambiguousSet.add(key);
  }

  for (const row of rows) {
    const category = String(row.category || '').trim().toLowerCase();
    const teamSlug = normalizeSlug(row.team_slug || row.team_name || '');
    const teamSlugBase = normalizeSlug(row.slug_base || '');
    const teamUsername = normalizeSlug(row.username || '');
    const name = normalizeText(row.name);
    if (!name || !teamSlug) continue;
    const keys = [
      `${category}::${teamSlug}::${name}`,
      `${category}::${teamSlugBase}::${name}`,
      `${category}::${teamUsername}::${name}`,
      `${category}::${normalizeSlug(row.team_name)}::${name}`
    ].filter((key) => !key.includes('::::') && !key.includes('::::'));
    for (const key of keys) {
      if (!key || key.includes('::::')) continue;
      putIndexed(byKey, ambiguous, key, row);
    }

    const teamKeys = [
      `${teamSlug}::${name}`,
      `${teamSlugBase}::${name}`,
      `${teamUsername}::${name}`,
      `${normalizeSlug(row.team_name)}::${name}`
    ].filter((key) => !key.startsWith('::'));
    for (const key of teamKeys) {
      putIndexed(byTeamName, ambiguousTeamName, key, row);
    }

    putIndexed(byName, ambiguousName, name, row);
  }

  for (const key of ambiguous) byKey.delete(key);
  for (const key of ambiguousTeamName) byTeamName.delete(key);
  for (const key of ambiguousName) byName.delete(key);
  return { byKey, byTeamName, byName, ambiguous, ambiguousTeamName, ambiguousName, validIds };
}

function planillaPlayerRef(planilla = {}, section = '', index = 0) {
  const name = String(planilla?.[section]?.[index] || '').trim();
  const rawId = planilla?.jugadorIds?.[section]?.[index];
  const id = Number(rawId);
  return {
    id: Number.isFinite(id) && id > 0 ? id : null,
    name
  };
}

function playerKey(player, category, teamSlug) {
  if (player.id) return `id:${player.id}`;
  return `name:${String(category || '').toLowerCase()}::${normalizeSlug(teamSlug)}::${normalizeText(player.name)}`;
}

function resultLabel(favor, contra) {
  if (favor > contra) return 'ganado';
  if (favor < contra) return 'perdido';
  return 'empatado';
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function exportUnresolvedRows(rows) {
  const outDir = path.join(__dirname, '..', 'exports');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'jugador_resultados_sin_id.csv');
  const seen = new Set();
  const uniqueRows = [];

  for (const row of rows) {
    if (row.jugador_id) continue;
    const key = [
      row.categoria || '',
      row.equipo_slug || '',
      normalizeText(row.jugador_nombre || '')
    ].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push(row);
  }

  uniqueRows.sort((a, b) =>
    String(a.categoria || '').localeCompare(String(b.categoria || ''), 'es') ||
    String(a.equipo_nombre || a.equipo_slug || '').localeCompare(String(b.equipo_nombre || b.equipo_slug || ''), 'es') ||
    String(a.jugador_nombre || '').localeCompare(String(b.jugador_nombre || ''), 'es')
  );

  const csv = [
    'categoria,equipo,jugador',
    ...uniqueRows.map((row) => [
      csvCell(row.categoria),
      csvCell(row.equipo_nombre || row.equipo_slug),
      csvCell(row.jugador_nombre)
    ].join(','))
  ].join('\n');

  fs.writeFileSync(outPath, csv, 'utf8');
  return { path: outPath, total: uniqueRows.length };
}

function findOverride(indexes, category, teamSlug, teamName, name, type) {
  const source = indexes[type];
  if (!source) return null;
  return source.get(overrideKey(category, teamSlug, name)) ||
    source.get(overrideKey(category, teamName, name)) ||
    null;
}

function findTargetPlayer(targetName, category, teamSlug, teamName, playerIndex) {
  const name = normalizeText(targetName);
  const keys = [
    `${category}::${normalizeSlug(teamSlug)}::${name}`,
    `${category}::${normalizeSlug(teamName)}::${name}`
  ];
  for (const key of keys) {
    const found = playerIndex.byKey.get(key);
    if (found?.id) return found;
  }

  const teamKeys = [
    `${normalizeSlug(teamSlug)}::${name}`,
    `${normalizeSlug(teamName)}::${name}`
  ];
  for (const key of teamKeys) {
    const found = playerIndex.byTeamName.get(key);
    if (found?.id) return found;
  }

  return playerIndex.byName.get(name) || null;
}

function resolvePlayerId(player, category, teamSlug, teamName, playerIndex, overrideIndexes) {
  if (player.id && playerIndex.validIds.has(Number(player.id))) {
    return { id: Number(player.id), source: 'snapshot' };
  }

  const name = normalizeText(player.name);
  const alias = findOverride(overrideIndexes, category, teamSlug, teamName, player.name, 'aliases');
  if (alias?.toName) {
    const target = findTargetPlayer(alias.toName, category, teamSlug, teamName, playerIndex);
    if (target?.id) return { id: Number(target.id), source: 'alias', resolvedName: target.name };
  }

  const keys = [
    `${category}::${normalizeSlug(teamSlug)}::${name}`,
    `${category}::${normalizeSlug(teamName)}::${name}`
  ];
  for (const key of keys) {
    const found = playerIndex.byKey.get(key);
    if (found?.id) return { id: Number(found.id), source: 'fallback' };
  }

  const uniqueByName = playerIndex.byName.get(name);
  if (uniqueByName?.id) {
    return { id: Number(uniqueByName.id), source: 'unique-name' };
  }

  if (overrideIndexes.flexibleNames.has(name)) {
    const teamKeys = [
      `${normalizeSlug(teamSlug)}::${name}`,
      `${normalizeSlug(teamName)}::${name}`
    ];
    for (const key of teamKeys) {
      const found = playerIndex.byTeamName.get(key);
      if (found?.id) return { id: Number(found.id), source: 'flexible-team' };
    }

    const foundByName = playerIndex.byName.get(name);
    if (foundByName?.id) return { id: Number(foundByName.id), source: 'flexible-name' };
  }

  return { id: null, source: 'unresolved' };
}

function addRow(rows, ctx, player, opts) {
  const cleanName = String(player?.name || '').trim();
  if (!cleanName) return;

  const excluded = findOverride(ctx.overrideIndexes, ctx.category, opts.teamSlug, opts.teamName, cleanName, 'exclude');
  if (excluded) {
    ctx.stats.excludedRows += 1;
    const key = overrideKey(ctx.category, opts.teamSlug, cleanName);
    if (!ctx.stats.excludedPlayers[key]) {
      ctx.stats.excludedPlayers[key] = {
        categoria: ctx.category,
        jugador: cleanName,
        equipo: opts.teamName || opts.teamSlug,
        reason: excluded.reason || 'excluido'
      };
    }
    return;
  }

  const resolved = resolvePlayerId(player, ctx.category, opts.teamSlug, opts.teamName, ctx.playerIndex, ctx.overrideIndexes);
  const favor = Number(opts.triangulosFavor || 0);
  const contra = Number(opts.triangulosContra || 0);

  rows.push({
    fecha_key: ctx.fechaKey,
    fecha_iso: ctx.fechaISO,
    categoria: ctx.category || null,
    jugador_id: resolved.id,
    jugador_key: playerKey({ ...player, id: resolved.id }, ctx.category, opts.teamSlug),
    jugador_nombre: resolved.resolvedName || cleanName,
    equipo_slug: opts.teamSlug,
    equipo_nombre: opts.teamName,
    rival_slug: opts.rivalSlug,
    rival_nombre: opts.rivalName,
    modalidad: opts.modalidad,
    slot: opts.slot,
    pareja_index: opts.parejaIndex || null,
    triangulos_favor: favor,
    triangulos_contra: contra,
    resultado: resultLabel(favor, contra),
    source_updated_at: ctx.sourceUpdatedAt,
    snapshot_json: ctx.snapshot,
    resolved_source: resolved.source
  });
}

function rowsFromSnapshot(ctx, match) {
  const rows = [];
  const snapshot = match.snapshot || {};
  const localPlanilla = snapshot.localPlanilla || {};
  const visitantePlanilla = snapshot.visitantePlanilla || {};
  const localScores = Array.isArray(snapshot?.local?.scoreRows) ? snapshot.local.scoreRows : [];
  const visitanteScores = Array.isArray(snapshot?.visitante?.scoreRows) ? snapshot.visitante.scoreRows : [];
  const individualCount = Math.max(
    7,
    Array.isArray(localPlanilla?.individuales) ? localPlanilla.individuales.length : 0,
    Array.isArray(visitantePlanilla?.individuales) ? visitantePlanilla.individuales.length : 0,
    Array.isArray(localPlanilla?.jugadorIds?.individuales) ? localPlanilla.jugadorIds.individuales.length : 0,
    Array.isArray(visitantePlanilla?.jugadorIds?.individuales) ? visitantePlanilla.jugadorIds.individuales.length : 0
  );

  const sides = [
    {
      planilla: localPlanilla,
      scoreRows: localScores,
      opponentPlanilla: visitantePlanilla,
      opponentScoreRows: visitanteScores,
      teamSlug: match.localSlug,
      teamName: match.localName,
      rivalSlug: match.visitanteSlug,
      rivalName: match.visitanteName
    },
    {
      planilla: visitantePlanilla,
      scoreRows: visitanteScores,
      opponentPlanilla: localPlanilla,
      opponentScoreRows: localScores,
      teamSlug: match.visitanteSlug,
      teamName: match.visitanteName,
      rivalSlug: match.localSlug,
      rivalName: match.localName
    }
  ];

  for (const side of sides) {
    for (let idx = 0; idx < individualCount; idx++) {
      const player = planillaPlayerRef(side.planilla, 'individuales', idx);
      addRow(rows, ctx, player, {
        teamSlug: side.teamSlug,
        teamName: side.teamName,
        rivalSlug: side.rivalSlug,
        rivalName: side.rivalName,
        modalidad: 'individual',
        slot: idx + 1,
        triangulosFavor: Number(side.scoreRows[idx] ?? 0) || 0,
        triangulosContra: Number(side.opponentScoreRows[idx] ?? 0) || 0
      });
    }

    for (let pairIndex = 0; pairIndex < 2; pairIndex++) {
      const section = pairIndex === 0 ? 'pareja1' : 'pareja2';
      const scoreIndex = individualCount + pairIndex;
      for (let idx = 0; idx < 2; idx++) {
        const player = planillaPlayerRef(side.planilla, section, idx);
        addRow(rows, ctx, player, {
          teamSlug: side.teamSlug,
          teamName: side.teamName,
          rivalSlug: side.rivalSlug,
          rivalName: side.rivalName,
          modalidad: 'pareja',
          slot: pairIndex + 1,
          parejaIndex: pairIndex + 1,
          triangulosFavor: Number(side.scoreRows[scoreIndex] ?? 0) || 0,
          triangulosContra: Number(side.opponentScoreRows[scoreIndex] ?? 0) || 0
        });
      }
    }
  }

  return rows;
}

function teamInfo(teams, slug) {
  const key = normalizeSlug(slug);
  return teams.get(key) || teams.get(slug) || null;
}

function categoryFromSlug(slug = '') {
  const value = normalizeSlug(slug);
  const match = value.match(/_(primera|segunda|tercera)$/);
  return match ? match[1] : '';
}

function inferCategory(localSlug = '', visitanteSlug = '', localInfo = null, visitanteInfo = null) {
  return String(
    localInfo?.category ||
    visitanteInfo?.category ||
    categoryFromSlug(localSlug) ||
    categoryFromSlug(visitanteSlug) ||
    ''
  ).trim().toLowerCase();
}

async function loadEditionStartDates(client) {
  const { rows } = await client.query(`
    SELECT category, edicion, data
    FROM fixtures
    WHERE edicion > 5
    ORDER BY edicion ASC
  `);
  const starts = new Map();
  for (const row of rows) {
    const category = String(row.category || '').trim().toLowerCase();
    const edition = Number(row.edicion || 0);
    const dates = Array.isArray(row?.data?.fechas)
      ? row.data.fechas.map((fecha) => String(fecha?.date || '').slice(0, 10)).filter(Boolean).sort()
      : [];
    if (!category || !edition || !dates.length) continue;
    const current = starts.get(category);
    if (!current || edition > current.edition || (edition === current.edition && dates[0] < current.date)) {
      starts.set(category, { edition, date: dates[0] });
    }
  }
  return starts;
}

function inferRowEdition(row, editionStarts) {
  if (EDITION_OVERRIDE) return EDITION_OVERRIDE;
  const category = String(row?.categoria || '').trim().toLowerCase();
  const date = String(row?.fecha_iso || '').slice(0, 10);
  const current = editionStarts.get(category);
  if (current && date && date >= current.date) return current.edition;
  return 5;
}

async function buildRows(client) {
  const teams = await loadTeams(client);
  const playerIndex = await loadPlayers(client);
  const editionStarts = await loadEditionStartDates(client);
  const overrideIndexes = makeOverrideIndexes(OVERRIDES);
  const { rows: validationRows } = await client.query(`
    SELECT fecha_key, team, status_json, validated, updated_at
    FROM cruces_validations
    ORDER BY fecha_key ASC, updated_at DESC
  `);

  const grouped = new Map();
  for (const row of validationRows) {
    const key = String(row.fecha_key || '');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const out = [];
  const stats = {
    validationRows: validationRows.length,
    matchesSeen: grouped.size,
    validMatches: 0,
    skippedPending: 0,
    skippedMismatch: 0,
    skippedTiebreak: 0,
    skippedCategory: 0,
    rowsPrepared: 0,
    unresolvedPlayers: 0,
    fallbackResolvedPlayers: 0,
    byCategory: {},
    byEdition: {},
    unresolvedByCategory: {},
    unresolvedByModality: {},
    uncategorizedMatches: [],
    excludedRows: 0,
    excludedPlayers: {},
    unresolvedSample: []
  };

  for (const [fechaKey, entries] of grouped.entries()) {
    const parts = String(fechaKey).split('::');
    const fechaISO = parts[0] || '';
    const localSlug = normalizeSlug(parts[1] || '');
    const visitanteSlug = normalizeSlug(parts[2] || '');
    const isTiebreak = String(parts[3] || '').trim().toLowerCase() === 'desempate';
    if (isTiebreak) {
      stats.skippedTiebreak += 1;
      continue;
    }
    if (!fechaISO || !localSlug || !visitanteSlug) continue;

    const localEntry = entries.find((row) => normalizeSlug(row.team) === localSlug) || null;
    const visitanteEntry = entries.find((row) => normalizeSlug(row.team) === visitanteSlug) || null;
    if (!localEntry?.validated || !visitanteEntry?.validated || !localEntry?.status_json || !visitanteEntry?.status_json) {
      stats.skippedPending += 1;
      continue;
    }

    const diff = compareFullStatus(localEntry.status_json || {}, visitanteEntry.status_json || {});
    if (diff.length) {
      stats.skippedMismatch += 1;
      continue;
    }

    const local = teamInfo(teams, localSlug);
    const visitante = teamInfo(teams, visitanteSlug);
    const category = inferCategory(localSlug, visitanteSlug, local, visitante);
    if (CATEGORY_FILTER && category !== CATEGORY_FILTER) {
      stats.skippedCategory += 1;
      continue;
    }

    const localUpdatedAt = localEntry?.updated_at ? new Date(localEntry.updated_at).getTime() : 0;
    const visitanteUpdatedAt = visitanteEntry?.updated_at ? new Date(visitanteEntry.updated_at).getTime() : 0;
    const snapshot = localUpdatedAt >= visitanteUpdatedAt
      ? (localEntry.status_json || visitanteEntry.status_json || {})
      : (visitanteEntry.status_json || localEntry.status_json || {});
    const sourceUpdatedAt = localUpdatedAt >= visitanteUpdatedAt
      ? localEntry.updated_at
      : visitanteEntry.updated_at;

    const prepared = rowsFromSnapshot({
      fechaKey,
      fechaISO,
      category,
      sourceUpdatedAt,
      snapshot,
      playerIndex,
      overrideIndexes,
      stats
    }, {
      snapshot,
      localSlug,
      visitanteSlug,
      localName: local?.name || localSlug,
      visitanteName: visitante?.name || visitanteSlug
    });

    stats.validMatches += 1;
    stats.byCategory[category || 'sin_categoria'] = (stats.byCategory[category || 'sin_categoria'] || 0) + 1;
    if (!category && stats.uncategorizedMatches.length < 50) {
      stats.uncategorizedMatches.push({
        fechaKey,
        localSlug,
        visitanteSlug
      });
    }
    for (const row of prepared) {
      row.edicion = inferRowEdition(row, editionStarts);
      stats.byEdition[row.edicion] = (stats.byEdition[row.edicion] || 0) + 1;
      out.push(row);
    }
  }

  stats.rowsPrepared = out.length;
  stats.unresolvedPlayers = out.filter((row) => !row.jugador_id).length;
  stats.fallbackResolvedPlayers = out.filter((row) => row.resolved_source === 'fallback').length;
  for (const row of out) {
    if (row.jugador_id) continue;
    const categoryKey = row.categoria || 'sin_categoria';
    const modalityKey = row.modalidad || 'sin_modalidad';
    stats.unresolvedByCategory[categoryKey] = (stats.unresolvedByCategory[categoryKey] || 0) + 1;
    stats.unresolvedByModality[modalityKey] = (stats.unresolvedByModality[modalityKey] || 0) + 1;
    if (stats.unresolvedSample.length < 20 && categoryKey !== 'primera') {
      stats.unresolvedSample.push({
        categoria: categoryKey,
        jugador: row.jugador_nombre,
        equipo: row.equipo_nombre || row.equipo_slug,
        modalidad: row.modalidad,
        fecha: row.fecha_iso
      });
    }
  }
  return { rows: out, stats };
}

async function writeRows(client, rows, { truncate = true } = {}) {
  await ensureTable(client);
  await client.query('BEGIN');
  try {
    if (truncate) await client.query('TRUNCATE jugador_resultados');
    const columnsPerRow = 20;
    const chunkSize = 100;
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const params = [];
      const values = chunk.map((row, rowIndex) => {
        const offset = rowIndex * columnsPerRow;
        params.push(
          row.fecha_key,
          row.fecha_iso,
          row.edicion,
          row.categoria,
          row.jugador_id,
          row.jugador_key,
          row.jugador_nombre,
          row.equipo_slug,
          row.equipo_nombre,
          row.rival_slug,
          row.rival_nombre,
          row.modalidad,
          row.slot,
          row.pareja_index,
          row.triangulos_favor,
          row.triangulos_contra,
          row.resultado,
          row.source_updated_at,
          JSON.stringify(row.snapshot_json || {}),
          new Date()
        );
        return `(
          $${offset + 1}, $${offset + 2}::date, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6},
          $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12},
          $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17},
          $${offset + 18}::timestamptz, $${offset + 19}::jsonb, $${offset + 20}::timestamptz
        )`;
      }).join(',\n');

      await client.query(
        `
        INSERT INTO jugador_resultados (
          fecha_key, fecha_iso, edicion, categoria, jugador_id, jugador_key, jugador_nombre,
          equipo_slug, equipo_nombre, rival_slug, rival_nombre, modalidad, slot,
          pareja_index, triangulos_favor, triangulos_contra, resultado,
          source_updated_at, snapshot_json, updated_at
        )
        VALUES ${values}
        ON CONFLICT (fecha_key, equipo_slug, modalidad, slot, jugador_key)
        DO UPDATE SET
          edicion = EXCLUDED.edicion,
          categoria = EXCLUDED.categoria,
          jugador_id = EXCLUDED.jugador_id,
          jugador_nombre = EXCLUDED.jugador_nombre,
          equipo_nombre = EXCLUDED.equipo_nombre,
          rival_slug = EXCLUDED.rival_slug,
          rival_nombre = EXCLUDED.rival_nombre,
          pareja_index = EXCLUDED.pareja_index,
          triangulos_favor = EXCLUDED.triangulos_favor,
          triangulos_contra = EXCLUDED.triangulos_contra,
          resultado = EXCLUDED.resultado,
          source_updated_at = EXCLUDED.source_updated_at,
          snapshot_json = EXCLUDED.snapshot_json,
          updated_at = NOW()
        `,
        params
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const pool = require('../db');
  const client = await pool.connect();
  try {
    const { rows, stats } = await buildRows(client);
    const selectedRows = APPEND_SINCE
      ? rows.filter((row) => String(row.fecha_iso || '') >= APPEND_SINCE)
      : rows;
    if (WRITE) {
      await writeRows(client, selectedRows, { truncate: !APPEND_SINCE });
    }

    const unresolvedExport = EXPORT_UNRESOLVED ? exportUnresolvedRows(rows) : null;

    console.log(JSON.stringify({
      ok: true,
      mode: WRITE ? 'write' : 'dry-run',
      category: CATEGORY_FILTER || null,
      edition: EDITION_OVERRIDE || 'inferred',
      appendSince: APPEND_SINCE || null,
      rowsSelected: selectedRows.length,
      unresolvedExport,
      ...stats
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = {
  buildRows,
  writeRows
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
