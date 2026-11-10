const {test}=require('node:test');
const assert=require('node:assert/strict');
const mount=require('../src/routes/torneosGrilla.routes');
const engine=require('../../frontend/torneos/grilla-engine');
function harness() {
  const players=Array.from({length:30},(_,i)=>({id:String(i+1),jugador_id:i+101,nombre:`Jugador ${i+1}`,foto_path:'',ranking:i+1,position:i+1,categoria:i<2?'segunda_tercera':'tercera'}));
  let stored={jugadores:players,resultados:{},revision:0,sorteo_revision:1};
  const calls=[],routes={};let eligible=players,drawRevision=1,rankCalls=0;
  const auth=()=>{};
  const client={release(){calls.push('RELEASE');},async query(sql,args){
    calls.push(sql);
    if(sql.startsWith('SELECT orden'))return {rows:[{orden:players.map(p=>p.id),revision:drawRevision}]};
    if(sql.includes('FROM torneo_inscripciones i')){assert.equal(args[0],77);assert.deepEqual(args[1],['tercera','segunda_tercera']);assert(sql.includes('ANY($2::text[])'));return {rows:eligible.filter(p=>args[1].includes(p.categoria))};}
    if(sql.startsWith('SELECT sorteo_revision'))return {rows:stored?[{sorteo_revision:stored.sorteo_revision}]:[]};
    if(sql.startsWith('INSERT INTO torneo_grillas')){if(!stored)stored={jugadores:JSON.parse(args[3]),resultados:{},revision:0,sorteo_revision:args[2]};return {rows:[]};}
    if(sql.startsWith('SELECT * FROM torneo_grillas'))return {rows:stored?[stored]:[]};
    if(sql.startsWith('UPDATE torneo_grillas')){assert.equal(args[1],77);assert.equal(args[2],'tercera');stored.resultados=JSON.parse(args[0]);stored.revision++;return {rows:[{revision:stored.revision}]};}
    return {rows:[]};
  }};
  const pool={query:client.query,connect:async()=>client};
  mount({get(path,guard,fn){assert.equal(guard,auth);routes.get=fn;},patch(path,guard,fn){assert.equal(guard,auth);routes.patch=fn;}},{pool,ensureSchema:async()=>{},requireTorneoOrganizador:auth,getTournamentRanking:async()=>{rankCalls++;return [...players].reverse().map(p=>({id:p.jugador_id}));}});
  return {players,calls,get stored(){return stored;},set stored(value){stored=value;},set eligible(value){eligible=value;},set drawRevision(value){drawRevision=value;},get rankCalls(){return rankCalls;},async request(method,body={}){let status=200,data;const res={status(s){status=s;return this;},json(d){data=d;return this;},set(){}};await routes[method]({params:{categoria:'tercera'},user:{torneoOrganizadorId:77},body},res);return {status,data};}};
}
test('GET initializes ranking snapshot and reuses it on later requests',async()=>{
 const h=harness();h.stored=null;let r=await h.request('get');assert.equal(r.status,200);assert.equal(r.data.players[0].ranking,30);assert.equal(h.rankCalls,1);
 r=await h.request('get');assert.equal(r.data.players[0].ranking,30);assert.equal(h.rankCalls,1);
});
test('PATCH saves only a valid known match and persists revision',async()=>{
 const h=harness();const r=await h.request('patch',{matchId:'p-0',score:[5,0],revision:0,drawRevision:1});assert.equal(r.status,200);assert.equal(r.data.revision,1);assert.deepEqual(h.stored.resultados['p-0'],{a:'1',b:'2',score:[5,0]});assert(h.calls.includes('COMMIT'));assert.equal(h.calls.at(-1),'RELEASE');
});
test('rejects invalid score, unavailable round, stale revision and changed roster',async()=>{
 let h=harness();let r=await h.request('patch',{matchId:'p-0',score:[6,0],revision:0,drawRevision:1});assert.equal(r.status,400);assert.equal(h.calls.length,0);
 h=harness();r=await h.request('patch',{matchId:'m4-0',score:[5,0],revision:0,drawRevision:1});assert.equal(r.status,400);
 h=harness();r=await h.request('patch',{matchId:'p-0',score:[5,0],revision:1,drawRevision:1});assert.equal(r.status,409);assert.equal(r.data.code,'STALE');assert(h.calls.includes('ROLLBACK'));
 h=harness();h.eligible=h.players.slice(1);r=await h.request('patch',{matchId:'p-0',score:[5,0],revision:0,drawRevision:1});assert.equal(r.status,422);assert.equal(h.stored.revision,0);
 h=harness();h.drawRevision=2;r=await h.request('patch',{matchId:'p-0',score:[5,0],revision:0,drawRevision:1});assert.equal(r.status,409);
});
test('requires confirmation to clear downstream results and preserves other games',async()=>{
 const h=harness();let s=engine.build(h.players);
 for(let i=0;i<4;i++){const m=s.matches.find(m=>m.id===`p-${i}`);s=engine.build(h.players,{...s.clean,[m.id]:{a:m.a,b:m.b,score:[5,1]}});}
 for(const id of ['m1-0','m1-1']){const m=s.matches.find(m=>m.id===id);s=engine.build(h.players,{...s.clean,[m.id]:{a:m.a,b:m.b,score:[5,1]}});}
 h.stored.resultados=s.clean;const body={matchId:'p-0',score:[0,5],revision:0,drawRevision:1};
 let r=await h.request('patch',body);assert.equal(r.status,409);assert.equal(r.data.code,'CONFIRM_CORRECTION');assert(h.stored.resultados['m1-0']);
 r=await h.request('patch',{...body,confirmCorrection:true});assert.equal(r.status,200);assert(!h.stored.resultados['m1-0']);assert(h.stored.resultados['m1-1']);
});
