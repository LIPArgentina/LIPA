const CATEGORY_LAYOUTS = {
  primera: { groups: ['A', 'B'], matchesPerGroup: 3, minFechas: 3 },
  segunda: { groups: ['A', 'B'], matchesPerGroup: 3, minFechas: 5 },
  tercera: { groups: ['A', 'B', 'C', 'D'], matchesPerGroup: 2, minFechas: 3 }
};

const KIND_KEY = 'fixture_kind';
const CAT_KEY  = 'fixture_cat';
let PERSIST_WARNED = false;

function getStored(key, fallback){
  try { return localStorage.getItem(key) || fallback; }
  catch(_) { return fallback; }
}

function setStored(key, val){
  try { localStorage.setItem(key, val); }
  catch(e){
    if (!PERSIST_WARNED){
      PERSIST_WARNED = true;
      alert('No se pudo guardar tu preferencia en este navegador. Se usará un valor temporal.');
    }
  }
}

function currentCategoryKind(){
  return {
    cat: (getStored(CAT_KEY, 'tercera') || 'tercera').toLowerCase(),
    kind: getStored(KIND_KEY, 'ida') || 'ida'
  };
}

async function loadFixtureJSON(src){
  try { delete window.LPI_FIXTURE; } catch(_) { window.LPI_FIXTURE = undefined; }

  const resp = await fetch(src, { cache: 'no-store' });
  if (!resp.ok) {
    throw new Error('No se pudo cargar: ' + src);
  }

  const data = await resp.json().catch(() => null);
  if (!data || typeof data !== 'object') {
    throw new Error('El JSON del fixture es inválido: ' + src);
  }

  window.LPI_FIXTURE = data;
  return src;
}

function markActiveKind(kind){
  document.querySelectorAll('[data-fixture]').forEach(el => {
    const active = el.getAttribute('data-fixture') === kind;
    el.classList.toggle('active', active);
  });
}

function markActiveCat(cat){
  document.querySelectorAll('[data-cat]').forEach(el => {
    const active = el.getAttribute('data-cat') === cat;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
}

window.FixtureSwitcher = {
  async switch(kind, opts = {}){
    const category = (opts.category || getStored(CAT_KEY, 'tercera')).toLowerCase();
    const base = opts.base || './';
    const persist = opts.persist !== false;

    let file;
    if (kind === 'ida') file = `fixture/fixture.ida.${category}.json`;
    else if (kind === 'vuelta') file = `fixture/fixture.vuelta.${category}.json`;
    else if (!/\.json($|\?)/i.test(kind)) {
      const normalized = String(kind).replace(/\.js($|\?)/i, '.json');
      file = normalized.startsWith('fixture/') ? normalized : `fixture/${normalized}`;
      if (!String(file).endsWith('.json')) file += '.json';
    } else {
      file = String(kind).startsWith('fixture/') ? kind : `fixture/${kind}`;
    }

    const src = (base.endsWith('/') ? base : base + '/') + file;
    await loadFixtureJSON(src);

    markActiveKind(kind);
    markActiveCat(category);

    const detail = { src, kind, category, fixture: window.LPI_FIXTURE || null };
    document.dispatchEvent(new CustomEvent('fixture:data-ready', { detail }));

    if (typeof window.applyFixture === 'function'){
      await window.applyFixture();
    }

    if (persist){
      setStored(KIND_KEY, kind);
      setStored(CAT_KEY, category);
    }
    return detail;
  },

  async setCategory(cat, opts = {}){
    const category = String(cat || 'tercera').toLowerCase();
    setStored(CAT_KEY, category);
    markActiveCat(category);
    return this.switch('ida', { base: opts.base, category, persist: true });
  },

  bind(opts = {}){
    document.querySelectorAll(opts.selectorKind || '[data-fixture]').forEach(el => {
      const handler = async (ev) => {
        if (el.tagName === 'A') ev.preventDefault();
        const kind = el.getAttribute('data-fixture') || 'ida';
        const category = getStored(CAT_KEY, 'tercera');
        try {
          await this.switch(kind, { category, base: opts.base });
        } catch(err){
          console.error(err);
          alert(err.message || String(err));
        }
      };
      el.addEventListener('click', handler);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' '){
          e.preventDefault();
          handler(e);
        }
      });
    });

    document.querySelectorAll(opts.selectorCat || '[data-cat]').forEach(el => {
      const handler = async (ev) => {
        if (el.tagName === 'A') ev.preventDefault();
        const cat = el.getAttribute('data-cat') || 'tercera';
        try {
          await this.setCategory(cat, { base: opts.base });
        } catch(err){
          console.error(err);
          alert(err.message || String(err));
        }
      };
      el.addEventListener('click', handler);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' '){
          e.preventDefault();
          handler(e);
        }
      });
    });
  },

  restore(opts = {}){
    const category = getStored(CAT_KEY, 'tercera');
    let kind = getStored(KIND_KEY, null);
    if (!kind) kind = opts.fallback || 'ida';
    markActiveCat(category);
    markActiveKind(kind);
    return this.switch(kind, { base: opts.base, category });
  }
};

function getCategoryConfig(cat, fixture){
  const key = String(cat || 'tercera').toLowerCase();
  const base = CATEGORY_LAYOUTS[key] || CATEGORY_LAYOUTS.tercera;
  const fixtureGroups = Array.from(new Set((fixture?.fechas || [])
    .flatMap(fecha => Array.isArray(fecha.tablas) ? fecha.tablas : [])
    .map(tabla => String(tabla?.grupo || '').toUpperCase())
    .filter(Boolean)));

  const groups = base.groups.slice();
  fixtureGroups.forEach(group => {
    if (!groups.includes(group)) groups.push(group);
  });

  return {
    ...base,
    category: key,
    groups,
    minFechas: Math.max(base.minFechas || 0, fixture?.fechas?.length || 0)
  };
}

function getRenderedGroups(){
  return Array.from(document.querySelectorAll('.fecha-card[data-group]'))
    .map(el => String(el.getAttribute('data-group') || '').toUpperCase())
    .filter((g, i, arr) => g && arr.indexOf(g) === i);
}

function createFechaCard(grupo, fecha){
  const section = document.createElement('section');
  section.className = 'card fecha-card';
  section.dataset.group = grupo;
  section.dataset.fecha = String(fecha);
  section.setAttribute('aria-label', `Fixture GRUPO ${grupo} - ${fecha}ª fecha`);

  section.innerHTML = `
    <h1 class="h1">GRUPO ${grupo}</h1>
    <div class="fecha-header">
      <div class="h2">${fecha}ª FECHA</div>
      <input type="date" class="fecha-input" aria-label="Fecha de calendario"/>
    </div>
    <div class="rule"></div>
    <div class="rows" data-fecha="${fecha}" data-group="${grupo}"></div>
  `;
  return section;
}

function buildFixtureLayout(config){
  const grid = document.querySelector('.grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let fecha = 1; fecha <= config.minFechas; fecha++){
    const block = document.createElement('div');
    block.className = 'fecha-block';
    block.dataset.fecha = String(fecha);

    const inner = document.createElement('div');
    inner.className = 'fecha-grid';

    config.groups.forEach(grupo => inner.appendChild(createFechaCard(grupo, fecha)));

    block.appendChild(inner);
    grid.appendChild(block);
  }
}

function headerInput(grupo, fecha){
  return document.querySelector(`.fecha-card[data-group="${grupo}"][data-fecha="${fecha}"] .fecha-input`);
}

function restoreDatesFromFixture(fx, groups){
  if (!fx || !Array.isArray(fx.fechas)) return;
  const renderedGroups = groups && groups.length ? groups : getRenderedGroups();

  for (let fecha = 1; fecha <= fx.fechas.length; fecha++){
    const item = fx.fechas[fecha - 1];
    if (!item || typeof item.date !== 'string') continue;
    renderedGroups.forEach(grupo => {
      const inp = headerInput(grupo, fecha);
      if (inp) inp.value = item.date;
    });
  }
}

function loadUsersJS(cat){
  return new Promise((resolve, reject) => {
    const ID = 'users-script';
    const old = document.getElementById(ID);
    if (old) old.remove();

    try { delete window.LPI_USERS; } catch(_) { window.LPI_USERS = undefined; }

    const s = document.createElement('script');
    s.id = ID;
    s.src = `../data/usuarios.${cat}.js`;
    s.onload = () => {
      const arr = (window.LPI_USERS || [])
        .filter(u => u.role === 'team')
        .map(u => u.username);
      const uniq = Array.from(new Set(arr.filter(n => n && n.trim() !== '')));
      const resto = uniq.filter(n => n !== 'WO')
        .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
      resolve(['WO', ...resto]);
    };
    s.onerror = () => reject(new Error(`No se pudo cargar usuarios.${cat}.js`));
    document.head.appendChild(s);
  });
}

function renderRows(rowsCont, equipos, fecha, grupo, equiposCat, matchesPerGroup){
  rowsCont.innerHTML = '';
  const list = Array.isArray(equipos) ? equipos.slice() : [];
  const matchesFromData = Math.floor(list.length / 2);
  const total = matchesPerGroup || matchesFromData;

  for (let k = 0; k < total; k++){
    const iL = 2 * k;
    const iV = 2 * k + 1;
    const L = list[iL] || { equipo:'WO', puntos:0 };
    const V = list[iV] || { equipo:'WO', puntos:0 };

    const row = document.createElement('div');
    row.className = 'row';

    const puntL = document.createElement('select');
    puntL.className = 'score-badge';
    puntL.dataset.field = 'puntos';
    puntL.dataset.side = 'L';
    puntL.dataset.fecha = fecha;
    puntL.dataset.grupo = grupo;
    puntL.dataset.index = k;
    for (let n = 0; n <= 9; n++){
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = String(n);
      puntL.appendChild(o);
    }
    puntL.value = String(L.puntos ?? 0);

    const selL = document.createElement('select');
    selL.className = 'team-name';
    selL.dataset.field = 'equipo';
    selL.dataset.side = 'L';
    selL.dataset.fecha = fecha;
    selL.dataset.grupo = grupo;
    selL.dataset.index = k;
    equiposCat.forEach(n => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      selL.appendChild(o);
    });
    selL.value = equiposCat.includes(L.equipo) ? L.equipo : 'WO';

    const vs = document.createElement('div');
    vs.className = 'vs';
    vs.textContent = '-';

    const selV = document.createElement('select');
    selV.className = 'team-name';
    selV.dataset.field = 'equipo';
    selV.dataset.side = 'V';
    selV.dataset.fecha = fecha;
    selV.dataset.grupo = grupo;
    selV.dataset.index = k;
    equiposCat.forEach(n => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      selV.appendChild(o);
    });
    selV.value = equiposCat.includes(V.equipo) ? V.equipo : 'WO';

    const puntV = document.createElement('select');
    puntV.className = 'score-badge';
    puntV.dataset.field = 'puntos';
    puntV.dataset.side = 'V';
    puntV.dataset.fecha = fecha;
    puntV.dataset.grupo = grupo;
    puntV.dataset.index = k;
    for (let n = 0; n <= 9; n++){
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = String(n);
      puntV.appendChild(o);
    }
    puntV.value = String(V.puntos ?? 0);

    row.appendChild(puntL);
    row.appendChild(selL);
    row.appendChild(vs);
    row.appendChild(selV);
    row.appendChild(puntV);
    rowsCont.appendChild(row);
  }
}

function mirrorDateAcrossGroups(fecha, value, sourceGroup){
  if (!value) return;
  document.querySelectorAll(`.fecha-card[data-fecha="${fecha}"] .fecha-input`).forEach(inp => {
    const group = inp.closest('.fecha-card')?.dataset.group || '';
    if (group !== sourceGroup) inp.value = value;
  });
}

window.applyFixture = async function applyFixture(){
  const fx = window.LPI_FIXTURE;
  if (!fx){
    alert('No se pudo cargar el fixture');
    return;
  }

  const cat = currentCategoryKind().cat;
  const equiposCat = await loadUsersJS(cat);
  const config = getCategoryConfig(cat, fx);

  buildFixtureLayout(config);
  restoreDatesFromFixture(fx, config.groups);

  for (let fecha = 1; fecha <= config.minFechas; fecha++){
    config.groups.forEach(grupo => {
      const cont = document.querySelector(`.rows[data-fecha="${fecha}"][data-group="${grupo}"]`);
      if (!cont) return;
      const tabla = (fx.fechas?.[fecha - 1]?.tablas || []).find(t => String(t?.grupo || '').toUpperCase() === grupo);
      const equipos = Array.isArray(tabla?.equipos) ? tabla.equipos : [];
      renderRows(cont, equipos, fecha, grupo, equiposCat, config.matchesPerGroup);
    });
  }

  document.querySelectorAll('.fecha-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const card = inp.closest('.fecha-card');
      if (!card) return;
      mirrorDateAcrossGroups(card.dataset.fecha, inp.value, card.dataset.group);
    });
  });
};

function assignCategoriasAlternadas(fixture){
  if (!fixture || !Array.isArray(fixture.fechas)) return fixture;
  for (const fecha of fixture.fechas){
    if (!Array.isArray(fecha.tablas)) continue;
    for (const tabla of fecha.tablas){
      if (!Array.isArray(tabla.equipos)) continue;
      for (let i = 0; i < tabla.equipos.length; i++){
        if (tabla.equipos[i] && typeof tabla.equipos[i] === 'object'){
          tabla.equipos[i].categoria = (i % 2 === 0) ? 'local' : 'visitante';
        }
      }
    }
  }
  return fixture;
}

function buildFixtureFromUI(){
  const groups = getRenderedGroups();
  const fechaNums = Array.from(
    new Set(
      Array.from(document.querySelectorAll('.fecha-card[data-fecha]'))
        .map(el => Number(el.dataset.fecha))
        .filter(Boolean)
    )
  ).sort((a,b)=>a-b);

  const fechas = fechaNums.map(fecha => {
    const entry = { date: '', tablas: [] };

    groups.forEach(grupo => {
      const card = document.querySelector(`.fecha-card[data-group="${grupo}"][data-fecha="${fecha}"]`);
      if (!card) return;

      const dateInput = card.querySelector('.fecha-input');
      if (!entry.date && dateInput?.value) entry.date = dateInput.value;

      const equipos = [];
      card.querySelectorAll('.row').forEach(row => {
        const selL  = row.querySelector('select.team-name[data-side="L"]');
        const selV  = row.querySelector('select.team-name[data-side="V"]');
        const puntL = row.querySelector('select.score-badge[data-side="L"]');
        const puntV = row.querySelector('select.score-badge[data-side="V"]');
        equipos.push({ equipo: selL ? selL.value : 'WO', puntos: puntL ? Number(puntL.value || 0) : 0 });
        equipos.push({ equipo: selV ? selV.value : 'WO', puntos: puntV ? Number(puntV.value || 0) : 0 });
      });

      entry.tablas.push({ grupo, equipos });
    });

    return entry;
  });

  return { fechas };
}

async function saveFixtureJSONOnServer(){
  const { cat, kind } = currentCategoryKind();
  const filename = `fixture.${kind}.${cat}`;
  const relPathJSON = `fixture/${filename}.json`;
  const data = buildFixtureFromUI();

  assignCategoriasAlternadas(data);

  const jsonStr = JSON.stringify(data, null, 2);

  const resp = await fetch('/api/save-js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPathJSON, content: jsonStr })
  });

  let result = null;
  let rawText = '';

  try {
    rawText = await resp.text();
    result = rawText ? JSON.parse(rawText) : null;
  } catch (_) {
    result = null;
  }

  if (!resp.ok) {
    throw new Error(
      (result && result.error) ||
      rawText ||
      `Error guardando ${relPathJSON}`
    );
  }

  window.LPI_FIXTURE = data;
  showToast('Guardado correctamente');
}

(function wireUnifiedSave(){
  const btn = document.getElementById('saveFixture');
  if (!btn) return;
  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try {
      await saveFixtureJSONOnServer();
    } catch(e){
      console.error(e);
      alert(e && e.message ? e.message : 'Error al guardar');
    }
  });
})();

function showToast(message, ms = 2500){
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), ms);
}

window.addEventListener('load', () => {
  FixtureSwitcher.bind();
  FixtureSwitcher.restore({ fallback: 'ida' }).catch(err => {
    console.error(err);
    alert(err.message || String(err));
  });
});
