(()=>{
 const container=document.querySelector('#categories'),status=document.querySelector('#status');
 let data=[],busy=false;
 container.addEventListener('error',event=>{const image=event.target;if(image.tagName==='IMG'&&!image.dataset.fallback){image.dataset.fallback='1';image.src='/logo_liga.png';}},true);
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function render(){
  const query=normalize(document.querySelector('#search').value.trim());
  container.innerHTML=data.map(d=>{
   const title=d.category==='segunda'?'Segunda':'Tercera';
   if(d.error)return `<section><div class="section-head"><h2>${title}</h2></div><p class="error">${escape(d.error)}</p></section>`;
   const champion=d.rows.find(r=>r.position===1),rows=d.rows.filter(r=>normalize(r.nombre).includes(query));
   return `<section><div class="section-head"><div><h2>${title}</h2><p>${d.rows.length} participantes · ${d.matches} partidos terminados · ${d.finished?'Final disputada':'Clasificación provisional'}</p></div>${champion?`<div class="winner">CAMPEÓN<br><strong>${escape(champion.nombre)}</strong></div>`:''}</div><div class="table-wrap"><table><thead><tr><th>POS.</th><th>JUGADOR</th><th>INSTANCIA</th><th title="Partidos jugados">PJ</th><th title="Partidos ganados">PG</th><th title="Partidos perdidos">PP</th><th title="Marcador de la ronda de eliminación o de la final">ÚLTIMA RONDA</th><th title="Diferencia de puntos en esa ronda: primer desempate">DIF. RONDA</th><th title="Triángulos a favor">TRIÁNG. +</th><th title="Triángulos en contra">TRIÁNG. −</th><th title="Diferencia acumulada: segundo desempate">DIF. TOTAL</th><th title="Porcentaje de partidos ganados">% VICT.</th><th title="Promedio de duración de partidos cronometrados">PROM. MIN</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.position<=3&&r.position?'podium':''}"><td class="position">${r.position?`${r.position}°`:'—'}</td><td><div class="player"><img src="${escape(r.fotoUrl||'/logo_liga.png')}" alt="" loading="lazy">${escape(r.nombre)}</div></td><td class="stage">${escape(r.stage)}</td><td>${r.played}</td><td class="win">${r.won}</td><td>${r.lost}</td><td>${r.roundFor==null?'—':r.roundFor+'–'+r.roundAgainst}</td><td>${r.roundDiff==null?'—':(r.roundDiff>0?'+':'')+r.roundDiff}</td><td>${r.for}</td><td>${r.against}</td><td>${r.diff>0?'+':''}${r.diff}</td><td>${r.played?Math.round(r.won/r.played*100)+'%':'—'}</td><td class="metrics">${r.timed?Math.round(r.seconds/r.timed/60):'—'}</td></tr>`).join('')||'<tr><td colspan="13" class="empty">No hay jugadores con ese nombre.</td></tr>'}</tbody></table></div></section>`;
  }).join('');
 }
 async function load(){
  if(busy)return;busy=true;document.querySelector('#refresh').disabled=true;status.textContent='Actualizando resultados…';
  try{
   const response=await fetch('./resultados.json',{cache:'no-store'});if(!response.ok)throw Error('No se pudieron cargar los resultados. Intentá actualizar.');
   const snapshot=await response.json();data=['segunda','tercera'].map(category=>({category,...window.LipaEstadisticas.calculate(snapshot.categories[category],category)}));
   render();status.textContent='Resultados publicados · '+new Date(snapshot.capturedAt).toLocaleDateString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'});
  }catch(error){status.textContent='No se pudieron cargar los resultados. Tocá Actualizar para reintentar.';}
  busy=false;document.querySelector('#refresh').disabled=false;
 }
 document.querySelector('#search').addEventListener('input',render);document.querySelector('#refresh').addEventListener('click',load);document.querySelector('#print').addEventListener('click',()=>window.print());load();
})();
