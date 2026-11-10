const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const categories=require('../../frontend/torneos/categorias');
test('dual categories enter both divisions once, but never the third',()=>{
 assert.deepEqual(categories.valuesFor('primera'),['primera','primera_segunda']);
 assert.deepEqual(categories.valuesFor('segunda'),['segunda','primera_segunda','segunda_tercera']);
 assert.deepEqual(categories.valuesFor('tercera'),['tercera','segunda_tercera']);
 const entries=[{id:1,categoria:'segunda_tercera'},{id:2,categoria:'primera_segunda'},{id:3,categoria:'tercera'}];
 assert.deepEqual(entries.filter(p=>categories.includes(p.categoria,'segunda')).map(p=>p.id),[1,2]);
 assert.deepEqual(entries.filter(p=>categories.includes(p.categoria,'tercera')).map(p=>p.id),[1,3]);
 assert.deepEqual(entries.filter(p=>categories.includes(p.categoria,'primera')).map(p=>p.id),[2]);
 assert(!categories.valid('primera_tercera'));assert(!categories.valid(['primera']));assert(!categories.valid(null));assert(!categories.valid('__proto__'));
});
test('category filters match single and combined registration values',()=>{
 assert(categories.matches('segunda_tercera','segunda'));assert(categories.matches('segunda_tercera','tercera'));assert(!categories.matches('segunda_tercera','primera'));
 assert(categories.matches('primera_segunda','primera'));assert(categories.matches('primera_segunda','segunda'));assert(!categories.matches('primera_segunda','tercera'));
});
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
  await routes['patch /torneo-organizador/inscripciones/:id/categoria']({params:{id:'12'},user:{torneoOrganizadorId:77},body:{categoria}},res);
  return {status,result};
 }};
}
test('registration API persists both options for the current organizer and migrates before updating',async()=>{
 for(const category of ['segunda_tercera','primera_segunda']){
  const h=harness(),response=await h.change(category);assert.equal(response.status,200);assert.equal(response.result.inscripcion.categoria,category);
  assert(h.calls[0].sql.includes("'primera_segunda', 'segunda_tercera'"));
  const update=h.calls.at(-1);assert(update.sql.includes('torneo_organizador_id=$3'));assert.deepEqual(Array.from(update.args),[category,12,77]);
 }
});
test('registration API rejects unsupported combinations without touching the database',async()=>{
 const h=harness();for(const value of ['primera_tercera','primera_segunda_tercera',null,['segunda']])assert.equal((await h.change(value)).status,400);
 assert.equal(h.calls.length,0);
});
