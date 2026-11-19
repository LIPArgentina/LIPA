const {test}=require('node:test'),assert=require('node:assert/strict');const engine=require('../../frontend/torneos/grilla-engine'),layout=require('../../frontend/torneos/grilla-layout');
test('variable brackets have bounded non-overlapping positions and connected feeder centres',()=>{
 for(const n of [2,30,60,62,64,66,90,128,180])for(const category of ['primera','segunda','tercera']){
 const players=Array.from({length:n},(_,i)=>({id:String(i+1)}));const state=engine.build(players,{},category);
 for(const rounds of [state.main,state.rep,state.knockout])for(const dual of [false,true]){
 if(!rounds.length)continue;const result=layout.build(rounds,dual),pos=[...result.positions.values()];
 for(const p of pos){assert(Number.isFinite(p.x)&&Number.isFinite(p.y));assert(p.y>=0);assert(p.x+p.width<=result.width);assert(p.y+112<result.height);}
 for(let i=0;i<pos.length;i++)for(let j=i+1;j<pos.length;j++)if(pos[i].x===pos[j].x)assert(Math.abs(pos[i].center-pos[j].center)>=100);
 if(rounds===state.main)rounds.slice(1).forEach((round,r)=>round.forEach((m,i)=>{const a=result.positions.get(rounds[r][i*2].id),b=rounds[r][i*2+1]&&result.positions.get(rounds[r][i*2+1].id);assert.equal(result.positions.get(m.id).center,b?(a.center+b.center)/2:a.center);}));
 }
 }
});