(() => {
  'use strict';
  if (window.LPI_AUTH?.readSession?.()?.role !== 'torneo') {
    location.replace(`/auth/login.html?return=${encodeURIComponent(location.pathname)}`);
    return;
  }
  const API = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const states = [];
  const alphabetical=document.querySelector('#alphabetical');
  let ordering=false;
  alphabetical.onclick=async()=>{
    if(ordering||states.length!==2||states.some(s=>s.timer||s.saving||s.dirty||s.invalidSize))return;
    if(!confirm('¿Reemplazar los sorteos de prueba de Segunda y Tercera por orden alfabético? Se reiniciarán sus grillas.'))return;
    ordering=true;alphabetical.disabled=true;alphabetical.textContent='ORDENANDO…';
    try{
      for(const state of states){
        const sorted=state.players.filter(p=>p.id!==null).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es',{sensitivity:'base',numeric:true}));
        let i=0;state.players=state.players.map(p=>p.id===null?p:sorted[i++]);
        state.dirty=true;state.resetResults=true;renderRows(state);await save(state);
        if(state.dirty)throw Error('No se pudo guardar '+state.label+'. '+state.status.textContent);
      }
      document.querySelector('#pageMessage').textContent='Segunda y Tercera guardadas en orden alfabético.';
    }catch(error){document.querySelector('#pageMessage').textContent=error.message;}
    finally{ordering=false;alphabetical.textContent='Ordenar listas A–Z';alphabetical.disabled=false;}
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  async function api(path, options = {}) {
    const response = await fetch(`${API}/api/torneo-organizador/sorteos${path}`, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo conectar con el servidor.'), { status: response.status });
    return data;
  }
  const tableDialog=document.querySelector('#tableDialog'), tableForm=document.querySelector('#tableForm');
  const manageTables=document.querySelector('#manageTables'), saveTables=document.querySelector('#saveTables');
  const cancelTables=document.querySelector('#cancelTables'), tableStatus=document.querySelector('#tableStatus');
  const tableFloors=document.querySelector('#tableFloors');
  let tableRevision=null;
  manageTables.onclick=async()=>{
    manageTables.disabled=true;
    tableRevision=null;saveTables.disabled=true;tableFloors.replaceChildren();
    tableStatus.textContent='Cargando mesas…';tableDialog.showModal();
    try{
      const settings=await api('/mesas');
      for(const [floor,numbers] of Object.entries(LipaMesas.pisos)){
        const group=document.createElement('fieldset'),legend=document.createElement('legend'),list=document.createElement('div');
        legend.textContent=floor==='arriba'?'Arriba':'Abajo';group.append(legend,list);
        for(const number of numbers){
          const label=document.createElement('label'),box=document.createElement('input');
          box.type='checkbox';box.name='mesa';box.value=floor+'-'+number;box.checked=settings.enabled.includes(box.value);
          label.append(box,'Mesa '+number);list.append(label);
        }
        tableFloors.append(group);
      }
      tableRevision=settings.revision;saveTables.disabled=false;tableStatus.textContent='';
    }catch(error){tableStatus.textContent=error.message;}
    finally{manageTables.disabled=false;}
  };
  cancelTables.onclick=()=>tableDialog.close();
  tableDialog.addEventListener('cancel',event=>{if(cancelTables.disabled)event.preventDefault();});
  tableForm.onsubmit=async event=>{
    event.preventDefault();
    if(saveTables.disabled || tableRevision===null)return;
    const enabled=new FormData(tableForm).getAll('mesa');
    saveTables.disabled=cancelTables.disabled=true;
    for(const group of tableFloors.children)group.disabled=true;
    tableStatus.textContent='Guardando mesas…';
    try{
      await api('/mesas',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled,revision:tableRevision})});
      tableDialog.close();
    }catch(error){
      tableStatus.textContent=error.message;
      saveTables.disabled=error.status===409;
    }finally{
      cancelTables.disabled=false;
      for(const group of tableFloors.children)group.disabled=false;
    }
  };
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
    const rowHeight = Math.max(14, Math.min(28, Math.floor((wrap.clientHeight - 21) / Math.max(1, state.category==='tercera'?Math.ceil(state.players.length/2):state.players.length))));
    state.card.style.setProperty('--row-height', `${rowHeight}px`);
    state.card.style.setProperty('--name-size', `${Math.max(11, Math.min(14, rowHeight - 2))}px`);
    state.card.querySelectorAll('.name').forEach(name => {
      name.style.transform = '';
      const available = name.clientWidth;
      if (available && name.scrollWidth > available) name.style.transform = `scaleX(${available / name.scrollWidth})`;
    });
  }
  function updateExports(state) {
    alphabetical.disabled=ordering||states.length!==2||states.some(s=>s.timer||s.saving||s.dirty||s.invalidSize);
    state.card.querySelectorAll('[data-export]').forEach(button => {
      button.disabled = Boolean(state.sizeChanged || state.invalidSize || state.dirty || state.saving || state.exporting || !state.players.some(player => player.id != null));
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
    const rows = state.players.filter(player => player.id != null).map((player, index) => ({ name: player.nombre, position:index + 1 }));
    if (!rows.length) return;
    const title = state.label.toUpperCase();
    const filename = 'lipa-inscriptos-' + state.category;
    state.exporting = true; updateExports(state);
    try {
      if (format === 'text') {
        const text = title + '\r\n\r\n' + rows.map(row => row.position + '. ' + row.name).join('\r\n');
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
        const top = 130;
        const prepared = rows.map(row => ({...row, lines:wrap(row.name, nameFont, nameWidth)}));
        const height = top + prepared.reduce((sum,row) => sum + Math.max(58,row.lines.length * 36 + 22),0) + 48;
        canvas.width = width; canvas.height = height;
        ctx.fillStyle = '#080a0d'; ctx.fillRect(0,0,width,height);
        const headingY = 82;
        ctx.fillStyle = '#ffc400'; ctx.font = '900 54px Montserrat, sans-serif'; ctx.fillText(title,48,headingY);
        ctx.fillStyle = '#ffc400'; ctx.fillRect(48,top-18,984,3);
        let y = top;
        prepared.forEach((row,i) => {
          const rowHeight = Math.max(58,row.lines.length*36+22);
          ctx.fillStyle = i%2 ? '#101318' : '#17191e'; ctx.fillRect(48,y,984,rowHeight);
          ctx.font = '600 26px Montserrat, sans-serif'; ctx.fillStyle = '#ffdc65'; ctx.fillText(String(row.position),64,y+38);
          ctx.font = nameFont; ctx.fillStyle = '#ffffff'; row.lines.forEach((line,j) => ctx.fillText(line,145,y+38+j*36));
          y += rowHeight;
        });
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
    const bodies=[...state.card.querySelectorAll('tbody')];bodies.forEach(body=>body.replaceChildren());
    const split=Math.ceil(state.players.length/2);
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
      bodies[state.category==='tercera'&&index>=split?1:0].append(row);
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
    state.sizeInput.disabled=true;
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
      state.sizeChanged=false;
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
      state.sizeInput.disabled=false;
      updateExports(state);
      state.button.disabled = false;
    }
  }
  async function toggle(state) {
    if (ordering || state.saving || state.exporting || state.invalidSize) return;
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
    state.sizeInput.disabled=true;
    state.timer = setInterval(() => shuffle(state), 500);
  }
  async function load() {
    const data = await api('');
    document.querySelector('#tournamentName').textContent = data.nombre;
    const missing = data.jugadores.filter(player => !player.categoria).length;
    document.querySelector('#pageMessage').textContent = missing
      ? `${missing} jugador(es) confirmado(s) sin categoría: asignala en Inscripciones para incluirlos.`
      : '';
    for (const [category, label] of [['segunda', 'Segunda'], ['tercera', 'Tercera']]) {
      let players = data.jugadores.filter(player => window.LipaCategories.includes(player.categoria, category) && (!player.pagos_categoria?.[category] || ['sena','total','efectivo'].includes(player.pagos_categoria[category].estado_pago)));
      const realCount = players.length;
      const saved = data.sorteos.find(draw => draw.categoria === category);
      const byId = new Map(players.map(player => [String(player.id), player]));
      const order = Array.isArray(saved?.orden) ? saved.orden.map(id=>id===null?null:String(id)) : [];
      const valid = Boolean(saved) && window.LipaSlots.validOrder(order, [...byId.keys()], category,order.length);
      const chosenSize=saved?Math.max(2,order.length):Math.max(2,realCount);
      players = valid ? order.map(id=>id===null?{id:null,nombre:'WO',wo:true}:byId.get(id)) : window.LipaSlots.fill(players,category,Math.max(chosenSize,realCount));
      const card = document.createElement('section');
      card.className = 'category category-' + category; card.setAttribute('aria-labelledby', `heading-${category}`);
      card.innerHTML = `<div class="category-heading"><h2 id="heading-${category}">${label.toUpperCase()}</h2><label class="size-label">Lugares <input class="draw-size" type="number" min="2" step="1" value="${chosenSize}" aria-label="Cantidad de lugares de ${label}"></label><span class="count">${realCount} jugadores${players.length>realCount?` · ${players.length-realCount} WO`:''}</span></div><div class="table-wrap"><table aria-label="Posiciones de ${label}"><thead><tr><th scope="col">N.º</th><th scope="col">Jugador</th></tr></thead><tbody></tbody></table></div><div class="category-footer"><p class="status" role="status"></p><div class="draw-actions"><button type="button" class="draw-button" aria-describedby="status-${category}">SORTEAR POSICIÓN</button><a class="grid-link" href="./grilla.html?categoria=${category}" aria-label="Ver grilla de ${label}">VER GRILLA</a></div><div class="export-actions" aria-label="Exportar ${label}"><button type="button" data-export="image">Exportar imagen</button><button type="button" data-export="text">Exportar texto</button></div></div>`;
      if(category==='tercera'){
        const wrap=card.querySelector('.table-wrap'),second=wrap.querySelector('table').cloneNode(true);
        second.setAttribute('aria-label','Posiciones de Tercera · segunda columna');wrap.append(second);
      }
      document.querySelector('#categories').append(card);
      const state = { category, label, players, card, body: card.querySelector('tbody'), status: card.querySelector('.status'), button: card.querySelector('.draw-button'), revision: saved?.revision || 0, drawn: Boolean(saved), dirty: false, timer: null, saving: false };
      state.sizeInput=card.querySelector('.draw-size');
      function resize(){
        const size=Number(state.sizeInput.value);
        state.invalidSize=!Number.isSafeInteger(size)||size<2||size<realCount;
        state.button.disabled=state.invalidSize||realCount<2;
        if(state.invalidSize){message(state,`Error: hay ${realCount} jugadores habilitados. Elegí al menos ${Math.max(2,realCount)} lugares.`,'error');updateExports(state);return;}
        state.players=window.LipaSlots.fill(state.players.filter(p=>p.id!==null),category,size);
        state.sizeChanged=true;
        card.querySelector('.count').textContent=`${realCount} jugadores · ${size-realCount} WO`;
        message(state,'Cantidad ajustada. Sorteá y detené para guardar.');renderRows(state);updateExports(state);
      }
      state.sizeInput.addEventListener('input',resize);
      state.status.id = `status-${category}`;
      state.hasResults = Boolean(saved?.tiene_resultados);
      state.button.disabled = realCount < 2;
      message(state, saved ? (valid ? 'Orden guardado recuperado.' : 'Cambiaron los participantes. Repetí el sorteo.') : 'Listo para sortear.', saved ? (valid ? 'saved' : 'error') : '');
      if (realCount < 2) message(state, 'Se necesitan al menos dos jugadores para sortear.');
      state.button.addEventListener('click', () => toggle(state));
      card.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => exportPlayers(state, button.dataset.export)));
      if(chosenSize<realCount)resize();
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
