(() => {
  'use strict';
  if (window.LPI_AUTH?.readSession?.()?.role !== 'torneo') {
    location.replace(`/auth/login.html?return=${encodeURIComponent(location.pathname)}`);
    return;
  }
  const API = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const states = [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  async function api(path, options = {}) {
    const response = await fetch(`${API}/api/torneo-organizador/sorteos${path}`, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo conectar con el servidor.'), { status: response.status });
    return data;
  }
  // Rejection sampling avoids modulo bias in Fisher-Yates.
  function randomIndex(max) {
    const limit = 4294967296 - (4294967296 % max);
    const sample = new Uint32Array(1);
    do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
    return sample[0] % max;
  }
  function shuffle(state) {
    state.players = window.LipaSlots.shuffle(state.players, randomIndex);
    renderRows(state, true);
  }
  function fit(state) {
    const wrap = state.card.querySelector('.table-wrap');
    const rowHeight = Math.max(14, Math.min(28, Math.floor((wrap.clientHeight - 21) / Math.max(1, state.players.length))));
    state.card.style.setProperty('--row-height', `${rowHeight}px`);
    state.card.style.setProperty('--name-size', `${Math.max(11, Math.min(14, rowHeight - 2))}px`);
    state.body.querySelectorAll('.name').forEach(name => {
      name.style.transform = '';
      const available = name.clientWidth;
      if (available && name.scrollWidth > available) name.style.transform = `scaleX(${available / name.scrollWidth})`;
    });
  }
  function updateExports(state) {
    state.card.querySelectorAll('[data-export]').forEach(button => {
      button.disabled = Boolean(state.dirty || state.saving || state.exporting || !state.players.some(player => player.id != null));
      button.title = state.dirty || state.saving ? 'Detené el sorteo y guardá el orden antes de exportar.' : '';
    });
  }
  function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function exportPlayers(state, format) {
    if (state.dirty || state.saving || state.exporting) return;
    const rows = state.players.map((player, index) => ({ name: player.nombre, position:index + 1, id:player.id })).filter(player => player.id != null);
    if (!rows.length) return;
    const tournament = document.querySelector('#tournamentName').textContent || 'LIPA';
    const title = state.label.toUpperCase();
    const filename = 'lipa-inscriptos-' + state.category;
    state.exporting = true; updateExports(state);
    try {
      if (format === 'text') {
        const text = tournament + '\r\n' + title + ' · ' + rows.length + ' inscriptos\r\nPosiciones de la grilla · sin WO\r\n\r\n' + rows.map(row => row.position + '. ' + row.name).join('\r\n');
        downloadFile(new Blob(['\uFEFF', text], {type:'text/plain;charset=utf-8'}), filename + '.txt');
      } else {
        await document.fonts?.ready;
        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
        const width = 1080, nameWidth = 870;
        function wrap(text, font, maxWidth) {
          ctx.font = font;
          const lines = []; let line = '';
          for (const char of String(text)) {
            if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line.trimEnd()); line = ''; }
            line += char;
          }
          lines.push(line.trimEnd()); return lines;
        }
        const nameFont = '600 28px Montserrat, sans-serif';
        const headingLines = wrap(tournament, '800 26px Montserrat, sans-serif', 970);
        const top = 190 + headingLines.length * 34;
        const prepared = rows.map(row => ({...row, lines:wrap(row.name, nameFont, nameWidth)}));
        const height = top + prepared.reduce((sum,row) => sum + Math.max(58,row.lines.length * 36 + 22),0) + 70;
        canvas.width = width; canvas.height = height;
        ctx.fillStyle = '#080a0d'; ctx.fillRect(0,0,width,height);
        ctx.fillStyle = '#ffdc65'; ctx.font = '800 26px Montserrat, sans-serif';
        headingLines.forEach((line,i) => ctx.fillText(line,48,52+i*34));
        const headingY = 94 + headingLines.length*34;
        ctx.fillStyle = '#ffc400'; ctx.font = '900 54px Montserrat, sans-serif'; ctx.fillText(title,48,headingY);
        ctx.fillStyle = '#abb1bc'; ctx.font = '24px Montserrat, sans-serif'; ctx.fillText(rows.length + ' inscriptos · Posiciones de la grilla · Sin WO',48,headingY+44);
        ctx.fillStyle = '#ffc400'; ctx.fillRect(48,top-18,984,3);
        let y = top;
        prepared.forEach((row,i) => {
          const rowHeight = Math.max(58,row.lines.length*36+22);
          ctx.fillStyle = i%2 ? '#101318' : '#17191e'; ctx.fillRect(48,y,984,rowHeight);
          ctx.font = '600 26px Montserrat, sans-serif'; ctx.fillStyle = '#ffdc65'; ctx.fillText(String(row.position),64,y+38);
          ctx.font = nameFont; ctx.fillStyle = '#ffffff'; row.lines.forEach((line,j) => ctx.fillText(line,145,y+38+j*36));
          y += rowHeight;
        });
        ctx.fillStyle = '#abb1bc'; ctx.font = '20px Montserrat, sans-serif'; ctx.fillText('LIPA · lipa.ar',48,height-25);
        const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
        if (!blob) throw new Error('No se pudo generar la imagen.');
        downloadFile(blob,filename+'.png');
      }
      message(state, 'Exportación preparada sin WO.', 'saved');
    } catch (error) { message(state,error.message || 'No se pudo exportar. Reintentá.','error'); }
    finally { state.exporting = false; updateExports(state); }
  }
  function renderRows(state, animate = false) {
    updateExports(state);
    state.body.replaceChildren();
    state.players.forEach((player, index) => {
      const row = document.createElement('tr');
      const position = document.createElement('td');
      position.textContent = index + 1;
      const cell = document.createElement('td');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = player.nombre;
      row.classList.toggle('wo-row', player.id === null);
      cell.append(name);
      row.append(position, cell);
      state.body.append(row);
      if (animate && player.id !== null && !reducedMotion && cell.animate) cell.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 260 });
    });
    if (!state.players.length) {
      const row = state.body.insertRow();
      const cell = row.insertCell(); cell.colSpan = 2; cell.className = 'empty';
      cell.textContent = 'Sin jugadores confirmados en esta categoría.';
    }
    fit(state);
  }
  function message(state, text, type = '') {
    state.status.textContent = text; state.status.className = `status ${type}`;
  }
  async function save(state) {
    state.saving = true;
    state.button.disabled = true;
    state.button.textContent = 'GUARDANDO…';
    message(state, 'Guardando el orden del sorteo…');
    try {
      const data = await api(`/${state.category}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orden: state.players.map(player => player.id === null ? null : String(player.id)), revision: state.revision, resetResults: state.resetResults === true })
      });
      state.revision = data.revision;
      state.dirty = false;
      state.drawn = true;
      state.hasResults = false;
      state.button.textContent = 'SORTEAR POSICIÓN';
      message(state, 'Orden guardado. Podés continuar a la grilla.', 'saved');
    } catch (error) {
      state.conflict = error.status === 409;
      state.button.textContent = state.conflict ? 'RECARGAR LISTAS' : 'REINTENTAR GUARDADO';
      message(state, error.message, 'error');
    } finally {
      state.saving = false;
      updateExports(state);
      state.button.disabled = false;
    }
  }
  async function toggle(state) {
    if (state.saving || state.exporting) return;
    if (state.conflict) { location.reload(); return; }
    if (state.timer) {
      clearInterval(state.timer); state.timer = null;
      state.card.classList.remove('running');
      await save(state); return;
    }
    if (state.dirty) { await save(state); return; }
    if (state.drawn && !confirm(`Ya hay un sorteo de ${state.label}. Se va a repetir y el nuevo orden reemplazará al anterior al detenerlo.${state.hasResults ? ' ATENCIÓN: se borrarán todos los resultados de la grilla de esta categoría.' : ''} ¿Continuar?`)) return;
    state.resetResults = state.hasResults;
    state.dirty = true;
    state.card.classList.add('running');
    state.button.textContent = 'DETENER';
    message(state, 'Sorteando… Presioná DETENER para guardar el orden.');
    shuffle(state);
    state.timer = setInterval(() => shuffle(state), 500);
  }
  async function load() {
    const data = await api('');
    document.querySelector('#tournamentName').textContent = data.nombre;
    const missing = data.jugadores.filter(player => !player.categoria).length;
    document.querySelector('#pageMessage').textContent = missing
      ? `${missing} jugador(es) confirmado(s) sin categoría: asignala en Inscripciones para incluirlos.`
      : '';
    for (const [category, label] of [['primera', 'Primera'], ['segunda', 'Segunda'], ['tercera', 'Tercera']]) {
      let players = data.jugadores.filter(player => window.LipaCategories.includes(player.categoria, category));
      const realCount = players.length;
      const saved = data.sorteos.find(draw => draw.categoria === category);
      const byId = new Map(players.map(player => [String(player.id), player]));
      const order = Array.isArray(saved?.orden) ? saved.orden.map(id=>id===null?null:String(id)) : [];
      const valid = Boolean(saved) && window.LipaSlots.validOrder(order, [...byId.keys()], category);
      players = valid ? order.map(id=>id===null?{id:null,nombre:'WO',wo:true}:byId.get(id)) : window.LipaSlots.fill(players,category);
      const card = document.createElement('section');
      card.className = 'category'; card.setAttribute('aria-labelledby', `heading-${category}`);
      card.innerHTML = `<div class="category-heading"><h2 id="heading-${category}">${label.toUpperCase()}</h2><span class="count">${realCount} jugadores${players.length>realCount?` · ${players.length-realCount} WO`:''}</span></div><div class="table-wrap"><table aria-label="Posiciones de ${label}"><thead><tr><th scope="col">N.º</th><th scope="col">Jugador</th></tr></thead><tbody></tbody></table></div><div class="category-footer"><p class="status" role="status"></p><button type="button" class="draw-button" aria-describedby="status-${category}">SORTEAR POSICIÓN</button><div class="export-actions" aria-label="Exportar ${label}"><button type="button" data-export="image">Exportar imagen</button><button type="button" data-export="text">Exportar texto</button></div></div>`;
      document.querySelector('#categories').append(card);
      const state = { category, label, players, card, body: card.querySelector('tbody'), status: card.querySelector('.status'), button: card.querySelector('.draw-button'), revision: saved?.revision || 0, drawn: Boolean(saved), dirty: false, timer: null, saving: false };
      state.status.id = `status-${category}`;
      state.hasResults = Boolean(saved?.tiene_resultados);
      state.button.disabled = realCount < 2 || (window.LipaSlots.enabled(category) && realCount>window.LipaSlots.capacity(category));
      message(state, saved ? (valid ? 'Orden guardado recuperado.' : 'Cambiaron los participantes. Repetí el sorteo.') : 'Listo para sortear.', saved ? (valid ? 'saved' : 'error') : '');
      if (realCount < 2) message(state, 'Se necesitan al menos dos jugadores para sortear.');
      if (window.LipaSlots.enabled(category) && realCount>window.LipaSlots.capacity(category)) message(state, `Esta grilla admite hasta ${window.LipaSlots.capacity(category)} jugadores.`, 'error');
      state.button.addEventListener('click', () => toggle(state));
      card.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => exportPlayers(state, button.dataset.export)));
      states.push(state);
      renderRows(state);
      new ResizeObserver(() => fit(state)).observe(card.querySelector('.table-wrap'));
    }
    document.fonts?.ready.then(() => states.forEach(fit));
  }
  window.addEventListener('beforeunload', event => {
    if (states.some(state => state.dirty || state.saving)) { event.preventDefault(); event.returnValue = ''; }
  });
  load().catch(error => { document.querySelector('#pageMessage').textContent = error.message; });
})();
