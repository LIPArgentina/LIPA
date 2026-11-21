const {test}=require('node:test');const assert=require('node:assert/strict');
const create=require('../../tools/lipa-whatsapp/control');
function fixture({allowed=true,url='https://web.whatsapp.com/',active=true,failRelease=false}={}) {
 const calls=[];
 const api={tabs:{get:async()=>({url,active})},permissions:{contains:async()=>allowed},debugger:{
  attach:async target=>calls.push(['attach',target]),detach:async target=>calls.push(['detach',target]),
  sendCommand:async(target,method,args)=>{calls.push([method,args.type]);if(failRelease&&args.type==='mouseReleased')throw Error('Interrupted');},
  onDetach:{addListener(){}}
 }};
 return {control:create(api),calls};
}
test('browser clicks exactly once and detaches after use',async()=>{
 const f=fixture();await f.control.connect(8);await f.control.click(8,{x:20,y:30});await f.control.release();
 assert.deepEqual(f.calls.map(c=>c[0]==='Input.dispatchMouseEvent'?c[1]:c[0]),['attach','mouseMoved','mousePressed','mouseReleased','detach']);
});
test('permission, wrong site and hidden tab fail before attach',async()=>{
 for(const options of [{allowed:false},{url:'https://example.com/'},{active:false}]){
  const f=fixture(options);await assert.rejects(f.control.connect(8));assert.equal(f.calls.length,0);
 }
});
test('cancelled action never presses; partial failure is not retried',async()=>{
 const f=fixture();await f.control.connect(8);await assert.rejects(f.control.click(8,{x:20,y:30},()=>true));
 assert.equal(f.calls.length,1);
 const partial=fixture({failRelease:true});await partial.control.connect(8);await assert.rejects(partial.control.click(8,{x:20,y:30}));
 assert.equal(partial.calls.filter(c=>c[1]==='mousePressed').length,1);
 assert.equal(partial.calls.filter(c=>c[1]==='mouseReleased').length,1);
});
test('multiline caption preserves blank lines and emojis using Shift+Enter, never plain Enter',async()=>{
 const calls=[];const api={tabs:{get:async()=>({url:'https://web.whatsapp.com/',active:true})},permissions:{contains:async()=>true},debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(target,method,args)=>calls.push({method,args}),onDetach:{addListener(){}}}};
 const control=create(api);await control.connect(1);await control.fillCaption(1,{x:20,y:30},'Hola 👋\n\nEl alias es:\nlipa.trebol');
 assert.deepEqual(calls.filter(c=>c.method==='Input.insertText').map(c=>c.args.text),['Hola 👋','El alias es:','lipa.trebol']);
 const enter=calls.filter(c=>c.args.key==='Enter');assert.equal(enter.length,6);assert(enter.every(c=>c.args.modifiers===8));
});

test('navigation handles only its own beforeunload and removes handler afterwards',async()=>{
 let listener,removed=false;const commands=[];
 const api={tabs:{get:async()=>({url:'https://web.whatsapp.com/',active:true})},permissions:{contains:async()=>true},debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(t,m,p)=>commands.push({m,p}),onDetach:{addListener(){}},onEvent:{addListener(fn){listener=fn;},removeListener(fn){assert.equal(fn,listener);removed=true;}}}};
 const control=create(api);
 await control.navigate(7,async()=>{
 listener({tabId:8},'Page.javascriptDialogOpening',{type:'beforeunload'});
 listener({tabId:7},'Page.javascriptDialogOpening',{type:'confirm'});
 listener({tabId:7},'Page.javascriptDialogOpening',{type:'beforeunload'});
 });
 assert.deepEqual(commands.filter(c=>c.m==='Page.handleJavaScriptDialog'),[{m:'Page.handleJavaScriptDialog',p:{accept:true}}]);assert(removed);
 assert(!commands.some(c=>c.m.startsWith('Input.')));
 removed=false;await assert.rejects(control.navigate(7,async()=>{throw Error('timeout');}));assert(removed);
});

test('result activation sends Enter only after focusing the current search result',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');const calls=[];let focused=false;
 const api={tabs:{get:async()=>({active:true,url:'https://web.whatsapp.com/'})},permissions:{contains:async()=>true},scripting:{executeScript:async()=>[{result:{focused}}]},debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(t,m,p)=>calls.push({m,p}),onDetach:{addListener(){}}}};
 const ctx={URL,lipaOpenChat(){},api};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../../tools/lipa-whatsapp/control'),'utf8'),ctx);
 const control=ctx.lipaBrowserControl(api);await control.connect(7);
 assert.equal(await control.activateResult(7,{phone:'123'}),false);assert.equal(calls.length,0);
 focused=true;assert.equal(await control.activateResult(7,{phone:'123'}),true);assert.deepEqual(calls.map(c=>c.p.type),['keyDown','keyUp']);
 assert(calls.every(c=>c.p.key==='Enter'));assert.equal(await control.activateResult(7,{phone:'123'},()=>false),true);
});
