const {test}=require('node:test');
const assert=require('node:assert/strict');
const bracket=require('../../frontend/torneos/grilla-engine');
const layout=require('../../frontend/torneos/grilla-layout');
test('match cards leave space for table and floor controls in all divisions and views',()=>{
  for(const category of Object.keys(bracket.limits))for(const count of [8,16,32,64,128])for(const dual of [false,true]){
    const players=Array.from({length:count},(_,i)=>({id:String(i+1),nombre:'Jugador '+i}));
    const state=bracket.build(players,{},category);
    for(const rounds of [state.main,state.rep,state.knockout].filter(r=>r.length)){
      const {positions,width,height}=layout.build(rounds,dual);
      const byColumn=new Map();
      for(const pos of positions.values()){
        assert.ok(Number.isFinite(pos.x)&&Number.isFinite(pos.y));
        assert.ok(pos.y>=25);assert.ok(pos.x+pos.width<=width);assert.ok(pos.y+130<=height);
        if(!byColumn.has(pos.x))byColumn.set(pos.x,[]);byColumn.get(pos.x).push(pos.y);
      }
      for(const column of byColumn.values()){
        column.sort((a,b)=>a-b);for(let i=1;i<column.length;i++)assert.ok(column[i]-column[i-1]>=130,`${category} ${count} cards overlap`);
      }
    }
  }
});
