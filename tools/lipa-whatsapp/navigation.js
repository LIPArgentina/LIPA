// Uses only visible WhatsApp controls; never navigates or sends a message.
function lipaOpenChat(contact,stage){
 const visible=el=>Boolean(el&&el.getClientRects().length);
 function point(el){if(!visible(el))return null;const r=el.getBoundingClientRect();for(const [fx,fy] of [[.5,.5],[.2,.5],[.8,.5]]){const x=r.x+r.width*fx,y=r.y+r.height*fy,hit=document.elementFromPoint(x,y);if(hit&&(hit===el||el.contains(hit)))return {x,y};}return null;}
 if(location.origin!=='https://web.whatsapp.com')return {error:'La pestaña no es WhatsApp Web.'};
 function searchInputs(){
 const inputs=[...document.querySelectorAll('[contenteditable="true"],input:not([type]),input[type="text"],input[type="search"],input[type="tel"],[role="searchbox"]')].filter(el=>visible(el)&&!el.closest('#main')&&point(el));
 const labeled=inputs.filter(el=>/buscar|search|nombre|number|número|núm/i.test((el.getAttribute('aria-label')||'')+' '+(el.getAttribute('placeholder')||'')+' '+(el.getAttribute('data-placeholder')||'')));
 const active=inputs.filter(el=>el===document.activeElement&&el.closest('[role="dialog"]'));
 return labeled.length?labeled:active.length?active:inputs;
 }
 if(stage==='new'){
 const controls=[...new Set([...document.querySelectorAll('[aria-label="Nuevo chat"],[title="Nuevo chat"],[aria-label="New chat"],[title="New chat"],[data-icon="new-chat-outline"],[data-icon="new-chat"]')].filter(visible).map(el=>el.closest('button,[role="button"],[tabindex="0"]')).filter(Boolean))];
 if(controls.length===1&&point(controls[0]))return {target:point(controls[0])};return {error:'No se encontró el botón Nuevo chat. No se recargó WhatsApp.'};
 }
 if(stage==='search'||stage==='typed'){
 const candidates=searchInputs();
 if(candidates.length!==1)return {waiting:true};
 const el=candidates[0];
 if(stage==='typed')return {ready:String(el.value??el.innerText??el.textContent??'').replace(/\D/g,'')===String(contact.phone).replace(/\D/g,'')};
 return {target:point(el)};
 }
 const name=String(contact.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const rows=[...document.querySelectorAll('[role="listitem"],[role="row"]')].filter(el=>visible(el)&&!el.closest('#main'));
 const numberMatches=rows.filter(el=>String(el.innerText||'').replace(/\D/g,'').includes(contact.phone));
 const nameMatches=rows.filter(el=>name&&String(el.innerText||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split('\n').some(line=>line.trim()===name));
 const matches=(numberMatches.length?numberMatches:nameMatches).filter((el,_,all)=>!all.some(other=>other!==el&&other.contains(el)));
 if(matches.length===1&&point(matches[0]))return {target:point(matches[0])};return {waiting:true};
}
