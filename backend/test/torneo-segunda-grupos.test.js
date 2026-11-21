const {test}=require('node:test'),assert=require('node:assert/strict'),engine=require('../../frontend/torneos/grilla-engine');
const players=Array.from({length:32},(_,i)=>({id:String(i+1)}));
const mapping=[[1,2],[3,4],[5,6],[7,8]];
const winnerMapping=[[7,8],[5,6],[1,2],[3,4]];
test('Segunda has four groups with the exact approved assignments and 16 unique qualifiers',()=>{
 let s=engine.build(players,{},'segunda');assert.equal(s.groups.length,4);assert.equal(s.format,'four-groups-v1');
 s.groups.forEach((g,i)=>{assert.deepEqual(g.codes,{g:winnerMapping[i].map(n=>n+'G'),p:mapping[i].map(n=>n+'P')});assert.deepEqual(g.initial.flatMap(m=>[m.a,m.b]),players.slice(i*8,i*8+8).map(p=>p.id));});
 for(let i=0;i<40;i++){const m=s.matches.find(m=>m.id.startsWith('de-')&&!m.resolved&&m.a&&m.b);assert(m);s=engine.build(players,{...s.clean,[m.id]:{a:m.a,b:m.b,score:[6,1]}},'segunda');}
 assert.deepEqual(s.knockout[0].map(m=>m.qualifierNumber),[1,3,5,7,2,4,6,8]);
 s.knockout[0].forEach(m=>{const n=m.qualifierNumber;const gi=mapping.findIndex(pair=>pair.includes(n)),pi=mapping[gi].indexOf(n);assert.equal(m.b,s.groups[gi].recovery[pi].winner);assert.equal(m.a,s.groups[winnerMapping.findIndex(pair=>pair.includes(n))].winners[(n-1)%2].winner);assert.deepEqual(m.sources.map(src=>src.code),[n+'G',n+'P']);});
 assert.equal(new Set(s.knockout[0].flatMap(m=>[m.a,m.b])).size,16);
 let count=40;while(!s.champion){const m=s.matches.find(m=>!m.resolved&&m.a&&m.b);assert(m);s=engine.build(players,{...s.clean,[m.id]:{a:m.a,b:m.b,score:[6,1]}},'segunda');count++;}assert.equal(count,55);
 const first=s.matches[0],next=engine.build(players,{...s.clean,[first.id]:{a:first.a,b:first.b,score:[1,6]}},'segunda');assert(!next.champion);assert(engine.invalidated(s,next,first.id).includes(s.final.id));
});
test('Segunda mapping does not change smaller Primera/Tercera draws or reuse obsolete knockout scores',()=>{
 for(const category of ['primera','tercera'])assert.equal(engine.build(players,{},category).groups.length,0);
 const s=engine.build(players,{'mx-k0-0':{a:'1',b:'2',score:[6,1]},'de-w0-0':{a:'1',b:'2',score:[6,1]}},'segunda');assert(s.clean['de-w0-0']);assert(!s.clean['mx-k0-0']);
});
