(()=>{'use strict';if(window.LPI_AUTH?.readSession?.()?.role!=='torneo'){location.replace('/auth/login.html?return='+encodeURIComponent(location.pathname));return;}
const $=id=>document.getElementById(id),api=String(window.APP_CONFIG?.API_BASE_URL||'').replace(/\/$/,''),normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();let last=null,busy=false;
const date=t=>t?new Date(t).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const table=e=>e.table?'Mesa '+e.table.mesa+' · '+e.table.piso:'—';
const duration=n=>n==null?'—':Math.floor(n/3600)+':'+String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
function cell(row,value){const el=document.createElement('td');el.textContent=value;row.append(el);return el;}
function render(){if(!last)return;$('waiting').replaceChildren();$('history').replaceChildren();$('count').textContent='('+last.waiting.length+')';
for(const e of last.waiting){const r=document.createElement('tr');cell(r,date(e.readyAt));cell(r,e.category.toUpperCase());const c=cell(r,''),a=document.createElement('a');a.href='./grilla.html?categoria='+encodeURIComponent(e.category)+'&partido='+encodeURIComponent(e.matchId);a.textContent=e.nameA+' vs. '+e.nameB;c.append(a);cell(r,e.label);cell(r,table(e));$('waiting').append(r);}
if(!last.waiting.length){const r=document.createElement('tr');cell(r,'No hay cruces pendientes de llamado.').colSpan=5;$('waiting').append(r);}
const query=normalize($('search').value),seen=new Set();
const arrivals=new Map((last.players||[]).map(p=>[p.category+'/'+p.id,Date.parse(p.llegadaAt)||0]));
const latest=new Map(arrivals);
for(const e of last.history)if(e.current&&!e.archived&&e.endedAt)for(const id of [e.a,e.b]){const key=e.category+'/'+id;latest.set(key,Math.max(latest.get(key)||0,Date.parse(e.endedAt)||0));}
for(const e of [...last.history].sort((a,b)=>a.readyAt.localeCompare(b.readyAt))){for(const side of ['A','B']){const id=side==='A'?e.a:e.b,name=e['name'+side]||id;seen.add(e.category+'/'+id);if(query&&!normalize(name).includes(query))continue;const r=document.createElement('tr');r.dataset.order=e.endedAt?(Date.parse(e.endedAt)||0):(e.current&&!e.archived?latest.get(e.category+'/'+id)||0:0);cell(r,name);cell(r,e.category.toUpperCase());const rival=cell(r,e[side==='A'?'nameB':'nameA']||'—'),label=document.createElement('small');label.textContent=e.label;rival.append(label);cell(r,table(e));cell(r,date(e.assignedAt));cell(r,date(e.startedAt));cell(r,date(e.endedAt));cell(r,duration(e.durationSeconds));const state=cell(r,e.archived||!e.current?'Histórico':e.status==='playing'?'En juego':e.status==='finished'?'Terminado':'En espera');state.className=e.status;$('history').append(r);}}
for(const p of last.players||[])if(!seen.has(p.category+'/'+p.id)&&(!query||normalize(p.nombre).includes(query))){const r=document.createElement('tr');r.dataset.order=latest.get(p.category+'/'+p.id)||0;cell(r,p.nombre);cell(r,p.category.toUpperCase());cell(r,'Sin cruce completo / pase WO');for(let i=0;i<5;i++)cell(r,'—');cell(r,'Esperando rival');$('history').append(r);}
$('history').append(...[...$('history').children].sort((a,b)=>Number(b.dataset.order)-Number(a.dataset.order)));
}
async function refresh(){if(busy)return;busy=true;try{const r=await fetch(api+'/api/torneo-organizador/lista-espera',{credentials:'include',cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(data.error||'No se pudo actualizar');last=data;render();$('status').textContent='Actualizado '+new Date().toLocaleTimeString('es-AR');}catch(e){$('status').textContent=e.message;}finally{busy=false;}}
$('search').oninput=render;refresh();setInterval(refresh,5000);
})();
