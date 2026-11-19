const {test}=require('node:test'),assert=require('node:assert/strict');const engine=require('../../frontend/torneos/grilla-engine'),layout=require('../../frontend/torneos/grilla-layout');
function run(n,slots=n,category='tercera',lowerWins=false){
 const players=Array.from({length:slots},(_,i)=>({id:i<n?String(i+1):null}));let state=engine.build(players,{},category),steps=0;const losses=new Map(players.filter(p=>p.id).map(p=>[p.id,0]));
 while(!state.champion){const m=state.matches.find(m=>m.a&&m.b&&!m.resolved);assert(m,'blocked '+n+'/'+slots);assert.notEqual(m.a,m.b);
 const expected=m.id.startsWith('de-w')?0:1;if(m.id!=='de-final'){assert.equal(losses.get(m.a),expected);assert.equal(losses.get(m.b),expected);}else{assert.equal(losses.get(m.a),0);assert.equal(losses.get(m.b),1);}
 const score=m.id==='de-final'?(lowerWins?[0,1]:[1,0]):(steps%3?[1,0]:[0,1]);const loser=score[0]>score[1]?m.b:m.a;losses.set(loser,losses.get(loser)+1);
 state=engine.build(players,{...state.clean,[m.id]:{a:m.a,b:m.b,score}},category);assert(++steps<=n*2-2);
 }
 assert.equal(steps,n*2-2);for(const [id,count] of losses)if(id!==state.champion)assert.equal(count,id===state.final.loser&&lowerWins?1:2);assert.equal(state.matches.filter(m=>m.id==='de-final').length,1);
 return {players,state};
}
test('all divisions reach a single final with correct losses, arbitrary sizes and WO',()=>{for(const cat of ['primera','segunda','tercera'])for(const n of [2,3,4,5,8,16,30,62,64,65,90])for(const reset of [false,true])run(n,n+(n===62?2:0),cat,reset);});
test('legacy scores are not imported, correcting upper results invalidates lower descendants',()=>{
 const {players,state}=run(8);assert.deepEqual(engine.build(players,{'p-0':{a:'1',b:'2',score:[5,0]}}).clean,{});
 const first=state.matches[0],after=engine.build(players,{...state.clean,[first.id]:{a:first.a,b:first.b,score:[first.score[1],first.score[0]]}});
 const cleared=engine.invalidated(state,after,first.id);assert(cleared.some(id=>id.startsWith('de-l')));assert(cleared.includes('de-final'));assert(!after.champion);
});
test('layout handles lower rounds with equal counts and every source references an earlier match',()=>{
 const {state}=run(62,64);const seen=new Set();for(const m of state.matches){for(const src of m.sources)if(src.matchId)assert(seen.has(src.matchId));seen.add(m.id);}
 for(const rounds of [state.main,state.rep,[[state.final]]])for(const dual of [false,true]){const l=layout.build(rounds,dual);const positions=[...l.positions.values()];assert.equal(positions.length,rounds.flat().length);for(const p of positions){assert(Number.isFinite(p.y));assert(p.y>=0);assert(p.y+112<l.height);}for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++)if(positions[i].x===positions[j].x)assert(Math.abs(positions[i].center-positions[j].center)>=100);}
});