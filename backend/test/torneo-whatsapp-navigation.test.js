const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/panel.js'),'utf8');
test('reuses an existing WhatsApp tab across contacts without creating or closing it',async()=>{
 const calls=[];const ctx={workTab:null,job:{workTabId:7},stopping:false,pause:async()=>{},chrome:{tabs:{query:async()=>[{id:7,url:'https://web.whatsapp.com/'}],get:async()=>({url:'https://web.whatsapp.com/',status:'complete'}),update:async(id,options)=>calls.push({id,options}),create:async()=>{throw Error('Must reuse existing tab');}}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function reuseWhatsAppTab'),source.indexOf('async function selectChat')),ctx);await ctx.reuseWhatsAppTab();await ctx.reuseWhatsAppTab();assert.equal(ctx.workTab,7);assert.equal(calls.length,2);assert(calls.every(c=>!('url' in c.options)));assert(!source.includes('chrome.tabs.remove'));assert(!source.includes('chrome.tabs.create'));
});
test('changes contacts by visible search without navigation and fills the composer',async()=>{
 const calls=[];const ctx={workTab:7,job:{message:'Hola',media:null},stopping:false,pause:async()=>{},lipaOpenChat(){},rawStep:async()=>({target:{x:3,y:3}}),browserControl:{connect:async()=>{},click:async(t,p)=>calls.push(['click',p.x]),fillCaption:async(t,p,v)=>calls.push(['fill',v])},chrome:{scripting:{executeScript:async({args})=>[{result:args[1]==='new'?{target:{x:1,y:1}}:args[1]==='search'||args[1]==='result'?{target:{x:2,y:2}}:args[1]==='closed'?{closed:true}:{ready:true}}]},tabs:{update:async()=>{throw Error('No navigation allowed');}}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function selectChat')),ctx);
 await ctx.selectChat({phone:'5491111111111'});await ctx.selectChat({phone:'5491122222222'});
 assert.deepEqual(calls.filter(c=>c[0]==='fill').map(c=>c[1]),['+5491111111111','Hola','+5491122222222','Hola']);
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
test('number result targets the visible label inside the contact row',()=>{
 const inputRect={x:100,y:10,width:400,height:40},rowRect={x:100,y:80,width:400,height:80},spanRect={x:140,y:100,width:120,height:20};
 const row={textContent:'+54 9 11 1234-5678',getClientRects:()=>[{}],getBoundingClientRect:()=>rowRect,closest:()=>null,contains:el=>el===span,querySelector:()=>span,parentElement:null,getAttribute:key=>key==='role'?'row':null};
 const span={textContent:'+54 9 11 1234-5678',innerText:'+54 9 11 1234-5678',getClientRects:()=>[{}],getBoundingClientRect:()=>spanRect,closest:selector=>selector.includes('[role="row"]')?row:null,contains:()=>false,querySelector:()=>null,parentElement:row,getAttribute:()=>null};
 const input={value:'+5491112345678',getClientRects:()=>[{}],getBoundingClientRect:()=>inputRect,closest:()=>null,contains:()=>false,getAttribute:()=>null};
 const pane={querySelectorAll:()=>[span],parentElement:null};row.parentElement=pane;input.parentElement=pane;
 const body={};pane.parentElement=body;
 const document={body,activeElement:input,querySelectorAll:()=>[input],elementFromPoint:(x,y)=>y<60?input:(x>=spanRect.x&&x<=spanRect.x+spanRect.width&&y>=spanRect.y&&y<=spanRect.y+spanRect.height?span:row)};
 const ctx={location:{origin:'https://web.whatsapp.com'},document};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/navigation.js'),'utf8'),ctx);
 const result=ctx.lipaOpenChat({phone:'5491112345678'},'result');assert.equal(result.target.x,200);assert.equal(result.target.y,110);assert.equal(result.diagnostic.surface,'row');
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

test('fallback activates only the selected connected result for the current number',()=>{
 const f=fixture([{text:'Lucas Pool'}]);
 // Existing fixture exercises selection; activation below uses a visible current search.
 assert(f.run().target);
 let clicks=0;const input={value:'+5491112345678',getAttribute:()=>null,getClientRects:()=>[{}],closest:()=>null,getBoundingClientRect:()=>({x:0,y:0,width:100,height:30}),contains:()=>false};
 const heading={textContent:'Nuevo chat',getClientRects:()=>[{}]};
 const element={isConnected:true,getClientRects:()=>[{}],click(){clicks++;}};
 const ctx={location:{origin:'https://web.whatsapp.com'},__lipaSelection:{phone:'5491112345678',element},document:{querySelectorAll:selector=>selector==='h1,h2,header,span'?[heading]:[input],elementFromPoint:()=>input}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/navigation.js'),'utf8'),ctx);
 assert(ctx.lipaOpenChat({phone:'5491112345678'},'activate').activated);assert.equal(clicks,1);
 input.value='+5491199999999';ctx.lipaOpenChat({phone:'5491112345678'},'activate');assert.equal(clicks,1);
 input.value='+5491112345678';element.isConnected=false;ctx.lipaOpenChat({phone:'5491112345678'},'activate');assert.equal(clicks,1);
});

test('selects title name with emoji instead of broad result row or status subtitle',()=>{
 const input={value:'+5491112345678',getAttribute:()=>null,getClientRects:()=>[{}],closest:()=>null,getBoundingClientRect:()=>({x:50,y:10,width:300,height:30}),contains:()=>false};
 const label={tagName:'SPAN',textContent:'Germán  Pool',getAttribute:k=>k==='title'?'Germán 👨🏻‍🏭 Pool':k==='dir'?'auto':null,getClientRects:()=>[{}],closest:()=>null,getBoundingClientRect:()=>({x:120,y:100,width:120,height:24}),contains:()=>false,matches:s=>s==='span[title][dir=auto]',querySelector:()=>null};
 const pane={querySelectorAll:()=>[label],parentElement:null};input.parentElement=pane;label.parentElement=pane;
 const ctx={location:{origin:'https://web.whatsapp.com'},document:{body:{},querySelectorAll:()=>[input],elementFromPoint:(x,y)=>y<40?input:label}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/navigation.js'),'utf8'),ctx);
 const result=ctx.lipaOpenChat({phone:'5491112345678',name:'Nombre distinto en LIPA'},'result');assert.equal(result.target.x,180);assert.equal(result.target.y,112);assert.equal(result.diagnostic.label,'Germán 👨🏻‍🏭 Pool');assert.equal(ctx.__lipaSelection.element,label);
});
