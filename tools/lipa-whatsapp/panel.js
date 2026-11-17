'use strict';
const $=id=>document.getElementById(id);
let job, running=false, stopping=false, workTab=null, history={};
const labels={pending:'Pendiente',preparing:'Abriendo chat',attempting:'Envío iniciado · revisar',sent:'Enviado · no confirma entrega',review:'Revisar manualmente',duplicate:'Ya intentado anteriormente',skipped:'Omitido'};
const persist=()=>chrome.storage.local.set({job,history});
// Short waits run in the extension worker, independent of hidden-tab timers.
const pause=async ms=>{
  const result=await chrome.runtime.sendMessage({type:'delay',ms});
  if(!result?.ok)throw Error('Recargá la extensión LIPA para activar la actualización de las pausas.');
};
const browserControl=lipaBrowserControl(chrome);
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
async function fingerprint(contact) {
  const raw=job.organizer+'\n'+contact.phone+'\n'+job.message;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function render() {
  $('rows').replaceChildren();
  job.contacts.forEach((contact,i)=>{
    const row=document.createElement('tr'),select=document.createElement('td'),check=document.createElement('input');
    check.type='checkbox';check.setAttribute('aria-label','Incluir a '+contact.name);check.checked=contact.selected!==false;check.disabled=running||contact.status!=='pending';
    check.addEventListener('change',()=>{contact.selected=check.checked;persist();render();});select.append(check);row.append(select);
    [contact.name,'+'+contact.phone,labels[contact.status]||contact.status].forEach(value=>{const cell=document.createElement('td');cell.textContent=value;row.append(cell);});
    row.title=contact.error||'';$('rows').append(row);
  });
  const pending=job.contacts.filter(c=>c.status==='pending');
  const selected=pending.filter(c=>c.selected!==false).length;
  $('selectAll').checked=pending.length>0&&selected===pending.length;
  $('selectAll').indeterminate=selected>0&&selected<pending.length;
  $('selectAll').disabled=running||!pending.length;
  $('start').disabled=running||!selected;
  $('stop').disabled=!running;
}
async function step(contact,action) {
  return rawStep(workTab,contact,action);
}
$('selectAll').addEventListener('change',()=>{
  if(running||!job)return;
  const selected=$('selectAll').checked;
  job.contacts.forEach(contact=>{if(contact.status==='pending')contact.selected=selected;});
  persist();render();
});
$('login').addEventListener('click',async()=>{if(workTab){try{await chrome.tabs.update(workTab,{active:true});return;}catch(_){}}const tab=await chrome.tabs.create({url:'https://web.whatsapp.com/'});workTab=tab.id;});
$('stop').addEventListener('click',()=>{stopping=true;$('status').textContent='Deteniendo. Los próximos mensajes no se enviarán.';if(workTab)chrome.tabs.remove(workTab).catch(()=>{});});
$('start').addEventListener('click',async()=>{
  if(running||!job)return;
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
      if(contact!==queue[queue.length-1]&&!stopping){
        $('status').textContent='Mensaje observado en el chat de '+contact.name+'. Pausa de 10 segundos antes del siguiente.';
        await pause(10000);
      }
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
