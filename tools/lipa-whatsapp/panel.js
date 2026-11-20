'use strict';
const $=id=>document.getElementById(id);
let mediaFile=null, mediaURL=null, mediaBusy=false, mediaData=null;
let job, running=false, stopping=false, workTab=null, history={};
const labels={pending:'Pendiente',preparing:'Abriendo chat',attempting:'Envío iniciado · revisar',sent:'Enviado · no confirma entrega',review:'Revisar manualmente',duplicate:'Ya intentado anteriormente',skipped:'Omitido'};
const selectable=contact=>contact.status==='pending'||contact.status==='duplicate';
const persist=()=>chrome.storage.local.set({job,history});
// Short waits run in the extension worker, independent of hidden-tab timers.
const pause=async ms=>{
  const result=await chrome.runtime.sendMessage({type:'delay',ms});
  if(!result?.ok)throw Error('Recargá la extensión LIPA para activar la actualización de las pausas.');
};
const browserControl=lipaBrowserControl(chrome);
async function rawStep(tabId,contact,action) {
  const results=await chrome.scripting.executeScript({target:{tabId},func:lipaWhatsAppStep,args:[{phone:contact.phone,message:action==='prepareEmpty'||action==='composer'?'':job.message,prepareOnly:action==='prepareEmpty'||action==='composer',media:job.media||null,mediaData:action==='attach'?mediaData:null},action==='prepareEmpty'?'prepare':action]});
  if(results.length!==1||!results[0].result)throw Error('No se pudo verificar la respuesta de WhatsApp.');
  return results[0].result;
}
async function prepareChat(tabId,contact,cancelled=()=>false,empty=false) {
  await browserControl.connect(tabId);
  const interactions=new Set();let last;
  for(let i=0;i<100;i++) {
    if(cancelled())throw Error('Tanda detenida.');
    last=await rawStep(tabId,contact,empty?'prepareEmpty':'prepare');
    if(last.ready)return last;
    if(last.interaction&&!interactions.has(last.interaction)) {
      interactions.add(last.interaction);
      await browserControl.click(tabId,last.target,cancelled);
    }
    await pause(150);
  }
  return {error:last?.error||'No se pudo abrir y comprobar la ficha del contacto.'};
}
async function fingerprint(contact) {
  const raw=job.organizer+'\n'+contact.phone+'\n'+job.message+(job.media?'\nmedia:'+job.media.hash:'');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function render() {
  $('rows').replaceChildren();
  job.contacts.forEach((contact,i)=>{
    const row=document.createElement('tr'),select=document.createElement('td'),check=document.createElement('input');
    check.type='checkbox';check.setAttribute('aria-label','Incluir a '+contact.name);check.checked=contact.selected!==false;check.disabled=running||!selectable(contact);
    check.addEventListener('change',()=>{contact.selected=check.checked;persist();render();});select.append(check);row.append(select);
    [contact.name,'+'+contact.phone,labels[contact.status]||contact.status].forEach(value=>{const cell=document.createElement('td');cell.textContent=value;row.append(cell);});
    if(contact.status==='duplicate')row.classList.add('previous-attempt');
    row.title=contact.error||(contact.status==='duplicate'?'Podés marcarlo para volver a enviar.':'');$('rows').append(row);
  });
  const pending=job.contacts.filter(selectable);
  const selected=pending.filter(c=>c.selected!==false).length;
  $('selectAll').checked=pending.length>0&&selected===pending.length;
  $('selectAll').indeterminate=selected>0&&selected<pending.length;
  $('selectAll').disabled=running||!pending.length;
  $('start').disabled=running||mediaBusy||!selected||Boolean(job.media&&!mediaFile);

  $('stop').disabled=!running;
  $('inspectSent').disabled=running;
}
async function step(contact,action) {
  return rawStep(workTab,contact,action);
}
$('selectAll').addEventListener('change',()=>{
  if(running||!job)return;
  const selected=$('selectAll').checked;
  job.contacts.forEach(contact=>{if(selectable(contact))contact.selected=selected;});
  persist();render();
});
$('login').addEventListener('click',async()=>{try{stopping=false;await reuseWhatsAppTab();}catch(e){$('status').textContent=e.message;}});
$('stop').addEventListener('click',()=>{stopping=true;$('status').textContent='Deteniendo. Los próximos mensajes no se enviarán.';});
$('start').addEventListener('click',async()=>{
  if(running||mediaBusy||!job||job.media&&!mediaFile)return;
  const queue=job.contacts.filter(c=>selectable(c)&&c.selected!==false);
  if(!queue.length){$('status').textContent='Seleccioná al menos un contacto pendiente.';return;}
  running=true;stopping=false;render();
  try{mediaData=job.media?await lipaMedia.dataURL(mediaFile):null;}catch(error){running=false;render();$('status').textContent=error.message;return;}
  for(const contact of queue) {
    if(stopping)break;
    try {
      contact.status='preparing';await persist();render();$('status').textContent='Abriendo el chat de '+contact.name+'…';
      await reuseWhatsAppTab();
      job.workTabId=workTab;await persist();
      await selectChat(contact);
      const ready=await prepareChat(workTab,contact,()=>stopping);
      if(stopping){contact.status='pending';break;}
      if(!ready.ready)throw Error(ready.error||'No se pudo preparar el chat.');
      if(job.media){$('status').textContent='Adjuntando '+job.media.name+' en WhatsApp…';await prepareMedia(contact);if(stopping){contact.status='pending';break;}}
      // Persist uncertainty before the click. A crash must never lead to an automatic duplicate.
      contact.status='attempting';contact.attemptedAt=new Date().toISOString();history[contact.key]={at:contact.attemptedAt,status:'attempting'};
      await persist();render();
      if(stopping){contact.status='pending';delete history[contact.key];break;}
      const armed=await step(contact,'send');
      if(!armed.armed)throw Error(armed.error||'No se pudo preparar el envío.');
      await browserControl.click(workTab,armed.target,()=>stopping);
      $('status').textContent='Comprobando el mensaje de '+contact.name+'…';
      const result=await step(contact,'confirm');
      if(!result.sent)throw Error(result.error||'No se pudo confirmar el envío.');
      contact.status='sent';history[contact.key].status='sent';await persist();render();
      $('status').textContent='Mensaje observado en el chat de '+contact.name+'.';
      if(contact!==queue[queue.length-1]&&!stopping){
        $('status').textContent='Mensaje observado en el chat de '+contact.name+'. Pausa de 1 segundo antes del siguiente.';
        await pause(1000);
      }
    } catch(error) {
      contact.error=error.message;contact.status=history[contact.key]?'review':'pending';
      $('status').textContent='Tanda detenida: '+contact.name+'. '+error.message;
      stopping=true;await persist();break;
    }
  }
  await browserControl.release();mediaData=null;running=false;await persist();render();
  if(!stopping)$('status').textContent='Tanda finalizada. Revisá los estados de la lista.';
});
$('report').addEventListener('click',()=>{
  if(!job)return;
  const blob=new Blob([JSON.stringify({inspection:job.lastInspection||null,message:job.message,media:job.media||null,filters:job.filters,contacts:job.contacts.map(({key,...c})=>c)},null,2)],{type:'application/json'});
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
  for(const contact of job.contacts){contact.key=await fingerprint(contact);if(contact.status==='preparing')contact.status='pending';if(contact.status==='attempting')contact.status='review';if(contact.status==='pending'&&history[contact.key])contact.status='duplicate';if(contact.status==='duplicate')contact.selected=false;}
  if(job.media){mediaFile=await lipaMedia.read(job.id);if(mediaFile&&(await lipaMedia.validate(mediaFile)).hash!==job.media.hash)mediaFile=null;}
  showMedia();await persist();$('message').value=job.message;$('filters').textContent=job.filters;$('status').textContent=job.media&&!mediaFile?'No se encontró el adjunto. Volvé a preparar la tanda desde LIPA.':job.contacts.length+' contactos. Revisá antes de iniciar.';render();
})().catch(error=>{$('status').textContent=error.message;});

function showMedia(){
  if(mediaURL)URL.revokeObjectURL(mediaURL);mediaURL=null;
  $('mediaVisual').replaceChildren();$('mediaPreview').hidden=!job?.media;
  if(!job?.media)return;
  $('mediaName').textContent=job.media.name+' · '+(job.media.size/1048576).toFixed(1)+' MB';$('mediaCaption').textContent=job.message;
  if(mediaFile){mediaURL=URL.createObjectURL(mediaFile);const el=document.createElement(job.media.type.startsWith('video/')?'video':'img');el.src=mediaURL;if(el.tagName==='VIDEO'){el.controls=true;el.preload='metadata';}else el.alt='Vista previa del adjunto';$('mediaVisual').append(el);}
}
async function prepareMedia(contact){ let clickedMenu=false,lastError='';
 for(let i=0;i<25;i++){
  if(stopping)throw Error('Tanda detenida.');const result=await step(contact,'attach');
  if(result.attached)break;
  if(result.target&&!clickedMenu){await browserControl.click(workTab,result.target,()=>stopping);clickedMenu=true;}
  else if(result.error)throw Error(result.error);
  if(i===24)throw Error('No se pudo adjuntar el archivo.');await pause(200);
 }
 for(let i=0;i<60;i++){
  if(stopping)throw Error('Tanda detenida.');const result=await step(contact,'mediaPrepare');if(result.ready)return;
  if(result.interaction==='caption'){await browserControl.fillCaption(workTab,result.target,job.message,()=>stopping);await pause(500);continue;}
  if(result.fatal)throw Error(result.error);lastError=result.error||lastError;await pause(500);
 }
 throw Error('No se pudo comprobar el adjunto: '+(lastError||'no apareció la vista previa')+'. No se envió nada.');
}

$('inspectSent').addEventListener('click',async()=>{
 if(running||!job)return;$('inspectSent').disabled=true;
 try{
  const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});let tab=tabs.find(t=>t.id===(workTab||job.workTabId));if(!tab&&tabs.length===1)tab=tabs[0];
  if(!tab)throw Error('Dejá una sola pestaña de WhatsApp Web abierta, en el chat que recibió el mensaje.');
  const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:lipaInspectSent,args:[{message:job.message}]});const result=results[0]?.result;if(!result||result.error)throw Error(result?.error||'No se pudo leer el chat.');
  job.lastInspection={at:new Date().toISOString(),...result};await persist();
  const rows=result.candidates;const matched=rows.filter(r=>r.captionMatch).length,contained=rows.filter(r=>r.bodyContainsCaption).length;
  $('status').textContent='Revisión sin envío: '+result.outgoingCount+' mensajes salientes ('+result.messageIdNodes+' bloques detectados); texto reconocido: '+matched+'; texto completo dentro del mensaje: '+contained+'; imágenes: '+rows.reduce((n,r)=>n+r.images.length,0)+'. Descargá el registro para revisar el detalle. No se envió nada.';
 }catch(e){$('status').textContent=e.message;}finally{$('inspectSent').disabled=false;}
});

async function reuseWhatsAppTab(){
 if(workTab){try{const t=await chrome.tabs.get(workTab);if(!t.url?.startsWith('https://web.whatsapp.com/'))workTab=null;}catch(_){workTab=null;}}
 if(!workTab){const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});const found=tabs.find(t=>t.id===job?.workTabId)||(tabs.length===1?tabs[0]:tabs.find(t=>t.active));if(found)workTab=found.id;else if(tabs.length)throw Error('Dejá una sola pestaña de WhatsApp Web abierta.');else throw Error('Abrí WhatsApp Web y vinculá tu sesión antes de iniciar la tanda. Se usará esa misma pestaña.');}
 await chrome.tabs.update(workTab,{active:true});
 for(let i=0;i<90;i++){if(stopping)throw Error('Tanda detenida.');if((await chrome.tabs.get(workTab)).status==='complete')return;await pause(250);}throw Error('WhatsApp no terminó de cargar.');
}
async function selectChat(contact){
 // Restore the proven direct-phone flow from 1.3.10, but navigate the one
 // selected WhatsApp tab instead of creating a tab for every recipient.
 await browserControl.release();
 const url='https://web.whatsapp.com/send?phone='+contact.phone+(job.media?'':'&text='+encodeURIComponent(job.message));
 await chrome.tabs.update(workTab,{url,active:true});
 let loaded=false;
 for(let i=0;i<90;i++){
  if(stopping)throw Error('Tanda detenida.');
  const tab=await chrome.tabs.get(workTab);
  if(tab.status==='complete'){loaded=true;break;}
  await pause(250);
 }
 if(!loaded)throw Error('WhatsApp no terminó de cargar.');
}
