// Uses only visible WhatsApp controls; never navigates or sends a message.
function lipaOpenChat(contact,stage){
 const visible=el=>Boolean(el&&el.getClientRects().length);
 function point(el){if(!visible(el))return null;const r=el.getBoundingClientRect();for(const [fx,fy] of [[.5,.5],[.2,.5],[.8,.5]]){const x=r.x+r.width*fx,y=r.y+r.height*fy,hit=document.elementFromPoint(x,y);if(hit&&(hit===el||el.contains(hit)))return {x,y};}return null;}
 if(location.origin!=='https://web.whatsapp.com')return {error:'La pestaña no es WhatsApp Web.'};
 if(stage==='new'){
 const controls=[...new Set([...document.querySelectorAll('[aria-label="Nuevo chat"],[title="Nuevo chat"],[aria-label="New chat"],[title="New chat"],[data-icon="new-chat-outline"],[data-icon="new-chat"]')].filter(visible).map(el=>el.closest('button,[role="button"],[tabindex="0"]')).filter(Boolean))];
 if(controls.length===1&&point(controls[0]))return {target:point(controls[0])};return {error:'No se encontró el botón Nuevo chat. No se recargó WhatsApp.'};
 }
 if(stage==='search'){
 const inputs=[...document.querySelectorAll('[contenteditable="true"][role="textbox"],input[type="text"]')].filter(el=>visible(el)&&!el.closest('#main'));
 const labeled=inputs.filter(el=>/buscar|search|nombre|number|número/i.test((el.getAttribute('aria-label')||'')+' '+(el.getAttribute('placeholder')||'')));
 const candidates=labeled.length?labeled:inputs;if(candidates.length===1&&point(candidates[0]))return {target:point(candidates[0])};return {waiting:true};
 }
 const name=String(contact.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const rows=[...document.querySelectorAll('[role="listitem"],[role="row"]')].filter(el=>visible(el)&&!el.closest('#main'));
 const numberMatches=rows.filter(el=>String(el.innerText||'').replace(/\D/g,'').includes(contact.phone));
 const nameMatches=rows.filter(el=>name&&String(el.innerText||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split('\n').some(line=>line.trim()===name));
 const matches=(numberMatches.length?numberMatches:nameMatches).filter((el,_,all)=>!all.some(other=>other!==el&&other.contains(el)));
 if(matches.length===1&&point(matches[0]))return {target:point(matches[0])};return {waiting:true};
}
