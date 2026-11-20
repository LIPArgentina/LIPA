const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/panel.js'),'utf8');
test('reuses an existing WhatsApp tab across contacts without navigating or closing it',async()=>{
 const calls=[];const ctx={workTab:null,job:{workTabId:7},stopping:false,pause:async()=>{},chrome:{tabs:{query:async()=>[{id:7,url:'https://web.whatsapp.com/'}],get:async()=>({url:'https://web.whatsapp.com/',status:'complete'}),update:async(id,options)=>calls.push({id,options}),create:async()=>{throw Error('Must reuse existing tab');}}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function reuseWhatsAppTab'),source.indexOf('async function selectChat')),ctx);await ctx.reuseWhatsAppTab();await ctx.reuseWhatsAppTab();assert.equal(ctx.workTab,7);assert.equal(calls.length,2);assert(calls.every(c=>!('url' in c.options)));assert(!source.includes('chrome.tabs.remove'));assert(!source.includes('/send?phone='));
});

function fixture(items){
 const rect=y=>({x:1,y,width:30,height:20});
 const input={value:'+5491112345678',getAttribute:()=>null,getClientRects:()=>[{}],closest:()=>null,getBoundingClientRect:()=>rect(1),contains:()=>false};
 const nodes=items.map(item=>({innerText:item.text,getAttribute:k=>k==='role'?(item.role||null):null,getClientRects:()=>[{}],closest:()=>null,getBoundingClientRect:()=>rect(item.y||100),contains:()=>false}));
 const pane={querySelectorAll:()=>nodes,parentElement:null};input.parentElement=pane;
 nodes.forEach((n,i)=>{n.parentElement=pane;if(items[i].group){n.parentElement=items[i].group;n.parentElement.parentElement=pane;}});
 const document={body:{},querySelectorAll:()=>[input],elementFromPoint:(x,y)=>y<30?input:nodes.find(n=>{const r=n.getBoundingClientRect();return y>=r.y&&y<=r.y+r.height;})};
 const ctx={location:{origin:'https://web.whatsapp.com'},document};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/navigation.js'),'utf8'),ctx);
 return {input,run:()=>ctx.lipaOpenChat({phone:'5491112345678',name:'Un nombre diferente'},'result')};
}
test('number search resolves saved alias and unsaved number with the same path',()=>{
 assert(fixture([{text:'Mi amigo del pool'}]).run().target);
 assert(fixture([{text:'+54 9 11 1234-5678'},{text:'+54 9 11 1234-5678',y:130}]).run().target);
 assert(fixture([{text:'Mi amigo',role:'row'}]).run().target);
});
test('name and subtitle in a single avatar row count as one contact',()=>{
 const group={querySelector:()=>({}),contains:()=>false};
 assert(fixture([{text:'Maicol Pool',group},{text:'Disponible',y:130,group}]).run().target);
});
test('multiple contacts, wrong phone and stale search are not selected',()=>{
 assert(!fixture([{text:'Persona A'},{text:'Persona B',y:130}]).run().target);
 assert(!fixture([{text:'+54 9 11 0000-0000'}]).run().target);
 const f=fixture([{text:'Mi amigo'}]);f.input.value='otro';assert(!f.run().target);
});

test('phone text with WhatsApp directional marks remains an exact number match',()=>{
 assert(fixture([{text:'\u200e+54 9 11 1234-5678\u200f'}]).run().target);
});

test('navigation clears all previous recipient proofs and requires New chat to close',()=>{
 let open=true;const heading={textContent:'Nuevo chat',getClientRects:()=>[{}],closest:()=>null};
 const ctx={location:{origin:'https://web.whatsapp.com'},__lipaRecipient:{phone:'old'},__lipaMedia:{},__lipaArmed:{},document:{querySelector:()=>null,querySelectorAll:()=>open?[heading]:[],elementFromPoint:()=>null}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/navigation.js'),'utf8'),ctx);
 ctx.lipaOpenChat({},'new');assert.equal(ctx.__lipaRecipient,undefined);assert.equal(ctx.__lipaMedia,undefined);assert.equal(ctx.__lipaArmed,undefined);
 assert.equal(ctx.lipaOpenChat({},'closed').closed,false);open=false;assert.equal(ctx.lipaOpenChat({},'closed').closed,false);
});

test('unsaved national phone format resolves after international number search',()=>{
 assert(fixture([{text:'11 1234-5678'}]).run().target);
 assert(fixture([{text:'+54 11 1234-5678'}]).run().target);
});
test('selected alias binds to opened chat without the database name, but not to stale chat',()=>{
 const phone='5491112345678';let open=true,label='Contacto anterior';
 const visible={getClientRects:()=>[{}]};
 const header={get textContent(){return label;},querySelectorAll:()=>[{...visible,getAttribute:()=>null,get textContent(){return label;}}]};
 const main={querySelector:selector=>selector.includes('footer')?{}:header};
 const ctx={location:{origin:'https://web.whatsapp.com'},document:{querySelector:()=>main,querySelectorAll:()=>open?[{...visible,textContent:'Nuevo chat'}]:[]},__lipaSelection:{phone,label:'Javi',previousHeader:header,previousLabel:'Contacto anterior'}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/navigation.js'),'utf8'),ctx);
 assert.equal(ctx.lipaOpenChat({phone,name:'Javier Martino'},'closed').closed,false);
 open=false;assert.equal(ctx.lipaOpenChat({phone},'closed').closed,false);
 label='Javi';assert.equal(ctx.lipaOpenChat({phone,name:'Javier Martino'},'closed').closed,true);
 assert.equal(ctx.__lipaRecipient.phone,phone);assert.equal(ctx.__lipaRecipient.main,main);
});
test('missing WhatsApp tab never creates one',async()=>{
 const ctx={workTab:null,job:{},stopping:false,chrome:{tabs:{query:async()=>[],create:async()=>{throw Error('Unexpected tab');}}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function reuseWhatsAppTab'),source.indexOf('async function selectChat')),ctx);
 await assert.rejects(ctx.reuseWhatsAppTab(),/Abrí WhatsApp Web/);
});
