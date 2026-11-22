const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const mount=require('../src/routes/torneosReemplazos.routes');

async function fixture(options={}){
 const source={id:'54',corroborado:true,categoria:'segunda',estado_pago:'sena',monto_sena:30000,nombre_oficial:'Mesones',jugador_id:54};
 const target={id:'157',corroborado:true,categoria:'tercera',estado_pago:'efectivo',monto_sena:null,nombre_oficial:'Damián',jugador_id:157};
 const players=Array.from({length:32},(_,i)=>({id:String(i+54),nombre:'Jugador '+i,position:i+1}));
 const grid={sorteo_revision:9,jugadores:players,resultados:options.result?{'de-w0-0':{a:'54',b:'55',score:[1,null]}}:{},mesas:{},revision:3};
 const draw={revision:9,orden:players.map(p=>p.id)};
 const history=options.started?[{a:'54',b:'55',startedAt:'2026-11-22T10:00:00Z'}]:[];
 const writes=[];
 const db={release(){},async connect(){return db;},async query(sql,args=[]){
   if(sql.startsWith('SELECT * FROM torneo_inscripciones'))return {rows:options.wrongOrganizer?[]:[source,target]};
   if(sql.startsWith('SELECT * FROM torneo_sorteos'))return {rows:[draw]};
   if(sql.startsWith('SELECT * FROM torneo_grillas'))return {rows:[grid]};
   if(sql.startsWith('SELECT entries'))return {rows:[{entries:history}]};
   if(sql.startsWith('SELECT foto_path'))return {rows:[{foto_path:'damian.jpg'}]};
   writes.push({sql,args});return {rows:[]};
 }};
 const app=express();app.use(express.json());mount(app,{pool:db,ensureSchema:async()=>{},requireTorneoOrganizador:(req,res,next)=>{req.user={torneoOrganizadorId:1};next();}});
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 const response=await fetch(`http://localhost:${server.address().port}/torneo-organizador/inscripciones/54/reemplazar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destinoId:'157'})});
 const body=await response.json();await new Promise(r=>server.close(r));return {response,body,writes};
}
test('preserves both payments, original slot and all other bracket players',async()=>{
 const {response,body,writes}=await fixture();assert.equal(response.status,200);assert.equal(body.position,1);
 const payment=writes.find(w=>w.sql.startsWith('UPDATE torneo_inscripciones SET categoria'));
 assert.equal(payment.args[0],'segunda_tercera');assert.deepEqual(JSON.parse(payment.args[1]),{tercera:{estado_pago:'efectivo',monto_sena:null},segunda:{estado_pago:'sena',monto_sena:30000}});
 const g=writes.find(w=>w.sql.startsWith('UPDATE torneo_grillas'));const players=JSON.parse(g.args[0]);
 assert.equal(players[0].id,'157');assert.equal(players[0].jugador_id,157);assert.equal(players[0].position,1);assert.equal(players[1].id,'55');assert.equal(players.length,32);
 assert(writes.some(w=>w.sql.startsWith('INSERT INTO torneo_reemplazos')));assert(writes.some(w=>w.sql==='COMMIT'));
 assert(!writes.some(w=>w.sql.includes('DELETE FROM')||w.sql.includes('resultados=')));
});
for(const [name,options] of [['score already entered',{result:true}],['match already called',{started:true}],['different organizer',{wrongOrganizer:true}]])test('rejects '+name+' without writes',async()=>{
 const {response,writes}=await fixture(options);assert.equal(response.status,409);assert(writes.some(w=>w.sql==='ROLLBACK'));assert(!writes.some(w=>/^(INSERT|UPDATE|DELETE)/.test(w.sql)));
});
