'use strict';
const $=id=>document.getElementById(id);
let job, running=false, checking=false, stopping=false, workTab=null, history={};
const labels={pending:'Pendiente',preparing:'Abriendo chat',attempting:'Envío iniciado · revisar',sent:'Enviado · no confirma entrega',review:'Revisar manualmente',duplicate:'Ya intentado anteriormente',skipped:'Omitido'};
const persist=()=>chrome.storage.local.set({job,history});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const browserControl=lipaBrowserControl(chrome);
$('audit').addEventListener('click',async()=>{
  if(running||checking||!job)return;
  const contact=job.contacts.find(c=>c.status==='review');
  if(!contact){$('diagnostic').textContent='No hay un envío detenido para revisar.';return;}
  checking=true;render();
  try {
    const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});
    const results=[];
    for(const tab of tabs)results.push(await rawStep(tab.id,contact,'audit'));
    const observed=results.filter(r=>r.sent);
    if(observed.length===1){contact.status='sent';delete contact.error;if(history[contact.key])history[contact.key].status='sent';await persist();$('diagnostic').textContent=contact.name+': mensaje encontrado en el chat. No se reenvió nada. La tanda sigue detenida.';}
    else $('diagnostic').textContent='No se pudo confirmar el envío. Conservá abierto el chat original para revisarlo; no se reenviará.';
  }catch(error){$('diagnostic').textContent=error.message;}finally{checking=false;render();}
});
async function rawStep(tabId,contact,action) {
  const results=await chrome.scripting.executeScript({target:{tabId},func:lipaWhatsAppStep,args:[{phone:contact.phone,message:job.message},action]});
  if(results.length!==1||!results[0].result)throw Error('No se pudo verificar la respuesta de WhatsApp.');
  return results[0].result;
}
async function prepareChat(tabId,contact,cancelled=()=>false) {
  await browserControl.connect(tabId);
  const interactions=new Set();let last;
  for(let i=0;i<60;i++) {
    if(cancelled())throw Error('Tanda detenida.');
    last=await rawStep(tabId,contact,'prepare');
    if(last.ready)return last;
    if(last.interaction&&!interactions.has(last.interaction)) {
      interactions.add(last.interaction);
      await browserControl.click(tabId,last.target,cancelled);
    }
    await pause(500);
  }
  return {error:last?.error||'No se pudo abrir y comprobar la ficha del contacto.'};
}
$('diagnose').addEventListener('click',async()=>{
  if(running||checking||!job)return;
  checking=true;render();$('diagnostic').textContent='Comprobando mensaje, número y botón Enviar. No se enviará nada…';
  try {
    const contact=job.contacts[Number($('testContact').value)];
    if(!contact)throw Error('No hay contactos pendientes seleccionados.');
    const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});
    if(tabs.length!==1)throw Error('Dejá una sola pestaña de WhatsApp Web abierta.');
    const panel=await chrome.tabs.getCurrent();
    await chrome.tabs.update(tabs[0].id,{active:true});
    const result=await prepareChat(tabs[0].id,contact);
    await chrome.tabs.update(panel.id,{active:true});
    $('diagnostic').textContent=contact.name+': '+(result.ready?'Mensaje, número y botón Enviar comprobados. No se envió nada.':result.error);
  }catch(error){$('diagnostic').textContent=error.message;}finally{await browserControl.release();checking=false;render();}
});
$('prepareTest').addEventListener('click',async()=>{
  if(running||checking||!job)return;
  const contact=job.contacts[Number($('testContact').value)];
  if(!contact)return;
  checking=true;render();$('diagnostic').textContent='Preparando '+contact.name+' sin enviar…';
  const panel=await chrome.tabs.getCurrent();
  try {
    const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});
    if(tabs.length>1)throw Error('Dejá una sola pestaña de WhatsApp Web abierta.');
    const url='https://web.whatsapp.com/send?phone='+contact.phone+'&text='+encodeURIComponent(job.message);
    const tab=tabs.length?await chrome.tabs.update(tabs[0].id,{url,active:true}):await chrome.tabs.create({url,active:true});
    let loaded=false;
    for(let i=0;i<90;i++){if((await chrome.tabs.get(tab.id)).status==='complete'){loaded=true;break;}await pause(500);}
    if(!loaded)throw Error('WhatsApp no terminó de cargar.');
    const result=await prepareChat(tab.id,contact);
    $('diagnostic').textContent=contact.name+': '+(result.ready?'Mensaje, número y botón Enviar comprobados. No se envió nada.':result.error);
  }catch(error){$('diagnostic').textContent=error.message;}
  finally{await browserControl.release();await chrome.tabs.update(panel.id,{active:true}).catch(()=>{});checking=false;render();}
});
async function fingerprint(contact) {
  const raw=job.organizer+'\n'+contact.phone+'\n'+job.message;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function render() {
  const selectedTest=$('testContact').value;
  $('testContact').replaceChildren();
  job.contacts.forEach((contact,i)=>{if(contact.status==='pending'&&contact.selected!==false){const option=document.createElement('option');option.value=i;option.textContent=contact.name;$('testContact').append(option);}});
  if([...$('testContact').options].some(o=>o.value===selectedTest))$('testContact').value=selectedTest;
  $('testContact').disabled=running||checking;$('prepareTest').disabled=running||checking||!$('testContact').options.length;
  $('rows').replaceChildren();
  job.contacts.forEach((contact,i)=>{
    const row=document.createElement('tr'),select=document.createElement('td'),check=document.createElement('input');
    check.type='checkbox';check.setAttribute('aria-label','Incluir a '+contact.name);check.checked=contact.selected!==false;check.disabled=running||contact.status!=='pending';
    check.addEventListener('change',()=>{contact.selected=check.checked;persist();});select.append(check);row.append(select);
    [contact.name,'+'+contact.phone,labels[contact.status]||contact.status].forEach(value=>{const cell=document.createElement('td');cell.textContent=value;row.append(cell);});
    row.title=contact.error||'';$('rows').append(row);
  });
  $('diagnose').disabled=running||checking;
  $('audit').disabled=running||checking;
  $('start').disabled=running||checking||!$('confirm').checked||!job.contacts.some(c=>c.status==='pending');
  $('stop').disabled=!running;$('confirm').disabled=running;
}
async function step(contact,action) {
  return rawStep(workTab,contact,action);
}
$('confirm').addEventListener('change',()=>{if(job)render();});
$('login').addEventListener('click',async()=>{if(workTab){try{await chrome.tabs.update(workTab,{active:true});return;}catch(_){}}const tab=await chrome.tabs.create({url:'https://web.whatsapp.com/'});workTab=tab.id;});
$('stop').addEventListener('click',()=>{stopping=true;$('status').textContent='Deteniendo. Los próximos mensajes no se enviarán.';if(workTab)chrome.tabs.remove(workTab).catch(()=>{});});
$('start').addEventListener('click',async()=>{
  if(running||checking||!$('confirm').checked)return;
  const queue=job.contacts.filter(c=>c.status==='pending'&&c.selected!==false);
  if(!queue.length){$('status').textContent='Seleccioná al menos un contacto pendiente.';return;}
  running=true;stopping=false;render();
  for(const contact of queue) {
    if(stopping)break;
    try {
      contact.status='preparing';await persist();render();$('status').textContent='Abriendo el chat de '+contact.name+'…';
      const url='https://web.whatsapp.com/send?phone='+contact.phone+'&text='+encodeURIComponent(job.message);
      if(workTab){try{await chrome.tabs.update(workTab,{url,active:true});}catch(_){workTab=null;}}
      if(!workTab){const tab=await chrome.tabs.create({url,active:true});workTab=tab.id;}
      // Wait for the page to finish loading before injecting the DOM-only driver.
      let loaded=false;
      for(let i=0;i<90&&!stopping;i++){const t=await chrome.tabs.get(workTab);if(t.status==='complete'){loaded=true;break;}await pause(500);}
      if(stopping){contact.status='pending';break;}
      if(!loaded)throw Error('WhatsApp no terminó de cargar.');
      const ready=await prepareChat(workTab,contact,()=>stopping);
      if(stopping){contact.status='pending';break;}
      if(!ready.ready)throw Error(ready.error||'No se pudo preparar el chat.');
      // Persist uncertainty before the click. A crash must never lead to an automatic duplicate.
      contact.status='attempting';contact.attemptedAt=new Date().toISOString();history[contact.key]={at:contact.attemptedAt,status:'attempting'};
      await persist();render();
      if(stopping){contact.status='pending';delete history[contact.key];break;}
      const armed=await step(contact,'send');
      if(!armed.armed)throw Error(armed.error||'No se pudo preparar el envío.');
      await browserControl.click(workTab,armed.target,()=>stopping);
      const result=await step(contact,'confirm');
      if(!result.sent)throw Error(result.error||'No se pudo confirmar el envío.');
      contact.status='sent';history[contact.key].status='sent';await persist();render();
      $('status').textContent='Mensaje observado en el chat de '+contact.name+'.';
      for(let i=0;i<10&&!stopping;i++)await pause(1000);
    } catch(error) {
      contact.error=error.message;contact.status=history[contact.key]?'review':'pending';
      $('status').textContent='Tanda detenida: '+contact.name+'. '+error.message;
      stopping=true;await persist();break;
    }
  }
  await browserControl.release();running=false;await persist();render();
  if(!stopping)$('status').textContent='Tanda finalizada. Revisá los estados de la lista.';
});
$('report').addEventListener('click',()=>{
  if(!job)return;
  const blob=new Blob([JSON.stringify({message:job.message,filters:job.filters,contacts:job.contacts.map(({key,...c})=>c)},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='lipa-registro-tanda.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
});
window.addEventListener('beforeunload',event=>{if(running){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{browserControl.release();});
(async()=>{
  const data=await chrome.storage.local.get(['job','history']);job=data.job;history=data.history||{};
  if(!job){$('status').textContent='Abrí Inscripciones de LIPA, aplicá los filtros y tocá Preparar tanda.';return;}
  const ownTab=await chrome.tabs.getCurrent();const {activeTab}=await chrome.storage.local.get('activeTab');
  if(activeTab&&ownTab.id!==activeTab){let existing;try{existing=await chrome.tabs.get(activeTab);}catch(_){}if(existing?.url===chrome.runtime.getURL('panel.html')){$('status').textContent='Usá el panel original de la tanda.';return;}}
  await chrome.storage.local.set({activeTab:ownTab.id});
  for(const contact of job.contacts){contact.key=await fingerprint(contact);if(contact.status==='preparing')contact.status='pending';if(contact.status==='attempting')contact.status='review';if(contact.status==='pending'&&history[contact.key])contact.status='duplicate';}
  await persist();$('message').value=job.message;$('filters').textContent=job.filters;$('status').textContent=job.contacts.length+' contactos. Revisá antes de iniciar.';render();
})().catch(error=>{$('status').textContent=error.message;});
