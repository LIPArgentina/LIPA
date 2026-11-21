const {test}=require('node:test'),assert=require('node:assert/strict'),engine=require('../../frontend/torneos/grilla-engine'),select=require('../../frontend/torneos/tv-slides');
test('TV starts with eight Tercera groups, adds assigned Segunda and knockout, removes complete groups',()=>{
 for(const category of ['tercera','segunda']){
 const players=Array.from({length:category==='tercera'?64:32},(_,i)=>({id:String(i+1)}));let state=engine.build(players,{},category),data={timings:{},assignments:{}};
 assert.equal(select(state,category,data).groups.length,category==='tercera'?8:0);assert.equal(select(state,category,data).knockout,false);
 data.assignments[state.groups[0].initial[0].id]={mesa:1};assert.equal(select(state,category,data).groups.length,category==='tercera'?8:1);
 const results={};for(let i=0;i<10;i++){const group=state.groups[0],m=[...group.initial,...group.winners,...group.losers,...group.recovery].find(m=>!m.resolved&&m.a&&m.b);results[m.id]={a:m.a,b:m.b,score:[5,1]};state=engine.build(players,results,category);}
 assert(!select(state,category,data).groups.some(g=>g.number===1));assert.equal(select(state,category,data).knockout,false);
 data.timings[state.knockout[0][0].id]={assignedAt:'2026-11-21T10:00:00Z'};assert.equal(select(state,category,data).knockout,true);
 }
});
