const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const batch=require('../../frontend/torneos/tanda');
test('batch contacts deduplicate formatted/local phones and omit missing/invalid entries',()=>{
 const rows=[{nombre_oficial:'A',whatsapp:'+54 9 11 2345-6789'},{nombre_oficial:'B',whatsapp:'1123456789'},{nombre_oficial:'C',whatsapp:'005491123456789'},{whatsapp:''},{whatsapp:'123'},{nombre_oficial:'España',whatsapp:'+34 612345678'}];
 const result=batch.collect(rows);assert.equal(result.contacts.length,2);assert.equal(result.missing,1);assert.equal(result.invalid,1);assert.equal(result.duplicates,2);assert.equal(result.contacts[1].phone,'34612345678');
});
function driverFixture({phone='5491123456789',message='Hola 👋\nSeña 🎱',expectedMessage='Hola 👋\nSeña 🎱',paragraphs=false,observed=true,sendIcon=true}={}){
 let clicks=0;const outgoing=[];const visible={getClientRects:()=>[{}]};
 const leaf=value=>({nodeType:3,nodeValue:value});
 const textEl=value=>({...visible,textContent:value,nodeName:'DIV',childNodes:paragraphs?value.split('\n').map(line=>({nodeName:'P',childNodes:line?[{nodeName:'SPAN',childNodes:[leaf(line)]}]:[{nodeName:'BR'}]})):[leaf(value)]});
 const input=textEl(message);const header={querySelectorAll:()=>[textEl('+'+phone)],querySelector:()=>null};
 const send={click(){clicks++;if(observed)outgoing.push({dataset:{id:'true_'+phone+'@c.us_new'},matches:()=>true,querySelectorAll:()=>[textEl(message)]});}};
 const icon={...visible,closest:()=>send};
 const main={querySelector:q=>q==='header'?header:null,querySelectorAll(q){if(q.includes('contenteditable'))return [input];if(q.includes('data-icon'))return sendIcon?[icon]:[];if(q.includes('data-id'))return outgoing;return [];}};
 const context={location:{origin:'https://web.whatsapp.com'},document:{querySelector:q=>q==='#main'?main:null,querySelectorAll:()=>[],createTextNode:s=>s},setTimeout:fn=>{fn();},Promise,Set};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../../tools/lipa-whatsapp/driver.js'),'utf8'),context);
 return {clicks:()=>clicks,run:action=>context.lipaWhatsAppStep({phone:'5491123456789',message:expectedMessage},action)};
}
test('paragraphs preserve empty lines, spaces and emoji without concatenating words',async()=>{
 const message='Hola 👋\n\nSoy el  Director\n\nEl alias es:\n\nlipa.trebol\n\nSaludos 🎱';
 const f=driverFixture({message,expectedMessage:message,paragraphs:true});
 assert.equal((await f.run('prepare')).ready,true);assert.equal(f.clicks(),0);
 assert.equal((await f.run('send')).sent,true);assert.equal(f.clicks(),1);
 const changed=driverFixture({message:message.replace('lipa.trebol','otro.alias'),expectedMessage:message,paragraphs:true});
 assert.equal((await changed.run('send')).clicked,false);assert.equal(changed.clicks(),0);
});
test('driver preparation never sends; send clicks once and requires a new outgoing bubble',async()=>{
 const f=driverFixture();assert.equal((await f.run('prepare')).ready,true);assert.equal(f.clicks(),0);assert.equal((await f.run('send')).sent,true);assert.equal(f.clicks(),1);
});
test('driver refuses wrong recipient, modified text and missing send control',async()=>{
 for(const options of [{phone:'5491199999999'},{message:'Otro texto'},{sendIcon:false}]){const f=driverFixture(options);const result=await f.run('send');assert.ok(result.error);assert.equal(result.clicked,false);assert.equal(f.clicks(),0);}
});
test('driver never repeats a click when outcome is unconfirmed',async()=>{
 const f=driverFixture({observed:false});const result=await f.run('send');assert.equal(result.clicked,true);assert.ok(result.error);assert.equal(f.clicks(),1);
});
