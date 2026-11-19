(() => {
  'use strict';
  const viewer=document.body.dataset.viewer==='true';
  if (!viewer && window.LPI_AUTH?.readSession?.()?.role !== 'torneo') {
    location.replace(`/auth/login.html?return=${encodeURIComponent(location.pathname)}`); return;
  }
  const engine = window.LipaBracket, $ = s => document.querySelector(s);
  const API = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const requestedCategory=new URLSearchParams(location.search).get('categoria');
  let category=['primera','segunda','tercera'].includes(requestedCategory)?requestedCategory:'primera', data=null, state=null, pending=null, saving=false, requestId=0, conflicted=false;
  let view='double', zoom=1;
  try { view=localStorage.getItem('lipa.bracket.view') || 'double'; } catch (_) {}
  if(!['simple','double'].includes(view)) view='double';
  document.querySelectorAll('[data-category]').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.category===category)));
  const dimensions=[];
  async function api(method, body) {
    if(viewer){if(method!=='GET')throw new Error('El visor es de solo lectura.');return LipaViewer.api('grilla/'+category);}
    const response=await fetch(`${API}/api/torneo-organizador/grilla/${category}`, {
      method, credentials:'include', headers:{'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000)
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw Object.assign(new Error(result.error || 'No se pudo conectar con el servidor.'),{status:response.status,code:result.code});
    return result;
  }
  function status(text,error=false) { $('#saveStatus').textContent=text; $('#saveStatus').classList.toggle('error',error); }
  function matchLabel(match) {return match.label||match.id;}
  function sourceLabel(source){
    if(!source?.matchId)return 'Por definir';
    const parts=source.matchId.match(/^(?:de|mx)-([wlk])(\d+)-(\d+)$/);
    const code=parts?(parts[1]==='w'?'G':parts[1]==='l'?'P':'E')+(Number(parts[2])+1)+'-'+(Number(parts[3])+1):'Final';
    return (source.outcome==='loser'?'Pierde ':'Gana ')+code;
  }
  function photo(player) {
    const img=document.createElement('img'); img.alt=''; img.loading='lazy';
    img.src=player?.fotoUrl ? API+player.fotoUrl : '../logo_liga.png';
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
  function openPreview(player,event,trigger,match) {
    const bounds=trigger.getBoundingClientRect();
    previewPoint=event.detail===0?{x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2}:{x:event.clientX,y:event.clientY};
    $('#previewName').textContent=player.nombre;
    const img=photo(player);img.alt=`Foto de ${player.nombre}`;img.loading='eager';
    $('#previewPhoto').replaceChildren(img);
    const contact=$('#previewContact');contact.hidden=viewer || !match?.a || !match?.b;
    contact.onclick=async()=>{
      contact.disabled=true;
      try{const result=await organizerAction('contactar',match,{playerId:player.id,...matchLocation(match)});location.href=result.url;}
      catch(error){status(error.message,true);}finally{contact.disabled=false;}
    };
    preview.showModal();placePreview();
  }
  function enablePreview(node,player,match) {
    if(!player || player.id===null)return;
    node.classList.add('player-peek');node.setAttribute('role','button');node.tabIndex=0;
    node.setAttribute('aria-haspopup','dialog');node.setAttribute('aria-label',`Ampliar foto de ${player.nombre}`);
    node.addEventListener('click',event=>openPreview(player,event,node,match));
    node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPreview(player,{detail:0},node,match);}});
  }
  $('#closePreview').addEventListener('click',()=>preview.close());
  preview.addEventListener('click',event=>{if(event.target===preview){const r=preview.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)preview.close();}});
  window.addEventListener('resize',placePreview);
  function playerRow(id, match, slot, players, label) {
    const p=players.get(id), row=document.createElement('div');
    const wo=slot===0?match.woA:match.woB;
    row.className=`player ${id && id===match.winner?'winner':''} ${!p?'placeholder':''} ${wo?'wo':''}`;
    const number=document.createElement('span');number.className='position';number.textContent=p?.position || (wo && match.id.startsWith('de-w0-')?Number(match.id.split('-').at(-1))*2+slot+1:'—');
    const name=document.createElement('span');name.className='name';name.textContent=p?.nombre || (wo?'WO':label || sourceLabel(match.sources?.[slot]));
    enablePreview(name,p,match);
    const select=document.createElement('select');
    select.setAttribute('aria-label',`${matchLabel(match)} · Puntos de ${p?.nombre || 'jugador por definir'}${p?'':' '+(slot+1)}`);
    select.dataset.match=match.id;select.dataset.slot=slot;
    const blank=document.createElement('option');blank.value='';blank.textContent='—';select.append(blank);
    for(let value=0;value<=engine.limits[category];value++) {const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}
    select.value=match.score[slot]===null?'':String(match.score[slot]);
    select.disabled=viewer || !match.a || !match.b || match.bye || Boolean(pending) || saving || conflicted;
    select.addEventListener('change',onScore);
    const portrait=photo(p);
    enablePreview(portrait,p,match);
    row.append(number,portrait,name,select);return row;
  }
  function card(match, pos, board, players, isFinal, repechage) {
    const node=document.createElement('article');node.className=`match ${isFinal?'finalist':''} ${match.bye?'rep-pass':''}`;
    node.style.cssText=`left:${pos.x}px;top:${pos.y}px;width:${pos.width}px`;
    node.dataset.matchId=match.id;
    const label=document.createElement('p');label.className='match-label';
    label.textContent=match.bye?'PASE AUTOMÁTICO · WO':match.id===state.final.id?'GRAN FINAL':match.label.replace('Ganadores · Ronda ','G').replace('Perdedores · Ronda ','P').replace('Eliminación directa · Ronda ','E');
    node.title=match.label+' — '+match.sources.map(sourceLabel).join(' / ');
    node.append(label,playerRow(match.a,match,0,players),callControls(match),playerRow(match.b,match,1,players));
    board.append(node);
  }
  function matchLocation(match){
    const node=document.querySelector('[data-match-id="'+match.id+'"]');
    return {mesa:Number(node?.querySelector('.match-table')?.value),piso:node?.querySelector('.match-floor')?.value||''};
  }
  async function organizerAction(action,match,extra={}){
    const response=await fetch(API+'/api/torneo-organizador/grilla/'+category+'/'+action,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId:match.id,revision:data.revision,drawRevision:data.drawRevision,...extra}),signal:AbortSignal.timeout(20000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'No se pudo completar.');return result;
  }
  function callControls(match){
    const row=document.createElement('div');row.className='match-call';
    if(!match.a || !match.b || match.bye)return row;
    const saved=data.assignments?.[match.id];
    const valid=saved && saved.a===match.a && saved.b===match.b;
    if(viewer){row.textContent=valid?'Mesa '+saved.mesa+' · '+saved.piso:'Mesa por asignar';return row;}
    const table=document.createElement('select');table.className='match-table';table.setAttribute('aria-label','Mesa de '+matchLabel(match));
    table.add(new Option('Mesa',''));for(let n=1;n<=19;n++)table.add(new Option(String(n),String(n)));
    const floor=document.createElement('select');floor.className='match-floor';floor.setAttribute('aria-label','Piso de '+matchLabel(match));
    floor.add(new Option('Piso',''));floor.add(new Option('Arriba','arriba'));floor.add(new Option('Abajo','abajo'));
    if(valid){table.value=saved.mesa;floor.value=saved.piso;}
    const button=document.createElement('button');button.className='call-match';button.textContent='🔔';button.title='Llamar a ambos jugadores';button.setAttribute('aria-label','Llamar a ambos jugadores');
    button.disabled=Boolean(match.winner)||saving||Boolean(pending);
    button.onclick=async()=>{
      const mesa=Number(table.value),piso=floor.value;
      if(!mesa || !piso){status('Elegí la mesa y el piso antes de llamar.',true);return;}
      button.disabled=true;
      try{const result=await organizerAction('llamar',match,{mesa,piso});data.assignments={...data.assignments,[match.id]:result.assignment};status('Llamado enviado a ambos jugadores.');}
      catch(error){status(error.message,true);}finally{button.disabled=Boolean(match.winner);}
    };
    row.append(table,floor,button);return row;
  }
  function renderBoard(rounds, boardId, frameId, repechage=false) {
    const board=$(boardId),frame=$(frameId);board.replaceChildren();
    const W=206,G=28,TOP=45,depth=rounds.length-1,dual=view==='double'&&!repechage;
    const {positions,width,height}=window.LipaBracketLayout.build(rounds,dual);
    const players=new Map(data.players.map(p=>[String(p.id),p]));
    const titles=rounds.map((round,index)=>{
      if(boardId==='#mainBoard')return 'Ganadores · Ronda '+(index+1);
      if(boardId==='#finalBoard')return round.length===1?'Final':round.length===2?'Semifinales':round.length===4?'Cuartos':round.length===8?'Octavos':round.length===16?'32 clasificados':'Eliminación directa · Ronda '+(index+1);
      if(repechage)return 'Repechaje · Ronda '+(index+1);
      return index===0?'Primera ronda':round.length===1?'Final':round.length===2?'Semifinal':round.length===4?'Cuartos':round.length===8?'Octavos':'Ronda '+(index+1);
    });
    function title(text,x) {const el=document.createElement('div');el.className='round-title';el.style.cssText=`left:${x}px;width:${W}px`;el.textContent=text.toUpperCase();board.append(el);}
    rounds.forEach((round,r)=>{
      title((titles[r] || 'Ronda '+(r+1)),r*(W+G));
      if(dual && boardId==='#mainBoard' && rounds.at(-1).length>1)title(titles[r],(depth*2+1-r)*(W+G));
      else if(dual && r<depth)title(titles[r],(depth*2-r)*(W+G));
    });
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('connectors');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('aria-hidden','true');
    rounds.forEach(round=>round.forEach(match=>{
      for(const source of match.sources||[]){
        const from=positions.get(source.matchId),to=positions.get(match.id);if(!from)continue;
        const right=from.x>to.x,x1=right?from.x:from.x+W,x2=right?to.x+W:to.x,mid=(x1+x2)/2;
        const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',`M ${x1} ${from.center} H ${mid} V ${to.center} H ${x2}`);svg.append(path);
      }
    }));board.append(svg);
    rounds.forEach((round,r)=>round.forEach(match=>card(match,positions.get(match.id),board,players,r===depth,repechage)));
    let boardHeight=height;
    if(boardId==='#finalBoard')rounds[depth].forEach((final,index)=>{
    const fp=positions.get(final.id),winner=players.get(final.winner);
    const crown=document.createElement('div');crown.className='champion';
    const cx=dual?fp.x:(depth+1)*(W+G),cy=dual?fp.y+185:fp.center-65;
    crown.style.cssText=`left:${cx-8}px;top:${cy}px;width:${W+16}px`;
    const crownTitle=document.createElement('small');crownTitle.textContent=repechage?(category==='tercera'?`CLASIFICADO ${index+1}`:'CLASIFICADO DEL REPECHAJE'):'★ CAMPEÓN ★';
    const winnerName=document.createElement('strong');winnerName.textContent=winner?.nombre || (repechage?(category==='tercera'?'Esperando clasificado':'Esperando clasificado'):'Esperando al campeón');
    enablePreview(winnerName,winner,final);
    crown.append(crownTitle,photo(winner),winnerName);board.append(crown);
    const finalPath=document.createElementNS(svg.namespaceURI,'path');
    finalPath.setAttribute('d',dual?`M ${fp.x+W/2} ${fp.y+150} V ${cy}`:`M ${fp.x+W} ${fp.center} H ${cx}`);svg.append(finalPath);
    boardHeight=Math.max(boardHeight,cy+145);
    });
    svg.setAttribute('height',boardHeight);
    dimensions.push({board,frame,width,height:boardHeight});
  }
  function applyZoom() {
    dimensions.forEach(({board,frame,width,height})=>{board.style.width=`${width}px`;board.style.height=`${height}px`;board.style.transform=`scale(${zoom})`;frame.style.width=`${width*zoom}px`;frame.style.height=`${height*zoom}px`;});
    $('#zoom').value=Math.round(zoom*100);$('#zoomValue').textContent=`${Math.round(zoom*100)}%`;
  }
  function fit() { if(!dimensions.length)return; const width=$('#mainFrame').parentElement.clientWidth-24;zoom=Math.max(.35,Math.min(1,width/Math.max(...dimensions.map(d=>d.width))));if(innerWidth<760)zoom=.85;applyZoom(); }
  function render() {
    if(!data || !state)return;
    dimensions.length=0;
    $('#viewToggle').textContent=`VISUALIZACIÓN · ${view==='double'?'DOBLE':'SIMPLE'}`;
    $('#viewToggle').setAttribute('aria-label',`Visualización ${view==='double'?'doble':'simple'}. Cambiar a ${view==='double'?'simple':'doble'}`);
    renderBoard(state.main,'#mainBoard','#mainFrame');
    $('#repSection').hidden=!state.rep.length;
    if(state.rep.length)renderBoard(state.rep,'#repBoard','#repFrame',true);
    renderBoard(state.knockout,'#finalBoard','#finalFrame');
    $('#byeNote').textContent='Segunda oportunidad para quienes pierden en las primeras dos rondas. Sus ganadores se unen a los invictos en la eliminación directa. Los WO dan pase automático.';
    const realCount=data.players.filter(p=>p.id!==null).length;
    $('#mainSection .badge').textContent=`${realCount} jugadores · ${state.bracketSize-realCount} pases automáticos`;
    $('#repSection .badge').textContent=state.rep.length?state.rep.at(-1).length+' lugares en eliminación directa':'';
    $('#finalSection .badge').textContent=state.knockout[0].length*2+' lugares · Una derrota elimina';
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
    const request=++requestId;data=null;state=null;conflicted=false;$('#emptyState').hidden=true;$('#mainSection').hidden=true;$('#repSection').hidden=true;$('#finalSection').hidden=true;$('#reload').hidden=true;status('Cargando grilla…');
    try {
      const response=await api('GET');if(request!==requestId)return;
      if(!viewer){const result=await fetch(API+'/api/torneo-organizador/grilla/'+category+'/llamados',{credentials:'include',cache:'no-store'});if(!result.ok)throw new Error('No se pudieron cargar las mesas.');response.assignments=(await result.json()).assignments;}
      if(request!==requestId)return;
      data=response;state=engine.build(data.players,data.results,category);
      $('#mainSection').hidden=false;$('#repSection').hidden=false;$('#finalSection').hidden=false;status(viewer?'Actualización automática cada 10 segundos.':data.legacyResults?'Formato actualizado: se conservan las primeras dos rondas compatibles; los resultados de las etapas reemplazadas quedan archivados.':'Resultados guardados automáticamente.');render();fit();
    } catch(error) {
      if(request!==requestId)return;status('No se pudo abrir esta categoría.',true);
      const box=$('#emptyState');box.replaceChildren();const p=document.createElement('p');p.textContent=error.message;const a=document.createElement('a');a.href=viewer?'./torneos.html':'./sorteo.html';a.textContent=viewer?'Volver a torneos':'Ir al sorteo';box.append(p,a);box.hidden=false;$('#reload').hidden=false;
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
  if(viewer){
    if(!LipaViewer.read()){location.replace('./torneos.html');return;}
    LipaViewer.api('session').then(user=>$('#viewerName').textContent=user.nombre).catch(error=>{if(error.status===401)location.replace('./torneos.html');else status(error.message,true);});
    $('#logoutViewer').onclick=()=>LipaViewer.logout().catch(error=>status(error.message,true));
    $('#enablePush').onclick=async()=>{const button=$('#enablePush');button.disabled=true;try{await LipaViewerPush();$('#pushStatus').textContent='Notificaciones activadas.';}catch(error){$('#pushStatus').textContent=error.message;}finally{button.disabled=false;}};
    if(window.AndroidBridge){$('#enablePush').hidden=true;$('#pushStatus').textContent='Mantené el visor abierto para recibir tus llamados a mesa.';}
    let refreshing=false;
    async function refresh(){
      if(document.hidden || refreshing)return;refreshing=true;
      try{
        const request=requestId, response=await api('GET');
        if(request!==requestId)return;
        if(!data || data.revision!==response.revision || data.drawRevision!==response.drawRevision ||
            JSON.stringify(data.assignments)!==JSON.stringify(response.assignments)){
          const firstLoad=!data;
          data=response;state=engine.build(data.players,data.results,category);
          $('#emptyState').hidden=true;$('#reload').hidden=true;$('#mainSection').hidden=false;$('#finalSection').hidden=false;
          render();if(firstLoad)fit();
        }
        status('Actualizado · '+new Date().toLocaleTimeString('es-AR'));
      }catch(error){if(error.status===401){location.replace('./torneos.html');return;}if(error.status===404 && data){load();return;}status(error.message,true);}
      finally{refreshing=false;}
    }
    let lastCall='0',checking=false;
    async function calls(){if(document.hidden||checking)return;checking=true;try{
      const result=await LipaViewer.api('avisos?after='+lastCall);
      const box=$('#personalCalls');
      result.avisos.forEach(call=>{const item=document.createElement('p');item.textContent=call.mensaje;box.prepend(item);box.hidden=false;lastCall=call.id;while(box.children.length>5)box.lastElementChild.remove();});
    }catch(error){if(error.status===401)location.replace('./torneos.html');}finally{checking=false;}}
    setInterval(refresh,10000);setInterval(calls,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();calls();}});calls();
  }
  load();
})();
