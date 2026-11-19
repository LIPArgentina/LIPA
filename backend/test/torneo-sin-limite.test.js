const {test}=require('node:test');const assert=require('node:assert/strict');const slots=require('../../frontend/torneos/cupos');const engine=require('../../frontend/torneos/grilla-engine');
test('all categories accept larger and odd rosters, preserve order and reach a champion',()=>{
 for(const category of ['primera','segunda','tercera'])for(const n of [31,61,65,90,121,180]){
 const real=Array.from({length:n},(_,i)=>({id:String(i+1),ranking:i+1}));const players=slots.fill(real,category);
 assert(slots.validOrder(players.map(p=>p.id),real.map(p=>p.id),category));assert.deepEqual(players.filter(p=>p.id).map(p=>p.id),real.map(p=>p.id));
 let s=engine.build(players,{},category),steps=0;while(!s.champion){const m=s.matches.find(m=>m.a&&m.b&&!m.resolved);assert(m,category+' '+n);assert.notEqual(m.a,m.b);s=engine.build(players,{...s.clean,[m.id]:{a:m.a,b:m.b,score:[1,0]}},category);assert(++steps<n*4);}
 assert(real.some(p=>p.id===s.champion));
 }
});