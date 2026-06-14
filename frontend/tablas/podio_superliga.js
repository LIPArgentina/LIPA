const PODIO_ASSET_BASE = '/assets/podios/';

const CATEGORY_CONFIG = {
  segunda: {
    rounds: [
      { id: 's1', legs: 2 },
      { id: 'final', legs: 1 },
      { id: 'third', legs: 1 },
      { id: 's2', legs: 2 }
    ],
    images: {
      'EL TREBOL|MALENA|OLDIES': 'podio_trebol_malena_oldies_2da.png',
      'MALENA|EL TREBOL|OLDIES': 'podio_malena_trebol_oldies_2da.png',
      'MALENA|EL TREBOL|VICTORIA': 'podio_malena_trebol_victoria_2da.png',
      'EL TREBOL|MALENA|VICTORIA': 'podio_trebol_malena_victoria_2da.png'
    }
  },
  tercera: {
    rounds: [
      { id: 'q1', legs: 2 },
      { id: 'q2', legs: 2 },
      { id: 's1', legs: 2 },
      { id: 'final', legs: 1 },
      { id: 'third', legs: 1 },
      { id: 's2', legs: 2 },
      { id: 'q3', legs: 2 },
      { id: 'q4', legs: 2 }
    ],
    images: {
      'ANEXO|EL TREBOL|EL TREBOL DE PACHECO': 'podio_anuxo_trebol_pacheco_3ra.png',
      'EL TREBOL|ANEXO|8910 BALL': 'podio_trebol_anexo_8910ball_3ra.png',
      'EL TREBOL|ANEXO|EL TREBOL DE PACHECO': 'podio_trebol_anexo_pacheco3ra.png',
      'ANEXO|EL TREBOL|8910 BALL': 'podio_anexo_trebol_8910ball_3ra.png'
    }
  }
};

function getApiBase() {
  const configured = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  if (configured) return `${configured}/api`;

  const host = String(window.location.hostname || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  const isStaging = host.includes('staging');
  return isLocal
    ? 'http://localhost:3000/api'
    : (isStaging ? 'https://liga-backend-staging.onrender.com/api' : 'https://liga-backend-tt82.onrender.com/api');
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeKey(value) {
  const raw = cleanName(value);
  if (!raw) return '';

  const upper = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' Y ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  const aliases = {
    '8910BALL': '8910 BALL',
    '8 9 10 BALL': '8910 BALL',
    '8,9,10 BALL': '8910 BALL',
    'EL TREBOL PACHECO': 'EL TREBOL DE PACHECO',
    'TREBOL DE PACHECO': 'EL TREBOL DE PACHECO',
    'EL TREBOL MORENO': 'EL TREBOL',
    'TREBOL': 'EL TREBOL',
    'ANEXO 2DA': 'ANEXO'
  };

  return aliases[upper] || upper;
}

function isRealTeam(value) {
  const key = normalizeKey(value);
  return key && key !== 'WO';
}

function displayName(value) {
  const key = normalizeKey(value);
  const names = {
    '8910 BALL': '8910 Ball',
    'EL TREBOL': 'El Trebol',
    'EL TREBOL DE PACHECO': 'El Trebol de Pacheco',
    'ANEXO': 'Anexo',
    'MALENA': 'Malena',
    'OLDIES': 'Oldies',
    'VICTORIA': 'Victoria'
  };
  return names[key] || cleanName(value);
}

function getEmptyLeg() {
  return {
    date: '',
    home: { team: 'WO', puntos: 0, puntosExtra: 0 },
    away: { team: 'WO', puntos: 0, puntosExtra: 0 }
  };
}

function getDefaultData(category) {
  const cfg = CATEGORY_CONFIG[category];
  return { rounds: cfg.rounds.map(round => ({ id: round.id, legs: Array.from({ length: round.legs }, getEmptyLeg) })) };
}

function getRound(data, id) {
  return (data?.rounds || []).find(round => round?.id === id);
}

function setLegTeams(round, legIndex, homeTeam, awayTeam) {
  if (!round?.legs?.[legIndex]) return;
  round.legs[legIndex].home.team = cleanName(homeTeam) || 'WO';
  round.legs[legIndex].away.team = cleanName(awayTeam) || 'WO';
}

function setSeriesTeams(round, teamA, teamB) {
  if (!round || !Array.isArray(round.legs)) return;
  if (round.legs.length === 1) {
    setLegTeams(round, 0, teamA, teamB);
    return;
  }
  setLegTeams(round, 0, teamB, teamA);
  setLegTeams(round, 1, teamA, teamB);
  if (round.legs[2]) setLegTeams(round, 2, teamA, teamB);
}

function hasScores(leg) {
  return [
    leg?.home?.puntos,
    leg?.away?.puntos,
    leg?.home?.puntosExtra,
    leg?.away?.puntosExtra
  ].some(value => Number(value || 0) > 0);
}

function singleWinner(round) {
  const leg = round?.legs?.[0];
  if (!leg || !isRealTeam(leg.home?.team) || !isRealTeam(leg.away?.team) || !hasScores(leg)) {
    return { winner: 'WO', loser: 'WO', decided: false };
  }

  const hp = Number(leg.home?.puntos || 0);
  const ap = Number(leg.away?.puntos || 0);
  const ht = Number(leg.home?.puntosExtra || 0);
  const at = Number(leg.away?.puntosExtra || 0);

  if (hp > ap || (hp === ap && ht > at)) return { winner: leg.home.team, loser: leg.away.team, decided: true };
  if (ap > hp || (hp === ap && at > ht)) return { winner: leg.away.team, loser: leg.home.team, decided: true };
  return { winner: 'WO', loser: 'WO', decided: false };
}

function seriesWinner(round) {
  if (!round || !Array.isArray(round.legs) || !round.legs.length) {
    return { winner: 'WO', loser: 'WO', decided: false };
  }

  if (round.legs.length === 1) return singleWinner(round);

  const ida = round.legs[0];
  const vuelta = round.legs[1];
  if (!ida || !vuelta || !hasScores(ida) || !hasScores(vuelta)) {
    return { winner: 'WO', loser: 'WO', decided: false };
  }

  const teams = [ida.home?.team, ida.away?.team, vuelta.home?.team, vuelta.away?.team]
    .filter(isRealTeam);
  const unique = Array.from(new Map(teams.map(team => [normalizeKey(team), cleanName(team)])).values());
  if (unique.length < 2) return { winner: 'WO', loser: 'WO', decided: false };

  const acc = Object.fromEntries(unique.slice(0, 2).map(team => [normalizeKey(team), { team, pts: 0, tri: 0 }]));
  [ida, vuelta].forEach(leg => {
    const hKey = normalizeKey(leg.home?.team);
    const aKey = normalizeKey(leg.away?.team);
    if (acc[hKey]) {
      acc[hKey].pts += Number(leg.home?.puntos || 0);
      acc[hKey].tri += Number(leg.home?.puntosExtra || 0);
    }
    if (acc[aKey]) {
      acc[aKey].pts += Number(leg.away?.puntos || 0);
      acc[aKey].tri += Number(leg.away?.puntosExtra || 0);
    }
  });

  const [a, b] = Object.values(acc);
  if (a.pts > b.pts || (a.pts === b.pts && a.tri > b.tri)) return { winner: a.team, loser: b.team, decided: true };
  if (b.pts > a.pts || (a.pts === b.pts && b.tri > a.tri)) return { winner: b.team, loser: a.team, decided: true };

  const extra = round.legs[2];
  if (extra && hasScores(extra)) return singleWinner({ legs: [extra] });
  return { winner: 'WO', loser: 'WO', decided: false };
}

function mergeSavedData(baseData, savedData) {
  if (!savedData || !Array.isArray(savedData.rounds)) return baseData;

  baseData.rounds.forEach(round => {
    const savedRound = savedData.rounds.find(item => item?.id === round.id);
    if (!savedRound || !Array.isArray(savedRound.legs)) return;

    while (round.legs.length < savedRound.legs.length) round.legs.push(getEmptyLeg());

    round.legs.forEach((leg, index) => {
      const savedLeg = savedRound.legs[index];
      if (!savedLeg) return;
      leg.date = typeof savedLeg.date === 'string' ? savedLeg.date : leg.date;
      leg.home.team = cleanName(savedLeg?.home?.team) || leg.home.team;
      leg.away.team = cleanName(savedLeg?.away?.team) || leg.away.team;
      leg.home.puntos = Number(savedLeg?.home?.puntos || 0);
      leg.home.puntosExtra = Number(savedLeg?.home?.puntosExtra || 0);
      leg.away.puntos = Number(savedLeg?.away?.puntos || 0);
      leg.away.puntosExtra = Number(savedLeg?.away?.puntosExtra || 0);
    });
  });

  return baseData;
}

function applyAutomaticFinals(data, category) {
  if (category === 'tercera') {
    const q1 = seriesWinner(getRound(data, 'q1'));
    const q2 = seriesWinner(getRound(data, 'q2'));
    const q3 = seriesWinner(getRound(data, 'q3'));
    const q4 = seriesWinner(getRound(data, 'q4'));
    setSeriesTeams(getRound(data, 's1'), q1.winner, q2.winner);
    setSeriesTeams(getRound(data, 's2'), q3.winner, q4.winner);
  }

  const s1 = seriesWinner(getRound(data, 's1'));
  const s2 = seriesWinner(getRound(data, 's2'));
  setSeriesTeams(getRound(data, 'final'), s1.winner, s2.winner);
  setSeriesTeams(getRound(data, 'third'), s1.loser, s2.loser);
}

async function fetchLlaves(category) {
  const response = await fetch(`${getApiBase()}/llaves?category=${encodeURIComponent(category)}`, {
    cache: 'no-store',
    credentials: 'include'
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'No se pudieron cargar las llaves');
  return data.data;
}

function buildResult(category, data) {
  const final = seriesWinner(getRound(data, 'final'));
  const third = seriesWinner(getRound(data, 'third'));
  if (!final.decided || !third.decided) return null;

  const championKey = normalizeKey(final.winner);
  const runnerUpKey = normalizeKey(final.loser);
  const thirdKey = normalizeKey(third.winner);
  const imageName = CATEGORY_CONFIG[category].images[`${championKey}|${runnerUpKey}|${thirdKey}`];
  if (!imageName) return null;

  return {
    category,
    champion: displayName(final.winner),
    runnerUp: displayName(final.loser),
    third: displayName(third.winner),
    imageSrc: `${PODIO_ASSET_BASE}${imageName}`,
    imageAlt: `Podio ${displayName(final.winner)}, ${displayName(final.loser)} y ${displayName(third.winner)}`
  };
}

export async function loadPodiumResult(category) {
  if (!CATEGORY_CONFIG[category]) return null;

  const data = getDefaultData(category);
  const saved = await fetchLlaves(category);
  mergeSavedData(data, saved);

  const savedResult = buildResult(category, data);
  if (savedResult) return savedResult;

  applyAutomaticFinals(data, category);
  mergeSavedData(data, saved);
  applyAutomaticFinals(data, category);
  return buildResult(category, data);
}

export async function loadSuperligaPodiums() {
  const [segunda, tercera] = await Promise.all([
    loadPodiumResult('segunda').catch(() => null),
    loadPodiumResult('tercera').catch(() => null)
  ]);

  if (!segunda || !tercera) return null;
  return { segunda, tercera };
}
