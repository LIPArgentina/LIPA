(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;else root.LipaMesas=api;
})(globalThis,function(){
  const arriba=Array.from({length:19},(_,i)=>i+1);
  const pisos={arriba,abajo:arriba.filter(n=>n<=6 || (n>=11 && n<=15))};
  function valid(mesa,piso){return Object.hasOwn(pisos,piso) && pisos[piso].includes(mesa);}
  function active(locations,state){
    const result={};
    for(const match of state.matches){
      const location=locations?.[match.id];
      if(location && match.a===location.a && match.b===location.b && !match.winner && !match.bye)result[match.id]=location;
    }
    return result;
  }
  return {pisos,valid,active};
});
