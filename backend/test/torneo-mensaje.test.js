const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function harness() {
  const routes={},calls=[],messages=new Map();
  const auth=()=>{};
  const router=new Proxy({}, {get:(_,verb)=>(url,...handlers)=>{routes[verb+' '+url]=handlers;}});
  const pool={async query(sql,args){calls.push({sql,args});
    if(sql.startsWith('UPDATE torneo_organizadores SET mensaje_difusion')) {messages.set(args[1],args[0]);return {rowCount:1,rows:[{mensaje_difusion:args[0]}]};}
    return {rows:[],rowCount:0};
  }};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/torneosPrivados.routes.js'),'utf8'),{module,console,require(name){
    if(name==='express')return {Router:()=>router};if(name==='../../db')return pool;
    if(name==='../middleware/auth')return {requireTorneoOrganizador:auth};
    if(name==='./torneosGrilla.routes')return ()=>{};return {};
  }});module.exports();
  const handlers=routes['put /torneo-organizador/mensaje-difusion'];
  assert.equal(handlers[0],auth);
  return {calls,messages,async save(mensaje,id=77){let status=200,result;const res={status(code){status=code;return this;},json(value){result=value;}};
    await handlers.at(-1)({user:{torneoOrganizadorId:id},body:{mensaje,torneoOrganizadorId:999}},res);return {status,result};
  }};
}
test('message persists emojis/newlines for authenticated organizer only',async()=>{
 const h=harness(),text='Hola 🎱\nSeña & torneo 🏆';
 assert.equal((await h.save(text)).result.mensaje,text);
 await h.save('Otro organizador',88);
 assert.equal(h.messages.get(77),text);assert.equal(h.messages.get(88),'Otro organizador');assert.equal(h.messages.has(999),false);
 assert(h.calls[0].sql.includes('ADD COLUMN IF NOT EXISTS mensaje_difusion'));
});
test('invalid message is rejected before database access',async()=>{
 const h=harness();for(const value of [null,{},'', '   ','x'.repeat(4001)]) assert.equal((await h.save(value)).status,400);
 assert.equal(h.calls.length,0);
});
