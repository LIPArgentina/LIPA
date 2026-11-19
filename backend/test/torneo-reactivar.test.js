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
   if(name.endsWith('/categorias'))return categories;if(['./torneosGrilla.routes','./torneosVisor.routes','./torneoDifusion.routes'].includes(name))return ()=>{};
   return {};
  }
 });module.exports();
 return {calls,async change(categoria){let status=200,result;const res={status(code){status=code;return this;},json(value){result=value;return this;}};
  await routes['patch /torneo-organizador/inscripciones/:id/reactivar']({params:{id:'12'},user:{torneoOrganizadorId:77},body:{estadoPago:categoria}},res);
  return {status,result};
 }};
}
test('reactivation clears only withdrawal, preserves payment and contact, and scopes organizer',async()=>{
 const h=harness();assert.equal((await h.change()).status,200);const update=h.calls.at(-1);
 assert.match(update.sql,/SET baja_at=NULL, updated_at=NOW\(\)/);assert.match(update.sql,/AND baja_at IS NOT NULL/);assert.match(update.sql,/RETURNING \*/);
 assert(!update.sql.includes('whatsapp='));assert(!update.sql.includes('estado_pago='));assert(!update.sql.includes('monto_sena='));assert(!update.sql.includes('categoria='));assert.deepEqual(Array.from(update.args),[12,77]);
});