(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.LipaSlots=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  const enabled=category=>category==='segunda'||category==='tercera';
  const capacity=(category,count=0)=>Math.max(category==='tercera'?60:30,Math.ceil(count/6)*6);
  function fill(players,category,requestedSize){
    const size=requestedSize??capacity(category,players.length);
    if(!Number.isSafeInteger(size)||size<players.length||size<2)throw new Error("La cantidad de lugares es menor que los jugadores habilitados o no es válida.");
    if((requestedSize===undefined&&!enabled(category))||players.length>=size)return [...players];
    // Occupy the non-multiples first, then replace WO at 3, 6, 9... in order.
    const priority=Array.from({length:size},(_,i)=>i).filter(i=>(i+1)%3!==0)
      .concat(Array.from({length:Math.floor(size/3)},(_,i)=>i*3+2));
    const occupied=new Set(priority.slice(0,players.length));let index=0;
    return Array.from({length:size},(_,i)=>occupied.has(i)?players[index++]:{id:null,nombre:'WO',wo:true});
  }
  function validOrder(order,ids,category,requestedSize){
    if(!Array.isArray(order))return false;
    const real=order.filter(id=>id!==null);
    if(real.length!==ids.length || new Set(real).size!==ids.length || !real.every(id=>ids.includes(id)))return false;
    if(requestedSize===undefined&&!enabled(category))return order.length===ids.length;
    if(!Number.isSafeInteger(requestedSize??order.length)||order.length!== (requestedSize??capacity(category,ids.length))||order.length<ids.length)return false;
    const expected=fill(ids.map(id=>({id})),category,requestedSize);
    return order.every((id,i)=>(id===null)===(expected[i].id===null));
  }
  function shuffle(rows,randomIndex){
    const real=rows.filter(p=>p.id!==null);if(real.length<2)return [...rows];
    const previous=real.map(p=>String(p.id)).join(',');
    do {for(let i=real.length-1;i>0;i--){const j=randomIndex(i+1);[real[i],real[j]]=[real[j],real[i]];}}
    while(real.map(p=>String(p.id)).join(',')===previous);
    let index=0;return rows.map(p=>p.id===null?p:real[index++]);
  }
  return {enabled,capacity,fill,validOrder,shuffle};
});
