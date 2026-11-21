(() => {
 'use strict';
 const params=new URLSearchParams(location.search),viewer=params.get('visor')==='1',rotating=true,mode='auto';
 const board=document.getElementById('tv'),status=document.getElementById('screenStatus'),API=String(window.APP_CONFIG?.API_BASE_URL||'').replace(/\/+$/,'');
 const back=document.getElementById('back');back.href='/torneos/grilla.html';back.onclick=function(e){if(window.parent!==window){e.preventDefault();window.parent.postMessage('lipa-tv-menu',location.origin);}};
 const categories=['tercera','segunda'],cache=new Map(),errors=new Map();let page=0,loading=false,signature='';
 const ns='http://www.w3.org/2000/svg';
 function photo(p){const img=document.createElement('img');img.alt='';img.src=p?.fotoUrl?new URL(p.fotoUrl,API||location.origin).href:'../logo_liga.png';img.onerror=()=>{img.onerror=null;img.src='../logo_liga.png';};return img;}
 function player(id,score,players,wo,winner){const el=document.createElement('div');el.className='tv-player'+(winner&&id===winner?' winner':'');const p=players.get(id),name=document.createElement('span'),points=document.createElement('span');name.className='name';name.textContent=p?.nombre||(wo?'WO':'');points.className='points';points.textContent=score===null||score===undefined?'—':score;el.append(photo(p),name,points);return el;}
 function drawing(title,width,height){const tile=document.createElement('section'),root=document.createElement('div'),h=document.createElement('h2'),svg=document.createElementNS(ns,'svg');tile.className='tile';root.className='drawing';root.style.width=width+'px';root.style.height=height+'px';tile.dataset.width=width;tile.dataset.height=height;h.textContent=title;svg.setAttribute('class','tv-lines');svg.setAttribute('width',width);svg.setAttribute('height',height);root.append(svg,h);tile.append(root);const data=cache.get(title.toLowerCase().split(' · ')[0]);return {tile,root,svg,timings:data?.timings||{},offset:data?.timeOffset||0};}
 function line(d,x1,y1,x2,y2){const path=document.createElementNS(ns,'path'),mid=(x1+x2)/2;path.setAttribute('d','M '+x1+' '+y1+' H '+mid+' V '+y2+' H '+x2);d.svg.append(path);}
 function card(d,m,x,y,players,w=200){const el=document.createElement('div');el.className='tv-match';el.dataset.match=m.id;el.style.cssText='left:'+x+'px;top:'+y+'px;width:'+w+'px';el.append(player(m.a,m.score[0],players,m.woA,m.winner),player(m.b,m.score[1],players,m.woB,m.winner));window.LipaMatchClock?.paint(el,d.timings?.[m.id],d.offset||0);d.root.append(el);return {x,y,center:y+38,width:w};}
 function qualified(d,m,x,y,players,champion=false){const el=document.createElement('div');el.className='tv-qualified';el.style.cssText='left:'+x+'px;top:'+y+'px;width:'+(champion?200:260)+'px';const title=document.createElement('strong');title.textContent=champion?'CAMPEÓN':'CLASIFICADO';const row=player(m.winner,null,players,false,null);row.lastElementChild.remove();el.append(title,row);d.root.append(el);}
 function groupTile(category,state,group,players){const d=drawing(category.toUpperCase()+' · GRUPO '+group.number,1360,540),pos=new Map();
 const add=(m,x,y)=>pos.set(m.id,card(d,m,x,y,players,260));
 group.initial.forEach((m,i)=>add(m,690,70+i*100));group.winners.forEach((m,i)=>add(m,970,95+i*340));group.losers.forEach((m,i)=>add(m,410,95+i*340));group.recovery.forEach((m,i)=>add(m,130,95+i*340));
 for(const m of [...group.winners,...group.losers,...group.recovery])m.sources.forEach((src,i)=>{if(group.recovery.includes(m)&&i===1)return;const a=pos.get(src.matchId),b=pos.get(m.id),left=a.x>b.x;line(d,left?a.x:a.x+260,a.center,left?b.x+260:b.x,b.y+(i?57:19));});
 group.recovery.forEach((m,i)=>{const y=245+i*90,p=pos.get(m.id);qualified(d,m,0,y,players);line(d,p.x+130,i?p.y:p.y+76,130,i?y+56:y);});
 group.winners.forEach((m,i)=>{const y=245+i*90,p=pos.get(m.id);qualified(d,m,1100,y,players);line(d,p.x+130,i?p.y:p.y+76,1230,i?y+56:y);});
 return d.tile;
 }
 function knockoutTile(category,state,players){const rounds=state.knockout,depth=rounds.length-1,width=(depth*2+1)*220,height=Math.max(360,rounds[0].length/2*100+62),d=drawing(category.toUpperCase(),width,height),pos=new Map();
 rounds[0].forEach((m,i)=>{const half=rounds[0].length/2,right=i>=half;pos.set(m.id,card(d,m,right?depth*440:0,44+(right?i-half:i)*100,players));});
 for(let r=1;r<=depth;r++)rounds[r].forEach((m,i)=>{const a=pos.get(m.sources[0].matchId),b=pos.get(m.sources[1].matchId),right=i>=rounds[r].length/2,x=r===depth?depth*220:right?(depth*2-r)*220:r*220,y=(a.y+b.y)/2;pos.set(m.id,card(d,m,x,y,players));for(const from of [a,b])line(d,from.x>x?from.x:from.x+200,from.center,from.x>x?x+200:x,y+34);});
 const final=pos.get(state.final.id);qualified(d,state.final,final.x,final.y+105,players,true);line(d,final.x+100,final.y+70,final.x+100,final.y+125);return d.tile;
 }
 function resize(){
 const count=board.children.length,small=window.innerWidth<=700,gap=small?3:5,top=small?42:46;
 const cols=mode==='groups'&&!rotating?(small?2:3):1,rows=Math.max(1,Math.ceil(count/cols));
 const availableW=board.clientWidth-gap*2,availableH=board.clientHeight-top-gap;
 for(let i=0;i<count;i++){const tile=board.children[i],row=Math.floor(i/cols);
 const weighted=mode!=='groups'&&!rotating&&count===2;
 const h=weighted?(availableH-gap)*(i===0?2/3:1/3):(availableH-gap*(rows-1))/rows;
 tile.style.position='absolute';tile.style.width=(availableW-gap*(cols-1))/cols+'px';tile.style.height=h+'px';
 tile.style.left=gap+(i%cols)*(availableW+gap)/cols+'px';tile.style.top=(weighted?(i===0?top:top+(availableH-gap)*2/3+gap):top+row*(h+gap))+'px';
 }
 for(const tile of board.children){const root=tile.querySelector('.drawing');if(!root)continue;const scale=Math.min(tile.clientWidth/Number(tile.dataset.width),tile.clientHeight/Number(tile.dataset.height));root.style.transform='scale('+scale+')';root.style.left=(tile.clientWidth-Number(tile.dataset.width)*scale)/2+'px';root.style.top=(tile.clientHeight-Number(tile.dataset.height)*scale)/2+'px';}}
 let slideKind='groups';
 function render(){const slides=[];for(const category of categories){const data=cache.get(category);if(!data)continue;const state=LipaBracket.build(data.players,data.results,category),players=new Map(data.players.filter(p=>p.id!==null).map(p=>[String(p.id),p]));
 const selection=LipaTVSelect(state,category,data),groups=selection.groups;
 for(let i=0;i<groups.length;i+=2)slides.push({kind:'groups',tiles:groups.slice(i,i+2).map(g=>groupTile(category,state,g,players))});
 if(selection.knockout)slides.push({kind:'knockout',tiles:[knockoutTile(category,state,players)]});
 }page=((page%Math.max(1,slides.length))+Math.max(1,slides.length))%Math.max(1,slides.length);const slide=slides[page];slideKind=slide?.kind||'groups';board.className='rotation'+(slideKind==='knockout'?' single':'');board.replaceChildren(...(slide?.tiles||[]));
 if(!slide){const empty=document.createElement('div');empty.className='tv-empty';empty.textContent='Esperando próximos partidos';board.append(empty);}resize();}
 async function get(category){const response=await fetch(API+'/api/torneo-visor/tv/'+category,{credentials:'omit',cache:'no-store',signal:window.LipaTVSignal(20000)});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'No se pudo actualizar'),{status:response.status});return data;}
 function timedGet(category){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('La conexión demoró demasiado')),22000);get(category).then(data=>{clearTimeout(timer);resolve(data);},error=>{clearTimeout(timer);reject(error);});});}
 async function refresh(){if(loading)return;loading=true;await Promise.all(categories.map(async category=>{try{const data=await timedGet(category);data.timeOffset=data.serverTime?data.serverTime-Date.now():0;cache.set(category,data);errors.delete(category);}catch(e){errors.set(category,category.toUpperCase()+': '+(cache.has(category)?'sin actualizar':e.message));if(e.status===404||e.status===409||e.status===422)cache.delete(category);}}));loading=false;status.textContent=[...errors.values()].join(' · ');const next=JSON.stringify([...cache]);if(next!==signature){signature=next;render();}}
 window.addEventListener('resize',resize);if(window.ResizeObserver)new ResizeObserver(resize).observe(board);refresh();setInterval(refresh,3000);if(rotating){
 let paused=false,timer=null;
 const controls=document.createElement('nav');controls.className='tv-rotation-controls';controls.setAttribute('aria-label','Controles de rotación');
 function button(text,label,action){const b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-label',label);b.title=label;b.onclick=action;controls.append(b);return b;}
 function schedule(){clearInterval(timer);if(!paused)timer=setTimeout(()=>{page++;render();schedule();},slideKind==='groups'?10000:20000);}
 button('◀','Cuadro anterior',()=>{page--;render();schedule();});
 const toggle=button('Ⅱ Pausa','Pausar rotación',()=>{paused=!paused;toggle.textContent=paused?'▶ Reanudar':'Ⅱ Pausa';toggle.setAttribute('aria-label',paused?'Reanudar rotación':'Pausar rotación');toggle.setAttribute('aria-pressed',String(paused));schedule();});toggle.setAttribute('aria-pressed','false');
 button('▶','Cuadro siguiente',()=>{page++;render();schedule();});
 button('Pantalla completa','Pantalla completa',()=>{const el=document.documentElement,enter=el.requestFullscreen||el.webkitRequestFullscreen||el.webkitRequestFullScreen;try{if(enter){const p=enter.call(el);if(p?.catch)p.catch(()=>{status.textContent='Pantalla completa no disponible en este navegador';});}}catch(e){status.textContent='Pantalla completa no disponible';}});document.body.append(controls);document.body.className+=' has-rotation-controls';schedule();
 }document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();