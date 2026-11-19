const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const media=require('../../tools/lipa-whatsapp/media');
test('attachment accepts supported images and videos, hashes bytes, rejects empty/oversized/unsupported files',async()=>{
 for(const type of ['image/png','image/jpeg','image/webp','video/mp4','video/webm']){const result=await media.validate(new File(['example'],'test',{type}));assert.equal(result.size,7);assert.match(result.hash,/^[a-f0-9]{64}$/);}
 await assert.rejects(media.validate(new File([],'empty.png',{type:'image/png'})));
 await assert.rejects(media.validate(new File(['test'],'test.svg',{type:'image/svg+xml'})));
 await assert.rejects(media.validate({type:'video/mp4',size:16*1024*1024+1}));
 const a=await media.validate(new File(['one'],'same.png',{type:'image/png'})),b=await media.validate(new File(['two'],'same.png',{type:'image/png'}));assert.notEqual(a.hash,b.hash);
});
test('attachment content participates in history key; text-only key remains compatible',async()=>{
 const source=fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/panel.js'),'utf8'),code=source.slice(source.indexOf('async function fingerprint'),source.indexOf('function render()'));
 const ctx={job:{organizer:'org',message:'Mensaje'},crypto:require('node:crypto').webcrypto,TextEncoder};vm.createContext(ctx);vm.runInContext(code,ctx);
 const contact={phone:'5491112345678'},original=await ctx.fingerprint(contact);ctx.job.media={hash:'first'};const first=await ctx.fingerprint(contact);ctx.job.media={hash:'second'};assert.notEqual(await ctx.fingerprint(contact),first);assert.notEqual(original,first);delete ctx.job.media;assert.equal(await ctx.fingerprint(contact),original);
});
function driverFixture(type='image/png'){
 const header={textContent:'Contacto comprobado',querySelectorAll:()=>[]},caption={nodeType:1,nodeName:'DIV',childNodes:[{nodeType:3,nodeValue:'Hola 👋'}]},visual={src:'blob:test',getClientRects:()=>[{}]},send={getClientRects:()=>[{}],getBoundingClientRect:()=>({x:10,y:10,width:20,height:20}),getAttribute:()=>null,closest(){return this;},contains:()=>false};
 const preview={querySelector:()=>null,querySelectorAll:s=>s==='img'||s==='video'?[visual]:[send],parentElement:null};Object.assign(caption,{parentElement:preview,getClientRects:()=>[{}],closest:()=>null});
 let added=false,withMedia=true;
 const outgoing={dataset:{id:'true_new'},matches:()=>true,querySelectorAll:()=>[caption],querySelector:s=>s.includes('progressbar')?null:withMedia?visual:null};
 const main={querySelector:s=>s.includes('header')?header:null,querySelectorAll:s=>s==='[data-id]'&&added?[outgoing]:[]};
 const document={body:{},querySelector:s=>s==='#main'?main:null,querySelectorAll:s=>s.includes('contenteditable')?[caption]:[],elementFromPoint:()=>send};
 const expected={phone:'5491112345678',message:'Hola 👋',media:{hash:'abc',type}},ctx={document,location:{origin:'https://web.whatsapp.com'},setTimeout,Date,globalThis:null};ctx.globalThis=ctx;ctx.__lipaMedia={main,header,label:header.textContent,phone:expected.phone,hash:'abc',at:Date.now(),captionSet:true};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/driver.js'),'utf8'),ctx);
 return {expected,ctx,header,caption,preview,visual,send,outgoing,setMedia:v=>withMedia=v,add:()=>added=true,step:action=>ctx.lipaWhatsAppStep(expected,action)};
}
test('media prepare/arm checks recipient and exact caption without clicking send',async()=>{
 const f=driverFixture();assert.equal((await f.step('mediaPrepare')).ready,true);assert.equal((await f.step('send')).armed,true);
 f.caption.childNodes[0].nodeValue='Otro mensaje';assert.equal((await f.step('send')).fatal,true);
 f.caption.childNodes[0].nodeValue='Hola 👋';f.header.textContent='Otro contacto';assert.equal((await f.step('send')).fatal,true);
});
test('confirmation requires a new outgoing attachment plus matching caption for images and videos',async()=>{
 for(const type of ['image/png','video/mp4']){const f=driverFixture(type);assert.equal((await f.step('send')).armed,true);f.add();f.setMedia(false);assert((await f.step('audit')).error);f.setMedia(true);assert.equal((await f.step('confirm')).sent,true);}
});
test('extension receives saved attachment, verifies bytes and stores a complete batch snapshot',async()=>{
 const source=fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/background.js'),'utf8');let listener,job,storedFile,created=0;
 const bytes=Buffer.from('sample'),file=new File([bytes],'torneo.png',{type:'image/png'}),metadata=await media.validate(file);
 const chrome={runtime:{onMessage:{addListener:f=>listener=f},getURL:p=>'extension:'+p},action:{onClicked:{addListener(){}}},storage:{local:{get:async()=>({}),set:async data=>{if(data.job)job=data.job;}}},tabs:{create:async()=>{created++;return {id:1};}}};
 vm.runInNewContext(source,{chrome,crypto:require('node:crypto').webcrypto,File,atob,Uint8Array,lipaMedia:{validate:f=>media.validate(f),store:async(id,f)=>{storedFile=f;}},setTimeout});
 const batch={message:'Hola',contacts:[{phone:'5491112345678',name:'Jugador'}],media:{...metadata,dataURL:'data:image/png;base64,'+bytes.toString('base64')}};
 const call=()=>new Promise(resolve=>listener({type:'prepare',batch},{tab:{id:2},url:'https://lipa.ar/torneos/privados.html'},resolve));
 assert.equal((await call()).ok,true);assert.equal(job.media.hash,metadata.hash);assert.equal(storedFile.size,file.size);assert.equal(created,1);await new Promise(r=>setImmediate(r));batch.media.hash='incorrect';assert((await call()).error);assert.equal(created,1);
});
test('media opens a blank verified composer and pastes the file without enabling text-only send',async()=>{
 const bytes=Buffer.from('attachment'),meta=await media.validate(new File([bytes],'test.png',{type:'image/png'}));let pasted,focused=false;
 const input={nodeType:1,nodeName:'DIV',childNodes:[],getClientRects:()=>[{}],getAttribute:()=> 'Escribir un mensaje para +5491112345678',focus(){focused=true;},dispatchEvent(event){pasted=event;}};
 const header={textContent:'Jugador'},main={querySelector:()=>header,querySelectorAll:s=>s.includes('contenteditable')?[input]:[]};
 class Transfer{constructor(){this.files=[];this.items={add:f=>this.files.push(f)};}}
 class Paste{constructor(type,options){this.type=type;Object.assign(this,options);}}
 const ctx={location:{origin:'https://web.whatsapp.com'},document:{querySelector:s=>s==='#main'?main:null,querySelectorAll:()=>[]},crypto:require('node:crypto').webcrypto,File,Uint8Array,atob,DataTransfer:Transfer,ClipboardEvent:Paste,setTimeout,Date};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/driver.js'),'utf8'),ctx);
 const expected={phone:'5491112345678',message:'Descripción que no debe ir sola',media:meta,mediaData:'data:image/png;base64,'+bytes.toString('base64')};
 assert.equal((await ctx.lipaWhatsAppStep(expected,'prepare')).ready,true);assert.equal((await ctx.lipaWhatsAppStep(expected,'attach')).attached,true);assert(focused);assert.equal(pasted.type,'paste');assert.equal(pasted.clipboardData.files[0].size,bytes.length);assert.equal(input.childNodes.length,0);
 const send=await ctx.lipaWhatsAppStep(expected,'send');assert(!send.armed);assert(send.error);
});

test('caption in preview footer and data URL image are recognized; caption fills before send becomes available',async()=>{
 const f=driverFixture();f.visual.src='data:image/png;base64,AAAA';
 f.caption.closest=s=>s.split(',').includes('footer')?{}:null;f.preview.querySelector=s=>s==='footer'?{}:null;
 f.ctx.__lipaMedia.captionSet=false;f.caption.childNodes=[];f.caption.focus=()=>{};f.caption.getBoundingClientRect=()=>({x:0,y:0,width:100,height:50});f.caption.contains=()=>true;
 f.ctx.getSelection=()=>({removeAllRanges(){},addRange(){}});f.ctx.document.createRange=()=>({selectNodeContents(){}});
 f.ctx.document.execCommand=(command,unused,value)=>{assert.equal(command,'insertText');f.caption.childNodes=[{nodeType:3,nodeValue:value}];};
 const realQuery=f.preview.querySelectorAll;f.preview.querySelectorAll=s=>s==='img'?[f.visual]:[];
 assert.equal((await f.step('mediaPrepare')).interaction,'caption');f.caption.childNodes=[{nodeType:3,nodeValue:f.expected.message}];assert((await f.step('send')).error);
 f.preview.querySelectorAll=realQuery;assert.equal((await f.step('mediaPrepare')).ready,true);assert.equal((await f.step('send')).armed,true);
});

test('media Send deduplicates nested wrappers and ignores a covered chat button',async()=>{
 const f=driverFixture();const inner={...f.send,closest(){return this;}},covered={...f.send,getBoundingClientRect:()=>({x:250,y:10,width:20,height:20}),closest(){return this;}};
 f.send.contains=el=>el===inner;
 f.preview.querySelectorAll=s=>s==='img'?[f.visual]:[f.send,inner,covered];
 assert.equal((await f.step('mediaPrepare')).ready,true);const armed=await f.step('send');assert(armed.armed);assert(armed.target.x<100);
});
test('two distinct exposed media Send controls remain blocked',async()=>{
 const f=driverFixture(),other={...f.send,getBoundingClientRect:()=>({x:250,y:10,width:20,height:20}),closest(){return this;}};
 f.preview.querySelectorAll=s=>s==='img'?[f.visual]:[f.send,other];f.ctx.document.elementFromPoint=x=>x>200?other:f.send;
 const result=await f.step('send');assert(!result.armed);assert.match(result.error,/único botón/);
});

test('recognizes actual WhatsApp Enviar 1 seleccionado label without an icon match',async()=>{
 const f=driverFixture();f.preview.querySelectorAll=s=>s==='img'?[f.visual]:s.includes('[aria-label="Enviar 1 seleccionado"]')?[f.send]:[];
 assert.equal((await f.step('mediaPrepare')).ready,true);assert.equal((await f.step('send')).armed,true);
});

test('sent media confirmation expands long captions and recognizes data URL images',async()=>{
 const f=driverFixture();f.expected.message='Hola 👋\n\nTexto completo del torneo';await f.step('send');
 // Arm explicitly because the preview above still contains its short sample caption.
 f.caption.childNodes=[{nodeType:3,nodeValue:f.expected.message}];assert((await f.step('send')).armed);
 f.caption.childNodes=[{nodeType:3,nodeValue:'Hola 👋'}];let clicks=0;
 const more={textContent:'Leer más',click(){clicks++;f.caption.childNodes=[{nodeType:3,nodeValue:'Hola 👋 Texto completo del torneo'}];}};
 f.outgoing.querySelectorAll=s=>s==='button,[role="button"]'?[more]:[f.caption];
 f.outgoing.querySelector=s=>s.includes('progressbar')?null:s.includes('data:image/')?f.visual:null;f.add();
 assert.equal((await f.step('confirm')).sent,true);assert.equal(clicks,1);
});
