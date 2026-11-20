const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/panel.js'),'utf8');
test('reuses an existing WhatsApp tab across contacts without navigating or closing it',async()=>{
 const calls=[];const ctx={workTab:null,job:{workTabId:7},stopping:false,pause:async()=>{},chrome:{tabs:{query:async()=>[{id:7,url:'https://web.whatsapp.com/'}],get:async()=>({url:'https://web.whatsapp.com/',status:'complete'}),update:async(id,options)=>calls.push({id,options}),create:async()=>{throw Error('Must reuse existing tab');}}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function reuseWhatsAppTab'),source.indexOf('async function selectChat')),ctx);await ctx.reuseWhatsAppTab();await ctx.reuseWhatsAppTab();assert.equal(ctx.workTab,7);assert.equal(calls.length,2);assert(calls.every(c=>!('url' in c.options)));assert(!source.includes('chrome.tabs.remove'));assert(!source.includes('/send?phone='));
});
test('search result selection does not choose an ambiguous contact or send any message',()=>{
 const make=()=>({innerText:'Jugador\n+5491112345678',getClientRects:()=>[{}],closest:()=>null,contains:()=>false,getBoundingClientRect:()=>({x:1,y:1,width:20,height:20})});let rows=[make()];
 const ctx={location:{origin:'https://web.whatsapp.com'},document:{querySelectorAll:()=>rows,elementFromPoint:()=>rows[0]}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/navigation.js'),'utf8'),ctx);
 assert(ctx.lipaOpenChat({phone:'5491112345678',name:'Jugador'},'result').target);rows.push(make());assert(!ctx.lipaOpenChat({phone:'5491112345678',name:'Jugador'},'result').target);
});

test('search accepts exposed search input, ignores covered field and verifies written number',()=>{
 const make=(value)=>({value,getAttribute:k=>k==='placeholder'?'Buscar nombre, núm. o @nombre de usuario':null,getClientRects:()=>[{}],closest:()=>null,contains:()=>false,getBoundingClientRect:()=>({x:1,y:1,width:20,height:20})});
 const covered=make(''),search=make('');
 const ctx={location:{origin:'https://web.whatsapp.com'},document:{querySelectorAll:selector=>{assert(selector.includes('input[type="search"]'));assert(selector.includes('[contenteditable="true"]'));return [covered,search];},elementFromPoint:()=>search}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/navigation.js'),'utf8'),ctx);
 assert(ctx.lipaOpenChat({phone:'5491112345678'},'search').target);
 assert.equal(ctx.lipaOpenChat({phone:'5491112345678'},'typed').ready,false);
 search.value='+5491112345678';assert.equal(ctx.lipaOpenChat({phone:'5491112345678'},'typed').ready,true);
});
