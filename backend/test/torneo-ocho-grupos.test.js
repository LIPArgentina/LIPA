const {test}=require('node:test'),assert=require('node:assert/strict');
const engine=require('../../frontend/torneos/grilla-engine');
const players=Array.from({length:64},(_,i)=>({id:String(i+1)}));
const mapping=[[14,13],[8,7],[12,11],[10,9],[2,1],[6,5],[15,16],[4,3]];
test('eight consecutive groups preserve initial draw, crossed recovery and approved output codes',()=>{
 const s=engine.build(players);assert.equal(s.groups.length,8);
 s.groups.forEach((g,i)=>{
 assert.deepEqual(g.initial.flatMap(m=>[m.a,m.b]),players.slice(i*8,i*8+8).map(p=>p.id));
 assert.deepEqual(g.codes,{g:[(i*2+1)+'G',(i*2+2)+'G'],p:mapping[i].map(n=>n+'P')});
 assert.equal(g.recovery[0].sources[1].matchId,g.winners[1].id);
 assert.equal(g.recovery[1].sources[1].matchId,g.winners[0].id);
 });
});
test('knockout has odds on left and evens on right, each code mapped to its exact qualifier',()=>{
 let s=engine.build(players);
 for(let i=0;i<80;i++){const m=s.matches.find(m=>m.id.startsWith('de-')&&!m.resolved&&m.a&&m.b);assert(m);s=engine.build(players,{...s.clean,[m.id]:{a:m.a,b:m.b,score:[5,1]}});}
 const expected=[1,3,5,7,9,11,13,15,2,4,6,8,10,12,14,16];
 assert.deepEqual(s.knockout[0].map(m=>m.qualifierNumber),expected);
 s.knockout[0].forEach((m,i)=>{
 const n=expected[i],g=s.groups[Math.floor((n-1)/2)];assert.equal(m.a,g.winners[(n-1)%2].winner);
 const gi=mapping.findIndex(pair=>pair.includes(n)),pi=mapping[gi].indexOf(n);assert.equal(m.b,s.groups[gi].recovery[pi].winner);
 assert.deepEqual(m.sources.map(src=>src.code),[n+'G',n+'P']);
 });
 assert.equal(new Set(s.knockout[0].flatMap(m=>[m.a,m.b])).size,32);
});
test('old knockout results cannot transfer to reordered matches; group scores remain',()=>{
 const stored={'de-w0-0':{a:'1',b:'2',score:[5,1]},'mx-k0-0':{a:'1',b:'35',score:[5,1]}};
 const s=engine.build(players,stored);assert(s.clean['de-w0-0']);assert(!s.clean['mx-k0-0']);assert(s.matches.every(m=>!m.id.startsWith('mx-')));
});
