'use strict';
// Attachment stays on this computer; only metadata is kept in extension storage.
const lipaMedia={
  maxBytes:16*1024*1024,
  async validate(file){
    if(!file||!['image/jpeg','image/png','image/webp','video/mp4','video/webm'].includes(file.type))throw Error('Elegí una imagen JPG, PNG o WebP, o un video MP4 o WebM.');
    if(!file.size||file.size>this.maxBytes)throw Error('El archivo debe pesar entre 1 byte y 16 MB.');
    const bytes=await file.arrayBuffer();
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    return {name:file.name,type:file.type,size:file.size,hash};
  },
  async store(id,blob){
    const db=await this.open();
    try{await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');const store=tx.objectStore('files');store.clear();if(blob)store.put(blob,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('No se pudo guardar el adjunto.'));});}finally{db.close();}
  },
  open(){return new Promise((resolve,reject)=>{const req=indexedDB.open('lipa-batch-media',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});},
  async read(id){const db=await this.open();try{return await new Promise((resolve,reject)=>{const req=db.transaction('files').objectStore('files').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}},
  dataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});}
};
if(typeof module==='object')module.exports=lipaMedia;
