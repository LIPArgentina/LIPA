const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../../frontend/torneos/grilla-engine');
const players=Array.from({length:30},(_,i)=>({id:String(i+1),nombre:`Jugador ${i+1}`,ranking:30-i,position:i+1}));
function enter(state,id,a,b,roster=players,category='tercera') {
  const m=state.matches.find(m=>m.id===id);return engine.build(roster,{...state.clean,[id]:{a:m.a,b:m.b,score:[a,b]}},category);
}
function firstRound(roster=players) {
  let s=engine.build(roster);for(let i=0;i<15;i++)s=enter(s,`p-${i}`,5,2,roster);return s;
}
test('requires 30 and preserves exact first-round order',()=>{
  assert.throws(()=>engine.build(players.slice(1)));const s=engine.build(players);assert.equal(s.main[0].length,16);
  for(let i=0;i<15;i++){assert.equal(s.main[0][i].a,String(i*2+1));assert.equal(s.main[0][i].b,String(i*2+2));}
  assert.equal(s.bye,null);
});
test('dynamic score, zero, draw and incomplete result',()=>{
  let s=engine.build(players);s=enter(s,'p-0',1,0);assert.equal(s.main[0][0].winner,'1');
  s=enter(s,'p-0',1,1);assert.equal(s.main[0][0].winner,null);
  s=enter(s,'p-0',null,1);assert.equal(s.main[0][0].winner,null);
  s=enter(s,'p-0',0,3);assert.equal(s.main[0][0].winner,'2');
});
test('bye chooses points, difference, then ranking and retains other loser order',()=>{
  let s=firstRound();assert.equal(s.bye.id,'30');
  s=enter(s,'p-0',5,4);assert.equal(s.bye.id,'2');
  s=enter(s,'p-1',5,4);assert.equal(s.bye.id,'4');
  s=enter(s,'p-0',5,3);s=enter(s,'p-1',4,3);assert.equal(s.bye.id,'4');
  const repIds=s.rep[0].slice(0,7).flatMap(m=>[m.a,m.b]);assert.deepEqual(repIds,Array.from({length:15},(_,i)=>String((i+1)*2)).filter(id=>id!=='4'));
  assert.equal(s.rep[0][7].winner,'4');
});
test('full bracket produces one repechage qualifier and one champion without duplicates',()=>{
  let s=firstRound();
  for(let r=0;r<4;r++)for(const m of s.rep[r])if(m.a&&m.b)s=enter(s,m.id,5,1);
  assert(s.qualifier);assert.equal(s.main[1][7].b,s.qualifier);
  assert.equal(new Set(s.main[1].flatMap(m=>[m.a,m.b])).size,16);
  for(let r=1;r<5;r++)for(const m of s.main[r]){assert(m.a&&m.b);s=enter(s,m.id,5,2);}
  assert.equal(s.champion,'1');assert.equal(Object.keys(s.clean).length,44);
  assert.equal(engine.build(players,JSON.parse(JSON.stringify(s.clean))).champion,'1');
});
test('correction clears affected descendants, preserves unrelated games, no stale resurrection',()=>{
  let s=firstRound();s=enter(s,'m1-0',5,1);s=enter(s,'m1-1',5,1);s=enter(s,'m2-0',5,1);
  const before=s;s=enter(s,'p-0',0,5);
  assert(!s.clean['m1-0']);assert(!s.clean['m2-0']);assert(s.clean['m1-1']);
  assert(engine.invalidated(before,s,'p-0').includes('m2-0'));
  s=enter(s,'p-0',5,2);assert(!s.clean['m1-0']);
});
test('bye recalculation invalidates repechage matches with changed players',()=>{
  let s=firstRound();s=enter(s,'r0-0',5,1);assert(s.clean['r0-0']);s=enter(s,'p-0',5,4);
  assert.equal(s.bye.id,'2');assert(!s.clean['r0-0']);
});
test('same winner correction preserves downstream main results',()=>{
  let s=firstRound();s=enter(s,'m1-0',5,1);s=enter(s,'p-0',4,2);assert(s.clean['m1-0']);
});
test('score limits and ranking absent fallback are deterministic',()=>{
  let s=engine.build(players);s=enter(s,'p-0',6,1);assert.equal(s.main[0][0].winner,null);
  s=engine.build(players,{},'primera');s=enter(s,'p-0',7,0,players,'primera');assert.equal(s.main[0][0].winner,'1');
  const unranked=players.map(p=>({...p,ranking:null}));s=firstRound(unranked);assert.equal(s.bye.id,'2');assert(s.rankingFallback);
});
