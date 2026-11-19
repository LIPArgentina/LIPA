const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const categories=require('../../frontend/torneos/categorias');
function harness() {
 const routes={},calls=[];
 const router=new Proxy({}, {get:(_,verb)=>(url,...handlers)=>{routes[verb+' '+url]=handlers.at(-1);}});
 const pool={async query(sql,args){calls.push({sql,args});return {rowCount:1,rows:[{id:12,categoria:args?.[0]}]};}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/torneosPrivados.routes.js'),'utf8'),{
  module,console,require(name){
   if(name==='express')return {Router:()=>router};if(name==='../../db')return pool;
   if(name.endsWith('/categorias'))return categories;if(name==='./torneosGrilla.routes')return ()=>{};
   return {};
  }
 });module.exports();
 return {calls,async change(categoria){let status=200,result;const res={status(code){status=code;return this;},json(value){result=value;return this;}};
  await routes['delete /torneo-organizador/inscripciones/:id']({params:{id:'12'},user:{torneoOrganizadorId:77},body:{estadoPago:categoria}},res);
  return {status,result};
 }};
}
test('withdrawal updates only status and timestamp, preserves record and scopes organizer',async()=>{
 const h=harness();assert.equal((await h.change()).status,200);const update=h.calls.at(-1);
 assert.match(update.sql,/UPDATE torneo_inscripciones SET baja_at=COALESCE\(baja_at,NOW\(\)\)/);
 assert(!update.sql.includes('DELETE'));assert(!update.sql.includes('whatsapp='));assert(!update.sql.includes('estado_pago='));assert.deepEqual(Array.from(update.args),[12,77]);
 assert(h.calls[0].sql.includes('ADD COLUMN IF NOT EXISTS baja_at TIMESTAMPTZ'));
});
