const {test}=require('node:test'),assert=require('node:assert/strict');
const slots=require('../../frontend/torneos/cupos');
const actualBracket=require('../../frontend/torneos/grilla-engine');
const bracket={...actualBracket,build:(players,stored={},category='segunda')=>actualBracket.build(players,stored,category)};
const crypto=require('node:crypto');
const roster=n=>Array.from({length:n},(_,i)=>({id:String(i+1),nombre:`Jugador ${i+1}`,ranking:i+1}));
const vacant=rows=>rows.flatMap((p,i)=>p.id===null?[i+1]:[]);
function enter(state,players,id,score,category){const m=state.matches.find(m=>m.id===id);return bracket.build(players,{...state.clean,[id]:{a:m.a,b:m.b,score}},category);}
test('20 players reserve multiples of 3; each new player fills the next WO',()=>{
 for(const category of ['segunda']){
  const expected=Array.from({length:10},(_,i)=>(i+1)*3);
  for(let n=20;n<=30;n++){
   const result=slots.fill(roster(n),category);assert.equal(result.length,30);assert.deepEqual(vacant(result),expected.slice(n-20));
   assert.equal(result.filter(p=>p.id!==null).length,n);
   assert(slots.validOrder(result.map(p=>p.id),roster(n).map(p=>p.id),category));
  }
 }
});
test('shuffle changes real order but never moves WO, including repeated runs',()=>{
 for(const n of [2,9,20,21,29,30]){
  let rows=slots.fill(roster(n),'segunda');const positions=vacant(rows),ids=rows.filter(p=>p.id!==null).map(p=>p.id).sort();
  for(let i=0;i<30;i++){
   const prior=rows.map(p=>p.id);rows=slots.shuffle(rows,max=>crypto.randomInt(max));
   assert.deepEqual(vacant(rows),positions);assert.deepEqual(rows.filter(p=>p.id!==null).map(p=>p.id).sort(),ids);assert.notDeepEqual(rows.map(p=>p.id),prior);
  }
 }
 assert.equal(slots.shuffle(slots.fill(roster(1),'segunda'),()=>0).filter(p=>p.id!==null).length,1);
});
test('Primera keeps legacy unpadded default and accepts explicit WO',()=>{
 assert.equal(slots.fill(roster(20),'primera').length,20);assert(!slots.enabled('primera'));
 assert(!slots.validOrder(slots.fill(roster(20),'segunda').map(p=>p.id),roster(20).map(p=>p.id),'primera'));
 assert(bracket.build(slots.fill(roster(20),'primera',30),{},'primera'));
 const s=bracket.build(roster(30),{},'primera');assert.equal(s.main[0].filter(m=>m.bye).length,1);
});
test('WO advances immediately with no score or loser; pending is not WO',()=>{
 const players=slots.fill(roster(20),'segunda');let s=bracket.build(players);
 assert.equal(s.main[0][1].a,null);assert.equal(s.main[0][1].winner,players[3].id);assert.equal(s.main[0][1].loser,null);
 assert(s.main[0][1].woA);assert.equal(Object.keys(s.clean).length,0);
 assert.equal(s.main[1][0].winner,null);assert(!s.main[1][0].woA);assert.equal(s.final.winner,null);
});
test('every roster size 2..30 completes without scoring WO or duplicate octavos',()=>{
 for(const category of ['segunda'])for(let n=2;n<=30;n++){
  const players=slots.fill(roster(n),category);let s=bracket.build(players,{},category),games=0;
  while(!s.champion){
   const match=s.matches.find(m=>m.a&&m.b&&!m.resolved);assert(match,`No next match: ${category}/${n}`);
   assert(!match.bye);assert.notEqual(match.a,match.b);s=enter(s,players,match.id,[bracket.limits[category],0],category);
   assert(++games<=2*n-2);
  }
  assert(s.champion);assert(s.main[0].every(m=>m.resolved));assert.equal(games,s.matches.filter(m=>m.a&&m.b).length);
  assert(s.rep.flat().every(m=>!m.a||roster(n).some(p=>p.id===m.a)));
  const octavos=s.main[1].flatMap(m=>[m.a,m.b]).filter(Boolean);assert.equal(new Set(octavos).size,octavos.length);
  assert.equal(bracket.build(players,JSON.parse(JSON.stringify(s.clean)),category).champion,s.champion);
 }
});
test('invalid WO placement, missing players and duplicates are rejected',()=>{
 const players=roster(20),order=slots.fill(players,'segunda').map(p=>p.id);
 const moved=[...order];[moved[0],moved[2]]=[moved[2],moved[0]];
 assert(!slots.validOrder(moved,players.map(p=>p.id),'segunda'));
 assert(!slots.validOrder(order,roster(21).map(p=>p.id),'segunda'));
 const duplicate=[...order];duplicate[0]=duplicate[1];assert(!slots.validOrder(duplicate,players.map(p=>p.id),'segunda'));
});
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
async function saveDraw(category,order,count){
 const routes={},calls=[],ids=roster(count).map(p=>p.id),router=new Proxy({}, {get:(_,verb)=>(url,...handlers)=>{routes[verb+' '+url]=handlers.at(-1);}});
 const query=async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT id FROM torneo_inscripciones')){assert(sql.includes("baja_at IS NULL"));assert(sql.includes("estado_pago IN ('sena', 'total', 'efectivo')"));return {rows:ids.map(id=>({id}))};}if(sql.startsWith('INSERT INTO torneo_sorteos'))return {rows:[{revision:1}]};return {rows:[]};};
 const client={query,release(){}},pool={query,connect:async()=>client},module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/torneosPrivados.routes.js'),'utf8'),{module,console,require(name){if(name==='express')return {Router:()=>router};if(name==='../../db')return pool;if(name.endsWith('/cupos'))return slots;if(name.endsWith('/categorias'))return require('../../frontend/torneos/categorias');if(['./torneosGrilla.routes','./torneosVisor.routes'].includes(name))return ()=>{};return {};}});module.exports();
 let status=200,data;const res={status(s){status=s;return this;},json(d){data=d;return this;}};
 await routes['put /torneo-organizador/sorteos/:categoria']({params:{categoria:category},user:{torneoOrganizadorId:77},body:{orden:order,revision:0}},res);
 return {status,data,calls};
}
test('draw API saves fixed WO, rejects moved WO, and accepts explicit WO in Primera',async()=>{
 const order=slots.fill(roster(20),'segunda').map(p=>p.id);
 let response=await saveDraw('segunda',order,20);assert.equal(response.status,200);const saved=response.calls.find(q=>q.sql.startsWith('INSERT INTO torneo_sorteos'));assert.deepEqual(JSON.parse(saved.args[2]),order);
 response=await saveDraw('segunda',order,20);assert.equal(response.status,200);
 response=await saveDraw('primera',order,20);assert.equal(response.status,200);
 const moved=[...order];[moved[0],moved[2]]=[moved[2],moved[0]];response=await saveDraw('segunda',moved,20);assert.equal(response.status,409);
 assert(!response.calls.some(q=>q.sql.startsWith('INSERT INTO torneo_sorteos')));
});

test('explicit 64 places has exactly two fixed WO for 62 players in every category',async()=>{
 for(const category of ['primera','segunda','tercera']){
 const players=slots.fill(roster(62),category,64),ids=roster(62).map(p=>p.id);assert.equal(players.length,64);assert.equal(players.filter(p=>p.id===null).length,2);
 assert(slots.validOrder(players.map(p=>p.id),ids,category,64));assert.throws(()=>slots.fill(roster(62),category,60));
 const shuffled=slots.shuffle(players,n=>Math.floor(Math.random()*n));assert.deepEqual(shuffled.map(p=>p.id===null),players.map(p=>p.id===null));
 assert.equal((await saveDraw(category,players.map(p=>p.id),62)).status,200);
 }
});