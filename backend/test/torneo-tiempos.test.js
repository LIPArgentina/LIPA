const {test}=require('node:test'),assert=require('node:assert/strict');
const {evolve,current}=require('../src/torneoTiempos'),engine=require('../../frontend/torneos/grilla-engine');
const players=Array.from({length:32},(_,i)=>({id:String(i+1),nombre:'Jugador '+(i+1)}));
test('FIFO begins on pairing, assignment does not start, recall and score corrections preserve clock',()=>{
 const m=engine.build(players,{},'segunda').matches[0],id=m.id;
 let entries=evolve([],players,{},'segunda',{},'2026-11-21T10:00:00Z');
 assert.equal(entries.length,16);assert.equal(current(entries)[id].status,'waiting');
 entries=evolve(entries,players,{},'segunda',{matchId:id,table:{mesa:1,piso:'PB'}},'2026-11-21T10:05:00Z');assert.equal(current(entries)[id].startedAt,null);
 entries=evolve(entries,players,{},'segunda',{matchId:id,call:true},'2026-11-21T10:06:00Z');
 entries=evolve(entries,players,{},'segunda',{matchId:id,call:true},'2026-11-21T10:07:00Z');assert.equal(current(entries)[id].startedAt,'2026-11-21T10:06:00Z');
 const result={[id]:{a:m.a,b:m.b,score:[6,2]}};
 entries=evolve(entries,players,result,'segunda',{matchId:id,score:true},'2026-11-21T10:46:00Z');assert.equal(current(entries)[id].durationSeconds,2400);
 result[id].score=[6,3];entries=evolve(entries,players,result,'segunda',{matchId:id,score:true},'2026-11-21T11:00:00Z');assert.equal(current(entries)[id].endedAt,'2026-11-21T10:46:00Z');
 entries=evolve(entries,players,{},'segunda',{reset:[id]},'2026-11-21T11:01:00Z');assert(entries.find(e=>e.matchId===id&&e.archived));assert.equal(current(entries)[id].startedAt,null);
});
test('new opponents create waiting entry immediately; WO never creates timed game',()=>{
 let results={},entries=evolve([],players,results,'segunda',{},'2026-11-21T10:00:00Z');const first=engine.build(players,results,'segunda').groups[0].initial;
 for(const m of first.slice(0,2))results[m.id]={a:m.a,b:m.b,score:[6,1]};
 entries=evolve(entries,players,results,'segunda',{score:true},'2026-11-21T11:00:00Z');const next=engine.build(players,results,'segunda').groups[0].winners[0];assert.equal(current(entries)[next.id].readyAt,'2026-11-21T11:00:00Z');
 const wo=players.map((p,i)=>i===0?{id:null,wo:true}:p);entries=evolve([],wo,{},'segunda');assert(!current(entries)[first[0].id]);
});
