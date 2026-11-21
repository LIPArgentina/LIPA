(() => {
  'use strict';
  const viewer=document.body.dataset.viewer==='true';
  if (!viewer && window.LPI_AUTH?.readSession?.()?.role !== 'torneo') {
    location.replace(`/auth/login.html?return=${encodeURIComponent(location.pathname)}`); return;
  }
  const engine = window.LipaBracket, $ = s => document.querySelector(s);
  const topbar=$('.topbar');
  if(topbar){
    const syncHeaderHeight=()=>document.documentElement.style.setProperty('--tournament-header-height',`${topbar.getBoundingClientRect().height}px`);
    syncHeaderHeight();
    if('ResizeObserver' in window)new ResizeObserver(syncHeaderHeight).observe(topbar);
    else window.addEventListener('resize',syncHeaderHeight);
  }
  const API = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const requestedCategory=new URLSearchParams(location.search).get('categoria');
  let category=(viewer?['primera','segunda','tercera']:['segunda','tercera']).includes(requestedCategory)?requestedCategory:(viewer?'primera':'segunda'), data=null, state=null, pending=null, saving=false, requestId=0, conflicted=false;
  let view='double', zoom=1, fitBoards=false;
  try { view=localStorage.getItem('lipa.bracket.view') || 'double'; } catch (_) {}
  if(!['simple','double'].includes(view)) view='double';
  document.querySelectorAll('[data-category]').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.category===category)));
  const dimensions=[];
  async function api(method, body, suffix='') {
    if(viewer){if(method!=='GET')throw new Error('El visor es de solo lectura.');return LipaViewer.api('grilla/'+category);}
    const response=await fetch(`${API}/api/torneo-organizador/grilla/${category}${suffix}`, {
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
    if(source?.code)return source.code;
    if(!source?.matchId)return 'Por definir';
    const parts=source.matchId.match(/^(?:de|mx|gx)-([wlk])(\d+)-(\d+)$/);
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
    if(p && id)row.dataset.entrant=id;
    const wo=slot===0?match.woA:match.woB;
    row.className=`player ${id && id===match.winner?'winner':''} ${!p?'placeholder':''} ${wo?'wo':''}`;
    if(id && !data.present?.includes(id))row.classList.add('absent');
    const number=document.createElement('span');number.className='position';number.textContent=match.sources?.[slot]?.code || p?.position || (wo && match.id.startsWith('de-w0-')?Number(match.id.split('-').at(-1))*2+slot+1:'—');
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
    const identity=document.createElement('div');identity.className='player-identity';identity.append(name);
    if(id && p){const absent=document.createElement('small');absent.className='attendance-note';absent.textContent='Fuera de sala';identity.append(absent);}
    if(!viewer && p){
      const receipt=document.createElement('small');receipt.className='call-receipt';receipt.hidden=true;
      receipt.dataset.player=id;identity.append(receipt);
    }
    row.append(number,portrait,identity,select);return row;
  }
  function updateReceipts(card,assignment){
    const labels=card.querySelectorAll('.call-receipt');
    const valid=labels.length===2 && assignment?.a===labels[0].dataset.player && assignment.b===labels[1].dataset.player;
    card.classList.toggle('with-receipts',valid);
    labels.forEach(label=>{
      label.hidden=!valid;
      if(!valid)return;
      const confirmed=assignment.receipts?.[label.dataset.player];
      label.dataset.confirmed=String(confirmed);
      label.textContent=confirmed===true?'✓ Confirmó':confirmed===false?(assignment.recuperado?'Volver a llamar':'Pendiente'):'Sin registro';
      label.title='Confirmación del último llamado a mesa';
    });
  }
  function card(match, pos, board, players, isFinal, repechage) {
    const node=document.createElement('article');node.className=`match ${isFinal?'finalist':''} ${match.bye?'rep-pass':''}`;
    node.style.cssText=`left:${pos.x}px;top:${pos.y}px;width:${pos.width}px`;
    node.dataset.matchId=match.id;
    const label=document.createElement('p');label.className='match-label';
    label.textContent=match.bye?'PASE AUTOMÁTICO · WO':match.id===state.final.id?'GRAN FINAL':match.label.replace('Ganadores · Ronda ','G').replace('Perdedores · Ronda ','P').replace('Eliminación directa · Ronda ','E');
    node.title=match.label+' — '+match.sources.map(sourceLabel).join(' / ');
    node.append(label,playerRow(match.a,match,0,players),callControls(match),playerRow(match.b,match,1,players));
    if(!viewer)updateReceipts(node,data.assignments?.[match.id]);
    LipaMatchClock.paint(node,data.timings?.[match.id],data.timeOffset||0);
    board.append(node);
    return node;
  }
  function matchLocation(match){
    const node=document.querySelector('[data-match-id="'+match.id+'"]');
    const [piso,n]=(node?.querySelector('.match-table')?.value || '').split('-');
    return {mesa:Number(n)||0,piso};
  }
  async function organizerAction(action,match,extra={}){
    const response=await fetch(API+'/api/torneo-organizador/grilla/'+category+'/'+action,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId:match.id,revision:data.revision,drawRevision:data.drawRevision,...extra}),signal:AbortSignal.timeout(20000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'No se pudo completar.');return result;
  }
  const sendingCalls=new Set(),roomControls=new WeakMap();
  function syncRoomControls(){
    for(const row of document.querySelectorAll('#bracketPanel .player[data-entrant]'))row.classList.toggle('absent',!data.present?.includes(row.dataset.entrant));
    for(const row of document.querySelectorAll('#bracketPanel .match-call'))roomControls.get(row)?.();
  }
  let callChanges=0,readingCalls=false;
  async function refreshReceipts(){
    if(readingCalls || document.hidden || !data)return;
    const grid=data,version=callChanges;
    readingCalls=true;
    try{
      const info=await api('GET',null,'/llamados');
      if(grid!==data || grid.drawRevision!==info.drawRevision || version!==callChanges)return;
      if(info.revision>grid.revision && !pending && !saving && !publishing && !controlling && !sendingCalls.size){await load();return;}
      for(const card of document.querySelectorAll('article[data-match-id]')){
        const id=card.dataset.matchId,assignment=info.assignments[id],previous=grid.assignments?.[id];
        if(JSON.stringify(previous?.receipts)!==JSON.stringify(assignment?.receipts) || previous?.callId!==assignment?.callId){
          updateReceipts(card,assignment);
        }
      }
      grid.timings=info.timings||{};grid.timeOffset=info.serverTime?info.serverTime-Date.now():0;
      for(const node of document.querySelectorAll('article[data-match-id]'))LipaMatchClock.paint(node,grid.timings[node.dataset.matchId],info.serverTime?info.serverTime-Date.now():0);
      grid.assignments=info.assignments;
      grid.backupDate=info.backupDate;grid.published=info.published;updatePublication();
      if(JSON.stringify([grid.occupied,grid.present,grid.enabledTables])!==JSON.stringify([info.occupied,info.present,info.enabledTables])){
        grid.occupied=info.occupied;grid.present=info.present;grid.enabledTables=info.enabledTables;syncRoomControls();
      }
    }catch{/* Keep the last known confirmations until the next successful refresh. */}
    finally{readingCalls=false;}
  }
  let callHint;
  function closeCallHint(){
    if(!callHint)return;
    callHint.button.removeAttribute('aria-describedby');
    callHint.bubble.remove();callHint=null;
  }
  function showCallHint(button,message){
    closeCallHint();
    const bubble=document.createElement('div');
    bubble.className='call-hint';bubble.id='callHint';bubble.setAttribute('role','alert');
    bubble.textContent=message;document.body.append(bubble);
    button.setAttribute('aria-describedby',bubble.id);callHint={button,bubble};
    placeCallHint();
  }
  function placeCallHint(){
    if(!callHint)return;
    const {button,bubble}=callHint;
    const anchor=button.getBoundingClientRect(),bounds=bubble.getBoundingClientRect();
    if(!button.isConnected || !anchor.width || anchor.bottom<=0 || anchor.top>=innerHeight || anchor.right<=0 || anchor.left>=innerWidth){closeCallHint();return;}
    const right=anchor.right+8;
    bubble.style.left=Math.max(6,Math.min(right+bounds.width<=innerWidth-6?right:anchor.right-bounds.width,innerWidth-bounds.width-6))+'px';
    const top=right+bounds.width<=innerWidth-6?anchor.top:anchor.bottom+6;
    bubble.style.top=Math.max(6,top+bounds.height<=innerHeight-6?top:anchor.top-bounds.height-6)+'px';
  }
  document.addEventListener('pointerdown',event=>{if(callHint && event.target!==callHint.button)closeCallHint();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeCallHint();});
  window.addEventListener('scroll',placeCallHint,true);
  window.addEventListener('resize',placeCallHint);
  function callControls(match){
    const row=document.createElement('div');row.className='match-call';
    if(match.bye || (viewer && (!match.a || !match.b)))return row;
    const saved=data.assignments?.[match.id];
    const valid=saved && saved.a===match.a && saved.b===match.b;
    if(viewer){
      const location=match.winner?saved:data.reservations?.[match.id];
      row.textContent=location && location.a===match.a && location.b===match.b?'Mesa '+location.mesa+' · '+location.piso:'Mesa por asignar';return row;
    }
    const table=document.createElement('select');table.className='match-table';
    table.setAttribute('aria-label','Mesa y piso de '+matchLabel(match));
    const key=[category,data.drawRevision,match.id].join('/');
    const button=document.createElement('button');button.className='call-match';button.textContent='🔔';button.title='Llamar a ambos jugadores';button.setAttribute('aria-label',button.title);
    const reset=document.createElement('button');reset.type='button';reset.className='reset-match';reset.textContent='Reset';
    reset.setAttribute('aria-label','Resetear '+matchLabel(match));reset.onclick=()=>gridAction('partido',match);
    const own=t=>t.category===category && t.drawRevision===data.drawRevision && t.matchId===match.id && t.a===match.a && t.b===match.b;
    const playable=()=>Boolean(match.a && match.b && [match.a,match.b].every(id=>data.present?.includes(id)));
    const code=t=>t?t.piso+'-'+t.mesa:'';
    function options(){
      const occupied=data.occupied || [],mine=occupied.find(own);
      const location=match.winner && valid?saved:mine;
      table.replaceChildren(new Option(match.winner?'Sin mesa':location?'Liberar mesa':'Elegir mesa',''));
      if(match.winner && location)table.add(new Option('Mesa '+location.mesa+' · '+location.piso,code(location)));
      for(const [piso,numbers] of Object.entries(match.winner?{}:LipaMesas.pisos)){
        const group=document.createElement('optgroup');group.label=piso==='arriba'?'Arriba':'Abajo';
        for(const mesa of numbers){
          const selected=location?.piso===piso && location.mesa===mesa;
          if(!selected && data.enabledTables && !data.enabledTables.includes(piso+'-'+mesa))continue;
          if(!selected && (!playable() || occupied.some(t=>t.piso===piso && t.mesa===mesa && !own(t))))continue;
          group.append(new Option('Mesa '+mesa+' · '+piso,piso+'-'+mesa));
        }
        if(group.children.length)table.append(group);
      }
      table.value=code(location);
      button.disabled=Boolean(match.winner)||saving||Boolean(pending)||conflicted||sendingCalls.has(key);
      table.disabled=button.disabled || (!playable() && !mine);
      reset.disabled=saving || Boolean(pending) || conflicted || sendingCalls.size>0 || !(match.score.some(n=>n!==null) || mine || data.assignments?.[match.id]);
    }
    table.onchange=async()=>{
      const grid=data,previous=code((grid.occupied||[]).find(own)),[piso,n]=table.value.split('-');
      closeCallHint();sendingCalls.add(key);callChanges++;table.disabled=button.disabled=true;
      try{
        const result=await organizerAction('mesa',match,{mesa:n?Number(n):null,piso:piso||null,previous});
        grid.occupied=result.occupied;
        if(data===grid)status(n?'Mesa asignada.':'Mesa liberada.');
      }catch(error){if(data===grid){status(error.message,true);showCallHint(table,error.message);}}
      finally{
        sendingCalls.delete(key);callChanges++;
        if(data===grid){syncRoomControls();refreshReceipts();}
      }
    };
    roomControls.set(row,options);options();
    button.onclick=async()=>{
      closeCallHint();
      if(!match.a || !match.b){showCallHint(button,'El llamado espera a que se definan los dos jugadores.');return;}
      if(!playable()){const missing=data.players.filter(p=>[match.a,match.b].includes(p.id) && !data.present?.includes(p.id));showCallHint(button,'Falta marcar en sala a '+missing.map(p=>p.nombre).join(' y ')+'.');return;}
      const {mesa,piso}=matchLocation(match);
      if(!mesa || !piso){showCallHint(button,'Falta asignar la mesa y el piso.');return;}
      const grid=data;sendingCalls.add(key);table.disabled=button.disabled=true;
      try{
        const result=await organizerAction('llamar',match,{mesa,piso,requireReservation:true});
        callChanges++;
        const previous=grid.assignments?.[match.id];
        if(!previous?.callId || !result.assignment.callId || BigInt(previous.callId)<BigInt(result.assignment.callId)){
          grid.assignments={...grid.assignments,[match.id]:result.assignment};
        }

        if(data===grid){
          const card=document.querySelector('[data-match-id="'+match.id+'"]');
          if(card)updateReceipts(card,grid.assignments[match.id]);
          status('Llamado enviado a ambos jugadores.');
        }
      }catch(error){if(data===grid){status(error.message,true);if(button.isConnected)showCallHint(button,error.message);}}
      finally{
        sendingCalls.delete(key);
        if(data===grid){
          if(button.isConnected)options();else render();
        }
      }
    };
    row.append(table,button,reset);return row;
  }
  function renderBoard(rounds, boardId, frameId, repechage=false) {
    const board=$(boardId),frame=$(frameId);board.replaceChildren();
    const W=206,G=28,depth=rounds.length-1,dual=view==='double'&&!repechage;
    const {positions,width,height}=window.LipaBracketLayout.build(rounds,dual);
    const headerSpace=viewer?0:40;
    for(const pos of positions.values()){pos.y+=headerSpace;pos.center+=headerSpace;}
    const players=new Map(data.players.map(p=>[String(p.id),p]));
    const titles=rounds.map((round,index)=>{
      if(boardId==='#mainBoard')return 'Ganadores · Ronda '+(index+1);
      if(boardId==='#finalBoard')return round.length===1?'Final':round.length===2?'Semifinales':round.length===4?'Cuartos':round.length===8?'Octavos':round.length===16?'32 clasificados':'Eliminación directa · Ronda '+(index+1);
      if(repechage)return 'Repechaje · Ronda '+(index+1);
      return index===0?'Primera ronda':round.length===1?'Final':round.length===2?'Semifinal':round.length===4?'Cuartos':round.length===8?'Octavos':'Ronda '+(index+1);
    });
    const columns=new Map();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('connectors');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('aria-hidden','true');
    rounds.forEach(round=>round.forEach(match=>{
      for(const source of match.sources||[]){
        const from=positions.get(source.matchId),to=positions.get(match.id);if(!from)continue;
        const right=from.x>to.x,x1=right?from.x:from.x+W,x2=right?to.x+W:to.x,mid=(x1+x2)/2;
        const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',`M ${x1} ${from.center} H ${mid} V ${to.center} H ${x2}`);svg.append(path);
      }
    }));board.append(svg);
    rounds.forEach((round,r)=>round.forEach(match=>{
      const pos=positions.get(match.id);
      const node=card(match,pos,board,players,r===depth,repechage);
      if(!columns.has(pos.x))columns.set(pos.x,{title:titles[r],cards:[]});
      columns.get(pos.x).cards.push(node);
    }));
    for(const [x,column] of [...columns].sort((a,b)=>a[0]-b[0])){
      const el=document.createElement('div');el.className='round-title';
      el.style.cssText=`left:${x}px;width:${W}px`;el.textContent=column.title.toUpperCase();

      board.append(el);
    }
    let boardHeight=height+headerSpace;
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
  function renderGroups(){
    const board=$('#mainBoard'),frame=$('#mainFrame');board.replaceChildren();
    const players=new Map(data.players.map(p=>[String(p.id),p]));
    const width=1260,groupHeight=1000,height=state.groups.length*groupHeight;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('connectors');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('aria-hidden','true');board.append(svg);
    function textBox(text,x,y,cls='group-caption',w=240){if(cls!=='group-heading'&&cls!=='group-footer')x+=120;const el=document.createElement('div');el.className=cls;el.textContent=text;el.style.cssText='left:'+x+'px;top:'+y+'px;width:'+w+'px';board.append(el);return el;}
    function line(a,b){const mid=(a.x+b.x)/2;const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M '+a.x+' '+a.y+' H '+mid+' V '+b.y+' H '+b.x);svg.append(path);}
    state.groups.forEach(group=>{
      const top=(group.number-1)*groupHeight,positions=new Map();
      const heading=textBox('GRUPO '+group.number,0,top+10,'group-heading',width);
      const groupCards=[];
      textBox('PERDEDORES',0,top+65);textBox('PRIMERA RONDA',520,top+65);textBox('GANADORES',780,top+65);
      textBox('Cruce final',0,top+110);textBox('Primera instancia',260,top+110);textBox('8 jugadores',520,top+110);textBox('Segunda instancia',780,top+110);
      function place(m,x,y){x+=120;const pos={x,y:top+y,center:top+y+64,width:240};positions.set(m.id,pos);groupCards.push(card(m,pos,board,players,false,x<640));}
      group.initial.forEach((m,i)=>place(m,520,225+i*160));
      group.winners.forEach((m,i)=>place(m,780,275+i*380));
      group.losers.forEach((m,i)=>place(m,260,275+i*380));
      group.recovery.forEach((m,i)=>place(m,0,310+i*380));

      for(const m of [...group.winners,...group.losers,...group.recovery]){
        const to=positions.get(m.id);
        m.sources.forEach((src,i)=>{const from=positions.get(src.matchId);if(!from)return;
          if(group.recovery.includes(m)&&i===1)return;
          const left=from.x>to.x;line({x:left?from.x:from.x+240,y:from.center},{x:left?to.x+240:to.x,y:to.y+(i?102:30)});
        });
      }
      textBox('Pierde → A',780,top+425);textBox('Pierde → B',780,top+805);
      textBox('B · viene del cruce inferior',0,top+460);textBox('A · viene del cruce superior',0,top+840);
      function qualifier(m,code,x,i){const pos=positions.get(m.id),p=players.get(m.winner),el=textBox('',x,top+(i?590:500),'group-qualifier',240);const label=document.createElement('strong');label.textContent=code;const name=document.createElement('span');name.textContent=p?.nombre||'Por definir';enablePreview(name,p,m);el.append(label,photo(p),name);line({x:pos.x+120,y:i?pos.y:pos.y+128},{x:x+240,y:i?top+648:top+500});}
      group.winners.forEach((m,i)=>qualifier(m,group.codes.g[i],900,i));group.recovery.forEach((m,i)=>qualifier(m,group.codes.p[i],-120,i));
      textBox('A cruza abajo · B cruza arriba · Dos derrotas eliminan · Cuatro clasificados',0,top+940,'group-footer',width);
    });
    dimensions.push({board,frame,width,height});
  }
  function applyZoom() {
    dimensions.forEach(({board,frame,width,height})=>{const scale=fitBoards?Math.max(.35,Math.min(1.2,(frame.parentElement.clientWidth-24)/width)):zoom;board.style.width=`${width}px`;board.style.height=`${height}px`;board.style.transform=`scale(${scale})`;frame.style.width=`${width*scale}px`;frame.style.height=`${height*scale}px`;});
    $('#zoom').value=Math.round(zoom*100);$('#zoomValue').textContent=`${Math.round(zoom*100)}%`;
  }
  function fit() { if(!dimensions.length)return;fitBoards=innerWidth>=760;zoom=fitBoards?Math.max(.35,Math.min(1.2,($('#mainFrame').parentElement.clientWidth-24)/dimensions[0].width)):.85;applyZoom(); }
  function render() {
    closeCallHint();
    updatePublication();
    if(!data || !state)return;
    dimensions.length=0;
    $('#viewToggle').textContent=`VISUALIZACIÓN · ${view==='double'?'DOBLE':'SIMPLE'}`;
    $('#viewToggle').setAttribute('aria-label',`Visualización ${view==='double'?'doble':'simple'}. Cambiar a ${view==='double'?'simple':'doble'}`);
    $('#mainSection h2').textContent=state.groups?.length?'Fase de grupos':'Llave de ganadores';
    $('#mainSection .section-heading small').textContent=state.groups?.length?state.groups.length+' GRUPOS · 4 CLASIFICADOS POR GRUPO':'PRIMERAS DOS RONDAS';
    if(state.groups?.length)renderGroups();else renderBoard(state.main,'#mainBoard','#mainFrame');
    $('#repSection').hidden=Boolean(state.groups?.length)||!state.rep.length;
    if(!state.groups?.length&&state.rep.length)renderBoard(state.rep,'#repBoard','#repFrame',true);
    renderBoard(state.knockout,'#finalBoard','#finalFrame');
    if(!viewer)for(const [section,board,title] of [['#mainSection','#mainBoard','fase de grupos'],['#finalSection','#finalBoard','eliminación directa']]){
      const heading=$(section+' .section-heading');heading.querySelector('.column-search')?.remove();
      heading.append(LipaColumnSearch([$(board)],title,[category,data.drawRevision,section].join('/')));
    }
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
      data.results=result.results;data.timings=result.timings||data.timings;data.revision=result.revision;state=engine.build(data.players,data.results,category);
      data.occupied=(data.occupied || []).filter(t=>t.category!==category || state.matches.some(m=>m.id===t.matchId && !m.winner && m.a===t.a && m.b===t.b));
      pending=null;status(result.cleared.length?'Guardado. Se actualizaron los cruces afectados.':'Todos los resultados guardados.');lockTabs(false);
    } catch(error) {
      status(error.message || 'No se pudo guardar el resultado.',true);
      conflicted=error.status===409;$('#reload').hidden=!conflicted;$('#retrySave').hidden=conflicted;
    } finally {saving=false;render();}
  }
  function showPendingDraw(){
    data=null;state=null;dimensions.length=0;
    if(preview.open)preview.close();
    for(const section of ['#mainSection','#repSection','#finalSection'])$(section).hidden=true;
    for(const board of ['#mainBoard','#repBoard','#finalBoard'])$(board).replaceChildren();
    $('#reload').hidden=true;
    $('#emptyState').textContent='La grilla de esta categoría está pendiente de publicación.';
    $('#emptyState').hidden=false;
    status('El visor se actualiza automáticamente.');
  }
  let publishing=false;
  let controlling=false;
  async function gridAction(action,match){
    const grid=data;
    if(!grid || controlling || publishing || saving || pending || conflicted || sendingCalls.size)return;
    controlling=true;lockTabs(true);$('#bracketPanel').inert=true;updatePublication();
    const dialog=$('#gridActionDialog'),division=category.toUpperCase();
    try{
      // Capture the table/call version before opening the confirmation, including edits from this tab.
      const info=await api('GET',null,'/llamados');
      if(data!==grid || pending || saving || publishing || sendingCalls.size)return;
      if(info.drawRevision!==grid.drawRevision || info.revision!==grid.revision)throw new Error('La grilla cambió. Recargá la categoría.');
      const body={revision:grid.revision,drawRevision:grid.drawRevision,controlRevision:info.controlRevision,confirmar:true};
      let title,detail,accept;
      if(action==='partido'){
        body.matchId=match.id;
        title='¿Resetear este partido de '+division+'?';accept='Resetear partido';
        detail=matchLabel(match)+'. Se borrarán sus puntos, mesa y llamados. También se limpiarán los cruces posteriores cuyos jugadores cambien.';
      }else if(action==='resetear'){
        title='¿Resetear la grilla completa de '+division+'?';accept='Resetear grilla completa';
        detail='Se guardará una copia en la base de datos y se borrarán todos los resultados, mesas y llamados de esta categoría. El sorteo se conserva y la grilla quedará en borrador.';
      }else{
        if(!info.backupDate)throw new Error('Todavía no hay una copia para este sorteo.');
        title='¿Recargar la última grilla de '+division+'?';accept='Recargar última grilla';
        detail='La copia del '+new Date(info.backupDate).toLocaleString('es-AR')+' reemplazará los valores actuales de esta categoría. Las mesas volverán a asignarse y la grilla quedará en borrador. Para llamar a los jugadores, usá la campana.';
      }
      $('#gridActionTitle').textContent=title;$('#gridActionInfo').textContent=detail;$('#acceptGridAction').textContent=accept;
      dialog.returnValue='cancel';
      const confirmed=new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));
      dialog.showModal();
      if(!await confirmed || grid!==data)return;
      const previousZoom=zoom;
      await api('POST',body,'/control/'+action);
      await load();
      if(data && match){
        zoom=previousZoom;applyZoom();
        document.querySelector('[data-match-id="'+match.id+'"]')?.scrollIntoView({block:'center',inline:'nearest'});
      }
      if(data)status(action==='partido'?'Partido reseteado.':action==='resetear'?'Grilla reseteada. La copia quedó guardada.':'Última grilla recuperada.');
    }catch(error){status(error.message,true);$('#reload').hidden=false;}
    finally{controlling=false;$('#bracketPanel').inert=false;if(!pending && !saving)lockTabs(false);updatePublication();}
  }
  if(!viewer){
    $('#resetGrid').onclick=()=>gridAction('resetear');
    $('#restoreGrid').onclick=()=>gridAction('recuperar');
  }
  function updatePublication(){
    if(viewer || !$('#publication'))return;
    $('#publication').hidden=!data;
    if(!data)return;
    $('#publicationStatus').textContent=!data.canPublish?'':data.published?'Grilla publicada en '+category+'.':'Borrador de '+category+' · Los llamados llegan a los dos jugadores.';
    $('#publishGrid').hidden=!data.canPublish;
    $('#publishGrid').textContent=data.published?'Ocultar grilla':'Publicar grilla';
    const busy=publishing || controlling || saving || Boolean(pending) || conflicted;
    $('#publishGrid').disabled=busy;$('#resetGrid').disabled=busy;
    $('#restoreGrid').disabled=busy || !data.backupDate;
    $('#restoreGrid').title=data.backupDate?'Recuperar la copia anterior al último reset completo':'Primero guardá una copia con Resetear grilla completa';
  }
  if($('#publishGrid'))$('#publishGrid').onclick=async()=>{
    const grid=data;
    if(!grid?.canPublish || publishing || controlling || saving || pending || conflicted)return;
    const action=grid.published?'/ocultar':'/publicar';
    publishing=true;callChanges++;updatePublication();
    try {
      const result=await api('POST',{drawRevision:grid.drawRevision,revision:grid.revision},action);
      grid.published=result.published;
    } catch(error) {
      if(grid===data){status(error.message,true);$('#reload').hidden=false;}
    } finally {publishing=false;callChanges++;updatePublication();}
  };
  async function load() {
    closeCallHint();
    const request=++requestId;data=null;state=null;conflicted=false;$('#emptyState').hidden=true;$('#mainSection').hidden=true;$('#repSection').hidden=true;$('#finalSection').hidden=true;$('#reload').hidden=true;status('Cargando grilla…');
    updatePublication();
    try {
      const response=await api('GET');if(request!==requestId)return;
      if(!viewer){
        const result=await fetch(API+'/api/torneo-organizador/grilla/'+category+'/llamados',{credentials:'include',cache:'no-store'});
        if(!result.ok)throw new Error('No se pudieron cargar las mesas.');
        const info=await result.json();
        if(info.drawRevision!==undefined && info.drawRevision!==response.drawRevision)throw new Error('Cambió el sorteo. Recargá la categoría.');
        Object.assign(response,{timings:info.timings,timeOffset:info.serverTime?info.serverTime-Date.now():0,serverTime:info.serverTime,present:info.present,occupied:info.occupied,enabledTables:info.enabledTables,assignments:info.assignments,canPublish:info.canPublish,published:info.published,backupDate:info.backupDate});
      }
      if(request!==requestId)return;
      data=response;state=engine.build(data.players,data.results,category);
      $('#mainSection').hidden=false;$('#repSection').hidden=false;$('#finalSection').hidden=false;status(viewer?'Actualización automática cada 10 segundos.':data.legacyResults?'Formato actualizado: se conservan las primeras dos rondas compatibles; los resultados de las etapas reemplazadas quedan archivados.':'Resultados guardados automáticamente.');render();fit();
      const target=new URLSearchParams(location.search).get('partido');
      if(target){const node=[...document.querySelectorAll('article[data-match-id]')].find(el=>el.dataset.matchId===target);if(node){node.scrollIntoView({block:'center',inline:'center'});node.classList.add('waiting-target');}}
    } catch(error) {
      if(request!==requestId)return;
      if(viewer && error.status===404){showPendingDraw();return;}
      status('No se pudo abrir esta categoría.',true);
      const box=$('#emptyState');box.replaceChildren();const p=document.createElement('p');p.textContent=error.message;const a=document.createElement('a');a.href=viewer?'./torneos.html':'./sorteo.html';a.textContent=viewer?'Volver a torneos':'Ir al sorteo';box.append(p,a);box.hidden=false;$('#reload').hidden=false;
    }
  }
  document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{
    if(pending || saving)return;category=button.dataset.category;
    document.querySelectorAll('[data-category]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));
    $('#bracketPanel').setAttribute('aria-labelledby',button.id);load();
  }));
  $('#viewToggle').addEventListener('click',()=>{view=view==='double'?'simple':'double';try{localStorage.setItem('lipa.bracket.view',view);}catch(_){}render();fit();});
  $('#zoom').addEventListener('input',event=>{fitBoards=false;zoom=Number(event.target.value)/100;applyZoom();});
  $('#fitView').addEventListener('click',fit);$('#retrySave').addEventListener('click',persist);
  $('#reload').addEventListener('click',()=>{pending=null;lockTabs(false);$('#retrySave').hidden=true;load();});
  window.addEventListener('beforeunload',event=>{if(pending || saving){event.preventDefault();event.returnValue='';}});
  if(viewer){
    if(!LipaViewer.read()){location.replace('./torneos.html');return;}
    LipaViewer.api('session').then(user=>{
      $('#viewerName').textContent=user.nombre;
      if(requestId===0 && !['primera','segunda','tercera'].includes(requestedCategory) && ['primera','segunda','tercera'].includes(user.categoria)){
        category=user.categoria;
        document.querySelectorAll('[data-category]').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.category===category)));
        $('#bracketPanel').setAttribute('aria-labelledby','tab-'+category);
      }
    }).catch(error=>{if(error.status===401)location.replace('./torneos.html?listado=1');else status(error.message,true);})
      .finally(()=>{if(requestId===0 && LipaViewer.read())load();});
    $('#logoutViewer').onclick=()=>LipaViewer.logout().catch(error=>status(error.message,true));
    $('#enablePush').onclick=async()=>{const button=$('#enablePush');button.disabled=true;try{await LipaViewerPush();$('#pushStatus').textContent='Notificaciones activadas.';}catch(error){$('#pushStatus').textContent=error.message;}finally{button.disabled=false;}};
    if(window.AndroidBridge){
      $('#enablePush').hidden=true;
      $('#pushStatus').textContent='Activando notificaciones de la app…';
      window.LipaNativePushResult=(ok,message)=>{$('#pushStatus').textContent=message||(ok?'Notificaciones de la app activadas.':'No se pudieron activar las notificaciones.');};
      try{
        const accepted=window.AndroidBridge.registerTournamentPush(LipaViewer.read()?.token||'');
        if(!accepted)$('#pushStatus').textContent='Volvé a ingresar con tu DNI para activar las notificaciones.';
      }catch(_){$('#pushStatus').textContent='No se pudieron activar las notificaciones de la app.';}
    }
    let refreshing=false;
    async function refresh(){
      if(!requestId || document.hidden || refreshing)return;refreshing=true;
      const request=requestId;
      try{
        const response=await api('GET');
        if(request!==requestId)return;
        if(!data || data.revision!==response.revision || data.drawRevision!==response.drawRevision ||
            JSON.stringify(data.present)!==JSON.stringify(response.present) || JSON.stringify(data.reservations)!==JSON.stringify(response.reservations) || JSON.stringify(data.assignments)!==JSON.stringify(response.assignments)){
          const firstLoad=!data;
          data=response;state=engine.build(data.players,data.results,category);
          $('#emptyState').hidden=true;$('#reload').hidden=true;$('#mainSection').hidden=false;$('#finalSection').hidden=false;
          render();if(firstLoad)fit();
        }
        status('Actualizado · '+new Date().toLocaleTimeString('es-AR'));
      }catch(error){if(request!==requestId)return;if(error.status===401){location.replace('./torneos.html');return;}if(error.status===404){showPendingDraw();return;}status(error.message,true);}
      finally{refreshing=false;}
    }
    LipaViewerCalls();
    setInterval(refresh,10000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  }
  if(!viewer){
    setInterval(refreshReceipts,5000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshReceipts();});
  }
  if(!viewer)load();
})();
