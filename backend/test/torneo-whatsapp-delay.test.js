const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const dir=path.join(__dirname,'../../tools/lipa-whatsapp');
function fixture(){
 let listener;const timers=[];
 const chrome={runtime:{id:'lipa',getURL:p=>'chrome-extension://lipa/'+p,onMessage:{addListener:f=>listener=f}},action:{onClicked:{addListener(){}}}};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),{chrome,setTimeout:(fn,ms)=>timers.push({fn,ms})});
 return {timers,request:(request,sender={id:'lipa',url:chrome.runtime.getURL('panel.html')},respond=()=>{})=>listener(request,sender,respond)};
}
test('background delay holds response until requested time, without tab timers or browser actions',()=>{
 const f=fixture();let response;assert.equal(f.request({type:'delay',ms:10000},undefined,r=>response=r),true);
 assert.equal(response,undefined);assert.equal(f.timers.length,1);assert.equal(f.timers[0].ms,10000);f.timers[0].fn();assert.equal(response.ok,true);
});
test('delay rejects other senders and out-of-range durations',()=>{
 const f=fixture();for(const sender of [{id:'other',url:'chrome-extension://lipa/panel.html'},{id:'lipa',url:'https://lipa.ar/torneos/privados.html'}])f.request({type:'delay',ms:10000},sender);
 for(const ms of [-1,10001,NaN,'1000']){let result;f.request({type:'delay',ms},undefined,r=>result=r);assert.ok(result.error);}
 assert.equal(f.timers.length,0);
});
test('panel delegates waits and fails closed when extension worker is outdated',async()=>{
 const source=fs.readFileSync(path.join(dir,'panel.js'),'utf8');const declaration=source.slice(source.indexOf('const pause='),source.indexOf('const browserControl='));
 const calls=[];const context={chrome:{runtime:{sendMessage:async r=>{calls.push(r);return {ok:true};}}},setTimeout:()=>{throw Error('Hidden panel timer used');}};vm.createContext(context);vm.runInContext(declaration+'globalThis.wait=pause;',context);await context.wait(10000);assert.equal(calls[0].ms,10000);
 context.chrome.runtime.sendMessage=async()=>undefined;await assert.rejects(context.wait(500),/Recargá/);
 const html=fs.readFileSync(path.join(dir,'panel.html'),'utf8');for(const id of ['audit','diagnose','prepareTest','testContact','diagnostic']){assert.ok(!html.includes('id="'+id+'"'));assert.ok(!source.includes("$('"+id+"')"));}
});
