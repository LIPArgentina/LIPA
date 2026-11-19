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
 return {expected,ctx,header,caption,setMedia:v=>withMedia=v,add:()=>added=true,step:action=>ctx.lipaWhatsAppStep(expected,action)};
}
test('media prepare/arm checks recipient and exact caption without clicking send',async()=>{
 const f=driverFixture();assert.equal((await f.step('mediaPrepare')).ready,true);assert.equal((await f.step('send')).armed,true);
 f.caption.childNodes[0].nodeValue='Otro mensaje';assert.equal((await f.step('send')).fatal,true);
 f.caption.childNodes[0].nodeValue='Hola 👋';f.header.textContent='Otro contacto';assert.equal((await f.step('send')).fatal,true);
});
test('confirmation requires a new outgoing attachment plus matching caption for images and videos',async()=>{
 for(const type of ['image/png','video/mp4']){const f=driverFixture(type);assert.equal((await f.step('send')).armed,true);f.add();f.setMedia(false);assert((await f.step('audit')).error);f.setMedia(true);assert.equal((await f.step('confirm')).sent,true);}
});
