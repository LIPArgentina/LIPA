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
