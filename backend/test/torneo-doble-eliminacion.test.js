const {test}=require('node:test'),assert=require('node:assert/strict');const engine=require('../../frontend/torneos/grilla-engine');
function run(n,slots=n,category='tercera',reverse=false){
 const players=Array.from({length:slots},(_,i)=>({id:i<n?String(i+1):null}));let state=engine.build(players,{},category),steps=0;const losses=new Map(players.filter(p=>p.id).map(p=>[p.id,0]));const eliminated=new Set();
 while(!state.champion){const m=state.matches.find(m=>m.a&&m.b&&!m.resolved);assert(m,'blocked '+n+'/'+slots);assert.notEqual(m.a,m.b);assert(!eliminated.has(m.a));assert(!eliminated.has(m.b));
 if(m.id.startsWith('de-')){const expected=m.id.startsWith('de-w')?0:1;assert.equal(losses.get(m.a),expected);assert.equal(losses.get(m.b),expected);}
 const score=(steps%3===0)!==reverse?[1,0]:[0,1],loser=score[0]>score[1]?m.b:m.a;losses.set(loser,losses.get(loser)+1);if(/^(mx|gx)-/.test(m.id)||losses.get(loser)===2)eliminated.add(loser);
 state=engine.build(players,{...state.clean,[m.id]:{a:m.a,b:m.b,score}},category);assert(++steps<=n*2-2);
 }
 assert.equal(eliminated.size,n-1);assert(!eliminated.has(state.champion));assert.equal(state.main.length,Math.min(2,Math.log2(state.bracketSize)));assert.equal(state.rep.length,state.bracketSize>2?2:0);
 return {players,state,steps};
}
test('64 players: 16 undefeated plus 16 recovered, 111 games and direct knockout',()=>{
 for(const category of Object.keys(engine.limits))for(const reverse of [false,true]){const {state,steps}=run(64,64,category,reverse);assert.equal(steps,111);assert.deepEqual(state.main.map(r=>r.length),[32,16]);assert.deepEqual(state.rep.map(r=>r.length),[16,16]);assert.deepEqual(state.knockout.map(r=>r.length),[16,8,4,2,1]);const qualifiers=state.knockout[0].flatMap(m=>[m.a,m.b]);assert.equal(new Set(qualifiers).size,32);for(const m of state.knockout[0]){assert(m.sources[0].matchId.startsWith('de-w1'));assert(m.sources[1].matchId.startsWith('de-l1'));assert(!state.main.flat().some(prior=>[prior.a,prior.b].includes(m.a)&&[prior.a,prior.b].includes(m.b)));}}
});
test('all categories terminate without reintroducing eliminated players, with arbitrary sizes and WO',()=>{for(const cat of Object.keys(engine.limits))for(const n of [2,3,4,5,8,16,30,62,64,65,90])for(const reverse of [false,true])run(n,n+(n===62?2:0),cat,reverse);});
test('correction updates both qualifying paths and invalidates the downstream champion',()=>{
 const {players,state}=run(64);const first=state.matches[0],after=engine.build(players,{...state.clean,[first.id]:{a:first.a,b:first.b,score:[first.score[1],first.score[0]]}});
 const cleared=engine.invalidated(state,after,first.id);assert(cleared.some(id=>id.startsWith('de-l')));assert(cleared.includes(state.final.id));assert(!after.champion);
});
test('preserves compatible two-round results but excludes former later rounds and final',()=>{const {players,state}=run(64);const results={...state.clean,'de-w2-0':{a:'1',b:'9',score:[5,0]},'de-l2-0':{a:'2',b:'10',score:[5,0]},'de-final':{a:'1',b:'2',score:[5,0]}};const next=engine.build(players,results);assert.deepEqual(next.clean,state.clean);const seen=new Set();for(const m of next.matches){for(const src of m.sources)if(src.matchId)assert(seen.has(src.matchId));seen.add(m.id);}});
