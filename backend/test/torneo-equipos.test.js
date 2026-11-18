const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('registration list uses canonical team display_name and returns team provenance',async()=>{
 const routes={};const router=new Proxy({}, {get:(_,verb)=>(url,...handlers)=>routes[verb+' '+url]=handlers.at(-1)});
 const entries=[{id:1,equipo_nombre:'Actual',equipo_actual:true},{id:2,equipo_nombre:'Histórico',equipo_actual:false},{id:3,equipo_nombre:null,equipo_actual:null}];let queried=false;
 const pool={connect:async()=>({query:async()=>({rows:[]}),release(){}}),async query(sql,args){
 if(sql.includes('team.nombre AS equipo_nombre')){queried=true;assert.match(sql,/e\.display_name AS nombre/);assert.doesNotMatch(sql,/e\.nombre/);assert.match(sql,/DESC NULLS LAST/);assert.match(sql,/LIMIT 1/);assert.match(sql,/CASE WHEN je\.activo AND e\.activo AND je\.hasta IS NULL THEN/);assert.match(sql,/WHEN 'tercera' THEN 1 WHEN 'segunda' THEN 2 WHEN 'primera' THEN 3 ELSE 4 END/);assert(sql.indexOf("WHEN 'tercera' THEN 1")<sql.indexOf('COALESCE(je.hasta, je.desde)'));assert.equal(args[0],77);return {rows:entries};}
 return {rows:sql.includes('SELECT * FROM torneo_organizadores')?[{id:77}]:[]};}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/torneosPrivados.routes.js'),'utf8'),{module,console,require(n){if(n==='express')return {Router:()=>router};if(n==='../../db')return pool;if(n==='./torneosGrilla.routes')return ()=>{};return {};}});module.exports();
 let status=200,result;await routes['get /torneo-organizador/inscripciones']({user:{torneoOrganizadorId:77}},{status(c){status=c;return this;},json(v){result=v;}});assert.equal(status,200);assert(queried);assert.deepEqual(result.inscripciones,entries);
});
