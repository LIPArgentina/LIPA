
// PATCH: usar fixture directo en vez de /api/cruces

async function loadCruces(category){
  const res = await fetch(`${API_BASE}/api/fixture?kind=ida&category=${category}`, { cache: 'no-store' });
  const json = await res.json();
  if(!json?.ok) return { cruces: [], fechaFixture: null };

  const fechas = json?.data?.fechas || [];

  function toKey(d){
    const date = new Date(d);
    const y = date.getFullYear();
    const m = String(date.getMonth()+1).padStart(2,'0');
    const day = String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  const today = new Date(); today.setHours(0,0,0,0);

  const keys = {
    today: toKey(today),
    yesterday: toKey(new Date(today.getTime()-86400000)),
    tomorrow: toKey(new Date(today.getTime()+86400000))
  };

  const normalized = fechas.map(f => ({
    raw: f,
    key: (f.date || '').slice(0,10)
  })).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f.key))
    .sort((a,b)=>a.key.localeCompare(b.key));

  let chosen =
    normalized.find(f=>f.key===keys.today) ||
    normalized.find(f=>f.key===keys.yesterday) ||
    normalized.find(f=>f.key===keys.tomorrow) ||
    normalized.find(f=>f.key>keys.tomorrow) ||
    normalized[normalized.length-1];

  if(!chosen) return { cruces: [], fechaFixture: null };

  return {
    cruces: extractCrucesFromFecha(chosen.raw),
    fechaFixture: chosen.key
  };
}
