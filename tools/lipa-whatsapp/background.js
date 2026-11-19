'use strict';
if(typeof importScripts==='function')importScripts('media.js');
let preparing = false;
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if(request.type==='capabilities'&&sender.tab&&sender.url?.startsWith('https://lipa.ar/torneos/privados.html')){respond({sharedMedia:true,version:'1.3.1'});return;}
  if(request.type==='delay') {
    // At most 10s, below the worker's 30s idle timeout. Only our panel can request it.
    if(sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL('panel.html'))return;
    if(!Number.isInteger(request.ms)||request.ms<0||request.ms>10000){respond({error:'Pausa inválida.'});return;}
    setTimeout(()=>respond({ok:true}),request.ms);
    return true;
  }
  if(request.type !== 'prepare' || !sender.tab || !sender.url?.startsWith('https://lipa.ar/torneos/privados.html')) return;
  if(preparing) {respond({error:'Ya se está preparando una tanda.'}); return;}
  preparing = true;
  (async()=>{
    const batch=request.batch;
    if(!batch || typeof batch.message !== 'string' || !batch.message.trim() || batch.message.length>4000 || !Array.isArray(batch.contacts) || !batch.contacts.length) throw Error('La tanda debe tener un mensaje y al menos un contacto.');
    const contacts=batch.contacts.map(c=>({name:String(c.name||'Jugador').slice(0,200),phone:String(c.phone||'')}));
    if(contacts.some(c=>!/^\d{10,15}$/.test(c.phone)) || new Set(contacts.map(c=>c.phone)).size!==contacts.length) throw Error('Hay teléfonos inválidos o repetidos.');
    const {activeTab}=await chrome.storage.local.get('activeTab');
    if(activeTab) {try {const active=await chrome.tabs.get(activeTab); if(active.url===chrome.runtime.getURL('panel.html')) throw Error('Hay una tanda abierta. Cerrá su panel antes de preparar otra.');}catch(e){if(e.message.startsWith('Hay una'))throw e;}}
    const job={id:crypto.randomUUID(),message:batch.message,filters:String(batch.filters||''),organizer:String(batch.organizer||''),contacts:contacts.map(c=>({...c,status:'pending'}))};
    if(batch.media){
      const source=batch.media;
      if(typeof source.dataURL!=='string'||source.dataURL.length>24*1024*1024||!/^data:(image\/(png|jpeg|webp)|video\/(mp4|webm));base64,/.test(source.dataURL))throw Error('El adjunto recibido no es válido.');
      const bytes=Uint8Array.from(atob(source.dataURL.split(',')[1]),c=>c.charCodeAt(0));
      const file=new File([bytes],String(source.name||'adjunto'),{type:source.type});const meta=await lipaMedia.validate(file);
      if(meta.hash!==source.hash||meta.size!==source.size)throw Error('El adjunto recibido no coincide con el guardado.');
      await lipaMedia.store(job.id,file);job.media=meta;
    }
    await chrome.storage.local.set({job});
    const tab=await chrome.tabs.create({url:chrome.runtime.getURL('panel.html')});
    await chrome.storage.local.set({activeTab:tab.id});
    respond({ok:true});
  })().catch(error=>respond({error:error.message})).finally(()=>{preparing=false;});
  return true;
});
chrome.action.onClicked.addListener(async()=>{
  const {activeTab}=await chrome.storage.local.get('activeTab');
  if(activeTab) {try{await chrome.tabs.update(activeTab,{active:true});return;}catch(_){}}
  const tab=await chrome.tabs.create({url:chrome.runtime.getURL('panel.html')});
  await chrome.storage.local.set({activeTab:tab.id});
});
