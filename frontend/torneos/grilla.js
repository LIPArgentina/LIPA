(() => {
  'use strict';
  if (window.LPI_AUTH?.readSession?.()?.role !== 'torneo') {
    location.replace(`/auth/login.html?return=${encodeURIComponent(location.pathname)}`); return;
  }
  const engine = window.LipaBracket, $ = s => document.querySelector(s);
  const API = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  let category='primera', data=null, state=null, pending=null, saving=false, requestId=0, conflicted=false;
  let view='double', zoom=1;
  try { view=localStorage.getItem('lipa.bracket.view') || 'double'; } catch (_) {}
  if(!['simple','double'].includes(view)) view='double';
  const dimensions=[];
  async function api(method, body) {
    const response=await fetch(`${API}/api/torneo-organizador/grilla/${category}`, {
      method, credentials:'include', headers:{'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000)
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw Object.assign(new Error(result.error || 'No se pudo conectar con el servidor.'),{status:response.status,code:result.code});
    return result;
  }
  function status(text,error=false) { $('#saveStatus').textContent=text; $('#saveStatus').classList.toggle('error',error); }
  function matchLabel(match) {
    if(match.id.startsWith('qualifier')) return 'Clasificado del repechaje';
    if(match.bye) return 'Pase libre';
    const [round,index]=match.id.split('-');
    const title=round==='p'?'Primera ronda':round.startsWith('r')
      ? 'Repechaje · '+(category==='tercera'?['Primera rueda','Ronda de 16','Ronda de 8','Clasificación']:['Primera rueda','Cuartos','Semifinal','Final']).slice(4-(state?.rep.length || 4))[Number(round.slice(1))]
      : (category==='tercera'?['','Dieciseisavos','Octavos','Cuartos','Semifinal','Final']:['','Octavos','Cuartos','Semifinal','Final'])[Number(round.slice(1))];
    return `${title}, partido ${Number(index)+1}`;
  }
  function photo(player) {
    const img=document.createElement('img'); img.alt=''; img.loading='lazy';
    img.src=player?.foto_path ? `${API}/api/players-admin/photo/${encodeURIComponent(player.foto_path)}` : '../logo_liga.png';
    img.addEventListener('error',()=>{img.src='../logo_liga.png';},{once:true}); return img;
  }
  const preview=$('#playerPreview');
  let previewPoint={x:0,y:0};
  function placePreview() {
    if(!preview.open)return;
    const margin=8, width=document.documentElement.clientWidth, height=window.innerHeight;
    const bounds=preview.getBoundingClientRect();
    let left=previewPoint.x+8,top=previewPoint.y+8;
    if(left+bounds.width>width-margin)left=previewPoint.x-bounds.width-8;
    if(top+bounds.height>height-margin)top=previewPoint.y-bounds.height-8;
    preview.style.left=`${Math.max(margin,Math.min(left,width-bounds.width-margin))}px`;
    preview.style.top=`${Math.max(margin,Math.min(top,height-bounds.height-margin))}px`;
  }
  function openPreview(player,event,trigger) {
    const bounds=trigger.getBoundingClientRect();
    previewPoint=event.detail===0?{x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2}:{x:event.clientX,y:event.clientY};
    $('#previewName').textContent=player.nombre;
    const img=photo(player);img.alt=`Foto de ${player.nombre}`;img.loading='eager';
    $('#previewPhoto').replaceChildren(img);
    preview.showModal();placePreview();
  }
  function enablePreview(node,player) {
    if(!player || player.id===null)return;
    node.classList.add('player-peek');node.setAttribute('role','button');node.tabIndex=0;
    node.setAttribute('aria-haspopup','dialog');node.setAttribute('aria-label',`Ampliar foto de ${player.nombre}`);
    node.addEventListener('click',event=>openPreview(player,event,node));
    node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPreview(player,{detail:0},node);}});
  }
  $('#closePreview').addEventListener('click',()=>preview.close());
  preview.addEventListener('click',event=>{if(event.target===preview){const r=preview.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)preview.close();}});
  window.addEventListener('resize',placePreview);
  function playerRow(id, match, slot, players, label) {
    const p=players.get(id), row=document.createElement('div');
    const wo=slot===0?match.woA:match.woB;
    row.className=`player ${id && id===match.winner?'winner':''} ${!p?'placeholder':''} ${wo?'wo':''}`;
    const number=document.createElement('span');number.className='position';number.textContent=p?.position || (wo && match.id.startsWith('p-')?Number(match.id.split('-')[1])*2+slot+1:'—');
    const name=document.createElement('span');name.className='name';name.textContent=p?.nombre || (wo?'WO':label || 'Por definir');
    enablePreview(name,p);
    const select=document.createElement('select');
    select.setAttribute('aria-label',`${matchLabel(match)} · Puntos de ${p?.nombre || 'jugador por definir'}${p?'':' '+(slot+1)}`);
    select.dataset.match=match.id;select.dataset.slot=slot;
    const blank=document.createElement('option');blank.value='';blank.textContent='—';select.append(blank);
    for(let value=0;value<=engine.limits[category];value++) {const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}
    select.value=match.score[slot]===null?'':String(match.score[slot]);
    select.disabled=!match.a || !match.b || match.bye || Boolean(pending) || saving || conflicted;
    select.addEventListener('change',onScore);
    row.append(number,photo(p),name,select);return row;
  }
  function card(match, pos, board, players, isFinal, repechage) {
    const node=document.createElement('article');node.className=`match ${isFinal?'finalist':''} ${match.bye?'rep-pass':''}`;
    node.style.cssText=`left:${pos.x}px;top:${pos.y}px;width:${pos.width}px`;
    node.dataset.matchId=match.id;
    const label=document.createElement('p');label.className='match-label';
    label.textContent=match.id.startsWith('qualifier')?'CLASIFICADO DEL REPECHAJE':match.bye?(category==='primera'?'PASE LIBRE':'PASE AUTOMÁTICO · WO'):isFinal?(repechage?(category==='tercera'?'PARTIDO CLASIFICATORIO':'FINAL DEL REPECHAJE'):'FINAL'):`PARTIDO ${Number(match.id.split('-')[1])+1}`;
    node.append(label,playerRow(match.a,match,0,players,match.id.startsWith('qualifier')?'Ganador del repechaje':null));
    if(!match.id.startsWith('qualifier') && !(category==='primera' && match.bye))node.append(playerRow(match.b,match,1,players));
    board.append(node);
  }
  function renderBoard(rounds, boardId, frameId, repechage=false) {
    const board=$(boardId),frame=$(frameId);board.replaceChildren();
    const W=206,G=28,TOP=45,depth=rounds.length-1,dual=view==='double';
    const initial=rounds[0].length, rows=dual?initial/2:initial;
    const STEP=rounds[depth].length>1?Math.max(96,dual?768/rows:180/Math.pow(2,depth)):96;
    const width=dual?(depth*2+1)*W+depth*2*G:(depth+2)*W+(depth+1)*G;
    const height=Math.max(rows*STEP+70,dual?560:0);
    const positions=new Map(), players=new Map(data.players.map(p=>[String(p.id),p]));
    const titles=repechage?(category==='tercera'?['Primera rueda','Ronda de 16','Ronda de 8','Clasificación']:['Primera rueda','Cuartos','Semifinal','Final']).slice(4-rounds.length):(category==='tercera'?['Primera ronda','Dieciseisavos','Octavos','Cuartos','Semifinal','Final']:['Primera ronda','Octavos','Cuartos','Semifinal','Final']);
    function title(text,x) {const el=document.createElement('div');el.className='round-title';el.style.cssText=`left:${x}px;width:${W}px`;el.textContent=text.toUpperCase();board.append(el);}
    rounds.forEach((round,r)=>{
      const half=round.length/2;
      round.forEach((match,i)=>{
        let x,y;
        if(!dual) { x=r*(W+G);y=TOP+((i+.5)*Math.pow(2,r)*STEP)-42; }
        else if(r===depth) {x=depth*(W+G);y=TOP+(i+.5)*rows*STEP/round.length-54;}
        else {const right=i>=half; x=(right?depth*2-r:r)*(W+G);y=TOP+((i%half+.5)*Math.pow(2,r)*STEP)-42;}
        positions.set(match.id,{x,y,width:W,center:y+(r===depth?56:44)});
      });
      title(titles[r],r*(W+G));
      if(dual && r<depth)title(titles[r],(depth*2-r)*(W+G));
    });
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('connectors');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('aria-hidden','true');
    rounds.slice(0,-1).forEach((round,r)=>round.forEach((match,i)=>{
      const from=positions.get(match.id), to=positions.get(rounds[r+1][Math.floor(i/2)].id),right=from.x>to.x;
      const x1=right?from.x:from.x+W,x2=right?to.x+W:to.x,mid=(x1+x2)/2;
      const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',`M ${x1} ${from.center} H ${mid} V ${to.center} H ${x2}`);svg.append(path);
    }));board.append(svg);
    rounds.forEach((round,r)=>round.forEach(match=>card(match,positions.get(match.id),board,players,r===depth,repechage)));
    let boardHeight=height;
    rounds[depth].forEach((final,index)=>{
    const fp=positions.get(final.id),winner=players.get(final.winner);
    const crown=document.createElement('div');crown.className='champion';
    const cx=dual?fp.x:(depth+1)*(W+G),cy=dual?fp.y+145:fp.center-65;
    crown.style.cssText=`left:${cx-8}px;top:${cy}px;width:${W+16}px`;
    const crownTitle=document.createElement('small');crownTitle.textContent=repechage?(category==='tercera'?`CLASIFICADO ${index+1} · RONDA DE 32`:'CLASIFICADO A OCTAVOS'):'★ CAMPEÓN ★';
    const winnerName=document.createElement('strong');winnerName.textContent=winner?.nombre || (repechage?(category==='tercera'?'Un lugar entre los 32':'Un lugar entre los 16'):'Esperando al campeón');
    enablePreview(winnerName,winner);
    crown.append(crownTitle,photo(winner),winnerName);board.append(crown);
    const finalPath=document.createElementNS(svg.namespaceURI,'path');
    finalPath.setAttribute('d',dual?`M ${fp.x+W/2} ${fp.y+110} V ${cy}`:`M ${fp.x+W} ${fp.center} H ${cx}`);svg.append(finalPath);
    boardHeight=Math.max(boardHeight,cy+145);
    });
    dimensions.push({board,frame,width,height:boardHeight});
  }
  function applyZoom() {
    dimensions.forEach(({board,frame,width,height})=>{board.style.width=`${width}px`;board.style.height=`${height}px`;board.style.transform=`scale(${zoom})`;frame.style.width=`${width*zoom}px`;frame.style.height=`${height*zoom}px`;});
    $('#zoom').value=Math.round(zoom*100);$('#zoomValue').textContent=`${Math.round(zoom*100)}%`;
  }
  function fit() { if(!dimensions.length)return; const width=$('#mainFrame').parentElement.clientWidth-24;zoom=Math.max(.35,Math.min(1,width/dimensions[0].width));if(innerWidth<760)zoom=.85;applyZoom(); }
  function render() {
    if(!data || !state)return;
    dimensions.length=0;
    $('#viewToggle').textContent=`VISUALIZACIÓN · ${view==='double'?'DOBLE':'SIMPLE'}`;
    $('#viewToggle').setAttribute('aria-label',`Visualización ${view==='double'?'doble':'simple'}. Cambiar a ${view==='double'?'simple':'doble'}`);
    renderBoard(state.main,'#mainBoard','#mainFrame');renderBoard(state.rep,'#repBoard','#repFrame',true);
    const byeNames=(state.byes || []).map(bye=>{
      const player=data.players.find(p=>String(p.id)===bye.id);
      return `${player.nombre} (${bye.points} a favor, diferencia ${bye.diff}, ${player.ranking?'ranking #'+player.ranking:'sin ranking'})`;
    });
    $('#byeNote').textContent=byeNames.length
      ? `Pase libre: ${byeNames.join('; ')}.${state.rankingFallback?' Igualdad sin desempate de ranking: se conserva la prioridad del orden del sorteo.':''}`
      : state.firstComplete?'Repechaje formado con los perdedores de los partidos jugados.':'El pase libre se define al completar los partidos jugados de primera ronda: puntos a favor, diferencia y ranking general LIPA. Los WO no participan del repechaje.';
    const realCount=data.players.filter(p=>p.id!==null).length;
    const capacity=category==='tercera'?60:30;
    $('#mainSection .badge').textContent=realCount===capacity?`${capacity} jugadores + repechaje`:`${realCount} jugadores · ${capacity-realCount} WO + repechaje`;
    $('#repSection .badge').textContent=category==='tercera'?'2 clasificados a la ronda de 32':'1 clasificado a octavos';
    applyZoom();
  }
  function confirmCorrection() {
    const dialog=$('#correctionDialog');dialog.showModal();
    return new Promise(resolve=>{
      const done=value=>{dialog.close();$('#confirmCorrection').onclick=null;$('#cancelCorrection').onclick=null;dialog.oncancel=null;resolve(value);};
      $('#confirmCorrection').onclick=()=>done(true);$('#cancelCorrection').onclick=()=>done(false);dialog.oncancel=e=>{e.preventDefault();done(false);};
    });
  }
  function lockTabs(value) {document.querySelectorAll('[data-category]').forEach(button=>button.disabled=value);}
  async function onScore(event) {
    if(pending || saving || conflicted)return;
    const input=event.currentTarget, match=state.matches.find(m=>m.id===input.dataset.match);
    const score=[...match.score];score[Number(input.dataset.slot)]=input.value===''?null:Number(input.value);
    const next=engine.build(data.players,{...state.clean,[match.id]:{a:match.a,b:match.b,score}},category);
    const affected=engine.invalidated(state,next,match.id);
    if(affected.length && !await confirmCorrection()){render();return;}
    pending={matchId:match.id,score,revision:data.revision,drawRevision:data.drawRevision,confirmCorrection:affected.length>0};
    state=next;lockTabs(true);render();await persist();
  }
  async function persist() {
    if(!pending || saving)return;saving=true;$('#retrySave').hidden=true;status('Guardando resultado…');
    try {
      const result=await api('PATCH',pending);
      data.results=result.results;data.revision=result.revision;state=engine.build(data.players,data.results,category);
      pending=null;status(result.cleared.length?'Guardado. Se actualizaron los cruces afectados.':'Todos los resultados guardados.');lockTabs(false);
    } catch(error) {
      status(error.message || 'No se pudo guardar el resultado.',true);
      conflicted=error.status===409;$('#reload').hidden=!conflicted;$('#retrySave').hidden=conflicted;
    } finally {saving=false;render();}
  }
  async function load() {
    const request=++requestId;data=null;state=null;conflicted=false;$('#emptyState').hidden=true;$('#mainSection').hidden=true;$('#repSection').hidden=true;$('#reload').hidden=true;status('Cargando grilla…');
    try {
      const response=await api('GET');if(request!==requestId)return;
      data=response;state=engine.build(data.players,data.results,category);
      $('#mainSection').hidden=false;$('#repSection').hidden=false;status('Resultados guardados automáticamente.');render();fit();
    } catch(error) {
      if(request!==requestId)return;status('No se pudo abrir esta categoría.',true);
      const box=$('#emptyState');box.replaceChildren();const p=document.createElement('p');p.textContent=error.message;const a=document.createElement('a');a.href='./sorteo.html';a.textContent='Ir al sorteo';box.append(p,a);box.hidden=false;$('#reload').hidden=false;
    }
  }
  document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{
    if(pending || saving)return;category=button.dataset.category;
    document.querySelectorAll('[data-category]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));
    $('#bracketPanel').setAttribute('aria-labelledby',button.id);load();
  }));
  $('#viewToggle').addEventListener('click',()=>{view=view==='double'?'simple':'double';try{localStorage.setItem('lipa.bracket.view',view);}catch(_){}render();fit();});
  $('#zoom').addEventListener('input',event=>{zoom=Number(event.target.value)/100;applyZoom();});
  $('#fitView').addEventListener('click',fit);$('#retrySave').addEventListener('click',persist);
  $('#reload').addEventListener('click',()=>{pending=null;lockTabs(false);$('#retrySave').hidden=true;load();});
  window.addEventListener('beforeunload',event=>{if(pending || saving){event.preventDefault();event.returnValue='';}});
  load();
})();
