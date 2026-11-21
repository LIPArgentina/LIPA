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
 const clean=value=>String(value||'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim();
 const phoneKey=value=>{let n=clean(value).replace(/\D/g,'');if(n.startsWith('0054'))n=n.slice(2);if(n.startsWith('549')&&n.length===13)return n.slice(3);if(n.startsWith('54')&&n.length===12)return n.slice(2);return n;};
 const samePhone=(a,b)=>phoneKey(a).length>=10&&phoneKey(a)===phoneKey(b);
 const newChatOpen=()=>[...document.querySelectorAll('h1,h2,header,span')].some(el=>visible(el)&&/^(Nuevo chat|New chat)$/.test(clean(el.textContent)));
 if(stage==='closed'){
 const selection=globalThis.__lipaSelection;
 if(newChatOpen()||!selection||selection.phone!==contact.phone)return {closed:false,diagnostic:{reason:newChatOpen()?'result-not-opened':'selection-missing'}};
 const main=document.querySelector('#main'),header=main?.querySelector('[data-testid="conversation-info-header-button"]')||main?.querySelector('header');
 if(!header||!main.querySelector('footer [contenteditable="true"][role="textbox"]'))return {closed:false};
 const labels=[...header.querySelectorAll('span[title],span[dir],a[href^="tel:"]')].filter(visible).map(el=>clean(el.getAttribute('title')||el.textContent));
 const matches=labels.some(label=>label===selection.label||samePhone(label,contact.phone));
 const changed=header!==selection.previousHeader||header.textContent!==selection.previousLabel||selection.previouslySame;
 if(!changed)return {closed:false,diagnostic:{reason:'waiting-selected-chat'}};
 globalThis.__lipaRecipient={main,header,label:header.textContent,phone:contact.phone,at:Date.now()};
 return {closed:true};
 }

 if(stage==='new'){
 const main=document.querySelector('#main'),header=main?.querySelector('[data-testid="conversation-info-header-button"]')||main?.querySelector('header');
 const proof=globalThis.__lipaRecipient;
 globalThis.__lipaNavigation={previousHeader:header,previousLabel:header?.textContent,previouslySame:proof?.phone===contact.phone&&proof.header===header&&proof.label===header?.textContent};
 delete globalThis.__lipaSelection;
 delete globalThis.__lipaRecipient;delete globalThis.__lipaMedia;delete globalThis.__lipaArmed;
 if(newChatOpen())return {ready:true};
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
 if(stage==='focusResult'){
  const selection=globalThis.__lipaSelection,el=selection?.element;
  if(!newChatOpen()||selection?.phone!==contact.phone||!el?.isConnected||!visible(el)||!point(el))return {focused:false};
  const target=el.closest('[tabindex],[role=button],[role=row],[role=listitem]')||el;
  if(target.closest('#main,header'))return {focused:false};
  if(!target.hasAttribute('tabindex'))target.setAttribute('tabindex','-1');
  target.focus({preventScroll:true});
  return {focused:document.activeElement===target};
 }
 if(stage==='activate'){
  const selection=globalThis.__lipaSelection;
  if(!newChatOpen()||selection?.phone!==contact.phone||!selection.element?.isConnected||!visible(selection.element))return {waiting:true};
  // Activate the actual result label; the click bubbles to WhatsApp's row handler.
  selection.element.click();return {activated:true};
 }
 const searchRect=inputs[0].getBoundingClientRect();
 const eligible=el=>{const r=el.getBoundingClientRect();return visible(el)&&!el.closest('#main,header')&&r.y>=searchRect.y+searchRect.height&&r.x>=searchRect.x-32&&r.x+r.width<=searchRect.x+searchRect.width+32&&point(el);};
 const textOf=el=>String(el.innerText||el.textContent||el.getAttribute('title')||'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim();
 const isPhone=text=>/^\+?[\d\s().-]+$/.test(text);
 function selected(el){
   // WhatsApp often renders the phone/name as a span inside the clickable
   // result row. Clicking that span may focus text without opening the chat.
   // Prefer the complete interactive row, or the nearest row-sized ancestor.
   let surface=el.closest?.('[role="row"],[role="listitem"],[role="button"],[tabindex="0"]');
   if(!surface||surface.closest('#main,header'))surface=null;
   let parent=el.parentElement;
   while(!surface&&parent&&parent!==pane){
     if(typeof parent.getBoundingClientRect!=='function'){parent=parent.parentElement;continue;}
     const r=parent.getBoundingClientRect();
     if(visible(parent)&&!parent.closest('#main,header')&&r.y>=searchRect.y+searchRect.height&&r.height>=32&&r.height<=120&&r.width>=searchRect.width*.55&&r.x>=searchRect.x-96&&r.x+r.width<=searchRect.x+searchRect.width+96&&point(parent))surface=parent;
     parent=parent.parentElement;
   }
   surface=surface||el;
   const target=point(el)||point(surface);if(!target)return {waiting:true};
   globalThis.__lipaSelection={...globalThis.__lipaNavigation,phone:contact.phone,element:el,label:clean(surface.querySelector?.("span[title],span[dir=auto]")?.textContent||textOf(el))};
   return {target,diagnostic:{reason:'selected-number-search-result',label:textOf(el),surface:surface===el?'text':'row'}};
 }
 let pane=inputs[0].parentElement;
 while(pane&&pane!==document.body){
   const nodes=[...pane.querySelectorAll('[role="listitem"],[role="row"],span,[dir="auto"]')].filter(eligible);
   const phones=nodes.filter(el=>isPhone(textOf(el))&&samePhone(textOf(el),contact.phone));
   // A repeated phone heading/subtitle identifies the same destination.
   if(phones.length)return selected(phones[0]);
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
     if(unique.length===1)return selected(unique[0][1]);
     return {waiting:true,diagnostic:{reason:'multiple-results',rows:leafRows.length,labels:labels.length,groups:unique.length}};
   }
   pane=pane.parentElement;
 }
 return {waiting:true,diagnostic:{reason:'no-result-elements'}};
}
