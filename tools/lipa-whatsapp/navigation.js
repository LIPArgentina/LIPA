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

 // Every result is resolved from the exact number search, never the LIPA name.
 const digits=value=>String(value||'').replace(/\D/g,'');
 const inputs=searchInputs();
 if(inputs.length!==1||digits(inputs[0].value??inputs[0].innerText??inputs[0].textContent)!==digits(contact.phone))return {waiting:true,diagnostic:{reason:'search-not-exact'}};
 const searchRect=inputs[0].getBoundingClientRect();
 const eligible=el=>{const r=el.getBoundingClientRect();return visible(el)&&!el.closest('#main,header')&&r.y>=searchRect.y+searchRect.height&&r.x>=searchRect.x-32&&r.x+r.width<=searchRect.x+searchRect.width+32&&point(el);};
 const textOf=el=>String(el.innerText||el.textContent||el.getAttribute('title')||'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim();
 const isPhone=text=>/^\+?[\d\s().-]+$/.test(text);
 let pane=inputs[0].parentElement;
 while(pane&&pane!==document.body){
   const nodes=[...pane.querySelectorAll('[role="listitem"],[role="row"],span,[dir="auto"]')].filter(eligible);
   const phones=nodes.filter(el=>isPhone(textOf(el))&&digits(textOf(el))===digits(contact.phone));
   // A repeated phone heading/subtitle identifies the same destination.
   if(phones.length)return {target:point(phones[0])};
   const rows=nodes.filter(el=>['row','listitem'].includes(el.getAttribute('role')));
   const leafRows=rows.filter(el=>!rows.some(other=>other!==el&&el.contains(other)));
   const labels=nodes.filter(el=>textOf(el)&&!isPhone(textOf(el))&&!/^(usuarios que|contacts|contactos|nuevo |new |buscar|search)/i.test(textOf(el)));
   const candidates=leafRows.length?leafRows:labels;
   if(candidates.length){
     const groups=new Map();
     for(const el of candidates){
       let group=el.closest('[role="row"],[role="listitem"]');
       // Name and subtitle may both carry title/dir attributes. Group by avatar row.
       if(!group){let parent=el.parentElement;while(parent&&parent!==pane){if(parent.querySelector('img,[data-icon="default-user"],[data-icon="default-contact"]')){group=parent;break;}parent=parent.parentElement;}}
       group=group||el;
       if(!groups.has(group))groups.set(group,el);
     }
     const entries=[...groups.entries()];
     const unique=entries.filter(([group])=>!entries.some(([other])=>other!==group&&other.contains(group)));
     if(unique.length===1)return {target:point(unique[0][1])};
     return {waiting:true,diagnostic:{reason:'multiple-results',rows:leafRows.length,labels:labels.length,groups:unique.length}};
   }
   pane=pane.parentElement;
 }
 return {waiting:true,diagnostic:{reason:'no-result-elements'}};
}
