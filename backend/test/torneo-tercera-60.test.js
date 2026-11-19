const {test}=require('node:test'),assert=require('node:assert/strict');
const engine=require('../../frontend/torneos/grilla-engine'),slots=require('../../frontend/torneos/cupos');
const roster=n=>Array.from({length:n},(_,i)=>({id:String(i+1),nombre:`Jugador ${i+1}`,ranking:i+1}));
function play(s,players,m){return engine.build(players,{...s.clean,[m.id]:{a:m.a,b:m.b,score:[5,1]}},'tercera');}
test('Tercera WO remain fixed up to 60; other capacities unchanged',()=>{
 assert.equal(slots.capacity('primera'),30);assert.equal(slots.capacity('segunda'),30);assert.equal(slots.capacity('tercera'),60);
 for(let n=40;n<=60;n++){
  const p=slots.fill(roster(n),'tercera');assert.equal(p.length,60);
  assert.deepEqual(p.flatMap((p,i)=>p.id===null?[i+1]:[]),Array.from({length:20},(_,i)=>(i+1)*3).slice(n-40));
  assert(slots.validOrder(p.map(p=>p.id),roster(n).map(p=>p.id),'tercera'));
 }
 assert(!slots.validOrder(roster(30).map(p=>p.id),roster(30).map(p=>p.id),'tercera'));
});
test('Tercera completes every roster size from 2 to 60 without a WO score',()=>{
 for(let n=2;n<=60;n++){
  const players=slots.fill(roster(n),'tercera');let s=engine.build(players,{},'tercera'),steps=0;
  while(!s.champion){const m=s.matches.find(m=>m.a&&m.b&&!m.resolved);assert(m,`Blocked with ${n}`);assert.notEqual(m.a,m.b);s=play(s,players,m);assert(++steps<=2*n-2);}
  assert.equal(steps,2*n-2);assert(s.final.winner);
 }
});
